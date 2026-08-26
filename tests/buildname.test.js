'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildName, fieldSegment } = require('../docs/db.js');

test('remplace {idx} et {col}', () => {
  assert.strictEqual(
    buildName('dryer_{idx}_{col}', { idx: 3, col: 'temp_max' }),
    'dryer_3_temp_max'
  );
});

test('remplace {code} et {col}', () => {
  assert.strictEqual(
    buildName('rm_{code}_{col}', { code: 'ext_prod_res', col: 'specify' }),
    'rm_ext_prod_res_specify'
  );
});

test('remplace {parent_idx}, {code} et {col} dans les motifs imbriqués', () => {
  assert.strictEqual(
    buildName('ep_{parent_idx}_poll_{code}_{col}',
              { parent_idx: 2, code: 'nox', col: 'conc' }),
    'ep_2_poll_nox_conc'
  );
});

test('gère le code placé avant la colonne dans la matrice s22', () => {
  assert.strictEqual(
    buildName('s22_{code}_{col}', { code: 'debark', col: 'airflow' }),
    's22_debark_airflow'
  );
});

test('lève une erreur si un jeton du motif n’est pas fourni', () => {
  assert.throws(
    () => buildName('dryer_{idx}_{col}', { col: 'temp_max' }),
    /jeton non resolu/
  );
});

test('fieldSegment rend l’alias quand la colonne en déclare un', () => {
  const entry = { aliases: { point_ref: 'id' } };
  assert.strictEqual(fieldSegment(entry, 'point_ref'), 'id');
  assert.strictEqual(fieldSegment(entry, 'ref_year'), 'ref_year');
  assert.strictEqual(fieldSegment({}, 'ref_year'), 'ref_year');
});
