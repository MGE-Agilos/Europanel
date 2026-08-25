/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Générateur du DDL relationnel et des politiques RLS.

   Usage : node tools/gen_schema.mjs > supabase/migrations/002_relational_schema.sql

   Pourquoi générer plutôt qu'écrire ? Les 35 tables du questionnaire et
   leurs 140 politiques suivent toutes le même moule ; recopié à la main,
   ce moule finit par diverger d'une table à l'autre sans que personne ne
   le remarque. Le manifeste (docs/fields.js) porte déjà tous les faits
   nécessaires, et il alimente aussi le dictionnaire de données livré au
   client. Une seule source, deux artefacts : le SQL ne peut pas mentir
   sur ce que le formulaire collecte.

   Le fichier produit est relu puis commité comme artefact. Ne pas le
   modifier à la main : corriger le manifeste ou ce générateur, puis
   régénérer.
   ══════════════════════════════════════════════════════════════════════ */
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { SCHEMA, LISTS } = require('../docs/fields.js');

const SQL_TYPE = { text: 'TEXT', num: 'NUMERIC', int: 'SMALLINT', bool: 'BOOLEAN' };

/* ── Note sur les alias ───────────────────────────────────────────────
   `aliases` ne concerne QUE les noms de champs HTML. Il associe une
   colonne au segment de nom de champ que le renderer émet — par exemple
   la colonne `limit_val` au segment `limit` de `ep_1_poll_pm_limit`, ou
   la colonne `point_ref` au segment `id` de `ep_1_id`.

   Le nom de colonne SQL est TOUJOURS la clé de `cols`, jamais l'alias.
   C'est la raison d'être des alias : `limit` et `desc` sont des mots
   réservés PostgreSQL, et `id` est déjà pris par la clé primaire de
   substitution. Émettre l'alias comme nom de colonne réintroduirait
   exactement les collisions que les alias existent pour éviter.

   C'est le genre de détail qu'un lecteur pressé « corrige » six mois
   plus tard en croyant réparer une incohérence. Il n'y en a pas.
   ────────────────────────────────────────────────────────────────────── */
function columnNames(entry) {
  return Object.keys(entry.cols);
}

/* ── Parenté ──────────────────────────────────────────────────────────── */

// Colonne portant le rattachement : la soumission, ou la table parente.
function parentColumn(entry) {
  return entry.parent ? `${entry.parent}_id` : 'submission_id';
}

// Prédicat RLS : remonte la chaîne de parenté jusqu'à submissions.user_id.
// Une table 1:1 ou un enfant de premier niveau filtre sur submission_id ;
// un enfant imbriqué filtre sur son parent, lui-même filtré, récursivement.
function ownerPredicate(table) {
  const entry = SCHEMA[table];
  if (!entry) throw new Error(`ownerPredicate: table inconnue « ${table} »`);
  if (!entry.parent) {
    return 'submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())';
  }
  return `${entry.parent}_id IN (SELECT id FROM europanel.${entry.parent} WHERE ` +
         `${ownerPredicate(entry.parent)})`;
}

/* ── DDL d'une table ──────────────────────────────────────────────────── */

function tableDdl(table, entry) {
  // [nom, définition] ; les contraintes de table sont poussées à la fin.
  const cols = [];
  const constraints = [];

  if (entry.kind === 'one') {
    cols.push(['submission_id',
      'BIGINT PRIMARY KEY REFERENCES europanel.submissions(id) ON DELETE CASCADE']);
  } else {
    cols.push(['id', 'BIGSERIAL PRIMARY KEY']);
    if (entry.parent) {
      if (!SCHEMA[entry.parent]) {
        throw new Error(`${table}: parent « ${entry.parent} » absent du manifeste`);
      }
      cols.push([`${entry.parent}_id`,
        `BIGINT NOT NULL REFERENCES europanel.${entry.parent}(id) ON DELETE CASCADE`]);
    } else {
      cols.push(['submission_id',
        'BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE']);
    }
    if (entry.kind === 'many') cols.push(['idx', 'SMALLINT NOT NULL']);
    if (entry.kind === 'keyed') {
      cols.push(['code', 'TEXT NOT NULL']);
      if (!entry.list) throw new Error(`${table}: entrée 'keyed' sans « list »`);
      if (!LISTS[entry.list]) throw new Error(`${table}: liste « ${entry.list} » inconnue`);
      // Colonne constante générée : elle fige la liste de rattachement de la
      // table et permet une clé étrangère composite vers ref_lists, donc une
      // révision BREF ajoute un polluant par INSERT et non par migration.
      // PostgreSQL accepte une expression de génération constante, et une
      // clé étrangère portant une colonne générée tant que l'action
      // référentielle reste NO ACTION — ce qui est le cas ici.
      cols.push(['list_code', `TEXT GENERATED ALWAYS AS ('${entry.list}') STORED`]);
    }
  }

  // Les colonnes du questionnaire, dans l'ordre du manifeste, sous leur nom
  // de colonne (jamais sous leur alias : voir la note en tête de fichier).
  for (const col of columnNames(entry)) {
    const type = entry.cols[col];
    if (!SQL_TYPE[type]) throw new Error(`${table}.${col}: type inconnu « ${type} »`);
    cols.push([col, SQL_TYPE[type]]);
  }

  // Colonne technique, pas un champ du questionnaire (spec § 3) : maintenue
  // par le trigger émis dans triggerDdl, jamais par le manifeste.
  cols.push(['updated_at', 'TIMESTAMPTZ NOT NULL DEFAULT NOW()']);

  if (entry.kind !== 'one') {
    const keyCol = entry.kind === 'many' ? 'idx' : 'code';
    constraints.push(`UNIQUE (${parentColumn(entry)}, ${keyCol})`);
  }
  if (entry.kind === 'keyed') {
    constraints.push(
      'FOREIGN KEY (list_code, code) REFERENCES europanel.ref_lists (list_code, code)');
  }

  const pad = Math.max(...cols.map(([n]) => n.length));
  const lines = cols.map(([n, d]) => `  ${n.padEnd(pad)}  ${d}`).concat(
    constraints.map(c => `  ${c}`));

  return `CREATE TABLE IF NOT EXISTS europanel.${table} (\n${lines.join(',\n')}\n);`;
}

// Index sur la colonne de rattachement de chaque table enfant.
// Les tables 1:1 n'en ont pas besoin : submission_id y est la clé primaire,
// donc déjà indexée.
function indexDdl(table, entry) {
  if (entry.kind === 'one') return null;
  const col = parentColumn(entry);
  return `CREATE INDEX IF NOT EXISTS idx_ep_${table}_${col}\n` +
         `  ON europanel.${table}(${col});`;
}

/* ── Horodatage ───────────────────────────────────────────────────────────
   updated_at (spec § 3) est maintenue par un trigger, pas par l'appelant :
   réutilise europanel.set_updated_at(), défini une fois dans 001_schema.sql.
   002 ne la redéfinit pas — 001 est un prérequis documenté en tête de ce
   fichier, donc la fonction existe déjà quand 002 s'applique — pour éviter
   deux définitions de la même fonction qui pourraient un jour diverger.
   ────────────────────────────────────────────────────────────────────────── */
function triggerDdl(table) {
  return `DROP TRIGGER IF EXISTS trg_${table}_updated_at ON europanel.${table};\n` +
         `CREATE TRIGGER trg_${table}_updated_at\n` +
         `  BEFORE UPDATE ON europanel.${table}\n` +
         '  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();';
}

/* ── Privilèges ───────────────────────────────────────────────────────────
   001_schema.sql accorde l'accès via ALTER DEFAULT PRIVILEGES, qui ne vaut
   que pour les tables créées ensuite PAR LE MÊME RÔLE. Si 002 est appliqué
   sous un rôle différent — un accident plausible quand une migration passe
   par l'éditeur SQL de Supabase et l'autre par la CLI — les tables créées
   ici n'héritent d'aucun privilège, et les politiques RLS qui suivent
   portent sur des tables qu'authenticated ne peut même pas lire : chaque
   requête échoue par erreur de permission plutôt que de renvoyer un
   ensemble vide. D'où des GRANT explicites, table par table, plutôt que de
   compter sur l'héritage.
   ────────────────────────────────────────────────────────────────────────── */
function grantsDdl(table) {
  return [
    `GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.${table} TO authenticated;`,
    `GRANT ALL ON europanel.${table} TO service_role;`,
  ].join('\n');
}

/* ── Politiques RLS ───────────────────────────────────────────────────── */

function policiesDdl(table, entry) {
  const pred = ownerPredicate(table);
  const out = [`ALTER TABLE europanel.${table} ENABLE ROW LEVEL SECURITY;`];
  for (const op of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    const clause = op === 'INSERT' ? `WITH CHECK (${pred})` : `USING (${pred})`;
    out.push(
      `CREATE POLICY "ep_${table}_${op.toLowerCase()}" ON europanel.${table}\n` +
      `  FOR ${op} TO authenticated ${clause};`);
  }
  return out.join('\n');
}

/* ── Noyau : écrit à la main ──────────────────────────────────────────────
   Ces tables ne portent aucun champ de questionnaire, donc le manifeste ne
   les décrit pas et le générateur ne peut pas les déduire. Elles sont
   reproduites ici littéralement pour que la régénération du fichier ne les
   efface pas — c'est la seule partie du fichier produit qui soit écrite à
   la main, et elle est balisée comme telle dans la sortie.

   Elles viennent EN TÊTE parce que les tables 'keyed' générées portent une
   clé étrangère vers ref_lists : la référencée doit exister d'abord.
   ────────────────────────────────────────────────────────────────────── */
const CORE_SQL = `
-- ══════════════════════════════════════════════════════════════════════
-- ▼▼▼ SECTION ÉCRITE À LA MAIN — début ▼▼▼
--
-- Tables du noyau (spec § 4.1). Elles ne portent aucun champ du
-- questionnaire : le manifeste ne les décrit pas et le générateur ne les
-- déduit pas. Elles sont maintenues à la main dans tools/gen_schema.mjs
-- (constante CORE_SQL) et réémises à chaque régénération.
--
-- Placées avant les tables générées : celles-ci référencent ref_lists.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS europanel.plants (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT REFERENCES europanel.companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  country     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS europanel.cycles (
  id             BIGSERIAL PRIMARY KEY,
  label          TEXT NOT NULL,
  reference_year SMALLINT,
  opens_at       DATE,
  closes_at      DATE,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','open','closed','archived')),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS europanel.ref_lists (
  list_code   TEXT     NOT NULL,
  code        TEXT     NOT NULL,
  label       TEXT     NOT NULL,
  unit        TEXT,
  sort_order  SMALLINT NOT NULL DEFAULT 0,
  active      BOOLEAN  NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (list_code, code)
);

-- Successeure de page_data : porte l'avancement et la charge brute.
-- \`raw\` est la carte plate telle que collectFormData l'a produite. Elle n'est
-- pas relue en fonctionnement normal, mais elle rend les tables metier
-- regenerables : une colonne oubliee puis ajoutee au manifeste se rattrape en
-- rejouant dispatch() sur l'historique, sans rien redemander aux entreprises.
CREATE TABLE IF NOT EXISTS europanel.submission_pages (
  submission_id BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  page_id       SMALLINT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'empty'
                CHECK (status IN ('empty','partial','complete')),
  raw           JSONB NOT NULL DEFAULT '{}',
  saved_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (submission_id, page_id)
);

CREATE TABLE IF NOT EXISTS europanel.audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor_id      UUID,
  action        TEXT NOT NULL,
  table_name    TEXT,
  record_id     BIGINT,
  field_name    TEXT,
  value_before  TEXT,
  value_after   TEXT,
  submission_id BIGINT REFERENCES europanel.submissions(id) ON DELETE SET NULL,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE europanel.submissions ADD COLUMN IF NOT EXISTS plant_id BIGINT
  REFERENCES europanel.plants(id);
ALTER TABLE europanel.submissions ADD COLUMN IF NOT EXISTS cycle_id BIGINT
  REFERENCES europanel.cycles(id);

CREATE INDEX IF NOT EXISTS idx_ep_plants_company
  ON europanel.plants(company_id);
CREATE INDEX IF NOT EXISTS idx_ep_submission_pages_sub
  ON europanel.submission_pages(submission_id);
CREATE INDEX IF NOT EXISTS idx_ep_audit_log_sub
  ON europanel.audit_log(submission_id);

-- ─── Horodatage du noyau ──────────────────────────────────────────────
-- Même trigger que les tables générées (voir triggerDdl) : réutilise
-- europanel.set_updated_at(), défini dans 001_schema.sql, sans le
-- redéfinir.
DROP TRIGGER IF EXISTS trg_plants_updated_at ON europanel.plants;
CREATE TRIGGER trg_plants_updated_at
  BEFORE UPDATE ON europanel.plants
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

DROP TRIGGER IF EXISTS trg_cycles_updated_at ON europanel.cycles;
CREATE TRIGGER trg_cycles_updated_at
  BEFORE UPDATE ON europanel.cycles
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

DROP TRIGGER IF EXISTS trg_ref_lists_updated_at ON europanel.ref_lists;
CREATE TRIGGER trg_ref_lists_updated_at
  BEFORE UPDATE ON europanel.ref_lists
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

DROP TRIGGER IF EXISTS trg_submission_pages_updated_at ON europanel.submission_pages;
CREATE TRIGGER trg_submission_pages_updated_at
  BEFORE UPDATE ON europanel.submission_pages
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

DROP TRIGGER IF EXISTS trg_audit_log_updated_at ON europanel.audit_log;
CREATE TRIGGER trg_audit_log_updated_at
  BEFORE UPDATE ON europanel.audit_log
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

-- ─── RLS du noyau ─────────────────────────────────────────────────────
ALTER TABLE europanel.plants            ENABLE ROW LEVEL SECURITY;
ALTER TABLE europanel.cycles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE europanel.ref_lists         ENABLE ROW LEVEL SECURITY;
ALTER TABLE europanel.submission_pages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE europanel.audit_log         ENABLE ROW LEVEL SECURITY;

-- Referentiels : lecture pour tout utilisateur authentifie, ecriture
-- reservee au service_role. Aucune politique d'ecriture n'est declaree :
-- sous Supabase, service_role porte BYPASSRLS et ecrit malgre RLS, tandis
-- que authenticated, faute de politique, ne peut ni inserer ni modifier.
CREATE POLICY "ep_ref_lists_select" ON europanel.ref_lists
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ep_plants_select" ON europanel.plants
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ep_cycles_select" ON europanel.cycles
  FOR SELECT TO authenticated USING (true);

-- Pages de soumission : portee a la soumission proprietaire, toutes
-- operations. FOR ALL applique USING aux lectures et aux ecritures ;
-- WITH CHECK est repete explicitement pour que l'INSERT soit lisible.
CREATE POLICY "ep_submission_pages_all" ON europanel.submission_pages
  FOR ALL TO authenticated
  USING (
    submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())
  )
  WITH CHECK (
    submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())
  );

-- Journal append-only : insertion seule. Aucune politique UPDATE ni DELETE
-- n'est declaree, donc aucune des deux n'est possible pour authenticated.
CREATE POLICY "ep_audit_log_insert" ON europanel.audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- ─── Privilèges du noyau ──────────────────────────────────────────────
-- Même motif que pour les tables générées (voir grantsDdl) : des GRANT
-- explicites, indépendants de l'héritage par rôle d'ALTER DEFAULT
-- PRIVILEGES. Référentiels en lecture seule pour authenticated ; journal
-- en lecture + insertion seule, pour rester append-only au niveau des
-- privilèges et non seulement au niveau des politiques.
GRANT SELECT ON europanel.ref_lists TO authenticated;
GRANT ALL ON europanel.ref_lists TO service_role;

GRANT SELECT ON europanel.plants TO authenticated;
GRANT ALL ON europanel.plants TO service_role;

GRANT SELECT ON europanel.cycles TO authenticated;
GRANT ALL ON europanel.cycles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.submission_pages TO authenticated;
GRANT ALL ON europanel.submission_pages TO service_role;

GRANT SELECT, INSERT ON europanel.audit_log TO authenticated;
GRANT ALL ON europanel.audit_log TO service_role;

-- ▲▲▲ SECTION ÉCRITE À LA MAIN — fin ▲▲▲
`;

/* ── Assemblage ───────────────────────────────────────────────────────── */

// Les tables sont émises dans l'ordre du manifeste. Cet ordre place déjà
// chaque parent avant ses enfants ; on le vérifie plutôt que de trier, pour
// garder chaque enfant à côté de son parent dans le fichier livré. Si le
// manifeste venait à être réordonné, la génération échoue bruyamment au
// lieu de produire un fichier qui ne s'applique pas.
function assertParentsFirst() {
  const seen = new Set();
  for (const [table, entry] of Object.entries(SCHEMA)) {
    if (entry.parent && !seen.has(entry.parent)) {
      throw new Error(
        `Ordre du manifeste : « ${table} » précède son parent « ${entry.parent} ». ` +
        'Déplacer le parent avant l\'enfant dans docs/fields.js.');
    }
    seen.add(table);
  }
}

export function buildDdl() {
  assertParentsFirst();

  const parts = [
    '-- ══════════════════════════════════════════════════════════════════════',
    '--  EuroPanel — Schéma relationnel du questionnaire WBP BREF',
    '--  Supabase / PostgreSQL  ·  Schema: europanel',
    '--',
    '--  GÉNÉRÉ par tools/gen_schema.mjs depuis docs/fields.js.',
    '--  NE PAS MODIFIER À LA MAIN : corriger le manifeste ou le générateur,',
    '--  puis régénérer :',
    '--    node tools/gen_schema.mjs > supabase/migrations/002_relational_schema.sql',
    '--',
    '--  Prérequis : 001_schema.sql (schéma europanel, companies, submissions,',
    '--  et les ALTER DEFAULT PRIVILEGES qui accordent l\'accès aux tables',
    '--  créées ensuite dans ce schéma).',
    '-- ══════════════════════════════════════════════════════════════════════',
    CORE_SQL,
    '',
    '-- ══════════════════════════════════════════════════════════════════════',
    '--  Tables du questionnaire (générées depuis le manifeste)',
    '-- ══════════════════════════════════════════════════════════════════════',
    '',
  ];

  for (const [table, entry] of Object.entries(SCHEMA)) {
    const kindLabel = entry.kind === 'one' ? '1:1 avec la soumission'
      : entry.kind === 'many' ? 'section répétable (idx)'
        : `groupe à clés (code, liste « ${entry.list} »)`;
    const parentLabel = entry.parent ? `, enfant de ${entry.parent}` : '';
    parts.push(
      `-- ─── ${table} — page ${entry.page}, ${kindLabel}${parentLabel} ` +
        '─'.repeat(Math.max(3, 66 - table.length - kindLabel.length - parentLabel.length)),
      tableDdl(table, entry));
    const idx = indexDdl(table, entry);
    if (idx) parts.push(idx);
    parts.push('', triggerDdl(table), '', grantsDdl(table), '', policiesDdl(table, entry), '');
  }

  parts.push(
    '-- ══════════════════════════════════════════════════════════════════════',
    '--  Privilèges sur les séquences (BIGSERIAL) : sans ce GRANT, un INSERT',
    '--  par authenticated échoue à l\'obtention de la valeur suivante, même',
    '--  si la table elle-même lui est accessible.',
    '-- ══════════════════════════════════════════════════════════════════════',
    'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA europanel TO authenticated, service_role;',
    '');

  return parts.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(buildDdl());
}
