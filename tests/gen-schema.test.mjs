/* Tests du générateur de DDL. En .mjs et en `import` : tools/gen_schema.mjs
   est un module ES, et `require()` d'un module ES n'est pas garanti sur
   toutes les versions de Node visées. */
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { buildDdl } from '../tools/gen_schema.mjs';

const require = createRequire(import.meta.url);
const { SCHEMA, LISTS } = require('../docs/fields.js');

const sql = buildDdl();

test('génère une table par entrée du manifeste', () => {
  for (const table of Object.keys(SCHEMA)) {
    assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS europanel.${table} (`),
      `table ${table} absente`);
  }
});

test('le nombre de CREATE TABLE générés est celui du manifeste, plus le noyau', () => {
  const total = (sql.match(/CREATE TABLE IF NOT EXISTS europanel\./g) || []).length;
  const core = ['plants', 'cycles', 'ref_lists', 'submission_pages', 'audit_log'];
  assert.strictEqual(total, Object.keys(SCHEMA).length + core.length);
  for (const t of core) {
    assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS europanel.${t} (`), `noyau : ${t}`);
  }
});

test('les tables 1:1 ont submission_id en clé primaire', () => {
  assert.match(sql,
    /europanel\.contacts \([\s\S]*?submission_id\s+BIGINT PRIMARY KEY REFERENCES europanel\.submissions\(id\) ON DELETE CASCADE/);
  for (const [table, e] of Object.entries(SCHEMA)) {
    if (e.kind !== 'one') continue;
    const body = tableBody(table);
    assert.match(body, /submission_id\s+BIGINT PRIMARY KEY/, `${table}`);
    assert.ok(!/\bBIGSERIAL PRIMARY KEY\b/.test(body), `${table} ne doit pas avoir de id sérial`);
  }
});

test('les sections répétables ont idx et une contrainte d\'unicité', () => {
  assert.match(tableBody('dryers'), /idx\s+SMALLINT NOT NULL/);
  assert.ok(sql.includes('UNIQUE (submission_id, idx)'));
  for (const [table, e] of Object.entries(SCHEMA)) {
    if (e.kind !== 'many') continue;
    const body = tableBody(table);
    const parentCol = e.parent ? `${e.parent}_id` : 'submission_id';
    assert.match(body, /idx\s+SMALLINT NOT NULL/, `${table}: idx manquant`);
    assert.ok(body.includes(`UNIQUE (${parentCol}, idx)`), `${table}: unicité manquante`);
  }
});

test('les groupes à clés ont code, une unicité et la FK composite vers ref_lists', () => {
  for (const [table, e] of Object.entries(SCHEMA)) {
    if (e.kind !== 'keyed') continue;
    const body = tableBody(table);
    const parentCol = e.parent ? `${e.parent}_id` : 'submission_id';
    assert.match(body, /code\s+TEXT NOT NULL/, `${table}: code manquant`);
    assert.ok(body.includes(`UNIQUE (${parentCol}, code)`), `${table}: unicité manquante`);
    assert.ok(body.includes(`list_code`), `${table}: list_code manquante`);
    assert.ok(
      body.includes(`TEXT GENERATED ALWAYS AS ('${e.list}') STORED`),
      `${table}: list_code n'est pas figée sur « ${e.list} »`);
    assert.ok(
      body.includes('FOREIGN KEY (list_code, code) REFERENCES europanel.ref_lists (list_code, code)'),
      `${table}: FK composite manquante`);
    assert.ok(LISTS[e.list], `${table}: liste « ${e.list} » absente du manifeste`);
  }
});

test('ref_lists est créée avant toute table qui la référence', () => {
  const refPos = sql.indexOf('CREATE TABLE IF NOT EXISTS europanel.ref_lists (');
  assert.ok(refPos >= 0);
  for (const [table, e] of Object.entries(SCHEMA)) {
    if (e.kind !== 'keyed') continue;
    assert.ok(sql.indexOf(`CREATE TABLE IF NOT EXISTS europanel.${table} (`) > refPos,
      `${table} précède ref_lists`);
  }
});

test('chaque table est créée après celle qu\'elle référence', () => {
  for (const [table, e] of Object.entries(SCHEMA)) {
    if (!e.parent) continue;
    assert.ok(
      sql.indexOf(`CREATE TABLE IF NOT EXISTS europanel.${e.parent} (`) <
      sql.indexOf(`CREATE TABLE IF NOT EXISTS europanel.${table} (`),
      `${table} précède son parent ${e.parent}`);
  }
});

test('les colonnes numériques sont NUMERIC et les entières SMALLINT', () => {
  assert.match(tableBody('dryers'), /temp_max\s+NUMERIC/);
  assert.match(tableBody('dryers'), /install_year\s+SMALLINT/);
  assert.match(tableBody('bat_candidate'), /bat_cat_air\s+BOOLEAN/);
  assert.match(tableBody('contacts'), /contact_email\s+TEXT/);
});

test('chaque colonne du manifeste est émise avec le type déclaré', () => {
  const SQL_TYPE = { text: 'TEXT', num: 'NUMERIC', int: 'SMALLINT', bool: 'BOOLEAN' };
  for (const [table, e] of Object.entries(SCHEMA)) {
    const body = tableBody(table);
    for (const [col, type] of Object.entries(e.cols)) {
      assert.match(body, new RegExp(`\\n  ${col}\\s+${SQL_TYPE[type]},?\\n`),
        `${table}.${col} attendu en ${SQL_TYPE[type]}`);
    }
  }
});

test('le nombre total de colonnes de questionnaire émises est celui du manifeste', () => {
  let expected = 0;
  for (const e of Object.values(SCHEMA)) expected += Object.keys(e.cols).length;
  let emitted = 0;
  for (const [table, e] of Object.entries(SCHEMA)) {
    const body = tableBody(table);
    for (const col of Object.keys(e.cols)) {
      if (new RegExp(`\\n  ${col}\\s`).test(body)) emitted++;
    }
  }
  assert.strictEqual(emitted, expected);
});

/* Le point qui compte : un alias décrit le segment de NOM DE CHAMP HTML,
   jamais le nom de colonne. `limit` et `desc` sont des mots réservés
   PostgreSQL et `id` est pris par la clé primaire de substitution : les
   émettre comme noms de colonnes réintroduirait les collisions que les
   alias existent pour éviter. */
test('une colonne aliasée est émise sous son nom de colonne, pas sous son segment de champ', () => {
  const poll = tableBody('emission_point_pollutants');
  assert.match(poll, /\n  limit_val\s+TEXT/);
  assert.ok(!/\n  limit\s/.test(poll), 'le segment « limit » ne doit pas être un nom de colonne');

  const ep = tableBody('emission_points');
  assert.match(ep, /\n  point_ref\s+TEXT/);
  assert.ok(!/\n  id\s+TEXT/.test(ep), 'le segment « id » ne doit pas être une colonne texte');

  for (const t of ['combustion_unit_fuels', 'waste_streams']) {
    const body = tableBody(t);
    assert.match(body, /\n  description\s+TEXT/, `${t}: colonne description attendue`);
    assert.ok(!/\n  desc\s/.test(body), `${t}: le segment « desc » ne doit pas être une colonne`);
  }

  // Vérification générale : une fois retirées les colonnes de structure,
  // les colonnes émises sont exactement les clés de `cols`. Un alias glissé
  // dans le DDL, ou une colonne renommée, casse cette égalité.
  // `ep_1_id` alias vers la colonne `point_ref` : la colonne `id` qui subsiste
  // dans emission_points est bien la clé primaire de substitution, structurelle,
  // et c'est précisément la collision que l'alias existe pour éviter.
  const STRUCTURAL = new Set(['id', 'submission_id', 'idx', 'code', 'list_code']);
  for (const [table, e] of Object.entries(SCHEMA)) {
    const structural = new Set(STRUCTURAL);
    if (e.parent) structural.add(`${e.parent}_id`);
    const emitted = columnNamesOf(table).filter(n => !structural.has(n));
    assert.deepStrictEqual(emitted, Object.keys(e.cols),
      `${table}: colonnes émises différentes des colonnes du manifeste`);
  }
});

test('les tables enfants référencent leur parent en CASCADE', () => {
  assert.match(sql,
    /emission_point_pollutants[\s\S]*?REFERENCES europanel\.emission_points\(id\) ON DELETE CASCADE/);
  for (const [table, e] of Object.entries(SCHEMA)) {
    if (!e.parent) continue;
    assert.ok(
      tableBody(table).includes(
        `${e.parent}_id  BIGINT NOT NULL REFERENCES europanel.${e.parent}(id) ON DELETE CASCADE`) ||
      new RegExp(`${e.parent}_id\\s+BIGINT NOT NULL REFERENCES europanel\\.${e.parent}\\(id\\) ON DELETE CASCADE`)
        .test(tableBody(table)),
      `${table}: FK parent manquante ou sans CASCADE`);
  }
});

test('toute table porte un index sur sa colonne de rattachement', () => {
  for (const [table, e] of Object.entries(SCHEMA)) {
    if (e.kind === 'one') continue;   // submission_id y est la clé primaire
    const col = e.parent ? `${e.parent}_id` : 'submission_id';
    assert.ok(sql.includes(`ON europanel.${table}(${col});`), `${table}: index manquant`);
  }
});

test('chaque table porte RLS et quatre politiques', () => {
  assert.ok(sql.includes('ALTER TABLE europanel.dryers ENABLE ROW LEVEL SECURITY'));
  for (const op of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    assert.ok(sql.includes(`FOR ${op} TO authenticated`), `politique ${op} absente`);
  }
  for (const table of Object.keys(SCHEMA)) {
    assert.ok(sql.includes(`ALTER TABLE europanel.${table} ENABLE ROW LEVEL SECURITY;`),
      `${table}: RLS non activée`);
    for (const op of ['select', 'insert', 'update', 'delete']) {
      assert.ok(sql.includes(`CREATE POLICY "ep_${table}_${op}" ON europanel.${table}`),
        `${table}: politique ${op} absente`);
    }
  }
});

test('INSERT utilise WITH CHECK, les autres opérations USING', () => {
  for (const table of Object.keys(SCHEMA)) {
    const ins = policyBody(table, 'INSERT');
    assert.ok(ins.includes('WITH CHECK ('), `${table}: INSERT sans WITH CHECK`);
    for (const op of ['SELECT', 'UPDATE', 'DELETE']) {
      const p = policyBody(table, op);
      assert.ok(p.includes('USING ('), `${table}: ${op} sans USING`);
      assert.ok(!p.includes('WITH CHECK'), `${table}: ${op} ne doit pas porter WITH CHECK`);
    }
  }
});

test('le prédicat RLS remonte jusqu\'à submissions.user_id', () => {
  const root = 'submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())';
  assert.ok(policyBody('contacts', 'SELECT').includes(root));
  assert.ok(policyBody('dryers', 'SELECT').includes(root));
  // Enfant imbriqué : filtre sur le parent, lui-même filtré.
  assert.ok(policyBody('emission_point_pollutants', 'SELECT').includes(
    `emission_points_id IN (SELECT id FROM europanel.emission_points WHERE ${root})`));
  // Aucune politique ne doit s'arrêter avant user_id.
  for (const table of Object.keys(SCHEMA)) {
    for (const op of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
      assert.ok(policyBody(table, op).includes('user_id = auth.uid()'),
        `${table}/${op}: le prédicat ne remonte pas à submissions.user_id`);
    }
  }
});

test('le noyau porte RLS : référentiels en lecture seule, journal en insertion seule', () => {
  for (const t of ['plants', 'cycles', 'ref_lists', 'submission_pages', 'audit_log']) {
    assert.ok(sql.includes(`ALTER TABLE europanel.${t}`) &&
      new RegExp(`ALTER TABLE europanel\\.${t}\\s+ENABLE ROW LEVEL SECURITY;`).test(sql),
    `${t}: RLS non activée`);
  }
  for (const t of ['ref_lists', 'plants', 'cycles']) {
    assert.ok(sql.includes(`CREATE POLICY "ep_${t}_select" ON europanel.${t}`));
    for (const op of ['insert', 'update', 'delete']) {
      assert.ok(!sql.includes(`CREATE POLICY "ep_${t}_${op}"`), `${t}: ${op} ne doit pas être ouvert`);
    }
  }
  assert.ok(sql.includes('CREATE POLICY "ep_audit_log_insert" ON europanel.audit_log'));
  assert.ok(!sql.includes('ep_audit_log_update'), 'audit_log doit rester append-only');
  assert.ok(!sql.includes('ep_audit_log_delete'), 'audit_log doit rester append-only');
  assert.ok(sql.includes('CREATE POLICY "ep_submission_pages_all" ON europanel.submission_pages'));
});

/* ── Utilitaires de découpe ───────────────────────────────────────────── */

function tableBody(table) {
  const head = `CREATE TABLE IF NOT EXISTS europanel.${table} (`;
  const from = sql.indexOf(head);
  assert.ok(from >= 0, `table ${table} absente du DDL`);
  const to = sql.indexOf('\n);', from);
  assert.ok(to > from, `table ${table} : fin de définition introuvable`);
  return sql.slice(from + head.length, to + 1);
}

// Noms de colonnes déclarés dans le CREATE TABLE, dans l'ordre d'émission.
// Les lignes de contrainte (UNIQUE, FOREIGN KEY, PRIMARY KEY de table) sont
// écartées : elles ne commencent pas par un identifiant en minuscules suivi
// d'un type.
function columnNamesOf(table) {
  return tableBody(table)
    .split('\n')
    .map(l => /^ {2}([a-z_][a-z0-9_]*) {2,}\S/.exec(l))
    .filter(Boolean)
    .map(m => m[1]);
}

function policyBody(table, op) {
  const head = `CREATE POLICY "ep_${table}_${op.toLowerCase()}" ON europanel.${table}`;
  const from = sql.indexOf(head);
  assert.ok(from >= 0, `politique ${op} de ${table} absente`);
  const to = sql.indexOf(';', from);
  return sql.slice(from, to);
}
