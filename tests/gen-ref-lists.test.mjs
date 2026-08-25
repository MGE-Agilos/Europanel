/* Tests du générateur de seed de ref_lists. En .mjs : tools/gen_ref_lists.mjs
   est un module ES. */
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { buildSeed } from '../tools/gen_ref_lists.mjs';

const require = createRequire(import.meta.url);
const { LISTS } = require('../docs/fields.js');

const { sql, rows, fallbacks } = buildSeed();

// (list_code, code, label, unit, sort_order) de chaque ligne du seed.
const ROW_RE = /^ {2}\('([^']+)', '([^']+)', (?:'((?:[^']|'')*)'|NULL), (?:'((?:[^']|'')*)'|NULL), (\d+), TRUE\)/gm;
const parsed = [...sql.matchAll(ROW_RE)].map(m => ({
  list: m[1], code: m[2], label: m[3], unit: m[4], sort: Number(m[5]),
}));

test('le seed compte une ligne par code du manifeste', () => {
  const expected = Object.values(LISTS).reduce((n, v) => n + v.length, 0);
  assert.strictEqual(rows.length, expected);
  assert.strictEqual(parsed.length, expected);
});

test('chaque code du manifeste est présent, dans l\'ordre, une seule fois', () => {
  for (const [list, codes] of Object.entries(LISTS)) {
    const got = parsed.filter(r => r.list === list);
    assert.deepStrictEqual(got.map(r => r.code), codes, `liste ${list}`);
    assert.deepStrictEqual(got.map(r => r.sort), codes.map((_, i) => i), `ordre de ${list}`);
  }
});

/* Le piège nommé dans la spec : « other » vit dans trois listes avec trois
   sens. Une extraction de libellés par code seul les écraserait ; ce test
   verrouille l'appariement par liste. */
test('un code partagé entre listes reçoit le libellé de sa propre liste', () => {
  const label = (list, code) => parsed.find(r => r.list === list && r.code === code).label;
  const rm = label('raw_materials', 'other');
  const fu = label('fuels', 'other');
  const wg = label('waste_gas_sources', 'other');
  assert.strictEqual(fu, 'Other fuels');
  assert.notStrictEqual(rm, fu);
  assert.notStrictEqual(wg, fu);
  // « toc » est à la fois un polluant atmosphérique et un polluant aqueux.
  assert.ok(parsed.some(r => r.list === 'pollutants' && r.code === 'toc'));
  assert.ok(parsed.some(r => r.list === 'ww_pollutants' && r.code === 'toc'));
});

test('les libellés sont lisibles, pas des reprises du code', () => {
  assert.strictEqual(fallbacks.length, 0,
    'libellé introuvable pour : ' + fallbacks.join(', '));
  const echoes = parsed.filter(r => r.label === r.code);
  assert.deepStrictEqual(echoes.map(r => `${r.list}.${r.code}`), []);
});

test('aucune liste ne porte deux fois le même libellé', () => {
  for (const list of Object.keys(LISTS)) {
    const labels = parsed.filter(r => r.list === list).map(r => r.label);
    assert.strictEqual(new Set(labels).size, labels.length,
      `libellés ambigus dans ${list} : ${labels.join(' | ')}`);
  }
});

test('les unités sont reprises quand le renderer en fournit une', () => {
  const unit = (list, code) => parsed.find(r => r.list === list && r.code === code).unit;
  assert.strictEqual(unit('ww_pollutants', 'tss'), 'mg/L');
  assert.strictEqual(unit('site_activities', 'sawmill'), 'Tonne');
  assert.strictEqual(unit('wood_prep_params', 'airflow'), 'Nm³/h');
  // pH est sans dimension : le « — » du renderer est une mise en page.
  assert.strictEqual(unit('ww_pollutants', 'ph'), undefined);
  assert.strictEqual(unit('pollutants', 'pm'), undefined);
});

test('le seed est idempotent et cible la bonne table', () => {
  assert.ok(sql.includes(
    'INSERT INTO europanel.ref_lists (list_code, code, label, unit, sort_order, active)'));
  assert.ok(sql.includes('ON CONFLICT (list_code, code) DO NOTHING;'));
});
