'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { SCHEMA, LISTS } = require('../docs/fields.js');
const { buildName, fieldSegment } = require('../docs/db.js');

// Verite terrain : on execute les renderers et on lit les champs qu'ils
// emettent reellement, via tools/extract_fields.mjs.
//
// Ne jamais revenir a un balayage du texte source. Les renderers construisent
// une partie de leurs champs par litteral de gabarit et une autre a travers
// des fonctions auxiliaires qui ecrivent l'attribut name a l'interieur du
// helper. Une expression reguliere sur le source ne voit pas la seconde
// categorie : c'est ainsi que seize colonnes ont manque a l'inventaire.
let SHAPES_BY_PAGE;
test.before(async () => {
  const mod = await import('../tools/extract_fields.mjs');
  SHAPES_BY_PAGE = mod.fieldNamesByPage();
});

// ── Rapprochement des formes ────────────────────────────────────────────
//
// La verite terrain sort avec ses indices litteraux (dryer_1_temp_max), tandis
// que le manifeste, index-agnostique, produit dryer_{}_temp_max. Le
// rapprochement se fait ici, et dans ce sens uniquement : chaque forme du
// manifeste devient une expression reguliere ancree ou {} vaut \d+.
//
// Le sens inverse — normaliser les indices de la verite terrain — serait plus
// simple et serait faux. Il confondrait des noms distincts qui se terminent par
// un chiffre : other_1, other_2 et other_3 page 8, output_1 a output_5 page 4.
// Le test cesserait alors de voir qu'une colonne manque parmi eux, ce qui est
// exactement le defaut qu'il existe pour attraper.
//
// Mais un \d+ non lie ouvre une autre faille, plus sournoise que celle qu'il
// resout : il suffit qu'UN SEUL indice satisfasse le motif pour que le test
// « chaque colonne declaree correspond a un champ reellement emis » se taise
// sur tous les autres. Si le renderer emettait cu_1_thermal_input mais pas
// cu_2_thermal_input (une colonne oubliee a partir de la deuxieme unite), la
// forme cu_{}_thermal_input matcherait quand meme via cu_1_thermal_input, et
// l'absence a l'indice 2 resterait invisible. D'ou la liaison ci-dessous :
// pour chaque entree du manifeste, on determine les indices REELLEMENT
// presents dans la verite terrain (via une colonne quelconque de cette
// entree, jamais fournis par le manifeste lui-meme), puis on construit le
// nom exact attendu a CHAQUE indice pour CHAQUE colonne, et on compare des
// chaines exactes — plus aucun \d+ ne masque un trou ponctuel.

// Expression reguliere qui isole, dans la verite terrain, la valeur du seul
// jeton `token` (idx ou parent_idx) d'un motif — tous les autres jetons etant
// remplaces par leur valeur connue (`parts`). Sert a decouvrir quels indices
// concrets une entree utilise reellement, a partir d'une de ses colonnes.
function patternToIndexRegExp(pattern, token, parts) {
  const PLACEHOLDER = '';
  const literal = pattern.replace(/\{(idx|parent_idx|code|col)\}/g,
    (_, t) => (t === token ? PLACEHOLDER : String(parts[t])));
  const escaped = literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + escaped.replace(PLACEHOLDER, '(\\d+)') + '$');
}

// Indices concrets (idx ou parent_idx) qu'une entree utilise reellement sur
// une page, d'apres la verite terrain — jamais d'apres une valeur par defaut
// du manifeste. On les cherche via TOUTES les colonnes de l'entree (et tous
// les codes, si l'entree est a cles) : c'est ce qui permet de detecter
// qu'une colonne precise manque a un indice ou les autres colonnes de la
// meme entree sont bien presentes.
function presentIndices(pageShapes, entry, token, codes) {
  const found = new Set();
  for (const col of Object.keys(entry.cols)) {
    for (const code of codes) {
      const parts = { col: fieldSegment(entry, col) };
      if (code !== null) parts.code = code;
      const re = patternToIndexRegExp(entry.pattern, token, parts);
      for (const sh of pageShapes) {
        const m = re.exec(sh);
        if (m) found.add(m[1]);
      }
    }
  }
  return [...found];
}

// Noms de champs EXACTS (indices lies, aucun \d+) que le manifeste attend
// pour une page donnee, d'apres les indices reellement observes dans la
// verite terrain de cette meme page.
function manifestExactNames(pageId, pageShapes) {
  const names = new Set();
  for (const entry of Object.values(SCHEMA)) {
    if (entry.page !== pageId) continue;
    if (entry.kind === 'one') {
      Object.keys(entry.cols).forEach(c => names.add(c));
      continue;
    }
    if (entry.countField) names.add(entry.countField);

    const codes = entry.kind === 'keyed' ? LISTS[entry.list] : [null];
    const token = entry.pattern.includes('{idx}') ? 'idx'
                : entry.pattern.includes('{parent_idx}') ? 'parent_idx'
                : null;
    const idxValues = token ? presentIndices(pageShapes, entry, token, codes) : [null];

    for (const idxVal of idxValues) {
      for (const code of codes) {
        for (const col of Object.keys(entry.cols)) {
          const parts = { col: fieldSegment(entry, col) };
          if (code !== null) parts.code = code;
          if (token) parts[token] = idxVal;
          names.add(buildName(entry.pattern, parts));
        }
      }
    }
  }
  return names;
}

test('chaque champ emis par le questionnaire a une colonne declaree', () => {
  const missing = [];
  for (const [page, shapes] of Object.entries(SHAPES_BY_PAGE)) {
    const known = manifestExactNames(Number(page), shapes);
    shapes.filter(sh => !known.has(sh))
      .forEach(sh => missing.push(`p${page}:${sh}`));
  }
  assert.deepStrictEqual(missing, [],
    `${missing.length} champ(s) sans colonne : ` + missing.join(', '));
});

test('chaque colonne declaree correspond a un champ reellement emis', () => {
  // Le sens inverse, et le plus insidieux : une colonne que le formulaire
  // n'emet jamais ne sera ni ecrite ni relue, sans erreur ni avertissement.
  // Comme les indices sont lies (voir plus haut), ceci detecte aussi bien
  // une colonne jamais emise qu'une colonne emise a certains indices
  // seulement.
  const orphans = [];
  for (const [page, shapes] of Object.entries(SHAPES_BY_PAGE)) {
    const shapeSet = new Set(shapes);
    for (const name of manifestExactNames(Number(page), shapes)) {
      if (!shapeSet.has(name)) orphans.push(`p${page}:${name}`);
    }
  }
  assert.deepStrictEqual(orphans, [],
    `${orphans.length} colonne(s) sans champ : ` + orphans.join(', '));
});

test('toute entree a cles reference une liste existante', () => {
  for (const [name, e] of Object.entries(SCHEMA)) {
    if (e.kind !== 'keyed') continue;
    assert.ok(Array.isArray(LISTS[e.list]) && LISTS[e.list].length,
      `${name}: liste « ${e.list} » absente ou vide`);
  }
});

test('toute entree a parent reference une table existante', () => {
  for (const [name, e] of Object.entries(SCHEMA)) {
    if (!e.parent) continue;
    assert.ok(SCHEMA[e.parent], `${name}: parent « ${e.parent} » absent`);
  }
});

test('toute page declaree existe reellement', () => {
  // Le questionnaire compte 13 pages, 0 a 12. La page 12 est un recapitulatif
  // sans champ. Sans cette borne, une page mal tapee passerait inapercue et
  // ses donnees ne seraient jamais ni ecrites ni relues.
  for (const [name, e] of Object.entries(SCHEMA)) {
    assert.ok(Number.isInteger(e.page) && e.page >= 0 && e.page <= 11,
      `${name}: page ${e.page} hors de la plage 0-11`);
  }
});

test('aucune colonne ne porte un mot reserve SQL ni un nom technique', () => {
  const reserved = new Set(['limit', 'order', 'group', 'user', 'table', 'desc', 'asc',
                            'select', 'where', 'default', 'check', 'references',
                            'id', 'idx', 'code', 'submission_id']);
  for (const [name, e] of Object.entries(SCHEMA)) {
    for (const col of Object.keys(e.cols)) {
      assert.ok(!reserved.has(col),
        `${name}.${col} est reserve : declarer un alias`);
    }
  }
});
