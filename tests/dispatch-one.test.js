'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dispatch, hydrate } = require('../docs/db.js');

test('dispatch produit une ligne unique pour une table 1:1', () => {
  const flat = { contact_name: 'Dupont', contact_email: 'a@b.eu', contact_company: '' };
  const ops = dispatch(flat, 0);

  assert.strictEqual(ops.length, 1);
  assert.strictEqual(ops[0].table, 'contacts');
  assert.strictEqual(ops[0].rows.length, 1);
  assert.strictEqual(ops[0].rows[0].contact_name, 'Dupont');
  assert.strictEqual(ops[0].rows[0].contact_company, null);
});

test('dispatch ignore les pages sans entrée de manifeste', () => {
  assert.deepStrictEqual(dispatch({ peu_importe: 'x' }, 12), []);
});

test('hydrate reconstruit la carte plate depuis les lignes', () => {
  const rows = { contacts: [{ contact_name: 'Dupont', contact_email: null }] };
  const flat = hydrate(rows, 0);

  assert.strictEqual(flat.contact_name, 'Dupont');
  assert.strictEqual(flat.contact_email, '');
});

test('aller-retour : hydrate(dispatch(m)) rend m pour une table 1:1', () => {
  const flat = { contact_name: 'Dupont', contact_email: 'a@b.eu' };
  const ops  = dispatch(flat, 0);
  const rows = { contacts: ops[0].rows };
  const back = hydrate(rows, 0);

  assert.strictEqual(back.contact_name, 'Dupont');
  assert.strictEqual(back.contact_email, 'a@b.eu');
});
