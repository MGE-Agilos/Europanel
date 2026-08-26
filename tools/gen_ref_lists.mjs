/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Générateur du seed de europanel.ref_lists.

   Usage : node tools/gen_ref_lists.mjs > supabase/migrations/003_seed_ref_lists.sql

   Les codes viennent de LISTS (docs/fields.js). Les libellés lisibles, eux,
   n'existent que dans les renderers : ce sont les mêmes tableaux d'objets
   dont les codes ont été extraits, avec une propriété `label` ou `l`. Or
   `ref_lists.label` est ce qu'un tableau de bord affichera, et « ext_prod_res »
   n'est pas un libellé. On va donc les chercher là où ils sont.

   ── Le piège : un code n'identifie rien à lui seul ────────────────────
   « other » existe dans raw_materials (« Other (specify): »), dans fuels
   (« Other fuels ») et dans waste_gas_sources (« Other (specify) »). Une
   extraction globale par code écraserait les trois avec le même libellé.
   L'association est donc faite PAR LISTE : chaque tableau du renderer est
   apparié à une liste du manifeste par son ENSEMBLE DE CODES, et le
   libellé n'est retenu que si l'appariement est unique. Faute de quoi le
   code sert de libellé et l'entrée est signalée sur stderr.
   ══════════════════════════════════════════════════════════════════════ */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const { LISTS } = require('../docs/fields.js');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RENDERERS = ['docs/pages-0-6.js', 'docs/pages-7-12.js'];

/* ── Extraction des tableaux d'options des renderers ──────────────────────
   On ne cherche pas « const NOM = [...] » : plusieurs listes du manifeste
   (storage_types, additives, abatement_flows) sont des littéraux anonymes
   écrits directement dans le gabarit. On balaie donc TOUS les littéraux de
   tableau contenant des objets {key/k, label/l}, quel que soit leur nom.
   ────────────────────────────────────────────────────────────────────── */

// Un objet d'option : {key:'…', label:'…', unit:'…'} ou {k:'…', l:'…'}.
const OPTION_RE =
  /\{\s*(?:key|k)\s*:\s*'([^']*)'\s*,\s*(?:label|l)\s*:\s*'((?:[^'\\]|\\.)*)'([^{}]*)\}/g;
const UNIT_RE = /\bunit\s*:\s*'((?:[^'\\]|\\.)*)'/;
const HEAVY_RE = /\bheavy\s*:\s*true\b/;

function unescape(s) {
  return s.replace(/\\(['"\\])/g, '$1');
}

// Le renderer ajoute «  (heavy metal) » à côté du libellé des options
// portant `heavy:true` (docs/pages-7-12.js, gabarit de pollRows). Sans ce
// suffixe, deux couples de la liste des polluants deviennent indiscernables
// dans un tableau de bord : `cr` et `cr_hm` s'affichent tous deux « Cr », et
// `co` (monoxyde de carbone, « CO ») ne se distingue de `co_hm` (cobalt,
// « Co ») que par la casse. Ce sont deux mesures réglementaires différentes.
function displayLabel(label, tail) {
  return HEAVY_RE.test(tail) ? `${label} (heavy metal)` : label;
}

// Le renderer affiche « — » dans la colonne d'unité des grandeurs sans
// dimension (pH). C'est un tiret de mise en page, pas une unité : ref_lists
// doit porter NULL, sinon un tableau de bord affichera « pH (—) ».
function normaliseUnit(u) {
  if (u === null || u === undefined) return null;
  const t = u.trim();
  return t === '' || t === '—' || t === '-' ? null : t;
}

// Découpe la source en littéraux de tableau `[ … ]` de premier niveau qui
// contiennent au moins une option. Le balayage compte les crochets, ce qui
// évite de couper un tableau au premier `]` d'une valeur imbriquée.
function extractOptionArrays(src) {
  const out = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '[') continue;
    let depth = 0, end = -1;
    for (let j = i; j < src.length && j < i + 20000; j++) {
      if (src[j] === '[') depth++;
      else if (src[j] === ']') { depth--; if (depth === 0) { end = j; break; } }
    }
    if (end < 0) continue;
    const body = src.slice(i + 1, end);
    const opts = [];
    for (const m of body.matchAll(OPTION_RE)) {
      const tail = m[3] || '';
      const u = UNIT_RE.exec(tail);
      opts.push({
        code: m[1],
        label: displayLabel(unescape(m[2]), tail),
        unit: normaliseUnit(u ? unescape(u[1]) : null),
      });
    }
    if (opts.length >= 2) out.push(opts);
    i = end;                       // ne pas rebalayer l'intérieur du tableau
  }
  return out;
}

/* ── Appariement liste ↔ tableau ──────────────────────────────────────── */

// Un tableau du renderer couvre une liste s'il définit un libellé pour
// chacun de ses codes. On exige un candidat et un seul : deux tableaux
// couvrant la même liste signifient que l'association est ambiguë, donc
// qu'on ne peut pas affirmer de quel libellé il s'agit.
function matchList(codes, arrays) {
  const hits = arrays.filter(a => {
    const seen = new Set(a.map(o => o.code));
    return codes.every(c => seen.has(c));
  });
  if (hits.length !== 1) return null;
  const byCode = new Map();
  for (const o of hits[0]) if (!byCode.has(o.code)) byCode.set(o.code, o);
  return byCode;
}

/* ── Libellés non extractibles ────────────────────────────────────────────
   wood_prep_stages ('debark', 'chip', 'other_chip') est le seul cas où les
   libellés ne sont pas dans un tableau d'objets : ce sont les en-têtes de
   colonne du tableau 2.2, écrits en dur dans le gabarit HTML
   (docs/pages-0-6.js, « <th class="prod-th">Debarking</th> » et suivants),
   pendant que les codes sont un simple tableau de chaînes
   (docs/pages-0-6.js:337). Ils sont donc repris ici littéralement, portée
   par liste — jamais par code seul, pour la même raison que ci-dessus.
   ────────────────────────────────────────────────────────────────────── */
const MANUAL_LABELS = {
  wood_prep_stages: { debark: 'Debarking', chip: 'Plating & Chipping', other_chip: 'Other' },
};

/* ── Assemblage ───────────────────────────────────────────────────────── */

const esc = s => String(s).replace(/'/g, "''");
const sqlText = s => (s === null || s === undefined || s === '' ? 'NULL' : `'${esc(s)}'`);

export function buildSeed() {
  const src = RENDERERS.map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n');
  const arrays = extractOptionArrays(src);

  const rows = [];
  const fallbacks = [];          // listes dont le libellé retombe sur le code

  for (const [listCode, codes] of Object.entries(LISTS)) {
    const byCode = matchList(codes, arrays);
    const manual = MANUAL_LABELS[listCode] || {};
    codes.forEach((code, i) => {
      const opt = byCode ? byCode.get(code) : null;
      const label = (opt && opt.label) || manual[code] || code;
      if (label === code && !(opt && opt.label)) fallbacks.push(`${listCode}.${code}`);
      const unit = opt ? opt.unit : null;
      rows.push(
        `  ('${esc(listCode)}', '${esc(code)}', ${sqlText(label)}, ${sqlText(unit)}, ${i}, TRUE)`);
    });
  }

  const counts = Object.entries(LISTS)
    .map(([k, v]) => `--    ${k.padEnd(26)} ${String(v.length).padStart(3)}`)
    .join('\n');

  const sql =
`-- ══════════════════════════════════════════════════════════════════════
--  EuroPanel — Seed des listes de référence (europanel.ref_lists)
--
--  GÉNÉRÉ par tools/gen_ref_lists.mjs.
--  Codes et ordre : LISTS dans docs/fields.js.
--  Libellés et unités : extraits des tableaux d'options des renderers
--  (docs/pages-0-6.js, docs/pages-7-12.js), appariés PAR LISTE et non par
--  code — « other » existe dans raw_materials, fuels et waste_gas_sources
--  avec trois sens différents.
--
--  NE PAS MODIFIER À LA MAIN : régénérer.
--    node tools/gen_ref_lists.mjs > supabase/migrations/003_seed_ref_lists.sql
--
--  Prérequis : 002_relational_schema.sql (table ref_lists). Ce seed doit
--  être appliqué avant toute écriture dans les tables 'keyed', qui portent
--  une clé étrangère composite vers ref_lists (list_code, code).
--
--  Effectif par liste :
${counts}
--    ${'TOTAL'.padEnd(26)} ${String(rows.length).padStart(3)}
-- ══════════════════════════════════════════════════════════════════════

INSERT INTO europanel.ref_lists (list_code, code, label, unit, sort_order, active)
VALUES
${rows.join(',\n')}
ON CONFLICT (list_code, code) DO NOTHING;
`;

  return { sql, rows, fallbacks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { sql, rows, fallbacks } = buildSeed();
  const expected = Object.values(LISTS).reduce((n, v) => n + v.length, 0);
  if (rows.length !== expected) {
    throw new Error(`seed : ${rows.length} lignes pour ${expected} codes au manifeste`);
  }
  if (fallbacks.length) {
    process.stderr.write(
      'gen_ref_lists : libellé introuvable, le code sert de libellé pour :\n  ' +
      fallbacks.join('\n  ') + '\n');
  }
  process.stderr.write(`gen_ref_lists : ${rows.length} lignes.\n`);
  process.stdout.write(sql);
}
