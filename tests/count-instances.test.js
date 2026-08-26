'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { countInstances } = require('../docs/db.js');

// Entree factice : une section repetable SANS countField, donc sondee.
// Plusieurs entrees du manifeste complet sont dans ce cas — products,
// resins, hardeners, combustion_unit_outputs — et cette branche n'etait
// exercee par aucun test avant celui-ci.
const PROBED = {
  kind: 'many', page: 99, pattern: 'thing_{idx}_{col}',
  cols: { a: 'text', b: 'num' },
};

const COUNTED = Object.assign({}, PROBED, { countField: 'thing_count' });

test('le sondage compte les instances consecutives', () => {
  assert.strictEqual(countInstances({}, PROBED), 0);
  assert.strictEqual(countInstances({ thing_1_a: 'x' }, PROBED), 1);
  assert.strictEqual(countInstances({ thing_1_a: 'x', thing_2_b: '3' }, PROBED), 2);
});

test('le sondage s’arrete au premier indice absent', () => {
  // L'interface renumerote les instances a la suppression : il n'y a pas de
  // trous. Une instance isolee au-dela d'un trou est donc inatteignable.
  assert.strictEqual(countInstances({ thing_1_a: 'x', thing_3_a: 'y' }, PROBED), 1);
});

test('le sondage compte une instance vide mais presente', () => {
  // Une chaine vide est une cle presente : l'operateur a ajoute l'instance
  // sans encore la remplir, et elle doit survivre au rechargement.
  assert.strictEqual(countInstances({ thing_1_a: '' }, PROBED), 1);
});

test('le compteur declare prime sur le sondage', () => {
  assert.strictEqual(
    countInstances({ thing_count: '1', thing_1_a: 'x', thing_2_a: 'y' }, COUNTED), 1);
});

test('un compteur illisible retombe sur le sondage', () => {
  for (const bad of ['', 'abc', '-1', undefined]) {
    assert.strictEqual(
      countInstances({ thing_count: bad, thing_1_a: 'x' }, COUNTED), 1,
      `compteur ${JSON.stringify(bad)}`);
  }
});

test('le compteur declare est plafonne a PROBE_CAP', () => {
  assert.strictEqual(countInstances({ thing_count: '5000' }, COUNTED), 500);
});
