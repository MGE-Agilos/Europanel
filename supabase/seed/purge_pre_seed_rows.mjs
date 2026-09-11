#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Retrait des lignes anterieures au jeu de demonstration.

   Ce que « anterieur » veut dire ici : tout ce qui n'est consigne dans
   AUCUN des registres de seed. Les deux vagues ont note chaque identifiant
   qu'elles ont pose ; ce qui reste est donc, par construction, ce qui
   existait avant — les saisies de test du formulaire, dont les valeurs
   comme « fdjhfdjc ».

   Le raisonnement se fait par soustraction et jamais par reconnaissance de
   motif : supprimer « ce qui ressemble a du test » effacerait un jour une
   ligne reelle mal saisie. Une ligne est retiree parce qu'elle n'est pas au
   registre, pas parce qu'elle a l'air fausse.

   PRECAUTIONS
     · Sauvegarde prealable obligatoire : tout ce qui va disparaitre est
       ecrit dans un fichier JSON avant la moindre suppression, et le
       script refuse d'agir si la sauvegarde echoue.
     · auth.users n'est JAMAIS touche. Ces soumissions appartiennent a de
       vrais comptes — dont celui de l'utilisateur. Les effacer reviendrait
       a supprimer son propre acces.
     · Les tables du questionnaire descendent en cascade depuis
       submissions (ON DELETE CASCADE) ; on ne supprime donc que les
       soumissions, puis les sites et societes devenus orphelins.

   Usage :
     node supabase/seed/purge_pre_seed_rows.mjs            (inventaire seul)
     node supabase/seed/purge_pre_seed_rows.mjs --apply    (supprime)
   ══════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './demo_data.mjs';

const SEED_DIR = fileURLToPath(new URL('./', import.meta.url));
const LEDGERS = ['.demo-seed-ids.json', '.demo-seed-ids-wave2.json']
  .map(f => path.join(SEED_DIR, f));

const APPLY = process.argv.includes('--apply');

async function connect(env) {
  const { createClient } = await import('@supabase/supabase-js');
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    db: { schema: 'europanel' },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function readLedgers() {
  const seeded = { submissions: new Set(), companies: new Set(), plants: new Set(), cycles: new Set() };
  let found = 0;
  for (const file of LEDGERS) {
    if (!fs.existsSync(file)) continue;
    found++;
    const led = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const k of Object.keys(seeded)) {
      for (const id of (led[k] || [])) seeded[k].add(Number(id));
    }
  }
  if (!found) {
    throw new Error('Aucun registre de seed trouve. Sans registre, impossible de ' +
      'distinguer les lignes anterieures des lignes semees — le script s\'arrete ' +
      'plutot que de deviner.');
  }
  return seeded;
}

async function all(client, table, cols) {
  // Pagination : PostgREST ne rend jamais plus de 1000 lignes et ne signale
  // pas qu'il tronque. Sans cette boucle, une base plus grande ferait passer
  // des lignes semees pour anterieures, et le script les supprimerait.
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select(cols).range(from, from + 999);
    if (error) throw new Error(table + ' : ' + error.message);
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const run = async () => {
  const env = loadEnv();
  const client = await connect(env);
  const seeded = readLedgers();

  const submissions = await all(client, 'submissions', 'id,user_id,company_id,plant_id,cycle_id,status,reference_year,created_at');
  const companies = await all(client, 'companies', 'id,name,country');
  const plants = await all(client, 'plants', 'id,name,country,company_id');
  const cycles = await all(client, 'cycles', 'id,label');

  const staleSubs = submissions.filter(s => !seeded.submissions.has(Number(s.id)));
  const staleSubIds = staleSubs.map(s => Number(s.id));

  // Une societe ou un site n'est retire que s'il n'est pas au registre ET
  // qu'aucune soumission conservee ne s'y rattache.
  const keptSubs = submissions.filter(s => seeded.submissions.has(Number(s.id)));
  const keptCompanyIds = new Set(keptSubs.map(s => Number(s.company_id)));
  const keptPlantIds = new Set(keptSubs.map(s => Number(s.plant_id)));

  const stalePlants = plants.filter(p => !seeded.plants.has(Number(p.id)) && !keptPlantIds.has(Number(p.id)));
  const staleCompanies = companies.filter(c => !seeded.companies.has(Number(c.id)) && !keptCompanyIds.has(Number(c.id)));
  const staleCycles = cycles.filter(c => !seeded.cycles.has(Number(c.id)));

  console.log('══ Lignes anterieures au jeu de demonstration ══════════════');
  console.log('  cible : ' + env.SUPABASE_URL);
  console.log('');
  console.log('  soumissions   ' + String(staleSubs.length).padStart(4) + ' / ' + submissions.length);
  console.log('  sites         ' + String(stalePlants.length).padStart(4) + ' / ' + plants.length);
  console.log('  societes      ' + String(staleCompanies.length).padStart(4) + ' / ' + companies.length);
  console.log('  campagnes     ' + String(staleCycles.length).padStart(4) + ' / ' + cycles.length);
  console.log('');
  for (const c of staleCompanies) console.log('    societe  #' + c.id + '  ' + c.name + ' (' + c.country + ')');
  for (const p of stalePlants) console.log('    site     #' + p.id + '  ' + p.name);
  for (const c of staleCycles) console.log('    campagne #' + c.id + '  ' + c.label);
  for (const s of staleSubs) {
    console.log('    soumission #' + s.id + '  ' + s.status + '  annee=' + (s.reference_year ?? '—') +
                '  creee ' + String(s.created_at).slice(0, 10));
  }

  const users = new Set(staleSubs.map(s => s.user_id));
  console.log('');
  console.log('  ' + users.size + ' compte(s) auth concerne(s) — AUCUN ne sera supprime.');

  if (!staleSubs.length && !stalePlants.length && !staleCompanies.length) {
    console.log('\nRien a retirer.');
    return 0;
  }

  if (!APPLY) {
    console.log('\nInventaire seul. Relancer avec --apply pour supprimer.');
    return 0;
  }

  /* ── sauvegarde ────────────────────────────────────────────────── */
  // Ecrite AVANT toute suppression : ces lignes ne figurent dans aucun
  // registre, rien d'autre ne permettrait de les retrouver.
  const backup = {
    taken_at: new Date().toISOString(),
    source: env.SUPABASE_URL,
    note: 'Lignes anterieures au seed de demonstration, retirees par ' +
          'purge_pre_seed_rows.mjs. Contient la page brute de chaque ' +
          'soumission, donc de quoi les reconstituer.',
    companies: staleCompanies, plants: stalePlants, cycles: staleCycles,
    submissions: staleSubs, submission_pages: [],
  };
  if (staleSubIds.length) {
    const { data, error } = await client.from('submission_pages')
      .select('*').in('submission_id', staleSubIds);
    if (error) throw new Error('submission_pages : ' + error.message);
    backup.submission_pages = data;
  }
  const file = path.join(SEED_DIR,
    '.pre-seed-rows.removed-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(file, JSON.stringify(backup, null, 2) + '\n', 'utf8');
  const written = fs.statSync(file).size;
  if (!written) throw new Error('sauvegarde vide — suppression annulee.');
  console.log('\n  sauvegarde : ' + file + ' (' + written + ' octets)');

  /* ── suppression ───────────────────────────────────────────────── */
  const del = async (table, ids) => {
    if (!ids.length) return 0;
    const { error } = await client.from(table).delete().in('id', ids);
    if (error) throw new Error('DELETE ' + table + ' : ' + error.message);
    console.log('  supprime ' + table.padEnd(14) + String(ids.length).padStart(4));
    return ids.length;
  };

  console.log('');
  // Les tables du questionnaire et submission_pages partent en cascade.
  await del('submissions', staleSubIds);
  await del('plants', stalePlants.map(p => Number(p.id)));
  await del('companies', staleCompanies.map(c => Number(c.id)));
  await del('cycles', staleCycles.map(c => Number(c.id)));

  console.log('\n  auth.users : inchange.');
  return 0;
};

run().then(
  code => { process.exitCode = code; },
  err => { console.error('ECHEC : ' + (err && err.message ? err.message : String(err))); process.exitCode = 2; },
);
