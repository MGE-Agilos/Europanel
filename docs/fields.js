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

  };

  return { SCHEMA };
});
