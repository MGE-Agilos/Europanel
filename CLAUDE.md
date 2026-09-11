# EuroPanel — accès et procédures

Ce fichier existe pour qu'une session qui reprend le projet à froid n'ait pas
à redécouvrir comment se connecter à quoi. Il ne contient **aucun secret** :
seulement les noms des variables, les chemins, et les pièges qui ont déjà
coûté du temps.

Trois systèmes : **Supabase** (la base du questionnaire), **Qlik Cloud** (le
tableau de bord), **GitHub** (le dépôt et les pages publiées).

---

## Supabase

**Clés** : `.env` à la racine, ignoré par git.

```
SUPABASE_URL=…
SUPABASE_SERVICE_ROLE_KEY=…
```

**Lecture** : ne pas réécrire un parseur. `parseEnv` et `loadEnv` sont
exportés par [supabase/seed/demo_data.mjs](supabase/seed/demo_data.mjs) et
échouent franchement sur une clé absente, sans valeur par défaut.

```js
import { loadEnv } from './supabase/seed/demo_data.mjs';
const env = loadEnv();
const { createClient } = await import('@supabase/supabase-js');
const c = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: 'europanel' },              // le schéma n'est PAS public
  auth: { persistSession: false, autoRefreshToken: false },
});
```

**PostgREST plafonne à 1000 lignes par requête et ne signale pas qu'il
tronque.** Un `select()` nu sur une table plus longue rend 1000 lignes et
paraît avoir réussi. Paginer avec `.range(from, from + 999)` jusqu'à une page
incomplète.

**Scripts de données** — chacun tient un registre des identifiants qu'il a
posés, seul moyen de défaire son travail :

| Script | Registre | Rôle |
|---|---|---|
| `supabase/seed/demo_data.mjs --apply` | `.demo-seed-ids.json` | pose le jeu de démonstration (59 sites, 237 soumissions) |
| `supabase/seed/demo_data_cleanup.mjs --apply --ledger <fichier>` | — | défait une vague |
| `supabase/seed/purge_pre_seed_rows.mjs --apply` | sauvegarde JSON préalable | retire ce qui n'est dans aucun registre |

Tous acceptent un mode à blanc (défaut, ou `--dry-run`). `purge_pre_seed_rows`
a déjà été refusé par le bac à sable de Claude Code — dans ce cas, le
demander à l'utilisateur plutôt que de chercher un contournement.

---

## Qlik Cloud

**Tenant et application** : dans [qlik/shots.json](qlik/shots.json), pas en
dur dans le code. Les outils du dépôt s'en servent tous.

**Clé API** : variable d'environnement **système** `QlikCloudTraining`.

Une variable système ne parvient pas à un processus déjà lancé. Un terminal
ou un VS Code ouvert avant sa création ne la voit pas. D'où, en PowerShell,
avant toute commande Qlik :

```powershell
$env:QLIK_API_KEY = [Environment]::GetEnvironmentVariable('QlikCloudTraining','Machine')
```

Les outils acceptent aussi `--key-env <NOM>` et, en dernier recours,
`QLIK_API_KEY` dans `.env`. **Ne jamais imprimer la clé** : l'injecter dans
l'environnement du processus fils, jamais dans une sortie de terminal.

### Trois voies d'accès, et ce que chacune sait faire

| | Lire | Créer | **Modifier l'existant** |
|---|---|---|---|
| Connecteur MCP | oui | feuilles, graphiques, filtres | **non** |
| API REST | métadonnées, rendus, fichiers, rechargements | oui | partiellement |
| Engine API | tout | tout | **oui** |

**C'est la colonne de droite qui décide.** Le connecteur MCP ne sait pas
changer le titre d'un graphique existant, ni la dimension qu'il utilise. Dès
qu'il faut toucher à un objet déjà là, c'est l'Engine.

### Connecteur MCP

Pratique pour explorer : `qlik_search`, `qlik_list_sheets`,
`qlik_get_sheet_details`, `qlik_get_chart_data`, `qlik_select_values`,
`qlik_clear_selections`, `qlik_create_data_object` (objet de session, idéal
pour vérifier une expression sans rien poser dans l'app).

`qlik_get_fields` rend un résultat trop gros et l'écrit dans un fichier —
lire ce fichier plutôt que réessayer.

Les sélections MCP **persistent** d'un appel à l'autre. Les effacer avant de
lire des chiffres, sinon on mesure autre chose que ce qu'on croit.

### Engine API (JSON-RPC sur websocket)

[tools/qlik_engine.mjs](tools/qlik_engine.mjs) — client minimal, sans
dépendance : Node 22 fournit un WebSocket natif qui accepte des en-têtes.

```js
import { openEngine } from './tools/qlik_engine.mjs';
const eng = await openEngine(tenant, apiKey, appId);
const { handle, props } = await eng.properties(objectId);
props.title = '…';
await eng.setProperties(handle, props);
await eng.save();        // sans DoSave, la modification meurt avec la session
eng.close();
```

`GetAllInfos` énumère tous les objets ; la disposition d'une feuille est dans
`props.cells` (grille de 24 colonnes : `col`, `row`, `colspan`, `rowspan`).

### Script de chargement

Le script de l'application n'est qu'un **assemblage** : le contenu réel vit
dans quinze fichiers déposés dans « Fichiers de données » de l'espace
Europanel, assemblés par `Must_Include`.

Chaîne complète, jamais à la main :

```powershell
node tools/gen_qlik_load_script.mjs          # docs/fields.js -> qlik/load-script/
node tools/qlik_push_load_script.mjs --reload
```

`Must_Include` et non `Include` : un `Include` au chemin faux ne produit
**aucune** erreur, le rechargement réussit en ayant lu zéro ligne.

**Piège de l'API des fichiers de données** : le `connectionId` doit
accompagner AUSSI un remplacement. Sans lui l'API répond 200 mais range le
fichier dans l'espace **personnel** du porteur de la clé ; les inclusions
cessent de le trouver et le rechargement échoue sur un « file not found » qui
ne dit pas que le fichier a déménagé. Déjà arrivé, déjà corrigé dans l'outil.

### Captures

```powershell
node tools/qlik_export_shots.mjs [--reload] [--fresh] [--only id1,id2]
python tools/pdf_to_png.py docs/demo/shots/pdf docs/demo/shots --dpi 150
```

Le service ne rend **une feuille entière qu'en PDF ou PPTX**, et un **objet
seul qu'en PNG**. Il n'existe pas de PNG de feuille ; d'où la rastérisation
par PyMuPDF (déjà installé dans l'environnement conda).

`--fresh` : le service resservait un rendu déjà produit pour le même
`outputId` tant que les *données* n'avaient pas changé. Après une
modification de disposition, de titre ou de format — qui ne passe pas par un
rechargement — sans `--fresh` on croit la modification perdue.

### Pièges du script Qlik, tous rencontrés

- `CONCATENATE` et `CROSSTABLE` ne se combinent pas (« Illegal combination of
  prefixes »).
- `CROSSTABLE` n'émet **aucune ligne** pour une cellule nulle. `NullAsValue`
  ne suffit pas : la ligne est écartée avant la conversion. Il faut
  `If(IsNull(x), '', x)` sur chaque valeur.
- La concaténation automatique absorbe silencieusement une table dont les
  champs sont identiques à la précédente, en ignorant le nom demandé.
- Une colonne de valeurs hétérogènes finit interprétée comme numérique : la
  chaîne vide s'y affiche `NaN`.
- `Text()` sur une valeur détruit sa part numérique.

---

## GitHub

Dépôt `MGE-Agilos/Europanel`, branche `main`, Pages servies depuis `docs/`.

**Aucune identification n'est enregistrée pour github.com dans ce terminal.**
Un `git push` nu reste suspendu sur une invite qui ne peut pas s'afficher.
Le jeton est dans la variable d'environnement **utilisateur**
`GithubMGEDeploy`.

```powershell
$t = [Environment]::GetEnvironmentVariable('GithubMGEDeploy','User')
$b = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes('x-access-token:' + $t))
git -c http.extraheader="AUTHORIZATION: basic $b" push origin main
```

L'en-tête plutôt que l'URL : le jeton ne s'inscrit pas dans le remote.

**Avant tout push**, relire le diff sortant à la recherche de secrets :

```bash
git diff origin/main..main | grep -inE "eyJ[A-Za-z0-9_-]{10,}|ghp_|service_role|password"
```

Des *noms* de variables (`SUPABASE_SERVICE_ROLE_KEY`) sont attendus ; une
valeur ne l'est jamais.

**Suivre la publication** :

```bash
gh api repos/MGE-Agilos/Europanel/pages/builds --jq '.[0] | {status, commit: .commit[0:7]}'
```

`building` puis `built`, une à deux minutes.

---

## Limites du bac à sable

Certaines actions sont refusées à Claude Code, et il ne faut pas chercher à
les contourner :

- **Lire la valeur** d'une variable d'environnement (« credential
  materialization »). L'injecter dans un processus fils fonctionne et
  respecte l'intention : le secret ne passe jamais par la conversation.
- **Énumérer** les variables d'environnement utilisateur ou machine. Lister
  les *noms* du processus courant passe.
- `purge_pre_seed_rows.mjs` a été refusé (« cloud storage mass delete »),
  même en inventaire. Le faire lancer par l'utilisateur.

---

## Repères

- **Manifeste unique** : `docs/fields.js`. Le schéma de la base, la logique
  de sauvegarde du formulaire et le script Qlik en découlent tous. Une
  correction de champ commence là, jamais dans un fichier généré.
- **Jeu de démonstration** : 59 sites, 33 sociétés, 27 pays, 237 soumissions,
  5 campagnes 2021-2025. Entièrement synthétique.
- **Parcours de démonstration** : [docs/demo/](docs/demo/), publié sur
  GitHub Pages. Ses chiffres sont relevés sur l'application vivante et
  doivent être relus après tout nouveau seed.
- **Prompt technique** pour une IA tierce :
  [docs/demo/technical-prompt.txt](docs/demo/technical-prompt.txt).
- **Les feuilles Qlik ne se reconstruisent pas depuis le dépôt.** Le script
  de chargement, si. Lacune connue.
