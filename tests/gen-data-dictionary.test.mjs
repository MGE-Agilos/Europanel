/* Tests of the data dictionary generator. In .mjs and with `import`, like
   gen-schema.test.mjs: tools/gen_data_dictionary.mjs is an ES module, and
   `require()` of an ES module is not guaranteed on every Node version this
   project targets. */
import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { buildModel, buildMarkdown } from '../tools/gen_data_dictionary.mjs';

const require = createRequire(import.meta.url);
const { SCHEMA, LISTS } = require('../docs/fields.js');

const model = buildModel();
const md = buildMarkdown(model);

test('every manifest table appears in the generated Markdown', () => {
  for (const table of Object.keys(SCHEMA)) {
    assert.ok(md.includes(`\`${table}\``),
      `table "${table}" is not mentioned in the generated document`);
    assert.match(md, new RegExp(`<!-- table: ${table} kind=\\w+ page=\\d+ -->`),
      `table "${table}" has no table marker`);
  }
});

test('the column count in the generated document matches the manifest', () => {
  let expected = 0;
  for (const e of Object.values(SCHEMA)) expected += Object.keys(e.cols).length;
  assert.strictEqual(expected, 233, 'sanity: manifest itself should have 233 columns');

  const markers = md.match(/<!-- column: [\w.]+ type=\w+ alias=(true|false) -->/g) || [];
  assert.strictEqual(markers.length, expected,
    `expected ${expected} documented columns, found ${markers.length}`);

  // Cross-check against the model's own accounting.
  const modelColumns = model.pages.reduce(
    (n, p) => n + p.tables.reduce((m, t) => m + t.columns.length, 0), 0);
  assert.strictEqual(modelColumns, expected);
  assert.strictEqual(model.counts.columns, expected);
});

test('every aliased column is documented as such, and no non-aliased column is', () => {
  for (const [table, entry] of Object.entries(SCHEMA)) {
    for (const col of Object.keys(entry.cols)) {
      const seg = (entry.aliases && entry.aliases[col]) || col;
      const isAliased = seg !== col;
      const marker = new RegExp(
        `<!-- column: ${table}\\.${col} type=\\w+ alias=${isAliased} -->\\n` +
        `\\| \`${col}\` \\| \\w+ \\| \`[^\`]+\` \\| ([^|]*) \\|`);
      const m = md.match(marker);
      assert.ok(m, `${table}.${col}: expected alias=${isAliased} marker not found`);
      if (isAliased) {
        assert.match(m[1], /Aliased:/,
          `${table}.${col}: aliased column not documented as such (segment "${seg}")`);
        assert.ok(m[1].includes(`\`${seg}\``),
          `${table}.${col}: Notes should name the aliased segment "${seg}"`);
      } else {
        assert.ok(!/Aliased:/.test(m[1]),
          `${table}.${col}: non-aliased column wrongly documented as aliased`);
      }
    }
  }
});

test('every reference list appears, with every one of its codes', () => {
  assert.strictEqual(Object.keys(LISTS).length, 14, 'sanity: manifest itself should have 14 lists');
  for (const [listName, codes] of Object.entries(LISTS)) {
    assert.match(md, new RegExp(`<!-- reflist: ${listName} count=${codes.length} -->`),
      `reference list "${listName}" missing or wrong entry count`);
    for (const code of codes) {
      assert.ok(md.includes(`\`${code}\``),
        `code "${code}" of list "${listName}" not found in the document`);
    }
  }
  assert.strictEqual(model.refLists.length, 14);
});

test('every core table (migration 001 + hand-written) is documented', () => {
  const expectedCore = ['companies', 'submissions', 'plants', 'cycles', 'ref_lists',
    'submission_pages', 'audit_log'];
  assert.strictEqual(model.core.length, expectedCore.length);
  for (const t of expectedCore) {
    assert.ok(md.includes(`\`${t}\``), `core table "${t}" not documented`);
  }
  // submission_pages.raw must be explained as the regeneration mechanism.
  const raw = model.core.find(c => c.table === 'submission_pages');
  assert.match(raw.purpose, /`raw`/);
  assert.match(raw.purpose, /regenerab/i);
});

test('the known-inconsistencies section names all four documented cases', () => {
  assert.strictEqual(model.inconsistencies.length, 4);
  assert.match(md, /## 6\. Known inconsistencies/);
  assert.match(md, /ref_year/);
  assert.match(md, /chan_air/);
  assert.match(md, /install_year/);
  assert.match(md, /limit_val/);
});

test('the document states it is generated and gives a date', () => {
  assert.match(md, /generated/i);
  assert.match(md, /Generated on \d{4}-\d{2}-\d{2}/);
});

test('buildModel() is deterministic in shape across calls', () => {
  const again = buildModel();
  assert.deepStrictEqual(Object.keys(again.counts).sort(), Object.keys(model.counts).sort());
  assert.strictEqual(again.pages.length, model.pages.length);
});
