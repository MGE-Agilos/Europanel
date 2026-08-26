'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dispatch, hydrate } = require('../docs/db.js');

function opFor(ops, table) {
  return ops.find(o => o.table === table);
}

test('dispatch produit une ligne par instance répétable', () => {
  const flat = {
    dryer_count: '2',
    dryer_1_main_type: 'single', dryer_1_temp_max: '180',
    dryer_2_main_type: 'three',  dryer_2_temp_max: '210',
  };
  const rows = opFor(dispatch(flat, 5), 'dryers').rows;

  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].idx, 1);
  assert.strictEqual(rows[0].temp_max, 180);
  assert.strictEqual(rows[1].idx, 2);
  assert.strictEqual(rows[1].main_type, 'three');
});

test('dispatch signale les instances à supprimer au-delà du compte', () => {
  const flat = { dryer_count: '1', dryer_1_main_type: 'single' };
  const op = opFor(dispatch(flat, 5), 'dryers');

  assert.strictEqual(op.rows.length, 1);
  assert.strictEqual(op.deleteBeyondIdx, 1);
});

test('le compteur declare prime sur les cles residuelles', () => {
  // Une instance supprimee par l'operateur peut laisser ses cles dans la
  // carte plate : le compteur fait foi, sans quoi on la ressusciterait.
  const flat = {
    dryer_count: '1',
    dryer_1_main_type: 'single',
    dryer_2_main_type: 'orphelin',
  };
  const rows = opFor(dispatch(flat, 5), 'dryers').rows;
  assert.strictEqual(rows.length, 1);
});

test('aller-retour sur une section répétable', () => {
  const flat = {
    dryer_count: '2',
    dryer_1_main_type: 'single', dryer_1_temp_max: '180', dryer_1_residence_unit: 'min',
    dryer_2_main_type: 'three',  dryer_2_temp_max: '210', dryer_2_residence_unit: 'sec',
  };
  const ops = dispatch(flat, 5);
  const rowsByTable = {};
  ops.forEach(o => { rowsByTable[o.table] = o.rows; });
  const back = hydrate(rowsByTable, 5);

  assert.strictEqual(back.dryer_1_main_type, 'single');
  assert.strictEqual(Number(back.dryer_2_temp_max), 210);
  assert.strictEqual(back.dryer_2_residence_unit, 'sec');
});

test('le compteur est reconstruit depuis les lignes, pas depuis une colonne', () => {
  const { hydrate } = require('../docs/db.js');
  const rows = {
    press_dryer_section: [{ comments: '' }],
    dryers: [{ idx: 1, main_type: 'single' }, { idx: 2, main_type: 'three' }],
  };
  assert.strictEqual(hydrate(rows, 5).dryer_count, '2');
});
