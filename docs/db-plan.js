/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Planification des lectures et des ecritures
   ----------------------------------------------------------------------
   db.js traduit entre la carte plate et les lignes. Ce module-ci decide
   *quelles requetes* envoyer a PostgREST pour poser ces lignes en base et
   pour les relire, et sous quelle forme.

   Il est volontairement separe de app.js et sans effet de bord : la
   planification est une fonction pure (op + contexte -> etapes), ce qui la
   rend testable sans navigateur, sans base et sans identifiants.

   Charger apres fields.js et db.js.
   ══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const db = (typeof module !== 'undefined' && module.exports)
    ? require('./db.js')
    : root.EuroPanelDb;
  if (!db) {
    throw new Error('db-plan.js : EuroPanelDb absent — charger db.js avant db-plan.js.');
  }
  const api = factory(db);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EuroPanelPlan = api;
})(typeof self !== 'undefined' ? self : this, function (db) {
  'use strict';

  const { SCHEMA, parentColumn } = db;

  /* ── Topologie du manifeste ───────────────────────────────────────── */

  function entriesForPage(pageId) {
    return Object.entries(SCHEMA).filter(([, e]) => e.page === pageId);
  }

  // { table_parente: [table_enfant, ...] } pour une page donnee.
  // Le manifeste declare chaque enfant sur la meme page que son parent ; on
  // le verifie plutot que de le supposer, car une page qui embarquerait un
  // enfant sans son parent produirait un select PostgREST invalide et un
  // echec de chargement difficile a rattacher a sa cause.
  function childrenOf(pageId) {
    const map = {};
    for (const [table, entry] of entriesForPage(pageId)) {
      if (!entry.parent) continue;
      const parent = SCHEMA[entry.parent];
      if (!parent) {
        throw new Error('childrenOf : parent inconnu « ' + entry.parent +
                        ' » pour la table ' + table);
      }
      if (parent.page !== pageId) {
        throw new Error('childrenOf : ' + table + ' (page ' + pageId +
                        ') a pour parent ' + entry.parent + ' (page ' +
                        parent.page + ') — lecture imbriquee impossible.');
      }
      (map[entry.parent] = map[entry.parent] || []).push(table);
    }
    return map;
  }

  // Une table est « parente » si une autre entree du manifeste la designe.
  // Sert a n'exiger le retour des cles primaires que la ou elles servent.
  function isParentTable(table) {
    return Object.values(SCHEMA).some(e => e.parent === table);
  }

  /* ── Lecture ──────────────────────────────────────────────────────── */

  // Chaine .select() lisant en UNE requete toutes les tables d'une page,
  // enfants imbriques sous leur parent, depuis la ligne submissions.
  //
  // Pourquoi l'imbrication PostgREST plutot qu'une requete par table :
  //
  //  - Une requete par table exigerait, pour les six tables enfants du
  //    questionnaire, de connaitre d'abord les cles primaires de leur
  //    parent. Cela impose un aller-retour supplementaire, et surtout une
  //    fenetre entre les deux lectures pendant laquelle l'ensemble des
  //    parents peut changer : les enfants lus se rattacheraient alors a des
  //    parents qui ne sont plus les memes.
  //  - L'imbrication supprime ce probleme a la racine : l'enfant arrive
  //    *dans* l'objet de son parent, donc l'association est structurelle et
  //    non reconstruite. On n'a jamais besoin de voir la cle primaire du
  //    parent au chargement — seulement son idx, qui est deja la.
  //  - Le rattrapage par « parents d'abord, puis .in(fk, ids) » marcherait
  //    aussi, mais il faut alors retraduire id -> idx cote client,
  //    c'est-a-dire refaire a la main ce que l'imbrication donne
  //    gratuitement, et se rouvrir la fenetre ci-dessus.
  //
  // Pourquoi une requete PAR PAGE et non une seule pour les 35 tables :
  // tout embarquer sous une unique ligne submissions serait possible et ne
  // couterait qu'une requete, mais un seul embed mal forme ferait alors
  // echouer le chargement entier. Treize requetes cadrent l'echec sur la
  // page fautive, gardent chaque URL lisible dans l'onglet reseau — ce qui
  // compte pour un schema que personne n'a encore fait tourner — et
  // correspondent a l'unite de travail de hydrate(). Elles partent en
  // parallele sur une seule connexion HTTP/2 : le cout est negligeable.
  //
  // Retourne null pour une page sans table (page 12).
  function pageSelect(pageId) {
    const kids = childrenOf(pageId);
    const roots = entriesForPage(pageId).filter(([, e]) => !e.parent).map(([t]) => t);
    if (!roots.length) return null;
    const parts = roots.map(t => kids[t]
      ? t + '(*, ' + kids[t].map(c => c + '(*)').join(', ') + ')'
      : t + '(*)');
    return 'id, ' + parts.join(', ');
  }

  // PostgREST rend un tableau pour une relation un-a-plusieurs, mais un
  // objet nu pour une relation un-a-un (nos tables 'one', dont la cle
  // primaire *est* la cle etrangere). hydrate n'attend que des tableaux.
  function asArray(v) {
    if (Array.isArray(v)) return v;
    return (v === null || v === undefined) ? [] : [v];
  }

  // Ligne submissions imbriquee -> { table: [ligne, ...] } attendu par
  // hydrate. Les lignes enfants recoivent parent_idx, repris de l'idx du
  // parent dans lequel elles etaient imbriquees : c'est la seule traduction
  // necessaire dans le sens base -> carte plate.
  function collectPageRows(subRow, pageId) {
    const kids = childrenOf(pageId);
    const out = {};
    for (const [table, entry] of entriesForPage(pageId)) {
      if (entry.parent) { out[table] = out[table] || []; continue; }
      const rows = asArray(subRow ? subRow[table] : null);
      out[table] = rows;
      for (const child of (kids[table] || [])) {
        const bucket = out[child] = out[child] || [];
        for (const parentRow of rows) {
          for (const childRow of asArray(parentRow[child])) {
            bucket.push(Object.assign({}, childRow, { parent_idx: parentRow.idx }));
          }
        }
      }
    }
    return out;
  }

  /* ── Ecriture : planification ─────────────────────────────────────── */

  // Cible du ON CONFLICT selon le genre d'entree.
  function conflictKey(kind) {
    return kind === 'keyed' ? 'code' : 'idx';
  }

  // Liste PostgREST pour l'operateur `in`. Les codes viennent de LISTS et
  // sont des identifiants [A-Za-z0-9_] ; on le verifie au lieu de
  // l'esperer, car un code contenant une virgule ou un guillemet produirait
  // un filtre silencieusement faux — donc une suppression trop large.
  function inList(values) {
    return '(' + values.map(v => {
      const s = String(v);
      if (!/^[A-Za-z0-9_]+$/.test(s)) {
        throw new Error('inList : code non citable « ' + s + ' »');
      }
      return '"' + s + '"';
    }).join(',') + ')';
  }

  function keyed(col, value) {
    const o = {};
    o[col] = value;
    return o;
  }

  // Une table a cles ne recoit de ligne que pour les codes renseignes (voir
  // dispatch). Sans cette etape, vider un champ deja enregistre laisserait
  // sa ligne en base : la valeur reapparaitrait au rechargement suivant,
  // sans que personne ne le remarque. C'est le pendant exact du delete
  // borne des sections repetables, pour la meme raison.
  function cleanupKeyed(table, match, keptCodes) {
    const step = { kind: 'delete', table: table, match: match };
    if (keptCodes.length) step.notIn = { col: 'code', values: keptCodes.slice() };
    return step;
  }

  // L'ecriture du filet (submission_pages.raw). Emise AVANT les tables
  // metier : voir applyPagePlan.
  function planPageStatus(params) {
    return {
      kind: 'upsert',
      table: 'submission_pages',
      rows: [{
        submission_id: params.submissionId,
        page_id: params.pageId,
        status: params.status,
        raw: params.raw,
        saved_at: params.savedAt,
      }],
      onConflict: 'submission_id,page_id',
      returning: null,
      harvest: false,
    };
  }

  // Une operation de dispatch() -> les etapes de requete correspondantes.
  // ctx = { submissionId, parentIds } ou parentIds vaut
  // { table_parente: { idx: cle_primaire } } pour les parents deja ecrits.
  function planTableOp(op, ctx) {
    const entry = SCHEMA[op.table];
    if (!entry) throw new Error('planTableOp : table hors manifeste — ' + op.table);
    const steps = [];
    const submissionId = ctx.submissionId;

    /* — table 1:1 — */
    if (op.kind === 'one') {
      steps.push({
        kind: 'upsert', table: op.table,
        rows: op.rows.map(r => Object.assign({ submission_id: submissionId }, r)),
        onConflict: 'submission_id', returning: null, harvest: false,
      });
      return steps;
    }

    /* — table rattachee directement a la soumission — */
    if (!entry.parent) {
      const harvest = isParentTable(op.table);
      const rows = op.rows.map(r => Object.assign({ submission_id: submissionId }, r));
      if (rows.length) {
        steps.push({
          kind: 'upsert', table: op.table, rows: rows,
          onConflict: 'submission_id,' + conflictKey(op.kind),
          // On ne demande le retour des cles que la ou un enfant les
          // attend. Le lien est derive du manifeste : declarer une table
          // enfant suffit a faire remonter la cle de son parent.
          returning: harvest ? 'idx,id' : null,
          harvest: harvest,
        });
      }
      if (op.kind === 'many') {
        // Borne : idx > n. n vaut 0 quand l'operateur a tout retire, et
        // l'idx demarrant a 1, le filtre supprime alors toutes les lignes.
        steps.push({
          kind: 'delete', table: op.table,
          match: { submission_id: submissionId },
          gt: { col: 'idx', value: op.deleteBeyondIdx },
        });
      } else {
        steps.push(cleanupKeyed(op.table, { submission_id: submissionId },
                                op.rows.map(r => r.code)));
      }
      return steps;
    }

    /* — table enfant — */
    if (op.kind !== 'keyed') {
      // Le manifeste n'en produit pas : les six tables enfants sont toutes
      // a cles. Une section repetable imbriquee demanderait une borne de
      // suppression par parent, que dispatch() ne fournit pas. Echouer ici
      // vaut mieux qu'ecrire des lignes qu'on ne saurait plus retirer.
      throw new Error('planTableOp : section repetable imbriquee non prise en ' +
                      'charge — ' + op.table);
    }
    const fk = parentColumn(entry);
    const ids = (ctx.parentIds && ctx.parentIds[entry.parent]) || {};
    const rows = [];
    const codesByParent = {};
    for (const r of op.rows) {
      const parentId = ids[r.parent_idx];
      // Un parent absent de la carte n'a pas ete ecrit (instance retiree) :
      // sa ligne enfant violerait la cle etrangere NOT NULL. Le delete
      // borne du parent a supprime la ligne parente, et la cascade emporte
      // les enfants.
      if (parentId === undefined || parentId === null) continue;
      const row = {};
      for (const key of Object.keys(r)) {
        if (key !== 'parent_idx') row[key] = r[key];
      }
      row[fk] = parentId;
      rows.push(row);
      (codesByParent[r.parent_idx] = codesByParent[r.parent_idx] || []).push(r.code);
    }
    if (rows.length) {
      steps.push({
        kind: 'upsert', table: op.table, rows: rows,
        onConflict: fk + ',code', returning: null, harvest: false,
      });
    }
    // Un nettoyage par parent vivant. Coute une requete par instance, ce
    // qui reste modeste (une page en compte typiquement une a cinq) et
    // achete la seule garantie qui compte ici : une valeur effacee reste
    // effacee.
    for (const idx of Object.keys(ids)) {
      steps.push(cleanupKeyed(op.table, keyed(fk, ids[idx]), codesByParent[idx] || []));
    }
    return steps;
  }

  // Sequence complete pour une page. parentIds doit etre fourni : cette
  // fonction est pure et ne peut pas connaitre des cles que seule
  // l'execution produit. applyPagePlan enchaine les memes briques en
  // remplissant parentIds au fur et a mesure.
  function planPageWrites(params) {
    const steps = [planPageStatus(params)];
    const ctx = {
      submissionId: params.submissionId,
      parentIds: params.parentIds || {},
    };
    for (const op of params.ops) {
      for (const step of planTableOp(op, ctx)) steps.push(step);
    }
    return steps;
  }

  /* ── Ecriture : execution ─────────────────────────────────────────── */

  function stepError(error, step) {
    const err = new Error(step.kind + ' ' + step.table + ' : ' +
                          (error.message || String(error)));
    err.cause = error;
    err.step = step;
    return err;
  }

  // Une etape -> une requete supabase-js. Le client est passe en argument
  // pour que le chemin d'ecriture soit exercable par un double de test.
  async function runStep(client, step) {
    const from = client.from(step.table);
    if (step.kind === 'upsert') {
      let q = from.upsert(step.rows, { onConflict: step.onConflict });
      if (step.returning) q = q.select(step.returning);
      const res = await q;
      if (res && res.error) throw stepError(res.error, step);
      return res ? res.data : null;
    }
    if (step.kind === 'delete') {
      let q = from.delete();
      for (const col of Object.keys(step.match)) q = q.eq(col, step.match[col]);
      if (step.gt) q = q.gt(step.gt.col, step.gt.value);
      if (step.notIn) q = q.not(step.notIn.col, 'in', inList(step.notIn.values));
      const res = await q;
      if (res && res.error) throw stepError(res.error, step);
      return null;
    }
    throw new Error('runStep : genre d\'etape inconnu — ' + step.kind);
  }

  // Ecrit une page. Retourne la carte des cles primaires produites, par
  // table parente puis par idx.
  //
  // Le filet part EN PREMIER, et c'est delibere. PostgREST n'ouvre pas de
  // transaction : si une etape echoue, les precedentes sont deja validees.
  // En ecrivant submission_pages.raw d'abord, on garantit qu'a tout instant
  // apres le debut d'une sauvegarde, la base detient la carte plate
  // complete que l'operateur a voulu enregistrer — donc que les tables
  // metier sont regenerables depuis raw, y compris apres un echec partiel.
  // L'ecrire en dernier aurait l'effet inverse : raw decrirait la
  // sauvegarde *precedente*, et l'edition a moitie passee serait perdue.
  async function applyPagePlan(client, params) {
    await runStep(client, planPageStatus(params));
    const parentIds = {};
    const ctx = { submissionId: params.submissionId, parentIds: parentIds };
    for (const op of params.ops) {
      for (const step of planTableOp(op, ctx)) {
        const data = await runStep(client, step);
        if (!step.harvest) continue;
        // Cle par idx et non par position : PostgREST ne garantit pas
        // l'ordre des lignes rendues par un RETURNING.
        const map = parentIds[step.table] = parentIds[step.table] || {};
        for (const row of (data || [])) map[row.idx] = row.id;
      }
    }
    return parentIds;
  }

  return {
    entriesForPage, childrenOf, isParentTable,
    pageSelect, asArray, collectPageRows,
    conflictKey, inList, cleanupKeyed,
    planPageStatus, planTableOp, planPageWrites,
    runStep, applyPagePlan,
  };
});
