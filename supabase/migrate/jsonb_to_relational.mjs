#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Reprise de europanel.page_data (JSONB) vers le schema
   relationnel (spec § 7).

   Deux phases, deliberement separables :

     1. COPIE       page_data.data  ->  submission_pages.raw, verbatim.
                    Cette phase n'interprete rien : elle ne peut donc rien
                    perdre. C'est le filet decrit au § 2.1.

     2. REGENERATION submission_pages.raw -> tables du questionnaire, via
                    le MEME dispatch() et le MEME planificateur d'ecriture
                    que le webform. Les modules sont importes, jamais
                    reimplementes : une seconde implementation serait libre
                    de diverger, et divergence ici veut dire donnee posee
                    silencieusement dans la mauvaise colonne.

   Separer les deux rend la phase 2 rejouable : si le manifeste gagne une
   colonne demain, on relance la phase 2 et l'historique se rattrape, sans
   relire page_data ni rien redemander aux entreprises membres.

   Modes :
     --dry-run     (defaut) lit, analyse, n'ecrit rien
     --copy        phase 1 seule
     --regenerate  phase 2 seule
     --apply       les deux

   Le script refuse d'ecrire tant qu'un mode d'ecriture n'est pas passe
   explicitement.

   Identifiants : lus depuis .env a la racine du depot. La cle service_role
   n'est jamais affichee ni ecrite dans le rapport.

   Rapport : migration-report.json (ignore par git) + resume lisible.
   ══════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fields = require('../../docs/fields.js');
const db = require('../../docs/db.js');
const plan = require('../../docs/db-plan.js');

const { SCHEMA, LISTS } = fields;
const { buildName, fieldSegment, countInstances, toDb, dispatch } = db;

export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DEFAULT_REPORT = path.join(REPO_ROOT, 'migration-report.json');

/* ══ Environnement ═══════════════════════════════════════════════════ */

// .env minimal : CLE=valeur, # en commentaire. Pas de dependance ajoutee
// pour trois lignes, et surtout pas de valeur par defaut en dur : une URL
// ou une cle absente doit faire echouer, pas se rabattre sur autre chose.
export function parseEnv(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    let v = s.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[s.slice(0, i).trim()] = v;
  }
  return out;
}

export function loadEnv(file) {
  const p = file || path.join(REPO_ROOT, '.env');
  if (!fs.existsSync(p)) {
    throw new Error('.env introuvable (' + p + ') — la reprise a besoin de ' +
                    'SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY.');
  }
  const env = parseEnv(fs.readFileSync(p, 'utf8'));
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!env[k]) throw new Error('.env : ' + k + ' manquant.');
  }
  return env;
}

/* ══ Arguments ═══════════════════════════════════════════════════════ */

const MODES = {
  '--dry-run': 'dry-run',
  '--copy': 'copy',
  '--regenerate': 'regenerate',
  '--apply': 'apply',
};

export function parseArgs(argv) {
  let copy = false, regenerate = false, dry = false;
  let out = DEFAULT_REPORT;
  for (const arg of argv) {
    if (arg === '--copy') { copy = true; continue; }
    if (arg === '--regenerate') { regenerate = true; continue; }
    if (arg === '--apply') { copy = true; regenerate = true; continue; }
    if (arg === '--dry-run') { dry = true; continue; }
    if (arg.startsWith('--out=')) { out = arg.slice('--out='.length); continue; }
    if (arg === '--help' || arg === '-h') return { help: true, out };
    throw new Error('argument inconnu : ' + arg + '  (modes : ' +
                    Object.keys(MODES).join(', ') + ')');
  }
  if (dry && (copy || regenerate)) {
    throw new Error('--dry-run est exclusif : il n\'ecrit rien, par definition.');
  }
  const mode = copy && regenerate ? 'apply' : copy ? 'copy'
             : regenerate ? 'regenerate' : 'dry-run';
  // Le defaut est le mode qui n'ecrit pas. Ecrire demande un mot explicite.
  return { mode, out, writes: mode !== 'dry-run' };
}

export const USAGE = [
  'Usage : node supabase/migrate/jsonb_to_relational.mjs [mode] [--out=chemin]',
  '',
  '  --dry-run     (defaut) lit page_data, produit le rapport, n\'ecrit rien',
  '  --copy        phase 1 : page_data.data -> submission_pages.raw',
  '  --regenerate  phase 2 : submission_pages.raw -> tables du questionnaire',
  '  --apply       phase 1 puis phase 2',
  '  --out=CHEMIN  fichier de rapport (defaut : migration-report.json)',
].join('\n');

/* ══ Parcours du manifeste ═══════════════════════════════════════════ */

// Borne du balayage servant a distinguer « clef inconnue du manifeste » de
// « clef reconnaissable mais laissee de cote » (instance supprimee dont les
// clefs trainent encore dans la carte plate). Sans distinction, les deux
// remonteraient au meme endroit du rapport alors qu'elles n'appellent pas
// la meme decision.
export const SCAN_IDX = 50;

function entriesForPage(pageId) {
  return Object.entries(SCHEMA).filter(([, e]) => e.page === pageId);
}

function rangeTo(n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push(i);
  return out;
}

// Enumere les champs qu'une page revendique pour une carte plate donnee, en
// reproduisant *exactement* le parcours de dispatch() : memes patrons, memes
// alias, meme comptage d'instances. C'est volontairement le meme jeu de
// primitives (buildName / fieldSegment / countInstances), pas une seconde
// lecture du manifeste.
//
// opts.scanIdx force le nombre d'instances au lieu de le compter : sert au
// balayage large qui reconnait les clefs orphelines.
export function walkPage(flat, pageId, visit, opts) {
  const scan = opts && opts.scanIdx;
  const instances = entry => (scan ? scan : countInstances(flat, entry));

  for (const [table, entry] of entriesForPage(pageId)) {
    switch (entry.kind) {
    case 'one':
      for (const [col, type] of Object.entries(entry.cols)) {
        visit({ name: col, table, col, type });
      }
      break;

    case 'many': {
      // Le compteur n'est pas une colonne : il est reconstruit depuis
      // COUNT(*) a la relecture. Il est revendique par le manifeste malgre
      // tout, sinon il remonterait comme clef non couverte a chaque page.
      if (entry.countField) {
        visit({ name: entry.countField, table, col: null, type: null, counter: true });
      }
      const n = instances(entry);
      for (let idx = 1; idx <= n; idx++) {
        for (const [col, type] of Object.entries(entry.cols)) {
          visit({
            name: buildName(entry.pattern, { idx, col: fieldSegment(entry, col) }),
            table, col, type, idx,
          });
        }
      }
      break;
    }

    case 'keyed': {
      const parents = entry.parent ? rangeTo(instances(SCHEMA[entry.parent])) : [null];
      for (const parentIdx of parents) {
        for (const code of LISTS[entry.list]) {
          for (const [col, type] of Object.entries(entry.cols)) {
            visit({
              name: buildName(entry.pattern, {
                code, parent_idx: parentIdx, col: fieldSegment(entry, col),
              }),
              table, col, type, code, parentIdx,
            });
          }
        }
      }
      break;
    }

    default:
      throw new Error('walkPage : kind inconnu — ' + entry.kind + ' (' + table + ')');
    }
  }
}

function nameSet(flat, pageId, opts) {
  const s = new Set();
  walkPage(flat, pageId, f => s.add(f.name), opts);
  return s;
}

/* ══ Coercition : ce que la conversion de type coute ═════════════════ */

// Classe le passage d'une valeur brute par toDb(). Retourne null quand rien
// n'est perdu ni altere.
//
//   dropped  la valeur portait quelque chose et n'arrive pas en base
//            (« n.a. » dans une colonne numerique -> null). Incident.
//   altered  la valeur arrive, mais ecrite autrement (« 1.50 » -> 1.5,
//            « 2010.4 » -> 2010 dans une colonne entiere). A regarder.
//
// Le texte n'est jamais altere : toDb le rend verbatim.
export function classifyCoercion(raw, result, type) {
  if (raw === undefined || raw === null) return null;
  const s = String(raw);

  if (type === 'bool') {
    // collectFormData n'emet 'on' que pour une case cochee ; une case
    // decochee est absente de la carte. Toute autre valeur presente serait
    // lue comme false, donc silencieusement perdue.
    if (s === '' || s === 'on') return null;
    return { kind: 'dropped', reason: "valeur booleenne autre que 'on' — lue comme false" };
  }

  const trimmed = s.trim();
  // Vide ou blanc -> null est le comportement voulu (voir toDb) : une case
  // laissee vide n'est pas une mesure de zero. Ce n'est pas une perte.
  if (trimmed === '') return null;

  if (result === null || result === undefined) {
    return { kind: 'dropped', reason: 'non convertible en ' + type + ' — ecrit null' };
  }
  if ((type === 'num' || type === 'int') && String(result) !== trimmed) {
    return {
      kind: 'altered',
      reason: type === 'int' ? 'arrondi a l\'entier' : 'reecrit par la conversion numerique',
    };
  }
  return null;
}

/* ══ Audit d'une ligne page_data / submission_pages ══════════════════ */

// Analyse une charge brute sans toucher a la base.
// row = { submission_id, page_id, data }
export function auditRow(row) {
  const flat = row.data || {};
  const pageId = Number(row.page_id);
  const claimed = nameSet(flat, pageId);
  const recognized = nameSet(flat, pageId, { scanIdx: SCAN_IDX });

  const unmapped = [];
  for (const key of Object.keys(flat)) {
    if (claimed.has(key)) continue;
    const value = flat[key];
    const filled = value !== null && value !== undefined && String(value).trim() !== '';
    unmapped.push({
      submission_id: row.submission_id,
      page_id: pageId,
      key,
      filled,
      // Une clef vide non couverte est du bruit ; une clef non couverte qui
      // porte une valeur est un incident. On les compte separement, et on
      // ne rend la valeur que la ou elle existe.
      value: filled ? String(value) : '',
      // « orphan_instance » : le nom est bien celui d'un champ du manifeste,
      // mais a un indice d'instance que le comptage ne retient pas — reste
      // d'une instance supprimee. Il n'est pas migre non plus.
      reason: recognized.has(key) ? 'orphan_instance' : 'unknown',
    });
  }

  const coercions = [];
  walkPage(flat, pageId, f => {
    if (f.counter) return;
    const raw = flat[f.name];
    if (raw === undefined) return;
    const result = toDb(raw, f.type);
    const verdict = classifyCoercion(raw, result, f.type);
    if (!verdict) return;
    coercions.push({
      submission_id: row.submission_id,
      page_id: pageId,
      field: f.name,
      table: f.table,
      column: f.col,
      type: f.type,
      original: String(raw),
      result: result === null ? null : (typeof result === 'boolean' ? result : String(result)),
      kind: verdict.kind,
      reason: verdict.reason,
    });
  });

  let keys = 0, filledKeys = 0;
  for (const key of Object.keys(flat)) {
    keys++;
    const v = flat[key];
    if (v !== null && v !== undefined && String(v).trim() !== '') filledKeys++;
  }

  return { unmapped, coercions, keys, filledKeys };
}

export function auditRows(rows) {
  const unmapped = [], coercions = [];
  let keys = 0, filledKeys = 0;
  for (const row of rows) {
    const a = auditRow(row);
    unmapped.push(...a.unmapped);
    coercions.push(...a.coercions);
    keys += a.keys;
    filledKeys += a.filledKeys;
  }
  return { unmapped, coercions, keys, filledKeys };
}

/* ══ Clients ═════════════════════════════════════════════════════════ */

function bump(map, key, n) { map[key] = (map[key] || 0) + n; }

function emptyTally() { return { upserts: {}, deletes: {} }; }

// Double de client honorant l'interface que runStep() utilise, sans reseau.
// Le mode --dry-run fait tourner le plan d'ecriture complet contre lui : le
// rapport dit alors ce qui *serait* ecrit, table par table, y compris pour
// les tables enfants — ce qu'un simple comptage a priori ne donnerait pas,
// puisqu'une ligne enfant depend de la cle de son parent.
export function recordingClient(tally) {
  let seq = 900000;
  const calls = [];
  const api = {
    calls,
    from(table) {
      return {
        upsert(rows, opts) {
          bump(tally.upserts, table, rows.length);
          calls.push({ table, op: 'upsert', rows: rows.length,
                       onConflict: opts && opts.onConflict });
          let wanted = null;
          const q = {
            select(cols) { wanted = cols; return q; },
            then(onF, onR) {
              // Cles primaires synthetiques : applyPagePlan les moissonne
              // pour rattacher les enfants. Uniques et croissantes, comme
              // une sequence PostgreSQL.
              const data = wanted ? rows.map(r => ({ idx: r.idx, id: ++seq })) : null;
              return Promise.resolve({ data, error: null }).then(onF, onR);
            },
          };
          return q;
        },
        delete() {
          bump(tally.deletes, table, 1);
          calls.push({ table, op: 'delete' });
          const q = {
            eq() { return q; }, gt() { return q; }, not() { return q; },
            then(onF, onR) { return Promise.resolve({ data: null, error: null }).then(onF, onR); },
          };
          return q;
        },
      };
    },
  };
  return api;
}

// Enveloppe comptante autour du vrai client : delegue tout, tient le compte
// des lignes envoyees par table. On ne compte pas ce qu'on croit envoyer,
// on compte ce qui part.
export function countingClient(inner, tally) {
  return {
    from(table) {
      const t = inner.from(table);
      return {
        upsert(rows, opts) {
          bump(tally.upserts, table, rows.length);
          return t.upsert(rows, opts);
        },
        delete() {
          bump(tally.deletes, table, 1);
          return t.delete();
        },
      };
    },
  };
}

async function connect(env) {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: 'europanel' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* ══ Statut de page ══════════════════════════════════════════════════ */

// Reproduit hasContent() de docs/app.js, qui vit dans le navigateur et ne
// s'importe pas d'ici. Une page reprise doit porter le meme statut que si
// le formulaire venait de l'enregistrer, sinon la barre laterale changerait
// d'aspect apres la reprise.
export function pageStatus(flat) {
  const any = Object.values(flat || {})
    .some(v => v !== null && v !== undefined && v !== '');
  return any ? 'complete' : 'empty';
}

/* ══ Phase 1 — copie ═════════════════════════════════════════════════ */

const CHUNK = 100;

export function copyRows(rows) {
  return rows.map(r => ({
    submission_id: r.submission_id,
    page_id: r.page_id,
    status: pageStatus(r.data),
    raw: r.data || {},
    saved_at: r.saved_at || null,
  }));
}

async function phaseCopy(client, rows, tally) {
  const payload = copyRows(rows);
  for (let i = 0; i < payload.length; i += CHUNK) {
    const chunk = payload.slice(i, i + CHUNK);
    const res = await client.from('submission_pages')
      .upsert(chunk, { onConflict: 'submission_id,page_id' });
    if (res && res.error) {
      throw new Error('copie submission_pages : ' + res.error.message);
    }
  }
  return payload.length;
}

/* ══ Phase 2 — regeneration ══════════════════════════════════════════ */

// Une page. Passe par dispatch() et applyPagePlan() — ceux du webform.
async function regeneratePage(client, row) {
  const flat = row.data || {};
  const pageId = Number(row.page_id);
  await plan.applyPagePlan(client, {
    ops: dispatch(flat, pageId),
    submissionId: row.submission_id,
    pageId,
    status: row.status || pageStatus(flat),
    raw: flat,
    savedAt: row.saved_at || new Date().toISOString(),
  });
}

async function phaseRegenerate(client, rows, errors) {
  let done = 0;
  for (const row of rows) {
    try {
      await regeneratePage(client, row);
      done++;
    } catch (err) {
      errors.push({
        phase: 'regenerate',
        submission_id: row.submission_id,
        page_id: row.page_id,
        message: err && err.message ? err.message : String(err),
      });
    }
  }
  return done;
}

/* ══ Controles prealables lisibles en lecture seule ══════════════════ */

// Les tables a cles portent une cle etrangere composite vers ref_lists. Un
// code du manifeste absent du referentiel ferait echouer l'insertion en
// cours de route — apres que d'autres tables ont deja ete ecrites, puisque
// PostgREST n'ouvre pas de transaction. C'est verifiable a la lecture, donc
// c'est verifie avant.
export function refListGaps(refRows) {
  const have = new Set(refRows.map(r => r.list_code + '/' + r.code));
  const gaps = [];
  for (const [table, entry] of Object.entries(SCHEMA)) {
    if (entry.kind !== 'keyed') continue;
    for (const code of LISTS[entry.list]) {
      if (!have.has(entry.list + '/' + code)) {
        gaps.push({ table, list_code: entry.list, code });
      }
    }
  }
  return gaps;
}

export function missingSubmissions(rows, submissionIds) {
  const have = new Set(submissionIds);
  const missing = new Set();
  for (const r of rows) if (!have.has(r.submission_id)) missing.add(r.submission_id);
  return [...missing];
}

/* ══ Rapport ═════════════════════════════════════════════════════════ */

export function buildReport(parts) {
  const { mode, source, rows, audit, copyTally, regenTally, errors,
          gaps, missingSubs, copied, regenerated } = parts;

  const withValue = audit.unmapped.filter(u => u.filled);
  const empty = audit.unmapped.filter(u => !u.filled);
  const dropped = audit.coercions.filter(c => c.kind === 'dropped');
  const altered = audit.coercions.filter(c => c.kind === 'altered');

  const blockers = [];
  if (withValue.length) {
    blockers.push(withValue.length + ' clef(s) portant une valeur ne trouvent aucune ' +
                  'colonne : cette donnee ne serait pas reprise');
  }
  if (dropped.length) {
    blockers.push(dropped.length + ' valeur(s) perdue(s) a la conversion de type');
  }
  if (gaps.length) {
    blockers.push(gaps.length + ' code(s) du manifeste absent(s) de ref_lists : ' +
                  'la cle etrangere composite ferait echouer l\'ecriture');
  }
  if (missingSubs.length) {
    blockers.push(missingSubs.length + ' soumission(s) referencee(s) par page_data ' +
                  'sont absentes de submissions');
  }
  if (errors.length) {
    blockers.push(errors.length + ' erreur(s) rencontree(s) pendant l\'execution');
  }

  const safe = blockers.length === 0;
  const notes = [];
  if (empty.length) {
    notes.push(empty.length + ' clef(s) non couverte(s) mais vide(s) — sans effet ' +
               'sur la donnee, a nettoyer un jour dans le manifeste ou le formulaire');
  }
  if (altered.length) {
    notes.push(altered.length + ' valeur(s) reecrite(s) par la conversion numerique ' +
               '(non perdues, mais differentes de la saisie)');
  }

  return {
    generated_at: new Date().toISOString(),
    mode,
    source,
    wrote: mode !== 'dry-run',
    totals: {
      rows_read: rows.length,
      pages_copied: copied,
      pages_regenerated: regenerated,
      jsonb_keys: audit.keys,
      jsonb_keys_with_value: audit.filledKeys,
      jsonb_keys_empty: audit.keys - audit.filledKeys,
      unmapped_keys: audit.unmapped.length,
      unmapped_keys_with_value: withValue.length,
      unmapped_keys_empty: empty.length,
      coercion_dropped: dropped.length,
      coercion_altered: altered.length,
    },
    rows_written_by_table: {
      copy: copyTally.upserts,
      regenerate: regenTally.upserts,
    },
    deletes_by_table: {
      copy: copyTally.deletes,
      regenerate: regenTally.deletes,
    },
    // Les clefs portant une valeur d'abord : ce sont elles qui decident.
    unmapped_keys: withValue.concat(empty),
    coercion_losses: dropped.concat(altered),
    ref_list_gaps: gaps,
    missing_submissions: missingSubs,
    errors,
    notes,
    verdict: {
      safe,
      blockers,
      line: safe
        ? 'VERDICT : reprise sure — chaque clef porteuse de valeur trouve une ' +
          'colonne, aucune valeur perdue a la conversion.'
        : 'VERDICT : NE PAS APPLIQUER en l\'etat — ' + blockers.join(' ; ') + '.',
    },
  };
}

function tallyLine(map) {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '    (aucune)';
  return entries.map(([t, n]) => '    ' + t.padEnd(32) + String(n).padStart(6)).join('\n');
}

export function formatSummary(report) {
  const t = report.totals;
  const L = [];
  L.push('══ Reprise JSONB -> relationnel ══════════════════════════════');
  L.push('  mode              : ' + report.mode + (report.wrote ? '  (ECRITURE)' : '  (lecture seule)'));
  L.push('  source            : ' + report.source);
  L.push('  lignes lues       : ' + t.rows_read);
  L.push('  clefs JSONB       : ' + t.jsonb_keys +
         '  (avec valeur : ' + t.jsonb_keys_with_value +
         ', vides : ' + t.jsonb_keys_empty + ')');
  L.push('');
  L.push('  Lignes ' + (report.wrote ? 'ecrites' : 'qui seraient ecrites') + ' — phase copie :');
  L.push(tallyLine(report.rows_written_by_table.copy));
  L.push('  Lignes ' + (report.wrote ? 'ecrites' : 'qui seraient ecrites') + ' — phase regeneration :');
  L.push(tallyLine(report.rows_written_by_table.regenerate));
  L.push('');
  L.push('  Clefs non couvertes par le manifeste : ' + t.unmapped_keys +
         '  (porteuses de valeur : ' + t.unmapped_keys_with_value +
         ', vides : ' + t.unmapped_keys_empty + ')');
  for (const u of report.unmapped_keys.filter(x => x.filled).slice(0, 40)) {
    L.push('    ! sub ' + u.submission_id + ' page ' + u.page_id + '  ' +
           u.key + ' = ' + JSON.stringify(u.value) + '  [' + u.reason + ']');
  }
  const restFilled = t.unmapped_keys_with_value - Math.min(40, t.unmapped_keys_with_value);
  if (restFilled > 0) L.push('    … et ' + restFilled + ' autre(s), voir le rapport JSON');
  for (const u of report.unmapped_keys.filter(x => !x.filled).slice(0, 15)) {
    L.push('    · sub ' + u.submission_id + ' page ' + u.page_id + '  ' +
           u.key + ' (vide) [' + u.reason + ']');
  }
  const restEmpty = t.unmapped_keys_empty - Math.min(15, t.unmapped_keys_empty);
  if (restEmpty > 0) L.push('    … et ' + restEmpty + ' clef(s) vide(s), voir le rapport JSON');
  L.push('');
  L.push('  Valeurs perdues ou alterees a la conversion : ' +
         (t.coercion_dropped + t.coercion_altered) +
         '  (perdues : ' + t.coercion_dropped + ', alterees : ' + t.coercion_altered + ')');
  for (const c of report.coercion_losses.slice(0, 40)) {
    L.push('    ' + (c.kind === 'dropped' ? '!' : '·') + ' sub ' + c.submission_id +
           ' page ' + c.page_id + '  ' + c.field + ' (' + c.table + '.' + c.column +
           ' ' + c.type + ') : ' + JSON.stringify(c.original) + ' -> ' +
           JSON.stringify(c.result) + '  — ' + c.reason);
  }
  if (report.coercion_losses.length > 40) {
    L.push('    … et ' + (report.coercion_losses.length - 40) + ' autre(s), voir le rapport JSON');
  }
  if (report.ref_list_gaps.length) {
    L.push('');
    L.push('  Codes absents de ref_lists : ' + report.ref_list_gaps.length);
    for (const g of report.ref_list_gaps.slice(0, 20)) {
      L.push('    ! ' + g.list_code + '/' + g.code + '  (' + g.table + ')');
    }
  }
  if (report.missing_submissions.length) {
    L.push('');
    L.push('  Soumissions absentes de submissions : ' + report.missing_submissions.join(', '));
  }
  if (report.errors.length) {
    L.push('');
    L.push('  Erreurs :');
    for (const e of report.errors.slice(0, 20)) {
      L.push('    ! ' + e.phase + ' sub ' + e.submission_id + ' page ' + e.page_id +
             ' : ' + e.message);
    }
  }
  if (report.notes.length) {
    L.push('');
    for (const n of report.notes) L.push('  note : ' + n);
  }
  L.push('');
  L.push('  ' + report.verdict.line);
  L.push('══════════════════════════════════════════════════════════════');
  return L.join('\n');
}

/* ══ Execution ═══════════════════════════════════════════════════════ */

async function readPageData(client) {
  const { data, error } = await client
    .from('page_data')
    .select('submission_id,page_id,data,saved_at')
    .order('submission_id', { ascending: true })
    .order('page_id', { ascending: true });
  if (error) throw new Error('lecture page_data : ' + error.message);
  return data || [];
}

async function readSubmissionPages(client) {
  const { data, error } = await client
    .from('submission_pages')
    .select('submission_id,page_id,raw,status,saved_at')
    .order('submission_id', { ascending: true })
    .order('page_id', { ascending: true });
  if (error) throw new Error('lecture submission_pages : ' + error.message);
  return (data || []).map(r => ({
    submission_id: r.submission_id,
    page_id: r.page_id,
    data: r.raw || {},
    status: r.status,
    saved_at: r.saved_at,
  }));
}

export async function run(argv) {
  const args = parseArgs(argv);
  if (args.help) { console.log(USAGE); return 0; }

  const env = loadEnv();
  const real = await connect(env);

  // La phase 2 lit submission_pages : c'est la source dont la migration
  // reelle part, et la relire prouve que la copie a bien atterri. En
  // dry-run, submission_pages peut etre vide (phase 1 pas encore passee) :
  // on part alors de page_data, qui est par construction ce que la copie y
  // deposerait, a l'octet pres.
  const fromSubmissionPages = args.mode === 'regenerate';
  const rows = fromSubmissionPages ? await readSubmissionPages(real)
                                   : await readPageData(real);
  const source = fromSubmissionPages ? 'europanel.submission_pages.raw'
                                     : 'europanel.page_data.data';

  const audit = auditRows(rows);

  // Controles prealables, en lecture seule.
  const errors = [];
  let gaps = [], missingSubs = [];
  {
    const refs = await real.from('ref_lists').select('list_code,code');
    if (refs.error) {
      errors.push({ phase: 'preflight', submission_id: null, page_id: null,
                    message: 'lecture ref_lists : ' + refs.error.message });
    } else {
      gaps = refListGaps(refs.data || []);
    }
    const subs = await real.from('submissions').select('id');
    if (subs.error) {
      errors.push({ phase: 'preflight', submission_id: null, page_id: null,
                    message: 'lecture submissions : ' + subs.error.message });
    } else {
      missingSubs = missingSubmissions(rows, (subs.data || []).map(s => s.id));
    }
  }

  const copyTally = emptyTally();
  const regenTally = emptyTally();
  let copied = 0, regenerated = 0;

  if (!args.writes) {
    // Rien ne part sur le reseau : le plan complet tourne contre le double.
    const dryCopy = recordingClient(copyTally);
    const dryRegen = recordingClient(regenTally);
    copied = await phaseCopy(dryCopy, rows, copyTally);
    regenerated = await phaseRegenerate(dryRegen, rows, errors);
  } else {
    if (args.mode === 'copy' || args.mode === 'apply') {
      copied = await phaseCopy(countingClient(real, copyTally), rows, copyTally);
    }
    if (args.mode === 'regenerate' || args.mode === 'apply') {
      // Apres une copie, on relit submission_pages : la phase 2 doit partir
      // du filet, pas de la variable qu'on a sous la main. C'est ce qui la
      // rend rejouable seule.
      const src = args.mode === 'apply' ? await readSubmissionPages(real) : rows;
      regenerated = await phaseRegenerate(countingClient(real, regenTally), src, errors);
    }
  }

  const report = buildReport({
    mode: args.mode, source, rows, audit, copyTally, regenTally, errors,
    gaps, missingSubs, copied, regenerated,
  });

  fs.writeFileSync(args.out, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(formatSummary(report));
  console.log('Rapport complet : ' + args.out);
  return report.verdict.safe ? 0 : 1;
}

const invoked = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invoked) {
  run(process.argv.slice(2)).then(
    code => { process.exitCode = code; },
    err => {
      console.error('ECHEC : ' + (err && err.message ? err.message : String(err)));
      process.exitCode = 2;
    },
  );
}
