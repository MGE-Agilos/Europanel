#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Publication du script de chargement dans Qlik Cloud.

   Ce que le depot produit et ce que l'application execute etaient jusqu'ici
   relies a la main : gen_qlik_load_script.mjs ecrit quinze fichiers dans
   qlik/load-script/, et quelqu'un les deposait un par un dans « Fichiers de
   donnees » de l'espace. Un fichier oublie ne provoque aucune erreur — le
   rechargement reussit avec l'ancienne version — et le depot cesse alors de
   decrire l'application sans que rien ne le signale.

   Ce script fait le lien :
     1. retrouve la connexion DataFiles de l'espace,
     2. televerse chaque fichier de section (remplace s'il existe deja),
     3. pose 99_main.txt comme script de l'application, et l'enregistre,
     4. recharge, si --reload est demande.

   99_main.txt n'est pas televerse : il n'est pas inclus par un autre
   fichier, il EST le script de l'application.

   Configuration : meme cle que les autres outils Qlik du depot —
   QLIK_API_KEY ou QlikCloudTraining dans l'environnement.

   Usage :
     node tools/qlik_push_load_script.mjs [--app <id>] [--space Europanel]
                                          [--reload] [--dry-run]
   ══════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parseEnv } from '../supabase/seed/demo_data.mjs';
import { openEngine } from './qlik_engine.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const SCRIPT_DIR = path.join(ROOT, 'qlik', 'load-script');
const MAIN_FILE = '99_main.txt';
const KEY_VARS = ['QLIK_API_KEY', 'QlikCloudTraining'];

/* ══ Configuration ═══════════════════════════════════════════════════ */

function loadConfig(appArg, tenantArg) {
  const envFile = path.join(ROOT, '.env');
  const fromFile = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};

  const keyVar = KEY_VARS.find(n => process.env[n]);
  const apiKey = keyVar ? process.env[keyVar] : fromFile.QLIK_API_KEY;
  if (!apiKey) {
    throw new Error('cle API Qlik introuvable (' + KEY_VARS.join(', ') + ', ou .env).');
  }

  // Le manifeste des captures porte deja le tenant et l'app : les redemander
  // ici ferait deux endroits a corriger le jour d'un changement.
  let tenant = tenantArg || process.env.QLIK_TENANT || fromFile.QLIK_TENANT;
  let appId = appArg;
  const manifest = path.join(ROOT, 'qlik', 'shots.json');
  if ((!tenant || !appId) && fs.existsSync(manifest)) {
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    tenant = tenant || m.tenant;
    appId = appId || m.appId;
  }
  if (!tenant) throw new Error('tenant inconnu : poser QLIK_TENANT ou « tenant » dans qlik/shots.json.');
  if (!appId) throw new Error('application inconnue : passer --app ou renseigner qlik/shots.json.');

  return { tenant: String(tenant).replace(/\/+$/, ''), apiKey, appId,
           keySource: keyVar ? 'variable ' + keyVar : '.env' };
}

/* ══ API REST ════════════════════════════════════════════════════════ */

async function api(cfg, pathname, init = {}) {
  const res = await fetch(cfg.tenant + pathname, {
    ...init,
    headers: { Authorization: 'Bearer ' + cfg.apiKey, ...(init.headers || {}) },
  });
  if (!res.ok) {
    throw new Error(pathname + ' a rendu ' + res.status + ' : ' + (await res.text()).slice(0, 400));
  }
  return res.status === 204 ? null : res.json();
}

async function spaceIdOf(cfg, spaceName) {
  const r = await api(cfg, '/api/v1/spaces?name=' + encodeURIComponent(spaceName) + '&limit=10');
  const hit = (r.data || []).find(s => s.name === spaceName);
  if (!hit) throw new Error('espace introuvable : ' + spaceName);
  return hit.id;
}

async function connectionIdOf(cfg, spaceId) {
  const r = await api(cfg, '/api/v1/data-files/connections?limit=100');
  const hit = (r.data || []).find(c => c.spaceId === spaceId);
  if (!hit) throw new Error('aucune connexion DataFiles dans cet espace.');
  return hit.id;
}

async function existingFiles(cfg, connectionId) {
  const out = new Map();
  let url = '/api/v1/data-files?connectionId=' + connectionId + '&limit=100';
  for (;;) {
    const r = await api(cfg, url);
    for (const f of r.data || []) out.set(f.name, f.id);
    const next = r.links && r.links.next && r.links.next.href;
    if (!next) break;
    url = next.replace(cfg.tenant, '');
  }
  return out;
}

// `connectionId` est envoye AUSSI pour un remplacement. Sans lui, l'API ne
// laisse pas le fichier ou il etait : elle le range dans l'espace personnel
// du porteur de la cle, en repondant 200. Les inclusions de l'application
// cessent alors de le trouver, et le rechargement echoue sur un « file not
// found » qui ne dit pas que le fichier a demenage.
async function uploadFile(cfg, connectionId, name, contents, existingId) {
  const form = new FormData();
  form.append('File', new Blob([contents], { type: 'text/plain' }), name);
  form.append('Json', JSON.stringify({ name, connectionId }));

  const target = existingId ? '/api/v1/data-files/' + existingId : '/api/v1/data-files';
  const res = await fetch(cfg.tenant + target, {
    method: existingId ? 'PUT' : 'POST',
    headers: { Authorization: 'Bearer ' + cfg.apiKey },
    body: form,
  });
  if (!res.ok) {
    throw new Error(name + ' : ' + (existingId ? 'PUT' : 'POST') + ' ' + res.status + ' — ' +
                    (await res.text()).slice(0, 400));
  }
  return existingId ? 'remplace' : 'cree';
}

/* ══ Execution ═══════════════════════════════════════════════════════ */

const USAGE = [
  'Usage : node tools/qlik_push_load_script.mjs [options]',
  '',
  '  --app <id>       application cible (defaut : celle de qlik/shots.json)',
  '  --space <nom>    espace portant les fichiers (defaut : Europanel)',
  '  --reload         recharge l\'application apres publication',
  '  --dry-run        enumere ce qui serait publie, n\'ecrit rien',
].join('\n');

export async function run(argv) {
  let appArg = null, tenantArg = null, spaceName = 'Europanel';
  let reload = false, dry = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--app') { appArg = argv[++i]; continue; }
    if (a === '--tenant') { tenantArg = argv[++i]; continue; }
    if (a === '--space') { spaceName = argv[++i]; continue; }
    if (a === '--reload') { reload = true; continue; }
    if (a === '--dry-run') { dry = true; continue; }
    if (a === '--help' || a === '-h') { console.log(USAGE); return 0; }
    throw new Error('argument inconnu : ' + a + '\n' + USAGE);
  }

  const files = fs.readdirSync(SCRIPT_DIR).filter(f => f.endsWith('.txt')).sort();
  const sections = files.filter(f => f !== MAIN_FILE);
  if (!files.includes(MAIN_FILE)) {
    throw new Error(MAIN_FILE + ' absent de ' + SCRIPT_DIR + ' — lancer d\'abord ' +
                    'node tools/gen_qlik_load_script.mjs');
  }

  if (dry) {
    console.log('══ Publication du script — MODE A BLANC ═════════════════════');
    console.log('  espace : ' + spaceName);
    for (const f of sections) console.log('  fichier de donnees : ' + f);
    console.log('  script de l\'application : ' + MAIN_FILE);
    console.log('\n' + sections.length + ' fichier(s) + le script. Relancer sans --dry-run.');
    return 0;
  }

  const cfg = loadConfig(appArg, tenantArg);
  console.log('══ Publication du script de chargement ══════════════════════');
  console.log('  tenant : ' + cfg.tenant);
  console.log('  app    : ' + cfg.appId);
  console.log('  cle    : ' + cfg.keySource);

  const spaceId = await spaceIdOf(cfg, spaceName);
  const connectionId = await connectionIdOf(cfg, spaceId);
  const known = await existingFiles(cfg, connectionId);
  console.log('  espace : ' + spaceName + ' (' + known.size + ' fichier(s) deja en place)');
  console.log('');

  for (const name of sections) {
    const body = fs.readFileSync(path.join(SCRIPT_DIR, name), 'utf8');
    const what = await uploadFile(cfg, connectionId, name, body, known.get(name));
    console.log('  ' + name.padEnd(34) + what);
  }

  // Le script de l'application porte un en-tete d'onglet. Sans lui, l'editeur
  // de chargement affiche un onglet sans nom, ce qui est cosmetique mais
  // deroutant pour qui ouvre l'application ensuite.
  const main = fs.readFileSync(path.join(SCRIPT_DIR, MAIN_FILE), 'utf8');
  const script = main.startsWith('///$tab') ? main : '///$tab Main\n' + main;

  const eng = await openEngine(cfg.tenant, cfg.apiKey, cfg.appId);
  try {
    await eng.setScript(script);
    await eng.save();
    console.log('\n  script de l\'application : pose et enregistre');
  } finally {
    eng.close();
  }

  if (reload) {
    console.log('  rechargement…');
    const started = await api(cfg, '/api/v1/reloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: cfg.appId }),
    });
    const ACTIVE = new Set(['QUEUED', 'RELOADING', 'CANCELING']);
    let seen = null;
    for (;;) {
      const st = await api(cfg, '/api/v1/reloads/' + started.id);
      if (st.status !== seen) { seen = st.status; console.log('    ' + st.status); }
      if (!ACTIVE.has(st.status)) {
        if (st.status !== 'SUCCEEDED') {
          throw new Error('rechargement ' + st.status + ' : ' + (st.log || '').slice(0, 600));
        }
        break;
      }
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log('\n  Termine.');
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
