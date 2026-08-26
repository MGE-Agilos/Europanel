'use strict';
const test = require('node:test');
const assert = require('node:assert');

// removeCUColumn (docs/app.js:444) et removeInstance (docs/app.js:417)
// lisent et ecrivent le DOM (state, document.querySelector) : on ne peut pas
// les appeler tel quel dans un test node:test sans DOM. Ce fichier extrait
// donc la seule partie qui compte ici — comment les cles cu_{idx}_{col}
// d'une carte plate evoluent quand on retire une unite — et la reproduit en
// pur JS. Les deux fonctions ci-dessous sont volontairement des traductions
// fideles, ligne a ligne, du code reel : si l'une des deux change dans
// app.js, sa contrepartie ici doit changer avec elle.

// Traduction pure de removeInstance (docs/app.js:417-434). Dans le code reel,
// la boucle relit le DOM pour la valeur de l'instance suivante ; mais `data`
// vient d'un collectFormData() qui vient de lire ce meme DOM, donc
// data[nextName] est deja exactement cette valeur. La traduction pure est
// donc fidele, pas une simplification.
function removeInstanceMirror(flat, type, index) {
  const data = Object.assign({}, flat);
  const current = parseInt(data[`${type}_count`], 10);
  for (let i = index; i < current; i++) {
    Object.keys(flat).forEach(name => {
      if (!name.startsWith(`${type}_${i}_`)) return;
      const nextName = name.replace(`${type}_${i}_`, `${type}_${i + 1}_`);
      if (nextName in flat) data[name] = flat[nextName];
      else delete data[name];
    });
  }
  data[`${type}_count`] = current - 1;
  return data;
}

// Traduction pure de removeCUColumn TEL QU'IL EXISTE AUJOURD'HUI
// (docs/app.js:444-461, apres correctif) : decale les unites suivantes,
// comme removeInstance. Avant le correctif, cette fonction se limitait a
// `Object.keys(data).forEach(k => { if (k.startsWith(`cu_${ci}_`)) delete
// data[k]; }); data.cu_count = current - 1;` — sans aucun decalage. Le test
// ci-dessous a d'abord ete ecrit contre cette version-la et echouait avec :
// « BUG data-loss : la 6e unite de combustion (debit thermique 60) est
// perdue apres suppression de la 5e ». Ne pas revenir a cette forme.
function removeCUColumnMirror(flat, ci) {
  const data = Object.assign({}, flat);
  const current = parseInt(data.cu_count || 4, 10);
  for (let i = ci; i < current; i++) {
    Object.keys(flat).forEach(name => {
      if (!name.startsWith(`cu_${i}_`)) return;
      const nextName = name.replace(`cu_${i}_`, `cu_${i + 1}_`);
      if (nextName in flat) data[name] = flat[nextName];
      else delete data[name];
    });
  }
  data.cu_count = current - 1;
  return data;
}

function sixCombustionUnits() {
  const flat = { cu_count: '6' };
  for (let i = 1; i <= 6; i++) {
    flat[`cu_${i}_thermal_input`] = String(i * 10);   // MW, coeur du bilan energetique BREF
    flat[`cu_${i}_equip_type`]    = `type-unite-${i}`;
  }
  return flat;
}

test('removeInstance (secheurs, presses, ...) decale les instances suivantes : aucune perte', () => {
  const before = sixCombustionUnits(); // le prefixe 'cu' sert ici de gabarit generique
  const after = removeInstanceMirror(before, 'cu', 5);

  assert.strictEqual(after.cu_count, 5);
  assert.strictEqual(after.cu_5_thermal_input, '60', 'CU6 doit combler le trou laisse par CU5');
  assert.strictEqual(after.cu_5_equip_type, 'type-unite-6');
  // cu_6_* reste present dans la carte sous son nom d'origine : removeInstance
  // ne l'efface jamais explicitement, il se contente de recopier sa valeur
  // vers le rang du dessous. C'est sans consequence, precisement parce que
  // cu_count est retombe a 5 : renderCurrentPage() ne redessine plus cu_6,
  // et le prochain collectFormData() ne relira que ce que le DOM affiche —
  // cette cle residuelle ne sera donc plus jamais ecrite ni lue. La verifier
  // ici documente ce comportement au lieu de le laisser implicite.
  assert.strictEqual(after.cu_6_thermal_input, '60');
});

test('removeCUColumn decale les unites de combustion suivantes : plus de perte de donnees', () => {
  // Un operateur a renseigne six unites de combustion (debit thermique,
  // type d'equipement — le coeur du bilan energetique BREF) et retire la
  // 5e. La 6e doit combler le trou, exactement comme removeInstance le fait
  // pour les secheurs, presses, techniques d'abattement, points d'emission
  // et rejets d'eaux residuaires.
  const before = sixCombustionUnits();
  const after = removeCUColumnMirror(before, 5);

  assert.strictEqual(after.cu_count, 5);
  assert.strictEqual(after.cu_5_thermal_input, '60');
  assert.strictEqual(after.cu_5_equip_type, 'type-unite-6');

  // removeCUColumn et removeInstance doivent maintenant produire le meme
  // resultat sur le meme prefixe : c'est la garantie que le correctif suit
  // bien le motif de removeInstance, comme demande.
  assert.deepStrictEqual(after, removeInstanceMirror(before, 'cu', 5));
});
