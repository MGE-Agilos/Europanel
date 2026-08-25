'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { SCHEMA } = require('../docs/fields.js');

test('contacts est déclaré comme table 1:1 de la page 0', () => {
  const e = SCHEMA.contacts;
  assert.strictEqual(e.kind, 'one');
  assert.strictEqual(e.page, 0);
});

test('contacts déclare les 17 colonnes de la page 0', () => {
  const cols = Object.keys(SCHEMA.contacts.cols);
  assert.strictEqual(cols.length, 17);
  assert.ok(cols.includes('contact_email'));
  assert.ok(cols.includes('twg_ngo_telephone'));
});

test('toute entrée du manifeste déclare kind, page et cols', () => {
  for (const [name, e] of Object.entries(SCHEMA)) {
    assert.ok(['one', 'many', 'keyed'].includes(e.kind), `${name}: kind invalide`);
    assert.strictEqual(typeof e.page, 'number', `${name}: page manquante`);
    assert.ok(Object.keys(e.cols).length > 0, `${name}: cols vide`);
  }
});
