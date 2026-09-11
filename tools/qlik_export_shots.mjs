#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Captures du tableau de bord Qlik, par l'API de reporting.

   Pourquoi l'API plutot qu'un navigateur pilote : une capture faite dans
   un navigateur depend de la taille de la fenetre, de la police installee,
   du moment ou l'on declenche le cliche par rapport a la fin du rendu, et
   d'une session ouverte a la main. Rien de tout cela n'est reproductible
   d'une semaine a l'autre. Le service de reporting de Qlik Cloud rend la
   feuille cote serveur, avec les selections qu'on lui passe, et rend un
   fichier : meme entree, meme sortie.

   Flux, tel que le decrit qlik.dev :
     1. POST /api/v1/reports          -> 202 + en-tete Location
     2. GET  <Location>               -> statut : queued | processing | done
     3. GET  <status.results[].location> -> le fichier (valide une heure)

   Ce que le service sait rendre, et ce qu'il ne sait pas :
     · une FEUILLE entiere -> PDF ou PPTX (type 'sense-sheet-1.0')
     · un OBJET seul       -> PNG        (type 'sense-image-1.0')
   Il n'existe pas de PNG de feuille entiere. Une feuille demandee en PNG
   est donc refusee ici, plutot que rendue silencieusement en PDF : une
   presentation construite sur des PNG attendus se casserait a l'insertion,
   pas au moment de l'export.

   Configuration — la cle API est lue dans l'environnement de la machine
   (QLIK_API_KEY ou QlikCloudTraining, ou --key-env <NOM>), et en dernier
   recours dans .env. Le tenant vient de QLIK_TENANT ou du manifeste.

   Usage :
     node tools/qlik_export_shots.mjs [--manifest qlik/shots.json]
                                      [--out qlik/shots] [--only <id>,<id>]
                                      [--key-env <NOM>] [--reload] [--dry-run]
   ══════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parseEnv } from '../supabase/seed/demo_data.mjs';

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));

/* ══ Configuration ═══════════════════════════════════════════════════ */

/* Noms de variable acceptes pour la cle, dans cet ordre. La cle n'est jamais
   lue ni recopiee ailleurs que dans l'en-tete Authorization : elle ne passe
   ni par le manifeste, ni par la ligne de commande, ni par la sortie du
   script — un secret imprime une fois finit dans un journal de terminal. */
const KEY_VARS = ['QLIK_API_KEY', 'QlikCloudTraining'];

/* L'environnement de la machine l'emporte sur .env : garder la cle hors du
   depot vaut mieux que de compter sur .gitignore. .env reste accepte en
   second, pour une machine ou l'on ne veut pas poser de variable globale.
   Le tenant, lui, n'est pas un secret : le manifeste peut le porter. */
function loadQlikEnv(manifest, keyVar) {
  const file = path.join(REPO_ROOT, '.env');
  const fromFile = fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {};

  const tenant = process.env.QLIK_TENANT || fromFile.QLIK_TENANT ||
                 (manifest && manifest.tenant);
  if (!tenant) {
    throw new Error('tenant Qlik inconnu : poser QLIK_TENANT dans l\'environnement ' +
      'ou « tenant » dans le manifeste (https://<tenant>.<region>.qlikcloud.com).');
  }

  const names = keyVar ? [keyVar, ...KEY_VARS] : KEY_VARS;
  const found = names.find(n => process.env[n]) ;
  const apiKey = found ? process.env[found] : (fromFile.QLIK_API_KEY || null);
  if (!apiKey) {
    throw new Error('cle API Qlik introuvable. Variables essayees : ' + names.join(', ') +
      ' (puis QLIK_API_KEY dans .env).\n' +
      '  --key-env <NOM> designe une autre variable.\n' +
      '  Generer la cle dans Qlik Cloud : menu du profil, « Cles API »,\n' +
      '  « Generer une nouvelle cle ». Elle n\'est affichee qu\'une fois.\n' +
      '  Le rendu s\'execute avec les droits du porteur de la cle : une feuille\n' +
      '  privee reste donc accessible si la cle est celle de son proprietaire.');
  }

  return {
    QLIK_TENANT: String(tenant).replace(/\/+$/, ''),
    QLIK_API_KEY: apiKey,
    keySource: found ? 'variable d\'environnement ' + found : '.env',
  };
}

/* ══ Selections ══════════════════════════════════════════════════════ */

/* { Country: ['France', 'Germany'], 'Reference year': [2024] }
     -> forme attendue par selectionsByState, dans l'etat par defaut '$'.

   Les nombres sont marques isNumeric : passer 2024 comme texte ferait une
   selection sur la chaine « 2024 », qui ne trouve rien dans un champ
   numerique et rend une feuille vide sans le moindre message d'erreur. */
export function toSelectionsByState(selections) {
  if (!selections || !Object.keys(selections).length) return {};
  const fields = Object.entries(selections).map(([fieldName, raw]) => {
    const values = (Array.isArray(raw) ? raw : [raw]).map(v => (
      typeof v === 'number'
        ? { number: v, isNumeric: true }
        : { text: String(v), isNumeric: false }
    ));
    return { fieldName, values, defaultIsNumeric: false };
  });
  return { $: fields };
}

/* ══ Corps de requete ════════════════════════════════════════════════ */

// `orientation` n'accepte que P (portrait), L (paysage) ou A (automatique) —
// « landscape » en toutes lettres est rejete par un 400. L pour toutes les
// feuilles : un tableau de bord est large, le mettre en portrait le reduirait
// a une bande illisible au milieu de la page.
const PDF_DEFAULTS = {
  size: 'A4',
  orientation: 'L',
  imageRenderingDpi: 200,
  resizeType: 'autofit',
  align: { horizontal: 'center', vertical: 'middle' },
};

export function buildRequest(shot, appId) {
  const selectionsByState = toSelectionsByState(shot.selections);
  const format = shot.format || (shot.object ? 'png' : 'pdf');

  if (shot.sheet && shot.object) {
    throw new Error(shot.id + ' : « sheet » et « object » sont exclusifs.');
  }

  if (shot.object) {
    if (format !== 'png') {
      throw new Error(shot.id + ' : un objet seul ne se rend qu\'en PNG.');
    }
    return {
      type: 'sense-image-1.0',
      senseImageTemplate: {
        appId: shot.appId || appId,
        visualization: {
          id: shot.object,
          type: 'visualization',
          widthPx: shot.widthPx || 1280,
          heightPx: shot.heightPx || 720,
        },
        selectionsByState,
      },
      output: {
        outputId: shot.id,
        type: 'image',
        imageOutput: { outZoom: shot.zoom || 1, outDpi: shot.dpi || 96, outFormat: 'png' },
      },
    };
  }

  if (!shot.sheet) throw new Error(shot.id + ' : ni « sheet » ni « object ».');
  if (format === 'png') {
    throw new Error(shot.id + ' : le service ne rend pas une feuille entiere en PNG. ' +
      'Demander « pdf » ou « pptx » pour la feuille, ou viser un objet par son ' +
      'identifiant pour obtenir un PNG.');
  }
  if (format !== 'pdf' && format !== 'pptx') {
    throw new Error(shot.id + ' : format « ' + format + ' » inconnu (pdf, pptx, png).');
  }

  const output = { outputId: shot.id, type: format };
  if (format === 'pdf') output.pdfOutput = { ...PDF_DEFAULTS, ...(shot.pdf || {}) };

  return {
    type: 'sense-sheet-1.0',
    senseSheetTemplate: {
      appId: shot.appId || appId,
      sheet: { id: shot.sheet },
      selectionsByState,
    },
    output,
  };
}

/* ══ Appels HTTP ═════════════════════════════════════════════════════ */

async function qlikFetch(env, url, init = {}) {
  const full = url.startsWith('http') ? url : env.QLIK_TENANT + url;
  const res = await fetch(full, {
    ...init,
    headers: {
      Authorization: 'Bearer ' + env.QLIK_API_KEY,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  return res;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Le service met de quelques secondes a une minute selon la feuille. Un
   intervalle fixe court martele l'API pour rien sur les feuilles lentes ;
   l'attente croit donc jusqu'a trois secondes. */
async function waitForReport(env, statusUrl, log) {
  const deadline = Date.now() + 5 * 60 * 1000;
  let wait = 700;
  let seen = null;
  while (Date.now() < deadline) {
    const res = await qlikFetch(env, statusUrl);
    if (!res.ok) throw new Error('statut ' + res.status + ' : ' + (await res.text()));
    const body = await res.json();
    if (body.status !== seen) { seen = body.status; log('    ' + body.status); }
    if (body.status === 'done') return body;
    if (body.status === 'failed' || body.status === 'aborted') {
      throw new Error('rendu ' + body.status + ' : ' + JSON.stringify(body.results || body));
    }
    await sleep(wait);
    wait = Math.min(wait * 1.4, 3000);
  }
  throw new Error('rendu toujours en cours apres cinq minutes : ' + statusUrl);
}

/* ══ Rechargement de l'application ═══════════════════════════════════ */

/* Le service de reporting rend ce que l'application contient, pas ce que
   Supabase contient : une capture prise apres un nouveau seed, mais avant
   un rechargement, montre les anciens chiffres sans rien signaler. D'ou
   --reload, qui attend la fin du rechargement avant la premiere capture. */
export async function reloadApp(env, appId, log) {
  const res = await qlikFetch(env, '/api/v1/reloads', {
    method: 'POST', body: JSON.stringify({ appId }),
  });
  if (res.status !== 200 && res.status !== 201 && res.status !== 202) {
    throw new Error('POST /api/v1/reloads a rendu ' + res.status + ' : ' + (await res.text()));
  }
  const started = await res.json();
  const id = started.id;
  if (!id) throw new Error('rechargement lance sans identifiant : ' + JSON.stringify(started));

  const ACTIVE = new Set(['QUEUED', 'RELOADING', 'CANCELING']);
  const deadline = Date.now() + 20 * 60 * 1000;
  let wait = 1500;
  let seen = null;
  while (Date.now() < deadline) {
    const r = await qlikFetch(env, '/api/v1/reloads/' + id);
    if (!r.ok) throw new Error('statut du rechargement ' + r.status + ' : ' + (await r.text()));
    const body = await r.json();
    if (body.status !== seen) { seen = body.status; log('    ' + body.status); }
    if (!ACTIVE.has(body.status)) {
      if (body.status !== 'SUCCEEDED') {
        throw new Error('rechargement ' + body.status + ' : ' +
                        (body.log || body.errorMessage || JSON.stringify(body)));
      }
      return body;
    }
    await sleep(wait);
    wait = Math.min(wait * 1.3, 5000);
  }
  throw new Error('rechargement toujours en cours apres vingt minutes (' + id + ').');
}

async function downloadTo(env, location, file) {
  const res = await qlikFetch(env, location);
  if (!res.ok) throw new Error('telechargement ' + res.status + ' : ' + (await res.text()));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return fs.statSync(file).size;
}

export async function exportShot(env, shot, appId, outDir, log) {
  const body = buildRequest(shot, appId);
  const res = await qlikFetch(env, '/api/v1/reports', {
    method: 'POST', body: JSON.stringify(body),
  });
  if (res.status !== 202) {
    throw new Error('POST /api/v1/reports a rendu ' + res.status + ' : ' + (await res.text()));
  }
  const location = res.headers.get('location');
  if (!location) throw new Error('202 sans en-tete Location — rien a interroger.');

  const done = await waitForReport(env, location, log);
  const result = (done.results || [])[0];
  if (!result || !result.location) {
    throw new Error('rendu termine mais sans fichier : ' + JSON.stringify(done));
  }
  const ext = body.output.type === 'image' ? 'png' : body.output.type;
  const file = path.join(outDir, shot.id + '.' + ext);
  const size = await downloadTo(env, result.location, file);
  return { file, size };
}

/* ══ Execution ═══════════════════════════════════════════════════════ */

const USAGE = [
  'Usage : node tools/qlik_export_shots.mjs [options]',
  '',
  '  --manifest <chemin>  defaut : qlik/shots.json',
  '  --out <dossier>      defaut : qlik/shots',
  '  --only a,b,c         n\'exporte que ces identifiants de capture',
  '  --key-env <NOM>      variable d\'environnement portant la cle API',
  '  --reload             recharge l\'app et attend la fin avant de capturer',
  '  --dry-run            affiche les corps de requete, n\'appelle rien',
  '',
  'Cle API : variable d\'environnement QLIK_API_KEY ou QlikCloudTraining,',
  'sinon QLIK_API_KEY dans .env. Tenant : QLIK_TENANT, sinon « tenant » du',
  'manifeste.',
].join('\n');

export async function run(argv) {
  let manifestPath = path.join(REPO_ROOT, 'qlik', 'shots.json');
  let outDir = path.join(REPO_ROOT, 'qlik', 'shots');
  let only = null;
  let dry = false;
  let keyVar = null;
  let reload = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--manifest') { manifestPath = path.resolve(argv[++i] || ''); continue; }
    if (a === '--out') { outDir = path.resolve(argv[++i] || ''); continue; }
    if (a === '--only') { only = new Set((argv[++i] || '').split(',').filter(Boolean)); continue; }
    if (a === '--key-env') { keyVar = argv[++i] || null; continue; }
    if (a === '--reload') { reload = true; continue; }
    if (a === '--dry-run') { dry = true; continue; }
    if (a === '--help' || a === '-h') { console.log(USAGE); return 0; }
    throw new Error('argument inconnu : ' + a + '\n' + USAGE);
  }

  if (!fs.existsSync(manifestPath)) throw new Error('manifeste introuvable : ' + manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const appId = manifest.appId;
  if (!appId) throw new Error('le manifeste n\'indique pas « appId ».');

  const shots = manifest.shots.filter(s => !only || only.has(s.id));
  if (!shots.length) throw new Error('aucune capture a exporter.');

  // Deux captures de meme identifiant ecriraient dans le meme fichier, la
  // seconde effacant la premiere sans rien dire.
  const ids = shots.map(s => s.id);
  const dup = ids.filter((k, i) => ids.indexOf(k) !== i);
  if (dup.length) throw new Error('identifiants de capture en double : ' + [...new Set(dup)].join(', '));

  if (dry) {
    console.log('══ Captures Qlik — MODE A BLANC (aucun appel) ═══════════════');
    for (const s of shots) {
      console.log('\n── ' + s.id + (s.title ? '  (' + s.title + ')' : ''));
      console.log(JSON.stringify(buildRequest(s, appId), null, 2));
    }
    console.log('\n' + shots.length + ' capture(s). Relancer sans --dry-run pour exporter.');
    return 0;
  }

  const env = loadQlikEnv(manifest, keyVar);
  console.log('══ Captures Qlik ════════════════════════════════════════════');
  console.log('  tenant : ' + env.QLIK_TENANT);
  console.log('  app    : ' + appId);
  console.log('  cle    : ' + env.keySource);
  console.log('  sortie : ' + outDir);
  console.log('');

  if (reload) {
    console.log('  rechargement de l\'application avant capture');
    await reloadApp(env, appId, l => console.log(l));
    console.log('');
  }

  let ok = 0;
  const failures = [];
  for (const shot of shots) {
    console.log('  ' + shot.id + (shot.title ? '  — ' + shot.title : ''));
    try {
      const { file, size } = await exportShot(env, shot, appId, outDir,
                                              s => console.log(s));
      console.log('    ecrit : ' + path.relative(REPO_ROOT, file) +
                  '  (' + Math.round(size / 1024) + ' Ko)');
      ok++;
    } catch (err) {
      // Une capture qui echoue n'arrete pas les autres : au bout d'une serie
      // de vingt, tout reprendre depuis le debut pour une feuille fautive
      // coute plus cher que de la reprendre seule avec --only.
      const msg = err && err.message ? err.message : String(err);
      console.error('    ECHEC : ' + msg);
      failures.push(shot.id);
    }
  }

  console.log('');
  console.log('  ' + ok + '/' + shots.length + ' capture(s) exportee(s).');
  if (failures.length) {
    console.log('  a reprendre : node tools/qlik_export_shots.mjs --only ' + failures.join(','));
    return 1;
  }
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
