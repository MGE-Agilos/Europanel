/* ══════════════════════════════════════════════════════════════════════
   Tests du script de reprise — la part qui ne demande aucune base.

   Ce qu'ils couvrent : la detection des clefs JSONB qu'aucune entree du
   manifeste ne revendique, la separation entre clef vide et clef porteuse
   de valeur, et le releve des pertes a la conversion de type.

   Ce qu'ils ne couvrent PAS : les deux phases contre une vraie base. Le
   double de client prouve la forme des requetes, pas que PostgreSQL les
   accepte, ni que les cles etrangeres tiennent. Ca ne se verifie qu'en
   lancant le script.
   ══════════════════════════════════════════════════════════════════════ */
import test from 'node:test';
import assert from 'node:assert';
import {
  auditRow, auditRows, classifyCoercion, copyRows, pageStatus,
  parseArgs, parseEnv, recordingClient, refListGaps, missingSubmissions,
  buildReport, formatSummary, SCAN_IDX,
} from '../supabase/migrate/jsonb_to_relational.mjs';

/* ── Clefs non couvertes ──────────────────────────────────────────────── */

test('une carte plate entierement conforme ne produit aucune clef non couverte', () => {
  const row = {
    submission_id: 1, page_id: 0,
    data: { contact_company: 'Agilos', contact_name: 'Georges', twg_ms_state: '' },
  };
  assert.deepStrictEqual(auditRow(row).unmapped, []);
});

test('une clef inconnue plantee dans la carte est trouvee, avec sa soumission et sa page', () => {
  const row = {
    submission_id: 42, page_id: 0,
    data: { contact_name: 'Georges', contact_favourite_colour: 'bleu' },
  };
  const { unmapped } = auditRow(row);
  assert.strictEqual(unmapped.length, 1);
  assert.deepStrictEqual(unmapped[0], {
    submission_id: 42,
    page_id: 0,
    key: 'contact_favourite_colour',
    filled: true,
    value: 'bleu',
    reason: 'unknown',
  });
});

test('une clef inconnue est trouvee sur chacune des pages porteuses de champs', () => {
  for (let page = 0; page <= 11; page++) {
    const row = { submission_id: 7, page_id: page, data: { champ_invente_xyz: 'v' } };
    const { unmapped } = auditRow(row);
    assert.strictEqual(unmapped.length, 1, 'page ' + page);
    assert.strictEqual(unmapped[0].key, 'champ_invente_xyz', 'page ' + page);
  }
});

test('clef vide et clef porteuse de valeur sont comptees separement', () => {
  const row = {
    submission_id: 3, page_id: 1,
    data: {
      plant_name: 'test',
      inconnu_rempli: 'une valeur',
      inconnu_vide: '',
      inconnu_blanc: '   ',
      inconnu_nul: null,
    },
  };
  const { unmapped } = auditRow(row);
  const byKey = Object.fromEntries(unmapped.map(u => [u.key, u]));
  assert.strictEqual(unmapped.length, 4);
  assert.strictEqual(byKey.inconnu_rempli.filled, true);
  assert.strictEqual(byKey.inconnu_rempli.value, 'une valeur');
  // Blanc et null valent vide : toDb les traite deja ainsi (voir docs/db.js).
  assert.strictEqual(byKey.inconnu_vide.filled, false);
  assert.strictEqual(byKey.inconnu_blanc.filled, false);
  assert.strictEqual(byKey.inconnu_nul.filled, false);
  // Une clef vide ne fait pas remonter sa valeur dans le rapport.
  assert.strictEqual(byKey.inconnu_vide.value, '');

  const filled = unmapped.filter(u => u.filled);
  assert.strictEqual(filled.length, 1);
  assert.strictEqual(unmapped.length - filled.length, 3);
});

test('le total des clefs et des clefs porteuses de valeur est celui de la carte', () => {
  const rows = [
    { submission_id: 1, page_id: 1, data: { plant_name: 'a', ref_year: '', company: 'b' } },
    { submission_id: 1, page_id: 10, data: { wc_process: '12', wc_other: '  ' } },
  ];
  const a = auditRows(rows);
  assert.strictEqual(a.keys, 5);
  assert.strictEqual(a.filledKeys, 3);
});

test('une clef d\'instance supprimee est distinguee d\'une clef inconnue', () => {
  // dryer_count vaut 1 : le dispatcher n'ecrira que dryer_1_*. dryer_2_product
  // est un reliquat — un vrai champ du manifeste, mais a un indice que le
  // comptage ne retient pas. Il n'est pas repris pour autant : il doit
  // remonter, avec sa raison propre.
  const row = {
    submission_id: 9, page_id: 5,
    data: { dryer_count: '1', dryer_1_product: 'MDF', dryer_2_product: 'PB',
            press_count: '0', truc_inconnu: 'x' },
  };
  const byKey = Object.fromEntries(auditRow(row).unmapped.map(u => [u.key, u]));
  assert.strictEqual(byKey.dryer_2_product.reason, 'orphan_instance');
  assert.strictEqual(byKey.dryer_2_product.filled, true);
  assert.strictEqual(byKey.truc_inconnu.reason, 'unknown');
  assert.ok(!byKey.dryer_1_product, 'dryer_1_product est couvert');
});

test('le compteur d\'une section repetable est revendique par le manifeste', () => {
  // Il n'est pas une colonne — il se reconstruit depuis COUNT(*) — mais le
  // faire remonter comme non couvert a chaque page noierait le signal.
  const row = { submission_id: 1, page_id: 4, data: { cu_count: '4' } };
  assert.deepStrictEqual(auditRow(row).unmapped, []);
});

test('les clefs d\'une table enfant sont couvertes quand le parent existe', () => {
  const row = {
    submission_id: 1, page_id: 4,
    data: { cu_count: '1', cu_1_fuel_natgas_pct: '50', cu_1_fuel_natgas_desc: 'gaz' },
  };
  assert.deepStrictEqual(auditRow(row).unmapped, []);
});

test('les clefs d\'une table enfant sans parent compte remontent comme orphelines', () => {
  // tech_count absent et aucun tech_1_* : countInstances rend 0, donc le
  // dispatcher n'ecrira aucune source. La donnee existe pourtant.
  const row = {
    submission_id: 1, page_id: 6,
    data: { tech_1_src_dryer_yn: 'y' },
  };
  const { unmapped } = auditRow(row);
  assert.strictEqual(unmapped.length, 1);
  assert.strictEqual(unmapped[0].key, 'tech_1_src_dryer_yn');
  assert.strictEqual(unmapped[0].reason, 'orphan_instance');
  assert.strictEqual(unmapped[0].filled, true);
});

test('le balayage des orphelines est borne', () => {
  const idx = SCAN_IDX + 5;
  const row = {
    submission_id: 1, page_id: 5,
    data: { dryer_count: '1', ['dryer_' + idx + '_product']: 'x' },
  };
  const u = auditRow(row).unmapped.find(x => x.key === 'dryer_' + idx + '_product');
  // Au-dela de la borne, on ne pretend pas reconnaitre : « unknown » est la
  // reponse honnete, et la clef remonte quand meme.
  assert.strictEqual(u.reason, 'unknown');
});

/* ── Pertes a la conversion ───────────────────────────────────────────── */

test('classifyCoercion : ce qui ne perd rien ne remonte pas', () => {
  assert.strictEqual(classifyCoercion('', null, 'num'), null);
  assert.strictEqual(classifyCoercion('   ', null, 'num'), null);
  assert.strictEqual(classifyCoercion(undefined, null, 'num'), null);
  assert.strictEqual(classifyCoercion('12', 12, 'num'), null);
  assert.strictEqual(classifyCoercion(' 12 ', 12, 'num'), null);
  assert.strictEqual(classifyCoercion('0', 0, 'num'), null);
  assert.strictEqual(classifyCoercion('<= 50', '<= 50', 'text'), null);
  assert.strictEqual(classifyCoercion('on', true, 'bool'), null);
});

test('classifyCoercion : une valeur non numerique mise a null est une perte', () => {
  const v = classifyCoercion('n/a', null, 'num');
  assert.strictEqual(v.kind, 'dropped');
});

test('classifyCoercion : une valeur booleenne autre que « on » est une perte', () => {
  assert.strictEqual(classifyCoercion('true', false, 'bool').kind, 'dropped');
});

test('classifyCoercion : une reecriture numerique est signalee comme alteration', () => {
  assert.strictEqual(classifyCoercion('1.50', 1.5, 'num').kind, 'altered');
  assert.strictEqual(classifyCoercion('2010.4', 2010, 'int').kind, 'altered');
});

test('une valeur texte dans une colonne numerique est relevee, avec sa destination', () => {
  const row = {
    submission_id: 5, page_id: 10,
    data: { wc_process: 'n.a.', wc_cooling: '12' },
  };
  const { coercions } = auditRow(row);
  assert.strictEqual(coercions.length, 1);
  const c = coercions[0];
  assert.strictEqual(c.kind, 'dropped');
  assert.strictEqual(c.field, 'wc_process');
  assert.strictEqual(c.table, 'water_consumption');
  assert.strictEqual(c.column, 'wc_process');
  assert.strictEqual(c.type, 'num');
  assert.strictEqual(c.original, 'n.a.');
  assert.strictEqual(c.result, null);
  assert.strictEqual(c.submission_id, 5);
  assert.strictEqual(c.page_id, 10);
});

test('une perte est relevee jusque dans une table enfant, sous son nom de champ', () => {
  const row = {
    submission_id: 8, page_id: 4,
    data: { cu_count: '1', cu_1_fuel_natgas_pct: 'environ 50' },
  };
  const { coercions } = auditRow(row);
  assert.strictEqual(coercions.length, 1);
  assert.strictEqual(coercions[0].field, 'cu_1_fuel_natgas_pct');
  assert.strictEqual(coercions[0].table, 'combustion_unit_fuels');
  assert.strictEqual(coercions[0].column, 'pct');
  assert.strictEqual(coercions[0].kind, 'dropped');
});

test('une annee fractionnaire dans une colonne entiere est relevee comme alteration', () => {
  const row = { submission_id: 2, page_id: 1, data: { ref_year: '2010.6' } };
  const { coercions } = auditRow(row);
  assert.strictEqual(coercions.length, 1);
  assert.strictEqual(coercions[0].kind, 'altered');
  assert.strictEqual(coercions[0].original, '2010.6');
  assert.strictEqual(coercions[0].result, '2011');
});

test('un champ texte libre n\'est jamais releve, meme quand il ressemble a un nombre', () => {
  // ep_1_poll_pm_limit est deliberement 'text' dans le manifeste : une
  // limite de permis s'ecrit « <= 50 ». Le relever serait un faux positif.
  const row = {
    submission_id: 4, page_id: 7,
    data: { ep_count: '1', ep_1_poll_pm_limit: '<= 50', ep_1_ref_year: '2023/2024' },
  };
  assert.deepStrictEqual(auditRow(row).coercions, []);
  assert.deepStrictEqual(auditRow(row).unmapped, []);
});

/* ── Copie ────────────────────────────────────────────────────────────── */

test('la copie reprend la charge brute verbatim', () => {
  const data = { a: '1', b: '', c: 'texte avec « guillemets »' };
  const [out] = copyRows([{ submission_id: 1, page_id: 3, data, saved_at: '2026-04-16T10:00:00Z' }]);
  assert.deepStrictEqual(out.raw, data);
  assert.strictEqual(out.submission_id, 1);
  assert.strictEqual(out.page_id, 3);
  assert.strictEqual(out.saved_at, '2026-04-16T10:00:00Z');
  assert.strictEqual(out.status, 'complete');
});

test('une page sans aucune valeur est copiee avec le statut « empty »', () => {
  assert.strictEqual(pageStatus({ a: '', b: '' }), 'empty');
  assert.strictEqual(pageStatus({}), 'empty');
  assert.strictEqual(pageStatus({ a: '', b: 'x' }), 'complete');
});

/* ── Controles prealables ─────────────────────────────────────────────── */

test('un code du manifeste absent de ref_lists est signale', () => {
  const gaps = refListGaps([{ list_code: 'fuels', code: 'natgas' }]);
  assert.ok(gaps.length > 0);
  assert.ok(gaps.some(g => g.list_code === 'fuels' && g.code === 'prod_res'));
  assert.ok(!gaps.some(g => g.list_code === 'fuels' && g.code === 'natgas'));
});

test('une soumission referencee par page_data mais absente est signalee', () => {
  const rows = [{ submission_id: 1 }, { submission_id: 7 }, { submission_id: 7 }];
  assert.deepStrictEqual(missingSubmissions(rows, [1, 2]), [7]);
  assert.deepStrictEqual(missingSubmissions(rows, [1, 7]), []);
});

/* ── Arguments ────────────────────────────────────────────────────────── */

test('le mode par defaut n\'ecrit pas', () => {
  const a = parseArgs([]);
  assert.strictEqual(a.mode, 'dry-run');
  assert.strictEqual(a.writes, false);
});

test('ecrire demande un mode explicite', () => {
  assert.strictEqual(parseArgs(['--copy']).writes, true);
  assert.strictEqual(parseArgs(['--regenerate']).mode, 'regenerate');
  assert.strictEqual(parseArgs(['--apply']).mode, 'apply');
  assert.strictEqual(parseArgs(['--copy', '--regenerate']).mode, 'apply');
  assert.strictEqual(parseArgs(['--dry-run']).writes, false);
});

test('un argument inconnu arrete le script plutot que de valoir dry-run', () => {
  assert.throws(() => parseArgs(['--aply']), /argument inconnu/);
  // Une faute de frappe sur un mode d'ecriture ne doit surtout pas se
  // rabattre silencieusement sur autre chose.
  assert.throws(() => parseArgs(['--dry-run', '--apply']), /exclusif/);
});

test('parseEnv lit les paires et ignore commentaires et lignes vides', () => {
  const env = parseEnv('# commentaire\n\nSUPABASE_URL=https://x.supabase.co\nK="v=v"\n');
  assert.strictEqual(env.SUPABASE_URL, 'https://x.supabase.co');
  assert.strictEqual(env.K, 'v=v');
  assert.strictEqual(Object.keys(env).length, 2);
});

/* ── Le plan d'ecriture tourne bien contre le double ──────────────────── */

test('le double de client rend des cles primaires permettant de rattacher les enfants', async () => {
  const { dispatch } = await import('../docs/db.js').then(m => m.default || m);
  const plan = await import('../docs/db-plan.js').then(m => m.default || m);
  const tally = { upserts: {}, deletes: {} };
  const client = recordingClient(tally);
  const flat = { cu_count: '1', cu_1_thermal_input: '25', cu_1_fuel_natgas_pct: '50' };
  await plan.applyPagePlan(client, {
    ops: dispatch(flat, 4),
    submissionId: 1, pageId: 4, status: 'complete', raw: flat,
    savedAt: '2026-04-16T10:00:00Z',
  });
  assert.strictEqual(tally.upserts.submission_pages, 1);
  assert.strictEqual(tally.upserts.combustion_units, 1);
  // La ligne enfant n'existe que si la cle du parent a bien ete moissonnee.
  assert.strictEqual(tally.upserts.combustion_unit_fuels, 1);
  const child = client.calls.find(c => c.table === 'combustion_unit_fuels' && c.op === 'upsert');
  assert.ok(child, 'aucun upsert sur la table enfant');
});

/* ── Rapport ──────────────────────────────────────────────────────────── */

function reportParts(over) {
  return Object.assign({
    mode: 'dry-run',
    source: 'europanel.page_data.data',
    rows: [],
    audit: { unmapped: [], coercions: [], keys: 0, filledKeys: 0 },
    copyTally: { upserts: {}, deletes: {} },
    regenTally: { upserts: {}, deletes: {} },
    errors: [], gaps: [], missingSubs: [], copied: 0, regenerated: 0,
  }, over);
}

test('le verdict est sur quand rien ne remonte', () => {
  const r = buildReport(reportParts({}));
  assert.strictEqual(r.verdict.safe, true);
  assert.match(r.verdict.line, /reprise sure/);
});

test('une clef non couverte porteuse de valeur rend le verdict negatif', () => {
  const r = buildReport(reportParts({
    audit: {
      unmapped: [{ submission_id: 1, page_id: 0, key: 'x', filled: true, value: 'v', reason: 'unknown' }],
      coercions: [], keys: 1, filledKeys: 1,
    },
  }));
  assert.strictEqual(r.verdict.safe, false);
  assert.strictEqual(r.totals.unmapped_keys_with_value, 1);
  assert.match(r.verdict.line, /NE PAS APPLIQUER/);
});

test('une clef non couverte vide reste un verdict sur, avec une note', () => {
  const r = buildReport(reportParts({
    audit: {
      unmapped: [{ submission_id: 1, page_id: 0, key: 'x', filled: false, value: '', reason: 'unknown' }],
      coercions: [], keys: 1, filledKeys: 0,
    },
  }));
  assert.strictEqual(r.verdict.safe, true);
  assert.strictEqual(r.totals.unmapped_keys_empty, 1);
  assert.strictEqual(r.notes.length, 1);
});

test('une perte a la conversion rend le verdict negatif ; une alteration non', () => {
  const dropped = buildReport(reportParts({
    audit: { unmapped: [], coercions: [{ kind: 'dropped' }], keys: 0, filledKeys: 0 },
  }));
  assert.strictEqual(dropped.verdict.safe, false);
  assert.strictEqual(dropped.totals.coercion_dropped, 1);

  const altered = buildReport(reportParts({
    audit: { unmapped: [], coercions: [{ kind: 'altered' }], keys: 0, filledKeys: 0 },
  }));
  assert.strictEqual(altered.verdict.safe, true);
  assert.strictEqual(altered.totals.coercion_altered, 1);
});

test('le rapport ne contient aucune trace de la cle de service', () => {
  const r = buildReport(reportParts({}));
  const text = JSON.stringify(r) + formatSummary(r);
  assert.ok(!/SERVICE_ROLE|eyJhbGciOi/i.test(text));
});

test('le resume mentionne les clefs non couvertes porteuses de valeur', () => {
  const r = buildReport(reportParts({
    audit: {
      unmapped: [{ submission_id: 3, page_id: 2, key: 'clef_perdue', filled: true,
                   value: 'valeur', reason: 'unknown' }],
      coercions: [], keys: 1, filledKeys: 1,
    },
  }));
  const s = formatSummary(r);
  assert.match(s, /clef_perdue/);
  assert.match(s, /sub 3 page 2/);
});
