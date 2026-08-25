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

  // Codes des groupes a cles fixes. Refletent les tableaux const des renderers
  // et alimentent le seed de ref_lists.
  const LISTS = {
    raw_materials: ['roundwood', 'vir_forest', 'sawdust', 'ext_prod_res',
                    'ext_recycled', 'nonwood', 'other'],
    pollutants: ['pm', 'so2', 'nox', 'co', 'nh3', 'hcho', 'nmvoc', 'toc', 'voc',
                 'cvoc', 'terpene', 'org_acids'],
  };

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

    raw_materials_section: {
      kind: 'one', page: 3,
      cols: { s32_comments: 'text' },
    },

    raw_materials: {
      kind: 'keyed', page: 3, pattern: 'rm_{code}_{col}', list: 'raw_materials',
      cols: { specify: 'text', species: 'text', source: 'text' },
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
