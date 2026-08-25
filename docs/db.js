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

  const { SCHEMA, LISTS } = fields;

  /* ── Coercition ───────────────────────────────────────────────────── */

  // Carte plate → valeur PostgreSQL.
  // Une case à cocher décochée est absente de la carte (voir collectFormData),
  // ce qui doit produire false et non null.
  function toDb(value, type) {
    if (type === 'bool') return value === 'on';
    if (value === undefined || value === null) return null;

    // Number('  ') vaut 0 en JavaScript. Sans ce trim, un champ ne contenant
    // que des espaces serait enregistré comme une mesure de zéro au lieu d'une
    // absence de mesure. Dans un jeu de données d'émissions, les deux sont des
    // affirmations différentes et partent dans les moyennes sectorielles.
    const trimmed = String(value).trim();
    if (trimmed === '') return null;

    if (type === 'num' || type === 'int') {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return null;
      // Les colonnes 'int' sont des SMALLINT (années, compteurs) : une valeur
      // fractionnaire ferait échouer l'insertion côté PostgreSQL.
      return type === 'int' ? Math.round(n) : n;
    }
    // Le texte est conservé tel quel : ce n'est pas à la couche de stockage
    // de réécrire ce que l'opérateur a saisi.
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

  /* ── Parenté ──────────────────────────────────────────────────────── */

  // Colonne portant la cle etrangere vers le parent. Declaree explicitement
  // dans le manifeste plutot que derivee du nom de table : deriver imposerait
  // de deviner un singulier anglais, ce qui marche pour emission_points et
  // pas pour la table suivante.
  function parentColumn(entry) {
    return entry.parentCol || (entry.parent ? entry.parent + '_id' : null);
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

  const PROBE_CAP = 500;

  // Nombre d'instances d'une section répétable présentes dans la carte plate.
  // On privilégie le compteur déclaré (countField) : il fait autorité, car
  // l'interface le maintient et il permet de détecter une instance supprimée
  // dont les clés traînent encore dans la carte.
  // À défaut, on sonde depuis 1 jusqu'au premier indice sans aucune colonne.
  // L'interface renumérote les instances à la suppression : pas de trous.
  function countInstances(flat, entry) {
    if (entry.countField) {
      // Comme dans toDb : une chaine vide ou blanche n'est pas un zero
      // lisible, c'est l'absence de valeur. Number('') vaut 0 en JavaScript,
      // ce qui ferait perdre a tort la priorite au compteur declare face au
      // sondage des lors que le champ existe mais n'a jamais ete rempli.
      const raw = flat[entry.countField];
      const trimmed = raw === undefined || raw === null ? '' : String(raw).trim();
      if (trimmed !== '') {
        const n = Number(trimmed);
        if (Number.isFinite(n) && n >= 0) {
          if (n > PROBE_CAP) {
            console.warn('countInstances: plafond de ' + PROBE_CAP +
              ' instances atteint pour « ' + entry.pattern + ' » — valeur tronquee.');
          }
          return Math.min(n, PROBE_CAP);
        }
      }
    }
    let n = 0;
    while (n < PROBE_CAP) {
      const idx = n + 1;
      const present = Object.keys(entry.cols).some(
        col => flat[buildName(entry.pattern,
                              { idx, col: fieldSegment(entry, col) })] !== undefined
      );
      if (!present) break;
      n = idx;
    }
    if (n === PROBE_CAP) {
      console.warn('countInstances: plafond de ' + PROBE_CAP +
        ' instances atteint pour « ' + entry.pattern + ' » — valeur tronquee.');
    }
    return n;
  }

  function range(from, to) {
    const out = [];
    for (let i = from; i <= to; i++) out.push(i);
    return out;
  }

  // Profondeur d'une table dans la chaine de parente (0 = rattachee a la soumission).
  function depth(table) {
    let d = 0, cur = SCHEMA[table];
    while (cur && cur.parent) { d++; cur = SCHEMA[cur.parent]; }
    return d;
  }

  // Carte plate → opérations d'écriture, une par table.
  // Forme : [{ table, kind, rows: [...] }]
  function dispatch(flat, pageId) {
    const ops = [];
    for (const [table, entry] of entriesForPage(pageId)) {
      switch (entry.kind) {
      case 'one': {
        const row = {};
        for (const [col, type] of Object.entries(entry.cols)) {
          row[col] = toDb(flat[col], type);
        }
        ops.push({ table, kind: 'one', rows: [row] });
        break;
      }
      // Une instance repetable est un signal de presence donne par
      // l'operateur : il a ajoute un cinquieme secheur. Ce signal doit
      // survivre meme si aucune colonne n'est encore remplie, sinon
      // l'instance disparaitrait au prochain chargement de page et son
      // action serait defaite sans qu'il en soit averti.
      // Un code de la section 'keyed' releve au contraire d'une
      // enumeration fixe dont la plupart des entrees sont simplement sans
      // objet pour la soumission courante : tout ecrire produirait par
      // exemple 37 lignes de polluants vides par point d'emission.
      // D'ou l'asymetrie deliberee : 'many' ecrit les instances declarees
      // meme vides, 'keyed' n'ecrit que les codes renseignes. Ne pas
      // « harmoniser » les deux branches.
      case 'many': {
        const n = countInstances(flat, entry);
        const rows = [];
        for (let idx = 1; idx <= n; idx++) {
          const row = { idx };
          for (const [col, type] of Object.entries(entry.cols)) {
            const seg = fieldSegment(entry, col);
            row[col] = toDb(flat[buildName(entry.pattern, { idx, col: seg })], type);
          }
          rows.push(row);
        }
        ops.push({ table, kind: 'many', rows, deleteBeyondIdx: n });
        break;
      }
      case 'keyed': {
        const rows = [];
        // Une table enfant itere sur les instances de son parent ; une table
        // rattachee directement a la soumission n'a qu'une seule passe.
        const parents = entry.parent
          ? range(1, countInstances(flat, SCHEMA[entry.parent]))
          : [null];

        for (const parentIdx of parents) {
          for (const code of LISTS[entry.list]) {
            const parts = { code, parent_idx: parentIdx };
            const row = parentIdx === null ? { code } : { code, parent_idx: parentIdx };
            let any = false;
            for (const [col, type] of Object.entries(entry.cols)) {
              const raw = flat[buildName(entry.pattern,
                Object.assign({ col: fieldSegment(entry, col) }, parts))];
              if (raw !== undefined && raw !== '') any = true;
              row[col] = toDb(raw, type);
            }
            // On n'ecrit une ligne que si au moins une colonne est renseignee,
            // pour ne pas creer 37 lignes vides par point d'emission.
            if (any) rows.push(row);
          }
        }
        ops.push({ table, kind: 'keyed', rows });
        break;
      }
      default:
        throw new Error('kind inconnu : ' + entry.kind + ' (table ' + table + ')');
      }
    }
    // Les tables enfants ont besoin de la cle de leur parent : on les ecrit apres.
    ops.sort((a, b) => depth(a.table) - depth(b.table));
    return ops;
  }

  /* ── Hydratation ──────────────────────────────────────────────────── */

  // Lignes lues en base → carte plate attendue par les renderers.
  // `rowsByTable` a la forme { nom_table: [ligne, …] }.
  function hydrate(rowsByTable, pageId) {
    const flat = {};
    for (const [table, entry] of entriesForPage(pageId)) {
      const rows = rowsByTable[table] || [];
      switch (entry.kind) {
      case 'one': {
        const row = rows[0];
        if (!row) continue;
        for (const [col, type] of Object.entries(entry.cols)) {
          const v = fromDb(row[col], type);
          if (v !== undefined) flat[col] = v;
        }
        break;
      }
      case 'many': {
        for (const row of rows) {
          for (const [col, type] of Object.entries(entry.cols)) {
            const v = fromDb(row[col], type);
            if (v === undefined) continue;
            flat[buildName(entry.pattern,
              { idx: row.idx, col: fieldSegment(entry, col) })] = v;
          }
        }
        // Correct seulement si les idx des lignes sont contigus depuis 1 :
        // c'est l'hypothese posee dans countInstances (l'interface renumerote
        // a la suppression, donc pas de trous). Si elle etait violee, ce
        // compte serait sous-estime et une instance a idx eleve deviendrait
        // inatteignable pour le renderer, qui itere de 1 a ce compte.
        if (entry.countField) flat[entry.countField] = String(rows.length);
        break;
      }
      case 'keyed': {
        for (const row of rows) {
          const parts = { code: row.code };
          if (entry.parent) parts.parent_idx = row.parent_idx;
          for (const [col, type] of Object.entries(entry.cols)) {
            const v = fromDb(row[col], type);
            if (v === undefined) continue;
            flat[buildName(entry.pattern,
              Object.assign({ col: fieldSegment(entry, col) }, parts))] = v;
          }
        }
        break;
      }
      default:
        throw new Error('kind inconnu : ' + entry.kind + ' (table ' + table + ')');
      }
    }
    return flat;
  }

  return {
    toDb, fromDb, buildName, fieldSegment, parentColumn, countInstances, dispatch, hydrate, SCHEMA,
  };
});
