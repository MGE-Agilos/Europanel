/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Dispatcher
   Traduit la carte plate {nom_champ: valeur} vers les tables, et l'inverse.
   Le manifeste (fields.js) est la source de vérité de la correspondance.
   ══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const fields = (typeof module !== 'undefined' && module.exports)
    ? require('./fields.js')
    : root.EuroPanelFields;
  const api = factory(fields);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EuroPanelDb = api;
})(typeof self !== 'undefined' ? self : this, function (fields) {
  'use strict';

  const { SCHEMA } = fields;

  /* ── Coercition ───────────────────────────────────────────────────── */

  // Carte plate → valeur PostgreSQL.
  // Une case à cocher décochée est absente de la carte (voir collectFormData),
  // ce qui doit produire false et non null.
  function toDb(value, type) {
    if (type === 'bool') return value === 'on';
    if (value === undefined || value === null || value === '') return null;
    if (type === 'num' || type === 'int') {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    return String(value);
  }

  // Valeur PostgreSQL → carte plate.
  // undefined signifie « ne pas produire de clé », ce qui reproduit
  // exactement le comportement de collectFormData pour les cases décochées.
  function fromDb(value, type) {
    if (type === 'bool') return value === true ? 'on' : undefined;
    if (value === null || value === undefined) return '';
    return String(value);
  }

  return { toDb, fromDb, SCHEMA };
});
