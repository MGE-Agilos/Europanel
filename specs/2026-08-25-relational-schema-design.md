# EuroPanel — Migration du stockage JSONB vers un schéma relationnel

**Date :** 2026-08-25
**Statut :** design validé, prêt pour le plan d'implémentation
**Portée :** stockage des données du questionnaire WBP BREF

---

## 1. Contexte et motivation

Le stockage actuel place l'intégralité des réponses d'une page dans une colonne
`JSONB` unique (`europanel.page_data.data`), indexée par `(submission_id, page_id)`.
Ce choix a permis de construire le questionnaire sans migration de schéma à chaque
ajout de champ, mais il présente trois limites qui deviennent bloquantes :

1. **Lecture analytique.** Qlik et tout outil tiers doivent parser du JSON et connaître
   la convention de nommage interne pour extraire une valeur. Aucun typage n'est
   disponible : une année, une concentration et un commentaire sont tous des chaînes.
2. **Intégrité.** PostgreSQL ne peut valider ni les types, ni les valeurs autorisées,
   ni les relations. Une faute de frappe dans un nom de champ crée silencieusement une
   nouvelle clé plutôt que de lever une erreur.
3. **Crédibilité contractuelle.** Les engagements pris auprès d'EPF (portabilité,
   export structuré, reprise par un tiers) reposent sur un modèle lisible sans
   l'application. Un dump JSONB satisfait la lettre de l'engagement, pas son esprit.

**Décision :** le webform écrit directement dans des tables métier typées, une colonne
par champ.

**Et il conserve la carte plate brute en JSONB, à côté.** Non par indécision, mais
parce que la couche de correspondance entre le formulaire et les colonnes est un
nouveau point de défaillance silencieux, et que trois défauts de cette classe ont déjà
été trouvés pendant la construction : une colonne dont le nom ne correspondait à aucun
champ réel, seize colonnes absentes de l'inventaire, et des espaces convertis en zéro.

L'asymétrie est ce qui justifie le filet. Qlik a besoin de tables plates dans tous les
cas, donc la correspondance sera écrite de toute façon ; seul son côté change. Une
erreur du côté lecture donne un tableau de bord faux, que l'on corrige en régénérant
depuis la donnée brute toujours présente. Une erreur du côté écriture signifie que la
donnée n'a jamais été capturée : il faut retourner la demander aux entreprises
membres. Sur une collecte réglementaire de trois ans, ce second cas n'est pas
acceptable.

La charge brute rend les tables relationnelles **régénérables à tout moment**, ce qui
retire à toute erreur de correspondance son caractère irréversible.

---

## 2. Principe directeur : la carte plate reste l'interface

Les treize fonctions de rendu (`docs/pages-0-6.js`, `docs/pages-7-12.js`, ~110 KB)
lisent et écrivent une carte plate `{nom_champ: valeur}` via l'accesseur
`v(data, 'contact_email')`. Le collecteur de `app.js` produit cette même carte en
parcourant les attributs `[name]` du DOM.

**Cette carte plate est conservée comme représentation en mémoire.** Un *dispatcher*
la traduit vers les tables à l'écriture, et la reconstruit depuis les tables à la
lecture.

```
renderers  ⇄  état plat {nom: valeur}  ⇄  dispatcher + manifeste  ⇄  ~40 tables
 inchangé          inchangé                    NOUVEAU               NOUVEAU
```

Conséquence : **aucun renderer n'est modifié**. Le changement est circonscrit à
`app.js` (chemins save/load), à un nouveau module `fields.js` (le manifeste), et au
SQL. C'est ce qui rend la migration réalisable sans réécrire le questionnaire.

### 2.1 Le filet : la charge brute

À chaque sauvegarde, le webform écrit deux choses dans la même opération :

1. les lignes des tables métier, produites par le dispatcher ;
2. la carte plate brute, telle que `collectFormData()` l'a produite, dans
   `submission_pages.raw`.

La charge brute n'est jamais lue par l'application en fonctionnement normal — les
renderers sont alimentés depuis les tables, comme prévu. Elle sert à trois choses :

- **Régénérer.** `submission_pages.raw` → `dispatch()` → tables. Une colonne oubliée
  puis ajoutée au manifeste se rattrape en rejouant la régénération sur l'historique,
  sans rien redemander aux entreprises membres.
- **Prouver.** En cas de contestation d'une valeur par un opérateur, la charge brute
  est ce que le navigateur a réellement envoyé, indépendamment de l'interprétation
  qu'en a faite la couche de correspondance.
- **Rendre la reprise rejouable.** Le script de migration (§ 7) alimente `raw` d'abord,
  puis régénère les tables depuis `raw`. Il devient idempotent : on peut le relancer
  autant de fois que nécessaire pendant la mise au point.

Le coût est négligeable : la base entière fait moins de dix mégaoctets, et la charge
brute d'une soumission complète pèse quelques dizaines de kilooctets.

Ce que le filet ne fait **pas** : il ne dispense pas des tests de couverture du § 8.
Une donnée récupérable mais jamais remarquée reste une donnée perdue. Le filet borne
les conséquences d'une erreur, il ne la détecte pas.

---

## 3. Conventions de schéma

| Règle | Application |
|---|---|
| Schéma | `europanel` (inchangé) |
| Clé primaire | `id BIGSERIAL` sur toutes les tables |
| Table 1:1 de page | `submission_id BIGINT PRIMARY KEY REFERENCES submissions(id)` |
| Section répétable | `idx SMALLINT NOT NULL` + `UNIQUE(parent_id, idx)` |
| Groupe à clés fixes | `code TEXT NOT NULL` + `UNIQUE(parent_id, code)` |
| Suppression | `ON DELETE CASCADE` en chaîne depuis `submissions` |
| Horodatage | `updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()` + trigger, sur **toutes** les tables |
| Types | `NUMERIC` (mesures), `SMALLINT` (années, compteurs), `BOOLEAN` (oui/non), `TEXT` (libre et codes) |
| Listes de valeurs | FK vers `ref_lists(list_code, code)`. **Pas de contrainte `CHECK`** |

### 3.1 Nommage des colonnes

- **Tables 1:1 de page** : le nom de colonne est **identique** au nom du champ HTML
  (`contact_email`, `s43_cold_startups`). Le manifeste pour ces tables se réduit
  à une liste de noms et de types.
- **Tables enfants** : le nom de colonne est le segment `{col}` du motif, débarrassé
  du préfixe et de l'indice (`dryer_3_temp_max` → colonne `temp_max`).

L'horodatage est posé uniformément, y compris sur les tables enfants, plutôt que sur
les seules tables 1:1 et racines. Une asymétrie ici obligerait à se souvenir, pour
chaque table, si elle porte la colonne — et la question se pose précisément au moment
où l'on enquête sur une donnée douteuse.

### 3.2 Pourquoi pas de `CHECK` sur les listes

Les listes de valeurs (37 polluants, 20 types de sécheurs, 14 types de résines…)
évoluent à chaque révision BREF. Une contrainte `CHECK` imposerait une migration de
schéma pour ajouter un polluant. Une clé étrangère vers `ref_lists` permet de l'ajouter
par un `INSERT`. C'est la différence entre le tarif de 240 € par question annoncé à
EPF et une intervention de plusieurs jours.

### 3.3 Les listes de référence sont consolidées

Le code JS contient 27 tableaux `const` de valeurs autorisées (`COUNTRIES`,
`POLLUTANTS`, `DRYER_TYPES`, `WW_POLLS`…). Plutôt que 27 tables de référence, une
table unique :

```sql
CREATE TABLE europanel.ref_lists (
  list_code   TEXT    NOT NULL,   -- 'pollutants', 'dryer_types', 'countries'…
  code        TEXT    NOT NULL,   -- 'nox', 'single', 'Belgium'
  label       TEXT    NOT NULL,
  unit        TEXT,
  sort_order  SMALLINT NOT NULL DEFAULT 0,
  active      BOOLEAN  NOT NULL DEFAULT TRUE,
  PRIMARY KEY (list_code, code)
);
```

Les tables enfants portent une colonne `list_code` figée à la valeur de leur liste,
ce qui permet une clé étrangère composite propre :

```sql
list_code TEXT NOT NULL DEFAULT 'pollutants' CHECK (list_code = 'pollutants'),
FOREIGN KEY (list_code, code) REFERENCES europanel.ref_lists (list_code, code)
```

Une colonne `GENERATED ALWAYS AS ('pollutants') STORED` exprimerait la même contrainte
plus élégamment, et est vraisemblablement valide dans une clé étrangère composite. Elle
n'a pas été retenue parce qu'aucun PostgreSQL n'était disponible pour le vérifier, et
que ce fichier est appliqué à la main sur un projet Supabase réel : une migration qui
échoue à mi-parcours est une mauvaise façon d'apprendre la réponse. Le `CHECK` donne
la même garantie sans poser la question.

Le seed est produit depuis les tableaux JS par script, pas retapé à la main.

---

## 4. Carte des tables

### 4.1 Noyau (7 tables)

| Table | Rôle |
|---|---|
| `companies` | Existante. Société membre. |
| `plants` | **Nouvelle.** Installation. Une société peut en exploiter plusieurs. |
| `cycles` | **Nouvelle.** Cycle de reporting : libellé, période de référence, dates d'ouverture et de clôture, statut. |
| `submissions` | Étendue : `company_id`, `plant_id`, `cycle_id`, `status`, `submitted_at`, `approved_at`. |
| `submission_pages` | Successeure de `page_data` : `(submission_id, page_id, status, raw JSONB, saved_at)`. Porte l'avancement **et** la carte plate brute telle que soumise (§ 2.1). |
| `ref_lists` | Listes de valeurs (§ 3.3). |
| `audit_log` | **Nouvelle.** Journal append-only : acteur, action, table, enregistrement, champ, valeur avant/après, horodatage UTC. |

`plants`, `cycles` et `audit_log` ne sont pas nécessaires au passage en tabulaire.
Ils sont inclus parce que le schéma est refait de toute façon, et qu'ils correspondent
aux engagements pris auprès d'EPF (soumission multi-sites, 3 à 4 cycles par an,
historique d'audit complet). Les ajouter maintenant évite une seconde migration.
**Cette itération crée les tables et les colonnes ; elle n'implémente pas les
fonctionnalités de workflow associées.**

### 4.2 Tables 1:1 de page (10 tables)

| Page | Table | Colonnes |
|---|---|---|
| 0 | `contacts` | 17 — `contact_*` (6), `twg_ms_*` (6), `twg_ngo_*` (5) |
| 1 | `general_info` | 6 — `plant_name`, `production_started`, `location_city`, `location_country`, `company`, `comments` |
| 2 | `plant_layout` | 6 — `s21_comments`, `s22_comments`, `s23_present`, `s23_dust_method`, `s23_monitoring`, `s23_comments` |
| 3 | `raw_materials_section` | 1 — `s32_comments` |
| 4 | `energy_production` | 5 — `s41_diagram_ref`, `s43_cold_startups`, `s43_warm_startups`, `s43_maintenance_desc`, `comments` |
| 5 | `press_dryer_section` | 1 — `comments` |
| 6 | `abatement_section` | 5 — `s62_equip_desc`, `s62_dust_fate`, `s62_monitoring`, `s62_control_measures`, `s62_comments` |
| 9 | `solid_residues_section` | 2 — `waste_bat_techniques`, `waste_comments` |
| 10 | `water_consumption` | 10 — `wc_process`, `wc_steam`, `wc_cooling`, `wc_sanitary`, `wc_other`, `wc_refining_total`, `wc_refining_recycled`, `wc_recycling_savings`, `wc_bat_techniques`, `wc_comments` |
| 11 | `bat_candidate` | 17 — `bat_name`, `bat_plant_name`, `bat_tech_desc`, `bat_reference_plants`, `bat_install_year`, `bat_rd_level`, `bat_tech_comments`, `bat_env_*` (4), `bat_invest_cost`, `bat_oper_cost`, `bat_cost_effectiveness`, `bat_cross_media`, `bat_applicability`, `bat_references` |

La page 12 (Review & Submit) ne porte aucun champ : elle ne produit pas de table.

Les champs `*_count` (`cu_count`, `dryer_count`, `ep_count`…) ne sont **pas** stockés.
Ils sont entièrement dérivables de `COUNT(*)` sur la table enfant, et les stocker
créerait une seconde source de vérité susceptible de diverger de la première. Ils sont
déclarés en `countField` sur l'entrée répétable, et reconstruits à l'hydratation depuis
le nombre de lignes rendues par la base.

Ce choix supprime deux tables qui n'auraient existé que pour porter un entier —
`air_emissions_section` et `water_emissions_section` — et élimine un défaut réel : ces
tables et leur table enfant écrivaient la même clé dans la carte plate à l'hydratation,
si bien que l'ordre de déclaration dans le manifeste décidait silencieusement laquelle
l'emportait. Un compteur périmé pouvait alors ressusciter une instance supprimée par
l'opérateur.

### 4.3 Tables enfants (23 tables)

**Page 1**

| Table | Type | Clé | Colonnes |
|---|---|---|---|
| `products` | répétable | `idx` | `type`, `addinfo`, `qty`, `unit` |
| `other_activities` | à clés | `code` (11) | `label`, `capacity`, `unit` |

Codes `other_activities` : `sawmill`, `glue`, `impreg_paper`, `paper_lam`,
`other_value`, `combustion`, `incineration`, `ww_treatment`, `landfill`,
`other_activities`, `other_specify`.

**Page 2**

| Table | Type | Clé | Colonnes |
|---|---|---|---|
| `wood_prep_operations` | à clés | `code` (3) | 9 — `process_desc`, `prod_t_batch`, `wood_dry`, `airflow`, `chan_air`, `chan_treated`, `emit_limit`, `dust_method`, `monitoring` |
| `wood_prep_param_comments` | à clés | `code` (9) | `comments` |
| `layout_sections` | à clés | `code` (3) | `description`, `dust_method`, `comments` |

La matrice `s22_{col}_{row}` est transposée : trois lignes (`debark`, `chip`,
`other_chip`) et neuf colonnes de paramètres. Les commentaires `s22_comments_{row}`
sont indexés par paramètre et non par opération : ils vont dans une table distincte
plutôt que d'être forcés dans la transposition.

Codes `layout_sections` : `outdoor`, `indoor`, `silos`.

**Page 3**

| Table | Type | Clé | Colonnes |
|---|---|---|---|
| `raw_materials` | à clés | `code` (7) | `specify`, `species`, `source` |
| `resins` | répétable | `idx` | `type`, `comments` |
| `hardeners` | répétable | `idx` | `type`, `comments` |
| `additives` | à clés | `code` (2) | `type`, `comments` |

Codes `raw_materials` : `roundwood`, `vir_forest`, `sawdust`, `ext_prod_res`,
`ext_recycled`, `nonwood`, `other`. Codes `additives` : `wax`, `other_add`.

**Page 4**

| Table | Type | Clé | Colonnes |
|---|---|---|---|
| `combustion_units` | répétable | `idx` | 10 — `thermal_input`, `energy_output`, `general_process`, `equip_type`, `install_year`, `boiler_detail`, `engine_ignition`, `hours_normal`, `hours_special`, `dual_fuel` |
| `combustion_unit_fuels` | à clés, enfant de CU | `code` (7) | `pct`, `description` |
| `combustion_unit_outputs` | répétable, enfant de CU | `idx` | `output_mw` |

Codes `combustion_unit_fuels` : `prod_res`, `liquid`, `natgas`, `rec_ext`,
`rec_waste`, `biomass`, `other`.

**Page 5**

| Table | Type | Clé | Colonnes |
|---|---|---|---|
| `dryers` | répétable | `idx` | 11 — `ref_year`, `main_type`, `system_desc`, `product`, `install_year`, `temp_min`, `temp_max`, `product_dried`, `drying_rate`, `residence_val`, `residence_unit` |
| `presses` | répétable | `idx` | 7 — `ref_year`, `main_type`, `system_desc`, `product`, `install_year`, `output`, `factor` |

**Page 6**

| Table | Type | Clé | Colonnes |
|---|---|---|---|
| `abatement_techniques` | répétable | `idx` | 14 — `name`, `install_year`, `annex_ref`, `design_features`, `removal_efficiency`, `comments`, + flux massiques `intake_val`/`intake_comment`, `recycled_val`/`recycled_comment`, `discharge_val`/`discharge_comment`, `waste_res_val`/`waste_res_comment` |
| `abatement_technique_sources` | à clés, enfant | `code` (4) | `spec` |

Les quatre flux massiques (`intake`, `recycled`, `discharge`, `waste_res`) restent en
colonnes larges : la liste est courte et stable, contrairement aux polluants.
Codes `abatement_technique_sources` : `dryer`, `press`, `paper`, `other`.

**Page 7**

| Table | Type | Clé | Colonnes |
|---|---|---|---|
| `emission_points` | répétable | `idx` | 5 + 12 — `ep_id`, `ref_year`, `refcond`, `waste_gas_desc`, `comments`, puis les 12 paramètres de gaz : `cross_section`, `air_pressure`, `temp_dry`, `temp_wet`, `o2`, `co2`, `co_gas`, `inert`, `moisture`, `density_std`, `flow_actual`, `flow_std` |
| `emission_point_pollutants` | à clés, enfant | `code` (37) | `conc`, `method`, `t_year`, `short_term`, `short_val`, `limit_val` |

C'est la structure qui justifie le modèle hybride. En colonnes larges,
37 polluants × 6 attributs produiraient 222 colonnes par point d'émission, dont la
grande majorité vides, et l'ajout d'un polluant lors d'une révision BREF imposerait
une migration. En table enfant, c'est un `INSERT` dans `ref_lists`.

**Page 8**

| Table | Type | Clé | Colonnes |
|---|---|---|---|
| `wastewater_streams` | répétable | `idx` | `discharge_id`, `ref_year`, `wwtp_desc`, `sludge_fate` |
| `wastewater_sources` | à clés, enfant | `code` (8) | `vol`, `comment` |
| `wastewater_pollutants` | à clés, enfant | `code` (13) | `conc`, `freq`, `pos`, `comments` |

**Page 9**

| Table | Type | Clé | Colonnes |
|---|---|---|---|
| `solid_residues` | répétable | `idx` | `description`, `ewc`, `source`, `qty`, `destination` |

**Page 11**

| Table | Type | Clé | Colonnes |
|---|---|---|---|
| `bat_candidate_categories` | à clés | `code` (9) | `selected BOOLEAN` |

Codes : `energy`, `rawmat`, `water`, `emissions`, `primary_other`, `air`, `ww`,
`solid`, `secondary_other`. Le champ HTML est une case à cocher dont la valeur est
`'on'` ou vide ; elle est convertie en booléen.

### 4.4 Total

7 noyau + 10 tables de page + 23 tables enfants = **40 tables**, dont 33 décrites
par le manifeste et 5 écrites à la main dans le générateur (`companies` et
`submissions` viennent de la migration `001`).

Le manifeste en décrit 33 ; les 7 tables du noyau ne portent aucun champ de
questionnaire et sont écrites à la main.

---

## 5. Le manifeste

Nouveau module `docs/fields.js`, chargé avant `app.js`. Une entrée par table,
déclarant le motif de nom HTML existant et la correspondance vers les colonnes.

```js
const SCHEMA = {

  contacts: {
    kind: 'one', page: 0,
    cols: { contact_company:'text', contact_email:'text', /* … 17 */ }
  },

  dryers: {
    kind: 'many', page: 5, pattern: 'dryer_{idx}_{col}',
    countField: 'dryer_count',
    cols: { ref_year:'int', main_type:'text', temp_min:'num', temp_max:'num',
            residence_val:'num', residence_unit:'text', /* … 11 */ }
  },

  raw_materials: {
    kind: 'keyed', page: 3, pattern: 'rm_{code}_{col}', list: 'raw_materials',
    cols: { specify:'text', species:'text', source:'text' }
  },

  emission_point_pollutants: {
    kind: 'keyed', page: 7, parent: 'emission_points',
    pattern: 'ep_{parent_idx}_poll_{code}_{col}', list: 'pollutants',
    cols: { conc:'num', method:'text', t_year:'num',
            short_term:'text', short_val:'num', limit_val:'num' }
  },

  wood_prep_operations: {
    kind: 'keyed', page: 2, pattern: 's22_{code}_{col}', list: 'wood_prep_ops',
    cols: { process_desc:'text', prod_t_batch:'num', wood_dry:'num', airflow:'num',
            chan_air:'num', chan_treated:'bool', emit_limit:'bool',
            dust_method:'text', monitoring:'text' }
  },

};
```

Le motif `s22_{code}_{col}` place le code **avant** la colonne, contrairement à
`rm_{code}_{col}`… qui fait de même, mais à l'inverse de `dryer_{idx}_{col}`. Les
motifs hétérogènes sont absorbés par le manifeste : c'est précisément son rôle. Aucune
normalisation des noms HTML n'est entreprise, ce qui laisse les renderers intacts.

**Ajouter une question au questionnaire** se réduit à : une ligne dans `cols`, une
colonne dans le SQL, un champ dans le renderer.

---

## 6. Le dispatcher

Nouveau module `docs/db.js`, exposant deux fonctions symétriques.

### 6.1 Écriture — `dispatch(flatMap, pageId) → opérations par table`

1. Filtrer les entrées du manifeste appartenant à `pageId`.
2. Pour chaque entrée, faire correspondre les clés de la carte plate à son motif,
   en extrayant `idx`, `code` et `parent_idx`.
3. Grouper les valeurs par ligne cible, convertir selon le type déclaré
   (`''` → `NULL`, `'on'` → `true`, chaîne numérique → `NUMERIC`).
4. Émettre un `upsert` par table, et un `delete` pour les lignes dont l'indice dépasse
   le compteur courant (cas d'un sécheur retiré par l'opérateur).
5. Recalculer les colonnes `*_count` depuis le nombre de lignes enfants.

Les tables enfants de second niveau sont écrites après leur parent, afin de disposer
de la clé étrangère. L'ordre est dérivé du champ `parent` du manifeste, non codé en dur.

### 6.2 Lecture — `hydrate(submissionId) → flatMap`

L'inverse exact : lire les tables de la page, reconstruire les noms de champs depuis
les motifs, produire la carte plate que les renderers attendent. Les valeurs `NULL`
redeviennent `''`, les booléens redeviennent `'on'` ou `''`.

### 6.3 Contrat de correction

`hydrate(dispatch(m))` doit être égal à `m` pour toute carte plate `m` produite par le
questionnaire. C'est la propriété que les tests vérifient (§ 8), et c'est aussi ce qui
garantit que la migration ne perd rien.

### 6.4 Auto-save

L'auto-save (débounce 1 800 ms) reste inchangé du point de vue de l'utilisateur. Une
sauvegarde de page touche entre 1 et 4 tables selon la page. Les upserts sont émis en
une seule requête groupée par table.

---

## 7. Migration des données existantes

Script `supabase/migrate/jsonb_to_relational.mjs`, exécuté hors ligne avec la clé
`service_role` lue depuis `.env`.

1. Lire toutes les lignes de `page_data`.
2. Recopier chaque `data` JSONB tel quel dans `submission_pages.raw`. Cette étape ne
   perd rien par construction : c'est une copie, pas une interprétation.
3. Régénérer les tables métier **depuis `submission_pages.raw`**, en passant par le
   même `dispatch()` que le webform. Le module est importé, pas réimplémenté : aucune
   divergence possible entre le chemin de migration et le chemin d'écriture.

Séparer les étapes 2 et 3 rend la reprise **idempotente** : l'étape 3 peut être
relancée autant de fois que nécessaire, notamment après avoir complété le manifeste,
sans jamais retoucher à `page_data` ni redemander quoi que ce soit aux entreprises.
4. Produire un rapport :
   - nombre de lignes créées par table ;
   - **liste des clés JSONB non reconnues par le manifeste**, avec leur `submission_id`
     et leur page. C'est le contrôle qui prouve l'exhaustivité : un rapport vide
     signifie que chaque valeur stockée a trouvé une colonne.
   - liste des valeurs rejetées à la conversion de type (ex. `"n/a"` dans un champ
     numérique), avec leur destination.

Le script s'exécute d'abord en mode `--dry-run` : il produit le rapport sans rien
écrire. La migration réelle n'est lancée qu'après examen d'un rapport vide ou dont
chaque anomalie a été explicitement acceptée.

`page_data` est **conservée intacte** après la migration, en lecture seule, jusqu'à
validation en conditions réelles. Sa suppression fait l'objet d'une migration
ultérieure distincte.

---

## 8. Tests

L'implémentation suit un cycle test-d'abord. Trois niveaux :

**Aller-retour du dispatcher.** Pour chacune des 12 pages porteuses de champs, une
carte plate de référence remplie de valeurs représentatives (dont les cas limites :
chaîne vide, zéro, décimale, texte contenant une apostrophe, instance répétable
supprimée au milieu de la série). Vérifier `hydrate(dispatch(m)) === m`.

**Couverture du manifeste.** Un test qui parcourt les renderers, extrait tous les noms
de champs générés, et vérifie que chacun correspond à exactement une entrée du
manifeste. Ce test échoue si quelqu'un ajoute un champ au questionnaire sans déclarer
sa colonne — c'est le garde-fou qui remplace la souplesse perdue du JSONB.

**Intégrité du schéma.** Vérifier que chaque colonne déclarée dans le manifeste existe
réellement dans la base avec le type annoncé, et réciproquement qu'aucune colonne
métier n'est absente du manifeste.

---

## 9. Sécurité (RLS)

Les 40 tables portent `ENABLE ROW LEVEL SECURITY`. Les politiques suivent le modèle
existant, en remontant la chaîne de parenté jusqu'à `submissions.user_id` :

- tables 1:1 de page — `submission_id IN (SELECT id FROM submissions WHERE user_id = auth.uid())` ;
- tables enfants de premier niveau — même sous-requête ;
- tables enfants de second niveau — jointure sur le parent, lui-même filtré ;
- `ref_lists` — lecture pour tout utilisateur authentifié, écriture réservée au `service_role` ;
- `audit_log` — `INSERT` seul pour `authenticated`, aucun `UPDATE` ni `DELETE` accordé.

Ces politiques sont répétitives : elles sont **générées** par le même script qui produit
le DDL depuis le manifeste, et non écrites à la main table par table.

---

## 10. Livrables

| Fichier | Contenu |
|---|---|
| `supabase/migrations/002_relational_schema.sql` | DDL des 40 tables, index, triggers, politiques RLS |
| `supabase/migrations/003_seed_ref_lists.sql` | Seed des listes de valeurs, généré depuis les tableaux JS |
| `docs/fields.js` | Manifeste |
| `docs/db.js` | Dispatcher : `dispatch()`, `hydrate()` |
| `docs/app.js` | Modifié : chemins save/load réorientés vers le dispatcher |
| `supabase/migrate/jsonb_to_relational.mjs` | Script de reprise avec `--dry-run` et rapport |
| `tests/` | Les trois niveaux du § 8 |
| `EuroPanel_DataDictionary.docx` | Régénéré depuis le manifeste |

Les renderers `docs/pages-0-6.js` et `docs/pages-7-12.js` ne sont **pas** modifiés.

---

## 11. Hors périmètre

Explicitement exclus de cette itération, pour éviter que le changement ne s'étende :

- l'implémentation du workflow de révision et d'approbation (les colonnes de statut
  sont créées, la logique applicative ne l'est pas) ;
- le back-office administrateur EPF ;
- les notifications par e-mail ;
- l'alimentation de `audit_log` par des triggers (la table est créée, son remplissage
  automatique fera l'objet d'une itération dédiée) ;
- la suppression de `page_data` ;
- les vues analytiques aplaties pour Qlik — elles deviennent largement inutiles une
  fois le modèle relationnel en place, ce qui est précisément l'intérêt de ce
  changement.
