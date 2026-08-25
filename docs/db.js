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

  /* ── Construction des noms ────────────────────────────────────────── */

  // Construit le nom de champ HTML attendu à partir d'un motif du manifeste.
  // On construit plutôt qu'on n'analyse : 'rm_{code}_{col}' est ambigu à la
  // lecture (où finit le code dans rm_ext_prod_res_specify ?) mais parfaitement
  // déterministe à l'écriture, puisque codes et colonnes sont connus.
  function buildName(pattern, parts) {
    const missing = [];
    const out = pattern.replace(/\{(idx|parent_idx|code|col)\}/g, (_, token) => {
      const v = parts[token];
      if (v === undefined || v === null) { missing.push(token); return ''; }
      return String(v);
    });
    if (missing.length) {
      throw new Error(
        'buildName: jeton non resolu {' + missing.join('}, {') + '} dans « ' + pattern + ' »'
      );
    }
    return out;
  }

  // Segment de nom de champ correspondant à une colonne.
  // Sert aux colonnes qui ne peuvent pas porter le nom de leur champ :
  // 'id' entrerait en collision avec la clé primaire de substitution,
  // 'desc' est un mot réservé PostgreSQL.
  function fieldSegment(entry, col) {
    return (entry.aliases && entry.aliases[col]) || col;
  }

  /* ── Dispatch ─────────────────────────────────────────────────────── */

  // Retourne les entrées du manifeste appartenant à une page donnée.
  function entriesForPage(pageId) {
    return Object.entries(SCHEMA).filter(([, e]) => e.page === pageId);
  }

  // Carte plate → opérations d'écriture, une par table.
  // Forme : [{ table, kind, rows: [...] }]
  function dispatch(flat, pageId) {
    const ops = [];
    for (const [table, entry] of entriesForPage(pageId)) {
      if (entry.kind === 'one') {
        const row = {};
        for (const [col, type] of Object.entries(entry.cols)) {
          row[col] = toDb(flat[col], type);
        }
        ops.push({ table, kind: 'one', rows: [row] });
      }
    }
    return ops;
  }

  /* ── Hydratation ──────────────────────────────────────────────────── */

  // Lignes lues en base → carte plate attendue par les renderers.
  // `rowsByTable` a la forme { nom_table: [ligne, …] }.
  function hydrate(rowsByTable, pageId) {
    const flat = {};
    for (const [table, entry] of entriesForPage(pageId)) {
      const rows = rowsByTable[table] || [];
      if (entry.kind === 'one') {
        const row = rows[0];
        if (!row) continue;
        for (const [col, type] of Object.entries(entry.cols)) {
          const v = fromDb(row[col], type);
          if (v !== undefined) flat[col] = v;
        }
      }
    }
    return flat;
  }

  return { toDb, fromDb, buildName, fieldSegment, dispatch, hydrate, SCHEMA };
});
