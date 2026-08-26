'use strict';
/* ══════════════════════════════════════════════════════════════════════
   Ce que ces tests couvrent — et ce qu'ils ne couvrent pas.

   Ils verifient le CONTENU de ce que le chemin de sauvegarde enverrait :
   les tables touchees, l'ordre, les cibles de ON CONFLICT, les bornes de
   suppression et les lignes elles-memes. Ils n'atteignent aucune base :
   il n'y en a pas ici. Que PostgreSQL accepte ces requetes, que les
   contraintes tiennent et que les politiques RLS laissent passer reste a
   verifier une fois la migration appliquee.

   Le double de client n'est pas la cible du test : on n'assertionne jamais
   « le mock a ete appele », toujours ce qu'il a recu.
   ══════════════════════════════════════════════════════════════════════ */
const test = require('node:test');
const assert = require('node:assert');
const { dispatch } = require('../docs/db.js');
const plan = require('../docs/db-plan.js');

/* ── Double de client supabase-js ─────────────────────────────────────── */

// Enregistre chaque requete sous la forme
//   { table, op, rows?, onConflict?, select?, filters: [[op, col, ...], ...] }
// et rend, pour un upsert assorti d'un .select(), les couples (idx, id) que
// PostgREST retournerait.
function fakeClient(opts) {
  opts = opts || {};
  const calls = [];
  const idMap = opts.ids || {};

  function respond(call) {
    if (opts.failOn && opts.failOn(call)) {
      return { data: null, error: { message: 'echec simule' } };
    }
    if (call.op === 'upsert' && call.select) {
      const table = idMap[call.table] || {};
      const data = call.rows.map(r => ({
        idx: r.idx,
        id: table[r.idx] !== undefined ? table[r.idx] : 9000 + r.idx,
      }));
      // PostgREST ne garantit pas l'ordre des lignes d'un RETURNING.
      // On le renverse deliberement : un appariement par position, et non
      // par idx, doit echouer ici plutot qu'en production.
      data.reverse();
      return { data, error: null };
    }
    return { data: null, error: null };
  }

  return {
    calls,
    from(table) {
      const call = { table, filters: [] };
      const builder = {
        upsert(rows, options) {
          call.op = 'upsert';
          call.rows = rows;
          call.onConflict = options && options.onConflict;
          calls.push(call);
          return builder;
        },
        delete() { call.op = 'delete'; calls.push(call); return builder; },
        select(cols) { call.select = cols; return builder; },
        eq(col, val) { call.filters.push(['eq', col, val]); return builder; },
        gt(col, val) { call.filters.push(['gt', col, val]); return builder; },
        not(col, op, val) { call.filters.push(['not', col, op, val]); return builder; },
        then(resolve) { resolve(respond(call)); },
      };
      return builder;
    },
  };
}

function save(client, pageId, flat, extra) {
  return plan.applyPagePlan(client, Object.assign({
    ops: dispatch(flat, pageId),
    submissionId: 42,
    pageId: pageId,
    status: 'complete',
    raw: flat,
    savedAt: '2026-08-26T10:00:00.000Z',
  }, extra));
}

function callsTo(client, table) {
  return client.calls.filter(c => c.table === table);
}

/* ── 1. Le filet : submission_pages ───────────────────────────────────── */

test('la charge brute part en premier, verbatim, dans submission_pages', async () => {
  const flat = { contact_company: 'Panneaux SA', contact_email: 'a@b.eu' };
  const client = fakeClient();
  await save(client, 0, flat);

  const first = client.calls[0];
  assert.strictEqual(first.table, 'submission_pages');
  assert.strictEqual(first.op, 'upsert');
  assert.strictEqual(first.onConflict, 'submission_id,page_id');
  assert.strictEqual(first.rows.length, 1);
  assert.deepStrictEqual(first.rows[0], {
    submission_id: 42,
    page_id: 0,
    status: 'complete',
    raw: flat,
    saved_at: '2026-08-26T10:00:00.000Z',
  });
  // Verbatim : la carte plate telle que collectFormData l'a produite, sans
  // passage par le dispatcher. C'est toute la valeur du filet.
  assert.deepStrictEqual(first.rows[0].raw, flat);
});

test('le filet precede toute ecriture de table metier', async () => {
  const client = fakeClient();
  await save(client, 7, { ep_count: '1', ep_1_id: 'EP-01' });
  const iRaw = client.calls.findIndex(c => c.table === 'submission_pages');
  const iFirstBusiness = client.calls.findIndex(c => c.table !== 'submission_pages');
  assert.strictEqual(iRaw, 0);
  assert.ok(iRaw < iFirstBusiness);
});

test('le statut vide est transmis tel quel', async () => {
  const client = fakeClient();
  await save(client, 0, {}, { status: 'empty', raw: {} });
  assert.strictEqual(client.calls[0].rows[0].status, 'empty');
  assert.deepStrictEqual(client.calls[0].rows[0].raw, {});
});

/* ── 2. Page 1:1 ──────────────────────────────────────────────────────── */

test('une page 1:1 fait un seul upsert, cible sur submission_id', async () => {
  const flat = {
    contact_company: 'Panneaux SA',
    contact_email: 'a@b.eu',
    contact_name: 'M. Dupont',
  };
  const client = fakeClient();
  await save(client, 0, flat);

  const contacts = callsTo(client, 'contacts');
  assert.strictEqual(contacts.length, 1, 'une seule requete pour contacts');
  assert.strictEqual(contacts[0].op, 'upsert');
  assert.strictEqual(contacts[0].onConflict, 'submission_id');
  assert.strictEqual(contacts[0].rows.length, 1);

  const row = contacts[0].rows[0];
  assert.strictEqual(row.submission_id, 42);
  assert.strictEqual(row.contact_company, 'Panneaux SA');
  assert.strictEqual(row.contact_email, 'a@b.eu');
  // Une colonne non saisie part a NULL, pas a la chaine vide : dans un jeu
  // de donnees d'emissions les deux ne disent pas la meme chose.
  assert.strictEqual(row.contact_telephone, null);

  // Aucune suppression : une table 1:1 n'a pas de ligne excedentaire.
  assert.strictEqual(client.calls.filter(c => c.op === 'delete').length, 0);
  // Aucune cle primaire demandee : contacts n'est le parent de personne.
  assert.strictEqual(contacts[0].select, undefined);
});

/* ── 3. Section repetable : instance retiree ──────────────────────────── */

test('une instance retiree declenche un delete borne au compteur courant', async () => {
  // L'operateur avait trois secheurs, en a retire un. L'interface a
  // renumerote et decremente le compteur, mais des cles dryer_3_* trainent
  // encore dans la carte plate collectee.
  const flat = {
    dryer_count: '2',
    dryer_1_main_type: 'rotatif', dryer_1_outlet_temp: '110',
    dryer_2_main_type: 'a bandes',
    dryer_3_main_type: 'residu de la troisieme instance',
    press_count: '1',
    press_1_main_type: 'continue',
  };
  const client = fakeClient();
  await save(client, 5, flat);

  const dryers = callsTo(client, 'dryers');
  const upsert = dryers.find(c => c.op === 'upsert');
  const del    = dryers.find(c => c.op === 'delete');

  assert.strictEqual(upsert.onConflict, 'submission_id,idx');
  assert.deepStrictEqual(upsert.rows.map(r => r.idx), [1, 2],
    'la troisieme instance ne doit pas etre reecrite');
  assert.strictEqual(upsert.rows[0].submission_id, 42);
  assert.strictEqual(upsert.rows[0].main_type, 'rotatif');
  assert.strictEqual(upsert.rows[0].outlet_temp, 110);

  assert.ok(del, 'un delete borne doit etre emis');
  assert.deepStrictEqual(del.filters, [
    ['eq', 'submission_id', 42],
    ['gt', 'idx', 2],
  ]);
});

test('une section videe de toutes ses instances supprime toutes ses lignes', async () => {
  const client = fakeClient();
  await save(client, 5, { dryer_count: '0', press_count: '0' });

  const del = callsTo(client, 'dryers').find(c => c.op === 'delete');
  // idx demarre a 1 : « > 0 » vaut « tout ».
  assert.deepStrictEqual(del.filters, [
    ['eq', 'submission_id', 42],
    ['gt', 'idx', 0],
  ]);
  assert.strictEqual(callsTo(client, 'dryers').filter(c => c.op === 'upsert').length, 0,
    'rien a upserter quand il ne reste aucune instance');
});

/* ── 4. Table a cles imbriquee ────────────────────────────────────────── */

test('les enfants portent la cle primaire du parent, pas son indice', async () => {
  const flat = {
    ep_count: '2',
    ep_1_id: 'EP-01', ep_1_o2: '11',
    ep_2_id: 'EP-02',
    ep_1_poll_nox_conc: '120', ep_1_poll_nox_method: 'EN 14792',
    ep_1_poll_pm_conc: '5',
    ep_2_poll_nox_conc: '95',
  };
  const client = fakeClient({ ids: { emission_points: { 1: 4711, 2: 4712 } } });
  await save(client, 7, flat);

  const parent = callsTo(client, 'emission_points').find(c => c.op === 'upsert');
  assert.strictEqual(parent.select, 'idx,id',
    'le parent doit rendre ses cles primaires, indexees par idx');
  assert.strictEqual(parent.onConflict, 'submission_id,idx');

  const child = callsTo(client, 'emission_point_pollutants').find(c => c.op === 'upsert');
  assert.strictEqual(child.onConflict, 'emission_point_id,code');
  assert.strictEqual(child.rows.length, 3);

  for (const row of child.rows) {
    assert.ok(!('parent_idx' in row),
      'parent_idx est un indice d instance, il n a rien a faire en base');
    assert.ok(row.emission_point_id === 4711 || row.emission_point_id === 4712,
      'la cle etrangere doit etre une cle primaire, pas un indice : ' +
      row.emission_point_id);
  }

  const nox1 = child.rows.find(r => r.code === 'nox' && r.emission_point_id === 4711);
  assert.strictEqual(nox1.conc, 120);
  assert.strictEqual(nox1.method, 'EN 14792');

  const nox2 = child.rows.find(r => r.code === 'nox' && r.emission_point_id === 4712);
  assert.strictEqual(nox2.conc, 95);

  // Le double rend les lignes du RETURNING en ordre inverse : si
  // l'appariement se faisait par position, pm (point 1) serait rattache au
  // point 2 et ce test tomberait.
  const pm = child.rows.find(r => r.code === 'pm');
  assert.strictEqual(pm.emission_point_id, 4711);
});

test('aucune ligne enfant n est ecrite pour un parent qui n existe plus', async () => {
  // ep_count vaut 1, mais la carte plate contient encore un polluant du
  // deuxieme point d emission. dispatch ne produit ce polluant qu au titre
  // des parents declares ; la planification doit en outre refuser d ecrire
  // toute ligne dont le parent n a pas ete upserte.
  const ops = dispatch({ ep_count: '2', ep_1_poll_nox_conc: '1',
                         ep_2_poll_nox_conc: '2' }, 7);
  const childOp = ops.find(o => o.table === 'emission_point_pollutants');
  assert.strictEqual(childOp.rows.length, 2, 'pre-requis du test');

  // On ne fournit que la cle du premier point : le second a ete supprime.
  const steps = plan.planTableOp(childOp, {
    submissionId: 42,
    parentIds: { emission_points: { 1: 4711 } },
  });
  const upsert = steps.find(s => s.kind === 'upsert');
  assert.strictEqual(upsert.rows.length, 1);
  assert.strictEqual(upsert.rows[0].emission_point_id, 4711);
});

test('un polluant efface est retire, il ne ressuscite pas au rechargement', async () => {
  // Seul nox est renseigne : la ligne pm laissee par une sauvegarde
  // precedente doit disparaitre, sinon hydrate la relira.
  const client = fakeClient({ ids: { emission_points: { 1: 4711 } } });
  await save(client, 7, { ep_count: '1', ep_1_poll_nox_conc: '120' });

  const del = callsTo(client, 'emission_point_pollutants').find(c => c.op === 'delete');
  assert.deepStrictEqual(del.filters, [
    ['eq', 'emission_point_id', 4711],
    ['not', 'code', 'in', '("nox")'],
  ]);
});

test('un point d emission sans aucun polluant voit ses lignes toutes retirees', async () => {
  const client = fakeClient({ ids: { emission_points: { 1: 4711 } } });
  await save(client, 7, { ep_count: '1', ep_1_id: 'EP-01' });

  const del = callsTo(client, 'emission_point_pollutants').find(c => c.op === 'delete');
  assert.deepStrictEqual(del.filters, [['eq', 'emission_point_id', 4711]],
    'sans code conserve, la suppression porte sur tout le parent');
});

/* ── 5. Le plan comme sequence ────────────────────────────────────────── */

test('la sequence complete d une page imbriquee, parents avant enfants', () => {
  const steps = plan.planPageWrites({
    ops: dispatch({ ep_count: '1', ep_1_id: 'EP-01', ep_1_poll_nox_conc: '120' }, 7),
    submissionId: 42,
    pageId: 7,
    status: 'complete',
    raw: { ep_count: '1' },
    savedAt: '2026-08-26T10:00:00.000Z',
    parentIds: { emission_points: { 1: 4711 } },
  });

  assert.deepStrictEqual(
    steps.map(s => s.kind + ' ' + s.table),
    [
      'upsert submission_pages',
      'upsert emission_points',
      'delete emission_points',
      'upsert emission_point_pollutants',
      'delete emission_point_pollutants',
    ]
  );
});

test('une table a cles rattachee a la soumission se cible sur (submission_id, code)', () => {
  const ops = dispatch({ rm_roundwood_pct: '60', rm_sawdust_pct: '40' }, 3);
  const steps = plan.planTableOp(ops.find(o => o.table === 'raw_materials'),
                                 { submissionId: 42, parentIds: {} });
  const upsert = steps.find(s => s.kind === 'upsert');
  assert.strictEqual(upsert.onConflict, 'submission_id,code');
  assert.deepStrictEqual(upsert.rows.map(r => r.code).sort(), ['roundwood', 'sawdust']);
  assert.strictEqual(upsert.rows[0].submission_id, 42);

  const del = steps.find(s => s.kind === 'delete');
  assert.deepStrictEqual(del.match, { submission_id: 42 });
  assert.deepStrictEqual(del.notIn.values.sort(), ['roundwood', 'sawdust']);
});

/* ── 6. Garde-fous ────────────────────────────────────────────────────── */

test('un code non citable fait echouer le filtre plutot qu il ne l elargit', () => {
  assert.throws(() => plan.inList(['ok', 'pas,bon']), /non citable/);
  assert.strictEqual(plan.inList(['nox', 'pm']), '("nox","pm")');
});

test('une erreur de requete remonte en nommant l etape fautive', async () => {
  const client = fakeClient({ failOn: c => c.table === 'emission_points' });
  await assert.rejects(
    () => save(client, 7, { ep_count: '1', ep_1_id: 'EP-01' }),
    /upsert emission_points/
  );
  // Le filet, lui, est deja passe : c'est ce qui rend l etat rattrapable.
  assert.strictEqual(client.calls[0].table, 'submission_pages');
});

/* ── 7. Lecture ───────────────────────────────────────────────────────── */

test('les lignes imbriquees retrouvent leur parent_idx par la structure', () => {
  const subRow = {
    id: 42,
    emission_points: [
      { id: 4711, idx: 1, point_ref: 'EP-01',
        emission_point_pollutants: [{ id: 1, code: 'nox', conc: 120 }] },
      { id: 4712, idx: 2, point_ref: 'EP-02',
        emission_point_pollutants: [{ id: 2, code: 'pm', conc: 5 }] },
    ],
  };
  const rows = plan.collectPageRows(subRow, 7);
  const polls = rows.emission_point_pollutants;
  assert.strictEqual(polls.length, 2);
  assert.strictEqual(polls.find(r => r.code === 'nox').parent_idx, 1);
  assert.strictEqual(polls.find(r => r.code === 'pm').parent_idx, 2);
  // L indice d instance, jamais la cle primaire : c est ce que hydrate lit
  // pour reconstruire ep_2_poll_pm_conc.
  assert.notStrictEqual(polls.find(r => r.code === 'pm').parent_idx, 4712);
});

test('une relation 1:1 rendue comme objet nu est normalisee en tableau', () => {
  const rows = plan.collectPageRows({ id: 42, contacts: { contact_email: 'a@b.eu' } }, 0);
  assert.deepStrictEqual(rows.contacts, [{ contact_email: 'a@b.eu' }]);
});

test('une page jamais enregistree ne rend aucune ligne', () => {
  const rows = plan.collectPageRows({ id: 42, emission_points: [] }, 7);
  assert.deepStrictEqual(rows.emission_points, []);
  assert.deepStrictEqual(rows.emission_point_pollutants, []);
});

/* ── 8. Aller-retour complet a travers le plan ────────────────────────── */

// Le contrat du § 6.3 de la specification est hydrate(dispatch(m)) === m.
// Les tests de db.js le verifient sur des lignes en memoire. Celui-ci le
// verifie a travers la couche de planification : ce sont les lignes reelles
// des upserts, avec leurs cles etrangeres substituees, qui sont relues.
// C'est la meilleure preuve disponible sans base — elle ne dit rien de ce
// que PostgreSQL fera de ces requetes.
test('aller-retour : lignes planifiees -> reponse imbriquee -> carte plate', async () => {
  const flat = {
    ep_count: '2',
    ep_1_id: 'EP-01', ep_1_o2: '11', ep_1_refcond: 'sec',
    ep_2_id: 'EP-02', ep_2_flow_std: '12000',
    ep_1_poll_nox_conc: '120', ep_1_poll_nox_method: 'EN 14792',
    ep_1_poll_nox_limit: '<= 50',
    ep_2_poll_pm_conc: '5',
  };
  const client = fakeClient({ ids: { emission_points: { 1: 4711, 2: 4712 } } });
  await save(client, 7, flat);

  // Reconstruit la reponse que PostgREST rendrait pour pageSelect(7) a
  // partir de ce que la sauvegarde a effectivement envoye.
  const parents = callsTo(client, 'emission_points').find(c => c.op === 'upsert').rows;
  const children = callsTo(client, 'emission_point_pollutants')
    .find(c => c.op === 'upsert').rows;
  const subRow = {
    id: 42,
    emission_points: parents.map(p => Object.assign({}, p, {
      id: { 1: 4711, 2: 4712 }[p.idx],
      emission_point_pollutants: children.filter(
        c => c.emission_point_id === { 1: 4711, 2: 4712 }[p.idx]),
    })),
  };

  const back = require('../docs/db.js').hydrate(plan.collectPageRows(subRow, 7), 7);

  assert.strictEqual(back.ep_count, '2');
  assert.strictEqual(back.ep_1_id, 'EP-01');
  assert.strictEqual(back.ep_1_o2, '11');
  assert.strictEqual(back.ep_1_refcond, 'sec');
  assert.strictEqual(back.ep_2_id, 'EP-02');
  assert.strictEqual(back.ep_2_flow_std, '12000');
  assert.strictEqual(back.ep_1_poll_nox_conc, '120');
  assert.strictEqual(back.ep_1_poll_nox_method, 'EN 14792');
  assert.strictEqual(back.ep_1_poll_nox_limit, '<= 50');
  assert.strictEqual(back.ep_2_poll_pm_conc, '5');
  // Et surtout : rien n'a migre d'un point d'emission vers l'autre.
  assert.strictEqual(back.ep_2_poll_nox_conc, undefined);
  assert.strictEqual(back.ep_1_poll_pm_conc, undefined);
});
