/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Inventaire des champs réellement émis par le questionnaire

   Exécute les treize fonctions de rendu dans un contexte isolé et lit les
   attributs name="…" du HTML qu'elles produisent.

   Pourquoi exécuter plutôt que lire le source : les renderers construisent
   une partie de leurs champs par littéral de gabarit
   (`dryer_${di}_temp_max`) et une autre partie à travers des fonctions
   auxiliaires — numUnit(), ynSel(), numCell() — qui écrivent l'attribut
   name à l'intérieur du helper. Aucune expression régulière appliquée au
   texte source ne voit cette seconde catégorie. C'est ainsi que seize
   colonnes ont manqué à l'inventaire initial, dont les taux d'humidité
   avant et après séchage, qui portent le bilan énergétique du sécheur.

   Limite connue : les renderers sont appelés avec des données vides, donc
   les sections répétables rendent leur nombre minimal d'instances et les
   champs affichés sous condition peuvent rester absents. L'inventaire
   donne la forme de chaque groupe, pas le nombre d'instances.

   Usage : node tools/extract_fields.mjs [--json]
   ══════════════════════════════════════════════════════════════════════ */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const DOCS = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'docs');
const RENDERERS = ['pages-0-6.js', 'pages-7-12.js'];

// Rend le HTML d'une page et retourne les noms de champs qu'elle contient.
export function renderedFieldsByPage() {
  const ctx = {
    console,
    // Accesseur utilisé par les renderers pour lire une valeur existante.
    v: (data, name) => (data && data[name] != null ? data[name] : ''),
  };
  ctx.window = ctx;
  ctx.self = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  for (const file of RENDERERS) {
    vm.runInContext(fs.readFileSync(path.join(DOCS, file), 'utf8'), ctx, { filename: file });
  }

  const out = {};
  for (const key of Object.keys(ctx)) {
    const m = /^renderPage(\d+)$/.exec(key);
    if (!m) continue;
    const page = Number(m[1]);
    let html;
    try {
      html = ctx[key]({}, page);
    } catch (err) {
      // La page 12 est un récapitulatif : elle dépend du manifeste PAGES de
      // app.js et ne porte aucun champ. Toute autre erreur doit remonter.
      if (page === 12) continue;
      throw new Error(`renderPage${page} a échoué : ${err.message}`);
    }
    out[page] = [...String(html).matchAll(/name="([^"]+)"/g)].map(x => x[1]);
  }
  return out;
}

// Remplace les indices d'instance par un jeton, pour comparer des formes
// de noms plutôt que des valeurs : dryer_1_temp_max devient dryer_{}_temp_max.
export function toShape(name) {
  return name.replace(/\b\d+\b/g, '{}');
}

export function shapesByPage() {
  const byPage = renderedFieldsByPage();
  const out = {};
  for (const [page, names] of Object.entries(byPage)) {
    out[page] = [...new Set(names.map(toShape))].sort();
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    process.argv[1].endsWith('extract_fields.mjs')) {
  const shapes = shapesByPage();
  if (process.argv.includes('--json')) {
    process.stdout.write(JSON.stringify(shapes, null, 1));
  } else {
    let total = 0;
    for (const page of Object.keys(shapes).sort((a, b) => a - b)) {
      console.log(`\n── page ${page} — ${shapes[page].length} formes ──`);
      console.log(shapes[page].join('\n'));
      total += shapes[page].length;
    }
    console.log(`\nTotal : ${total} formes de champs distinctes.`);
  }
}
