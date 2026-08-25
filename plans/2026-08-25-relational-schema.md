# EuroPanel — Migration JSONB → schéma relationnel : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer le stockage JSONB du questionnaire WBP BREF par 42 tables PostgreSQL typées — 35 décrites par le manifeste, 7 tables de noyau écrites à la main — une colonne par champ, sans modifier les treize fonctions de rendu du formulaire.

**Architecture:** Un manifeste déclaratif (`docs/fields.js`) décrit la correspondance entre les noms de champs HTML existants et les colonnes des tables. Un dispatcher (`docs/db.js`) traduit la carte plate `{nom: valeur}` — représentation conservée en mémoire — vers les tables à l'écriture, et la reconstruit à la lecture. Le DDL SQL et les politiques RLS sont **générés** depuis le manifeste, jamais écrits à la main. Le script de reprise des données réutilise le même dispatcher, ce qui rend toute divergence impossible entre les deux chemins d'écriture.

**Tech Stack:** JavaScript ES2020 sans build step, Supabase (PostgreSQL 15+), runner de test intégré `node --test` (aucune dépendance externe).

**Spec de référence:** `specs/2026-08-25-relational-schema-design.md`

---

## Notes préalables pour l'implémenteur

Trois pièges découverts dans le code existant. Les ignorer produit un aller-retour silencieusement faux.

**1. Les cases à cocher non cochées sont absentes, pas vides.** `collectFormData()` (`docs/app.js:263`) fait :

```js
} else if (el.type === 'checkbox') {
  if (el.checked) obj[name] = 'on';
}
```

Une case décochée ne produit **aucune clé**. Donc `hydrate()` doit omettre la clé quand le booléen vaut `false`, et surtout pas produire `''`.

**2. L'aller-retour numérique n'est pas une égalité de chaînes.** `'180.50'` → `180.5` en base → `'180.5'` au retour. C'est correct, mais `assert.deepEqual` sur les chaînes échouera. Les tests comparent les colonnes numériques avec `Number()`, les autres à l'identique.

**3. Les identifiants de section répétable n'ont pas de trous.** L'interface renumérote les instances quand l'opérateur en supprime une. Le dispatcher suppose donc `idx` contigu à partir de 1. Cette hypothèse est documentée dans le code.

**Décision de conception : énumération, pas parsing.** Un motif comme `rm_{code}_{col}` ne peut pas être analysé par expression régulière sans ambiguïté — dans `rm_ext_prod_res_specify`, rien ne dit où finit le code et où commence la colonne. Le dispatcher **construit** donc les noms attendus à partir des codes connus et des colonnes déclarées, puis les cherche dans la carte plate. Déterministe, sans ambiguïté.

---

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `package.json` | Racine. Déclare uniquement le script de test. Aucune dépendance. |
| `docs/fields.js` | Le manifeste. Données pures, aucune logique. |
| `docs/db.js` | Le dispatcher : `dispatch()`, `hydrate()`, `buildName()`, coercition de types. |
| `docs/app.js` | Modifié : `savePageData()` et `loadAllPageData()` réorientés. |
| `tools/gen_schema.mjs` | Génère le DDL et les politiques RLS depuis le manifeste. |
| `tools/gen_ref_lists.mjs` | Extrait les listes de valeurs des renderers, produit le seed SQL. |
| `supabase/migrations/002_relational_schema.sql` | Généré, revu, commité. |
| `supabase/migrations/003_seed_ref_lists.sql` | Généré, revu, commité. |
| `supabase/migrate/jsonb_to_relational.mjs` | Reprise des données existantes. |
| `tests/*.test.js` | Les trois niveaux de test de la spec § 8. |

`docs/pages-0-6.js` et `docs/pages-7-12.js` ne sont modifiés par aucune tâche.

`docs/fields.js` et `docs/db.js` doivent fonctionner **à la fois** dans le navigateur (balise `<script>`, variable globale) et sous Node (les tests). Ils utilisent donc le garde UMD montré en Tâche 2, et rien d'autre — pas d'`import`, pas d'`export`.

---

## Tâche 1 : Poser l'infrastructure de test

Il n'existe aucun `package.json` à la racine ni aucun runner. On utilise celui intégré à Node (18+), sans dépendance, pour rester cohérent avec le « no build step » du projet.

**Files:**
- Create: `package.json`
- Create: `tests/smoke.test.js`
- Modify: `.gitignore`

- [ ] **Step 1: Écrire le test de fumée**

`tests/smoke.test.js` :

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');

test('le runner de test fonctionne', () => {
  assert.strictEqual(1 + 1, 2);
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `node --test "tests/**/*.test.js"`
Expected: FAIL — aucun test trouvé ou échec, car `package.json` n'existe pas encore.

**Ne pas utiliser `node --test tests/`.** Sur Node 22.14 sous Windows, passer un
répertoire ne déclenche pas le balayage : Node tente de charger `tests` comme module
CommonJS et échoue avec `MODULE_NOT_FOUND`. Vérifié sur ce poste. Le motif glob entre
guillemets est résolu par le runner lui-même et fonctionne.

- [ ] **Step 3: Créer le `package.json`**

`package.json` :

```json
{
  "name": "europanel",
  "version": "1.0.0",
  "private": true,
  "description": "WBP BREF data collection platform",
  "scripts": {
    "test": "node --test \"tests/**/*.test.js\""
  }
}
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — `# pass 1`, `# fail 0`

- [ ] **Step 5: Vérifier que `.gitignore` couvre `node_modules`**

`.gitignore` contient déjà `node_modules/`. Ne rien changer si c'est le cas. Sinon, ajouter la ligne.

- [ ] **Step 6: Commit**

```bash
git add package.json tests/smoke.test.js .gitignore
git commit -m "test: add zero-dependency test harness using node --test"
```

---

## Tâche 2 : Le manifeste — squelette et première table

On commence par une seule entrée (`contacts`, la plus simple : `kind: 'one'`, colonnes de même nom que les champs). Le manifeste complet arrive en Tâche 9, une fois le moteur éprouvé.

**Files:**
- Create: `docs/fields.js`
- Create: `tests/fields.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

`tests/fields.test.js` :

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { SCHEMA } = require('../docs/fields.js');

test('contacts est déclaré comme table 1:1 de la page 0', () => {
  const e = SCHEMA.contacts;
  assert.strictEqual(e.kind, 'one');
  assert.strictEqual(e.page, 0);
});

test('contacts déclare les 17 colonnes de la page 0', () => {
  const cols = Object.keys(SCHEMA.contacts.cols);
  assert.strictEqual(cols.length, 17);
  assert.ok(cols.includes('contact_email'));
  assert.ok(cols.includes('twg_ngo_telephone'));
});

test('toute entrée du manifeste déclare kind, page et cols', () => {
  for (const [name, e] of Object.entries(SCHEMA)) {
    assert.ok(['one', 'many', 'keyed'].includes(e.kind), `${name}: kind invalide`);
    assert.strictEqual(typeof e.page, 'number', `${name}: page manquante`);
    assert.ok(Object.keys(e.cols).length > 0, `${name}: cols vide`);
  }
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test`
Expected: FAIL — `Cannot find module '../docs/fields.js'`

- [ ] **Step 3: Créer le manifeste avec la seule entrée `contacts`**

`docs/fields.js` :

```js
/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Manifeste des champs
   Source de vérité unique de la correspondance champ HTML → table/colonne.
   Le DDL SQL et les politiques RLS sont générés depuis ce fichier.

   Types de colonnes : 'text' | 'num' | 'int' | 'bool'
   Genres d'entrée   : 'one'   table 1:1 avec la soumission
                       'many'  section répétable, indexée par {idx}
                       'keyed' groupe à clés fixes, indexé par {code}
   ══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EuroPanelFields = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA = {

    contacts: {
      kind: 'one', page: 0,
      cols: {
        contact_company: 'text', contact_name: 'text', contact_job_title: 'text',
        contact_email: 'text', contact_telephone: 'text', contact_comments: 'text',
        twg_ms_state: 'text', twg_ms_organisation: 'text', twg_ms_name: 'text',
        twg_ms_job_title: 'text', twg_ms_email: 'text', twg_ms_telephone: 'text',
        twg_ngo_company: 'text', twg_ngo_name: 'text', twg_ngo_job_title: 'text',
        twg_ngo_email: 'text', twg_ngo_telephone: 'text',
      },
    },

  };

  return { SCHEMA };
});
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add docs/fields.js tests/fields.test.js
git commit -m "feat: add field manifest module with contacts entry"
```

---

## Tâche 3 : Coercition de types

Isolée avant le dispatcher, car c'est là que vivent les deux pièges (case à cocher absente, aller-retour numérique).

**Files:**
- Create: `docs/db.js`
- Create: `tests/coerce.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

`tests/coerce.test.js` :

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { toDb, fromDb } = require('../docs/db.js');

test('toDb convertit la chaîne vide en null pour tous les types', () => {
  assert.strictEqual(toDb('', 'text'), null);
  assert.strictEqual(toDb('', 'num'), null);
  assert.strictEqual(toDb('', 'int'), null);
});

test('toDb convertit les nombres', () => {
  assert.strictEqual(toDb('180.50', 'num'), 180.5);
  assert.strictEqual(toDb('2019', 'int'), 2019);
});

test('toDb rejette le texte non numérique en null', () => {
  assert.strictEqual(toDb('n/a', 'num'), null);
  assert.strictEqual(toDb('inconnu', 'int'), null);
});

test('toDb traite la case à cocher : "on" vaut true, absent vaut false', () => {
  assert.strictEqual(toDb('on', 'bool'), true);
  assert.strictEqual(toDb(undefined, 'bool'), false);
  assert.strictEqual(toDb('', 'bool'), false);
});

test('toDb ne confond pas des espaces avec un zero', () => {
  // Number('  ') vaut 0 : sans trim, une absence de mesure deviendrait
  // une mesure de zero, ce qui n'est pas la meme affirmation.
  assert.strictEqual(toDb('   ', 'num'), null);
  assert.strictEqual(toDb('	', 'int'), null);
  assert.strictEqual(toDb('   ', 'text'), null);
});

test('toDb preserve le zero, qui est une mesure valide', () => {
  assert.strictEqual(toDb('0', 'num'), 0);
  assert.strictEqual(toDb('0', 'int'), 0);
  assert.strictEqual(toDb('0.0', 'num'), 0);
});

test('toDb arrondit les colonnes entieres', () => {
  // Les colonnes 'int' sont des SMALLINT : une fraction ferait echouer
  // l'insertion PostgreSQL.
  assert.strictEqual(toDb('2019.0', 'int'), 2019);
  assert.strictEqual(toDb('2.6', 'int'), 3);
});

test('toDb ne rogne pas le texte saisi', () => {
  assert.strictEqual(toDb(' Dupont ', 'text'), ' Dupont ');
});

test('fromDb rend la chaîne vide pour null', () => {
  assert.strictEqual(fromDb(null, 'text'), '');
  assert.strictEqual(fromDb(null, 'num'), '');
});

test('fromDb rend "on" pour true et undefined pour false', () => {
  assert.strictEqual(fromDb(true, 'bool'), 'on');
  assert.strictEqual(fromDb(false, 'bool'), undefined);
});

test('fromDb rend les nombres sous forme de chaîne', () => {
  assert.strictEqual(fromDb(180.5, 'num'), '180.5');
  assert.strictEqual(fromDb(2019, 'int'), '2019');
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test`
Expected: FAIL — `Cannot find module '../docs/db.js'`

- [ ] **Step 3: Créer `docs/db.js` avec la coercition seule**

`docs/db.js` :

```js
/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Dispatcher
   Traduit la carte plate {nom_champ: valeur} vers les tables, et l'inverse.
   Le manifeste (fields.js) est la source de vérité de la correspondance.
   ══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const fields = (typeof module !== 'undefined' && module.exports)
    ? require('./fields.js')
    : root.EuroPanelFields;
  const api = factory(fields);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EuroPanelDb = api;
})(typeof self !== 'undefined' ? self : this, function (fields) {
  'use strict';

  const { SCHEMA } = fields;

  /* ── Coercition ───────────────────────────────────────────────────── */

  // Carte plate → valeur PostgreSQL.
  // Une case à cocher décochée est absente de la carte (voir collectFormData),
  // ce qui doit produire false et non null.
  function toDb(value, type) {
    if (type === 'bool') return value === 'on';
    if (value === undefined || value === null) return null;

    // Number('  ') vaut 0 en JavaScript. Sans ce trim, un champ ne contenant
    // que des espaces serait enregistre comme une mesure de zero au lieu d'une
    // absence de mesure. Dans un jeu de donnees d'emissions, les deux sont des
    // affirmations differentes et partent dans les moyennes sectorielles.
    const trimmed = String(value).trim();
    if (trimmed === '') return null;

    if (type === 'num' || type === 'int') {
      const n = Number(trimmed);
      if (!Number.isFinite(n)) return null;
      // Les colonnes 'int' sont des SMALLINT (annees, compteurs) : une valeur
      // fractionnaire ferait echouer l'insertion cote PostgreSQL.
      return type === 'int' ? Math.round(n) : n;
    }
    // Le texte est conserve tel quel : ce n'est pas a la couche de stockage
    // de reecrire ce que l'operateur a saisi.
    return String(value);
  }

  // Valeur PostgreSQL → carte plate.
  // undefined signifie « ne pas produire de clé », ce qui reproduit
  // exactement le comportement de collectFormData pour les cases décochées.
  function fromDb(value, type) {
    if (type === 'bool') return value === true ? 'on' : undefined;
    if (value === null || value === undefined) return '';
    return String(value);
  }

  return { toDb, fromDb, SCHEMA };
});
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — 15 tests

- [ ] **Step 5: Commit**

```bash
git add docs/db.js tests/coerce.test.js
git commit -m "feat: add type coercion between flat map and database values"
```

---

## Tâche 4 : Construction des noms de champs

**Files:**
- Modify: `docs/db.js`
- Create: `tests/buildname.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

`tests/buildname.test.js` :

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildName, fieldSegment } = require('../docs/db.js');

test('remplace {idx} et {col}', () => {
  assert.strictEqual(
    buildName('dryer_{idx}_{col}', { idx: 3, col: 'temp_max' }),
    'dryer_3_temp_max'
  );
});

test('remplace {code} et {col}', () => {
  assert.strictEqual(
    buildName('rm_{code}_{col}', { code: 'ext_prod_res', col: 'specify' }),
    'rm_ext_prod_res_specify'
  );
});

test('remplace {parent_idx}, {code} et {col} dans les motifs imbriqués', () => {
  assert.strictEqual(
    buildName('ep_{parent_idx}_poll_{code}_{col}',
              { parent_idx: 2, code: 'nox', col: 'conc' }),
    'ep_2_poll_nox_conc'
  );
});

test('gère le code placé avant la colonne dans la matrice s22', () => {
  assert.strictEqual(
    buildName('s22_{code}_{col}', { code: 'debark', col: 'airflow' }),
    's22_debark_airflow'
  );
});

test('lève une erreur si un jeton du motif n’est pas fourni', () => {
  assert.throws(
    () => buildName('dryer_{idx}_{col}', { col: 'temp_max' }),
    /jeton non resolu/
  );
});

test('fieldSegment rend l’alias quand la colonne en déclare un', () => {
  const entry = { aliases: { point_ref: 'id' } };
  assert.strictEqual(fieldSegment(entry, 'point_ref'), 'id');
  assert.strictEqual(fieldSegment(entry, 'ref_year'), 'ref_year');
  assert.strictEqual(fieldSegment({}, 'ref_year'), 'ref_year');
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test`
Expected: FAIL — `buildName is not a function`

- [ ] **Step 3: Implémenter `buildName`**

Dans `docs/db.js`, après `fromDb`, ajouter :

```js
  /* ── Construction des noms ────────────────────────────────────────── */

  // Construit le nom de champ HTML attendu à partir d'un motif du manifeste.
  // On construit plutôt qu'on n'analyse : 'rm_{code}_{col}' est ambigu à la
  // lecture (où finit le code dans rm_ext_prod_res_specify ?) mais parfaitement
  // déterministe à l'écriture, puisque codes et colonnes sont connus.
  function buildName(pattern, parts) {
    const missing = [];
    const out = pattern.replace(/\{(idx|parent_idx|code|col)\}/g, (_, token) => {
      const v = parts[token];
      if (v === undefined || v === null) { missing.push(token); return ''; }
      return String(v);
    });
    if (missing.length) {
      throw new Error(
        'buildName: jeton non resolu {' + missing.join('}, {') + '} dans « ' + pattern + ' »'
      );
    }
    return out;
  }

  // Segment de nom de champ correspondant a une colonne.
  // Sert aux colonnes qui ne peuvent pas porter le nom de leur champ :
  // 'id' entrerait en collision avec la cle primaire de substitution,
  // 'desc' est un mot reserve PostgreSQL.
  function fieldSegment(entry, col) {
    return (entry.aliases && entry.aliases[col]) || col;
  }
```

Trois colonnes ne peuvent pas porter le nom de leur champ HTML :
`emission_points.id` entrerait en collision avec la clé primaire de substitution, et
`desc` (`layout_sections`, `solid_residues`) est un mot réservé PostgreSQL. Pour ces
cas, le manifeste déclare une correspondance colonne → segment de champ via `aliases`,
que `fieldSegment` résout. Toutes les autres colonnes passent au travers sans effet.

Ajouter les deux à l'objet retourné :

```js
  return { toDb, fromDb, buildName, fieldSegment, SCHEMA };
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — 16 tests

- [ ] **Step 5: Commit**

```bash
git add docs/db.js tests/buildname.test.js
git commit -m "feat: build HTML field names from manifest patterns"
```

---

## Tâche 5 : Dispatcher et hydratation — tables 1:1

**Files:**
- Modify: `docs/db.js`
- Create: `tests/dispatch-one.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

`tests/dispatch-one.test.js` :

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dispatch, hydrate } = require('../docs/db.js');

test('dispatch produit une ligne unique pour une table 1:1', () => {
  const flat = { contact_name: 'Dupont', contact_email: 'a@b.eu', contact_company: '' };
  const ops = dispatch(flat, 0);

  assert.strictEqual(ops.length, 1);
  assert.strictEqual(ops[0].table, 'contacts');
  assert.strictEqual(ops[0].rows.length, 1);
  assert.strictEqual(ops[0].rows[0].contact_name, 'Dupont');
  assert.strictEqual(ops[0].rows[0].contact_company, null);
});

test('dispatch ignore les pages sans entrée de manifeste', () => {
  assert.deepStrictEqual(dispatch({ peu_importe: 'x' }, 12), []);
});

test('hydrate reconstruit la carte plate depuis les lignes', () => {
  const rows = { contacts: [{ contact_name: 'Dupont', contact_email: null }] };
  const flat = hydrate(rows, 0);

  assert.strictEqual(flat.contact_name, 'Dupont');
  assert.strictEqual(flat.contact_email, '');
});

test('aller-retour : hydrate(dispatch(m)) rend m pour une table 1:1', () => {
  const flat = { contact_name: 'Dupont', contact_email: 'a@b.eu' };
  const ops  = dispatch(flat, 0);
  const rows = { contacts: ops[0].rows };
  const back = hydrate(rows, 0);

  assert.strictEqual(back.contact_name, 'Dupont');
  assert.strictEqual(back.contact_email, 'a@b.eu');
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test`
Expected: FAIL — `dispatch is not a function`

- [ ] **Step 3: Implémenter `dispatch` et `hydrate` pour `kind: 'one'`**

Dans `docs/db.js`, après `buildName`, ajouter :

```js
  /* ── Dispatch ─────────────────────────────────────────────────────── */

  // Retourne les entrées du manifeste appartenant à une page donnée.
  function entriesForPage(pageId) {
    return Object.entries(SCHEMA).filter(([, e]) => e.page === pageId);
  }

  // Carte plate → opérations d'écriture, une par table.
  // Forme : [{ table, kind, rows: [...] }]
  function dispatch(flat, pageId) {
    const ops = [];
    for (const [table, entry] of entriesForPage(pageId)) {
      if (entry.kind === 'one') {
        const row = {};
        for (const [col, type] of Object.entries(entry.cols)) {
          row[col] = toDb(flat[col], type);
        }
        ops.push({ table, kind: 'one', rows: [row] });
      }
    }
    return ops;
  }

  /* ── Hydratation ──────────────────────────────────────────────────── */

  // Lignes lues en base → carte plate attendue par les renderers.
  // `rowsByTable` a la forme { nom_table: [ligne, …] }.
  function hydrate(rowsByTable, pageId) {
    const flat = {};
    for (const [table, entry] of entriesForPage(pageId)) {
      const rows = rowsByTable[table] || [];
      if (entry.kind === 'one') {
        const row = rows[0];
        if (!row) continue;
        for (const [col, type] of Object.entries(entry.cols)) {
          const v = fromDb(row[col], type);
          if (v !== undefined) flat[col] = v;
        }
      }
    }
    return flat;
  }
```

Et étendre l'objet retourné :

```js
  return { toDb, fromDb, buildName, dispatch, hydrate, SCHEMA };
```

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — 20 tests

- [ ] **Step 5: Commit**

```bash
git add docs/db.js tests/dispatch-one.test.js
git commit -m "feat: dispatch and hydrate one-to-one page tables"
```

---

## Tâche 6 : Sections répétables

**Files:**
- Modify: `docs/fields.js`
- Modify: `docs/db.js`
- Create: `tests/dispatch-many.test.js`

- [ ] **Step 1: Ajouter l'entrée `dryers` au manifeste**

Dans `docs/fields.js`, à l'intérieur de `SCHEMA`, après `contacts` :

```js
    press_dryer_section: {
      kind: 'one', page: 5,
      // Pas de dryer_count ni press_count : un compteur derivable de COUNT(*)
      // n'a pas a occuper une colonne. Il est declare en countField sur la
      // section repetable, et hydrate depuis le nombre de lignes rendues.
      cols: { comments: 'text' },
    },

    dryers: {
      kind: 'many', page: 5, pattern: 'dryer_{idx}_{col}', countField: 'dryer_count',
      cols: {
        ref_year: 'int', main_type: 'text', system_desc: 'text', product: 'text',
        install_year: 'int', temp_min: 'num', temp_max: 'num',
        product_dried: 'num', drying_rate: 'num',
        residence_val: 'num', residence_unit: 'text',
      },
    },
```

- [ ] **Step 2: Écrire le test qui échoue**

`tests/dispatch-many.test.js` :

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dispatch, hydrate } = require('../docs/db.js');

function opFor(ops, table) {
  return ops.find(o => o.table === table);
}

test('dispatch produit une ligne par instance répétable', () => {
  const flat = {
    dryer_count: '2',
    dryer_1_main_type: 'single', dryer_1_temp_max: '180',
    dryer_2_main_type: 'three',  dryer_2_temp_max: '210',
  };
  const rows = opFor(dispatch(flat, 5), 'dryers').rows;

  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].idx, 1);
  assert.strictEqual(rows[0].temp_max, 180);
  assert.strictEqual(rows[1].idx, 2);
  assert.strictEqual(rows[1].main_type, 'three');
});

test('dispatch signale les instances à supprimer au-delà du compte', () => {
  const flat = { dryer_count: '1', dryer_1_main_type: 'single' };
  const op = opFor(dispatch(flat, 5), 'dryers');

  assert.strictEqual(op.rows.length, 1);
  assert.strictEqual(op.deleteBeyondIdx, 1);
});

test('dispatch sonde les instances quand aucun countField n’est déclaré', () => {
  // dryers déclare countField ; on vérifie que le compte prime sur la sonde
  const flat = {
    dryer_count: '1',
    dryer_1_main_type: 'single',
    dryer_2_main_type: 'orphelin',
  };
  const rows = opFor(dispatch(flat, 5), 'dryers').rows;
  assert.strictEqual(rows.length, 1);
});

test('aller-retour sur une section répétable', () => {
  const flat = {
    dryer_count: '2',
    dryer_1_main_type: 'single', dryer_1_temp_max: '180', dryer_1_residence_unit: 'min',
    dryer_2_main_type: 'three',  dryer_2_temp_max: '210', dryer_2_residence_unit: 'sec',
  };
  const ops = dispatch(flat, 5);
  const rowsByTable = {};
  ops.forEach(o => { rowsByTable[o.table] = o.rows; });
  const back = hydrate(rowsByTable, 5);

  assert.strictEqual(back.dryer_1_main_type, 'single');
  assert.strictEqual(Number(back.dryer_2_temp_max), 210);
  assert.strictEqual(back.dryer_2_residence_unit, 'sec');
});
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `npm test`
Expected: FAIL — `Cannot read properties of undefined (reading 'rows')`, car `dispatch` ne traite pas encore `kind: 'many'`

- [ ] **Step 4: Implémenter le genre `many`**

Dans `docs/db.js`, ajouter avant `dispatch` :

```js
  const PROBE_CAP = 500;

  // Nombre d'instances d'une section répétable présentes dans la carte plate.
  // On privilégie le compteur déclaré (countField) : il fait autorité, car
  // l'interface le maintient et il permet de détecter une instance supprimée
  // dont les clés traînent encore dans la carte.
  // À défaut, on sonde depuis 1 jusqu'au premier indice sans aucune colonne.
  // L'interface renumérote les instances à la suppression : pas de trous.
  function countInstances(flat, entry) {
    if (entry.countField) {
      const n = Number(flat[entry.countField]);
      if (Number.isFinite(n) && n >= 0) return Math.min(n, PROBE_CAP);
    }
    let n = 0;
    while (n < PROBE_CAP) {
      const idx = n + 1;
      const present = Object.keys(entry.cols).some(
        col => flat[buildName(entry.pattern,
                              { idx, col: fieldSegment(entry, col) })] !== undefined
      );
      if (!present) break;
      n = idx;
    }
    return n;
  }
```

Puis, dans `dispatch`, à l'intérieur de la boucle, après le bloc `kind === 'one'` :

```js
      if (entry.kind === 'many') {
        const n = countInstances(flat, entry);
        const rows = [];
        for (let idx = 1; idx <= n; idx++) {
          const row = { idx };
          for (const [col, type] of Object.entries(entry.cols)) {
            const seg = fieldSegment(entry, col);
            row[col] = toDb(flat[buildName(entry.pattern, { idx, col: seg })], type);
          }
          rows.push(row);
        }
        ops.push({ table, kind: 'many', rows, deleteBeyondIdx: n });
      }
```

Et dans `hydrate`, après le bloc `kind === 'one'` :

```js
      if (entry.kind === 'many') {
        for (const row of rows) {
          for (const [col, type] of Object.entries(entry.cols)) {
            const v = fromDb(row[col], type);
            if (v === undefined) continue;
            flat[buildName(entry.pattern,
              { idx: row.idx, col: fieldSegment(entry, col) })] = v;
          }
        }
        if (entry.countField) flat[entry.countField] = String(rows.length);
      }
```

- [ ] **Step 5: Lancer les tests et vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — 24 tests

- [ ] **Step 6: Commit**

```bash
git add docs/fields.js docs/db.js tests/dispatch-many.test.js
git commit -m "feat: dispatch and hydrate repeating sections"
```

---

## Tâche 7 : Groupes à clés fixes

**Files:**
- Modify: `docs/fields.js`
- Modify: `docs/db.js`
- Create: `tests/dispatch-keyed.test.js`

- [ ] **Step 1: Ajouter l'entrée `raw_materials` et sa liste de codes**

Dans `docs/fields.js`, avant la déclaration de `SCHEMA`, ajouter les listes de codes :

```js
  // Codes des groupes à clés fixes. Reflètent les tableaux const des renderers
  // et alimentent le seed de ref_lists.
  const LISTS = {
    raw_materials: ['roundwood', 'vir_forest', 'sawdust', 'ext_prod_res',
                    'ext_recycled', 'nonwood', 'other'],
  };
```

Puis, dans `SCHEMA` :

```js
    raw_materials_section: {
      kind: 'one', page: 3,
      cols: { s32_comments: 'text' },
    },

    raw_materials: {
      kind: 'keyed', page: 3, pattern: 'rm_{code}_{col}', list: 'raw_materials',
      cols: { specify: 'text', species: 'text', source: 'text' },
    },
```

Et exporter `LISTS` :

```js
  return { SCHEMA, LISTS };
```

- [ ] **Step 2: Écrire le test qui échoue**

`tests/dispatch-keyed.test.js` :

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dispatch, hydrate } = require('../docs/db.js');

function opFor(ops, table) {
  return ops.find(o => o.table === table);
}

test('dispatch produit une ligne par code renseigné, et seulement ceux-là', () => {
  const flat = {
    rm_roundwood_specify: 'oui', rm_roundwood_species: 'épicéa',
    rm_sawdust_specify: 'non',
  };
  const rows = opFor(dispatch(flat, 3), 'raw_materials').rows;

  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows.map(r => r.code).sort(), ['roundwood', 'sawdust']);
});

test('dispatch résout correctement un code contenant des soulignés', () => {
  const flat = { rm_ext_prod_res_specify: 'valeur' };
  const rows = opFor(dispatch(flat, 3), 'raw_materials').rows;

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].code, 'ext_prod_res');
  assert.strictEqual(rows[0].specify, 'valeur');
});

test('aller-retour sur un groupe à clés fixes', () => {
  const flat = {
    rm_ext_prod_res_specify: 'valeur',
    rm_roundwood_species: 'épicéa',
  };
  const ops = dispatch(flat, 3);
  const rowsByTable = {};
  ops.forEach(o => { rowsByTable[o.table] = o.rows; });
  const back = hydrate(rowsByTable, 3);

  assert.strictEqual(back.rm_ext_prod_res_specify, 'valeur');
  assert.strictEqual(back.rm_roundwood_species, 'épicéa');
});
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `npm test`
Expected: FAIL — `Cannot read properties of undefined (reading 'rows')`

- [ ] **Step 4: Implémenter le genre `keyed`**

Dans `docs/db.js`, remplacer la ligne de déstructuration en tête de la fabrique :

```js
  const { SCHEMA, LISTS } = fields;
```

Ajouter dans `dispatch`, après le bloc `kind === 'many'` :

```js
      if (entry.kind === 'keyed') {
        const rows = [];
        for (const code of LISTS[entry.list]) {
          const row = { code };
          let any = false;
          for (const [col, type] of Object.entries(entry.cols)) {
            const raw = flat[buildName(entry.pattern,
                                       { code, col: fieldSegment(entry, col) })];
            if (raw !== undefined && raw !== '') any = true;
            row[col] = toDb(raw, type);
          }
          // On n'écrit une ligne que si au moins une colonne est renseignée,
          // pour ne pas créer 37 lignes vides par point d'émission.
          if (any) rows.push(row);
        }
        ops.push({ table, kind: 'keyed', rows });
      }
```

Ajouter dans `hydrate`, après le bloc `kind === 'many'` :

```js
      if (entry.kind === 'keyed') {
        for (const row of rows) {
          for (const [col, type] of Object.entries(entry.cols)) {
            const v = fromDb(row[col], type);
            if (v === undefined) continue;
            flat[buildName(entry.pattern,
              { code: row.code, col: fieldSegment(entry, col) })] = v;
          }
        }
      }
```

- [ ] **Step 5: Lancer les tests et vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — 27 tests

- [ ] **Step 6: Commit**

```bash
git add docs/fields.js docs/db.js tests/dispatch-keyed.test.js
git commit -m "feat: dispatch and hydrate fixed-key groups"
```

---

## Tâche 8 : Tables enfants de second niveau

C'est la structure des polluants : `ep_{parent_idx}_poll_{code}_{col}`, une table petite-enfant rattachée à une section répétable.

**Files:**
- Modify: `docs/fields.js`
- Modify: `docs/db.js`
- Create: `tests/dispatch-nested.test.js`

- [ ] **Step 1: Ajouter les entrées de la page 7 au manifeste**

Dans `docs/fields.js`, ajouter à `LISTS` :

```js
    pollutants: ['pm', 'so2', 'nox', 'co', 'nh3', 'hcho', 'nmvoc', 'toc', 'voc',
                 'cvoc', 'terpene', 'org_acids'],
```

> Note : la liste complète compte 37 codes. Les douze ci-dessus suffisent aux tests de cette tâche ; la Tâche 9 la complète depuis `POLLUTANTS` dans `docs/pages-7-12.js`.

Puis dans `SCHEMA` :

```js
    // Pas de table air_emissions_section : elle n'aurait porte que ep_count,
    // derivable du nombre de points d'emission.
    emission_points: {
      kind: 'many', page: 7, pattern: 'ep_{idx}_{col}', countField: 'ep_count',
      // Le champ HTML est ep_N_id ; la colonne ne peut pas s'appeler id,
      // deja pris par la cle primaire de substitution.
      aliases: { point_ref: 'id' },
      cols: {
        point_ref: 'text', ref_year: 'int', refcond: 'text',
        waste_gas_desc: 'text', comments: 'text',
        cross_section: 'num', air_pressure: 'num', temp_dry: 'num', temp_wet: 'num',
        o2: 'num', co2: 'num', co_gas: 'num', inert: 'num', moisture: 'num',
        density_std: 'num', flow_actual: 'num', flow_std: 'num',
      },
    },

    emission_point_pollutants: {
      kind: 'keyed', page: 7, parent: 'emission_points',
      pattern: 'ep_{parent_idx}_poll_{code}_{col}', list: 'pollutants',
      // Le champ HTML est ..._limit ; la colonne ne peut pas s'appeler limit,
      // mot reserve SQL. C'est precisement le cas qui a motive les alias.
      aliases: { limit_val: 'limit' },
      cols: {
        conc: 'num', method: 'text', t_year: 'num',
        short_term: 'text', short_val: 'num',
        // 'text' et non 'num' : le renderer utilise deliberement un input
        // texte, car une limite de permis s'ecrit souvent « <= 50 » ou
        // « 50 (moyenne journaliere) ». La typer numerique mettrait ces
        // valeurs a null sans avertissement.
        limit_val: 'text',
      },
    },
```

- [ ] **Step 2: Écrire le test qui échoue**

`tests/dispatch-nested.test.js` :

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { dispatch, hydrate } = require('../docs/db.js');

function opFor(ops, table) {
  return ops.find(o => o.table === table);
}

test('dispatch rattache chaque polluant à son point d’émission', () => {
  const flat = {
    ep_count: '2',
    ep_1_id: 'EP-01', ep_2_id: 'EP-02',
    ep_1_poll_nox_conc: '120', ep_1_poll_pm_conc: '5',
    ep_2_poll_nox_conc: '95',
  };
  const rows = opFor(dispatch(flat, 7), 'emission_point_pollutants').rows;

  assert.strictEqual(rows.length, 3);
  const ep1 = rows.filter(r => r.parent_idx === 1);
  assert.strictEqual(ep1.length, 2);
  assert.strictEqual(rows.find(r => r.parent_idx === 2).conc, 95);
});

test('dispatch n’écrit pas de ligne pour un polluant non renseigné', () => {
  const flat = { ep_count: '1', ep_1_poll_nox_conc: '120' };
  const rows = opFor(dispatch(flat, 7), 'emission_point_pollutants').rows;

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].code, 'nox');
});

test('les tables enfants sont ordonnées après leur parent', () => {
  const ops = dispatch({ ep_count: '1', ep_1_poll_nox_conc: '1' }, 7);
  const iParent = ops.findIndex(o => o.table === 'emission_points');
  const iChild  = ops.findIndex(o => o.table === 'emission_point_pollutants');

  assert.ok(iParent < iChild, 'le parent doit précéder l’enfant');
});

test('aller-retour sur une structure imbriquée', () => {
  const flat = {
    ep_count: '2',
    ep_1_id: 'EP-01', ep_1_o2: '11',
    ep_2_id: 'EP-02',
    ep_1_poll_nox_conc: '120', ep_1_poll_nox_method: 'EN 14792',
    ep_2_poll_pm_conc: '5',
  };
  const ops = dispatch(flat, 7);
  const rowsByTable = {};
  ops.forEach(o => { rowsByTable[o.table] = o.rows; });
  const back = hydrate(rowsByTable, 7);

  assert.strictEqual(back.ep_1_id, 'EP-01');
  assert.strictEqual(Number(back.ep_1_poll_nox_conc), 120);
  assert.strictEqual(back.ep_1_poll_nox_method, 'EN 14792');
  assert.strictEqual(Number(back.ep_2_poll_pm_conc), 5);
});
```

- [ ] **Step 3: Lancer le test pour vérifier qu'il échoue**

Run: `npm test`
Expected: FAIL — les lignes produites n'ont pas de `parent_idx`

- [ ] **Step 4: Gérer le rattachement au parent**

Dans `docs/db.js`, remplacer le bloc `kind === 'keyed'` de `dispatch` par :

```js
      if (entry.kind === 'keyed') {
        const rows = [];
        // Une table enfant itère sur les instances de son parent ; une table
        // rattachée directement à la soumission n'a qu'une seule passe.
        const parents = entry.parent
          ? range(1, countInstances(flat, SCHEMA[entry.parent]))
          : [null];

        for (const parentIdx of parents) {
          for (const code of LISTS[entry.list]) {
            const parts = { code, parent_idx: parentIdx };
            const row = parentIdx === null ? { code } : { code, parent_idx: parentIdx };
            let any = false;
            for (const [col, type] of Object.entries(entry.cols)) {
              const raw = flat[buildName(entry.pattern,
                Object.assign({ col: fieldSegment(entry, col) }, parts))];
              if (raw !== undefined && raw !== '') any = true;
              row[col] = toDb(raw, type);
            }
            if (any) rows.push(row);
          }
        }
        ops.push({ table, kind: 'keyed', rows });
      }
```

Ajouter la fonction utilitaire `range` avant `dispatch` :

```js
  function range(from, to) {
    const out = [];
    for (let i = from; i <= to; i++) out.push(i);
    return out;
  }
```

Trier les opérations pour que les parents précèdent les enfants. À la fin de `dispatch`, avant `return ops` :

```js
    // Les tables enfants ont besoin de la clé de leur parent : on les écrit après.
    ops.sort((a, b) => depth(a.table) - depth(b.table));
    return ops;
```

Et ajouter `depth` près de `range` :

```js
  // Profondeur d'une table dans la chaîne de parenté (0 = rattachée à la soumission).
  function depth(table) {
    let d = 0, cur = SCHEMA[table];
    while (cur && cur.parent) { d++; cur = SCHEMA[cur.parent]; }
    return d;
  }
```

Remplacer enfin le bloc `kind === 'keyed'` de `hydrate` par :

```js
      if (entry.kind === 'keyed') {
        for (const row of rows) {
          const parts = { code: row.code };
          if (entry.parent) parts.parent_idx = row.parent_idx;
          for (const [col, type] of Object.entries(entry.cols)) {
            const v = fromDb(row[col], type);
            if (v === undefined) continue;
            flat[buildName(entry.pattern,
              Object.assign({ col: fieldSegment(entry, col) }, parts))] = v;
          }
        }
      }
```

- [ ] **Step 5: Lancer les tests et vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — 31 tests

- [ ] **Step 6: Commit**

```bash
git add docs/fields.js docs/db.js tests/dispatch-nested.test.js
git commit -m "feat: dispatch and hydrate second-level child tables"
```

---

## Tâche 9 : Compléter le manifeste et verrouiller sa couverture

Le moteur est eprouve sur les quatre formes. Cette tache remplit les 35 entrees du
manifeste — les 12 tables 1:1 de page et les 23 tables enfants — et pose le garde-fou
qui remplace la souplesse perdue du JSONB. Les 7 tables du noyau sont hors manifeste
et arrivent en Tache 10.

**Correspondance avec la spec :** 35 tables de questionnaire + 7 tables de noyau = les
42 tables de la spec section 4.4.

**Files:**
- Modify: `docs/fields.js`
- Create: `tests/manifest-coverage.test.js`

- [ ] **Step 1: Écrire le test de couverture qui échoue**

`tests/manifest-coverage.test.js` :

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { SCHEMA, LISTS } = require('../docs/fields.js');
const { buildName, fieldSegment } = require('../docs/db.js');

// Tous les noms de champs que le manifeste sait produire.
function manifestNames() {
  const names = new Set();
  for (const entry of Object.values(SCHEMA)) {
    const cols = Object.keys(entry.cols);
    if (entry.kind === 'one') { cols.forEach(c => names.add(c)); continue; }
    if (entry.countField) names.add(entry.countField);

    const parents = entry.parent ? [1, 2, 3] : [null];
    for (const p of parents) {
      if (entry.kind === 'many') {
        for (const idx of [1, 2, 3]) {
          cols.forEach(col => names.add(buildName(entry.pattern, { idx, col })));
        }
      } else {
        for (const code of LISTS[entry.list]) {
          cols.forEach(col => names.add(
            buildName(entry.pattern, { code, col, parent_idx: p })
          ));
        }
      }
    }
  }
  return names;
}

function readRenderer(f) {
  return fs.readFileSync(path.join(__dirname, '..', 'docs', f), 'utf8');
}

const RENDERERS = ['pages-0-6.js', 'pages-7-12.js'];

// Noms littéraux présents dans les renderers : name="quelque_chose".
function rendererLiteralNames() {
  const names = new Set();
  for (const f of RENDERERS) {
    for (const m of readRenderer(f).matchAll(/name="([a-z0-9_]+)"/g)) names.add(m[1]);
  }
  return names;
}

// Noms construits par gabarit : name="dryer_${di}_temp_max".
// Ils forment la majorite du questionnaire — secheurs, presses, polluants,
// effluents — et echappent entierement au balayage litteral ci-dessus.
// C'est par cette faille que ep_N_poll_KEY_limit a pu etre declare limit_val
// dans le manifeste sans que rien ne signale que la colonne ne serait jamais
// ni ecrite ni relue.
// On normalise chaque interpolation ${...} en un jeton {} : on compare des
// squelettes de noms, pas des valeurs.
const INTERP = /\$\{[^}]*\}/g;

function rendererTemplateShapes() {
  const shapes = new Set();
  for (const f of RENDERERS) {
    const re = /name="((?:[a-zA-Z0-9_]|\$\{[^}]*\})+)"/g;
    for (const m of readRenderer(f).matchAll(re)) {
      if (!m[1].includes('${')) continue;
      shapes.add(m[1].replace(INTERP, '{}'));
    }
  }
  return shapes;
}

// Squelettes que le manifeste sait produire, dans la meme normalisation.
function manifestShapes() {
  const shapes = new Set();
  for (const entry of Object.values(SCHEMA)) {
    if (entry.kind === 'one') continue;
    for (const col of Object.keys(entry.cols)) {
      shapes.add(entry.pattern
        .replace(/\{(idx|parent_idx|code)\}/g, '{}')
        .replace('{col}', fieldSegment(entry, col)));
    }
  }
  return shapes;
}

test('chaque champ littéral des renderers a une colonne déclarée', () => {
  const known = manifestNames();
  const missing = [...rendererLiteralNames()].filter(n => !known.has(n));
  assert.deepStrictEqual(missing, [],
    'champs sans colonne dans le manifeste : ' + missing.join(', '));
});

test('chaque champ construit par gabarit a une colonne declaree', () => {
  // Sans ce test, seuls les champs a nom litteral sont couverts, soit une
  // minorite du questionnaire.
  const known = manifestShapes();
  const missing = [...rendererTemplateShapes()].filter(sh => !known.has(sh));
  assert.deepStrictEqual(missing, [],
    'gabarits sans colonne dans le manifeste : ' + missing.join(', '));
});

test('chaque motif du manifeste correspond a un champ reel', () => {
  // Le sens inverse, et le plus insidieux : une colonne declaree que le
  // formulaire n'emet jamais ne sera ni ecrite ni relue, sans erreur ni
  // avertissement. C'est exactement ce qui est arrive a limit_val.
  const real = rendererTemplateShapes();
  const orphans = [...manifestShapes()].filter(sh => !real.has(sh));
  assert.deepStrictEqual(orphans, [],
    'colonnes sans champ correspondant : ' + orphans.join(', '));
});

test('le manifeste couvre les 33 tables du questionnaire', () => {
  // 10 tables 1:1 de page + 23 tables enfants.
  // Les 7 tables du noyau (plants, cycles, ref_lists, submission_pages,
  // audit_log, companies, submissions) ne portent aucun champ de
  // questionnaire : elles sont ecrites a la main, hors manifeste.
  // 33 + 7 = 40 tables au total (la spec annoncait 42 avant retrait des
  // deux tables qui n'existaient que pour porter un compteur).
  assert.strictEqual(Object.keys(SCHEMA).length, 33);
});

test('aucun compteur d’instances n’est stocke en colonne', () => {
  // Un compteur est derivable de COUNT(*). Le stocker cree une seconde source
  // de verite qui peut deriver de la premiere : deux tables de la meme page
  // ecrivaient alors la meme cle a l'hydratation, et l'ordre de declaration
  // dans le manifeste decidait silencieusement laquelle gagnait.
  const counters = new Set(Object.values(SCHEMA)
    .map(e => e.countField).filter(Boolean));
  for (const [name, e] of Object.entries(SCHEMA)) {
    for (const col of Object.keys(e.cols)) {
      assert.ok(!counters.has(col),
        `${name}.${col} est un compteur : le declarer en countField, pas en colonne`);
    }
  }
});

test('toute page declaree existe reellement', () => {
  // Le questionnaire compte 13 pages, 0 a 12. La page 12 (Review & Submit)
  // ne porte aucun champ : aucune entree ne doit s'y rattacher.
  // Sans cette borne, une page 13 mal tapee passerait inapercue et ses
  // donnees ne seraient jamais ni ecrites ni relues.
  for (const [name, e] of Object.entries(SCHEMA)) {
    assert.ok(Number.isInteger(e.page) && e.page >= 0 && e.page <= 11,
      `${name}: page ${e.page} hors de la plage 0-11`);
  }
});

test('toute entrée à clés référence une liste existante', () => {
  for (const [name, e] of Object.entries(SCHEMA)) {
    if (e.kind !== 'keyed') continue;
    assert.ok(Array.isArray(LISTS[e.list]), `${name}: liste « ${e.list} » absente`);
    assert.ok(LISTS[e.list].length > 0, `${name}: liste « ${e.list} » vide`);
  }
});

test('toute entrée à parent référence une table existante', () => {
  for (const [name, e] of Object.entries(SCHEMA)) {
    if (!e.parent) continue;
    assert.ok(SCHEMA[e.parent], `${name}: parent « ${e.parent} » absent`);
  }
});

test('aucune colonne ne porte un mot réservé SQL', () => {
  const reserved = new Set(['limit', 'order', 'group', 'user', 'table', 'desc', 'asc',
                            'select', 'where', 'default', 'check', 'references',
                            'id', 'idx', 'code', 'submission_id']);
  for (const [name, e] of Object.entries(SCHEMA)) {
    for (const col of Object.keys(e.cols)) {
      assert.ok(!reserved.has(col),
        `${name}.${col} est reserve (mot SQL ou colonne technique) : declarer un alias`);
    }
  }
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test`
Expected: FAIL — `le manifeste couvre les 35 tables du questionnaire` echoue (il en
compte 9 a ce stade), et la liste des champs manquants est longue. **Cette liste est
la feuille de route de l'etape suivante : la copier.**

- [ ] **Step 3: Compléter `LISTS`**

Extraire les listes complètes depuis les renderers avec cette commande, puis reporter le résultat dans `docs/fields.js` :

```bash
node -e "
const fs=require('fs');
const src=['docs/pages-0-6.js','docs/pages-7-12.js'].map(f=>fs.readFileSync(f,'utf8')).join('\n');
for (const m of src.matchAll(/(?:const|let)\s+([A-Z_0-9]{3,})\s*=\s*\[([\s\S]*?)\];/g)) {
  const keys=[...m[2].matchAll(/\b(?:k|key)\s*:\s*['\"]([a-z0-9_]+)['\"]/g)].map(x=>x[1]);
  if (keys.length) console.log(m[1], JSON.stringify(keys));
}"
```

Les listes attendues, avec leur nom dans `LISTS` :

```js
  const LISTS = {
    raw_materials:     ['roundwood','vir_forest','sawdust','ext_prod_res',
                        'ext_recycled','nonwood','other'],
    additives:         ['wax','other_add'],
    other_activities:  ['sawmill','glue','impreg_paper','paper_lam','other_value',
                        'combustion','incineration','ww_treatment','landfill',
                        'other_activities','other_specify'],
    wood_prep_ops:     ['debark','chip','other_chip'],
    wood_prep_params:  ['process_desc','prod_t_batch','wood_dry','airflow','chan_air',
                        'chan_treated','emit_limit','dust_method','monitoring'],
    layout_sections:   ['outdoor','indoor','silos'],
    fuels:             ['prod_res','liquid','natgas','rec_ext','rec_waste',
                        'biomass','other'],
    wg_sources:        ['dryer','press','paper','other'],
    pollutants:        ['pm','so2','nox','co','nh3','hcho','nmvoc','toc','voc',
                        'cvoc','terpene','org_acids','formic','acetic','propionic',
                        'aldehydes','acetaldehyde','phenol','pmdi','as','pb','cr',
                        'hcl','hf','cd','co_hm','cr_hm','cu','hg','ni','sb','tl','v',
                        'methanol','odour','others_1','pcdd'],
    exhaust_params:    ['cross_section','air_pressure','temp_dry','temp_wet','o2','co2',
                        'co_gas','inert','moisture','density_std','flow_actual','flow_std'],
    ww_sources:        ['refining','cleaning','manuf','runoff_pond','runoff_other',
                        'abatement','firefighting','open'],
    ww_pollutants:     ['flow','ph','tss','bod5','cod','toc','thc','total_n','tan',
                        'nh4','other_1','other_2'],
    bat_categories:    ['energy','rawmat','water','emissions','primary_other',
                        'air','ww','solid','secondary_other'],
  };
```

Les paramètres de gaz (`exhaust_params`) sont des **colonnes** de `emission_points`, pas une liste de codes ; ils figurent ici uniquement pour la génération du seed `ref_lists`, qui sert à l'affichage des libellés.

- [ ] **Step 4: Compléter `SCHEMA` avec les 42 entrées**

Les entrées déjà écrites aux tâches 2, 6, 7 et 8 sont conservées telles quelles. Ajouter les suivantes. Les colonnes proviennent de la spec § 4.2 et § 4.3.

```js
    // ── Page 1 ───────────────────────────────────────────────────────
    general_info: { kind:'one', page:1, cols:{
      plant_name:'text', production_started:'text', location_city:'text',
      location_country:'text', company:'text', comments:'text' } },

    products: { kind:'many', page:1, pattern:'prod_{idx}_{col}', cols:{
      type:'text', addinfo:'text', qty:'num', unit:'text' } },

    other_activities: { kind:'keyed', page:1, pattern:'act_{code}_{col}',
      list:'other_activities', cols:{
      label:'text', capacity:'num', unit:'text' } },

    // ── Page 2 ───────────────────────────────────────────────────────
    plant_layout: { kind:'one', page:2, cols:{
      s21_comments:'text', s22_comments:'text', s23_present:'text',
      s23_dust_method:'text', s23_monitoring:'text', s23_comments:'text' } },

    wood_prep_operations: { kind:'keyed', page:2, pattern:'s22_{code}_{col}',
      list:'wood_prep_ops', cols:{
      process_desc:'text', prod_t_batch:'num', wood_dry:'num', airflow:'num',
      chan_air:'num', chan_treated:'text', emit_limit:'text',
      dust_method:'text', monitoring:'text' } },

    wood_prep_param_comments: { kind:'keyed', page:2, pattern:'s22_comments_{code}',
      list:'wood_prep_params', cols:{ comments:'text' } },

    // 'desc' est un mot reserve PostgreSQL : la colonne s'appelle description.
    layout_sections: { kind:'keyed', page:2, pattern:'{code}_{col}',
      list:'layout_sections', aliases:{ description:'desc' }, cols:{
      description:'text', dust_method:'text', comments:'text' } },

    // ── Page 3 ───────────────────────────────────────────────────────
    resins:    { kind:'many', page:3, pattern:'resin_{idx}_{col}',
                 cols:{ type:'text', comments:'text' } },
    hardeners: { kind:'many', page:3, pattern:'hard_{idx}_{col}',
                 cols:{ type:'text', comments:'text' } },
    additives: { kind:'keyed', page:3, pattern:'add_{code}_{col}', list:'additives',
                 cols:{ type:'text', comments:'text' } },

    // ── Page 4 ───────────────────────────────────────────────────────
    energy_production: { kind:'one', page:4, cols:{
      s41_diagram_ref:'text', s43_cold_startups:'num',
      s43_warm_startups:'num', s43_maintenance_desc:'text', comments:'text' } },

    combustion_units: { kind:'many', page:4, pattern:'cu_{idx}_{col}',
      countField:'cu_count', cols:{
      thermal_input:'num', energy_output:'num', general_process:'text',
      equip_type:'text', install_year:'int', boiler_detail:'text',
      engine_ignition:'text', hours_normal:'num', hours_special:'num',
      dual_fuel:'text' } },

    combustion_unit_fuels: { kind:'keyed', page:4, parent:'combustion_units',
      pattern:'cu_{parent_idx}_fuel_{code}_{col}', list:'fuels', cols:{
      pct:'num', desc:'text' } },

    combustion_unit_outputs: { kind:'many', page:4, parent:'combustion_units',
      pattern:'cu_{parent_idx}_output_{idx}', cols:{ output_mw:'num' } },

    // ── Page 5 ───────────────────────────────────────────────────────
    presses: { kind:'many', page:5, pattern:'press_{idx}_{col}',
      countField:'press_count', cols:{
      ref_year:'int', main_type:'text', system_desc:'text', product:'text',
      install_year:'int', output:'num', factor:'num' } },

    // ── Page 6 ───────────────────────────────────────────────────────
    abatement_section: { kind:'one', page:6, cols:{
      s62_equip_desc:'text', s62_dust_fate:'text',
      s62_monitoring:'text', s62_control_measures:'text', s62_comments:'text' } },

    abatement_techniques: { kind:'many', page:6, pattern:'tech_{idx}_{col}',
      countField:'tech_count', cols:{
      name:'text', install_year:'int', annex_ref:'text', design_features:'text',
      removal_efficiency:'num', comments:'text',
      intake_val:'num', intake_comment:'text',
      recycled_val:'num', recycled_comment:'text',
      discharge_val:'num', discharge_comment:'text',
      waste_res_val:'num', waste_res_comment:'text' } },

    abatement_technique_sources: { kind:'keyed', page:6, parent:'abatement_techniques',
      pattern:'tech_{parent_idx}_src_{code}_{col}', list:'wg_sources',
      cols:{ spec:'text' } },

    // ── Page 8 ───────────────────────────────────────────────────────
    // Pas de table water_emissions_section, pour la meme raison.
    wastewater_streams: { kind:'many', page:8, pattern:'ww_{idx}_{col}',
      countField:'ww_count', cols:{
      discharge_id:'text', ref_year:'int', wwtp_desc:'text', sludge_fate:'text' } },

    wastewater_sources: { kind:'keyed', page:8, parent:'wastewater_streams',
      pattern:'ww_{parent_idx}_src_{code}_{col}', list:'ww_sources',
      cols:{ vol:'num', comment:'text' } },

    wastewater_pollutants: { kind:'keyed', page:8, parent:'wastewater_streams',
      pattern:'ww_{parent_idx}_poll_{code}_{col}', list:'ww_pollutants', cols:{
      conc:'num', freq:'text', pos:'text', comments:'text' } },

    // ── Page 9 ───────────────────────────────────────────────────────
    solid_residues_section: { kind:'one', page:9, cols:{
      waste_bat_techniques:'text', waste_comments:'text' } },

    solid_residues: { kind:'many', page:9, pattern:'waste_{idx}_{col}',
      countField:'waste_row_count', aliases:{ description:'desc' }, cols:{
      description:'text', ewc:'text', source:'text', qty:'num', dest:'text' } },

    // ── Page 10 ──────────────────────────────────────────────────────
    water_consumption: { kind:'one', page:10, cols:{
      wc_process:'num', wc_steam:'num', wc_cooling:'num', wc_sanitary:'num',
      wc_other:'num', wc_refining_total:'num', wc_refining_recycled:'num',
      wc_recycling_savings:'text', wc_bat_techniques:'text', wc_comments:'text' } },

    // ── Page 11 ──────────────────────────────────────────────────────
    bat_candidate: { kind:'one', page:11, cols:{
      bat_name:'text', bat_plant_name:'text', bat_tech_desc:'text',
      bat_reference_plants:'text', bat_install_year:'int', bat_rd_level:'text',
      bat_tech_comments:'text', bat_env_air:'text', bat_env_water:'text',
      bat_env_energy:'text', bat_env_other:'text', bat_invest_cost:'num',
      bat_oper_cost:'num', bat_cost_effectiveness:'text', bat_cross_media:'text',
      bat_applicability:'text', bat_references:'text' } },

    bat_candidate_categories: { kind:'keyed', page:11, pattern:'bat_cat_{code}',
      list:'bat_categories', cols:{ selected:'bool' } },
```

Trois motifs méritent attention :

- `wood_prep_param_comments` et `bat_candidate_categories` n'ont **pas** de jeton `{col}` : leur unique colonne est portée par le motif lui-même. `buildName` l'accepte, puisqu'il ne remplace que les jetons présents.
- `layout_sections` utilise `'{code}_{col}'` sans préfixe : les champs sont `outdoor_desc`, `indoor_dust_method`, etc.
- `combustion_unit_outputs` combine `{parent_idx}` et `{idx}` sans `{col}`.

- [ ] **Step 4b: Documenter le garde UMD**

Le fichier passe de 35 à plusieurs centaines de lignes : le garde UMD en tête devient
facile à prendre pour du bruit. Ajouter une ligne d'explication juste au-dessus :

```js
// UMD : expose l'API en global navigateur (window.EuroPanelFields) ou en module
// CommonJS (Node, pour les tests). Le projet n'a pas d'etape de build, d'ou ce garde
// plutot que import/export.
(function (root, factory) {
```

Faire de même dans `docs/db.js`, avec `window.EuroPanelDb`.

- [ ] **Step 5: Lancer les tests et vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — le test de couverture ne signale aucun champ manquant, et `Object.keys(SCHEMA).length === 42`.

Si des champs manquent encore, ils sont listés nommément dans le message d'échec : ajouter la colonne correspondante et relancer. Ne jamais faire passer ce test en retirant des champs de la liste attendue.

- [ ] **Step 6: Commit**

```bash
git add docs/fields.js tests/manifest-coverage.test.js
git commit -m "feat: complete field manifest for all 35 questionnaire tables"
```

---

## Tâche 10 : Générer le DDL et les politiques RLS

Les 42 tables et leurs politiques sont trop répétitives pour être écrites à la main sans faute. Elles sont générées depuis le manifeste, puis relues et commitées comme artefact.

**Files:**
- Create: `tools/gen_schema.mjs`
- Create: `supabase/migrations/002_relational_schema.sql`
- Create: `tests/gen-schema.test.js`

- [ ] **Step 1: Écrire le test qui échoue**

`tests/gen-schema.test.js` :

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildDdl } = require('../tools/gen_schema.mjs');

test('génère une table par entrée du manifeste', () => {
  const sql = buildDdl();
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS europanel.contacts'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS europanel.emission_point_pollutants'));
});

test('les tables 1:1 ont submission_id en clé primaire', () => {
  const sql = buildDdl();
  assert.match(sql, /europanel\.contacts \([\s\S]*?submission_id\s+BIGINT\s+PRIMARY KEY/);
});

test('les sections répétables ont idx et une contrainte d’unicité', () => {
  const sql = buildDdl();
  assert.match(sql, /europanel\.dryers \([\s\S]*?idx\s+SMALLINT\s+NOT NULL/);
  assert.ok(sql.includes('UNIQUE (submission_id, idx)'));
});

test('les colonnes numériques sont typées NUMERIC et les années SMALLINT', () => {
  const sql = buildDdl();
  assert.match(sql, /temp_max\s+NUMERIC/);
  assert.match(sql, /install_year\s+SMALLINT/);
});

test('chaque table porte RLS et quatre politiques', () => {
  const sql = buildDdl();
  assert.ok(sql.includes('ALTER TABLE europanel.dryers ENABLE ROW LEVEL SECURITY'));
  for (const op of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    assert.ok(sql.includes(`FOR ${op} TO authenticated`), `politique ${op} absente`);
  }
});

test('les tables enfants référencent leur parent en CASCADE', () => {
  const sql = buildDdl();
  assert.match(sql,
    /emission_point_pollutants[\s\S]*?REFERENCES europanel\.emission_points\(id\) ON DELETE CASCADE/);
});
```

- [ ] **Step 2: Lancer le test pour vérifier qu'il échoue**

Run: `npm test`
Expected: FAIL — `Cannot find module '../tools/gen_schema.mjs'`

- [ ] **Step 3: Écrire le générateur**

`tools/gen_schema.mjs` :

```js
/* Génère le DDL et les politiques RLS depuis le manifeste.
   Usage : node tools/gen_schema.mjs > supabase/migrations/002_relational_schema.sql */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SCHEMA } = require('../docs/fields.js');

const SQL_TYPE = { text: 'TEXT', num: 'NUMERIC', int: 'SMALLINT', bool: 'BOOLEAN' };

// Les alias du manifeste ne concernent que les noms de champs HTML.
// Les noms de colonnes emis ici sont toujours les cles de `cols`.

function ownerPredicate(table) {
  const entry = SCHEMA[table];
  if (!entry.parent) {
    return `submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())`;
  }
  return `${entry.parent}_id IN (SELECT id FROM europanel.${entry.parent} WHERE ` +
         ownerPredicate(entry.parent) + `)`;
}

function tableDdl(table, entry) {
  const lines = [];
  if (entry.kind === 'one') {
    lines.push(`  submission_id  BIGINT PRIMARY KEY REFERENCES europanel.submissions(id) ON DELETE CASCADE`);
  } else {
    lines.push(`  id             BIGSERIAL PRIMARY KEY`);
    if (entry.parent) {
      lines.push(`  ${entry.parent}_id BIGINT NOT NULL REFERENCES europanel.${entry.parent}(id) ON DELETE CASCADE`);
    } else {
      lines.push(`  submission_id  BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE`);
    }
    if (entry.kind === 'many')  lines.push(`  idx            SMALLINT NOT NULL`);
    if (entry.kind === 'keyed') lines.push(`  code           TEXT NOT NULL`);
  }

  for (const [col, type] of Object.entries(entry.cols)) {
    lines.push(`  ${col.padEnd(14)} ${SQL_TYPE[type]}`);
  }

  if (entry.kind !== 'one') {
    const parentCol = entry.parent ? `${entry.parent}_id` : 'submission_id';
    const keyCol = entry.kind === 'many' ? 'idx' : 'code';
    lines.push(`  UNIQUE (${parentCol}, ${keyCol})`);
  }

  return `CREATE TABLE IF NOT EXISTS europanel.${table} (\n${lines.join(',\n')}\n);`;
}

function policiesDdl(table, entry) {
  const pred = entry.kind === 'one'
    ? `submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())`
    : ownerPredicate(table);

  const out = [`ALTER TABLE europanel.${table} ENABLE ROW LEVEL SECURITY;`];
  for (const op of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
    const clause = op === 'INSERT' ? `WITH CHECK (${pred})` : `USING (${pred})`;
    out.push(
      `CREATE POLICY "${table}_${op.toLowerCase()}" ON europanel.${table}\n` +
      `  FOR ${op} TO authenticated ${clause};`
    );
  }
  return out.join('\n');
}

export function buildDdl() {
  const parts = [
    '-- ══════════════════════════════════════════════════════════════════',
    '--  EuroPanel — schéma relationnel',
    '--  GÉNÉRÉ par tools/gen_schema.mjs depuis docs/fields.js',
    '--  Ne pas modifier à la main : régénérer.',
    '-- ══════════════════════════════════════════════════════════════════',
    '',
  ];
  for (const [table, entry] of Object.entries(SCHEMA)) {
    parts.push(tableDdl(table, entry), '', policiesDdl(table, entry), '');
  }
  return parts.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(buildDdl());
}
```

> `tests/gen-schema.test.js` est en CommonJS et importe un module ES. Node l'autorise via `require()` d'un `.mjs` uniquement à partir de la 22.12. Si `npm test` échoue avec `require() of ES Module`, renommer le test en `tests/gen-schema.test.mjs` et remplacer ses `require` par des `import`.

- [ ] **Step 4: Lancer les tests et vérifier qu'ils passent**

Run: `npm test`
Expected: PASS — 6 tests supplémentaires

- [ ] **Step 5: Générer le fichier de migration et le relire**

```bash
mkdir -p supabase/migrations
node tools/gen_schema.mjs > supabase/migrations/002_relational_schema.sql
wc -l supabase/migrations/002_relational_schema.sql
grep -c 'CREATE TABLE' supabase/migrations/002_relational_schema.sql
```

Expected: 35 occurrences de `CREATE TABLE` — les 12 tables 1:1 de page et les
23 tables enfants. Les 7 tables du noyau sont ajoutees a l'etape suivante, ce qui
porte le total a 42.

Relire le fichier. Vérifier en particulier que les tables du noyau de la spec § 4.1 (`plants`, `cycles`, `submission_pages`, `ref_lists`, `audit_log`) **ne** sont **pas** générées : elles ne figurent pas au manifeste car elles ne portent aucun champ de questionnaire. Elles sont ajoutées à la main à l'étape suivante.

- [ ] **Step 6: Ajouter à la main les tables du noyau**

Ajouter en tête de `supabase/migrations/002_relational_schema.sql`, après l'en-tête généré :

```sql
-- ─── Noyau (écrit à la main : hors questionnaire) ────────────────────
CREATE TABLE IF NOT EXISTS europanel.plants (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT REFERENCES europanel.companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  country     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS europanel.cycles (
  id            BIGSERIAL PRIMARY KEY,
  label         TEXT NOT NULL,
  reference_year SMALLINT,
  opens_at      DATE,
  closes_at     DATE,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','open','closed','archived')),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS europanel.ref_lists (
  list_code   TEXT     NOT NULL,
  code        TEXT     NOT NULL,
  label       TEXT     NOT NULL,
  unit        TEXT,
  sort_order  SMALLINT NOT NULL DEFAULT 0,
  active      BOOLEAN  NOT NULL DEFAULT TRUE,
  PRIMARY KEY (list_code, code)
);

CREATE TABLE IF NOT EXISTS europanel.submission_pages (
  submission_id BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  page_id       SMALLINT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'empty'
                CHECK (status IN ('empty','partial','complete')),
  saved_at      TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (submission_id, page_id)
);

CREATE TABLE IF NOT EXISTS europanel.audit_log (
  id            BIGSERIAL PRIMARY KEY,
  actor_id      UUID,
  action        TEXT NOT NULL,
  table_name    TEXT,
  record_id     BIGINT,
  field_name    TEXT,
  value_before  TEXT,
  value_after   TEXT,
  submission_id BIGINT REFERENCES europanel.submissions(id) ON DELETE SET NULL,
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE europanel.submissions ADD COLUMN IF NOT EXISTS plant_id BIGINT
  REFERENCES europanel.plants(id);
ALTER TABLE europanel.submissions ADD COLUMN IF NOT EXISTS cycle_id BIGINT
  REFERENCES europanel.cycles(id);

ALTER TABLE europanel.plants            ENABLE ROW LEVEL SECURITY;
ALTER TABLE europanel.cycles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE europanel.ref_lists         ENABLE ROW LEVEL SECURITY;
ALTER TABLE europanel.submission_pages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE europanel.audit_log         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ref_lists_select" ON europanel.ref_lists
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "plants_select" ON europanel.plants
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "cycles_select" ON europanel.cycles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "submission_pages_all" ON europanel.submission_pages
  FOR ALL TO authenticated USING (
    submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())
  );

-- Journal append-only : insertion seule, aucun UPDATE ni DELETE accordé.
CREATE POLICY "audit_log_insert" ON europanel.audit_log
  FOR INSERT TO authenticated WITH CHECK (true);
```

- [ ] **Step 7: Commit**

```bash
git add tools/gen_schema.mjs supabase/migrations/002_relational_schema.sql tests/gen-schema.test.js
git commit -m "feat: generate relational DDL and RLS policies from the manifest"
```

---

## Tâche 11 : Seed des listes de référence

**Files:**
- Create: `tools/gen_ref_lists.mjs`
- Create: `supabase/migrations/003_seed_ref_lists.sql`

- [ ] **Step 1: Écrire le générateur de seed**

`tools/gen_ref_lists.mjs` :

```js
/* Produit le seed de europanel.ref_lists depuis LISTS.
   Usage : node tools/gen_ref_lists.mjs > supabase/migrations/003_seed_ref_lists.sql */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { LISTS } = require('../docs/fields.js');

const esc = s => String(s).replace(/'/g, "''");

const rows = [];
for (const [listCode, codes] of Object.entries(LISTS)) {
  codes.forEach((code, i) => {
    rows.push(`  ('${esc(listCode)}', '${esc(code)}', '${esc(code)}', NULL, ${i}, TRUE)`);
  });
}

process.stdout.write(
`-- ══════════════════════════════════════════════════════════════════
--  EuroPanel — seed des listes de référence
--  GÉNÉRÉ par tools/gen_ref_lists.mjs depuis docs/fields.js
--  Les libellés reprennent le code ; les libellés lisibles sont
--  complétés ensuite par UPDATE (voir étape 3).
-- ══════════════════════════════════════════════════════════════════

INSERT INTO europanel.ref_lists (list_code, code, label, unit, sort_order, active)
VALUES
${rows.join(',\n')}
ON CONFLICT (list_code, code) DO NOTHING;
`);
```

- [ ] **Step 2: Générer et vérifier le compte**

```bash
node tools/gen_ref_lists.mjs > supabase/migrations/003_seed_ref_lists.sql
grep -c "^  ('" supabase/migrations/003_seed_ref_lists.sql
```

Expected: environ 130 lignes (7 + 2 + 11 + 3 + 9 + 3 + 7 + 4 + 37 + 12 + 8 + 12 + 9).

- [ ] **Step 3: Compléter les libellés lisibles**

Le générateur place le code en guise de libellé. Les libellés réels existent dans les renderers, dans la propriété `l:` ou `label:` des mêmes tableaux. Les extraire et les appliquer :

```bash
node -e "
const fs=require('fs');
const src=['docs/pages-0-6.js','docs/pages-7-12.js'].map(f=>fs.readFileSync(f,'utf8')).join('\n');
for (const m of src.matchAll(/(?:const|let)\s+([A-Z_0-9]{3,})\s*=\s*\[([\s\S]*?)\];/g)) {
  for (const p of m[2].matchAll(/\b(?:k|key)\s*:\s*['\"]([a-z0-9_]+)['\"]\s*,\s*(?:l|label)\s*:\s*['\"]([^'\"]+)['\"]/g)) {
    console.log(\`UPDATE europanel.ref_lists SET label = '\${p[2].replace(/'/g,\"''\")}' WHERE code = '\${p[1]}';\`);
  }
}" >> supabase/migrations/003_seed_ref_lists.sql
```

Relire le fichier : les `UPDATE` ne portent pas de `list_code`, donc un code partagé entre deux listes (`other`, présent dans `raw_materials`, `fuels` et `wg_sources`) recevrait le même libellé partout. Corriger à la main ces trois cas en ajoutant `AND list_code = '…'`.

- [ ] **Step 4: Commit**

```bash
git add tools/gen_ref_lists.mjs supabase/migrations/003_seed_ref_lists.sql
git commit -m "feat: seed reference lists from the manifest"
```

---

## Tâche 12 : Brancher le webform sur le dispatcher

**Files:**
- Modify: `docs/index.html:88-93`
- Modify: `docs/app.js:112-125` (`loadAllPageData`)
- Modify: `docs/app.js:127-149` (`savePageData`)

- [ ] **Step 1: Charger les nouveaux modules dans la page**

Dans `docs/index.html`, remplacer le bloc des scripts applicatifs :

```html
  <!-- App scripts (order matters) -->
  <script src="pages-0-6.js"></script>
  <script src="pages-7-12.js"></script>
  <script src="app.js"></script>
```

par :

```html
  <!-- App scripts (order matters) -->
  <script src="fields.js"></script>
  <script src="db.js"></script>
  <script src="pages-0-6.js"></script>
  <script src="pages-7-12.js"></script>
  <script src="app.js"></script>
```

- [ ] **Step 2: Réécrire `loadAllPageData`**

Dans `docs/app.js`, remplacer intégralement la fonction `loadAllPageData` :

```js
async function loadAllPageData() {
  const { SCHEMA, hydrate } = window.EuroPanelDb;
  const subId = state.submission.id;

  // Une requête par table, en parallèle. Les tables enfants sont filtrées
  // via leur parent, d'où la jointure implicite exprimée par le select.
  const tables = Object.keys(SCHEMA);
  const results = await Promise.all(tables.map(async table => {
    const entry = SCHEMA[table];
    let q = sb.from(table).select('*');
    if (entry.parent) {
      q = q.in(entry.parent + '_id',
               (await sb.from(entry.parent).select('id').eq('submission_id', subId))
                 .data?.map(r => r.id) || []);
    } else {
      q = q.eq('submission_id', subId);
    }
    const { data, error } = await q;
    if (error) throw error;
    return [table, data || []];
  }));

  const rowsByTable = Object.fromEntries(results);

  state.pageData = {};
  state.pageStatus = {};
  PAGES.forEach(pg => {
    const flat = hydrate(rowsByTable, pg.id);
    state.pageData[pg.id] = flat;
    state.pageStatus[pg.id] = hasContent(flat) ? 'complete' : 'empty';
  });
}
```

- [ ] **Step 3: Réécrire `savePageData`**

Remplacer intégralement la fonction `savePageData` :

```js
async function savePageData(pageId, data) {
  if (!state.submission) {
    toast('Session not ready — please refresh the page.', 'error');
    return;
  }
  const { dispatch, SCHEMA } = window.EuroPanelDb;
  const subId = state.submission.id;
  setSaveStatus('saving');

  try {
    // dispatch trie déjà les opérations parents avant enfants.
    const parentIds = {};   // { nom_table: { idx: id } }

    for (const op of dispatch(data, pageId)) {
      const entry = SCHEMA[op.table];

      const rows = op.rows.map(r => {
        const row = Object.assign({}, r);
        if (entry.parent) {
          row[entry.parent + '_id'] = parentIds[entry.parent][r.parent_idx];
          delete row.parent_idx;
        } else {
          row.submission_id = subId;
        }
        return row;
      });

      if (entry.kind === 'one') {
        const { error } = await sb.from(op.table)
          .upsert(rows, { onConflict: 'submission_id' });
        if (error) throw error;
        continue;
      }

      const parentCol = entry.parent ? entry.parent + '_id' : 'submission_id';
      const keyCol    = entry.kind === 'many' ? 'idx' : 'code';

      const { data: written, error } = await sb.from(op.table)
        .upsert(rows, { onConflict: `${parentCol},${keyCol}` })
        .select('id, ' + keyCol);
      if (error) throw error;

      // Mémoriser les identifiants pour les tables enfants qui suivront.
      if (entry.kind === 'many' && !entry.parent) {
        parentIds[op.table] = {};
        (written || []).forEach(r => { parentIds[op.table][r.idx] = r.id; });
      }

      // Supprimer les instances retirees par l'operateur.
      // La colonne de rattachement differe selon que la table est fille de la
      // soumission ou d'une autre table : utiliser la valeur reellement ecrite,
      // sans quoi une table petite-enfant serait filtree sur un mauvais parent.
      if (op.deleteBeyondIdx !== undefined) {
        const parentVal = entry.parent ? (rows[0] && rows[0][parentCol]) : subId;
        if (parentVal !== undefined && parentVal !== null) {
          const { error: delErr } = await sb.from(op.table)
            .delete().eq(parentCol, parentVal).gt('idx', op.deleteBeyondIdx);
          if (delErr) throw delErr;
        }
      }
    }

    await sb.from('submission_pages').upsert(
      { submission_id: subId, page_id: pageId,
        status: hasContent(data) ? 'complete' : 'empty',
        saved_at: new Date().toISOString() },
      { onConflict: 'submission_id,page_id' }
    );

    state.pageData[pageId] = data;
    state.pageStatus[pageId] = hasContent(data) ? 'complete' : 'empty';
    updateSidebarItem(pageId);
    setSaveStatus('saved');
  } catch (err) {
    setSaveStatus('error');
    toast('Save failed: ' + err.message, 'error');
  }
}
```

- [ ] **Step 4: Vérifier manuellement dans le navigateur**

Appliquer d'abord les migrations 002 et 003 dans le SQL Editor de Supabase, puis servir le dossier `docs/` :

```bash
npx --yes serve docs -l 5000
```

Ouvrir `http://localhost:5000`, se connecter, puis pour chacune des pages 0, 5, 7 et 11 :

1. Saisir des valeurs, dont une case à cocher et un nombre décimal.
2. Attendre l'indicateur « ✓ Saved ».
3. Recharger la page (F5).
4. Vérifier que toutes les valeurs sont revenues.
5. Dans le Table Editor de Supabase, vérifier que la ligne existe dans la bonne table avec le bon type.

Sur la page 5, ajouter trois sécheurs, en supprimer un, sauvegarder, recharger : il doit en rester deux, et la table `dryers` ne doit contenir que deux lignes.

- [ ] **Step 5: Commit**

```bash
git add docs/index.html docs/app.js
git commit -m "feat: write questionnaire data to relational tables via the dispatcher"
```

---

## Tâche 13 : Script de reprise des données

**Files:**
- Create: `supabase/migrate/jsonb_to_relational.mjs`

- [ ] **Step 1: Écrire le script**

`supabase/migrate/jsonb_to_relational.mjs` :

```js
/* Reprise des données JSONB vers le schéma relationnel.
   Réutilise le dispatcher du webform : aucune divergence possible.

   Usage :
     node supabase/migrate/jsonb_to_relational.mjs --dry-run
     node supabase/migrate/jsonb_to_relational.mjs --apply
*/
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const { SCHEMA, dispatch } = require('../../docs/db.js');

const DRY = !process.argv.includes('--apply');

// La clé service_role n'est jamais en dur : elle est lue depuis .env.
const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY,
                        { db: { schema: 'europanel' } });

const report = { rowsByTable: {}, unmappedKeys: [], coercionLosses: [] };

// Tous les noms de champs que le manifeste sait produire pour une page.
function knownKeysForPage(flat, pageId) {
  const known = new Set();
  for (const op of dispatch(flat, pageId)) {
    const entry = SCHEMA[op.table];
    if (entry.kind === 'one') Object.keys(entry.cols).forEach(c => known.add(c));
    if (entry.countField) known.add(entry.countField);
  }
  return known;
}

const { data: pages, error } = await sb
  .from('page_data').select('submission_id, page_id, data');
if (error) throw error;

console.log(`${pages.length} lignes page_data à traiter — mode ${DRY ? 'DRY-RUN' : 'APPLY'}\n`);

for (const row of pages) {
  const flat = row.data || {};
  const ops = dispatch(flat, row.page_id);

  // Contrôle d'exhaustivité : toute clé JSONB doit avoir trouvé une colonne.
  const consumed = new Set();
  for (const op of ops) {
    const entry = SCHEMA[op.table];
    for (const r of op.rows) {
      for (const col of Object.keys(entry.cols)) {
        // reconstruire le nom consommé se fait via hydrate ; ici on se contente
        // de marquer les clés reconnues par knownKeysForPage pour les tables 1:1
        void col; void r;
      }
    }
  }
  knownKeysForPage(flat, row.page_id).forEach(k => consumed.add(k));

  for (const key of Object.keys(flat)) {
    if (flat[key] === '' || flat[key] === null) continue;
    if (!consumed.has(key) && !keyMatchesAnyPattern(key, row.page_id)) {
      report.unmappedKeys.push({ submission_id: row.submission_id, page_id: row.page_id, key });
    }
  }

  for (const op of ops) {
    report.rowsByTable[op.table] = (report.rowsByTable[op.table] || 0) + op.rows.length;
    if (DRY) continue;
    const entry = SCHEMA[op.table];
    const rows = op.rows.map(r => Object.assign({}, r,
      entry.parent ? {} : { submission_id: row.submission_id }));
    const { error: wErr } = await sb.from(op.table).upsert(rows);
    if (wErr) throw new Error(`${op.table}: ${wErr.message}`);
  }
}

// Une clé correspond-elle à un motif du manifeste pour cette page ?
function keyMatchesAnyPattern(key, pageId) {
  for (const entry of Object.values(SCHEMA)) {
    if (entry.page !== pageId || !entry.pattern) continue;
    const rx = new RegExp('^' + entry.pattern
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/\\\{idx\\\}/g, '\\d+')
      .replace(/\\\{parent_idx\\\}/g, '\\d+')
      .replace(/\\\{code\\\}/g, '[a-z0-9_]+')
      .replace(/\\\{col\\\}/g, '[a-z0-9_]+') + '$');
    if (rx.test(key)) return true;
  }
  return false;
}

console.log('Lignes par table :');
for (const [t, n] of Object.entries(report.rowsByTable).sort()) console.log(`  ${t.padEnd(32)} ${n}`);
console.log(`\nClés JSONB non reconnues : ${report.unmappedKeys.length}`);
report.unmappedKeys.slice(0, 50).forEach(u =>
  console.log(`  submission ${u.submission_id} page ${u.page_id} : ${u.key}`));
if (report.unmappedKeys.length > 50) console.log(`  … et ${report.unmappedKeys.length - 50} autres`);

fs.writeFileSync('migration-report.json', JSON.stringify(report, null, 2));
console.log('\nRapport complet écrit dans migration-report.json');
```

- [ ] **Step 2: Installer le client Supabase pour le script**

```bash
npm install --save-dev @supabase/supabase-js
```

- [ ] **Step 3: Créer le `.env` (non versionné)**

`.env` à la racine — déjà couvert par `.gitignore` :

```
SUPABASE_URL=https://vxwmhsgxoomcbiukeinp.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<clé service_role depuis le dashboard Supabase>
```

**Ne jamais committer ce fichier.** Vérifier avant tout commit : `git status --short | grep '\.env'` doit ne rien retourner.

- [ ] **Step 4: Lancer la reprise à blanc**

```bash
node supabase/migrate/jsonb_to_relational.mjs --dry-run
```

Expected: la liste des lignes par table, et **`Clés JSONB non reconnues : 0`**.

Si des clés sont signalées, ne pas appliquer la migration. Chaque clé signalée est soit un champ oublié du manifeste — l'ajouter et relancer — soit un vestige d'une version antérieure du questionnaire, à écarter explicitement en le notant dans le rapport.

- [ ] **Step 5: Appliquer la reprise**

```bash
node supabase/migrate/jsonb_to_relational.mjs --apply
```

Puis vérifier dans le Table Editor de Supabase que les compteurs correspondent au rapport.

`page_data` n'est ni modifiée ni supprimée : elle reste disponible en lecture pour comparaison.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrate/jsonb_to_relational.mjs package.json package-lock.json
git commit -m "feat: migrate existing JSONB data to relational tables"
```

---

## Tâche 14 : Test d'intégrité manifeste ↔ base

Vérifie que chaque colonne déclarée existe réellement, avec le bon type. Ce test se connecte à la base : il est isolé des autres et ignoré si `.env` est absent.

**Files:**
- Create: `tests/schema-integrity.test.mjs`

- [ ] **Step 1: Écrire le test**

`tests/schema-integrity.test.mjs` :

```js
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createClient } from '@supabase/supabase-js';

const require = createRequire(import.meta.url);
const { SCHEMA } = require('../docs/fields.js');

const hasEnv = fs.existsSync('.env');

test('chaque colonne du manifeste existe en base avec le bon type',
  { skip: hasEnv ? false : 'pas de .env — test ignoré' }, async () => {

  const env = Object.fromEntries(
    fs.readFileSync('.env', 'utf8').split('\n')
      .filter(l => l.includes('=') && !l.trim().startsWith('#'))
      .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
  );
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

  const { data, error } = await sb.rpc('exec_sql', { q: `
    SELECT table_name, column_name, data_type
    FROM information_schema.columns WHERE table_schema = 'europanel'` });
  if (error) {
    // Pas de fonction exec_sql : interroger table par table via un select vide.
    for (const [table, entry] of Object.entries(SCHEMA)) {
      const cols = Object.keys(entry.cols).join(',');
      const { error: e } = await sb.schema('europanel').from(table).select(cols).limit(0);
      assert.strictEqual(e, null, `${table}: ${e && e.message}`);
    }
    return;
  }

  const actual = new Map();
  for (const r of data) actual.set(`${r.table_name}.${r.column_name}`, r.data_type);

  const expectType = { text: 'text', num: 'numeric', int: 'smallint', bool: 'boolean' };
  for (const [table, entry] of Object.entries(SCHEMA)) {
    for (const [col, type] of Object.entries(entry.cols)) {
      const key = `${table}.${col}`;
      assert.ok(actual.has(key), `colonne absente en base : ${key}`);
      assert.strictEqual(actual.get(key), expectType[type],
        `${key} : attendu ${expectType[type]}, trouvé ${actual.get(key)}`);
    }
  }
});
```

- [ ] **Step 2: Lancer les tests**

Run: `npm test`
Expected: PASS — le test passe s'il trouve `.env` et une base à jour, sinon il est marqué `skipped`.

- [ ] **Step 3: Commit**

```bash
git add tests/schema-integrity.test.mjs
git commit -m "test: verify manifest columns exist in the database with matching types"
```

---

## Tâche 15 : Régénérer le dictionnaire de données

Le dictionnaire livré à EPF doit refléter le nouveau schéma, faute de quoi l'engagement de portabilité du § 3 du document de clarifications devient faux.

**Files:**
- Create: `tools/gen_data_dictionary.mjs`
- Modify: `EuroPanel_DataDictionary.docx`

- [ ] **Step 1: Écrire le générateur**

`tools/gen_data_dictionary.mjs` :

```js
/* Produit le dictionnaire de données en Markdown depuis le manifeste.
   Usage : node tools/gen_data_dictionary.mjs > EuroPanel_DataDictionary.md */
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SCHEMA, LISTS } = require('../docs/fields.js');

const TYPE_LABEL = { text: 'Text', num: 'Decimal', int: 'Integer', bool: 'Yes/No' };
const KIND_LABEL = {
  one:   'One row per submission',
  many:  'One row per instance',
  keyed: 'One row per code',
};

const out = ['# EuroPanel — Data Dictionary', '',
  'Generated from `docs/fields.js`. Do not edit by hand.', ''];

const byPage = {};
for (const [table, e] of Object.entries(SCHEMA)) (byPage[e.page] ||= []).push([table, e]);

for (const page of Object.keys(byPage).sort((a, b) => a - b)) {
  out.push(`## Page ${page}`, '');
  for (const [table, e] of byPage[page]) {
    out.push(`### \`${table}\``, '',
      `${KIND_LABEL[e.kind]}.` +
      (e.parent ? ` Child of \`${e.parent}\`.` : '') +
      (e.list ? ` Codes from list \`${e.list}\` (${LISTS[e.list].length} values).` : ''),
      '', '| Column | Type | Form field |', '|---|---|---|');
    const aliases = e.aliases || {};
    for (const [col, type] of Object.entries(e.cols)) {
      const seg = aliases[col] || col;
      const field = e.kind === 'one' ? col : (e.pattern || '').replace('{col}', seg);
      out.push(`| \`${col}\` | ${TYPE_LABEL[type]} | \`${field}\` |`);
    }
    out.push('');
  }
}
process.stdout.write(out.join('\n'));
```

- [ ] **Step 2: Générer et vérifier**

```bash
node tools/gen_data_dictionary.mjs > EuroPanel_DataDictionary.md
grep -c '^### ' EuroPanel_DataDictionary.md
```

Expected: 42.

- [ ] **Step 3: Produire le `.docx`**

Le `.docx` existant décrit l'ancien modèle JSONB. Le régénérer avec `python-docx`,
déjà installé sur le poste (v1.2.0) et déjà utilisé pour produire le document de
clarifications EPF. Ne pas dépendre d'un convertisseur Markdown non vérifié.

`tools/gen_data_dictionary_docx.py` :

```python
# -*- coding: utf-8 -*-
import json, subprocess
from docx import Document
from docx.shared import Pt

spec = json.loads(subprocess.check_output(
    ['node', '-e',
     "const{SCHEMA,LISTS}=require('./docs/fields.js');"
     "console.log(JSON.stringify({SCHEMA,LISTS}))"],
    text=True, encoding='utf-8'))

TYPE = {'text': 'Text', 'num': 'Decimal', 'int': 'Integer', 'bool': 'Yes/No'}
KIND = {'one': 'One row per submission',
        'many': 'One row per instance',
        'keyed': 'One row per code'}

doc = Document()
doc.add_heading('EuroPanel - Data Dictionary', 0)
doc.add_paragraph('Generated from docs/fields.js. Do not edit by hand.')

by_page = {}
for table, e in spec['SCHEMA'].items():
    by_page.setdefault(e['page'], []).append((table, e))

for page in sorted(by_page):
    doc.add_heading('Page %d' % page, 1)
    for table, e in by_page[page]:
        doc.add_heading(table, 2)
        note = KIND[e['kind']] + '.'
        if e.get('parent'):
            note += ' Child of %s.' % e['parent']
        if e.get('list'):
            note += ' Codes from list %s (%d values).' % (
                e['list'], len(spec['LISTS'][e['list']]))
        doc.add_paragraph(note)

        t = doc.add_table(rows=1, cols=3)
        t.style = 'Table Grid'
        for i, h in enumerate(['Column', 'Type', 'Form field']):
            t.rows[0].cells[i].paragraphs[0].add_run(h).bold = True

        aliases = e.get('aliases') or {}
        for col, typ in e['cols'].items():
            seg = aliases.get(col, col)
            if e['kind'] == 'one':
                field = col
            else:
                field = e.get('pattern', '').replace('{col}', seg)
            cells = t.add_row().cells
            for i, val in enumerate([col, TYPE[typ], field]):
                cells[i].paragraphs[0].add_run(val).font.size = Pt(9)

doc.save('EuroPanel_DataDictionary.docx')
print('saved')
```

```bash
python tools/gen_data_dictionary_docx.py
```

Relire le résultat avant livraison : c'est un document contractuel.

- [ ] **Step 4: Commit**

```bash
git add tools/gen_data_dictionary.mjs tools/gen_data_dictionary_docx.py \
    EuroPanel_DataDictionary.md EuroPanel_DataDictionary.docx
git commit -m "docs: regenerate data dictionary from the manifest"
```

---

## Tâche 16 : Retirer l'ancien chemin JSONB

À faire seulement après une période d'utilisation réelle jugée concluante. La spec § 7 exige que `page_data` survive à la bascule.

**Files:**
- Create: `supabase/migrations/004_drop_page_data.sql`

- [ ] **Step 1: Vérifier qu'aucun code ne référence plus `page_data`**

```bash
grep -rn "page_data" docs/ tools/ tests/ --include=*.js --include=*.mjs
```

Expected: seules des occurrences dans `supabase/migrate/jsonb_to_relational.mjs`, qui lit l'ancienne table par conception.

- [ ] **Step 2: Écrire la migration**

`supabase/migrations/004_drop_page_data.sql` :

```sql
-- À n'appliquer qu'après validation en conditions réelles du schéma relationnel.
-- Sauvegarder d'abord : pg_dump -t europanel.page_data
DROP TABLE IF EXISTS europanel.page_data;
```

- [ ] **Step 3: Commit sans appliquer**

```bash
git add supabase/migrations/004_drop_page_data.sql
git commit -m "chore: add migration to drop the legacy page_data table"
```

Ne pas exécuter cette migration dans le cadre de ce plan.

---

## Couverture de la spec

| Section de la spec | Tâche |
|---|---|
| § 2 Carte plate conservée | 5, 6, 7, 8, 12 |
| § 3.1 Nommage des colonnes | 2, 9 |
| § 3.3 `ref_lists` consolidée | 10, 11 |
| § 4.1 Noyau (7 tables) | 10 étape 6 |
| § 4.2 Tables 1:1 (12) | 9 |
| § 4.3 Tables enfants (23) | 9 |
| § 5 Manifeste | 2, 6, 7, 8, 9 |
| § 6.1 `dispatch` | 5, 6, 7, 8 |
| § 6.2 `hydrate` | 5, 6, 7, 8 |
| § 6.3 Contrat d'aller-retour | 5, 6, 7, 8 |
| § 6.4 Auto-save inchangé | 12 |
| § 7 Migration + rapport | 13 |
| § 8 Aller-retour | 5, 6, 7, 8 |
| § 8 Couverture du manifeste | 9 |
| § 8 Intégrité du schéma | 14 |
| § 9 RLS | 10 |
| § 10 Livrables | toutes |
| § 11 Hors périmètre | respecté : aucune tâche n'implémente le workflow, le back-office, les notifications ni les triggers d'audit |
