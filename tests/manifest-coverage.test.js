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
  SHAPES_BY_PAGE = mod.shapesByPage();
});

// ── Rapprochement des formes ────────────────────────────────────────────
//
// toShape() de tools/extract_fields.mjs est cense remplacer les indices
// d'instance par {} ; sa regex /\b\d+\b/ ne se declenche jamais sur les noms
// de ce questionnaire, car « _ » est un caractere de mot : dans
// dryer_1_temp_max il n'existe aucune limite de mot autour du 1. La verite
// terrain sort donc avec ses indices litteraux (dryer_1_temp_max), tandis que
// le manifeste, index-agnostique, produit dryer_{}_temp_max. Comparer les deux
// ensembles tels quels serait insatisfiable pour toute section repetable.
//
// tools/ est hors perimetre ; on rapproche donc ici, et de la facon la plus
// precise possible : chaque forme du manifeste devient une expression reguliere
// ancree ou {} vaut \d+. On evite ainsi la normalisation inverse (ecraser tous
// les indices de la verite terrain), qui confondrait des codes distincts —
// other_1, other_2, other_3 page 8, output_1..output_5 page 4 — et rendrait le
// test aveugle a une colonne oubliee parmi eux.
function shapeToRegExp(shape) {
  const escaped = shape.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + escaped.replace(/\\\{\\\}/g, '(?:\\d+)') + '$');
}

// Formes de noms que le manifeste sait produire pour une page donnee,
// les indices d'instance etant representes par le jeton {}.
function manifestShapes(pageId) {
  const shapes = new Set();
  for (const entry of Object.values(SCHEMA)) {
    if (entry.page !== pageId) continue;
    if (entry.kind === 'one') {
      Object.keys(entry.cols).forEach(c => shapes.add(c));
      continue;
    }
    if (entry.countField) shapes.add(entry.countField);
    const codes = entry.kind === 'keyed' ? LISTS[entry.list] : [null];
    for (const code of codes) {
      for (const col of Object.keys(entry.cols)) {
        const parts = { col: fieldSegment(entry, col) };
        if (entry.pattern.includes('{idx}')) parts.idx = '{}';
        if (entry.pattern.includes('{parent_idx}')) parts.parent_idx = '{}';
        if (code !== null) parts.code = code;
        shapes.add(buildName(entry.pattern, parts));
      }
    }
  }
  return shapes;
}

test('chaque champ emis par le questionnaire a une colonne declaree', () => {
  const missing = [];
  for (const [page, shapes] of Object.entries(SHAPES_BY_PAGE)) {
    const known = [...manifestShapes(Number(page))].map(shapeToRegExp);
    shapes.filter(sh => !known.some(re => re.test(sh)))
      .forEach(sh => missing.push(`p${page}:${sh}`));
  }
  assert.deepStrictEqual(missing, [],
    `${missing.length} champ(s) sans colonne : ` + missing.join(', '));
});

test('chaque colonne declaree correspond a un champ reellement emis', () => {
  // Le sens inverse, et le plus insidieux : une colonne que le formulaire
  // n'emet jamais ne sera ni ecrite ni relue, sans erreur ni avertissement.
  const orphans = [];
  for (const [page, shapes] of Object.entries(SHAPES_BY_PAGE)) {
    for (const sh of manifestShapes(Number(page))) {
      const re = shapeToRegExp(sh);
      if (!shapes.some(real => re.test(real))) orphans.push(`p${page}:${sh}`);
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
