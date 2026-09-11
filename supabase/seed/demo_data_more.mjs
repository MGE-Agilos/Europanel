#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Deuxieme vague du jeu de demonstration EPF.

   Pourquoi une deuxieme vague plutot qu'un demo_data.mjs plus gros : la
   premiere est deja posee en base et son registre d'identifiants est le
   seul moyen de la defaire. Regenerer un jeu elargi obligerait a tout
   supprimer puis tout reecrire ; ajouter une vague laisse les deux
   independamment annulables, et ne touche pas une ligne existante.

   Ce que cette vague apporte, et pourquoi — d'apres ce que l'EPF dit
   publiquement de son propre travail :

     · Couverture geographique. L'EPF federe des membres dans trente pays
       et revendique une centaine de producteurs pour deux cents sites. Dix
       pays ne permettent pas de montrer une federation europeenne ; seize
       de plus donnent au filtre « pays » et aux agregats nationaux de quoi
       ressembler a ce que l'EPF publie deja dans son rapport annuel.

     · Masse statistique. Le besoin premier d'un groupe de travail
       Emissions industrielles est le positionnement anonymise d'un site
       dans la distribution du secteur. Une boite a moustaches sur quatorze
       sites n'est pas une distribution ; sur une quarantaine, elle commence
       a en etre une. C'est aussi ce qui rend tenable la regle de
       confidentialite que s'impose toute federation mettant en commun des
       donnees de concurrents : ne rien afficher qui porte sur moins de
       trois sites.

     · Profondeur temporelle. Deux campagnes anterieures (2021, 2022)
       portent les tendances de trois a cinq points, pour les sites de cette
       vague comme pour ceux de la premiere. L'indice de campagne est
       l'annee de reference moins 2023, de sorte que la derive deja ecrite
       pour 2023-2025 se prolonge vers le passe sans rupture : un site qui
       s'ameliore (trend < 1) emettait donc davantage en 2021.

   Usage : node supabase/seed/demo_data_more.mjs [--dry-run|--apply]
   Pour defaire cette vague seule :
     node supabase/seed/demo_data_cleanup.mjs --apply --ledger supabase/seed/.demo-seed-ids-wave2.json
   ══════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  loadEnv, newLedger, apply, buildFlatPages, rowsForSubmission,
  COMPANIES as WAVE1_COMPANIES, PLANTS as WAVE1_PLANTS, CYCLES as WAVE1_CYCLES,
} from './demo_data.mjs';

const SEED_DIR = fileURLToPath(new URL('./', import.meta.url));
const IDS_FILE = path.join(SEED_DIR, '.demo-seed-ids-wave2.json');

/* ══ Societes supplementaires ════════════════════════════════════════ */
/* Toujours fictives, toujours construites sur des toponymes et des mots
   communs. Les pays sont pris dans la liste COUNTRIES de
   docs/pages-0-6.js, et choisis parmi ceux qu'aucune societe de la
   premiere vague n'occupe. */
export const COMPANIES = [
  { key: 'alpenpl', name: 'Alpenplatten Werke GmbH',        country: 'Austria' },
  { key: 'boisred', name: 'Bois du Redon SAS',              country: 'France' },
  { key: 'metsalev', name: 'Metsalevy Oy',                  country: 'Finland' },
  { key: 'delftpan', name: 'Delft Paneelfabriek BV',        country: 'Netherlands' },
  { key: 'carpatpl', name: 'Carpatica Placaje SRL',         country: 'Romania' },
  { key: 'rodopip', name: 'Rodopi Panels AD',               country: 'Bulgaria' },
  { key: 'tatradosk', name: 'Tatra Dosky s.r.o.',           country: 'Slovakia' },
  { key: 'pannonlap', name: 'Pannonia Lapgyar Zrt.',        country: 'Hungary' },
  { key: 'nemunas', name: 'Nemunas Plokstes UAB',           country: 'Lithuania' },
  { key: 'peipsi',  name: 'Peipsi Plaaditehas AS',          country: 'Estonia' },
  { key: 'shannon', name: 'Shannon Board Products Ltd',     country: 'Ireland' },
  { key: 'pindosp', name: 'Pindos Panel SA',                country: 'Greece' },
  { key: 'slavonp', name: 'Slavonija Ploce d.o.o.',         country: 'Croatia' },
  { key: 'triglav', name: 'Triglav Plosce d.o.o.',          country: 'Slovenia' },
  { key: 'fjordsk', name: 'Fjordskiva AS',                  country: 'Norway' },
  { key: 'pennineb', name: 'Pennine Boards Ltd',            country: 'United Kingdom' },
];

/* ══ Sites supplementaires ═══════════════════════════════════════════ */
/* `dirt` (salete relative) et `trend` (derive d'une campagne a l'autre)
   pilotent les concentrations. La dispersion est deliberement plus large
   que dans la premiere vague : une distribution sectorielle credible n'est
   pas un peloton serre, et c'est precisement l'etalement qui donne un sens
   a un positionnement par centile.

   Le contreplaque est declare sous 'Other', seule valeur que la liste
   deroulante du formulaire propose pour lui (voir WBP_LABEL). */
export const PLANTS = [
  { key: 'p15', company: 'alpenpl', name: 'Alpenplatten Werke — Kufstein Mill',
    city: 'Kufstein', country: 'Austria', started: 1992, scale: 'large',
    products: ['PB', 'MDF'], trend: 0.93, dirt: 0.72 },
  { key: 'p16', company: 'alpenpl', name: 'Alpenplatten Werke — Villach Plant',
    city: 'Villach', country: 'Austria', started: 2009, scale: 'medium',
    products: ['OSB'], trend: 0.95, dirt: 0.64 },
  { key: 'p17', company: 'boisred', name: 'Bois du Redon — Limoges Works',
    city: 'Limoges', country: 'France', started: 1981, scale: 'large',
    products: ['PB', 'Other'], trend: 1.01, dirt: 1.18 },
  { key: 'p18', company: 'boisred', name: 'Bois du Redon — Bordeaux Plant',
    city: 'Bordeaux', country: 'France', started: 2015, scale: 'medium',
    products: ['MDF', 'HDF'], trend: 0.91, dirt: 0.58 },
  { key: 'p19', company: 'metsalev', name: 'Metsalevy — Lahti Mill',
    city: 'Lahti', country: 'Finland', started: 1974, scale: 'large',
    products: ['Other', 'PB'], trend: 0.96, dirt: 0.83 },
  { key: 'p20', company: 'metsalev', name: 'Metsalevy — Kuopio Mill',
    city: 'Kuopio', country: 'Finland', started: 2003, scale: 'medium',
    products: ['SB', 'HB'], trend: 0.94, dirt: 0.76 },
  { key: 'p21', company: 'delftpan', name: 'Delft Paneelfabriek — Moerdijk Plant',
    city: 'Moerdijk', country: 'Netherlands', started: 1997, scale: 'medium',
    products: ['PB'], trend: 0.98, dirt: 1.45 },
  { key: 'p22', company: 'carpatpl', name: 'Carpatica Placaje — Brasov Works',
    city: 'Brasov', country: 'Romania', started: 1968, scale: 'large',
    products: ['Other', 'PB'], trend: 1.06, dirt: 1.62 },
  { key: 'p23', company: 'carpatpl', name: 'Carpatica Placaje — Sibiu Plant',
    city: 'Sibiu', country: 'Romania', started: 2006, scale: 'small',
    products: ['MDF'], trend: 1.02, dirt: 1.22 },
  { key: 'p24', company: 'rodopip', name: 'Rodopi Panels — Smolyan Mill',
    city: 'Smolyan', country: 'Bulgaria', started: 1979, scale: 'medium',
    products: ['PB', 'HB'], trend: 1.07, dirt: 1.71 },
  { key: 'p25', company: 'tatradosk', name: 'Tatra Dosky — Zilina Works',
    city: 'Zilina', country: 'Slovakia', started: 1988, scale: 'medium',
    products: ['PB', 'MDF'], trend: 0.99, dirt: 1.08 },
  { key: 'p26', company: 'pannonlap', name: 'Pannonia Lapgyar — Szombathely Plant',
    city: 'Szombathely', country: 'Hungary', started: 2000, scale: 'medium',
    products: ['MDF'], trend: 0.97, dirt: 0.92 },
  { key: 'p27', company: 'pannonlap', name: 'Pannonia Lapgyar — Debrecen Plant',
    city: 'Debrecen', country: 'Hungary', started: 2018, scale: 'large',
    products: ['OSB', 'PB'], trend: 0.89, dirt: 0.52 },
  { key: 'p28', company: 'nemunas', name: 'Nemunas Plokstes — Kaunas Mill',
    city: 'Kaunas', country: 'Lithuania', started: 1994, scale: 'medium',
    products: ['PB', 'Other'], trend: 1.03, dirt: 1.28 },
  { key: 'p29', company: 'peipsi', name: 'Peipsi Plaaditehas — Tartu Works',
    city: 'Tartu', country: 'Estonia', started: 2010, scale: 'small',
    products: ['Other'], trend: 0.93, dirt: 0.69 },
  { key: 'p30', company: 'shannon', name: 'Shannon Board Products — Limerick Mill',
    city: 'Limerick', country: 'Ireland', started: 1986, scale: 'medium',
    products: ['MDF', 'PB'], trend: 0.96, dirt: 0.87 },
  { key: 'p31', company: 'pindosp', name: 'Pindos Panel — Larissa Plant',
    city: 'Larissa', country: 'Greece', started: 1976, scale: 'small',
    products: ['PB'], trend: 1.05, dirt: 1.54 },
  { key: 'p32', company: 'slavonp', name: 'Slavonija Ploce — Osijek Works',
    city: 'Osijek', country: 'Croatia', started: 1971, scale: 'medium',
    products: ['Other', 'HB'], trend: 1.04, dirt: 1.38 },
  { key: 'p33', company: 'triglav', name: 'Triglav Plosce — Maribor Plant',
    city: 'Maribor', country: 'Slovenia', started: 1999, scale: 'small',
    products: ['MDF'], trend: 0.95, dirt: 0.81 },
  { key: 'p34', company: 'fjordsk', name: 'Fjordskiva — Trondheim Mill',
    city: 'Trondheim', country: 'Norway', started: 1983, scale: 'medium',
    products: ['SB', 'MBH'], trend: 0.90, dirt: 0.61 },
  { key: 'p35', company: 'pennineb', name: 'Pennine Boards — Leeds Works',
    city: 'Leeds', country: 'United Kingdom', started: 1990, scale: 'large',
    products: ['PB', 'MDF', 'HDF'], trend: 0.97, dirt: 0.99 },
  { key: 'p36', company: 'pennineb', name: 'Pennine Boards — Ayrshire Plant',
    city: 'Ayr', country: 'United Kingdom', started: 2012, scale: 'medium',
    products: ['OSB'], trend: 0.92, dirt: 0.66 },
];

/* ══ Campagnes anterieures ═══════════════════════════════════════════ */
export const CYCLES = [
  { key: 'c2021', label: '2021 data collection (H1 2023)', reference_year: 2021,
    opens_at: '2023-01-16', closes_at: '2023-06-23', status: 'closed',
    subWindow: ['2023-02-27', '2023-06-20'] },
  { key: 'c2022', label: '2022 data collection (H1 2024)', reference_year: 2022,
    opens_at: '2024-01-15', closes_at: '2024-06-21', status: 'closed',
    subWindow: ['2024-03-01', '2024-06-18'] },
];

// Sites de cette vague laissant leur soumission de la campagne ouverte
// (2025) a l'etat de brouillon.
const OPEN_CYCLE_DRAFTS = ['p21', 'p24', 'p29', 'p31', 'p33', 'p36'];

/* ══ Assemblage ══════════════════════════════════════════════════════ */

function dateBetween(a, b, frac) {
  const ta = Date.parse(a + 'T09:00:00Z');
  const tb = Date.parse(b + 'T17:00:00Z');
  return new Date(ta + (tb - ta) * frac).toISOString();
}

// L'indice de campagne est l'annee de reference moins 2023, et non le rang
// dans un tableau : c'est ce qui fait que 2021 et 2022 prolongent vers le
// passe la derive deja ecrite pour 2023-2025, au lieu de la recommencer.
function cycleIndexOf(cycle) {
  return cycle.reference_year - 2023;
}

// Toutes les campagnes, anciennes et nouvelles, dans l'ordre chronologique.
function allCycles() {
  return [...CYCLES, ...WAVE1_CYCLES].sort((a, b) => a.reference_year - b.reference_year);
}

export function buildDataset() {
  const newCompanyByKey = new Map(COMPANIES.map(c => [c.key, c]));
  const oldCompanyByKey = new Map(WAVE1_COMPANIES.map(c => [c.key, c]));
  const submissions = [];
  let seq = 1000;          // decale : ne partage pas les contacts de la vague 1
  let batCounter = 0;

  for (const cycle of allCycles()) {
    const cycleIdx = cycleIndexOf(cycle);
    const isNewCycle = CYCLES.some(c => c.key === cycle.key);

    // Les sites de la vague 1 ne recoivent que les campagnes nouvelles :
    // leurs soumissions 2023-2025 sont deja en base.
    const plants = isNewCycle
      ? [...PLANTS, ...WAVE1_PLANTS.map(p => ({ ...p, wave1: true }))]
      : PLANTS;

    for (const plant of plants) {
      const company = plant.wave1
        ? oldCompanyByKey.get(plant.company)
        : newCompanyByKey.get(plant.company);
      if (!company) throw new Error('societe introuvable pour le site ' + plant.key);

      const status = cycle.status === 'open' && OPEN_CYCLE_DRAFTS.includes(plant.key)
        ? 'draft' : 'submitted';
      const frac = (seq % 13) / 13;
      const createdAt = dateBetween(cycle.opens_at, cycle.subWindow[0], (seq % 7) / 7);
      const submittedAt = status === 'submitted'
        ? dateBetween(cycle.subWindow[0], cycle.subWindow[1], frac) : null;
      const withBat = status === 'submitted' && (batCounter++ % 3 === 0);

      submissions.push({
        plantKey: plant.key,
        companyKey: company.key,
        cycleKey: cycle.key,
        status,
        reference_year: cycle.reference_year,
        created_at: createdAt,
        submitted_at: submittedAt,
        updated_at: submittedAt || createdAt,
        pages: buildFlatPages({ plant, company, cycle, cycleIdx, status, seq, withBat }),
      });
      seq++;
    }
  }

  return { companies: COMPANIES, plants: PLANTS, cycles: CYCLES, submissions };
}

/* ══ Identifiants deja en base ═══════════════════════════════════════ */
/* Resolus depuis la base et non depuis le registre de la vague 1 : c'est
   l'etat reel qui fait foi. Un site que quelqu'un aurait renomme entre-temps
   fait echouer ici, plutot que de voir ses soumissions rattachees a rien. */

async function resolveExisting(client) {
  const byName = async (table, col, wanted) => {
    const { data, error } = await client.from(table).select('id,' + col);
    if (error) throw new Error(table + ' : ' + error.message);
    const index = new Map(data.map(r => [r[col], r.id]));
    const out = new Map();
    for (const w of wanted) {
      const id = index.get(w.name || w.label);
      if (id === undefined) {
        throw new Error(table + ' : « ' + (w.name || w.label) + ' » absent de la base. ' +
          'La premiere vague a-t-elle bien ete appliquee ?');
      }
      out.set(w.key, id);
    }
    return out;
  };

  const companyId = await byName('companies', 'name', WAVE1_COMPANIES);
  const plantId = await byName('plants', 'name', WAVE1_PLANTS);
  const cycleId = await byName('cycles', 'label', WAVE1_CYCLES);

  // Compte d'authentification deja associe a chaque site de la vague 1 :
  // on reprend celui de ses soumissions existantes plutot que d'en creer un
  // second pour le meme site.
  const userId = new Map();
  for (const p of WAVE1_PLANTS) {
    const { data, error } = await client.from('submissions')
      .select('user_id').eq('plant_id', plantId.get(p.key)).limit(1);
    if (error) throw new Error('submissions : ' + error.message);
    if (!data.length) throw new Error('aucune soumission existante pour ' + p.key);
    userId.set(p.key, data[0].user_id);
  }

  return { companyId, plantId, cycleId, userId };
}

/* ══ Execution ═══════════════════════════════════════════════════════ */

const USAGE = [
  'Usage : node supabase/seed/demo_data_more.mjs [--dry-run|--apply]',
  '',
  '  --dry-run  (defaut) construit la vague, n\'ecrit rien',
  '  --apply    ecrit reellement dans la base designee par .env',
  '',
  'Registre : supabase/seed/.demo-seed-ids-wave2.json',
].join('\n');

async function connect(env) {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: 'europanel' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// SCRIPT PERIME — ne plus executer.
//
// La deuxieme vague a ete repliee dans demo_data.mjs : ses seize societes,
// ses vingt-deux sites et ses deux campagnes anterieures y figurent
// desormais, aux cotes d'une participation inegale par site et par annee.
// Lancer ce script poserait une seconde fois les memes societes et les memes
// sites, sous des identifiants differents : le tableau de bord compterait
// alors chaque site deux fois sans qu'aucune contrainte de la base ne s'y
// oppose. Le fichier est garde pour la trace de ce qui a ete pose en base le
// 11 septembre 2026, et pour rien d'autre.
const SUPERSEDE = 'demo_data_more.mjs est perime : sa vague est repliee dans ' +
  'demo_data.mjs. Utiliser « node supabase/seed/demo_data.mjs --apply ».';

export async function run(argv) {
  throw new Error(SUPERSEDE);
  // eslint-disable-next-line no-unreachable
  let apply_ = false;
  for (const a of argv) {
    if (a === '--apply') { apply_ = true; continue; }
    if (a === '--dry-run') continue;
    if (a === '--help' || a === '-h') { console.log(USAGE); return 0; }
    throw new Error('argument inconnu : ' + a + '\n' + USAGE);
  }

  const dataset = buildDataset();

  if (!apply_) {
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
        counts[table] = (counts[table] || 0) + rows.length;
      }
    }
    counts.submission_pages = pages;
    console.log('══ Vague 2 du seed EPF — MODE A BLANC (rien n\'est ecrit) ══');
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
    throw new Error(IDS_FILE + ' existe deja : cette vague semble deja posee. ' +
      'La nettoyer ou deplacer ce fichier avant de recommencer.');
  }

  const env = loadEnv();
  const client = await connect(env);
  const existing = await resolveExisting(client);
  const ledger = newLedger(IDS_FILE);
  ledger.generated_by = 'supabase/seed/demo_data_more.mjs';

  console.log('══ Vague 2 du seed EPF — ECRITURE ═══════════════════════════');
  console.log('  cible    : ' + env.SUPABASE_URL);
  console.log('  registre : ' + IDS_FILE);
  console.log('  rattache : ' + existing.plantId.size + ' sites et ' +
              existing.cycleId.size + ' campagnes deja en base');
  console.log('');
  try {
    const counts = await apply(client, dataset, ledger, s => console.log('  ' + s), existing);
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    console.log('');
    console.log('  ' + 'TOTAL'.padEnd(32) + String(total).padStart(5) + ' lignes inserees');
    return 0;
  } catch (err) {
    console.error('\nECHEC — rien n\'est annule automatiquement.');
    console.error('  ' + (err && err.message ? err.message : String(err)));
    console.error('\n  Pour retirer ce qui a ete pose : node supabase/seed/demo_data_cleanup.mjs ' +
                  '--apply --ledger ' + IDS_FILE);
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
