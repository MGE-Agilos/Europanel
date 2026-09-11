#!/usr/bin/env node
/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Sortir les dimensions calculees des graphiques.

   Deux graphiques definissaient leur dimension par une expression plutot
   que par un champ. Une expression enfouie dans un objet n'est visible que
   de qui l'ouvre, ne se reutilise pas d'un graphique a l'autre, et se
   recalcule a chaque rafraichissement au lieu d'une fois au chargement.
   Le calcul appartient au script ; le graphique se contente d'un champ.

   Ce que ce script rebranche, apres que gen_qlik_load_script.mjs a produit
   les champs et que qlik_push_load_script.mjs les a poses dans l'espace :

     · « Sector spread per pollutant »
       =If(Match([..._ref_label], 'Odour', 'PCDD/PCDF') = 0, [..._ref_label])
       -> emission_point_pollutants_mass_label

     · « If the dust AEL were set here… »
       =ValueList(5, 10, 15, 20)  ->  candidate_ael (table ilot CandidateAEL)
       La mesure repetait le meme ValueList : elle vise desormais le champ.
       Le titre annoncait « of the 36 sites » en dur, chiffre faux des que le
       panel a change ; il devient une expression qui compte les sites.

   Le script est idempotent : il verifie l'etat de depart de chaque objet et
   ne touche que ce qui doit l'etre. Le relancer sur une application deja
   corrigee ne fait rien.

   Usage : node tools/qlik_fix_calculated_dims.mjs [--app <id>] [--dry-run]
   ══════════════════════════════════════════════════════════════════════ */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { parseEnv } from '../supabase/seed/demo_data.mjs';
import { openEngine } from './qlik_engine.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const KEY_VARS = ['QLIK_API_KEY', 'QlikCloudTraining'];

const PM_SET = "{<emission_point_pollutants_ref_label={'PM'}>}";

const FIXES = [
  {
    id: '0f9a2e00-9cf0-4bd0-836b-5f58efe5ebe8',
    what: 'Sector spread per pollutant',
    dimension: 'emission_point_pollutants_mass_label',
    expect: /^=If\(Match\(/,
  },
  {
    id: '6c92bc60-5802-4b5e-966a-f87b165dd1d6',
    what: 'AEL simulator',
    dimension: 'candidate_ael',
    expect: /^=ValueList\(/,
    measures: [{
      match: /ValueList\(/,
      to: 'Count(DISTINCT ' + PM_SET + ' If(emission_point_pollutants_conc > candidate_ael, plant_id))',
    }],
    title: {
      was: /this many of the \d+ sites/,
      to: "='If the dust AEL were set here, this many of the ' & " +
          'Count(DISTINCT ' + PM_SET + " plant_id) & ' sites would fail'",
    },
  },
];

function loadConfig(appArg) {
  const envFile = path.join(ROOT, '.env');
  const fromFile = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {};
  const keyVar = KEY_VARS.find(n => process.env[n]);
  const apiKey = keyVar ? process.env[keyVar] : fromFile.QLIK_API_KEY;
  if (!apiKey) throw new Error('cle API Qlik introuvable (' + KEY_VARS.join(', ') + ', ou .env).');

  let tenant = process.env.QLIK_TENANT || fromFile.QLIK_TENANT;
  let appId = appArg;
  const manifest = path.join(ROOT, 'qlik', 'shots.json');
  if ((!tenant || !appId) && fs.existsSync(manifest)) {
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    tenant = tenant || m.tenant;
    appId = appId || m.appId;
  }
  if (!tenant || !appId) throw new Error('tenant ou application inconnus.');
  return { tenant: String(tenant).replace(/\/+$/, ''), apiKey, appId };
}

// Un titre Qlik est soit une chaine, soit { qStringExpression: { qExpr } }.
// Poser une chaine commencant par '=' fonctionne dans le client mais pas
// dans le service de rendu, qui l'affiche telle quelle, signe egal compris.
function titleExpr(expr) {
  return { qStringExpression: { qExpr: expr } };
}

function titleText(title) {
  if (typeof title === 'string') return title;
  if (title && title.qStringExpression) return '(expression)';
  return '';
}

export async function run(argv) {
  let appArg = null, dry = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--app') { appArg = argv[++i]; continue; }
    if (a === '--dry-run') { dry = true; continue; }
    if (a === '--help' || a === '-h') {
      console.log('Usage : node tools/qlik_fix_calculated_dims.mjs [--app <id>] [--dry-run]');
      return 0;
    }
    throw new Error('argument inconnu : ' + a);
  }

  const cfg = loadConfig(appArg);
  const eng = await openEngine(cfg.tenant, cfg.apiKey, cfg.appId);
  console.log('══ Dimensions calculees -> champs du script ═════════════════');
  console.log('  app : ' + cfg.appId + (dry ? '   (MODE A BLANC)' : ''));
  console.log('');

  let changed = 0;
  try {
    for (const fix of FIXES) {
      const { handle, props } = await eng.properties(fix.id);
      const dim = props.qHyperCubeDef.qDimensions[0];
      const current = (dim.qDef.qFieldDefs || [])[0] || '';
      console.log('  ' + fix.what);

      if (current === fix.dimension) {
        console.log('    dimension : deja « ' + fix.dimension +' », rien a faire');
      } else if (!fix.expect.test(current)) {
        // Refuser plutot que d'ecraser : si la dimension n'est ni l'expression
        // attendue ni le champ vise, quelqu'un l'a changee entre-temps et ce
        // script ne sait pas ce qu'il detruirait.
        throw new Error(fix.what + ' : dimension inattendue « ' + current +
                        ' » — corriger a la main ou mettre ce script a jour.');
      } else {
        dim.qDef.qFieldDefs = [fix.dimension];
        console.log('    dimension : ' + current.slice(0, 60) + '…');
        console.log('             -> ' + fix.dimension);
        changed++;
      }

      for (const m of fix.measures || []) {
        for (const mes of props.qHyperCubeDef.qMeasures) {
          if (mes.qDef && typeof mes.qDef.qDef === 'string' && m.match.test(mes.qDef.qDef)) {
            mes.qDef.qDef = m.to;
            console.log('    mesure    -> ' + m.to.slice(0, 70) + '…');
            changed++;
          }
        }
      }

      if (fix.title) {
        const t = props.title;
        if (typeof t === 'string' && fix.title.was.test(t)) {
          props.title = titleExpr(fix.title.to);
          console.log('    titre     : « ' + t + ' »');
          console.log('             -> expression qui compte les sites');
          changed++;
        } else {
          console.log('    titre     : ' + titleText(t) + ', laisse tel quel');
        }
      }

      if (!dry) await eng.setProperties(handle, props);
      console.log('');
    }

    if (dry) {
      console.log('  Mode a blanc : rien n\'a ete ecrit.');
    } else if (changed) {
      await eng.save();
      console.log('  ' + changed + ' modification(s) enregistree(s).');
    } else {
      console.log('  Rien a changer.');
    }
  } finally {
    eng.close();
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
