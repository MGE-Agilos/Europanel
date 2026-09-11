#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Retrait du jeu de donnees de demonstration.

   Ce script defait demo_data.mjs, et RIEN D'AUTRE. Il ne connait aucune
   ligne autrement que par son identifiant, lu dans
   supabase/seed/.demo-seed-ids.json — le registre que le seed ecrit au fil
   de l'eau.

   Regle de securite tenue partout : chaque suppression porte un filtre
   `in(<cle primaire>, [identifiants lus dans le registre])`. Il n'existe
   dans ce fichier aucun appel .delete() qui ne soit immediatement suivi
   d'un tel filtre, et aucun identifiant qui ne vienne du registre. Une
   liste vide n'envoie aucune requete du tout : PostgREST refuse un DELETE
   sans filtre, mais un `in.()` vide serait accepte et ne supprimerait rien
   — on s'abstient quand meme, pour que le compte rendu reste exact.

   Ordre : enfants avant parents, puis submissions (dont la cascade
   emporterait de toute facon les tables du questionnaire, mais on prefere
   supprimer explicitement ce qu'on a explicitement pose), puis plants,
   cycles, companies, et enfin les comptes d'authentification .invalid.

   Modes :
     --dry-run  (defaut) enumere ce qui serait supprime, n'ecrit rien
     --apply    supprime

   Le script refuse de supprimer tant que --apply n'est pas passe.
   ══════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fields = require('../../docs/fields.js');
const { SCHEMA } = fields;

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SEED_DIR = fileURLToPath(new URL('./', import.meta.url));
const IDS_FILE = path.join(SEED_DIR, '.demo-seed-ids.json');

/* ══ Environnement ═══════════════════════════════════════════════════ */
/* Identique a demo_data.mjs et a jsonb_to_relational.mjs. */

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
    throw new Error('.env introuvable (' + p + ').');
  }
  const env = parseEnv(fs.readFileSync(p, 'utf8'));
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!env[k]) throw new Error('.env : ' + k + ' manquant.');
  }
  return env;
}

async function connect(env) {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: 'europanel' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* ══ Lecture du registre ═════════════════════════════════════════════ */

export function readLedger(file) {
  const p = file || IDS_FILE;
  if (!fs.existsSync(p)) {
    throw new Error('registre introuvable (' + p + ') — sans lui, ce script ne ' +
      'sait pas quelles lignes lui appartiennent, et il ne devinera pas.');
  }
  const led = JSON.parse(fs.readFileSync(p, 'utf8'));
  for (const k of ['companies', 'plants', 'cycles', 'auth_users', 'submissions',
                   'submission_pages', 'tables']) {
    if (!(k in led)) throw new Error('registre incomplet : clef « ' + k + ' » absente.');
  }
  return led;
}

// Les identifiants du registre ne sont pas repris tels quels : un
// identifiant qui ne serait pas un entier positif (ou un UUID pour les
// comptes) ferait un filtre malforme, donc une suppression dont on ne
// maitriserait plus la portee. On les valide avant d'envoyer quoi que ce
// soit.
export function checkBigints(label, ids) {
  const out = [];
  for (const id of ids || []) {
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error(label + ' : identifiant invalide dans le registre — ' +
                      JSON.stringify(id));
    }
    out.push(id);
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function checkUuids(label, entries) {
  const out = [];
  for (const e of entries || []) {
    const id = e && e.id;
    if (typeof id !== 'string' || !UUID_RE.test(id)) {
      throw new Error(label + ' : UUID invalide dans le registre — ' + JSON.stringify(id));
    }
    // Garde-fou supplementaire : le seed ne cree que des adresses .invalid.
    // Un compte reel ne peut donc pas se retrouver ici, meme si le registre
    // etait edite a la main.
    if (typeof e.email !== 'string' || !/\.invalid$/i.test(e.email.trim())) {
      throw new Error(label + ' : adresse hors .invalid dans le registre — ' +
        JSON.stringify(e.email) + '. Ce script ne supprime que des comptes ' +
        'synthetiques ; refus de continuer.');
    }
    out.push({ id, email: e.email });
  }
  return out;
}

/* ══ Ordre de suppression ════════════════════════════════════════════ */

function depthOf(table) {
  let d = 0, cur = SCHEMA[table];
  while (cur && cur.parent) { d++; cur = SCHEMA[cur.parent]; }
  return d;
}

// Enfants d'abord : l'inverse exact de l'ordre d'insertion.
export function deletionOrder(tables) {
  return Object.keys(tables).sort((a, b) => depthOf(b) - depthOf(a));
}

/* ══ Suppression ═════════════════════════════════════════════════════ */

const CHUNK = 200;

// Le SEUL chemin de suppression du fichier. Il exige une colonne de cle et
// une liste non vide d'identifiants, et pose toujours le filtre `in`.
async function deleteByIds(client, table, pkCol, ids) {
  if (!ids.length) return 0;
  let removed = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const res = await client.from(table).delete().in(pkCol, chunk).select(pkCol);
    if (res.error) {
      throw new Error('DELETE ' + table + ' : ' + res.error.message +
        (res.error.code ? ' [code ' + res.error.code + ']' : '') +
        (res.error.details ? ' — ' + res.error.details : ''));
    }
    removed += (res.data || []).length;
  }
  return removed;
}

export async function apply(client, led, log) {
  const removed = {};
  const note = (t, n) => {
    removed[t] = (removed[t] || 0) + n;
    log(t.padEnd(32) + String(n).padStart(6));
  };

  /* ── 1. tables du questionnaire, enfants d'abord ──────────────── */
  for (const table of deletionOrder(led.tables)) {
    const slot = led.tables[table];
    if (!SCHEMA[table]) {
      throw new Error('registre : table « ' + table + ' » hors manifeste — refus.');
    }
    const pk = slot.pk === 'submission_id' ? 'submission_id' : 'id';
    if (slot.pk !== pk) {
      throw new Error('registre : cle primaire inattendue « ' + slot.pk +
                      ' » pour ' + table);
    }
    const ids = checkBigints(table, slot.ids);
    note(table, await deleteByIds(client, table, pk, ids));
  }

  /* ── 2. pages de soumission ───────────────────────────────────── */
  // Cle primaire composite (submission_id, page_id) : on supprime par
  // submission_id, tire du registre des soumissions creees. La cascade
  // depuis submissions ferait la meme chose, mais on prefere que ce qui a
  // ete pose explicitement soit retire explicitement.
  const subIds = checkBigints('submissions', led.submissions);
  note('submission_pages', await deleteByIds(client, 'submission_pages',
                                             'submission_id', subIds));

  /* ── 3. soumissions ───────────────────────────────────────────── */
  note('submissions', await deleteByIds(client, 'submissions', 'id', subIds));

  /* ── 4. sites, campagnes, entreprises ─────────────────────────── */
  note('plants', await deleteByIds(client, 'plants', 'id',
                                   checkBigints('plants', led.plants)));
  note('cycles', await deleteByIds(client, 'cycles', 'id',
                                   checkBigints('cycles', led.cycles)));
  note('companies', await deleteByIds(client, 'companies', 'id',
                                      checkBigints('companies', led.companies)));

  /* ── 5. comptes d'authentification synthetiques ───────────────── */
  // Un par un : l'API admin n'accepte pas de lot. Chaque UUID vient du
  // registre et chaque adresse a deja ete verifiee comme .invalid.
  const users = checkUuids('auth_users', led.auth_users);
  let deletedUsers = 0;
  for (const u of users) {
    const { error } = await client.auth.admin.deleteUser(u.id);
    if (error) {
      // Un compte deja absent n'est pas un echec : le but est atteint.
      if (!/not.?found/i.test(error.message || '')) {
        throw new Error('auth.admin.deleteUser ' + u.email + ' : ' + error.message);
      }
    } else {
      deletedUsers++;
    }
  }
  note('auth.users', deletedUsers);

  return removed;
}

/* ══ Execution ═══════════════════════════════════════════════════════ */

const USAGE = [
  'Usage : node supabase/seed/demo_data_cleanup.mjs [--dry-run|--apply] [--ledger <chemin>]',
  '',
  '  --dry-run        (defaut) enumere ce qui serait supprime, n\'ecrit rien',
  '  --apply          supprime les lignes consignees dans le registre',
  '  --ledger <chemin> registre a defaire (defaut : .demo-seed-ids.json)',
  '',
  'Ce script ne supprime que les identifiants presents dans le registre.',
  'Le seed est pose par vagues, chacune avec son propre registre : defaire',
  'une vague demande de designer le sien.',
].join('\n');

export async function run(argv) {
  let apply_ = false;
  let ledgerFile = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') { apply_ = true; continue; }
    if (a === '--dry-run') { continue; }
    if (a === '--ledger') {
      ledgerFile = argv[++i];
      if (!ledgerFile) throw new Error('--ledger attend un chemin\n' + USAGE);
      continue;
    }
    if (a === '--help' || a === '-h') { console.log(USAGE); return 0; }
    throw new Error('argument inconnu : ' + a + '\n' + USAGE);
  }

  const target = ledgerFile ? path.resolve(ledgerFile) : IDS_FILE;
  const led = readLedger(target);

  if (!apply_) {
    console.log('══ Nettoyage du seed de demonstration — MODE A BLANC ═════════');
    console.log('  registre : ' + target);
    console.log('  pose le  : ' + led.started_at +
                (led.finished_at ? '  (termine ' + led.finished_at + ')'
                                 : '  (RUN INCOMPLET)'));
    console.log('');
    let total = 0;
    for (const table of deletionOrder(led.tables)) {
      const n = led.tables[table].ids.length;
      console.log('  ' + table.padEnd(34) + String(n).padStart(6));
      total += n;
    }
    for (const [label, n] of [
      ['submission_pages', led.submission_pages.length],
      ['submissions', led.submissions.length],
      ['plants', led.plants.length],
      ['cycles', led.cycles.length],
      ['companies', led.companies.length],
      ['auth.users', led.auth_users.length],
    ]) {
      console.log('  ' + label.padEnd(34) + String(n).padStart(6));
      total += n;
    }
    console.log('  ' + 'TOTAL'.padEnd(34) + String(total).padStart(6));
    console.log('\nRelancer avec --apply pour supprimer.');
    return 0;
  }

  const env = loadEnv();
  const client = await connect(env);

  console.log('══ Nettoyage du seed de demonstration — SUPPRESSION ══════════');
  console.log('  cible : ' + env.SUPABASE_URL);
  console.log('');
  const removed = await apply(client, led, s => console.log('  ' + s));
  const total = Object.values(removed).reduce((a, b) => a + b, 0);
  console.log('');
  console.log('  ' + 'TOTAL'.padEnd(32) + String(total).padStart(6) + ' lignes supprimees');

  // Le registre est conserve, renomme : il reste la trace de ce qui a
  // existe, et une seconde execution ne peut pas le relire par megarde.
  const done = target.replace(/\.json$/, '') + '.removed-' +
               new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  fs.renameSync(target, done);
  console.log('  Registre archive : ' + done);
  return 0;
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
