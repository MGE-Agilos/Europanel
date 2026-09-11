/* ══════════════════════════════════════════════════════════════════════
   Integrite du schema — spec § 8, troisieme niveau.

   Verifie que chaque colonne declaree dans le manifeste existe reellement
   dans la base avec le type annonce, et reciproquement qu'aucune colonne du
   questionnaire n'existe en base sans que le manifeste la connaisse.

   ── Comment, faute d'information_schema ───────────────────────────────
   Il n'y a pas de RPC exec_sql sur ce projet : information_schema n'est pas
   joignable a travers PostgREST. Deux surfaces restent accessibles, et le
   fichier se sert des deux parce qu'elles ne prouvent pas la meme chose :

   1. Le document OpenAPI servi a la racine de /rest/v1/. PostgREST y decrit
      chaque table exposee et chaque colonne, avec son `format` PostgreSQL.
      C'est la seule source qui donne les types, et la seule qui permette le
      sens inverse (enumerer ce que la base a, pour le confronter au
      manifeste). Une simple requete ne le permettrait pas : sur une table
      vide, `select=*` ne rend aucune clef.

   2. Une vraie requete par table, demandant nommement toutes les colonnes
      du manifeste. PostgREST repond 400 / code 42703 des la premiere
      colonne absente. C'est plus faible que le point 1 sur les types, mais
      c'est plus fort sur un point : ca prouve que les colonnes sont
      selectionnables par le chemin exact qu'emprunte le webform, et non
      seulement decrites dans un document. Un test de negation accompagne
      cette requete, sans quoi « la requete a reussi » ne prouverait rien.

   ── Ce que ce fichier NE prouve PAS ───────────────────────────────────
   Il faut le dire, sinon le test promet plus qu'il ne tient :

   - Il lit le cache de schema de PostgREST, pas le catalogue PostgreSQL.
     Une colonne creee mais non encore rechargee dans le cache se lit comme
     absente ; une colonne supprimee juste avant pourrait, symetriquement,
     se lire encore comme presente. Le cache est recharge par Supabase apres
     une migration, mais rien ici ne le garantit a la milliseconde.
   - Le vocabulaire des types a change sous nos pieds. PostgREST annoncait
     `int32` et `int64` ; il annonce desormais les noms PostgreSQL,
     `smallint` et `bigint`. Les deux sont acceptes ici, parce que rien dans
     ce depot ne fixe la version de PostgREST qui repond : un test qui
     n'accepterait qu'un seul vocabulaire virerait au rouge le jour d'une
     mise a jour de Supabase, sans qu'aucune ligne du projet ait bouge.
   - Consequence : le type 'int' du manifeste est verifie comme « entier »,
     pas comme « SMALLINT ». Le DDL genere reste la reference sur ce point,
     et tests/gen-schema.test.mjs le couvre.
   - De meme, `text` couvre TEXT, VARCHAR et CHAR indifferemment.
   - Rien n'est verifie sur NOT NULL, les valeurs par defaut, les
     contraintes CHECK, les cles etrangeres, les index, les triggers ni les
     politiques RLS. Une colonne peut exister, avoir le bon type, et etre
     inaccessible en ecriture a cause d'une politique.
   - Rien n'est verifie sur la donnee elle-meme.
   - Les tables hors questionnaire (noyau et heritage) sont seulement
     tolerees par liste : ce fichier ne dit rien de leur forme.

   ── Sauter proprement ─────────────────────────────────────────────────
   Le test a besoin de la base. Sans .env, ou tant que le schema relationnel
   n'est pas applique, chaque cas est saute avec une raison explicite (node:test
   les marque SKIP et les compte a part : un test saute ne se lit pas comme
   un test passe). Il n'echoue pas non plus, parce que « la migration n'est
   pas encore appliquee » n'est pas un defaut du code.
   ══════════════════════════════════════════════════════════════════════ */
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { parseEnv, REPO_ROOT } from '../supabase/migrate/jsonb_to_relational.mjs';

const require = createRequire(import.meta.url);
const { SCHEMA } = require('../docs/fields.js');
const { parentColumn } = require('../docs/db.js');

/* ── Correspondance manifeste -> format PostgREST ─────────────────────── */

// Le `format` que PostgREST annonce pour chaque type du manifeste. Chaque
// entree liste les deux vocabulaires possibles — l'ancien (int32) et celui
// des noms PostgreSQL (smallint, integer) : voir l'entete.
const EXPECTED_FORMAT = {
  text: ['text'],
  num: ['numeric'],
  int: ['int32', 'smallint', 'integer'],
  bool: ['boolean'],
};

// Colonnes que le generateur ajoute a toute table et que le manifeste ne
// declare pas : elles ne portent aucun champ du questionnaire. Les traiter
// comme « inconnues du manifeste » ferait echouer le sens inverse sur les
// quarante tables.
function structuralColumns(table, entry) {
  const attach = entry.parent ? parentColumn(entry) : 'submission_id';
  // Listes, et non chaines : meme raison que EXPECTED_FORMAT ci-dessus, les
  // deux vocabulaires de PostgREST doivent passer.
  const ID = ['int64', 'bigint'];
  const cols = { updated_at: ['timestamp with time zone'] };
  if (entry.kind === 'one') {
    cols.submission_id = ID;
  } else {
    cols.id = ID;
    cols[attach] = ID;
    if (entry.kind === 'many') cols.idx = ['int32', 'smallint', 'integer'];
    if (entry.kind === 'keyed') { cols.code = ['text']; cols.list_code = ['text']; }
  }
  return cols;
}

// Tables presentes dans le schema europanel sans etre au manifeste : le
// noyau (spec § 4.1) et l'heritage de 001_schema.sql. Toute autre table
// portant des colonnes du questionnaire doit faire echouer le sens inverse.
const NON_QUESTIONNAIRE_TABLES = new Set([
  'plants', 'cycles', 'ref_lists', 'submission_pages', 'audit_log',
  'companies', 'submissions', 'page_data',
]);

/* ── Acces a la base ──────────────────────────────────────────────────── */

const ENV_FILE = path.join(REPO_ROOT, '.env');

async function probe() {
  if (!fs.existsSync(ENV_FILE)) {
    return { skip: '.env absent — pas d\'acces a la base depuis cette machine' };
  }
  let env;
  try {
    env = parseEnv(fs.readFileSync(ENV_FILE, 'utf8'));
  } catch (err) {
    return { skip: '.env illisible : ' + err.message };
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { skip: '.env incomplet — SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY manquant' };
  }

  const headers = {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: 'Bearer ' + env.SUPABASE_SERVICE_ROLE_KEY,
    'Accept-Profile': 'europanel',
  };

  let doc;
  try {
    const res = await fetch(env.SUPABASE_URL + '/rest/v1/', { headers });
    if (!res.ok) {
      return { skip: 'PostgREST a repondu ' + res.status + ' sur /rest/v1/ — ' +
                     'schema europanel non expose ou identifiants refuses' };
    }
    doc = await res.json();
  } catch (err) {
    return { skip: 'base injoignable : ' + (err && err.message ? err.message : String(err)) };
  }

  const defs = doc.definitions || (doc.components && doc.components.schemas) || {};
  const manifestTables = Object.keys(SCHEMA);
  const present = manifestTables.filter(t => defs[t]);
  if (present.length === 0) {
    // Aucune des trente-cinq tables du questionnaire : la migration 002
    // n'a pas encore ete passee. Ce n'est pas un defaut a signaler ici.
    return { skip: 'schema relationnel non applique — aucune des ' +
                   manifestTables.length + ' tables du questionnaire ' +
                   'n\'est exposee (migrations 002/003 a passer)' };
  }
  return { defs, url: env.SUPABASE_URL, headers, partial: present.length !== manifestTables.length };
}

const db = await probe();
// node:test attend `false` (et non une chaine vide) pour « ne pas sauter ».
const skip = db.skip || false;
const opts = { skip };

function columnsOf(table) {
  const d = db.defs[table];
  return d && d.properties ? d.properties : null;
}

/* ── Sens direct : le manifeste -> la base ────────────────────────────── */

test('chaque table du manifeste existe dans le schema expose', opts, () => {
  const missing = Object.keys(SCHEMA).filter(t => !db.defs[t]);
  assert.deepStrictEqual(missing, [],
    'tables declarees au manifeste et absentes de la base : ' + missing.join(', '));
});

test('chaque colonne declaree au manifeste existe, avec le type annonce', opts, () => {
  const problems = [];
  for (const [table, entry] of Object.entries(SCHEMA)) {
    const props = columnsOf(table);
    if (!props) { problems.push(table + ' : table absente'); continue; }
    for (const [col, type] of Object.entries(entry.cols)) {
      const prop = props[col];
      if (!prop) { problems.push(table + '.' + col + ' : colonne absente'); continue; }
      const wanted = EXPECTED_FORMAT[type];
      if (!wanted) { problems.push(table + '.' + col + ' : type manifeste inconnu ' + type); continue; }
      if (wanted.indexOf(prop.format) < 0) {
        problems.push(table + '.' + col + ' : manifeste « ' + type + ' » (' +
                      wanted.join('|') + ') mais la base annonce « ' + prop.format + ' »');
      }
    }
  }
  assert.deepStrictEqual(problems, [], '\n  - ' + problems.join('\n  - '));
});

test('les colonnes de structure sont la, avec le type attendu', opts, () => {
  // Cle de rattachement, indice d'instance, code de liste : sans elles, une
  // colonne metier correcte serait posee sur une ligne qu'on ne saurait
  // rattacher a personne.
  const problems = [];
  for (const [table, entry] of Object.entries(SCHEMA)) {
    const props = columnsOf(table);
    if (!props) continue;
    for (const [col, formats] of Object.entries(structuralColumns(table, entry))) {
      const prop = props[col];
      if (!prop) { problems.push(table + '.' + col + ' : colonne de structure absente'); continue; }
      if (formats.indexOf(prop.format) < 0) {
        problems.push(table + '.' + col + ' : attendu « ' + formats.join('|') +
                      ' », la base annonce « ' + prop.format + ' »');
      }
    }
  }
  assert.deepStrictEqual(problems, [], '\n  - ' + problems.join('\n  - '));
});

/* ── Sens inverse : la base -> le manifeste ───────────────────────────── */

test('aucune colonne du questionnaire n\'existe en base hors du manifeste', opts, () => {
  const extra = [];
  for (const [table, entry] of Object.entries(SCHEMA)) {
    const props = columnsOf(table);
    if (!props) continue;
    const known = new Set(Object.keys(entry.cols)
      .concat(Object.keys(structuralColumns(table, entry))));
    for (const col of Object.keys(props)) {
      if (!known.has(col)) extra.push(table + '.' + col);
    }
  }
  // Une colonne de plus en base, c'est soit une colonne que plus personne
  // ne remplit, soit un champ dont le manifeste a perdu la trace. Les deux
  // meritent d'etre vus.
  assert.deepStrictEqual(extra, [],
    'colonnes presentes en base et absentes du manifeste : ' + extra.join(', '));
});

test('aucune table du questionnaire n\'existe en base hors du manifeste', opts, () => {
  const unknown = Object.keys(db.defs)
    .filter(t => !SCHEMA[t] && !NON_QUESTIONNAIRE_TABLES.has(t));
  assert.deepStrictEqual(unknown, [],
    'tables exposees, ni au manifeste ni au noyau : ' + unknown.join(', '));
});

/* ── Verification par requete reelle ──────────────────────────────────── */

// Le document OpenAPI decrit ce que PostgREST croit servir. Ceci verifie
// qu'il le sert : une requete par table, demandant nommement chaque colonne
// du manifeste. C'est le chemin exact du webform.
async function selectColumns(table, cols) {
  const url = db.url + '/rest/v1/' + table +
              '?select=' + encodeURIComponent(cols.join(',')) + '&limit=0';
  const res = await fetch(url, { headers: db.headers });
  if (res.ok) return null;
  let body = {};
  try { body = await res.json(); } catch { /* corps non JSON */ }
  return { status: res.status, code: body.code, message: body.message };
}

test('chaque colonne du manifeste est reellement selectionnable', opts, async () => {
  const problems = [];
  for (const [table, entry] of Object.entries(SCHEMA)) {
    const cols = Object.keys(entry.cols);
    if (!cols.length) continue;
    const err = await selectColumns(table, cols);
    // 42703 = undefined_column. PostgREST nomme la premiere colonne fautive.
    if (err) problems.push(table + ' : ' + err.code + ' ' + err.message);
  }
  assert.deepStrictEqual(problems, [], '\n  - ' + problems.join('\n  - '));
});

test('une colonne inventee est bien refusee — le test precedent peut echouer', opts, async () => {
  // Sans ce controle de negation, « la requete a reussi » ne prouverait
  // rien : une reponse 200 sur n'importe quoi rendrait le test precedent
  // incapable de detecter quoi que ce soit.
  const err = await selectColumns('contacts', ['colonne_qui_n_existe_pas']);
  assert.ok(err, 'PostgREST a accepte une colonne inexistante');
  assert.strictEqual(err.code, '42703');
});

/* ── Garde-fou sur le saut lui-meme ───────────────────────────────────── */

// Un fichier entierement saute passe inapercu dans un rapport de test. Ce
// cas-ci n'est jamais saute : il affiche la raison, de sorte que l'absence
// de verification soit lisible et non silencieuse.
test('l\'acces a la base est disponible, ou la raison du saut est dite', () => {
  if (db.skip) {
    console.log('  schema-integrity : VERIFICATION NON EFFECTUEE — ' + db.skip);
  }
  assert.ok(db.skip || db.defs, 'ni acces a la base, ni raison de saut');
});

test('le schema expose est complet, ou le dit', opts, () => {
  assert.ok(!db.partial,
    'le schema n\'est que partiellement applique — certaines tables du ' +
    'manifeste manquent (voir le premier cas)');
});
