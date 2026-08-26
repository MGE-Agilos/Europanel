-- ══════════════════════════════════════════════════════════════════════
--  EuroPanel — Seed des listes de référence (europanel.ref_lists)
--
--  GÉNÉRÉ par tools/gen_ref_lists.mjs.
--  Codes et ordre : LISTS dans docs/fields.js.
--  Libellés et unités : extraits des tableaux d'options des renderers
--  (docs/pages-0-6.js, docs/pages-7-12.js), appariés PAR LISTE et non par
--  code — « other » existe dans raw_materials, fuels et waste_gas_sources
--  avec trois sens différents.
--
--  NE PAS MODIFIER À LA MAIN : régénérer.
--    node tools/gen_ref_lists.mjs > supabase/migrations/003_seed_ref_lists.sql
--
--  Prérequis : 002_relational_schema.sql (table ref_lists). Ce seed doit
--  être appliqué avant toute écriture dans les tables 'keyed', qui portent
--  une clé étrangère composite vers ref_lists (list_code, code).
--
--  Effectif par liste :
--    site_activities             11
--    site_activity_unit_codes     2
--    storage_types                3
--    wood_prep_stages             3
--    wood_prep_params             9
--    raw_materials                7
--    raw_materials_specify        2
--    additives                    2
--    fuels                        7
--    waste_gas_sources            4
--    abatement_flows              4
--    pollutants                  35
--    ww_pollutants               13
--    ww_sources                   8
--    TOTAL                      110
-- ══════════════════════════════════════════════════════════════════════

INSERT INTO europanel.ref_lists (list_code, code, label, unit, sort_order, active)
VALUES
  ('site_activities', 'sawmill', 'Sawmill', 'Tonne', 0, TRUE),
  ('site_activities', 'glue', 'Glue production', 'Tonne', 1, TRUE),
  ('site_activities', 'impreg_paper', 'Production of impregnated paper', 'm² paper/year', 2, TRUE),
  ('site_activities', 'paper_lam', 'Paper Lamination', 'm² laminated board', 3, TRUE),
  ('site_activities', 'other_value', 'Other value added production', 'Tonne product', 4, TRUE),
  ('site_activities', 'combustion', 'Combustion plants', 'Total aggregated thermal input MW', 5, TRUE),
  ('site_activities', 'incineration', 'Waste incineration plants', 'Total aggregated thermal input MW', 6, TRUE),
  ('site_activities', 'ww_treatment', 'Waste water treatment facilities', 'Treatment capacity m³ water', 7, TRUE),
  ('site_activities', 'landfill', 'Landfill', 'Tonne', 8, TRUE),
  ('site_activities', 'other_activities', 'Other activities', NULL, 9, TRUE),
  ('site_activities', 'other_specify', 'Please specify other activity', NULL, 10, TRUE),
  ('site_activity_unit_codes', 'other_activities', 'Other activities', NULL, 0, TRUE),
  ('site_activity_unit_codes', 'other_specify', 'Please specify other activity', NULL, 1, TRUE),
  ('storage_types', 'outdoor', 'Outdoor storage of raw materials', NULL, 0, TRUE),
  ('storage_types', 'indoor', 'Indoor storage of raw materials', NULL, 1, TRUE),
  ('storage_types', 'silos', 'Closed silos for raw materials before chipping', NULL, 2, TRUE),
  ('wood_prep_stages', 'debark', 'Debarking', NULL, 0, TRUE),
  ('wood_prep_stages', 'chip', 'Plating & Chipping', NULL, 1, TRUE),
  ('wood_prep_stages', 'other_chip', 'Other', NULL, 2, TRUE),
  ('wood_prep_params', 'process_desc', 'Describe processes and units/facilities', NULL, 0, TRUE),
  ('wood_prep_params', 'prod_t_batch', 'Tonnes of production equipment (batches/h)', 'batches/h', 1, TRUE),
  ('wood_prep_params', 'wood_dry', 'Tonnes of wood (dry batches/h)', 't dry/h', 2, TRUE),
  ('wood_prep_params', 'airflow', 'Airflow', 'Nm³/h', 3, TRUE),
  ('wood_prep_params', 'chan_air', 'Total channelled air', 'Nm³/h', 4, TRUE),
  ('wood_prep_params', 'chan_treated', 'Channelled air treated?', NULL, 5, TRUE),
  ('wood_prep_params', 'emit_limit', 'Emission limit in permit?', NULL, 6, TRUE),
  ('wood_prep_params', 'dust_method', 'Indicate method of dust abatement', NULL, 7, TRUE),
  ('wood_prep_params', 'monitoring', 'Describe monitoring or controls', NULL, 8, TRUE),
  ('raw_materials', 'roundwood', 'Roundwood', NULL, 0, TRUE),
  ('raw_materials', 'vir_forest', 'Virgin wood forest residues', NULL, 1, TRUE),
  ('raw_materials', 'sawdust', 'Sawdust', NULL, 2, TRUE),
  ('raw_materials', 'ext_prod_res', 'External delivered production residues', NULL, 3, TRUE),
  ('raw_materials', 'ext_recycled', 'External collected recycled wood', NULL, 4, TRUE),
  ('raw_materials', 'nonwood', 'Non-wood plant material (specify):', NULL, 5, TRUE),
  ('raw_materials', 'other', 'Other (specify):', NULL, 6, TRUE),
  ('raw_materials_specify', 'nonwood', 'Non-wood plant material (specify):', NULL, 0, TRUE),
  ('raw_materials_specify', 'other', 'Other (specify):', NULL, 1, TRUE),
  ('additives', 'wax', 'Wax', NULL, 0, TRUE),
  ('additives', 'other_add', 'Other', NULL, 1, TRUE),
  ('fuels', 'prod_res', 'Production residues', NULL, 0, TRUE),
  ('fuels', 'liquid', 'Liquid fuel', NULL, 1, TRUE),
  ('fuels', 'natgas', 'Natural gas', NULL, 2, TRUE),
  ('fuels', 'rec_ext', 'Recycled wood (external)', NULL, 3, TRUE),
  ('fuels', 'rec_waste', 'Recycled wood (waste)', NULL, 4, TRUE),
  ('fuels', 'biomass', 'Biomass', NULL, 5, TRUE),
  ('fuels', 'other', 'Other fuels', NULL, 6, TRUE),
  ('waste_gas_sources', 'dryer', 'Dryer exhaust', NULL, 0, TRUE),
  ('waste_gas_sources', 'press', 'Press exhaust', NULL, 1, TRUE),
  ('waste_gas_sources', 'paper', 'Impreg. paper production', NULL, 2, TRUE),
  ('waste_gas_sources', 'other', 'Other (specify)', NULL, 3, TRUE),
  ('abatement_flows', 'intake', 'Total gas intake', NULL, 0, TRUE),
  ('abatement_flows', 'recycled', 'Gas recycled to process', NULL, 1, TRUE),
  ('abatement_flows', 'discharge', 'Gas discharged to atmosphere', NULL, 2, TRUE),
  ('abatement_flows', 'waste_res', 'Residues generated (waste)', NULL, 3, TRUE),
  ('pollutants', 'pm', 'PM', NULL, 0, TRUE),
  ('pollutants', 'so2', 'SO₂', NULL, 1, TRUE),
  ('pollutants', 'nox', 'NOₓ', NULL, 2, TRUE),
  ('pollutants', 'co', 'CO', NULL, 3, TRUE),
  ('pollutants', 'nh3', 'NH₃', NULL, 4, TRUE),
  ('pollutants', 'hcho', 'Formaldehyde', NULL, 5, TRUE),
  ('pollutants', 'nmvoc', 'NMVOC', NULL, 6, TRUE),
  ('pollutants', 'toc', 'TOC', NULL, 7, TRUE),
  ('pollutants', 'voc', 'VOC', NULL, 8, TRUE),
  ('pollutants', 'cvoc', 'CVOC', NULL, 9, TRUE),
  ('pollutants', 'terpene', 'Terpene', NULL, 10, TRUE),
  ('pollutants', 'formic', 'Formic acid', NULL, 11, TRUE),
  ('pollutants', 'acetic', 'Acetic acid', NULL, 12, TRUE),
  ('pollutants', 'propionic', 'Propionic acid', NULL, 13, TRUE),
  ('pollutants', 'acetaldehyde', 'Acetaldehyde', NULL, 14, TRUE),
  ('pollutants', 'phenol', 'Phenol', NULL, 15, TRUE),
  ('pollutants', 'pmdi', 'pMDI', NULL, 16, TRUE),
  ('pollutants', 'as', 'As', NULL, 17, TRUE),
  ('pollutants', 'pb', 'Pb', NULL, 18, TRUE),
  ('pollutants', 'cr', 'Cr', NULL, 19, TRUE),
  ('pollutants', 'hcl', 'HCl', NULL, 20, TRUE),
  ('pollutants', 'hf', 'HF', NULL, 21, TRUE),
  ('pollutants', 'cd', 'Cd (heavy metal)', NULL, 22, TRUE),
  ('pollutants', 'co_hm', 'Co (heavy metal)', NULL, 23, TRUE),
  ('pollutants', 'cr_hm', 'Cr (heavy metal)', NULL, 24, TRUE),
  ('pollutants', 'cu', 'Cu (heavy metal)', NULL, 25, TRUE),
  ('pollutants', 'hg', 'Hg (heavy metal)', NULL, 26, TRUE),
  ('pollutants', 'ni', 'Ni (heavy metal)', NULL, 27, TRUE),
  ('pollutants', 'sb', 'Sb (heavy metal)', NULL, 28, TRUE),
  ('pollutants', 'tl', 'Tl (heavy metal)', NULL, 29, TRUE),
  ('pollutants', 'v', 'V (heavy metal)', NULL, 30, TRUE),
  ('pollutants', 'methanol', 'Methanol', NULL, 31, TRUE),
  ('pollutants', 'odour', 'Odour', NULL, 32, TRUE),
  ('pollutants', 'others_1', 'Others (specify)', NULL, 33, TRUE),
  ('pollutants', 'pcdd', 'PCDD/PCDF', NULL, 34, TRUE),
  ('ww_pollutants', 'flow', 'Flow', 'm³/year', 0, TRUE),
  ('ww_pollutants', 'ph', 'pH', NULL, 1, TRUE),
  ('ww_pollutants', 'tss', 'TSS', 'mg/L', 2, TRUE),
  ('ww_pollutants', 'bod5', 'BOD₅', 'mg/L', 3, TRUE),
  ('ww_pollutants', 'cod', 'COD', 'mg/L', 4, TRUE),
  ('ww_pollutants', 'toc', 'TOC', 'mg/L', 5, TRUE),
  ('ww_pollutants', 'thc', 'THC', 'mg/L', 6, TRUE),
  ('ww_pollutants', 'total_n', 'Total N', 'mg/L', 7, TRUE),
  ('ww_pollutants', 'tan', 'TAN', 'mg/L', 8, TRUE),
  ('ww_pollutants', 'nh4', 'NH₄-N', 'mg/L', 9, TRUE),
  ('ww_pollutants', 'other_1', 'Other 1', 'mg/L', 10, TRUE),
  ('ww_pollutants', 'other_2', 'Other 2', 'mg/L', 11, TRUE),
  ('ww_pollutants', 'other_3', 'Other 3', 'mg/L', 12, TRUE),
  ('ww_sources', 'refining', 'Wood refining', NULL, 0, TRUE),
  ('ww_sources', 'cleaning', 'Cleaning activities', NULL, 1, TRUE),
  ('ww_sources', 'manuf', 'Manufacturing process water', NULL, 2, TRUE),
  ('ww_sources', 'runoff_pond', 'Run-off from wood storage ponds', NULL, 3, TRUE),
  ('ww_sources', 'runoff_other', 'Run-off from other storage', NULL, 4, TRUE),
  ('ww_sources', 'abatement', 'Air abatement water', NULL, 5, TRUE),
  ('ww_sources', 'firefighting', 'Firefighting water', NULL, 6, TRUE),
  ('ww_sources', 'open', 'Other (specify)', NULL, 7, TRUE)
ON CONFLICT (list_code, code) DO NOTHING;
