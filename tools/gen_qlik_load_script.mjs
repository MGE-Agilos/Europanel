/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Générateur du script de chargement Qlik

   Lit docs/fields.js (source de vérité unique) et génère un fichier .txt
   de script de chargement Qlik par section, destiné à être assemblé dans
   l'éditeur de chargement via $(Include=...).

   Règle de qualification des champs : le modèle associatif de Qlik relie
   automatiquement deux champs de même nom, dans n'importe quelles tables.
   Sans discipline de nommage, "code", "idx", "updated_at" ou "name" — qui
   apparaissent dans une dizaine de tables sans rapport — associeraient ces
   tables entre elles par accident. La règle est donc : tout champ qui n'est
   pas une clé de liaison délibérée est préfixé par le nom de sa table
   (`<table>_<colonne>`). Restent nus, et seulement eux : submission_id,
   company_id, plant_id, cycle_id, et les quatre colonnes *_id des tables
   parentes (combustion_unit_id, abatement_technique_id, emission_point_id,
   waste_water_discharge_id), list_code, et RefKey (list_code & '|' & code,
   qui relie chaque table à clés à ref_lists sans jamais associer deux
   tables à clés entre elles : chaque list_code n'appartient qu'à une seule
   table du questionnaire).

   Usage : node tools/gen_qlik_load_script.mjs
   ══════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { SCHEMA } = require(path.join(ROOT, 'docs', 'fields.js'));
const OUT_DIR = path.join(ROOT, 'qlik', 'load-script');

const BASE_URL = 'https://vxwmhsgxoomcbiukeinp.supabase.co/rest/v1';
const SPACE = 'Europanel';
const CONNECTION = `${SPACE}:${SPACE}`;
// Chemin QUALIFIÉ PAR L'ESPACE, et non « lib://DataFiles/… » : vérifié par
// FileList() dans l'application, la forme non qualifiée ne voit aucun des
// quinze fichiers, alors que la forme qualifiée les voit tous.
const DATA_FILES_LIB = `lib://${SPACE}:DataFiles`;

// Table portant chaque colonne *_id de parent — construit depuis le
// manifeste, jamais recopié à la main : voir docs/db.js#parentColumn pour
// le même principe côté application.
const PARENT_COL_OF = {};
for (const entry of Object.values(SCHEMA)) {
  if (entry.parent) PARENT_COL_OF[entry.parent] = entry.parentCol;
}

const PAGE_SLUGS = {
  0: 'contacts', 1: 'general_info', 2: 'plant_layout', 3: 'raw_materials',
  4: 'energy', 5: 'dryers_presses', 6: 'abatement', 7: 'emission_points',
  8: 'waste_water', 9: 'solid_waste', 10: 'water_consumption', 11: 'bat_candidate',
};

// ── Plan de colonnes ─────────────────────────────────────────────────────
// Pour une table donnée, retourne [{ dbCol, qlikName }] dans l'ordre
// d'émission SQL, plus une liste de champs calculés (RefKey) à ajouter au
// LOAD sans qu'ils existent côté SQL SELECT.

// ── Colonnes calculées propres à une table ───────────────────────────────
// Ce que le tableau de bord a besoin de découper autrement que ne le fait
// la base. Le calcul appartient au script et non à une dimension calculée
// dans un graphique : une expression enfouie dans un objet n'est visible
// que de qui l'ouvre, ne se réutilise pas d'un graphique à l'autre, et se
// recalcule à chaque rafraîchissement au lieu d'une fois au chargement.
const RefLabelExpr = `ApplyMap('RefLabelMap', [list_code] & '|' & [code], [code])`;

const EXTRA_COMPUTED = {
  // Polluants comparables sur un axe de concentration massique. L'odeur
  // (ouE/m³) et les PCDD/PCDF (ng I-TEQ/Nm³) n'en sont pas : les porter sur
  // le même axe que des mg/Nm³ produirait un graphique dont l'échelle est
  // fixée par une grandeur sans rapport. Null les écarte proprement — une
  // dimension Qlik ignore ses valeurs nulles — sans supprimer les lignes,
  // qui restent lisibles partout ailleurs.
  //
  // ApplyMap est répété au lieu de renvoyer à l'alias : dans un même LOAD,
  // une expression ne voit pas les « as » définis plus haut dans la liste.
  emission_point_pollutants: [{
    expr: `If(Match(${RefLabelExpr}, 'Odour', 'PCDD/PCDF') = 0, ${RefLabelExpr})`,
    qlikName: 'emission_point_pollutants_mass_label',
  }],
};

function planManifestTable(table, entry) {
  const cols = [];
  const computed = [];
  const isParent = Object.prototype.hasOwnProperty.call(PARENT_COL_OF, table);

  if (entry.kind === 'one') {
    cols.push({ dbCol: 'submission_id', qlikName: 'submission_id' });
    for (const col of Object.keys(entry.cols)) {
      cols.push({ dbCol: col, qlikName: `${table}_${col}` });
    }
    cols.push({ dbCol: 'updated_at', qlikName: `${table}_updated_at` });
    return { cols, computed };
  }

  if (entry.kind === 'many') {
    cols.push({ dbCol: 'id', qlikName: isParent ? PARENT_COL_OF[table] : `${table}_id` });
    cols.push({ dbCol: 'submission_id', qlikName: 'submission_id' });
    cols.push({ dbCol: 'idx', qlikName: `${table}_idx` });
    for (const col of Object.keys(entry.cols)) {
      cols.push({ dbCol: col, qlikName: `${table}_${col}` });
    }
    cols.push({ dbCol: 'updated_at', qlikName: `${table}_updated_at` });
    return { cols, computed };
  }

  if (entry.kind === 'keyed') {
    cols.push({ dbCol: 'id', qlikName: `${table}_id` });
    if (entry.parent) {
      cols.push({ dbCol: entry.parentCol, qlikName: entry.parentCol });
    } else {
      cols.push({ dbCol: 'submission_id', qlikName: 'submission_id' });
    }
    cols.push({ dbCol: 'code', qlikName: `${table}_code` });
    // list_code est sélectionné mais non restitué : il sert uniquement à
    // construire la clé de mappage ci-dessous. L'exposer en champ nu
    // relierait cette table à ref_lists, et ref_lists à toutes les autres
    // tables à clés — ce qui referme une boucle par le centre du modèle.
    cols.push({ dbCol: 'list_code', qlikName: null });
    for (const col of Object.keys(entry.cols)) {
      cols.push({ dbCol: col, qlikName: `${table}_${col}` });
    }
    cols.push({ dbCol: 'updated_at', qlikName: `${table}_updated_at` });
    // Les expressions référencent les noms de champs SOURCE (RESIDENT), pas
    // les alias : dans un même LOAD, une expression ne voit jamais un « as »
    // défini plus haut dans la même liste.
    //
    // ApplyMap plutôt qu'une table ref_lists liée : une table de référence
    // partagée par quatorze tables à clés les relierait toutes entre elles
    // (boucles), et le double lien list_code + RefKey y ajouterait une clé
    // synthétique. Une table de mappage ne fait pas partie du modèle : le
    // libellé est résolu au chargement et atterrit dans la table qui s'en
    // sert. Repli sur le code lui-même, jamais sur un libellé inventé.
    // Suffixes _ref_label / _ref_unit, et non _label / _unit : site_activity_units
    // porte déjà une colonne « unit » (l'unité saisie par l'opérateur), qui se
    // qualifie en site_activity_units_unit. Le suffixe distingue ce que dit la
    // liste de référence de ce qu'a écrit l'opérateur — deux choses différentes,
    // qu'il ne faut pas confondre dans un graphique.
    computed.push({
      expr: `ApplyMap('RefLabelMap', [list_code] & '|' & [code], [code])`,
      qlikName: `${table}_ref_label`,
    });
    computed.push({
      expr: `ApplyMap('RefUnitMap', [list_code] & '|' & [code], null())`,
      qlikName: `${table}_ref_unit`,
    });
    for (const extra of EXTRA_COMPUTED[table] || []) computed.push(extra);
    return { cols, computed };
  }

  throw new Error(`kind inconnu : ${entry.kind} (table ${table})`);
}

// ── Tables « core », absentes du manifeste (companies, plants, cycles,
// submissions) et ref_lists : listées à la main d'après
// supabase/migrations/001_schema.sql et 002_relational_schema.sql. ────────

const CORE_TABLES = {
  companies: {
    cols: [
      { dbCol: 'id', qlikName: 'company_id' },
      { dbCol: 'name', qlikName: 'companies_name' },
      { dbCol: 'country', qlikName: 'companies_country' },
      { dbCol: 'created_at', qlikName: 'companies_created_at' },
    ],
  },
  plants: {
    cols: [
      { dbCol: 'id', qlikName: 'plant_id' },
      // QUALIFIÉ, donc non associatif, et c'est délibéré : companies,
      // plants et submissions formeraient sinon un triangle
      // (submissions→companies, submissions→plants, plants→companies).
      // Qlik coupe une boucle en rendant une table « faiblement liée »,
      // c'est-à-dire en la retirant en silence de la logique associative :
      // les graphiques continuent de s'afficher, et deviennent faux.
      // Le rattachement d'une usine à sa société reste lisible en passant
      // par les soumissions, seul chemin dont le tableau de bord a besoin.
      { dbCol: 'company_id', qlikName: 'plants_company_id' },
      { dbCol: 'name', qlikName: 'plants_name' },
      { dbCol: 'country', qlikName: 'plants_country' },
      { dbCol: 'created_at', qlikName: 'plants_created_at' },
      { dbCol: 'updated_at', qlikName: 'plants_updated_at' },
    ],
  },
  cycles: {
    cols: [
      { dbCol: 'id', qlikName: 'cycle_id' },
      { dbCol: 'label', qlikName: 'cycles_label' },
      { dbCol: 'reference_year', qlikName: 'cycles_reference_year' },
      { dbCol: 'opens_at', qlikName: 'cycles_opens_at' },
      { dbCol: 'closes_at', qlikName: 'cycles_closes_at' },
      { dbCol: 'status', qlikName: 'cycles_status' },
      { dbCol: 'created_at', qlikName: 'cycles_created_at' },
      { dbCol: 'updated_at', qlikName: 'cycles_updated_at' },
    ],
  },
  submissions: {
    cols: [
      { dbCol: 'id', qlikName: 'submission_id' },
      { dbCol: 'user_id', qlikName: 'submissions_user_id' },
      { dbCol: 'company_id', qlikName: 'company_id' },
      { dbCol: 'plant_id', qlikName: 'plant_id' },
      { dbCol: 'cycle_id', qlikName: 'cycle_id' },
      { dbCol: 'status', qlikName: 'submissions_status' },
      { dbCol: 'reference_year', qlikName: 'submissions_reference_year' },
      { dbCol: 'created_at', qlikName: 'submissions_created_at' },
      { dbCol: 'submitted_at', qlikName: 'submissions_submitted_at' },
      { dbCol: 'updated_at', qlikName: 'submissions_updated_at' },
    ],
  },
};

// ref_lists n'entre pas dans le modèle : il devient deux tables de mappage,
// consommées par ApplyMap dans chaque table à clés. Voir planManifestTable
// pour la raison (boucles et clé synthétique si ref_lists reste une table).
function emitRefListMaps() {
  return [
    `RestConnectorMasterTable:`,
    `SQL SELECT`,
    `\t"list_code",`,
    `\t"code",`,
    `\t"label",`,
    `\t"unit"`,
    `FROM JSON (wrap on) "root"`,
    `WITH CONNECTION (Url "${BASE_URL}/ref_lists");`,
    ``,
    `// Une table de mappage se charge en exactement deux colonnes :`,
    `// la clé, puis la valeur.`,
    `RefLabelMap:`,
    `MAPPING LOAD`,
    `\t[list_code] & '|' & [code],`,
    `\t[label]`,
    `RESIDENT RestConnectorMasterTable;`,
    ``,
    `RefUnitMap:`,
    `MAPPING LOAD`,
    `\t[list_code] & '|' & [code],`,
    `\t[unit]`,
    `RESIDENT RestConnectorMasterTable;`,
    ``,
    `DROP TABLE RestConnectorMasterTable;`,
    ``,
  ].join('\n');
}

// ── Émission du script ───────────────────────────────────────────────────

// Qlik refuse deux champs de même nom dans une table, et ne le dit qu'au
// rechargement — après upload, donc loin d'ici. Une colonne du manifeste et
// un champ calculé peuvent se rencontrer sous le même nom qualifié : c'est
// arrivé avec site_activity_units, qui a une colonne « unit » en propre.
// La vérification a lieu à la génération pour que l'échec soit immédiat.
function assertUniqueNames(table, cols, computed) {
  const seen = new Map();
  const all = [...cols.filter(c => c.qlikName !== null), ...computed];
  for (const c of all) {
    if (seen.has(c.qlikName)) {
      throw new Error(
        `${table} : le champ « ${c.qlikName} » est produit deux fois ` +
        `(${seen.get(c.qlikName)} et ${c.dbCol || c.expr})`
      );
    }
    seen.set(c.qlikName, c.dbCol || c.expr);
  }
}

function emitBlockFinal(table, cols, computed, restLabel) {
  assertUniqueNames(table, cols, computed);
  const selectList = cols.map(c => `\t"${c.dbCol}"`).join(',\n');
  // qlikName null : colonne lue par le SELECT — donc disponible aux
  // expressions du LOAD — mais volontairement absente du modèle.
  const kept = cols.filter(c => c.qlikName !== null);
  const loadList = kept.map(c =>
    c.dbCol === c.qlikName ? `\t[${c.dbCol}]` : `\t[${c.dbCol}] as [${c.qlikName}]`
  );
  for (const c of computed) loadList.push(`\t${c.expr} as [${c.qlikName}]`);
  const shellFields = [...kept.map(c => c.qlikName), ...computed.map(c => c.qlikName)];

  return [
    `// ${table}`,
    `// Coquille vide, puis une page par tour de boucle. PostgREST ne rend`,
    `// JAMAIS plus de 1000 lignes par requête et ne signale pas qu'il tronque :`,
    `// un SELECT nu sur une table plus longue chargerait 1000 lignes et`,
    `// rechargerait « avec succès ». La boucle s'arrête sur la première page`,
    `// incomplète ; une page vide est sans effet (vérifié dans l'application).`,
    `[${table}]:`,
    `LOAD * INLINE [`,
    shellFields.join(', '),
    `];`,
    ``,
    `LET vEpOffset = 0;`,
    `DO`,
    `\t${restLabel}:`,
    `\tSQL SELECT`,
    selectList.replace(/^\t/gm, '\t\t'),
    `\tFROM JSON (wrap on) "root"`,
    `\tWITH CONNECTION (Url "${BASE_URL}/${table}?limit=$(vEpPageSize)&offset=$(vEpOffset)");`,
    ``,
    `\tLET vEpRows = NoOfRows('${restLabel}');`,
    ``,
    `\tCONCATENATE ([${table}])`,
    `\tLOAD`,
    loadList.join(',\n').replace(/^\t/gm, '\t\t'),
    `\tRESIDENT ${restLabel};`,
    ``,
    `\tDROP TABLE ${restLabel};`,
    `\tLET vEpOffset = $(vEpOffset) + $(vEpPageSize);`,
    `LOOP WHILE vEpRows = $(vEpPageSize)`,
    ``,
  ].join('\n');
}

function header(title, notes) {
  const lines = [
    `// ═══════════════════════════════════════════════════════════════════`,
    `// EuroPanel — ${title}`,
    `// Généré par tools/gen_qlik_load_script.mjs — ne pas éditer à la main :`,
    `// toute correction doit passer par docs/fields.js puis régénérer.`,
  ];
  for (const n of notes) lines.push(`// ${n}`);
  lines.push(`// ═══════════════════════════════════════════════════════════════════`, ``);
  return lines.join('\n');
}

// Ouvre la connexion REST. Indispensable en tête de CHAQUE fichier de
// section : WITH CONNECTION ne fait que remplacer l'URL de la connexion
// déjà ouverte, il n'en ouvre aucune. Sans cette ligne, le rechargement
// s'arrête sur « There is no open data connection ». La répéter par fichier
// plutôt que de la poser une seule fois dans l'assemblage garde chaque
// section exécutable seule, dans n'importe quel ordre.
function connectLine() {
  return [
    `LIB CONNECT TO '${CONNECTION}';`,
    ``,
    `// Plafond impose par PostgREST, pas un choix de confort : demander`,
    `// davantage ne rend pas davantage, et rien n'avertit du plafonnement.`,
    `LET vEpPageSize = 1000;`,
    ``,
  ].join('\n');
}

function writeFile(name, content) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, name), content, 'utf8');
  console.log(`écrit : qlik/load-script/${name}`);
}

// ── 00_core.txt ──────────────────────────────────────────────────────────
{
  let out = header('Tables core (companies, plants, cycles, submissions)', [
    'company_id, plant_id, cycle_id, submission_id sont les clés d\'association',
    'nues partagées par toutes les autres sections. Charger cette section en',
    'premier : les sections de page s\'associent dessus par submission_id.',
  ]) + connectLine();
  let n = 1;
  for (const [table, def] of Object.entries(CORE_TABLES)) {
    const restLabel = n === 1 ? 'RestConnectorMasterTable' : `RestConnectorMasterTable${n}`;
    out += emitBlockFinal(table, def.cols, def.computed || [], restLabel) + '\n';
    n++;
  }
  writeFile('00_core.txt', out);
}

// ── 01_ref_lists.txt ─────────────────────────────────────────────────────
{
  const out = header('ref_lists — tables de mappage des libellés', [
    'À inclure APRÈS 00_core.txt et AVANT toute section de page : les tables',
    'à clés y résolvent leur libellé par ApplyMap au moment du chargement.',
    '',
    'La clé de mappage est list_code & \'|\' & code, jamais code seul : un même',
    'code (« other », « toc »...) réapparaît dans plusieurs listes et',
    'rapprocherait des lignes sans rapport.',
  ]) + connectLine() + emitRefListMaps();
  writeFile('01_ref_lists.txt', out);
}

// ── 02_whatif.txt ────────────────────────────────────────────────────────
{
  const out = header('Échelles de simulation — tables îlots', [
    'Une table îlot n\'a de clé commune avec aucune autre : elle ne se lie à',
    'rien, et c\'est voulu. Ses valeurs servent d\'axe à une simulation, pas',
    'de filtre sur les données — sélectionner 15 mg/Nm³ ne doit écarter',
    'aucune mesure, seulement déplacer le seuil que la mesure compare.',
    '',
    'Pourquoi ici et non dans un « =ValueList(5, 10, 15, 20) » au fond d\'un',
    'graphique : une échelle écrite dans une expression de dimension doit',
    'être répétée à l\'identique dans chaque mesure qui la compare. Les deux',
    'copies dérivent le jour où l\'on ajoute un palier à une seule des deux,',
    'et le graphique compte alors au mauvais seuil sans rien signaler.',
  ]) + [
    '',
    '// Paliers d\'AEL candidats discutés en groupe de travail (mg/Nm³).',
    '// Ajouter un palier ici suffit : le graphique le reprend au rechargement.',
    'CandidateAEL:',
    'LOAD * INLINE [',
    '\tcandidate_ael',
    '\t5',
    '\t10',
    '\t15',
    '\t20',
    '];',
    '',
  ].join('\n');
  writeFile('02_whatif.txt', out);
}

// ── un fichier par page ──────────────────────────────────────────────────
const byPage = {};
for (const [table, entry] of Object.entries(SCHEMA)) {
  (byPage[entry.page] ??= []).push([table, entry]);
}

for (const page of Object.keys(byPage).map(Number).sort((a, b) => a - b)) {
  const slug = PAGE_SLUGS[page];
  const tables = byPage[page];
  let out = header(`Page ${page} — ${slug} (${tables.length} table${tables.length > 1 ? 's' : ''})`, [
    'submission_id (et, pour les tables enfants, la colonne *_id de leur',
    'table parente) est la seule clé nue. Tout le reste est préfixé par le',
    'nom de sa table pour éviter une association accidentelle avec une autre',
    'section du questionnaire.',
  ]) + connectLine();
  let n = 1;
  for (const [table, entry] of tables) {
    const { cols, computed } = planManifestTable(table, entry);
    const restLabel = n === 1 ? 'RestConnectorMasterTable' : `RestConnectorMasterTable${n}`;
    out += emitBlockFinal(table, cols, computed, restLabel) + '\n';
    n++;
  }
  writeFile(`page_${String(page).padStart(2, '0')}_${slug}.txt`, out);
}

// ── 98_submission_values.txt ─────────────────────────────────────────────
// Toutes les réponses d'un questionnaire en une seule table longue, pour la
// feuille « détail des soumissions ».
{
  const PAGE_TITLES = {
    0: 'Cover & Contact', 1: 'General Information', 2: 'Plant Layout',
    3: 'Raw Materials', 4: 'Energy Production', 5: 'Dryer & Press Line',
    6: 'Air Abatement', 7: 'Air Emissions', 8: 'Water Emissions',
    9: 'Solid Residues', 10: 'Water Consumption', 11: 'BAT Candidate',
  };

  // Six colonnes de qualification, identiques pour toutes les tables : c'est
  // ce que CROSSTABLE laisse intact devant la paire champ/valeur. Leur nombre
  // est écrit dans chaque instruction, donc il ne peut pas diverger d'une
  // table à l'autre sans que le rechargement échoue franchement.
  const QUALIFIERS = 6;

  const lines = [];
  const push = (...l) => lines.push(...l);

  push(header('submission_values — toutes les réponses en table longue', [
    'Une ligne par (soumission, section, instance, champ). ~120 000 lignes.',
    '',
    'Pourquoi une table longue plutôt que trente tableaux posés à la main :',
    'compter ce qui MANQUE suppose de connaître la liste des champs attendus.',
    'Un tableau construit à la main ne connaît que les champs qu\'il affiche,',
    'et ne peut donc rien dire d\'un champ vide. Cette table tient sa liste du',
    'manifeste, donc elle suit le questionnaire sans que personne y pense.',
    '',
    'Toutes les colonnes sont préfixées sv_ sauf submission_id, qui est le',
    'lien voulu avec le reste du modèle. Sans ce préfixe, « code », « idx »',
    'ou « field » rencontreraient leurs homonymes dans quinze autres tables',
    'et Qlik fabriquerait des clés synthétiques par le milieu du modèle.',
    '',
    'À inclure APRÈS toutes les sections de page : tout ici est du RESIDENT.',
  ]));

  // ── tables de correspondance vers les parents ───────────────────────────
  const parents = [...new Set(Object.values(SCHEMA)
    .filter(e => e.parent).map(e => e.parent))].sort();

  if (parents.length) {
    push('// Les tables à clés imbriquées ne portent pas submission_id : leur seul',
         '// lien est l\'identifiant de leur parent répétable. On y remonte la',
         '// soumission et le numéro d\'instance du parent.');
    for (const p of parents) {
      const col = PARENT_COL_OF[p];
      push(`Map_${p}_sub:`,
           `MAPPING LOAD [${col}], [submission_id] RESIDENT [${p}];`,
           `Map_${p}_idx:`,
           `MAPPING LOAD [${col}], [${p}_idx] RESIDENT [${p}];`,
           '');
    }
    // Le type de cheminée sert de second axe aux bornes d'anomalie ci-dessous.
    // Il est le seul attribut de parent dont le calcul ait besoin ; les autres
    // n'auraient aucun usage et alourdiraient le rechargement pour rien.
    push('Map_emission_points_desc:',
         'MAPPING LOAD [emission_point_id], [emission_points_waste_gas_desc] ' +
           'RESIDENT [emission_points];',
         '');
  }

  // ── bornes statistiques des concentrations ──────────────────────────────
  push(
    '// Bornes d\'anomalie, calculées ici et non dans un graphique : le seuil',
    '// d\'un polluant dépend de toute la distribution du panel, donc d\'un',
    '// balayage complet. Le refaire à chaque rafraîchissement d\'écran coûte',
    '// cher pour un résultat qui ne change qu\'au rechargement.',
    '//',
    '// P75 + 3 × écart interquartile : la clôture de Tukey, élargie de 1,5 à 3',
    '// pour ne signaler que l\'aberration franche. Une collecte volontaire a',
    '// des valeurs légitimement dispersées ; à 1,5 on noierait le secrétariat',
    '// sous des alertes qui ne sont que la réalité du secteur.',
    '//',
    '// Groupé par polluant ET par type de cheminée : 10 mg/Nm³ de',
    '// formaldéhyde n\'a pas le même sens sur un séchoir au bois recyclé et',
    '// sur un filtre de ponçage (voir le mouvement 04 du parcours).',
    'EpConcTmp:',
    'LOAD',
    '\t[emission_point_pollutants_code] & \'|\' & ' +
      `ApplyMap('Map_emission_points_desc', [emission_point_id], '?') as [sv_gkey_tmp],`,
    '\t[emission_point_pollutants_conc] as [conc_tmp]',
    'RESIDENT [emission_point_pollutants]',
    'WHERE Len([emission_point_pollutants_conc]) > 0;',
    '',
    'FenceMap:',
    'MAPPING LOAD',
    '\t[sv_gkey_tmp],',
    '\tFractile([conc_tmp], 0.75) + 3 * (Fractile([conc_tmp], 0.75) - Fractile([conc_tmp], 0.25))',
    'RESIDENT EpConcTmp',
    'GROUP BY [sv_gkey_tmp];',
    '',
    'DROP TABLE EpConcTmp;',
    '');

  // ── un CROSSTABLE par table du manifeste ────────────────────────────────
  push(
    '// Chaque valeur est passée par If(IsNull(...), \'\', ...) et non chargée',
    '// telle quelle. CROSSTABLE n\'émet AUCUNE ligne pour une cellule nulle :',
    '// un champ laissé vide par l\'opérateur n\'existerait tout simplement pas',
    '// dans la table longue, et la feuille ne pourrait pas le signaler — elle',
    '// ne saurait pas distinguer « rempli » de « jamais rempli », qui est',
    '// pourtant la première chose que le contrôle qualité cherche.',
    '//',
    '// NullAsValue a été essayé d\'abord, et ne suffit pas : la ligne est',
    '// écartée au pivot, avant que la conversion ne s\'applique.',
    '//',
    '// La valeur n\'est PAS passée par Text() ici : cela détruirait sa part',
    '// numérique, et sv_num, calculé dans la passe finale, resterait vide',
    '// pour toutes les réponses chiffrées. La conversion en texte se fait en',
    '// fin de course, quand la valeur numérique a déjà été prélevée.',
    '');

  const RAW = 'submission_values_raw';
  let sections = 0;
  let first = true;

  for (const [table, entry] of Object.entries(SCHEMA)) {
    const cols = Object.keys(entry.cols);
    if (!cols.length) continue;

    const page = entry.page;
    let subExpr, instExpr, codeExpr, gkeyExpr;

    if (entry.parent) {
      const col = entry.parentCol;
      subExpr = `ApplyMap('Map_${entry.parent}_sub', [${col}]) as [submission_id]`;
      instExpr = `ApplyMap('Map_${entry.parent}_idx', [${col}]) as [sv_instance]`;
    } else {
      subExpr = '[submission_id]';
      instExpr = entry.kind === 'many'
        ? `[${table}_idx] as [sv_instance]`
        : 'null() as [sv_instance]';
    }

    codeExpr = entry.kind === 'keyed'
      ? `[${table}_ref_label] as [sv_code]`
      : 'null() as [sv_code]';

    // Seules les concentrations d'air ont une borne : ailleurs, sv_gkey reste
    // vide et l'état ne peut pas valoir HORS PLAGE.
    gkeyExpr = table === 'emission_point_pollutants'
      ? `[emission_point_pollutants_code] & '|' & ` +
        `ApplyMap('Map_emission_points_desc', [emission_point_id], '?') as [sv_gkey]`
      : 'null() as [sv_gkey]';

    // Pas de préfixe CONCATENATE : Qlik refuse « Illegal combination of
    // prefixes » sur CONCATENATE suivi de CROSSTABLE. On s'appuie donc sur
    // la concaténation automatique — chaque pivot produit exactement les
    // mêmes huit champs que le précédent, puisque c'est le même générateur
    // qui les écrit, et Qlik empile alors sans qu'on le demande.
    //
    // Cette commodité est aussi un risque : le jour où un pivot produirait
    // un champ de plus, Qlik ouvrirait une table à part sans rien dire et la
    // table longue partirait incomplète. D'où le garde-fou en fin de fichier,
    // qui compare le nombre de sections chargées à celui que le manifeste a
    // écrit ici.
    push(`// ${table} — page ${page}`);
    if (first) push(`[${RAW}]:`);
    first = false;
    push(`CROSSTABLE([sv_field], [sv_value], ${QUALIFIERS})`,
         'LOAD',
         `\t${subExpr},`,
         `\t${page} as [sv_page],`,
         `\t'${table}' as [sv_section],`,
         `\t${instExpr},`,
         `\t${codeExpr},`,
         `\t${gkeyExpr},`,
         ...cols.map((c, i) =>
           `\tIf(IsNull([${table}_${c}]), '', [${table}_${c}]) as [${c}]` +
           (i === cols.length - 1 ? '' : ',')),
         `RESIDENT [${table}];`,
         '');
    sections++;
  }

  // ── passe finale ────────────────────────────────────────────────────────
  push(
    '// Libellé de page, valeur numérique quand il y en a une, et état.',
    'PageTitleMap:',
    'MAPPING LOAD * INLINE [',
    '\tpage, title',
    ...Object.entries(PAGE_TITLES).map(([p, t]) => `\t${p}, ${p}. ${t}`),
    '];',
    '',
    '[submission_values]:',
    'LOAD',
    '\t[submission_id],',
    '\t[sv_page],',
    `\tApplyMap('PageTitleMap', [sv_page], [sv_page]) as [sv_page_label],`,
    '\t[sv_section],',
    '\t[sv_instance],',
    '\t[sv_code],',
    '\t[sv_field],',
    '\t// Un tiret, et non la chaîne vide. CROSSTABLE empile dans une seule',
    '\t// colonne les valeurs de trente-cinq tables ; elle finit interprétée',
    '\t// comme numérique, et une chaîne vide s\'y affiche « NaN » — ce que le',
    '\t// lecteur prendrait pour une erreur de calcul plutôt que pour une',
    '\t// réponse manquante. Le tiret est déduit du test de longueur, jamais',
    '\t// posé à la source : rien ne dépend de sa présence.',
    '\tIf(Len(Trim([sv_value])) = 0, \'—\', Text([sv_value])) as [sv_value],',
    '\tIf(IsNum([sv_value]), Num([sv_value])) as [sv_num],',
    '\tIf(Len(Trim([sv_value])) = 0, 0, 1) as [sv_filled],',
    '\t// Un champ vide est d\'abord un champ vide : le signaler comme hors',
    '\t// plage n\'aurait pas de sens, et masquerait la seule chose à faire,',
    '\t// qui est de retourner le demander à l\'opérateur.',
    '\tIf(Len(Trim([sv_value])) = 0, \'VIDE\',',
    '\t\tIf(Len([sv_gkey]) > 0 and [sv_field] = \'conc\'',
    `\t\t\tand Num([sv_value]) > ApplyMap('FenceMap', [sv_gkey], 1E15),`,
    '\t\t\t\'HORS PLAGE\', \'OK\')) as [sv_state]',
    `RESIDENT [${RAW}];`,
    '',
    `DROP TABLE [${RAW}];`,
    '');

  // Trace de contrôle. L'empilement des pivots repose sur la concaténation
  // automatique de Qlik, qui ne prévient pas quand elle ne s'applique pas :
  // une section resterait dans sa propre table et la table longue partirait
  // incomplète, sans la moindre erreur. Les deux nombres sont donc écrits
  // côte à côte dans le journal de rechargement.
  //
  // Un écart n'est pas forcément une panne : une section dont la table source
  // est vide — aucun opérateur n'a rien saisi — n'apporte aucune ligne et ne
  // compte donc pas. C'est le cas de raw_material_specify dans le jeu de
  // démonstration. L'écart mérite un coup d'œil, pas une alerte.
  push(
    'SvSectionCheck:',
    'LOAD Count(DISTINCT [sv_section]) as [n] RESIDENT [submission_values];',
    `LET vSvExpected = ${sections};`,
    "LET vSvLoaded = Peek('n', 0, 'SvSectionCheck');",
    'DROP TABLE SvSectionCheck;',
    'TRACE >>> submission_values : $(vSvLoaded) sections avec des lignes, ' +
      'sur $(vSvExpected) au manifeste (ecart = section vide a la source, ' +
      'ou concatenation manquee);',
    '');

  writeFile('98_submission_values.txt', lines.join('\n') + '\n');
}

// ── fichier d'assemblage ─────────────────────────────────────────────────
{
  const pageFiles = Object.keys(byPage).map(Number).sort((a, b) => a - b)
    .map(p => `page_${String(p).padStart(2, '0')}_${PAGE_SLUGS[p]}.txt`);
  const lines = [
    header('Assemblage — à coller dans un onglet du Data Load Editor', [
      'Chaque .txt doit d\'abord exister dans « Fichiers de données » de',
      `l'espace ${SPACE} : c'est la bibliothèque ${DATA_FILES_LIB} ci-dessous.`,
      'Le chemin est qualifié par l\'espace. « lib://DataFiles/… » ne trouve',
      'rien depuis cette application, ce qui est vérifiable par FileList().',
      '',
      'Must_Include et non Include : un Include dont le chemin est faux ne',
      'produit AUCUNE erreur. Le rechargement se termine alors sur un',
      '« succès » ayant lu zéro ligne, et l\'application paraît simplement',
      'vide. Must_Include échoue franchement, ce qui est le seul',
      'comportement acceptable pour quinze fichiers dont tout dépend.',
    ]),
    `$(Must_Include=${DATA_FILES_LIB}/00_core.txt);`,
    `$(Must_Include=${DATA_FILES_LIB}/01_ref_lists.txt);`,
    `$(Must_Include=${DATA_FILES_LIB}/02_whatif.txt);`,
    ...pageFiles.map(f => `$(Must_Include=${DATA_FILES_LIB}/${f});`),
    '',
    '// En dernier : tout y est du RESIDENT sur les tables ci-dessus.',
    `$(Must_Include=${DATA_FILES_LIB}/98_submission_values.txt);`,
  ];
  writeFile('99_main.txt', lines.join('\n') + '\n');
}

console.log(`\nTerminé : ${Object.keys(byPage).length + 3} fichiers dans qlik/load-script/`);
