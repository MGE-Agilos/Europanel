'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dispatch, hydrate } = require('../docs/db.js');

function opFor(ops, table) {
  return ops.find(o => o.table === table);
}

test('dispatch produit une ligne par code renseigné, et seulement ceux-là', () => {
  const flat = {
    rm_roundwood_specify: 'oui', rm_roundwood_species: 'épicéa',
    rm_sawdust_specify: 'non',
  };
  const rows = opFor(dispatch(flat, 3), 'raw_materials').rows;

  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows.map(r => r.code).sort(), ['roundwood', 'sawdust']);
});

test('dispatch résout correctement un code contenant des soulignés', () => {
  const flat = { rm_ext_prod_res_specify: 'valeur' };
  const rows = opFor(dispatch(flat, 3), 'raw_materials').rows;

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].code, 'ext_prod_res');
  assert.strictEqual(rows[0].specify, 'valeur');
});

test('aller-retour sur un groupe à clés fixes', () => {
  const flat = {
    rm_ext_prod_res_specify: 'valeur',
    rm_roundwood_species: 'épicéa',
  };
  const ops = dispatch(flat, 3);
  const rowsByTable = {};
  ops.forEach(o => { rowsByTable[o.table] = o.rows; });
  const back = hydrate(rowsByTable, 3);

  assert.strictEqual(back.rm_ext_prod_res_specify, 'valeur');
  assert.strictEqual(back.rm_roundwood_species, 'épicéa');
});
