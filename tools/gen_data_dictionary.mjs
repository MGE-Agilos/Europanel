/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Data dictionary generator.

   Usage:
     node tools/gen_data_dictionary.mjs             > EuroPanel_DataDictionary.md
     node tools/gen_data_dictionary.mjs --json       (model consumed by
                                                       tools/gen_data_dictionary_docx.py)

   This is a contractual deliverable to the European Panel Federation: a
   description of every field, its meaning, unit, allowed values, and the
   questionnaire item it corresponds to, so a third party can extract and
   understand the data without reading the code.

   It is generated from docs/fields.js — the same manifest that generates
   the SQL schema (tools/gen_schema.mjs) and the reference-list seed
   (tools/gen_ref_lists.mjs) — plus the generated artefacts themselves
   (supabase/migrations/002_relational_schema.sql and 003_seed_ref_lists.sql),
   read as text so the dictionary cannot describe a table or a reference
   entry that the database does not actually have.

   NOT MODIFIED BY THIS FILE, only read: docs/fields.js, docs/db.js,
   docs/app.js, supabase/migrations/*.sql. If the manifest changes shape,
   fix this generator, not the output.
   ══════════════════════════════════════════════════════════════════════ */
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { SCHEMA, LISTS } = require('../docs/fields.js');
const { buildName, fieldSegment, parentColumn } = require('../docs/db.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const SQL_TYPE = { text: 'TEXT', num: 'NUMERIC', int: 'SMALLINT', bool: 'BOOLEAN' };

// The five tables written by hand in tools/gen_schema.mjs (CORE_SQL), in the
// order they are emitted there. Kept as a literal list rather than parsed
// out of gen_schema.mjs: that file is out of scope for this generator to
// touch or introspect beyond the SQL it produces (see assertSchemaSync).
const HAND_WRITTEN_CORE = ['plants', 'cycles', 'ref_lists', 'submission_pages', 'audit_log'];

/* ── Core tables — not in the manifest, described by hand here ──────────
   These carry no questionnaire field, so docs/fields.js has nothing to say
   about them. Coverage of this list against migration 001 and the
   hand-written section of 002 is asserted in assertSchemaSync(). */
const CORE_TABLE_META = [
  { table: 'companies', source: 'migration 001', purpose:
    'The operator company or member-federation entity a submission belongs to.' },
  { table: 'submissions', source: 'migration 001', purpose:
    'One row per questionnaire submission: the owning user, its company, reporting ' +
    'cycle, plant, and status (draft / submitted). Every other table ultimately ' +
    'traces back to a submission.' },
  { table: 'plants', source: 'migration 002 (hand-written)', purpose:
    'A physical production site belonging to a company. A company may operate more ' +
    'than one plant; a submission can be linked to one.' },
  { table: 'cycles', source: 'migration 002 (hand-written)', purpose:
    'One reporting cycle — for example one BREF review round — with its reference ' +
    'year and its open/close window.' },
  { table: 'ref_lists', source: 'migration 002 (hand-written)', purpose:
    'The reference lists behind every fixed-code group in the questionnaire ' +
    '(pollutants, fuels, raw materials, and so on): the authoritative code, label ' +
    'and unit for each entry. See § 5.' },
  { table: 'submission_pages', source: 'migration 002 (hand-written)', purpose:
    'One row per page per submission: its completion status, and `raw`, the raw, ' +
    'flat form payload exactly as the browser submitted it. `raw` is not read by ' +
    'the application in normal operation — the form is populated from the typed ' +
    'questionnaire tables in § 4 — but it is what makes those tables regenerable: ' +
    'a column added to the manifest after the fact can be backfilled by replaying ' +
    'the stored payloads, without asking operators to re-enter anything. It also ' +
    'stands as the record of what was actually submitted, independent of how the ' +
    'mapping layer interpreted it, should a value ever be disputed.' },
  { table: 'audit_log', source: 'migration 002 (hand-written)', purpose:
    'An append-only record of who changed which field, when, and from what value ' +
    'to what value.' },
];

/* ── One-line purpose per questionnaire table ────────────────────────────
   Every key of SCHEMA must appear here (see assertTablePurposeCoverage) —
   a table added to the manifest without an entry here fails generation
   loudly instead of shipping a data dictionary with a silent gap. */
const TABLE_PURPOSE = {
  contacts:
    'Contact details for the reporting plant, the Technical Working Group member-state ' +
    'representative, and any NGO representative.',

  general_info:
    'Plant identity and location, start of production, and the reference year the ' +
    'submission covers.',
  plant_products:
    "The plant's products: up to four fixed product lines, with type, quantity, unit " +
    'and daily capacity.',
  site_activities:
    'Which of the eleven listed site activities (sawmill, glue production, combustion, ' +
    'incineration, etc.) are present at the plant, whether each falls under the IPPC ' +
    'permit, and its capacity.',
  site_activity_units:
    'The unit of measure the operator specified for the two activities — "other ' +
    'activities" and "other, please specify" — whose unit the form does not fix.',
  site_activity_other_specify:
    'The free-text label the operator gave for the "other, please specify" site activity.',

  plant_layout_section:
    'Plant layout narrative, plus the recycled-wood grinding sub-section (2.3) and the ' +
    'other dust-source sub-sections (2.4, 2.5).',
  raw_material_storage:
    'Percentage, capacity and area for each of the three raw-material storage types ' +
    '(outdoor, indoor, silos).',
  wood_prep_operations:
    'The debarking / chipping / other-chipping matrix of section 2.2: process ' +
    'description, airflow, channelled air and emission-control data, per operation.',
  wood_prep_param_comments:
    'One free-text comment per parameter (row) of the section 2.2 matrix — the comment ' +
    'concerns the parameter, not any one of the three operations (columns).',

  raw_materials_section:
    'Reference year and narrative comments for the raw materials section.',
  raw_materials:
    'Percentage, species and source for each of the seven listed raw-material ' +
    'categories.',
  raw_material_specify:
    'The free-text label for the two raw-material categories — "non-wood plant ' +
    'material" and "other" — whose entry the operator must specify.',
  resins:
    'Resin types used on site, their percentage and comments, one row per resin as ' +
    'added by the operator.',
  hardeners:
    'Hardener types and comments, one row per hardener as added by the operator.',
  additives:
    'Type and comments for each of the two listed additive categories (wax, other).',

  energy_section:
    'Site-wide energy balance — steam, hot oil, flue gas, other heat recovered — and ' +
    'cold/warm start-up counts.',
  combustion_units:
    'One row per combustion unit on site: equipment type, installation year, thermal ' +
    'input, operating hours, and up to five energy-output figures.',
  combustion_unit_fuels:
    'The percentage share and description of each of the seven listed fuels burned by a ' +
    'given combustion unit.',

  press_dryer_section:
    'Narrative comments for the dryers-and-presses page.',
  dryers:
    'One row per dryer: type, installation year, operating temperature range, moisture ' +
    'content before/after drying, and drying rate.',
  presses:
    'One row per press: type, installation year, output, temperature, pressure and ' +
    'exhaust handling.',

  dust_section:
    'Site-wide dust collection and abatement narrative.',
  abatement_techniques:
    'One row per air-abatement technique installed: name, installation year, design ' +
    'features and removal efficiency.',
  abatement_technique_sources:
    'Whether each of the four listed waste-gas sources (dryer, press, paper, other) ' +
    'feeds a given abatement technique.',
  abatement_technique_flows:
    'The gas balance of a given abatement technique — intake, recycled, discharged, and ' +
    'residues generated.',

  emission_points:
    'One row per air emission point: its permit reference, sampling conditions, gas ' +
    'composition and flow.',
  emission_point_pollutants:
    'Concentration, monitoring method and permit limit for each of the 35 listed ' +
    'pollutants at a given emission point.',

  waste_water_discharges:
    'One row per waste-water discharge point: its treatment and sludge fate.',
  waste_water_pollutants:
    'Concentration, monitoring frequency and sampling position for each of the 13 ' +
    'listed waste-water pollutants at a given discharge.',
  waste_water_sources:
    'The volume contributed by each of the 8 listed waste-water sources to a given ' +
    'discharge.',

  waste_section:
    'Site-wide solid-waste narrative and candidate BAT techniques for waste.',
  waste_streams:
    'One row per solid-waste stream: description, European Waste Catalogue code, ' +
    'source, quantity and destination.',

  water_consumption:
    'Site-wide water consumption by use (process, cooling, steam, sanitary, refining) ' +
    'and reuse.',

  bat_candidate:
    "The operator's proposed candidate Best Available Technique: description, cost, " +
    'environmental effect and applicability.',
};

/* ── Known inconsistencies (spec § "Known inconsistencies") ─────────────
   These are facts about the questionnaire as designed, stated once here
   and cross-referenced from the affected columns' Notes. Cheap sanity
   checks against the manifest guard against the text going stale if the
   underlying types ever change without this file being updated. */
function assertInconsistenciesStillHold() {
  const mustBe = (table, col, type) => {
    const actual = SCHEMA[table] && SCHEMA[table].cols[col];
    if (actual !== type) {
      throw new Error(
        `gen_data_dictionary: § Known inconsistencies assumes ${table}.${col} is ` +
        `'${type}', found '${actual}'. Update the section text, then this assertion.`);
    }
  };
  mustBe('general_info', 'ref_year', 'int');
  mustBe('plant_layout_section', 'ref_year', 'int');
  mustBe('raw_materials_section', 'ref_year', 'int');
  mustBe('energy_section', 'ref_year', 'int');
  mustBe('dryers', 'ref_year', 'int');
  mustBe('presses', 'ref_year', 'int');
  mustBe('emission_points', 'ref_year', 'text');
  mustBe('waste_water_discharges', 'ref_year', 'text');
  mustBe('wood_prep_operations', 'chan_air', 'text');
  mustBe('plant_layout_section', 's23_chan_air', 'num');
  mustBe('combustion_units', 'install_year', 'int');
  mustBe('emission_point_pollutants', 'limit_val', 'text');
}

const INCONSISTENCIES = [
  '`ref_year` is a bounded radio choice (SMALLINT) on pages 1 to 5 — `general_info`, ' +
    '`plant_layout_section`, `raw_materials_section`, `energy_section`, `dryers`, ' +
    '`presses` — and a free-text input (TEXT) on pages 7 and 8 — `emission_points`, ' +
    '`waste_water_discharges`. The same questionnaire concept has two SQL types ' +
    'depending on which page asks for it.',
  '`chan_air`, total channelled air, is a text input in section 2.2 ' +
    '(`wood_prep_operations.chan_air`, TEXT) and a numeric input in section 2.3 ' +
    '(`plant_layout_section.s23_chan_air`, NUMERIC). The same physical quantity is ' +
    'typed differently depending on which sub-section measures it.',
  '`combustion_units.install_year` is the only installation-year field with no ' +
    '1900–2030 bound, because — unlike the installation-year fields on dryers, ' +
    'presses and abatement techniques — it is rendered through a generic helper that ' +
    "does not apply that bound.",
  'Emission limit values (`emission_point_pollutants.limit_val`) are TEXT, not ' +
    'NUMERIC, because operators write qualified values such as "<= 50" or ' +
    '"50 (daily average)" rather than a bare number.',
];

const INCONSISTENCIES_CLOSING =
  'These come from the questionnaire as designed, not from the database: the schema ' +
  'mirrors the form faithfully, field by field, rather than silently normalising it ' +
  'into a single type per concept.';

/* ── Page titles ──────────────────────────────────────────────────────────
   Sourced from the PAGES manifest in docs/app.js, read as text rather than
   imported: app.js targets the browser (it references `document`, wires up
   Supabase, etc.) and cannot be safely executed under Node. Page 12
   ("Review & Submit") is a read-only summary with no fields of its own and
   is correctly absent from SCHEMA — it is not a gap. */
function loadPageTitles() {
  const src = readFileSync(path.join(ROOT, 'docs/app.js'), 'utf8');
  const re = /\{\s*id:\s*(\d+),\s*title:\s*'([^']+)'/g;
  const titles = {};
  let m;
  while ((m = re.exec(src))) titles[Number(m[1])] = m[2];
  if (Object.keys(titles).length < 12) {
    throw new Error('gen_data_dictionary: could not find the PAGES manifest in docs/app.js');
  }
  return titles;
}

/* ── Reference list seed ─────────────────────────────────────────────────
   Read as text from the generated seed migration, not retyped: this is
   what "reference list entries match ... the seed" means in practice —
   the dictionary quotes the same file the database is loaded from. */
function loadRefListSeed() {
  const src = readFileSync(path.join(ROOT, 'supabase/migrations/003_seed_ref_lists.sql'), 'utf8');
  const re = /\(\s*'([^']+)',\s*'([^']+)',\s*'((?:[^'\\]|\\.)*)',\s*(NULL|'[^']*'),\s*(\d+),\s*TRUE\s*\)/g;
  const rows = [];
  let m;
  while ((m = re.exec(src))) {
    rows.push({
      list: m[1],
      code: m[2],
      label: m[3],
      unit: m[4] === 'NULL' ? null : m[4].slice(1, -1),
      sortOrder: Number(m[5]),
    });
  }
  if (!rows.length) {
    throw new Error('gen_data_dictionary: no rows parsed out of 003_seed_ref_lists.sql');
  }
  return rows;
}

function assertRefListsMatchSeed(seedRows) {
  const byList = new Map();
  for (const r of seedRows) {
    if (!byList.has(r.list)) byList.set(r.list, []);
    byList.get(r.list).push(r);
  }
  for (const [listName, codes] of Object.entries(LISTS)) {
    const seedCodes = (byList.get(listName) || [])
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map(r => r.code);
    if (seedCodes.length !== codes.length || codes.some((c, i) => c !== seedCodes[i])) {
      throw new Error(
        `gen_data_dictionary: LISTS.${listName} does not match the seed in ` +
        `003_seed_ref_lists.sql.\n  manifest: ${JSON.stringify(codes)}\n  seed:     ` +
        JSON.stringify(seedCodes));
    }
  }
  for (const listName of byList.keys()) {
    if (!LISTS[listName]) {
      throw new Error(`gen_data_dictionary: seed has list "${listName}" that LISTS does not.`);
    }
  }
}

/* ── Cross-check against the generated schema ────────────────────────────
   Table names are read out of the actual generated migration, not
   recomputed from the manifest a second time: if 002_relational_schema.sql
   and docs/fields.js were ever to disagree, this dictionary must fail to
   generate rather than describe a table the database doesn't have, or omit
   one it does. */
function loadGeneratedTableNames() {
  const src = readFileSync(path.join(ROOT, 'supabase/migrations/002_relational_schema.sql'), 'utf8');
  const re = /CREATE TABLE IF NOT EXISTS europanel\.(\w+) \(/g;
  const names = [];
  let m;
  while ((m = re.exec(src))) names.push(m[1]);
  return names;
}

function assertSchemaSync() {
  const generated = new Set(loadGeneratedTableNames());
  const expected = new Set([...HAND_WRITTEN_CORE, ...Object.keys(SCHEMA)]);
  const missing = [...expected].filter(t => !generated.has(t));
  const extra = [...generated].filter(t => !expected.has(t));
  if (missing.length || extra.length) {
    throw new Error(
      'gen_data_dictionary: out of sync with 002_relational_schema.sql — ' +
      `missing from schema: ${missing.join(', ') || 'none'}; ` +
      `in schema but not documented: ${extra.join(', ') || 'none'}`);
  }
}

/* ── Per-column rendering ────────────────────────────────────────────────
   The HTML form-field name a column corresponds to, with its repeating
   token(s) left literal as {idx} / {code} rather than resolved: this is a
   pattern, not one field's actual name. Built with docs/db.js#buildName —
   the very function the dispatcher uses — so the pattern shown here can
   never diverge from what the dispatcher actually looks for. */
function formFieldPattern(entry, col) {
  if (entry.kind === 'one') return col;
  const seg = fieldSegment(entry, col);
  const parts = { col: seg };
  if (entry.pattern.includes('{idx}')) parts.idx = '{idx}';
  if (entry.pattern.includes('{parent_idx}')) parts.parent_idx = '{idx}';
  if (entry.pattern.includes('{code}')) parts.code = '{code}';
  return buildName(entry.pattern, parts);
}

function columnsForTable(name, entry) {
  return Object.entries(entry.cols).map(([col, type]) => {
    const seg = fieldSegment(entry, col);
    const aliased = seg !== col;
    const notes = [];
    if (aliased) {
      const reason = seg === 'id'
        ? 'the form field segment `id` would collide with the surrogate primary key column `id`'
        : `\`${seg}\` is a reserved SQL word`;
      notes.push(`Aliased: this column is named \`${col}\`, not \`${seg}\`, because ${reason}.`);
    }
    if (name === 'combustion_units' && col === 'install_year') {
      notes.push('No 1900–2030 bound — see § 6.');
    }
    if ((name === 'wood_prep_operations' && col === 'chan_air') ||
        (name === 'plant_layout_section' && col === 's23_chan_air')) {
      notes.push('Same quantity typed differently elsewhere — see § 6.');
    }
    if (name === 'emission_point_pollutants' && col === 'limit_val') {
      notes.push('TEXT because permit limits are often qualified — see § 6.');
    }
    if (col === 'ref_year') {
      notes.push(type === 'int'
        ? 'Bounded choice on this page; free text on pages 7–8 — see § 6.'
        : 'Free text on this page; bounded choice on pages 1–5 — see § 6.');
    }
    return {
      column: col,
      sqlType: SQL_TYPE[type],
      formField: formFieldPattern(entry, col),
      aliased,
      notes: notes.join(' '),
    };
  });
}

function kindLine(entry) {
  if (entry.kind === 'one') return 'One row per submission.';
  if (entry.kind === 'many') {
    const cf = entry.countField
      ? ` Instance count is tracked in the parent page's \`${entry.countField}\` field.`
      : '';
    return `Repeating section — one row per instance, ordered by \`idx\`.${cf}`;
  }
  return entry.parent
    ? `Fixed-code group, nested under \`${entry.parent}\` — one row per (parent ` +
      `instance, code from the \`${entry.list}\` reference list).`
    : `Fixed-code group — one row per code from the \`${entry.list}\` reference list.`;
}

function parentLine(entry) {
  if (!entry.parent) return 'None — attaches directly to `submissions` via `submission_id`.';
  return `\`${entry.parent}\`, via \`${parentColumn(entry)}\`.`;
}

/* ── Model ────────────────────────────────────────────────────────────── */

export function buildModel() {
  assertSchemaSync();
  assertInconsistenciesStillHold();

  const pageTitles = loadPageTitles();
  const seedRows = loadRefListSeed();
  assertRefListsMatchSeed(seedRows);

  const pages = [];
  for (let pageId = 0; pageId <= 11; pageId++) {
    const entries = Object.entries(SCHEMA).filter(([, e]) => e.page === pageId);
    if (!entries.length) continue;
    const tables = entries.map(([name, entry]) => {
      if (!TABLE_PURPOSE[name]) {
        throw new Error(`gen_data_dictionary: no purpose text declared for table "${name}"`);
      }
      return {
        name,
        kind: entry.kind,
        page: pageId,
        kindLine: kindLine(entry),
        parentLine: parentLine(entry),
        purpose: TABLE_PURPOSE[name],
        columns: columnsForTable(name, entry),
      };
    });
    pages.push({ id: pageId, title: pageTitles[pageId] || `Page ${pageId}`, tables });
  }

  // Every SCHEMA table must land in exactly one page section above.
  const documented = new Set(pages.flatMap(p => p.tables.map(t => t.name)));
  const undocumented = Object.keys(SCHEMA).filter(t => !documented.has(t));
  if (undocumented.length) {
    throw new Error(`gen_data_dictionary: tables never placed on a page: ${undocumented.join(', ')}`);
  }

  const byList = new Map();
  for (const r of seedRows) {
    if (!byList.has(r.list)) byList.set(r.list, []);
    byList.get(r.list).push(r);
  }
  const refLists = Object.keys(LISTS).map(listName => {
    const rows = (byList.get(listName) || []).sort((a, b) => a.sortOrder - b.sortOrder);
    const usedBy = Object.entries(SCHEMA).filter(([, e]) => e.list === listName).map(([n]) => n);
    return {
      name: listName,
      usedBy,
      entries: rows.map(r => ({ code: r.code, label: r.label, unit: r.unit })),
    };
  });

  const totalColumns = Object.values(SCHEMA).reduce((n, e) => n + Object.keys(e.cols).length, 0);
  const totalRefEntries = seedRows.length;

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    counts: {
      tables: Object.keys(SCHEMA).length,
      coreTables: CORE_TABLE_META.length,
      columns: totalColumns,
      refLists: refLists.length,
      refEntries: totalRefEntries,
    },
    core: CORE_TABLE_META,
    pages,
    refLists,
    inconsistencies: INCONSISTENCIES,
    inconsistenciesClosing: INCONSISTENCIES_CLOSING,
  };
}

/* ── Markdown rendering ──────────────────────────────────────────────── */

function mdTable(headers, rows) {
  const lines = [
    `| ${headers.join(' | ')} |`,
    `|${headers.map(() => '---').join('|')}|`,
  ];
  for (const row of rows) lines.push(`| ${row.join(' | ')} |`);
  return lines.join('\n');
}

function renderColumnsSection(table) {
  const lines = [];
  lines.push(`#### \`${table.name}\``);
  lines.push(`<!-- table: ${table.name} kind=${table.kind} page=${table.page} -->`);
  lines.push('');
  lines.push(`*Kind:* ${table.kindLine}`);
  lines.push('');
  lines.push(`*Parent:* ${table.parentLine}`);
  lines.push('');
  lines.push(table.purpose);
  lines.push('');
  lines.push('| Column | SQL type | Form field | Notes |');
  lines.push('|---|---|---|---|');
  for (const c of table.columns) {
    lines.push(`<!-- column: ${table.name}.${c.column} type=${c.sqlType} alias=${c.aliased} -->`);
    lines.push(`| \`${c.column}\` | ${c.sqlType} | \`${c.formField}\` | ${c.notes} |`);
  }
  lines.push('');
  return lines.join('\n');
}

export function buildMarkdown(model = buildModel()) {
  const out = [];

  out.push('# EuroPanel — Data Dictionary');
  out.push('');
  out.push('*Relational schema for the WBP BREF questionnaire · schema `europanel`*');
  out.push('');
  out.push(`Generated on ${model.generatedAt}.`);
  out.push('');

  out.push('## 1. Purpose');
  out.push('');
  out.push(
    'This document is the data dictionary for the EuroPanel WBP BREF questionnaire ' +
    'database: every field, its meaning, unit (where applicable), allowed values, and ' +
    'the questionnaire item it corresponds to. It exists so that a competent third ' +
    'party who has never seen this system can understand the database — and extract a ' +
    'complete, structured copy of the data — without reading the application code.');
  out.push('');
  out.push(
    'It is **generated**, not hand-written, from `docs/fields.js` — the same manifest ' +
    'that generates the database schema (`supabase/migrations/002_relational_schema.sql`) ' +
    'and the reference-list seed (`supabase/migrations/003_seed_ref_lists.sql`). The ' +
    'document and the schema come from one source and are checked against each other at ' +
    'generation time; they cannot silently drift apart. Regenerate after any change to ' +
    'the manifest with:');
  out.push('');
  out.push('```');
  out.push('node tools/gen_data_dictionary.mjs > EuroPanel_DataDictionary.md');
  out.push('python tools/gen_data_dictionary_docx.py');
  out.push('```');
  out.push('');
  out.push(
    `Covers **${model.counts.tables} questionnaire tables** (${model.counts.columns} ` +
    `columns), **${model.counts.coreTables} core tables**, and **${model.counts.refLists} ` +
    `reference lists** (${model.counts.refEntries} coded entries).`);
  out.push('');

  out.push('## 2. How to read this document');
  out.push('');
  out.push(
    'The questionnaire has 12 pages, numbered 0 to 11 (a 13th page, "Review & Submit", ' +
    'is a read-only summary and holds no data of its own). Each page maps to one or more ' +
    'tables in the `europanel` schema:');
  out.push('');
  out.push(
    '- Most sections are a single table with **one row per submission** — one column ' +
    'per question asked on that page.');
  out.push(
    '- A **repeating section** — dryers, combustion units, emission points, and so on ' +
    '— becomes a child table with **one row per instance** the operator added. ' +
    'Instances are numbered by `idx`, starting at 1, in the order the operator entered ' +
    'them.');
  out.push(
    '- A section built around a **fixed list of items** — pollutants, fuels, raw ' +
    'materials — becomes a child table with **one row per applicable code**, not per ' +
    'submission. Codes come from a reference list; § 5 lists every code with its label ' +
    'and unit.');
  out.push(
    '- Some tables nest inside another questionnaire table rather than attaching ' +
    'directly to a submission — for example `combustion_unit_fuels`, one row per fuel ' +
    'used by a specific combustion unit. These carry a foreign key to their parent ' +
    'table\'s row instead of (or in addition to) one to the submission.');
  out.push('');
  out.push(
    'A handful of columns appear on nearly every table below but are never asked of the ' +
    'operator — they come from the structure of the form, or from the database itself:');
  out.push('');
  out.push(mdTable(['Column', 'Meaning'], [
    ['`id`', 'Surrogate primary key, generated by the database. Every table has one, ' +
      'except the 1:1 tables described above, which use `submission_id` as their ' +
      'primary key instead.'],
    ['`submission_id`', 'Foreign key to `submissions`. Present on every table that is ' +
      'not nested inside another questionnaire table; identifies which submission the ' +
      'row belongs to.'],
    ['`idx`', 'Position of a repeating instance within its section (1, 2, 3, …). ' +
      'Present only on repeating-section tables.'],
    ['`code`, `list_code`', '`code` is the fixed item this row describes, e.g. `nox` ' +
      'or `roundwood`; `list_code` names the reference list it belongs to, and is the ' +
      'same value for every row of that table. Present only on fixed-code-group tables.'],
    ['`<parent>_id`', 'On a table nested inside another questionnaire table, the ' +
      'foreign key to the specific parent row — for example `combustion_unit_id` on ' +
      '`combustion_unit_fuels` — used instead of a direct link to the submission.'],
    ['`updated_at`', 'Timestamp of the last write to the row, maintained automatically ' +
      'by a database trigger, never set by the application.'],
  ]));
  out.push('');

  out.push('## 3. Core tables');
  out.push('');
  out.push(
    `These ${model.core.length} tables carry no questionnaire field, so the manifest ` +
    'has nothing to say about them and they are described here directly. Two are ' +
    'inherited from the original schema (migration 001); the other five were introduced ' +
    'with the relational schema and are written by hand in `tools/gen_schema.mjs` rather ' +
    'than generated, because they describe infrastructure — companies, plants, reporting ' +
    'cycles, reference data, raw payloads, the audit trail — that the field manifest has ' +
    'no reason to know about.');
  out.push('');
  out.push(mdTable(['Table', 'Source', 'Purpose'],
    model.core.map(c => [`\`${c.table}\``, c.source, c.purpose])));
  out.push('');

  out.push('## 4. Questionnaire pages');
  out.push('');
  out.push(
    'One subsection per page, in page order. For each table: what it is for, its kind ' +
    '(1:1 / repeating / fixed-code group), its parent if it is nested, and its columns.');
  out.push('');
  for (const page of model.pages) {
    out.push(`### Page ${page.id} — ${page.title}`);
    out.push('');
    for (const table of page.tables) {
      out.push(renderColumnsSection(table));
    }
  }

  out.push('## 5. Reference lists');
  out.push('');
  out.push(
    'Each fixed-code group in § 4 draws its codes from one of the following lists. This ' +
    'is where a code such as `nox` or `ext_prod_res` gets a human-readable label and, ' +
    'where applicable, a unit.');
  out.push('');
  for (const list of model.refLists) {
    out.push(`### \`${list.name}\``);
    out.push(`<!-- reflist: ${list.name} count=${list.entries.length} -->`);
    out.push('');
    out.push(`*Used by:* ${list.usedBy.map(t => `\`${t}\``).join(', ')}`);
    out.push('');
    out.push(mdTable(['Code', 'Label', 'Unit'],
      list.entries.map(e => [`\`${e.code}\``, e.label, e.unit ? e.unit : '—'])));
    out.push('');
  }

  out.push('## 6. Known inconsistencies in the questionnaire');
  out.push('');
  for (const item of model.inconsistencies) out.push(`- ${item}`);
  out.push('');
  out.push(model.inconsistenciesClosing);
  out.push('');

  return out.join('\n');
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(buildModel(), null, 2));
  } else {
    process.stdout.write(buildMarkdown());
  }
}
