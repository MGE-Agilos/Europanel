/* ══════════════════════════════════════════════════════════════════════
   EuroPanel — Manifeste des champs
   Source de vérité unique de la correspondance champ HTML → table/colonne.
   Le DDL SQL et les politiques RLS sont générés depuis ce fichier.

   Types de colonnes : 'text' | 'num' | 'int' | 'bool'
   Genres d'entrée   : 'one'   table 1:1 avec la soumission
                       'many'  section répétable, indexée par {idx}
                       'keyed' groupe à clés fixes, indexé par {code}

   Les types sont établis d'après le HTML réellement rendu, jamais d'après le
   nom du champ. Un <input type="number"> est 'num' ; une année ou un
   compteur est 'int' ; une case à cocher est 'bool'. Tout ce que le renderer
   a choisi de rendre en input texte reste 'text' : ce choix est délibéré, et
   typer numériquement une saisie libre (« <= 50 », « 2024 (estimation) »)
   la mettrait à null sans le moindre avertissement.

   Les listes de codes et l'ordre des colonnes suivent l'ordre d'émission des
   renderers, vérifié par tools/extract_fields.mjs.
   ══════════════════════════════════════════════════════════════════════ */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.EuroPanelFields = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Codes des groupes a cles fixes. Refletent les tableaux const des renderers
  // et alimentent le seed de ref_lists.
  const LISTS = {

    /* ── page 1 ─────────────────────────────────────────────────────── */
    // OTHER_ACT de renderPage1. 'other_specify' est la ligne a libelle libre.
    site_activities: ['sawmill', 'glue', 'impreg_paper', 'paper_lam', 'other_value',
                      'combustion', 'incineration', 'ww_treatment', 'landfill',
                      'other_activities', 'other_specify'],

    /* ── page 2 ─────────────────────────────────────────────────────── */
    storage_types: ['outdoor', 'indoor', 'silos'],
    // Les trois operations de la matrice 2.2 (colonnes du tableau).
    wood_prep_stages: ['debark', 'chip', 'other_chip'],
    // Les neuf parametres de la matrice 2.2 (lignes du tableau). Ils servent
    // de cles a la table des commentaires, indexee par parametre et non par
    // operation : s22_comments_airflow porte un commentaire pour la ligne
    // « Airflow », pas pour l'une des trois operations.
    wood_prep_params: ['process_desc', 'prod_t_batch', 'wood_dry', 'airflow',
                       'chan_air', 'chan_treated', 'emit_limit', 'dust_method',
                       'monitoring'],

    /* ── page 3 ─────────────────────────────────────────────────────── */
    raw_materials: ['roundwood', 'vir_forest', 'sawdust', 'ext_prod_res',
                    'ext_recycled', 'nonwood', 'other'],
    // Seules ces deux lignes de RAW_MATS portent r.specify : leur libelle est
    // un champ de saisie et non un texte fixe. Declarer 'specify' sur les sept
    // codes creerait cinq colonnes que le formulaire n'emet jamais.
    raw_materials_specify: ['nonwood', 'other'],
    additives: ['wax', 'other_add'],

    /* ── page 4 ─────────────────────────────────────────────────────── */
    fuels: ['prod_res', 'liquid', 'natgas', 'rec_ext', 'rec_waste', 'biomass', 'other'],

    /* ── page 6 ─────────────────────────────────────────────────────── */
    // WG_SOURCES : procedes dont les gaz alimentent la technique d'abattement.
    waste_gas_sources: ['dryer', 'press', 'paper', 'other'],
    // Bilan gazeux de la technique d'abattement (une ligne par poste).
    abatement_flows: ['intake', 'recycled', 'discharge', 'waste_res'],

    /* ── page 7 ─────────────────────────────────────────────────────── */
    // POLLUTANTS de renderPage7, dans l'ordre d'emission. Le tableau du
    // renderer compte 37 entrees, mais 'org_acids' et 'aldehydes' portent
    // parent:true : ce sont des lignes de sous-titre, sans aucun input. Les
    // inclure creerait douze colonnes sans champ. D'ou 35 codes et non 37.
    pollutants: ['pm', 'so2', 'nox', 'co', 'nh3', 'hcho', 'nmvoc', 'toc', 'voc',
                 'cvoc', 'terpene', 'org_acids'],

    /* ── page 8 ─────────────────────────────────────────────────────── */
    ww_pollutants: ['flow', 'ph', 'tss', 'bod5', 'cod', 'toc', 'thc', 'total_n',
                    'tan', 'nh4', 'other_1', 'other_2', 'other_3'],
    ww_sources: ['refining', 'cleaning', 'manuf', 'runoff_pond', 'runoff_other',
                 'abatement', 'firefighting', 'open'],
  };

  const SCHEMA = {

    /* ══ page 0 — Cover & Contact ══════════════════════════════════════ */

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

    /* ══ page 1 — General Information ══════════════════════════════════ */

    general_info: {
      kind: 'one', page: 1,
      cols: {
        plant_name: 'text', production_started: 'int',
        location_city: 'text', location_country: 'text', company: 'text',
        ref_year: 'int', comments: 'text',
        // Trois exceptions du tableau 1.7. La colonne « unite » n'est un champ
        // de saisie que pour les deux lignes dont l'unite n'est pas imposee,
        // et le libelle n'est saisissable que pour la ligne « other_specify ».
        // Les porter dans site_activities creerait des colonnes sans champ
        // pour les neuf autres codes ; elles sont bien 1:1 avec la soumission.
        act_other_activities_unit: 'text',
        act_other_specify_unit: 'text',
        act_other_specify_label: 'text',
      },
    },

    plant_products: {
      // Quatre lignes fixes, sans compteur cache : le renderer rend toujours
      // prod_1 a prod_4. countInstances sonde donc la carte plate.
      kind: 'many', page: 1, pattern: 'prod_{idx}_{col}',
      cols: {
        type: 'text', addinfo: 'text', qty: 'num', unit: 'text', daily: 'num',
      },
    },

    site_activities: {
      kind: 'keyed', page: 1, pattern: 'act_{code}_{col}', list: 'site_activities',
      // present et ippc sont des selects Oui/Non ('y'/'n'), pas des cases a
      // cocher : 'bool' les lirait via value === 'on' et rendrait tout false.
      cols: { present: 'text', ippc: 'text', capacity: 'num' },
    },

    /* ══ page 2 — WBP Plant Layout ═════════════════════════════════════ */

    plant_layout_section: {
      kind: 'one', page: 2,
      cols: {
        ref_year: 'int',
        s21_comments: 'text', s22_comments: 'text',
        // 2.3 — broyage de bois recycle
        s23_present: 'text', s23_hours: 'num', s23_capacity: 'num',
        s23_chan_air: 'num', s23_chan_treated: 'text', s23_emit_limit: 'text',
        s23_dust_method: 'text', s23_monitoring: 'text', s23_comments: 'text',
        // 2.4 et 2.5 — autres sources de poussieres
        s24_desc: 'text', s24_chan_air: 'num', s24_chan_treated: 'text',
        s24_dust_method: 'text', s24_comments: 'text',
        s25_desc: 'text', s25_chan_air: 'num', s25_chan_treated: 'text',
        s25_dust_method: 'text', s25_comments: 'text',
      },
    },

    raw_material_storage: {
      kind: 'keyed', page: 2, pattern: 'stor_{code}_{col}', list: 'storage_types',
      cols: { pct: 'num', cap: 'num', area: 'num' },
    },

    wood_prep_operations: {
      kind: 'keyed', page: 2, pattern: 's22_{code}_{col}', list: 'wood_prep_stages',
      // Toutes les cellules de la matrice sont des inputs texte, y compris
      // celles dont l'en-tete annonce une unite (Nm3/h, t dry/h) : le renderer
      // n'utilise numUnit() nulle part ici. Les typer 'num' detruirait les
      // saisies du type « 12 000–15 000 » ou « n.a. ».
      cols: {
        process_desc: 'text', prod_t_batch: 'text', wood_dry: 'text',
        airflow: 'text', chan_air: 'text', chan_treated: 'text',
        emit_limit: 'text', dust_method: 'text', monitoring: 'text',
      },
    },

    wood_prep_param_comments: {
      // Un commentaire par parametre, et non par operation : la cle est le
      // parametre. Le motif place donc {col} avant {code}, ce qui produit
      // s22_comments_airflow — et non l'inverse.
      kind: 'keyed', page: 2, pattern: 's22_{col}_{code}', list: 'wood_prep_params',
      cols: { comments: 'text' },
    },

    /* ══ page 3 — Raw materials, resins and additives ══════════════════ */

    raw_materials_section: {
      kind: 'one', page: 3,
      cols: { ref_year: 'int', s32_comments: 'text' },
    },

    raw_materials: {
      kind: 'keyed', page: 3, pattern: 'rm_{code}_{col}', list: 'raw_materials',
      cols: { pct: 'num', species: 'text', source: 'text' },
    },

    raw_material_specify: {
      // Voir LISTS.raw_materials_specify : seules deux des sept lignes ont un
      // libelle saisissable. Table distincte plutot qu'une colonne de plus sur
      // raw_materials, qui produirait cinq colonnes sans champ.
      kind: 'keyed', page: 3, pattern: 'rm_{code}_{col}', list: 'raw_materials_specify',
      cols: { specify: 'text' },
    },

    resins: {
      kind: 'many', page: 3, pattern: 'resin_{idx}_{col}',
      cols: { type: 'text', pct: 'num', comments: 'text' },
    },

    hardeners: {
      // Indexe, malgre l'apparence : hard_1_type et hard_2_type sont deux
      // lignes anonymes, pas deux codes fixes.
      kind: 'many', page: 3, pattern: 'hard_{idx}_{col}',
      cols: { type: 'text', comments: 'text' },
    },

    additives: {
      // A cles, malgre l'apparence symetrique avec hardeners : add_wax_* et
      // add_other_add_* nomment deux additifs identifies.
      kind: 'keyed', page: 3, pattern: 'add_{code}_{col}', list: 'additives',
      cols: { type: 'text', comments: 'text' },
    },

    /* ══ page 4 — Energy production ════════════════════════════════════ */

    energy_section: {
      kind: 'one', page: 4,
      cols: {
        ref_year: 'int', comments: 'text', s41_diagram_ref: 'text',
        s43_steam: 'num', s43_hot_oil: 'num', s43_fluegas: 'num', s43_other: 'num',
        s43_cold_startups: 'int', s43_warm_startups: 'int',
        s43_maintenance_desc: 'text',
      },
    },

    combustion_units: {
      kind: 'many', page: 4, pattern: 'cu_{idx}_{col}', countField: 'cu_count',
      cols: {
        general_process: 'text', equip_type: 'text', boiler_detail: 'text',
        engine_ignition: 'text', chp: 'text', suppl_fire: 'text', dual_fuel: 'text',
        install_year: 'int',
        thermal_input: 'num', energy_output: 'num',
        hours_normal: 'num', hours_special: 'num',
        // Cinq emplacements de sortie energetique (MW), numerotes et non
        // nommes par le formulaire. Ce sont cinq attributs distincts de la
        // meme unite de combustion, pas une sous-section repetable : le
        // dispatcher ne sait pas imbriquer une entree 'many' sous une autre.
        output_1: 'num', output_2: 'num', output_3: 'num',
        output_4: 'num', output_5: 'num',
      },
    },

    combustion_unit_fuels: {
      kind: 'keyed', page: 4, parent: 'combustion_units',
      pattern: 'cu_{parent_idx}_fuel_{code}_{col}', list: 'fuels',
      // Le champ HTML est ..._desc ; desc est un mot reserve PostgreSQL.
      aliases: { description: 'desc' },
      cols: { pct: 'num', description: 'text' },
    },

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
  };

  return { SCHEMA, LISTS };
});
