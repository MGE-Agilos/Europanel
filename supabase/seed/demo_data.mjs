#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Jeu de donnees de demonstration (presentation EPF, TWG
   Environnement & Technique des 23-24 septembre 2026).

   Ce script AJOUTE des donnees synthetiques a la base vivante. Il ne
   modifie et ne supprime jamais une ligne existante : il n'emet que des
   INSERT, jamais d'UPDATE ni d'UPSERT. Un upsert pourrait, sur conflit de
   cle, reecrire une ligne que quelqu'un d'autre a posee ; un insert pur ne
   le peut pas — il echoue, ce qui est le comportement voulu ici.

   Les entreprises sont FICTIVES. La fabrication de panneaux a base de bois
   compte des acteurs identifiables ; aucun nom reel n'est employe, ce qui
   honore l'engagement ecrit pris aupres de l'EPF : aucune donnee
   d'exploitant reel n'est presentee en demonstration. Les comptes
   d'authentification crees le sont sur le TLD .invalid, reserve par la
   RFC 2606 a des adresses garanties non routables.

   Les lignes du questionnaire ne sont pas fabriquees a la main table par
   table : on construit la carte plate {nom_champ: valeur} que le formulaire
   produirait, puis on la passe a dispatch() — le MEME dispatcher que le
   webform et que la reprise JSONB. Le manifeste reste ainsi la seule source
   de verite de la correspondance champ -> table/colonne, et une colonne
   ajoutee demain au manifeste est reprise ici sans retouche.

   Identifiants : lus depuis .env a la racine du depot, comme
   supabase/migrate/jsonb_to_relational.mjs. La cle service_role n'est
   jamais affichee.

   Tout identifiant cree est consigne AU FIL DE L'EAU dans
   supabase/seed/.demo-seed-ids.json (ignore par git), de sorte qu'un run
   interrompu reste entierement nettoyable par demo_data_cleanup.mjs.

   Modes :
     --dry-run   (defaut) construit tout le jeu de donnees, n'ecrit rien,
                 et affiche le decompte par table
     --apply     ecrit reellement

   Le script refuse d'ecrire tant que --apply n'est pas passe.
   ══════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fields = require('../../docs/fields.js');
const db = require('../../docs/db.js');

const { SCHEMA, LISTS } = fields;
const { buildName, fieldSegment, dispatch, parentColumn } = db;

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SEED_DIR = fileURLToPath(new URL('./', import.meta.url));
const IDS_FILE = path.join(SEED_DIR, '.demo-seed-ids.json');

/* ══ Environnement ═══════════════════════════════════════════════════ */
/* Meme lecture que jsonb_to_relational.mjs : pas de dependance ajoutee
   pour trois lignes, et surtout aucune valeur par defaut en dur — une cle
   absente doit faire echouer, pas se rabattre sur autre chose. */

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
    throw new Error('.env introuvable (' + p + ') — le seed a besoin de ' +
                    'SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY.');
  }
  const env = parseEnv(fs.readFileSync(p, 'utf8'));
  for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!env[k]) throw new Error('.env : ' + k + ' manquant.');
  }
  return env;
}

/* ══ Generateur pseudo-aleatoire deterministe ════════════════════════ */
/* Graine fixe : deux executions produisent le meme jeu de valeurs, ce qui
   rend une anomalie constatee dans le tableau de bord reproductible. */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(20260923);

// Nombre dans [min, max], arrondi a `dec` decimales.
function num(min, max, dec = 1) {
  const v = min + rnd() * (max - min);
  const f = Math.pow(10, dec);
  return Math.round(v * f) / f;
}
function int(min, max) { return Math.floor(min + rnd() * (max - min + 1)); }
function pick(arr) { return arr[Math.floor(rnd() * arr.length)]; }

/* ══ Ecriture dans la carte plate, pilotee par le manifeste ══════════ */
/* On ne tape jamais un nom de champ en dur : il est construit depuis le
   patron du manifeste, exactement comme dispatch() le reconstruira a la
   lecture. Une colonne inconnue leve, plutot que de deposer silencieusement
   une valeur dans une clef que personne ne relira. */

function entryOf(table) {
  const e = SCHEMA[table];
  if (!e) throw new Error('table hors manifeste : ' + table);
  return e;
}

function checkCols(table, entry, values) {
  for (const col of Object.keys(values)) {
    if (!(col in entry.cols)) {
      throw new Error('colonne inconnue « ' + col + ' » pour la table ' + table);
    }
  }
}

// Table 1:1 — les colonnes portent directement le nom du champ HTML.
function setOne(flat, table, values) {
  const entry = entryOf(table);
  if (entry.kind !== 'one') throw new Error(table + " n'est pas une table 1:1");
  checkCols(table, entry, values);
  for (const [col, val] of Object.entries(values)) {
    if (val === undefined || val === null) continue;
    flat[col] = String(val);
  }
}

// Section repetable — une instance, a l'indice idx (1-based).
function setMany(flat, table, idx, values) {
  const entry = entryOf(table);
  if (entry.kind !== 'many') throw new Error(table + " n'est pas une section repetable");
  checkCols(table, entry, values);
  for (const [col, val] of Object.entries(values)) {
    if (val === undefined || val === null) continue;
    flat[buildName(entry.pattern, { idx, col: fieldSegment(entry, col) })] = String(val);
  }
}

// Compteur declare d'une section repetable (cu_count, ep_count…). Il fait
// autorite dans countInstances : sans lui, une instance dont toutes les
// colonnes sont vides disparaitrait du dispatch.
function setCount(flat, table, n) {
  const entry = entryOf(table);
  if (entry.countField) flat[entry.countField] = String(n);
}

// Groupe a cles — une ligne pour un code. parentIdx seulement pour les
// tables enfants.
function setKeyed(flat, table, code, values, parentIdx) {
  const entry = entryOf(table);
  if (entry.kind !== 'keyed') throw new Error(table + " n'est pas un groupe a cles");
  if (!LISTS[entry.list].includes(code)) {
    throw new Error('code « ' + code + ' » absent de la liste ' + entry.list +
                    ' (table ' + table + ')');
  }
  if (entry.parent && (parentIdx === undefined || parentIdx === null)) {
    throw new Error(table + ' est une table enfant : parentIdx est requis');
  }
  checkCols(table, entry, values);
  for (const [col, val] of Object.entries(values)) {
    if (val === undefined || val === null) continue;
    const parts = { code, col: fieldSegment(entry, col) };
    if (entry.parent) parts.parent_idx = parentIdx;
    flat[buildName(entry.pattern, parts)] = String(val);
  }
}

/* ══ Le jeu de donnees ═══════════════════════════════════════════════ */

/* ── Entreprises fictives ───────────────────────────────────────────
   Aucun de ces noms n'appartient a un fabricant reel de panneaux. Ils sont
   construits sur des toponymes et des mots communs, dans dix pays de
   l'Union, pour que le filtre « pays » du tableau de bord ait de quoi
   travailler. */
// La repartition suit la concentration reelle du secteur telle que l'EPF
// la publie : l'Allemagne, la Pologne et l'Italie pesent lourd, une longue
// traine de pays ne compte qu'un site. Un panel ou chaque pays apporterait
// le meme nombre de sites ne ressemblerait a aucune industrie, et un
// graphique « sites par pays » y serait un escalier plat sans information.
export const COMPANIES = [
  // ── poids lourds ────────────────────────────────────────────────
  { key: 'lindenw',  name: 'Lindenwerk Holzplatten GmbH',   country: 'Germany' },
  { key: 'rheinsp',  name: 'Rheinspan Werke AG',            country: 'Germany' },
  { key: 'harzholz', name: 'Harzholz Plattenwerke GmbH',    country: 'Germany' },
  { key: 'vistula',  name: 'Vistula Plyta Sp. z o.o.',      country: 'Poland' },
  { key: 'bialowie', name: 'Bialowieza Panele SA',          country: 'Poland' },
  { key: 'silvater', name: 'Silvaterra Pannelli SpA',       country: 'Italy' },
  { key: 'padania',  name: 'Padania Legno Srl',             country: 'Italy' },
  { key: 'boisred',  name: 'Bois du Redon SAS',             country: 'France' },
  { key: 'vosgesp',  name: 'Vosges Panneaux SAS',           country: 'France' },
  { key: 'verdalia', name: 'Verdalia Tableros SL',          country: 'Spain' },
  { key: 'ibertab',  name: 'Ibertablero SA',               country: 'Spain' },
  // ── milieu de tableau ───────────────────────────────────────────
  { key: 'carpatpl', name: 'Carpatica Placaje SRL',         country: 'Romania' },
  { key: 'anatolia', name: 'Anatolia Panel AS',             country: 'Turkey' },
  { key: 'alpenpl',  name: 'Alpenplatten Werke GmbH',       country: 'Austria' },
  { key: 'ardenne',  name: 'Ardenne Panneaux SA',           country: 'Belgium' },
  { key: 'moravia',  name: 'Moravia Desky a.s.',            country: 'Czech Republic' },
  { key: 'douro',    name: 'Douro Compositos Lda',          country: 'Portugal' },
  { key: 'norrskog', name: 'Norrskog Skivindustri AB',      country: 'Sweden' },
  // ── un site chacun ──────────────────────────────────────────────
  { key: 'metsalev', name: 'Metsalevy Oy',                  country: 'Finland' },
  { key: 'pennineb', name: 'Pennine Boards Ltd',            country: 'United Kingdom' },
  { key: 'nordhavn', name: 'Nordhavn Panelworks A/S',       country: 'Denmark' },
  { key: 'baltfib',  name: 'Baltic Fibreboard Group SIA',   country: 'Latvia' },
  { key: 'nemunas',  name: 'Nemunas Plokstes UAB',          country: 'Lithuania' },
  { key: 'peipsi',   name: 'Peipsi Plaaditehas AS',         country: 'Estonia' },
  { key: 'pannonlap',name: 'Pannonia Lapgyar Zrt.',         country: 'Hungary' },
  { key: 'tatradosk',name: 'Tatra Dosky s.r.o.',            country: 'Slovakia' },
  { key: 'triglav',  name: 'Triglav Plosce d.o.o.',         country: 'Slovenia' },
  { key: 'slavonp',  name: 'Slavonija Ploce d.o.o.',        country: 'Croatia' },
  { key: 'rodopip',  name: 'Rodopi Panels AD',              country: 'Bulgaria' },
  { key: 'pindosp',  name: 'Pindos Panel SA',               country: 'Greece' },
  { key: 'shannon',  name: 'Shannon Board Products Ltd',    country: 'Ireland' },
  { key: 'delftpan', name: 'Delft Paneelfabriek BV',        country: 'Netherlands' },
  { key: 'fjordsk',  name: 'Fjordskiva AS',                 country: 'Norway' },
];

/* ── Sites de production ────────────────────────────────────────────
   `scale` pilote le tonnage, la puissance thermique installee et les debits
   de gaz ; `cap` etale la capacite a l'interieur d'un meme palier, pour que
   la production annuelle ne se resume pas a trois valeurs repetees ; `trend`
   donne la derive des concentrations d'une campagne a l'autre (< 1 = site
   qui s'ameliore, > 1 = site qui derive) ; `dirt` la salete relative, qui
   decide aussi du profil des cheminees.

   `joined` et `skips` pilotent la PARTICIPATION, pas les mesures :

     · `joined` est la premiere annee de reference pour laquelle le site a
       repondu. Un panel ne nait pas complet : l'EPF recrute ses membres au
       fil des campagnes, et c'est ce qui fait qu'un graphe « reponses par
       annee de reference » monte au lieu d'etre un rectangle plat.

     · `skips` enumere les annees ou le site n'a rien rendu alors qu'il
       faisait deja partie du panel. La non-reponse ponctuelle existe dans
       toute collecte volontaire ; sans elle, le taux de completion serait
       de 100 % partout et la page « qualite des donnees » n'aurait rien a
       montrer.

   Le nombre de sites par societe est lui aussi inegal — de un a quatre —
   comme l'est le nombre de societes par pays. Un panel ou chaque societe
   exploiterait le meme nombre de sites ne ressemblerait a aucune industrie. */
export const PLANTS = [
  /* ── Allemagne : 7 sites, 3 societes ──────────────────────────── */
  { key: 'p01', company: 'lindenw', name: 'Lindenwerk Holzplatten — Eberswalde',
    city: 'Eberswalde', country: 'Germany', started: 1999, scale: 'large',
    cap: 1.22, products: ['PB', 'MDF', 'HDF'], trend: 0.95, dirt: 0.88, joined: 2021 },
  { key: 'p02', company: 'lindenw', name: 'Lindenwerk Holzplatten — Memmingen',
    city: 'Memmingen', country: 'Germany', started: 2013, scale: 'medium',
    cap: 0.94, products: ['OSB'], trend: 0.97, dirt: 0.75, joined: 2021 },
  { key: 'p03', company: 'lindenw', name: 'Lindenwerk Holzplatten — Lueneburg',
    city: 'Lueneburg', country: 'Germany', started: 1978, scale: 'large',
    cap: 1.41, products: ['PB', 'OSB'], trend: 0.93, dirt: 1.04, joined: 2021,
    skips: [2023] },
  { key: 'p04', company: 'rheinsp', name: 'Rheinspan Werke — Wesel Plant',
    city: 'Wesel', country: 'Germany', started: 1985, scale: 'large',
    cap: 1.08, products: ['PB', 'MDF'], trend: 0.96, dirt: 1.12, joined: 2021 },
  { key: 'p05', company: 'rheinsp', name: 'Rheinspan Werke — Koblenz Plant',
    city: 'Koblenz', country: 'Germany', started: 2008, scale: 'medium',
    cap: 1.03, products: ['MDF', 'HDF'], trend: 0.91, dirt: 0.69, joined: 2022 },
  { key: 'p06', company: 'harzholz', name: 'Harzholz Plattenwerke — Goslar Mill',
    city: 'Goslar', country: 'Germany', started: 1972, scale: 'medium',
    cap: 0.86, products: ['HB', 'SB'], trend: 1.02, dirt: 1.33, joined: 2021 },
  { key: 'p07', company: 'harzholz', name: 'Harzholz Plattenwerke — Nordhausen',
    city: 'Nordhausen', country: 'Germany', started: 2016, scale: 'small',
    cap: 1.18, products: ['MBH'], trend: 0.89, dirt: 0.54, joined: 2024 },

  /* ── Pologne : 6 sites, 2 societes ────────────────────────────── */
  { key: 'p08', company: 'vistula', name: 'Vistula Plyta — Grudziadz Plant',
    city: 'Grudziadz', country: 'Poland', started: 1984, scale: 'large',
    cap: 1.35, products: ['PB', 'MDF'], trend: 1.03, dirt: 1.30, joined: 2021 },
  { key: 'p09', company: 'vistula', name: 'Vistula Plyta — Zamosc Plant',
    city: 'Zamosc', country: 'Poland', started: 2007, scale: 'medium',
    cap: 0.91, products: ['MDF'], trend: 0.96, dirt: 0.90, joined: 2021 },
  { key: 'p10', company: 'vistula', name: 'Vistula Plyta — Plock Works',
    city: 'Plock', country: 'Poland', started: 1996, scale: 'large',
    cap: 1.16, products: ['OSB', 'PB'], trend: 1.00, dirt: 1.19, joined: 2022 },
  { key: 'p11', company: 'vistula', name: 'Vistula Plyta — Suwalki Plant',
    city: 'Suwalki', country: 'Poland', started: 2019, scale: 'small',
    cap: 1.27, products: ['MDF'], trend: 0.88, dirt: 0.49, joined: 2024 },
  { key: 'p12', company: 'bialowie', name: 'Bialowieza Panele — Hajnowka Mill',
    city: 'Hajnowka', country: 'Poland', started: 1990, scale: 'medium',
    cap: 0.79, products: ['Other', 'HB'], trend: 1.05, dirt: 1.47, joined: 2021,
    skips: [2022] },
  { key: 'p13', company: 'bialowie', name: 'Bialowieza Panele — Ostroleka Plant',
    city: 'Ostroleka', country: 'Poland', started: 2011, scale: 'large',
    cap: 1.04, products: ['PB', 'OSB'], trend: 0.94, dirt: 0.81, joined: 2023 },

  /* ── Italie : 5 sites, 2 societes ─────────────────────────────── */
  { key: 'p14', company: 'silvater', name: 'Silvaterra Pannelli — Udine Works',
    city: 'Udine', country: 'Italy', started: 1995, scale: 'medium',
    cap: 1.07, products: ['MDF', 'HDF'], trend: 0.98, dirt: 1.05, joined: 2021 },
  { key: 'p15', company: 'silvater', name: 'Silvaterra Pannelli — Viterbo Works',
    city: 'Viterbo', country: 'Italy', started: 2011, scale: 'small',
    cap: 0.88, products: ['HB'], trend: 0.93, dirt: 0.70, joined: 2021 },
  { key: 'p16', company: 'silvater', name: 'Silvaterra Pannelli — Cuneo Plant',
    city: 'Cuneo', country: 'Italy', started: 1981, scale: 'large',
    cap: 1.19, products: ['PB', 'Other'], trend: 1.01, dirt: 1.24, joined: 2022 },
  { key: 'p17', company: 'padania', name: 'Padania Legno — Mantova Mill',
    city: 'Mantova', country: 'Italy', started: 1969, scale: 'medium',
    cap: 0.83, products: ['SB', 'HB'], trend: 1.06, dirt: 1.58, joined: 2021 },
  { key: 'p18', company: 'padania', name: 'Padania Legno — Pordenone Plant',
    city: 'Pordenone', country: 'Italy', started: 2005, scale: 'medium',
    cap: 1.11, products: ['MDF'], trend: 0.95, dirt: 0.86, joined: 2023 },

  /* ── France : 4 sites, 2 societes ─────────────────────────────── */
  { key: 'p19', company: 'boisred', name: 'Bois du Redon — Limoges Works',
    city: 'Limoges', country: 'France', started: 1981, scale: 'large',
    cap: 1.13, products: ['PB', 'Other'], trend: 1.01, dirt: 1.18, joined: 2021 },
  { key: 'p20', company: 'boisred', name: 'Bois du Redon — Bordeaux Plant',
    city: 'Bordeaux', country: 'France', started: 2015, scale: 'medium',
    cap: 0.97, products: ['MDF', 'HDF'], trend: 0.91, dirt: 0.58, joined: 2022 },
  { key: 'p21', company: 'vosgesp', name: 'Vosges Panneaux — Epinal Mill',
    city: 'Epinal', country: 'France', started: 1988, scale: 'medium',
    cap: 1.06, products: ['PB'], trend: 0.99, dirt: 1.09, joined: 2021 },
  { key: 'p22', company: 'vosgesp', name: 'Vosges Panneaux — Saint-Die Plant',
    city: 'Saint-Die-des-Vosges', country: 'France', started: 2003, scale: 'small',
    cap: 0.74, products: ['HB'], trend: 1.04, dirt: 1.36, joined: 2023,
    skips: [2024] },

  /* ── Espagne : 4 sites, 2 societes ────────────────────────────── */
  { key: 'p23', company: 'verdalia', name: 'Verdalia Tableros — Soria Plant',
    city: 'Soria', country: 'Spain', started: 1978, scale: 'large',
    cap: 1.28, products: ['PB', 'OSB'], trend: 1.02, dirt: 1.25, joined: 2021 },
  { key: 'p24', company: 'verdalia', name: 'Verdalia Tableros — Huelva Works',
    city: 'Huelva', country: 'Spain', started: 1999, scale: 'medium',
    cap: 0.92, products: ['MDF'], trend: 0.97, dirt: 0.94, joined: 2021 },
  { key: 'p25', company: 'verdalia', name: 'Verdalia Tableros — Lugo Plant',
    city: 'Lugo', country: 'Spain', started: 2014, scale: 'small',
    cap: 1.09, products: ['Other'], trend: 0.90, dirt: 0.62, joined: 2025 },
  { key: 'p26', company: 'ibertab', name: 'Ibertablero — Valencia Mill',
    city: 'Valencia', country: 'Spain', started: 1992, scale: 'large',
    cap: 0.99, products: ['PB', 'MDF', 'HDF'], trend: 0.96, dirt: 1.01, joined: 2022 },

  /* ── Roumanie : 3 sites ───────────────────────────────────────── */
  { key: 'p27', company: 'carpatpl', name: 'Carpatica Placaje — Brasov Works',
    city: 'Brasov', country: 'Romania', started: 1968, scale: 'large',
    cap: 1.17, products: ['Other', 'PB'], trend: 1.06, dirt: 1.62, joined: 2021 },
  { key: 'p28', company: 'carpatpl', name: 'Carpatica Placaje — Sibiu Plant',
    city: 'Sibiu', country: 'Romania', started: 2006, scale: 'small',
    cap: 0.81, products: ['MDF'], trend: 1.02, dirt: 1.22, joined: 2022 },
  { key: 'p29', company: 'carpatpl', name: 'Carpatica Placaje — Suceava Mill',
    city: 'Suceava', country: 'Romania', started: 1998, scale: 'medium',
    cap: 1.02, products: ['PB', 'SB'], trend: 1.03, dirt: 1.41, joined: 2024 },

  /* ── Turquie : 3 sites ────────────────────────────────────────── */
  { key: 'p30', company: 'anatolia', name: 'Anatolia Panel — Kastamonu Works',
    city: 'Kastamonu', country: 'Turkey', started: 1994, scale: 'large',
    cap: 1.46, products: ['PB', 'MDF'], trend: 1.04, dirt: 1.29, joined: 2021 },
  { key: 'p31', company: 'anatolia', name: 'Anatolia Panel — Adana Plant',
    city: 'Adana', country: 'Turkey', started: 2009, scale: 'large',
    cap: 1.31, products: ['MDF', 'HDF'], trend: 0.98, dirt: 1.07, joined: 2022 },
  { key: 'p32', company: 'anatolia', name: 'Anatolia Panel — Balikesir Mill',
    city: 'Balikesir', country: 'Turkey', started: 2017, scale: 'medium',
    cap: 1.14, products: ['OSB'], trend: 0.92, dirt: 0.73, joined: 2023 },

  /* ── Deux sites chacun ────────────────────────────────────────── */
  { key: 'p33', company: 'alpenpl', name: 'Alpenplatten Werke — Kufstein Mill',
    city: 'Kufstein', country: 'Austria', started: 1992, scale: 'large',
    cap: 1.05, products: ['PB', 'MDF'], trend: 0.93, dirt: 0.72, joined: 2021 },
  { key: 'p34', company: 'alpenpl', name: 'Alpenplatten Werke — Villach Plant',
    city: 'Villach', country: 'Austria', started: 2009, scale: 'medium',
    cap: 0.89, products: ['OSB'], trend: 0.95, dirt: 0.64, joined: 2023 },
  { key: 'p35', company: 'ardenne', name: 'Ardenne Panneaux — Marche-en-Famenne',
    city: 'Marche-en-Famenne', country: 'Belgium', started: 1991, scale: 'medium',
    cap: 1.01, products: ['PB'], trend: 0.99, dirt: 0.95, joined: 2021 },
  { key: 'p36', company: 'ardenne', name: 'Ardenne Panneaux — Genk Plant',
    city: 'Genk', country: 'Belgium', started: 2012, scale: 'small',
    cap: 0.93, products: ['MDF'], trend: 0.94, dirt: 0.77, joined: 2024 },
  { key: 'p37', company: 'moravia', name: 'Moravia Desky — Bruntal Works',
    city: 'Bruntal', country: 'Czech Republic', started: 1965, scale: 'large',
    cap: 1.24, products: ['PB', 'OSB'], trend: 1.04, dirt: 1.35, joined: 2021 },
  { key: 'p38', company: 'moravia', name: 'Moravia Desky — Jihlava Plant',
    city: 'Jihlava', country: 'Czech Republic', started: 2002, scale: 'medium',
    cap: 0.87, products: ['MDF', 'HB'], trend: 0.98, dirt: 1.00, joined: 2022,
    skips: [2025] },
  { key: 'p39', company: 'douro', name: 'Douro Compositos — Oliveira Plant',
    city: 'Oliveira de Azemeis', country: 'Portugal', started: 2001, scale: 'small',
    cap: 1.12, products: ['MDF'], trend: 1.01, dirt: 1.10, joined: 2021 },
  { key: 'p40', company: 'douro', name: 'Douro Compositos — Viseu Mill',
    city: 'Viseu', country: 'Portugal', started: 1986, scale: 'medium',
    cap: 0.96, products: ['PB', 'Other'], trend: 1.00, dirt: 1.21, joined: 2023 },
  { key: 'p41', company: 'norrskog', name: 'Norrskog Skivindustri — Umea Mill',
    city: 'Umea', country: 'Sweden', started: 1973, scale: 'medium',
    cap: 0.84, products: ['HB', 'MBH'], trend: 0.92, dirt: 0.68, joined: 2021 },
  { key: 'p42', company: 'norrskog', name: 'Norrskog Skivindustri — Vaxjo Plant',
    city: 'Vaxjo', country: 'Sweden', started: 2006, scale: 'large',
    cap: 1.10, products: ['PB', 'MDF'], trend: 0.90, dirt: 0.59, joined: 2022 },
  { key: 'p43', company: 'metsalev', name: 'Metsalevy — Lahti Mill',
    city: 'Lahti', country: 'Finland', started: 1974, scale: 'large',
    cap: 1.20, products: ['Other', 'PB'], trend: 0.96, dirt: 0.83, joined: 2021 },
  { key: 'p44', company: 'metsalev', name: 'Metsalevy — Kuopio Mill',
    city: 'Kuopio', country: 'Finland', started: 2003, scale: 'medium',
    cap: 0.90, products: ['SB', 'HB'], trend: 0.94, dirt: 0.76, joined: 2021,
    skips: [2023] },
  { key: 'p45', company: 'pennineb', name: 'Pennine Boards — Leeds Works',
    city: 'Leeds', country: 'United Kingdom', started: 1990, scale: 'large',
    cap: 1.07, products: ['PB', 'MDF', 'HDF'], trend: 0.97, dirt: 0.99, joined: 2021 },
  { key: 'p46', company: 'pennineb', name: 'Pennine Boards — Ayrshire Plant',
    city: 'Ayr', country: 'United Kingdom', started: 2012, scale: 'medium',
    cap: 0.95, products: ['OSB'], trend: 0.92, dirt: 0.66, joined: 2022 },

  /* ── Un site chacun ───────────────────────────────────────────── */
  { key: 'p47', company: 'nordhavn', name: 'Nordhavn Panelworks — Aalborg Mill',
    city: 'Aalborg', country: 'Denmark', started: 1987, scale: 'large',
    cap: 1.00, products: ['PB', 'MDF'], trend: 0.94, dirt: 1.00, joined: 2021 },
  { key: 'p48', company: 'baltfib', name: 'Baltic Fibreboard — Jelgava Mill',
    city: 'Jelgava', country: 'Latvia', started: 1969, scale: 'medium',
    cap: 0.82, products: ['SB', 'HB'], trend: 1.05, dirt: 1.40, joined: 2021 },
  { key: 'p49', company: 'nemunas', name: 'Nemunas Plokstes — Kaunas Mill',
    city: 'Kaunas', country: 'Lithuania', started: 1994, scale: 'medium',
    cap: 1.04, products: ['PB', 'Other'], trend: 1.03, dirt: 1.28, joined: 2022 },
  { key: 'p50', company: 'peipsi', name: 'Peipsi Plaaditehas — Tartu Works',
    city: 'Tartu', country: 'Estonia', started: 2010, scale: 'small',
    cap: 1.15, products: ['Other'], trend: 0.93, dirt: 0.69, joined: 2023 },
  { key: 'p51', company: 'pannonlap', name: 'Pannonia Lapgyar — Szombathely Plant',
    city: 'Szombathely', country: 'Hungary', started: 2000, scale: 'medium',
    cap: 0.98, products: ['MDF'], trend: 0.97, dirt: 0.92, joined: 2021 },
  { key: 'p52', company: 'tatradosk', name: 'Tatra Dosky — Zilina Works',
    city: 'Zilina', country: 'Slovakia', started: 1988, scale: 'medium',
    cap: 1.03, products: ['PB', 'MDF'], trend: 0.99, dirt: 1.08, joined: 2022 },
  { key: 'p53', company: 'triglav', name: 'Triglav Plosce — Maribor Plant',
    city: 'Maribor', country: 'Slovenia', started: 1999, scale: 'small',
    cap: 0.76, products: ['MDF'], trend: 0.95, dirt: 0.81, joined: 2024 },
  { key: 'p54', company: 'slavonp', name: 'Slavonija Ploce — Osijek Works',
    city: 'Osijek', country: 'Croatia', started: 1971, scale: 'medium',
    cap: 0.88, products: ['Other', 'HB'], trend: 1.04, dirt: 1.38, joined: 2021,
    skips: [2024] },
  { key: 'p55', company: 'rodopip', name: 'Rodopi Panels — Smolyan Mill',
    city: 'Smolyan', country: 'Bulgaria', started: 1979, scale: 'medium',
    cap: 0.85, products: ['PB', 'HB'], trend: 1.07, dirt: 1.71, joined: 2023 },
  { key: 'p56', company: 'pindosp', name: 'Pindos Panel — Larissa Plant',
    city: 'Larissa', country: 'Greece', started: 1976, scale: 'small',
    cap: 0.71, products: ['PB'], trend: 1.05, dirt: 1.54, joined: 2022 },
  { key: 'p57', company: 'shannon', name: 'Shannon Board Products — Limerick Mill',
    city: 'Limerick', country: 'Ireland', started: 1986, scale: 'medium',
    cap: 0.94, products: ['MDF', 'PB'], trend: 0.96, dirt: 0.87, joined: 2021 },
  { key: 'p58', company: 'delftpan', name: 'Delft Paneelfabriek — Moerdijk Plant',
    city: 'Moerdijk', country: 'Netherlands', started: 1997, scale: 'medium',
    cap: 1.09, products: ['PB'], trend: 0.98, dirt: 1.45, joined: 2021 },
  { key: 'p59', company: 'fjordsk', name: 'Fjordskiva — Trondheim Mill',
    city: 'Trondheim', country: 'Norway', started: 1983, scale: 'medium',
    cap: 0.91, products: ['SB', 'MBH'], trend: 0.90, dirt: 0.61, joined: 2025 },
];

/* ── Campagnes de collecte ──────────────────────────────────────────
   Quatre campagnes closes et une ouverte. `status` est contraint par
   002_relational_schema.sql :
     CHECK (status IN ('draft','open','closed','archived'))
   Cinq annees de reference donnent au tableau de bord un axe temporel sur
   lequel une tendance est lisible sur plus de deux points — trois points ne
   distinguent pas une tendance d'un accident. */
export const CYCLES = [
  { key: 'c2021', label: '2021 data collection (H1 2023)', reference_year: 2021,
    opens_at: '2023-01-16', closes_at: '2023-06-23', status: 'closed',
    subWindow: ['2023-02-27', '2023-06-20'] },
  { key: 'c2022', label: '2022 data collection (H1 2024)', reference_year: 2022,
    opens_at: '2024-01-15', closes_at: '2024-06-21', status: 'closed',
    subWindow: ['2024-03-01', '2024-06-18'] },
  { key: 'c2023', label: '2023 data collection (H1 2025)', reference_year: 2023,
    opens_at: '2025-01-20', closes_at: '2025-06-30', status: 'closed',
    subWindow: ['2025-03-04', '2025-06-27'] },
  { key: 'c2024', label: '2024 data collection (H2 2025)', reference_year: 2024,
    opens_at: '2025-09-01', closes_at: '2025-12-19', status: 'closed',
    subWindow: ['2025-10-06', '2025-12-17'] },
  { key: 'c2025', label: '2025 data collection (H2 2026)', reference_year: 2025,
    opens_at: '2026-09-01', closes_at: '2026-12-18', status: 'open',
    subWindow: ['2026-09-02', '2026-09-10'] },
];

// L'indice de campagne est l'annee de reference moins 2023, et non le rang
// dans le tableau : `trend` est ancre sur 2023, de sorte qu'un site qui
// s'ameliore (trend < 1) emettait davantage en 2021 et moins en 2025.
export function cycleIndexOf(cycle) {
  return cycle.reference_year - 2023;
}

// Sites qui laissent leur soumission de la campagne ouverte (2025) a l'etat
// de brouillon : la demonstration a besoin d'un taux de completion < 100 %
// pour que le graphe d'avancement dise quelque chose. La liste melange
// deliberement des sites de toutes tailles et de plusieurs pays — si les
// brouillons etaient tous de petits sites d'Europe de l'Est, le tableau de
// bord raconterait une histoire que le jeu de donnees n'a pas voulu ecrire.
export const OPEN_CYCLE_DRAFTS = [
  'p03', 'p07', 'p11', 'p15', 'p18', 'p22', 'p25',
  'p29', 'p34', 'p44', 'p50', 'p56', 'p58',
];

/* ── Anomalies deliberees ───────────────────────────────────────────
   Cinq valeurs (site, polluant, campagne) posees 3 a 6 fois au-dessus de la
   plage sectorielle, pour que la fonction « identification des valeurs
   aberrantes » du tableau de bord ait quelque chose de reel a trouver.
   Elles sont reparties sur plusieurs annees de reference : une detection qui
   ne trouverait ses anomalies que dans une seule campagne ne prouverait rien
   sur sa capacite a en trouver ailleurs.
   La colonne emission_point_pollutants.method est tiree comme pour n'importe
   quelle autre mesure : rien en base ne signale ces lignes, il faut les
   detecter statistiquement. */
export const OUTLIERS = [
  { plant: 'p48', cycle: 'c2024', point: 1, code: 'hcho', value: 48.6,
    note: 'formaldehyde ~5x la plage sectorielle (2-12 mg/Nm3)' },
  { plant: 'p37', cycle: 'c2023', point: 3, code: 'pm', value: 62.4,
    note: 'poussieres ~4x la plage sectorielle (3-18 mg/Nm3)' },
  { plant: 'p23', cycle: 'c2025', point: 1, code: 'nox', value: 781,
    note: 'NOx ~3.5x la plage sectorielle (60-250 mg/Nm3)' },
  { plant: 'p17', cycle: 'c2021', point: 2, code: 'toc', value: 214,
    note: 'COT ~3.5x la plage sectorielle (8-60 mg/Nm3)' },
  { plant: 'p30', cycle: 'c2022', point: 1, code: 'so2', value: 187,
    note: 'SO2 ~4.5x la plage sectorielle (5-40 mg/Nm3)' },
];

/* ── Plages sectorielles par polluant (mg/Nm3 sauf mention) ────────
   [min, max, decimales, limite de permis typique]. Les valeurs sont des
   ordres de grandeur representatifs du secteur des panneaux a base de bois,
   pas des mesures reelles. */
const POLLUTANT_RANGES = {
  pm:           [3, 18, 1, 20],
  so2:          [5, 40, 1, 50],
  nox:          [60, 250, 0, 300],
  co:           [30, 250, 0, 300],
  nh3:          [1, 8, 2, 15],
  hcho:         [2, 12, 2, 15],
  nmvoc:        [5, 35, 1, 50],
  toc:          [8, 60, 1, 100],
  voc:          [10, 50, 1, 100],
  cvoc:         [0.2, 3, 2, 5],
  terpene:      [3, 25, 1, null],
  formic:       [0.5, 5, 2, null],
  acetic:       [1, 8, 2, null],
  propionic:    [0.2, 2, 2, null],
  acetaldehyde: [0.5, 6, 2, null],
  phenol:       [0.2, 3, 2, 5],
  pmdi:         [0.05, 0.6, 3, 1],
  hcl:          [1, 12, 1, 30],
  hf:           [0.1, 2, 2, 5],
  cd:           [0.001, 0.05, 4, 0.05],
  hg:           [0.001, 0.03, 4, 0.05],
  pb:           [0.01, 0.4, 3, 0.5],
  ni:           [0.005, 0.15, 4, 0.5],
  methanol:     [1, 10, 2, null],
  odour:        [200, 3000, 0, null],      // ouE/m3
  pcdd:         [0.005, 0.08, 4, 0.1],     // ng I-TEQ/Nm3
};

// Quelles cheminees existent, et quels polluants y sont suivis.
// 5 a 10 polluants par point d'emission, choisis pour etre coherents avec
// le procede : les metaux lourds et les dioxines n'ont de sens que sur une
// cheminee alimentee par de la combustion de bois recycle.
const POINT_PROFILES = {
  dryer: {
    label: 'Dryer stack (dryer exhaust + boiler flue gas)',
    polls: ['pm', 'so2', 'nox', 'co', 'hcho', 'nmvoc', 'toc', 'terpene', 'acetic', 'methanol'],
  },
  dryerRec: {
    label: 'Dryer stack (recycled-wood fired, with abatement)',
    polls: ['pm', 'so2', 'nox', 'co', 'hcho', 'toc', 'hcl', 'cd', 'hg', 'pcdd'],
  },
  press: {
    label: 'Press exhaust stack (hot press + cooling)',
    polls: ['pm', 'hcho', 'nmvoc', 'toc', 'voc', 'phenol', 'acetaldehyde', 'odour'],
  },
  dust: {
    label: 'Sanding and cut-to-size dust filter stack',
    polls: ['pm', 'toc', 'hcho', 'voc', 'nmvoc'],
  },
};

const SCALE = {
  small:  { prod: 55000,  cus: 2, mw: [4, 9],   flow: 90000,  eps: 1 },
  medium: { prod: 145000, cus: 3, mw: [8, 22],  flow: 180000, eps: 2 },
  large:  { prod: 310000, cus: 4, mw: [16, 42], flow: 320000, eps: 3 },
};

// Reprend a l'identique WBP_TYPES de docs/pages-0-6.js : une valeur absente
// de cette liste serait ecrite en base sans que le formulaire sache la
// reafficher, la liste deroulante retombant sur « — select type — ».
//
// 'Other' vaut ici contreplaque. Le questionnaire n'offre pas d'option
// contreplaque, alors que l'EPF compte ce panneau parmi les six qu'elle
// represente : c'est un manque du formulaire, pas du jeu de donnees, et il
// est signale comme tel plutot que contourne par une valeur inventee.
const WBP_LABEL = {
  OSB: 'OSB Oriented Strand Board', PB: 'PB Particle board',
  MDF: 'MDF (dry process)', HDF: 'HDF (dry process)',
  SB: 'SB Softboard', HB: 'HB Hardboard',
  MBH: 'MBH high density medium board',
  Other: 'Plywood (declared under “Other”)',
};

const CONTACT_FIRST = ['Anneke', 'Bartosz', 'Cristina', 'Dagmar', 'Emil', 'Frida',
  'Gustav', 'Helena', 'Ivo', 'Joana', 'Katrin', 'Lukas', 'Marta', 'Niels'];
const CONTACT_LAST = ['Brandt', 'Kowalczyk', 'Serrano', 'Novakova', 'Lindqvist',
  'Haugen', 'Weber', 'Moretti', 'Ozols', 'Almeida', 'Vermeulen', 'Dubois',
  'Rasmussen', 'Kallas'];

/* ══ Construction d'une soumission ═══════════════════════════════════ */

// Derive la valeur d'un polluant pour un (site, campagne, point) donne.
// Trois effets se composent : la salete relative du site (`dirt`), sa derive
// d'une campagne a l'autre (`trend` eleve a l'indice de campagne) et un
// bruit de mesure. Sans le bruit, un graphe de tendance montrerait des
// droites parfaites, ce qui ne ressemble a aucune donnee d'emission reelle.
function pollutantValue(plant, cycleIdx, code) {
  const [min, max, dec] = POLLUTANT_RANGES[code];
  const base = min + (max - min) * (0.3 + 0.4 * rnd());
  const v = base * plant.dirt * Math.pow(plant.trend, cycleIdx) * (0.88 + 0.24 * rnd());
  const f = Math.pow(10, dec);
  return Math.max(min * 0.4, Math.round(v * f) / f);
}

function permitLimit(code) {
  const lim = POLLUTANT_RANGES[code][3];
  if (lim === null) return null;
  // Une limite de permis s'ecrit rarement comme un nombre nu : la colonne
  // est du texte precisement pour cela (voir le manifeste, page 7).
  const r = rnd();
  if (r < 0.82) return String(lim);
  if (r < 0.92) return '<= ' + lim;
  return lim + ' (daily average)';
}

function emissionPoints(plant) {
  const n = SCALE[plant.scale].eps;
  const usesRecycled = plant.dirt >= 1.2;
  const out = [{ profile: usesRecycled ? 'dryerRec' : 'dryer' }];
  if (n >= 2) out.push({ profile: 'press' });
  if (n >= 3) out.push({ profile: 'dust' });
  return out;
}

function contactFor(plant, i) {
  const first = CONTACT_FIRST[i % CONTACT_FIRST.length];
  const last = CONTACT_LAST[(i * 5 + 3) % CONTACT_LAST.length];
  return {
    name: first + ' ' + last,
    email: (first + '.' + last).toLowerCase() + '@' + plant.key + '.invalid',
    phone: '+00 000 00 ' + String(1000 + i * 7).slice(0, 4),
  };
}

// Pages a remplir selon l'etat. Un brouillon en cours ne porte que le debut
// du questionnaire : c'est a quoi ressemble une saisie interrompue, et c'est
// ce que le graphe d'avancement doit pouvoir montrer.
const FULL_PAGES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const DRAFT_PAGES = [0, 1, 3];

/* Construit toutes les cartes plates d'une soumission.
   Retourne { pageId: flat }. */
export function buildFlatPages(ctx) {
  const { plant, company, cycle, cycleIdx, status, seq } = ctx;
  const sc = SCALE[plant.scale];
  const year = cycle.reference_year;
  const contact = contactFor(plant, seq);
  const pages = {};
  const wanted = status === 'submitted' ? FULL_PAGES : DRAFT_PAGES;
  const has = p => wanted.includes(p);

  // Volume de production de la campagne : croissance douce d'une annee sur
  // l'autre, differente par site. `cap` etale la capacite a l'interieur du
  // palier — sans lui, tous les grands sites produiraient a 8 % pres la meme
  // chose, et un classement par tonnage serait une egalite generale.
  const prodTotal = Math.round(sc.prod * (plant.cap || 1) * (0.92 + 0.16 * rnd()) *
                               Math.pow(1.025 + (plant.dirt - 1) * 0.01, cycleIdx));

  /* ── page 0 — couverture et contacts ───────────────────────────── */
  if (has(0)) {
    const f = pages[0] = {};
    setOne(f, 'contacts', {
      contact_company: company.name,
      contact_name: contact.name,
      contact_job_title: pick(['Environmental Manager', 'HSE Coordinator',
        'Technical Director', 'Plant Environmental Officer', 'Process Engineer']),
      contact_email: contact.email,
      contact_telephone: contact.phone,
      contact_comments: 'Synthetic demonstration record — EPF TWG, September 2026. ' +
        'Not operator data.',
      twg_ms_state: plant.country,
      twg_ms_organisation: plant.country + ' Environment Agency (demo)',
      twg_ms_name: 'Demo MS Representative',
      twg_ms_job_title: 'BREF Correspondent',
      twg_ms_email: 'ms.contact@' + plant.key + '.invalid',
      twg_ms_telephone: contact.phone,
    });
  }

  /* ── page 1 — informations generales ───────────────────────────── */
  if (has(1)) {
    const f = pages[1] = {};
    setOne(f, 'general_info', {
      plant_name: plant.name,
      production_started: plant.started,
      location_city: plant.city,
      location_country: plant.country,
      company: company.name,
      ref_year: year,
      comments: 'Reference year ' + year + '. Figures are annual site totals.',
    });

    // 1 a 3 lignes de produits, coherentes avec le profil du site.
    const shares = plant.products.length === 1 ? [1]
                 : plant.products.length === 2 ? [0.62, 0.38]
                 : [0.48, 0.32, 0.20];
    plant.products.forEach((t, i) => {
      const qty = Math.round(prodTotal * shares[i] / 100) * 100;
      setMany(f, 'plant_products', i + 1, {
        type: t,
        addinfo: WBP_LABEL[t] + ', ' + pick(['raw', 'sanded', 'melamine-faced',
          'moisture-resistant']) + ' grades',
        qty,
        unit: 'm³ of product produced / year',
        daily: Math.round(qty / 340),
      });
    });

    // 1.7 — autres activites du site.
    setKeyed(f, 'site_activities', 'combustion', {
      present: 'y', ippc: 'y',
      capacity: Math.round(sc.mw[0] + (sc.mw[1] - sc.mw[0]) * 0.75),
    });
    if (plant.dirt >= 1.2) {
      setKeyed(f, 'site_activities', 'incineration', {
        present: 'y', ippc: 'y', capacity: num(3, 12, 1),
      });
    }
    setKeyed(f, 'site_activities', 'ww_treatment', {
      present: plant.products.includes('SB') || plant.products.includes('HB') ? 'y' : 'n',
      ippc: 'n', capacity: num(8000, 60000, 0),
    });
    setKeyed(f, 'site_activities', 'sawmill', {
      present: plant.scale === 'large' ? 'y' : 'n', ippc: 'n',
      capacity: plant.scale === 'large' ? num(20000, 70000, 0) : null,
    });
    setKeyed(f, 'site_activities', 'paper_lam', {
      present: plant.products.includes('PB') || plant.products.includes('MDF') ? 'y' : 'n',
      ippc: 'n', capacity: num(1.5e6, 9e6, 0),
    });
    setKeyed(f, 'site_activities', 'landfill', { present: 'n', ippc: 'n' });
    setKeyed(f, 'site_activities', 'other_activities', {
      present: 'y', ippc: 'n', capacity: num(500, 4000, 0),
    });
    setKeyed(f, 'site_activity_units', 'other_activities', { unit: 'tonnes/year' });
    setKeyed(f, 'site_activities', 'other_specify', {
      present: 'y', ippc: 'n', capacity: num(100, 900, 0),
    });
    setKeyed(f, 'site_activity_units', 'other_specify', { unit: 'tonnes/year' });
    setOne(f, 'site_activity_other_specify', {
      act_other_specify_label: pick(['On-site pellet pressing from sander dust',
        'Edge-banding and profiling line', 'Board impregnation line',
        'Fuel preparation for the biomass boiler']),
    });
  }

  /* ── page 2 — implantation, stockage, preparation du bois ──────── */
  if (has(2)) {
    const f = pages[2] = {};
    const outdoorPct = int(45, 80);
    const indoorPct = int(10, 100 - outdoorPct - 5);
    setKeyed(f, 'raw_material_storage', 'outdoor', {
      pct: outdoorPct, cap: Math.round(prodTotal * 0.08),
      area: Math.round(prodTotal * 0.05),
    });
    setKeyed(f, 'raw_material_storage', 'indoor', {
      pct: indoorPct, cap: Math.round(prodTotal * 0.02),
      area: Math.round(prodTotal * 0.012),
    });
    setKeyed(f, 'raw_material_storage', 'silos', {
      pct: 100 - outdoorPct - indoorPct, cap: Math.round(prodTotal * 0.004),
      area: num(400, 2500, 0),
    });

    for (const stage of ['debark', 'chip']) {
      setKeyed(f, 'wood_prep_operations', stage, {
        process_desc: stage === 'debark'
          ? 'Rotary drum debarker, enclosed, feeding the chipping line'
          : 'Disc chipper + rechipper, pneumatic conveying to green chip silo',
        prod_t_batch: String(num(8, 45, 1)),
        wood_dry: String(num(5, 30, 1)),
        airflow: String(int(12, 48) * 1000),
        chan_air: String(int(10, 40) * 1000),
        chan_treated: 'y',
        emit_limit: 'y',
        dust_method: pick(['Bag filter, 2 mg/Nm³ guarantee',
          'Cyclone + bag filter in series', 'Cartridge filter unit',
          'Cyclone separator only']),
        monitoring: pick(['Annual periodic measurement + differential pressure alarm',
          'Continuous opacity monitor on the filter outlet',
          'Quarterly periodic measurement by accredited lab']),
      });
    }
    setKeyed(f, 'wood_prep_param_comments', 'airflow',
      { comments: 'Airflow measured at design capacity, not annual average.' });
    setKeyed(f, 'wood_prep_param_comments', 'dust_method',
      { comments: 'Filter media replaced on a ' + int(18, 42) + '-month cycle.' });

    const usesRecycled = plant.dirt >= 1.2;
    setOne(f, 'plant_layout_section', {
      ref_year: year,
      s21_comments: 'Raw material yard split between an open log yard and a covered ' +
        'chip store; prevailing wind sampled at the north boundary.',
      s22_comments: 'Debarking and chipping share a common dust extraction header.',
      s23_present: usesRecycled ? 'y' : 'n',
      s23_hours: usesRecycled ? int(3500, 7200) : null,
      s23_capacity: usesRecycled ? num(12, 60, 1) : null,
      s23_chan_air: usesRecycled ? int(15, 55) * 1000 : null,
      s23_chan_treated: usesRecycled ? 'y' : null,
      s23_emit_limit: usesRecycled ? 'y' : null,
      s23_dust_method: usesRecycled ? 'Bag filter with ferrous and non-ferrous separation upstream' : null,
      s23_monitoring: usesRecycled ? 'Continuous differential pressure + annual periodic dust measurement' : null,
      s23_comments: usesRecycled ? 'Recycled wood is screened and de-metalled before grinding.' : null,
      s24_desc: 'Sanding line dust extraction (belt sander + calibrating sander)',
      s24_chan_air: int(40, 130) * 1000,
      s24_chan_treated: 'y',
      s24_dust_method: 'Bag filter, dust returned to the fuel silo',
      s24_comments: 'Collected sander dust is burned in the biomass boiler.',
      s25_desc: 'Cut-to-size and edge trimming extraction',
      s25_chan_air: int(15, 60) * 1000,
      s25_chan_treated: 'y',
      s25_dust_method: 'Cyclone + bag filter',
      s25_comments: 'Vented to the same filter house as 2.4.',
    });
  }

  /* ── page 3 — matieres premieres, resines, additifs ────────────── */
  if (has(3)) {
    const f = pages[3] = {};
    setOne(f, 'raw_materials_section', {
      ref_year: year,
      s32_comments: 'Resin dosage expressed as solid resin on oven-dry wood.',
    });

    const usesRecycled = plant.dirt >= 1.2;
    // Les parts totalisent 100 %.
    let mix;
    if (usesRecycled) {
      mix = { roundwood: 22, vir_forest: 14, sawdust: 18, ext_prod_res: 11, ext_recycled: 35 };
    } else if (plant.products.includes('OSB')) {
      mix = { roundwood: 74, vir_forest: 18, sawdust: 8 };
    } else {
      mix = { roundwood: 38, vir_forest: 21, sawdust: 24, ext_prod_res: 12, ext_recycled: 5 };
    }
    const species = pick(['Spruce, pine', 'Pine, spruce, birch',
      'Pine (Pinus pinaster), eucalyptus', 'Spruce, fir, beech',
      'Poplar, pine', 'Birch, aspen, spruce']);
    for (const [code, pct] of Object.entries(mix)) {
      setKeyed(f, 'raw_materials', code, {
        pct,
        species: code === 'ext_recycled'
          ? 'Mixed post-consumer wood, A1/A2 grade'
          : species,
        source: code === 'ext_recycled'
          ? 'Licensed waste wood collectors, ' + int(60, 260) + ' km radius'
          : pick(['Own forestry contracts, < 150 km',
            'Regional sawmills, < 200 km', 'Certified suppliers (FSC/PEFC mix)']),
      });
    }

    const resinSet = plant.products.includes('OSB')
      ? [{ type: 'pMDI', pct: num(3.2, 5.4, 2) }, { type: 'MUF', pct: num(1.5, 3.0, 2) }]
      : plant.products.includes('MDF') || plant.products.includes('HDF')
        ? [{ type: 'UF', pct: num(8.5, 12.5, 2) }, { type: 'MUF', pct: num(1.8, 4.2, 2) }]
        : [{ type: 'UF', pct: num(7.0, 10.5, 2) }, { type: 'MF', pct: num(0.8, 2.4, 2) }];
    resinSet.forEach((r, i) => setMany(f, 'resins', i + 1, {
      type: r.type, pct: r.pct,
      comments: 'Solid resin on oven-dry fibre; ' +
        (i === 0 ? 'core layer' : 'surface layer') + '.',
    }));

    setMany(f, 'hardeners', 1, {
      type: pick(['Ammonium sulphate solution 40 %', 'Ammonium nitrate solution',
        'Ammonium sulphate + urea scavenger']),
      comments: 'Dosed in line at the blender.',
    });
    setMany(f, 'hardeners', 2, {
      type: 'Urea solution (formaldehyde scavenger)',
      comments: 'Added to meet E1/E05 emission class.',
    });

    setKeyed(f, 'additives', 'wax', {
      type: 'Paraffin wax emulsion, ' + num(0.4, 1.4, 2) + ' % on dry fibre',
      comments: 'Water repellency.',
    });
    setKeyed(f, 'additives', 'other_add', {
      type: pick(['Ammonium polyphosphate flame retardant',
        'Boron-based preservative', 'Colour pigment (MR grade marking)']),
      comments: 'Speciality grades only, < ' + num(4, 12, 0) + ' % of output.',
    });
  }

  /* ── page 4 — production d'energie ─────────────────────────────── */
  if (has(4)) {
    const f = pages[4] = {};
    const nCu = sc.cus;
    setCount(f, 'combustion_units', nCu);
    const usesRecycled = plant.dirt >= 1.2;

    for (let i = 1; i <= nCu; i++) {
      const isMain = i === 1;
      const mw = isMain ? num(sc.mw[1] * 0.7, sc.mw[1], 1) : num(sc.mw[0], sc.mw[1] * 0.6, 1);
      const equip = isMain ? 'boiler' : pick(['boiler', 'boiler', 'turbine', 'other']);
      setMany(f, 'combustion_units', i, {
        general_process: isMain
          ? 'Biomass boiler — hot gas to the dryer and saturated steam to the press'
          : pick(['Steam generation for the press and building heating',
            'Direct-fired hot gas generator for the dryer',
            'Back-up natural gas boiler, steam only',
            'Thermal oil heater for the press platens']),
        equip_type: equip,
        boiler_detail: equip === 'boiler'
          ? pick(['nat', 'forc', 'fbb', 'fbc']) : '',
        engine_ignition: '',
        chp: isMain && plant.scale === 'large' ? 'y' : 'n',
        suppl_fire: isMain ? 'y' : 'n',
        dual_fuel: i === nCu ? 'y' : 'n',
        install_year: int(Math.max(plant.started, 1990), 2022),
        thermal_input: mw,
        energy_output: Math.round(mw * (0.72 + 0.14 * rnd()) * 10) / 10,
        hours_normal: isMain ? int(7400, 8300) : int(1800, 6400),
        hours_special: int(60, 420),
        output_1: Math.round(mw * 0.45 * 10) / 10,
        output_2: Math.round(mw * 0.24 * 10) / 10,
        output_3: isMain ? Math.round(mw * 0.11 * 10) / 10 : null,
      });

      // Melange de combustibles : les parts totalisent 100 % par unite.
      let fuelMix;
      if (i === 1 && usesRecycled) {
        fuelMix = { prod_res: 46, rec_ext: 34, rec_waste: 14, natgas: 6 };
      } else if (i === 1) {
        fuelMix = { prod_res: 78, biomass: 16, natgas: 6 };
      } else if (i === nCu) {
        fuelMix = { natgas: 88, liquid: 12 };
      } else {
        fuelMix = { prod_res: 62, biomass: 30, natgas: 8 };
      }
      for (const [code, pct] of Object.entries(fuelMix)) {
        setKeyed(f, 'combustion_unit_fuels', code, {
          pct,
          description: {
            prod_res: 'Own bark, sander dust, chip screenings and trim',
            biomass: 'Purchased forest chips and bark',
            natgas: 'Natural gas, grid supply',
            liquid: 'Light fuel oil, start-up and back-up only',
            rec_ext: 'Externally collected recycled wood, A1/A2',
            rec_waste: 'Waste wood A3 grade, permitted under the WID chapter',
            other: 'Other',
          }[code],
        }, i);
      }
    }

    setOne(f, 'energy_section', {
      ref_year: year,
      s41_diagram_ref: 'Annex A — ' + plant.key.toUpperCase() + ' combustion unit flow diagram.pdf',
      s43_steam: num(30, 180, 1),
      s43_hot_oil: num(0, 45, 1),
      s43_fluegas: num(40, 220, 1),
      s43_other: num(0, 20, 1),
      s43_cold_startups: int(2, 9),
      s43_warm_startups: int(6, 28),
      s43_maintenance_desc: 'Annual shutdown of ' + int(5, 14) + ' days for boiler ' +
        'inspection, filter media replacement and refractory repair.',
      comments: 'Energy figures are site totals for reference year ' + year + '.',
    });
  }

  /* ── page 5 — secheurs et presses ──────────────────────────────── */
  if (has(5)) {
    const f = pages[5] = {};
    const nDry = plant.scale === 'large' ? 2 : 1;
    setCount(f, 'dryers', nDry);
    for (let i = 1; i <= nDry; i++) {
      // Contraintes physiques du sechage du bois : entree plus chaude que
      // sortie, humidite avant sechage tres superieure a l'humidite apres.
      const inletMin = int(240, 380);
      const inletMax = inletMin + int(60, 220);
      const outlet = int(95, 165);
      const mcBefore = num(42, 98, 1);
      const mcAfter = num(6.0, 11.5, 1);
      const dried = Math.round(prodTotal * (nDry === 2 ? 0.55 : 1.05));
      setMany(f, 'dryers', i, {
        ref_year: year,
        main_type: plant.products.includes('MDF') || plant.products.includes('HDF')
          ? pick(['blowline', 'flash_pre']) : pick(['single', 'three', 'tubular', 'double']),
        system_desc: 'Directly heated by flue gas from CU1, with partial exhaust ' +
          'recirculation and a downstream ' +
          pick(['wet electrostatic precipitator', 'bio-scrubber', 'UTWS heat exchanger']) + '.',
        product: plant.products.join(' / '),
        install_year: int(Math.max(plant.started, 1992), 2021),
        temp_min: inletMin,
        temp_max: inletMax,
        outlet_temp: outlet,
        mc_before: mcBefore,
        mc_after: mcAfter,
        product_dried: dried,
        drying_rate: Math.round(dried / int(7200, 8200) * 10) / 10,
        residence_val: num(2.5, 22, 1),
        residence_unit: 'min',
        recirculation: 'y',
        heat_regained: i === 1 ? 'y' : 'n',
      });
    }

    const nPress = plant.products.length >= 2 && plant.scale !== 'small' ? 2 : 1;
    setCount(f, 'presses', nPress);
    for (let i = 1; i <= nPress; i++) {
      setMany(f, 'presses', i, {
        ref_year: year,
        main_type: plant.scale === 'small' ? 'multi_opening' : 'continuous',
        system_desc: 'Continuous double-belt press with oil-heated platens, ' +
          'infeed prepress and downstream cooling star.',
        product: plant.products[i - 1] || plant.products[0],
        install_year: int(Math.max(plant.started, 1994), 2023),
        output: Math.round(prodTotal / nPress),
        factor: num(4.5, 11.5, 1),
        temp: int(175, 235),
        pressure: num(2.2, 5.6, 1),
        exhaust_collected: 'y',
        abatement: plant.dirt < 1.1 ? 'y' : 'n',
      });
    }

    setOne(f, 'press_dryer_section', {
      comments: 'Dryer inlet temperature is the flue gas temperature after the ' +
        'mixing chamber; outlet is measured before the cyclone.',
    });
  }

  /* ── page 6 — techniques d'abattement et poussieres ────────────── */
  if (has(6)) {
    const f = pages[6] = {};
    const techs = [];
    techs.push({
      name: plant.dirt < 1.1 ? 'Wet electrostatic precipitator (WESP) on dryer exhaust'
                             : 'Multi-cyclone + wet scrubber on dryer exhaust',
      eff: plant.dirt < 1.1 ? '92-97 % PM, 55-70 % condensable organics'
                            : '78-88 % PM, 30-45 % condensable organics',
      sources: { dryer: 'y', press: plant.scale === 'large' ? 'y' : 'n' },
    });
    if (plant.scale !== 'small') {
      techs.push({
        name: 'Bio-scrubber / biofilter on press and cooling exhaust',
        eff: '60-80 % VOC, 70-90 % formaldehyde',
        sources: { press: 'y', dryer: 'n' },
      });
    }
    if (plant.dirt >= 1.2) {
      techs.push({
        name: 'SNCR urea injection on the recycled-wood boiler',
        eff: '45-60 % NOx',
        sources: { dryer: 'y', other: 'y' },
      });
    }
    setCount(f, 'abatement_techniques', techs.length);
    techs.forEach((t, i) => {
      const idx = i + 1;
      setMany(f, 'abatement_techniques', idx, {
        name: t.name,
        install_year: int(Math.max(plant.started, 1998), 2023),
        annex_ref: 'Annex B' + idx + ' — ' + plant.key.toUpperCase() + ' abatement datasheet',
        design_features: 'Design flow ' + int(60, 320) * 1000 + ' Nm³/h, ' +
          'pressure drop ' + int(4, 22) + ' mbar, ' +
          pick(['stainless', 'FRP', 'coated carbon steel']) + ' construction.',
        removal_efficiency: t.eff,
        comments: 'Efficiency taken from the acceptance test and confirmed by ' +
          'the last periodic measurement campaign.',
      });
      for (const [code, yn] of Object.entries(t.sources)) {
        setKeyed(f, 'abatement_technique_sources', code, {
          yn, spec: code === 'other' ? 'Recycled wood grinding line' : null,
        }, idx);
      }
      const intake = int(60, 320) * 1000;
      setKeyed(f, 'abatement_technique_flows', 'intake',
        { val: intake, comment: 'Annual average measured at the inlet duct.' }, idx);
      setKeyed(f, 'abatement_technique_flows', 'recycled',
        { val: Math.round(intake * num(0.12, 0.38, 2)), comment: 'Recirculated to the dryer.' }, idx);
      setKeyed(f, 'abatement_technique_flows', 'discharge',
        { val: Math.round(intake * num(0.62, 0.88, 2)), comment: 'To stack.' }, idx);
      setKeyed(f, 'abatement_technique_flows', 'waste_res',
        { val: num(80, 900, 0), comment: 'Scrubber sludge, t/year.' }, idx);
    });

    const collected = Math.round(prodTotal * num(0.012, 0.035, 4));
    setOne(f, 'dust_section', {
      s62_equip_desc: 'Central filter house serving the sanding line, the ' +
        'cut-to-size saws and the chip handling system. ' + int(4, 12) +
        ' bag filter compartments with online jet-pulse cleaning.',
      s62_collected_dust: collected,
      s62_dust_fate: 'Pneumatically conveyed to the fuel silo and burned in CU1; ' +
        'surplus pelletised and sold.',
      s62_energy_recovery_pct: num(72, 99, 1),
      s62_monitoring: 'Continuous differential pressure and broken-bag detection; ' +
        'annual periodic dust measurement by an accredited laboratory.',
      s62_control_measures: 'Enclosed conveyors, negative pressure in transfer points, ' +
        'spark detection and extinguishing on the main duct.',
      s62_comments: 'Dust quantity is the filter hopper weighing total for ' + year + '.',
    });
  }

  /* ── page 7 — points d'emission ────────────────────────────────── */
  if (has(7)) {
    const f = pages[7] = {};
    const eps = emissionPoints(plant);
    setCount(f, 'emission_points', eps.length);

    eps.forEach((ep, i) => {
      const idx = i + 1;
      const prof = POINT_PROFILES[ep.profile];
      const flowStd = Math.round(sc.flow * (0.4 + 0.5 * rnd()) / 1000) * 1000;
      const tempDry = ep.profile === 'dust' ? int(18, 42) : int(48, 135);
      setMany(f, 'emission_points', idx, {
        point_ref: 'EP' + idx + '-' + plant.key.toUpperCase(),
        ref_year: String(year),
        refcond: ep.profile === 'dust' ? 'L' : pick(['K', 'L', 'M']),
        waste_gas_desc: prof.label,
        cross_section: num(0.8, 6.5, 2),
        air_pressure: int(980, 1024),
        temp_dry: tempDry,
        temp_wet: Math.max(12, tempDry - int(6, 34)),
        o2: ep.profile === 'dust' ? num(20.4, 20.9, 1) : num(11.5, 18.5, 1),
        co2: ep.profile === 'dust' ? num(0.1, 0.6, 2) : num(2.5, 9.5, 1),
        co_gas: num(0.001, 0.03, 4),
        inert: num(70, 78, 1),
        moisture: ep.profile === 'dust' ? num(0.8, 3.5, 1) : num(9, 34, 1),
        density_std: num(1.21, 1.31, 3),
        flow_actual: Math.round(flowStd * num(1.15, 1.55, 2)),
        flow_std: flowStd,
        comments: 'Stack height ' + int(22, 65) + ' m; sampling ports per EN 15259.',
      });

      // 5 a 10 polluants par point, pris dans le profil du procede.
      const nPoll = Math.min(prof.polls.length, int(5, 10));
      const polls = prof.polls.slice(0, nPoll);
      for (const code of polls) {
        const forced = OUTLIERS.find(o => o.plant === plant.key && o.cycle === cycle.key &&
                                          o.point === idx && o.code === code);
        const conc = forced ? forced.value : pollutantValue(plant, cycleIdx, code);
        const lim = permitLimit(code);
        setKeyed(f, 'emission_point_pollutants', code, {
          conc,
          method: code === 'pm' || code === 'nox' || code === 'co'
            ? pick(['cem', 'cem', 'periodic']) : pick(['periodic', 'periodic', 'calc']),
          // Charge annuelle (t/an), derivee de la concentration et du debit.
          // Laissee vide pour l'odeur (ouE/m³) et les dioxines (ng I-TEQ) :
          // ces deux-la ne sont pas des concentrations massiques, et les
          // convertir en tonnes produirait un chiffre qui ne veut rien dire
          // mais qui partirait quand meme dans les totaux sectoriels.
          t_year: (code === 'odour' || code === 'pcdd')
            ? null : Math.round(conc * flowStd * 8000 / 1e9 * 1000) / 1000,
          short_term: pick(['h', 'daily', '30min']),
          short_val: Math.round(conc * num(1.15, 1.9, 2) * 100) / 100,
          limit_val: lim,
        }, idx);
      }
    });
  }

  /* ── page 8 — eaux residuaires ─────────────────────────────────── */
  if (has(8)) {
    const f = pages[8] = {};
    const nWw = plant.products.includes('SB') || plant.products.includes('HB') ? 2 : 1;
    setCount(f, 'waste_water_discharges', nWw);
    for (let i = 1; i <= nWw; i++) {
      const idx = i;
      setMany(f, 'waste_water_discharges', idx, {
        discharge_id: 'WW' + idx + '-' + plant.key.toUpperCase(),
        ref_year: String(year),
        treated: 'y',
        wwtp_desc: idx === 1
          ? 'Equalisation basin, DAF with coagulation/flocculation, anaerobic ' +
            'UASB reactor and aerobic polishing before discharge to the municipal sewer.'
          : 'Sedimentation and oil separator on storm water run-off from the log yard.',
        sludge_fate: pick(['incinerate', 'reuse_site', 'landfill', 'agri']),
      });

      const flow = Math.round(prodTotal * num(0.25, 1.6, 2));
      setKeyed(f, 'waste_water_pollutants', 'flow', {
        conc: flow, freq: 'cont', pos: 'discharge',
        comments: 'Totalising flow meter at the discharge point.',
      }, idx);
      const wwSet = {
        ph:      num(6.4, 8.4, 1),
        tss:     num(8, 60, 1),
        bod5:    num(12, 180, 0),
        cod:     num(60, 620, 0),
        toc:     num(18, 190, 0),
        total_n: num(3, 42, 1),
        nh4:     num(0.4, 12, 2),
      };
      for (const [code, conc] of Object.entries(wwSet)) {
        setKeyed(f, 'waste_water_pollutants', code, {
          conc, freq: pick(['monthly', 'quarterly', 'weekly']),
          pos: pick(['discharge', 'wwtp_out']),
          comments: code === 'ph' ? 'Range over the year; value shown is the annual median.' : null,
        }, idx);
      }

      const srcTotal = flow;
      setKeyed(f, 'waste_water_sources', 'manuf',
        { vol: Math.round(srcTotal * 0.42), comment: 'Blender and press area wash water.' }, idx);
      setKeyed(f, 'waste_water_sources', 'cleaning',
        { vol: Math.round(srcTotal * 0.18), comment: 'Equipment and floor cleaning.' }, idx);
      setKeyed(f, 'waste_water_sources', 'runoff_pond',
        { vol: Math.round(srcTotal * 0.22), comment: 'Log yard sprinkling run-off.' }, idx);
      setKeyed(f, 'waste_water_sources', 'abatement',
        { vol: Math.round(srcTotal * 0.18), comment: 'Wet scrubber blowdown.' }, idx);
    }
  }

  /* ── page 9 — dechets solides ──────────────────────────────────── */
  if (has(9)) {
    const f = pages[9] = {};
    const streams = [
      { description: 'Sander dust and cut-to-size trim (board dust)', ewc: '03 01 05',
        source: 'sander', qty: Math.round(prodTotal * num(0.02, 0.05, 4)), dest: 'energy' },
      { description: 'Bark and wood screenings from the chip line', ewc: '03 01 01',
        source: 'rawmat', qty: Math.round(prodTotal * num(0.03, 0.08, 4)), dest: 'energy' },
      { description: 'Boiler bottom ash and grate riddlings', ewc: '10 01 01',
        source: 'combustion', qty: Math.round(prodTotal * num(0.002, 0.008, 5)),
        dest: pick(['recycling', 'landfill']) },
    ];
    if (plant.scale !== 'small') {
      streams.push({ description: 'Fly ash from the biomass boiler filter', ewc: '10 01 03',
        source: 'abatement', qty: Math.round(prodTotal * num(0.0008, 0.004, 5)),
        dest: 'landfill' });
    }
    if (plant.products.includes('SB') || plant.products.includes('HB')) {
      streams.push({ description: 'Dewatered sludge from the on-site WWTP', ewc: '03 03 11',
        source: 'wwtp', qty: Math.round(prodTotal * num(0.003, 0.012, 5)),
        dest: pick(['incineration', 'energy', 'landfill']) });
    }
    setCount(f, 'waste_streams', streams.length);
    streams.forEach((s, i) => setMany(f, 'waste_streams', i + 1, s));

    setOne(f, 'waste_section', {
      waste_comments: 'Quantities are weighbridge totals for reference year ' + year +
        '. Internally recirculated wood residues are counted once, at the point ' +
        'they leave the production line.',
      waste_bat_techniques: 'Segregation at source, internal recovery of all clean ' +
        'wood residues as boiler fuel, and pelletising of surplus sander dust. ' +
        'Landfill is used only for ash fractions that fail the leaching test.',
    });
  }

  /* ── page 10 — consommation d'eau ──────────────────────────────── */
  if (has(10)) {
    const f = pages[10] = {};
    const process = Math.round(prodTotal * num(0.30, 1.10, 3));
    const refining = plant.products.includes('MDF') || plant.products.includes('HDF') ||
                     plant.products.includes('HB') || plant.products.includes('SB')
                   ? Math.round(process * num(0.35, 0.72, 2)) : 0;
    setOne(f, 'water_consumption', {
      wc_process: process,
      wc_cooling: Math.round(prodTotal * num(0.15, 0.9, 3)),
      wc_steam: Math.round(prodTotal * num(0.05, 0.35, 3)),
      wc_sanitary: int(900, 6500),
      wc_other: int(200, 3500),
      wc_refining_total: refining || null,
      wc_refining_recycled: refining ? Math.round(refining * num(0.55, 0.9, 2)) : null,
      wc_recycling_savings: Math.round(process * num(0.18, 0.55, 2)),
      wc_bat_techniques: 'Closed-loop refiner water circuit with a settling stage, ' +
        'reuse of scrubber blowdown in the log yard sprinkler, and dry cleaning ' +
        'of the press area wherever the surface allows it.',
      wc_comments: 'Abstraction is metered; municipal supply is invoiced monthly.',
    });
  }

  /* ── page 11 — technique candidate BAT (optionnelle) ───────────── */
  // Remplie pour environ un tiers des soumissions, comme dans le
  // questionnaire reel ou la section est facultative.
  if (has(11) && ctx.withBat) {
    const f = pages[11] = {};
    const bat = pick([
      { name: 'Wet electrostatic precipitator with condensate heat recovery',
        cat: ['bat_cat_air', 'bat_cat_energy'],
        desc: 'A WESP installed downstream of the dryer cyclone, combined with a ' +
          'flue gas condenser that returns low-grade heat to the building circuit.' },
      { name: 'Bio-scrubber on press and cooling-zone exhaust',
        cat: ['bat_cat_air', 'bat_cat_emissions'],
        desc: 'A two-stage bio-scrubber with a structured packing and a recirculated ' +
          'nutrient solution, treating the combined press and cooling star exhaust.' },
      { name: 'UTWS dryer with integrated thermal oxidation',
        cat: ['bat_cat_energy', 'bat_cat_air', 'bat_cat_primary_other'],
        desc: 'A closed-circuit superheated steam dryer whose exhaust is routed to a ' +
          'regenerative thermal oxidiser, cutting both VOC load and dryer energy demand.' },
      { name: 'Closed-loop refiner water circuit with anaerobic pre-treatment',
        cat: ['bat_cat_water', 'bat_cat_ww'],
        desc: 'Refiner process water is treated in a UASB reactor and returned to the ' +
          'refiner, cutting fresh water abstraction and COD load to the sewer.' },
    ]);
    const values = {
      bat_plant_name: plant.name,
      bat_name: bat.name,
      bat_tech_desc: bat.desc,
      bat_install_year: pick([String(int(2018, 2025)), int(2019, 2022) + '-' + int(2023, 2025),
        'planned ' + int(2027, 2029)]),
      bat_rd_level: pick(['full', 'full', 'pilot', 'bat']),
      bat_env_air: 'Dust below ' + num(3, 12, 1) + ' mg/Nm³ and TVOC below ' +
        num(12, 45, 1) + ' mg/Nm³ at the stack.',
      bat_env_water: 'Fresh water abstraction reduced by ' + int(15, 55) + ' %.',
      bat_env_energy: 'Net thermal demand reduced by ' + int(4, 22) + ' % on the dryer circuit.',
      bat_env_other: 'Odour complaints from the neighbouring village fell to zero ' +
        'in the two years after commissioning.',
      bat_cross_media: 'Additional electrical demand of ' + num(0.4, 2.8, 1) +
        ' MW and a scrubber sludge stream of ' + int(80, 700) + ' t/year.',
      bat_applicability: 'Applicable to new and retrofitted dryer lines; retrofit ' +
        'requires ' + int(3, 9) + ' m of free duct length and a shutdown of ' +
        int(7, 21) + ' days.',
      bat_invest_cost: '~ ' + num(1.1, 7.8, 1) + ' M EUR',
      bat_oper_cost: '~ ' + int(90, 640) + ' k EUR/year',
      bat_cost_effectiveness: '~ ' + int(600, 4200) + ' EUR per tonne of pollutant abated',
      bat_reference_plants: 'Two reference installations in the group; details in Annex C.',
      bat_references: 'Internal acceptance test report and the ' + int(2021, 2025) +
        ' periodic measurement campaign.',
      bat_tech_comments: 'Synthetic demonstration entry — not a real BAT submission.',
    };
    for (const c of bat.cat) values[c] = 'on';
    setOne(f, 'bat_candidate', values);
  }

  return pages;
}

/* ══ Assemblage du jeu complet ═══════════════════════════════════════ */

function dateBetween(a, b, frac) {
  const ta = Date.parse(a + 'T09:00:00Z');
  const tb = Date.parse(b + 'T17:00:00Z');
  return new Date(ta + (tb - ta) * frac).toISOString();
}

// Un site repond-il pour cette annee de reference ? Deux raisons de ne pas
// repondre, et une seule facon de les distinguer ensuite dans la base : il
// n'y a tout simplement pas de ligne. C'est exactement ce que voit l'EPF,
// qui ne peut pas differencier « pas encore membre » de « membre silencieux »
// autrement qu'en regardant la date d'adhesion.
export function respondsTo(plant, cycle) {
  const year = cycle.reference_year;
  if (year < plant.joined) return false;
  return !(plant.skips || []).includes(year);
}

export function buildDataset() {
  const companyByKey = new Map(COMPANIES.map(c => [c.key, c]));
  const submissions = [];
  let seq = 0;
  let batCounter = 0;

  for (const cycle of CYCLES) {
    const cycleIdx = cycleIndexOf(cycle);
    for (const plant of PLANTS) {
      // Le produit cartesien sites x campagnes donnerait le meme nombre de
      // reponses chaque annee et dans chaque pays. C'est ce filtre, et lui
      // seul, qui rend les agregats inegaux.
      if (!respondsTo(plant, cycle)) continue;
      const isOpen = cycle.status === 'open';
      const status = isOpen && OPEN_CYCLE_DRAFTS.includes(plant.key) ? 'draft' : 'submitted';
      const company = companyByKey.get(plant.company);
      const frac = (seq % 13) / 13;
      const createdAt = dateBetween(cycle.opens_at, cycle.subWindow[0], (seq % 7) / 7);
      const submittedAt = status === 'submitted'
        ? dateBetween(cycle.subWindow[0], cycle.subWindow[1], frac) : null;
      // Un tiers environ des soumissions porte une technique candidate BAT.
      const withBat = status === 'submitted' && (batCounter++ % 3 === 0);
      const ctx = { plant, company, cycle, cycleIdx, status, seq, withBat };
      submissions.push({
        plantKey: plant.key,
        companyKey: company.key,
        cycleKey: cycle.key,
        status,
        reference_year: cycle.reference_year,
        created_at: createdAt,
        submitted_at: submittedAt,
        updated_at: submittedAt || createdAt,
        pages: buildFlatPages(ctx),
      });
      seq++;
    }
  }
  return { companies: COMPANIES, plants: PLANTS, cycles: CYCLES, submissions };
}

/* ══ Traduction carte plate -> lignes, via le dispatcher du webform ══ */

// Une ligne 1:1 entierement nulle serait une ligne sans information : le
// dispatcher en emet une par table 'one' de la page, remplie ou non. On ne
// pose que celles qui portent quelque chose.
function allNull(row) {
  return Object.keys(row).every(k => row[k] === null || row[k] === undefined);
}

// { table: [ligne, …] } pour une soumission. Les lignes enfants gardent
// leur parent_idx et leur table parente : la resolution en cle etrangere
// ne peut avoir lieu qu'apres l'insertion des parents.
export function rowsForSubmission(pages) {
  const byTable = {};
  for (const [pageId, flat] of Object.entries(pages)) {
    for (const op of dispatch(flat, Number(pageId))) {
      if (!op.rows.length) continue;
      const rows = op.kind === 'one' ? op.rows.filter(r => !allNull(r)) : op.rows;
      if (!rows.length) continue;
      (byTable[op.table] = byTable[op.table] || []).push(...rows);
    }
  }
  return byTable;
}

/* ══ Consignation des identifiants ═══════════════════════════════════ */

// Le registre est reecrit apres chaque lot. Un run interrompu — coupure
// reseau, Ctrl-C, erreur PostgREST au milieu d'une table — laisse donc
// derriere lui un fichier qui decrit exactement ce qui est deja en base,
// et le script de nettoyage sait le defaire. L'ecrire seulement a la fin
// rendrait un run partiel impossible a rattraper autrement qu'a la main.
// `file` : ou ce registre doit s'ecrire. Il voyage DANS le registre plutot
// qu'a cote, pour qu'une vague de seed supplementaire, qui tient son propre
// registre, ne puisse pas ecraser celui de la premiere en oubliant de passer
// le chemin a l'un des sept appels de sauvegarde.
export function newLedger(file) {
  return {
    generated_by: 'supabase/seed/demo_data.mjs',
    ledger_file: file || IDS_FILE,
    started_at: new Date().toISOString(),
    finished_at: null,
    note: 'Identifiants des lignes AJOUTEES par le seed de demonstration EPF. ' +
          'demo_data_cleanup.mjs ne supprime que ces identifiants-la.',
    companies: [],
    plants: [],
    cycles: [],
    auth_users: [],
    submissions: [],
    submission_pages: [],
    tables: {},
  };
}

function recordTable(ledger, table, pk, ids) {
  const slot = ledger.tables[table] || (ledger.tables[table] = { pk, ids: [] });
  slot.ids.push(...ids);
}

function saveLedger(ledger, file) {
  fs.writeFileSync(file || ledger.ledger_file || IDS_FILE,
                   JSON.stringify(ledger, null, 2) + '\n', 'utf8');
}

/* ══ Insertion ═══════════════════════════════════════════════════════ */

const CHUNK = 400;

// INSERT pur, jamais d'upsert : une ligne preexistante ne peut pas etre
// reecrite par ce script, meme en cas de collision de cle — l'insertion
// echouerait, ce qui est exactement le comportement voulu.
async function insertRows(client, table, rows, returning) {
  const out = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const res = await client.from(table).insert(chunk).select(returning);
    if (res.error) {
      const err = new Error(
        'INSERT ' + table + ' (lignes ' + (i + 1) + '-' + (i + chunk.length) + ') : ' +
        res.error.message +
        (res.error.code ? ' [code ' + res.error.code + ']' : '') +
        (res.error.details ? ' — ' + res.error.details : '') +
        (res.error.hint ? ' — indice : ' + res.error.hint : '') +
        '\n  premiere ligne du lot : ' + JSON.stringify(chunk[0]));
      err.table = table;
      err.pgError = res.error;
      throw err;
    }
    out.push(...(res.data || []));
  }
  return out;
}

async function connect(env) {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: 'europanel' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function randomPassword() {
  // Le mot de passe n'est pas consigne : ces comptes ne servent qu'a porter
  // submissions.user_id, personne n'a a s'y connecter.
  const bytes = new Uint8Array(24);
  (globalThis.crypto || require('node:crypto').webcrypto).getRandomValues(bytes);
  return 'Dm!' + Buffer.from(bytes).toString('base64url');
}

// Profondeur dans la chaine de parente : 0 = rattachee a la soumission.
function depthOf(table) {
  let d = 0, cur = SCHEMA[table];
  while (cur && cur.parent) { d++; cur = SCHEMA[cur.parent]; }
  return d;
}

// Ordre d'ecriture des tables du questionnaire : parents d'abord.
export function tableOrder() {
  return Object.keys(SCHEMA).sort((a, b) => depthOf(a) - depthOf(b));
}

// `existing` : identifiants deja en base, par cle locale, sous la forme
// { companyId, plantId, cycleId, userId } de Map ou d'iterables de paires.
// Une vague de seed ulterieure s'en sert pour rattacher ses soumissions a des
// societes, sites et campagnes deja poses, sans les recreer en double. Les
// tableaux du dataset ne portent alors que les entites NOUVELLES : ce sont
// eux, et eux seuls, qui donnent lieu a une insertion.
export async function apply(client, dataset, ledger, log, existing = {}) {
  const counts = {};
  const bump = (t, n) => { counts[t] = (counts[t] || 0) + n; };

  /* ── 1. entreprises ───────────────────────────────────────────── */
  const companyRows = dataset.companies.map(c => ({ name: c.name, country: c.country }));
  const companyIns = await insertRows(client, 'companies', companyRows, 'id,name');
  const companyId = new Map(existing.companyId || []);
  for (const c of dataset.companies) {
    const row = companyIns.find(r => r.name === c.name);
    if (!row) throw new Error('companies : identifiant non rendu pour ' + c.name);
    companyId.set(c.key, row.id);
    ledger.companies.push(row.id);
  }
  bump('companies', companyIns.length);
  saveLedger(ledger);
  log('companies            ' + String(companyIns.length).padStart(5));

  /* ── 2. sites ─────────────────────────────────────────────────── */
  const plantRows = dataset.plants.map(p => ({
    company_id: companyId.get(p.company), name: p.name, country: p.country,
  }));
  const plantIns = await insertRows(client, 'plants', plantRows, 'id,name');
  const plantId = new Map(existing.plantId || []);
  for (const p of dataset.plants) {
    const row = plantIns.find(r => r.name === p.name);
    if (!row) throw new Error('plants : identifiant non rendu pour ' + p.name);
    plantId.set(p.key, row.id);
    ledger.plants.push(row.id);
  }
  bump('plants', plantIns.length);
  saveLedger(ledger);
  log('plants               ' + String(plantIns.length).padStart(5));

  /* ── 3. campagnes ─────────────────────────────────────────────── */
  const cycleRows = dataset.cycles.map(c => ({
    label: c.label, reference_year: c.reference_year,
    opens_at: c.opens_at, closes_at: c.closes_at, status: c.status,
  }));
  const cycleIns = await insertRows(client, 'cycles', cycleRows, 'id,label');
  const cycleId = new Map(existing.cycleId || []);
  for (const c of dataset.cycles) {
    const row = cycleIns.find(r => r.label === c.label);
    if (!row) throw new Error('cycles : identifiant non rendu pour ' + c.label);
    cycleId.set(c.key, row.id);
    ledger.cycles.push(row.id);
  }
  bump('cycles', cycleIns.length);
  saveLedger(ledger);
  log('cycles               ' + String(cycleIns.length).padStart(5));

  /* ── 4. comptes d'authentification (un par site) ──────────────── */
  // Les vrais comptes ne sont jamais touches : chaque adresse est creee de
  // toutes pieces sur le TLD .invalid (RFC 2606), donc aucune collision
  // possible avec un compte existant.
  const userId = new Map(existing.userId || []);
  for (const p of dataset.plants) {
    const email = p.key + '.demo@wbp-eurofederation.invalid';
    const { data, error } = await client.auth.admin.createUser({
      email,
      password: randomPassword(),
      email_confirm: true,
      user_metadata: {
        demo: true, plant_key: p.key, plant_name: p.name,
        seeded_by: 'supabase/seed/demo_data.mjs',
      },
    });
    if (error || !data || !data.user) {
      throw new Error('auth.admin.createUser ' + email + ' : ' +
                      (error ? error.message : 'aucun utilisateur rendu'));
    }
    userId.set(p.key, data.user.id);
    ledger.auth_users.push({ id: data.user.id, email });
    saveLedger(ledger);
  }
  bump('auth.users', userId.size);
  log('auth users           ' + String(userId.size).padStart(5));

  /* ── 5. soumissions ───────────────────────────────────────────── */
  // Une cle de correlation locale ne peut pas etre posee en base (aucune
  // colonne pour l'accueillir) : on insere donc soumission par soumission
  // et on rattache la ligne rendue a son contexte par l'ordre du lot, ce
  // que PostgREST garantit pour un insert de plusieurs lignes. Pour ne
  // dependre d'aucune garantie d'ordre, on insere par lots d'une seule
  // soumission et on lit l'unique ligne rendue.
  const subIds = [];
  const subRows = dataset.submissions.map(s => ({
    user_id: userId.get(s.plantKey),
    company_id: companyId.get(s.companyKey),
    plant_id: plantId.get(s.plantKey),
    cycle_id: cycleId.get(s.cycleKey),
    status: s.status,
    reference_year: s.reference_year,
    created_at: s.created_at,
    submitted_at: s.submitted_at,
    updated_at: s.updated_at,
  }));
  for (let i = 0; i < subRows.length; i++) {
    const got = await insertRows(client, 'submissions', [subRows[i]], 'id');
    if (got.length !== 1) throw new Error('submissions : ligne ' + i + ' non rendue');
    subIds.push(got[0].id);
    ledger.submissions.push(got[0].id);
  }
  bump('submissions', subIds.length);
  saveLedger(ledger);
  log('submissions          ' + String(subIds.length).padStart(5));

  /* ── 6. tables du questionnaire ───────────────────────────────── */
  // Toutes les soumissions sont traitees table par table, parents d'abord :
  // une seule requete par table et par lot de 400 lignes, au lieu d'une par
  // page et par soumission.
  const perSubmission = dataset.submissions.map(s => rowsForSubmission(s.pages));

  // parentKeys[table] = Map("<subIdx>/<idx>" -> id), remplie a mesure que
  // les tables parentes sont ecrites.
  const parentKeys = {};

  for (const table of tableOrder()) {
    const entry = SCHEMA[table];
    const payload = [];
    const origins = [];   // pour tracer une erreur jusqu'a sa soumission

    for (let si = 0; si < perSubmission.length; si++) {
      const rows = perSubmission[si][table];
      if (!rows || !rows.length) continue;
      for (const r of rows) {
        if (entry.parent) {
          const fk = parentColumn(entry);
          const key = si + '/' + r.parent_idx;
          const pid = parentKeys[entry.parent] && parentKeys[entry.parent].get(key);
          if (pid === undefined) {
            // Un enfant sans parent ecrit serait une ligne orpheline : on
            // arrete plutot que de la poser ou de la perdre en silence.
            throw new Error('table enfant ' + table + ' : parent ' + entry.parent +
                            ' absent pour la soumission #' + si + ' idx ' + r.parent_idx);
          }
          const row = {};
          for (const k of Object.keys(r)) if (k !== 'parent_idx') row[k] = r[k];
          row[fk] = pid;
          payload.push(row);
        } else {
          payload.push(Object.assign({ submission_id: subIds[si] }, r));
        }
        origins.push(si);
      }
    }
    if (!payload.length) continue;

    // Une table 1:1 a submission_id pour cle primaire ; les autres ont un
    // id de substitution. On ne demande que ce qui sert : la cle, et l'idx
    // quand la table est parente d'une autre.
    const isParent = Object.values(SCHEMA).some(e => e.parent === table);
    const returning = entry.kind === 'one' ? 'submission_id'
                    : isParent ? 'id,submission_id,idx' : 'id';

    let got;
    try {
      got = await insertRows(client, table, payload, returning);
    } catch (err) {
      err.message += '\n  (soumission locale #' + origins[0] + ', plante ' +
                     dataset.submissions[origins[0]].plantKey + ', campagne ' +
                     dataset.submissions[origins[0]].cycleKey + ')';
      throw err;
    }

    if (entry.kind === 'one') {
      recordTable(ledger, table, 'submission_id', got.map(r => r.submission_id));
    } else {
      recordTable(ledger, table, 'id', got.map(r => r.id));
    }
    if (isParent) {
      // Cle par (soumission, idx) et non par position : PostgREST ne
      // garantit pas l'ordre des lignes rendues par un RETURNING.
      const subIdxOf = new Map(subIds.map((id, i) => [id, i]));
      const map = parentKeys[table] = new Map();
      for (const r of got) map.set(subIdxOf.get(r.submission_id) + '/' + r.idx, r.id);
    }
    bump(table, got.length);
    saveLedger(ledger);
    log(table.padEnd(32) + String(got.length).padStart(5));
  }

  /* ── 7. filet submission_pages ────────────────────────────────── */
  // Non requis par les tables metier, mais c'est ce qui rend une soumission
  // de demonstration ouvrable dans le formulaire : sans lui, la barre
  // laterale montrerait douze pages vides devant des tables pleines.
  const pageRows = [];
  dataset.submissions.forEach((s, si) => {
    for (const [pageId, flat] of Object.entries(s.pages)) {
      pageRows.push({
        submission_id: subIds[si],
        page_id: Number(pageId),
        status: 'complete',
        raw: flat,
        saved_at: s.updated_at,
        updated_at: s.updated_at,
      });
      ledger.submission_pages.push({ submission_id: subIds[si], page_id: Number(pageId) });
    }
  });
  const pageIns = await insertRows(client, 'submission_pages', pageRows,
                                   'submission_id,page_id');
  bump('submission_pages', pageIns.length);
  saveLedger(ledger);
  log('submission_pages     ' + String(pageIns.length).padStart(5));

  ledger.finished_at = new Date().toISOString();
  saveLedger(ledger);
  return counts;
}

/* ══ Mode a blanc ════════════════════════════════════════════════════ */

export function dryRunCounts(dataset) {
  const counts = {
    companies: dataset.companies.length,
    plants: dataset.plants.length,
    cycles: dataset.cycles.length,
    'auth.users': dataset.plants.length,
    submissions: dataset.submissions.length,
  };
  let pages = 0;
  for (const s of dataset.submissions) {
    pages += Object.keys(s.pages).length;
    for (const [table, rows] of Object.entries(rowsForSubmission(s.pages))) {
      const entry = SCHEMA[table];
      const kept = entry.kind === 'one' ? rows.filter(r => !allNull(r)) : rows;
      counts[table] = (counts[table] || 0) + kept.length;
    }
  }
  counts.submission_pages = pages;
  return counts;
}

/* ══ Execution ═══════════════════════════════════════════════════════ */

const USAGE = [
  'Usage : node supabase/seed/demo_data.mjs [--dry-run|--apply]',
  '',
  '  --dry-run  (defaut) construit le jeu de donnees, n\'ecrit rien',
  '  --apply    ecrit reellement dans la base designee par .env',
  '',
  'Les identifiants crees sont consignes dans supabase/seed/.demo-seed-ids.json.',
  'Pour tout defaire : node supabase/seed/demo_data_cleanup.mjs --apply',
].join('\n');

export async function run(argv) {
  let apply_ = false;
  for (const a of argv) {
    if (a === '--apply') { apply_ = true; continue; }
    if (a === '--dry-run') { continue; }
    if (a === '--help' || a === '-h') { console.log(USAGE); return 0; }
    throw new Error('argument inconnu : ' + a + '\n' + USAGE);
  }

  const dataset = buildDataset();

  if (!apply_) {
    const counts = dryRunCounts(dataset);
    console.log('══ Seed de demonstration EPF — MODE A BLANC (rien n\'est ecrit) ══');
    let total = 0;
    for (const [t, n] of Object.entries(counts)) {
      console.log('  ' + t.padEnd(34) + String(n).padStart(6));
      total += n;
    }
    console.log('  ' + 'TOTAL'.padEnd(34) + String(total).padStart(6));
    console.log('\nRelancer avec --apply pour ecrire.');
    return 0;
  }

  if (fs.existsSync(IDS_FILE)) {
    throw new Error(IDS_FILE + ' existe deja : un jeu de demonstration semble ' +
      'deja pose. Le nettoyer (demo_data_cleanup.mjs --apply) ou deplacer ce ' +
      'fichier avant de reseeder — sinon les identifiants du run precedent ' +
      'seraient perdus et leurs lignes orphelines.');
  }

  const env = loadEnv();
  const client = await connect(env);
  const ledger = newLedger();
  saveLedger(ledger);

  console.log('══ Seed de demonstration EPF — ECRITURE ══════════════════════');
  console.log('  cible  : ' + env.SUPABASE_URL);
  console.log('  registre : ' + IDS_FILE);
  console.log('');
  try {
    const counts = await apply(client, dataset, ledger, s => console.log('  ' + s));
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log('');
    console.log('  ' + 'TOTAL'.padEnd(32) + String(total).padStart(5) + ' lignes inserees');
    console.log('  Registre des identifiants : ' + IDS_FILE);
    return 0;
  } catch (err) {
    console.error('');
    console.error('ECHEC — rien n\'est annule automatiquement.');
    console.error('  ' + (err && err.message ? err.message : String(err)));
    console.error('');
    console.error('  Les lignes deja inserees sont consignees dans ' + IDS_FILE + '.');
    console.error('  Pour les retirer : node supabase/seed/demo_data_cleanup.mjs --apply');
    return 2;
  }
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
