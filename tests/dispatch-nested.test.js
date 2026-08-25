'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dispatch, hydrate } = require('../docs/db.js');

function opFor(ops, table) {
  return ops.find(o => o.table === table);
}

test('dispatch rattache chaque polluant à son point d’émission', () => {
  const flat = {
    ep_count: '2',
    ep_1_id: 'EP-01', ep_2_id: 'EP-02',
    ep_1_poll_nox_conc: '120', ep_1_poll_pm_conc: '5',
    ep_2_poll_nox_conc: '95',
  };
  const rows = opFor(dispatch(flat, 7), 'emission_point_pollutants').rows;

  assert.strictEqual(rows.length, 3);
  const ep1 = rows.filter(r => r.parent_idx === 1);
  assert.strictEqual(ep1.length, 2);
  assert.strictEqual(rows.find(r => r.parent_idx === 2).conc, 95);
});

test('dispatch n’écrit pas de ligne pour un polluant non renseigné', () => {
  const flat = { ep_count: '1', ep_1_poll_nox_conc: '120' };
  const rows = opFor(dispatch(flat, 7), 'emission_point_pollutants').rows;

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].code, 'nox');
});

test('les tables enfants sont ordonnées après leur parent', () => {
  const ops = dispatch({ ep_count: '1', ep_1_poll_nox_conc: '1' }, 7);
  const iParent = ops.findIndex(o => o.table === 'emission_points');
  const iChild  = ops.findIndex(o => o.table === 'emission_point_pollutants');

  assert.ok(iParent < iChild, 'le parent doit précéder l’enfant');
});

test('l’alias point_ref lit bien le champ ep_N_id', () => {
  const rows = opFor(dispatch({ ep_count: '1', ep_1_id: 'EP-01' }, 7),
                     'emission_points').rows;
  assert.strictEqual(rows[0].point_ref, 'EP-01');
});

test('aller-retour sur une structure imbriquée', () => {
  const flat = {
    ep_count: '2',
    ep_1_id: 'EP-01', ep_1_o2: '11',
    ep_2_id: 'EP-02',
    ep_1_poll_nox_conc: '120', ep_1_poll_nox_method: 'EN 14792',
    ep_2_poll_pm_conc: '5',
  };
  const ops = dispatch(flat, 7);
  const rowsByTable = {};
  ops.forEach(o => { rowsByTable[o.table] = o.rows; });
  const back = hydrate(rowsByTable, 7);

  assert.strictEqual(back.ep_1_id, 'EP-01');
  assert.strictEqual(Number(back.ep_1_poll_nox_conc), 120);
  assert.strictEqual(back.ep_1_poll_nox_method, 'EN 14792');
  assert.strictEqual(Number(back.ep_2_poll_pm_conc), 5);
});
