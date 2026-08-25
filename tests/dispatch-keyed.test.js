'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dispatch, hydrate } = require('../docs/db.js');

// Ces trois tests portent sur la mecanique du dispatcher pour les groupes a
// cles fixes, pas sur le contenu du manifeste. Ils utilisaient auparavant
// rm_roundwood_specify et rm_ext_prod_res_specify comme decor : or le
// questionnaire n'emet rm_<code>_specify que pour nonwood et other, les deux
// seules lignes de RAW_MATS dont le libelle est un champ de saisie
// (specify:true). Le decor a donc ete remplace par des champs reellement
// emis — species, present sur les sept codes — sans rien changer a ce qui est
// verifie.

function opFor(ops, table) {
  return ops.find(o => o.table === table);
}

test('dispatch produit une ligne par code renseigné, et seulement ceux-là', () => {
  const flat = {
    rm_roundwood_source: 'oui', rm_roundwood_species: 'épicéa',
    rm_sawdust_source: 'non',
  };
  const rows = opFor(dispatch(flat, 3), 'raw_materials').rows;

  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows.map(r => r.code).sort(), ['roundwood', 'sawdust']);
});

test('dispatch résout correctement un code contenant des soulignés', () => {
  const flat = { rm_ext_prod_res_species: 'valeur' };
  const rows = opFor(dispatch(flat, 3), 'raw_materials').rows;

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].code, 'ext_prod_res');
  assert.strictEqual(rows[0].species, 'valeur');
});

test('aller-retour sur un groupe à clés fixes', () => {
  const flat = {
    rm_ext_prod_res_species: 'valeur',
    rm_roundwood_species: 'épicéa',
    // nonwood est l'un des deux seuls codes a porter un libelle saisissable :
    // l'aller-retour doit aussi couvrir la table raw_material_specify.
    rm_nonwood_specify: 'paille de blé',
  };
  const ops = dispatch(flat, 3);
  const rowsByTable = {};
  ops.forEach(o => { rowsByTable[o.table] = o.rows; });
  const back = hydrate(rowsByTable, 3);

  assert.strictEqual(back.rm_ext_prod_res_species, 'valeur');
  assert.strictEqual(back.rm_roundwood_species, 'épicéa');
  assert.strictEqual(back.rm_nonwood_specify, 'paille de blé');
});
