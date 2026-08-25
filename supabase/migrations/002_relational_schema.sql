-- ══════════════════════════════════════════════════════════════════════
--  EuroPanel — Schéma relationnel du questionnaire WBP BREF
--  Supabase / PostgreSQL  ·  Schema: europanel
--
--  GÉNÉRÉ par tools/gen_schema.mjs depuis docs/fields.js.
--  NE PAS MODIFIER À LA MAIN : corriger le manifeste ou le générateur,
--  puis régénérer :
--    node tools/gen_schema.mjs > supabase/migrations/002_relational_schema.sql
--
--  Prérequis : 001_schema.sql (schéma europanel, companies, submissions,
--  et les ALTER DEFAULT PRIVILEGES qui accordent l'accès aux tables
--  créées ensuite dans ce schéma).
-- ══════════════════════════════════════════════════════════════════════

-- ══════════════════════════════════════════════════════════════════════
-- ▼▼▼ SECTION ÉCRITE À LA MAIN — début ▼▼▼
--
-- Tables du noyau (spec § 4.1). Elles ne portent aucun champ du
-- questionnaire : le manifeste ne les décrit pas et le générateur ne les
-- déduit pas. Elles sont maintenues à la main dans tools/gen_schema.mjs
-- (constante CORE_SQL) et réémises à chaque régénération.
--
-- Placées avant les tables générées : celles-ci référencent ref_lists.
-- ══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS europanel.plants (
  id          BIGSERIAL PRIMARY KEY,
  company_id  BIGINT REFERENCES europanel.companies(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  country     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS europanel.cycles (
  id             BIGSERIAL PRIMARY KEY,
  label          TEXT NOT NULL,
  reference_year SMALLINT,
  opens_at       DATE,
  closes_at      DATE,
  status         TEXT NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','open','closed','archived')),
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS europanel.ref_lists (
  list_code   TEXT     NOT NULL,
  code        TEXT     NOT NULL,
  label       TEXT     NOT NULL,
  unit        TEXT,
  sort_order  SMALLINT NOT NULL DEFAULT 0,
  active      BOOLEAN  NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (list_code, code)
);

-- Successeure de page_data : porte l'avancement et la charge brute.
-- `raw` est la carte plate telle que collectFormData l'a produite. Elle n'est
-- pas relue en fonctionnement normal, mais elle rend les tables metier
-- regenerables : une colonne oubliee puis ajoutee au manifeste se rattrape en
-- rejouant dispatch() sur l'historique, sans rien redemander aux entreprises.
CREATE TABLE IF NOT EXISTS europanel.submission_pages (
  submission_id BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  page_id       SMALLINT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'empty'
                CHECK (status IN ('empty','partial','complete')),
  raw           JSONB NOT NULL DEFAULT '{}',
  saved_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
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
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE europanel.submissions ADD COLUMN IF NOT EXISTS plant_id BIGINT
  REFERENCES europanel.plants(id);
ALTER TABLE europanel.submissions ADD COLUMN IF NOT EXISTS cycle_id BIGINT
  REFERENCES europanel.cycles(id);

CREATE INDEX IF NOT EXISTS idx_ep_plants_company
  ON europanel.plants(company_id);
CREATE INDEX IF NOT EXISTS idx_ep_submission_pages_sub
  ON europanel.submission_pages(submission_id);
CREATE INDEX IF NOT EXISTS idx_ep_audit_log_sub
  ON europanel.audit_log(submission_id);

-- ─── Horodatage du noyau ──────────────────────────────────────────────
-- Même trigger que les tables générées (voir triggerDdl) : réutilise
-- europanel.set_updated_at(), défini dans 001_schema.sql, sans le
-- redéfinir.
DROP TRIGGER IF EXISTS trg_plants_updated_at ON europanel.plants;
CREATE TRIGGER trg_plants_updated_at
  BEFORE UPDATE ON europanel.plants
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

DROP TRIGGER IF EXISTS trg_cycles_updated_at ON europanel.cycles;
CREATE TRIGGER trg_cycles_updated_at
  BEFORE UPDATE ON europanel.cycles
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

DROP TRIGGER IF EXISTS trg_ref_lists_updated_at ON europanel.ref_lists;
CREATE TRIGGER trg_ref_lists_updated_at
  BEFORE UPDATE ON europanel.ref_lists
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

DROP TRIGGER IF EXISTS trg_submission_pages_updated_at ON europanel.submission_pages;
CREATE TRIGGER trg_submission_pages_updated_at
  BEFORE UPDATE ON europanel.submission_pages
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

DROP TRIGGER IF EXISTS trg_audit_log_updated_at ON europanel.audit_log;
CREATE TRIGGER trg_audit_log_updated_at
  BEFORE UPDATE ON europanel.audit_log
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

-- ─── RLS du noyau ─────────────────────────────────────────────────────
ALTER TABLE europanel.plants            ENABLE ROW LEVEL SECURITY;
ALTER TABLE europanel.cycles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE europanel.ref_lists         ENABLE ROW LEVEL SECURITY;
ALTER TABLE europanel.submission_pages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE europanel.audit_log         ENABLE ROW LEVEL SECURITY;

-- Referentiels : lecture pour tout utilisateur authentifie, ecriture
-- reservee au service_role. Aucune politique d'ecriture n'est declaree :
-- sous Supabase, service_role porte BYPASSRLS et ecrit malgre RLS, tandis
-- que authenticated, faute de politique, ne peut ni inserer ni modifier.
CREATE POLICY "ep_ref_lists_select" ON europanel.ref_lists
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ep_plants_select" ON europanel.plants
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ep_cycles_select" ON europanel.cycles
  FOR SELECT TO authenticated USING (true);

-- Pages de soumission : portee a la soumission proprietaire, toutes
-- operations. FOR ALL applique USING aux lectures et aux ecritures ;
-- WITH CHECK est repete explicitement pour que l'INSERT soit lisible.
CREATE POLICY "ep_submission_pages_all" ON europanel.submission_pages
  FOR ALL TO authenticated
  USING (
    submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())
  )
  WITH CHECK (
    submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())
  );

-- Journal append-only : insertion seule. Aucune politique UPDATE ni DELETE
-- n'est declaree, donc aucune des deux n'est possible pour authenticated.
CREATE POLICY "ep_audit_log_insert" ON europanel.audit_log
  FOR INSERT TO authenticated WITH CHECK (true);

-- ─── Privilèges du noyau ──────────────────────────────────────────────
-- Même motif que pour les tables générées (voir grantsDdl) : des GRANT
-- explicites, indépendants de l'héritage par rôle d'ALTER DEFAULT
-- PRIVILEGES. Référentiels en lecture seule pour authenticated ; journal
-- en lecture + insertion seule, pour rester append-only au niveau des
-- privilèges et non seulement au niveau des politiques.
GRANT SELECT ON europanel.ref_lists TO authenticated;
GRANT ALL ON europanel.ref_lists TO service_role;

GRANT SELECT ON europanel.plants TO authenticated;
GRANT ALL ON europanel.plants TO service_role;

GRANT SELECT ON europanel.cycles TO authenticated;
GRANT ALL ON europanel.cycles TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.submission_pages TO authenticated;
GRANT ALL ON europanel.submission_pages TO service_role;

GRANT SELECT, INSERT ON europanel.audit_log TO authenticated;
GRANT ALL ON europanel.audit_log TO service_role;

-- ▲▲▲ SECTION ÉCRITE À LA MAIN — fin ▲▲▲


-- ══════════════════════════════════════════════════════════════════════
--  Tables du questionnaire (générées depuis le manifeste)
-- ══════════════════════════════════════════════════════════════════════

-- ─── contacts — page 0, 1:1 avec la soumission ────────────────────────────────────
CREATE TABLE IF NOT EXISTS europanel.contacts (
  submission_id        BIGINT PRIMARY KEY REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  contact_company      TEXT,
  contact_name         TEXT,
  contact_job_title    TEXT,
  contact_email        TEXT,
  contact_telephone    TEXT,
  contact_comments     TEXT,
  twg_ms_state         TEXT,
  twg_ms_organisation  TEXT,
  twg_ms_name          TEXT,
  twg_ms_job_title     TEXT,
  twg_ms_email         TEXT,
  twg_ms_telephone     TEXT,
  twg_ngo_company      TEXT,
  twg_ngo_name         TEXT,
  twg_ngo_job_title    TEXT,
  twg_ngo_email        TEXT,
  twg_ngo_telephone    TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_contacts_updated_at ON europanel.contacts;
CREATE TRIGGER trg_contacts_updated_at
  BEFORE UPDATE ON europanel.contacts
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.contacts TO authenticated;
GRANT ALL ON europanel.contacts TO service_role;

ALTER TABLE europanel.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_contacts_select" ON europanel.contacts
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_contacts_insert" ON europanel.contacts
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_contacts_update" ON europanel.contacts
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_contacts_delete" ON europanel.contacts
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── general_info — page 1, 1:1 avec la soumission ────────────────────────────────
CREATE TABLE IF NOT EXISTS europanel.general_info (
  submission_id       BIGINT PRIMARY KEY REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  plant_name          TEXT,
  production_started  SMALLINT,
  location_city       TEXT,
  location_country    TEXT,
  company             TEXT,
  ref_year            SMALLINT,
  comments            TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_general_info_updated_at ON europanel.general_info;
CREATE TRIGGER trg_general_info_updated_at
  BEFORE UPDATE ON europanel.general_info
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.general_info TO authenticated;
GRANT ALL ON europanel.general_info TO service_role;

ALTER TABLE europanel.general_info ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_general_info_select" ON europanel.general_info
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_general_info_insert" ON europanel.general_info
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_general_info_update" ON europanel.general_info
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_general_info_delete" ON europanel.general_info
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── plant_products — page 1, section répétable (idx) ─────────────────────────────
CREATE TABLE IF NOT EXISTS europanel.plant_products (
  id             BIGSERIAL PRIMARY KEY,
  submission_id  BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  idx            SMALLINT NOT NULL,
  type           TEXT,
  addinfo        TEXT,
  qty            NUMERIC,
  unit           TEXT,
  daily          NUMERIC,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_ep_plant_products_submission_id
  ON europanel.plant_products(submission_id);

DROP TRIGGER IF EXISTS trg_plant_products_updated_at ON europanel.plant_products;
CREATE TRIGGER trg_plant_products_updated_at
  BEFORE UPDATE ON europanel.plant_products
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.plant_products TO authenticated;
GRANT ALL ON europanel.plant_products TO service_role;

ALTER TABLE europanel.plant_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_plant_products_select" ON europanel.plant_products
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_plant_products_insert" ON europanel.plant_products
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_plant_products_update" ON europanel.plant_products
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_plant_products_delete" ON europanel.plant_products
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── site_activities — page 1, groupe à clés (code, liste « site_activities ») ────
CREATE TABLE IF NOT EXISTS europanel.site_activities (
  id             BIGSERIAL PRIMARY KEY,
  submission_id  BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  list_code      TEXT NOT NULL DEFAULT 'site_activities' CHECK (list_code = 'site_activities'),
  present        TEXT,
  ippc           TEXT,
  capacity       NUMERIC,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, code),
  FOREIGN KEY (list_code, code) REFERENCES europanel.ref_lists (list_code, code)
);
CREATE INDEX IF NOT EXISTS idx_ep_site_activities_submission_id
  ON europanel.site_activities(submission_id);

DROP TRIGGER IF EXISTS trg_site_activities_updated_at ON europanel.site_activities;
CREATE TRIGGER trg_site_activities_updated_at
  BEFORE UPDATE ON europanel.site_activities
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.site_activities TO authenticated;
GRANT ALL ON europanel.site_activities TO service_role;

ALTER TABLE europanel.site_activities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_site_activities_select" ON europanel.site_activities
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_site_activities_insert" ON europanel.site_activities
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_site_activities_update" ON europanel.site_activities
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_site_activities_delete" ON europanel.site_activities
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── site_activity_units — page 1, groupe à clés (code, liste « site_activity_unit_codes ») ───
CREATE TABLE IF NOT EXISTS europanel.site_activity_units (
  id             BIGSERIAL PRIMARY KEY,
  submission_id  BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  list_code      TEXT NOT NULL DEFAULT 'site_activity_unit_codes' CHECK (list_code = 'site_activity_unit_codes'),
  unit           TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, code),
  FOREIGN KEY (list_code, code) REFERENCES europanel.ref_lists (list_code, code)
);
CREATE INDEX IF NOT EXISTS idx_ep_site_activity_units_submission_id
  ON europanel.site_activity_units(submission_id);

DROP TRIGGER IF EXISTS trg_site_activity_units_updated_at ON europanel.site_activity_units;
CREATE TRIGGER trg_site_activity_units_updated_at
  BEFORE UPDATE ON europanel.site_activity_units
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.site_activity_units TO authenticated;
GRANT ALL ON europanel.site_activity_units TO service_role;

ALTER TABLE europanel.site_activity_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_site_activity_units_select" ON europanel.site_activity_units
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_site_activity_units_insert" ON europanel.site_activity_units
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_site_activity_units_update" ON europanel.site_activity_units
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_site_activity_units_delete" ON europanel.site_activity_units
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── site_activity_other_specify — page 1, 1:1 avec la soumission ─────────────────
CREATE TABLE IF NOT EXISTS europanel.site_activity_other_specify (
  submission_id            BIGINT PRIMARY KEY REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  act_other_specify_label  TEXT,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_site_activity_other_specify_updated_at ON europanel.site_activity_other_specify;
CREATE TRIGGER trg_site_activity_other_specify_updated_at
  BEFORE UPDATE ON europanel.site_activity_other_specify
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.site_activity_other_specify TO authenticated;
GRANT ALL ON europanel.site_activity_other_specify TO service_role;

ALTER TABLE europanel.site_activity_other_specify ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_site_activity_other_specify_select" ON europanel.site_activity_other_specify
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_site_activity_other_specify_insert" ON europanel.site_activity_other_specify
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_site_activity_other_specify_update" ON europanel.site_activity_other_specify
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_site_activity_other_specify_delete" ON europanel.site_activity_other_specify
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── plant_layout_section — page 2, 1:1 avec la soumission ────────────────────────
CREATE TABLE IF NOT EXISTS europanel.plant_layout_section (
  submission_id     BIGINT PRIMARY KEY REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  ref_year          SMALLINT,
  s21_comments      TEXT,
  s22_comments      TEXT,
  s23_present       TEXT,
  s23_hours         NUMERIC,
  s23_capacity      NUMERIC,
  s23_chan_air      NUMERIC,
  s23_chan_treated  TEXT,
  s23_emit_limit    TEXT,
  s23_dust_method   TEXT,
  s23_monitoring    TEXT,
  s23_comments      TEXT,
  s24_desc          TEXT,
  s24_chan_air      NUMERIC,
  s24_chan_treated  TEXT,
  s24_dust_method   TEXT,
  s24_comments      TEXT,
  s25_desc          TEXT,
  s25_chan_air      NUMERIC,
  s25_chan_treated  TEXT,
  s25_dust_method   TEXT,
  s25_comments      TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_plant_layout_section_updated_at ON europanel.plant_layout_section;
CREATE TRIGGER trg_plant_layout_section_updated_at
  BEFORE UPDATE ON europanel.plant_layout_section
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.plant_layout_section TO authenticated;
GRANT ALL ON europanel.plant_layout_section TO service_role;

ALTER TABLE europanel.plant_layout_section ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_plant_layout_section_select" ON europanel.plant_layout_section
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_plant_layout_section_insert" ON europanel.plant_layout_section
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_plant_layout_section_update" ON europanel.plant_layout_section
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_plant_layout_section_delete" ON europanel.plant_layout_section
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── raw_material_storage — page 2, groupe à clés (code, liste « storage_types ») ───
CREATE TABLE IF NOT EXISTS europanel.raw_material_storage (
  id             BIGSERIAL PRIMARY KEY,
  submission_id  BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  list_code      TEXT NOT NULL DEFAULT 'storage_types' CHECK (list_code = 'storage_types'),
  pct            NUMERIC,
  cap            NUMERIC,
  area           NUMERIC,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, code),
  FOREIGN KEY (list_code, code) REFERENCES europanel.ref_lists (list_code, code)
);
CREATE INDEX IF NOT EXISTS idx_ep_raw_material_storage_submission_id
  ON europanel.raw_material_storage(submission_id);

DROP TRIGGER IF EXISTS trg_raw_material_storage_updated_at ON europanel.raw_material_storage;
CREATE TRIGGER trg_raw_material_storage_updated_at
  BEFORE UPDATE ON europanel.raw_material_storage
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.raw_material_storage TO authenticated;
GRANT ALL ON europanel.raw_material_storage TO service_role;

ALTER TABLE europanel.raw_material_storage ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_raw_material_storage_select" ON europanel.raw_material_storage
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_raw_material_storage_insert" ON europanel.raw_material_storage
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_raw_material_storage_update" ON europanel.raw_material_storage
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_raw_material_storage_delete" ON europanel.raw_material_storage
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── wood_prep_operations — page 2, groupe à clés (code, liste « wood_prep_stages ») ───
CREATE TABLE IF NOT EXISTS europanel.wood_prep_operations (
  id             BIGSERIAL PRIMARY KEY,
  submission_id  BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  list_code      TEXT NOT NULL DEFAULT 'wood_prep_stages' CHECK (list_code = 'wood_prep_stages'),
  process_desc   TEXT,
  prod_t_batch   TEXT,
  wood_dry       TEXT,
  airflow        TEXT,
  chan_air       TEXT,
  chan_treated   TEXT,
  emit_limit     TEXT,
  dust_method    TEXT,
  monitoring     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, code),
  FOREIGN KEY (list_code, code) REFERENCES europanel.ref_lists (list_code, code)
);
CREATE INDEX IF NOT EXISTS idx_ep_wood_prep_operations_submission_id
  ON europanel.wood_prep_operations(submission_id);

DROP TRIGGER IF EXISTS trg_wood_prep_operations_updated_at ON europanel.wood_prep_operations;
CREATE TRIGGER trg_wood_prep_operations_updated_at
  BEFORE UPDATE ON europanel.wood_prep_operations
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.wood_prep_operations TO authenticated;
GRANT ALL ON europanel.wood_prep_operations TO service_role;

ALTER TABLE europanel.wood_prep_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_wood_prep_operations_select" ON europanel.wood_prep_operations
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_wood_prep_operations_insert" ON europanel.wood_prep_operations
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_wood_prep_operations_update" ON europanel.wood_prep_operations
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_wood_prep_operations_delete" ON europanel.wood_prep_operations
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── wood_prep_param_comments — page 2, groupe à clés (code, liste « wood_prep_params ») ───
CREATE TABLE IF NOT EXISTS europanel.wood_prep_param_comments (
  id             BIGSERIAL PRIMARY KEY,
  submission_id  BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  list_code      TEXT NOT NULL DEFAULT 'wood_prep_params' CHECK (list_code = 'wood_prep_params'),
  comments       TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, code),
  FOREIGN KEY (list_code, code) REFERENCES europanel.ref_lists (list_code, code)
);
CREATE INDEX IF NOT EXISTS idx_ep_wood_prep_param_comments_submission_id
  ON europanel.wood_prep_param_comments(submission_id);

DROP TRIGGER IF EXISTS trg_wood_prep_param_comments_updated_at ON europanel.wood_prep_param_comments;
CREATE TRIGGER trg_wood_prep_param_comments_updated_at
  BEFORE UPDATE ON europanel.wood_prep_param_comments
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.wood_prep_param_comments TO authenticated;
GRANT ALL ON europanel.wood_prep_param_comments TO service_role;

ALTER TABLE europanel.wood_prep_param_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_wood_prep_param_comments_select" ON europanel.wood_prep_param_comments
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_wood_prep_param_comments_insert" ON europanel.wood_prep_param_comments
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_wood_prep_param_comments_update" ON europanel.wood_prep_param_comments
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_wood_prep_param_comments_delete" ON europanel.wood_prep_param_comments
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── raw_materials_section — page 3, 1:1 avec la soumission ───────────────────────
CREATE TABLE IF NOT EXISTS europanel.raw_materials_section (
  submission_id  BIGINT PRIMARY KEY REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  ref_year       SMALLINT,
  s32_comments   TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_raw_materials_section_updated_at ON europanel.raw_materials_section;
CREATE TRIGGER trg_raw_materials_section_updated_at
  BEFORE UPDATE ON europanel.raw_materials_section
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.raw_materials_section TO authenticated;
GRANT ALL ON europanel.raw_materials_section TO service_role;

ALTER TABLE europanel.raw_materials_section ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_raw_materials_section_select" ON europanel.raw_materials_section
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_raw_materials_section_insert" ON europanel.raw_materials_section
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_raw_materials_section_update" ON europanel.raw_materials_section
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_raw_materials_section_delete" ON europanel.raw_materials_section
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── raw_materials — page 3, groupe à clés (code, liste « raw_materials ») ────────
CREATE TABLE IF NOT EXISTS europanel.raw_materials (
  id             BIGSERIAL PRIMARY KEY,
  submission_id  BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  list_code      TEXT NOT NULL DEFAULT 'raw_materials' CHECK (list_code = 'raw_materials'),
  pct            NUMERIC,
  species        TEXT,
  source         TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, code),
  FOREIGN KEY (list_code, code) REFERENCES europanel.ref_lists (list_code, code)
);
CREATE INDEX IF NOT EXISTS idx_ep_raw_materials_submission_id
  ON europanel.raw_materials(submission_id);

DROP TRIGGER IF EXISTS trg_raw_materials_updated_at ON europanel.raw_materials;
CREATE TRIGGER trg_raw_materials_updated_at
  BEFORE UPDATE ON europanel.raw_materials
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.raw_materials TO authenticated;
GRANT ALL ON europanel.raw_materials TO service_role;

ALTER TABLE europanel.raw_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_raw_materials_select" ON europanel.raw_materials
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_raw_materials_insert" ON europanel.raw_materials
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_raw_materials_update" ON europanel.raw_materials
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_raw_materials_delete" ON europanel.raw_materials
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── raw_material_specify — page 3, groupe à clés (code, liste « raw_materials_specify ») ───
CREATE TABLE IF NOT EXISTS europanel.raw_material_specify (
  id             BIGSERIAL PRIMARY KEY,
  submission_id  BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  list_code      TEXT NOT NULL DEFAULT 'raw_materials_specify' CHECK (list_code = 'raw_materials_specify'),
  specify        TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, code),
  FOREIGN KEY (list_code, code) REFERENCES europanel.ref_lists (list_code, code)
);
CREATE INDEX IF NOT EXISTS idx_ep_raw_material_specify_submission_id
  ON europanel.raw_material_specify(submission_id);

DROP TRIGGER IF EXISTS trg_raw_material_specify_updated_at ON europanel.raw_material_specify;
CREATE TRIGGER trg_raw_material_specify_updated_at
  BEFORE UPDATE ON europanel.raw_material_specify
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.raw_material_specify TO authenticated;
GRANT ALL ON europanel.raw_material_specify TO service_role;

ALTER TABLE europanel.raw_material_specify ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_raw_material_specify_select" ON europanel.raw_material_specify
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_raw_material_specify_insert" ON europanel.raw_material_specify
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_raw_material_specify_update" ON europanel.raw_material_specify
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_raw_material_specify_delete" ON europanel.raw_material_specify
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── resins — page 3, section répétable (idx) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS europanel.resins (
  id             BIGSERIAL PRIMARY KEY,
  submission_id  BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  idx            SMALLINT NOT NULL,
  type           TEXT,
  pct            NUMERIC,
  comments       TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_ep_resins_submission_id
  ON europanel.resins(submission_id);

DROP TRIGGER IF EXISTS trg_resins_updated_at ON europanel.resins;
CREATE TRIGGER trg_resins_updated_at
  BEFORE UPDATE ON europanel.resins
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.resins TO authenticated;
GRANT ALL ON europanel.resins TO service_role;

ALTER TABLE europanel.resins ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_resins_select" ON europanel.resins
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_resins_insert" ON europanel.resins
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_resins_update" ON europanel.resins
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_resins_delete" ON europanel.resins
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── hardeners — page 3, section répétable (idx) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS europanel.hardeners (
  id             BIGSERIAL PRIMARY KEY,
  submission_id  BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  idx            SMALLINT NOT NULL,
  type           TEXT,
  comments       TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_ep_hardeners_submission_id
  ON europanel.hardeners(submission_id);

DROP TRIGGER IF EXISTS trg_hardeners_updated_at ON europanel.hardeners;
CREATE TRIGGER trg_hardeners_updated_at
  BEFORE UPDATE ON europanel.hardeners
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.hardeners TO authenticated;
GRANT ALL ON europanel.hardeners TO service_role;

ALTER TABLE europanel.hardeners ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_hardeners_select" ON europanel.hardeners
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_hardeners_insert" ON europanel.hardeners
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_hardeners_update" ON europanel.hardeners
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_hardeners_delete" ON europanel.hardeners
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── additives — page 3, groupe à clés (code, liste « additives ») ────────────────
CREATE TABLE IF NOT EXISTS europanel.additives (
  id             BIGSERIAL PRIMARY KEY,
  submission_id  BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,
  list_code      TEXT NOT NULL DEFAULT 'additives' CHECK (list_code = 'additives'),
  type           TEXT,
  comments       TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, code),
  FOREIGN KEY (list_code, code) REFERENCES europanel.ref_lists (list_code, code)
);
CREATE INDEX IF NOT EXISTS idx_ep_additives_submission_id
  ON europanel.additives(submission_id);

DROP TRIGGER IF EXISTS trg_additives_updated_at ON europanel.additives;
CREATE TRIGGER trg_additives_updated_at
  BEFORE UPDATE ON europanel.additives
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.additives TO authenticated;
GRANT ALL ON europanel.additives TO service_role;

ALTER TABLE europanel.additives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_additives_select" ON europanel.additives
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_additives_insert" ON europanel.additives
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_additives_update" ON europanel.additives
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_additives_delete" ON europanel.additives
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── energy_section — page 4, 1:1 avec la soumission ──────────────────────────────
CREATE TABLE IF NOT EXISTS europanel.energy_section (
  submission_id         BIGINT PRIMARY KEY REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  ref_year              SMALLINT,
  comments              TEXT,
  s41_diagram_ref       TEXT,
  s43_steam             NUMERIC,
  s43_hot_oil           NUMERIC,
  s43_fluegas           NUMERIC,
  s43_other             NUMERIC,
  s43_cold_startups     SMALLINT,
  s43_warm_startups     SMALLINT,
  s43_maintenance_desc  TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_energy_section_updated_at ON europanel.energy_section;
CREATE TRIGGER trg_energy_section_updated_at
  BEFORE UPDATE ON europanel.energy_section
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.energy_section TO authenticated;
GRANT ALL ON europanel.energy_section TO service_role;

ALTER TABLE europanel.energy_section ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_energy_section_select" ON europanel.energy_section
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_energy_section_insert" ON europanel.energy_section
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_energy_section_update" ON europanel.energy_section
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_energy_section_delete" ON europanel.energy_section
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── combustion_units — page 4, section répétable (idx) ───────────────────────────
CREATE TABLE IF NOT EXISTS europanel.combustion_units (
  id               BIGSERIAL PRIMARY KEY,
  submission_id    BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  idx              SMALLINT NOT NULL,
  general_process  TEXT,
  equip_type       TEXT,
  boiler_detail    TEXT,
  engine_ignition  TEXT,
  chp              TEXT,
  suppl_fire       TEXT,
  dual_fuel        TEXT,
  install_year     SMALLINT,
  thermal_input    NUMERIC,
  energy_output    NUMERIC,
  hours_normal     NUMERIC,
  hours_special    NUMERIC,
  output_1         NUMERIC,
  output_2         NUMERIC,
  output_3         NUMERIC,
  output_4         NUMERIC,
  output_5         NUMERIC,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_ep_combustion_units_submission_id
  ON europanel.combustion_units(submission_id);

DROP TRIGGER IF EXISTS trg_combustion_units_updated_at ON europanel.combustion_units;
CREATE TRIGGER trg_combustion_units_updated_at
  BEFORE UPDATE ON europanel.combustion_units
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.combustion_units TO authenticated;
GRANT ALL ON europanel.combustion_units TO service_role;

ALTER TABLE europanel.combustion_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_combustion_units_select" ON europanel.combustion_units
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_combustion_units_insert" ON europanel.combustion_units
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_combustion_units_update" ON europanel.combustion_units
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_combustion_units_delete" ON europanel.combustion_units
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── combustion_unit_fuels — page 4, groupe à clés (code, liste « fuels »), enfant de combustion_units ───
CREATE TABLE IF NOT EXISTS europanel.combustion_unit_fuels (
  id                  BIGSERIAL PRIMARY KEY,
  combustion_unit_id  BIGINT NOT NULL REFERENCES europanel.combustion_units(id) ON DELETE CASCADE,
  code                TEXT NOT NULL,
  list_code           TEXT NOT NULL DEFAULT 'fuels' CHECK (list_code = 'fuels'),
  pct                 NUMERIC,
  description         TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (combustion_unit_id, code),
  FOREIGN KEY (list_code, code) REFERENCES europanel.ref_lists (list_code, code)
);
CREATE INDEX IF NOT EXISTS idx_ep_combustion_unit_fuels_combustion_unit_id
  ON europanel.combustion_unit_fuels(combustion_unit_id);

DROP TRIGGER IF EXISTS trg_combustion_unit_fuels_updated_at ON europanel.combustion_unit_fuels;
CREATE TRIGGER trg_combustion_unit_fuels_updated_at
  BEFORE UPDATE ON europanel.combustion_unit_fuels
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.combustion_unit_fuels TO authenticated;
GRANT ALL ON europanel.combustion_unit_fuels TO service_role;

ALTER TABLE europanel.combustion_unit_fuels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_combustion_unit_fuels_select" ON europanel.combustion_unit_fuels
  FOR SELECT TO authenticated USING (combustion_unit_id IN (SELECT id FROM europanel.combustion_units WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));
CREATE POLICY "ep_combustion_unit_fuels_insert" ON europanel.combustion_unit_fuels
  FOR INSERT TO authenticated WITH CHECK (combustion_unit_id IN (SELECT id FROM europanel.combustion_units WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));
CREATE POLICY "ep_combustion_unit_fuels_update" ON europanel.combustion_unit_fuels
  FOR UPDATE TO authenticated USING (combustion_unit_id IN (SELECT id FROM europanel.combustion_units WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));
CREATE POLICY "ep_combustion_unit_fuels_delete" ON europanel.combustion_unit_fuels
  FOR DELETE TO authenticated USING (combustion_unit_id IN (SELECT id FROM europanel.combustion_units WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));

-- ─── press_dryer_section — page 5, 1:1 avec la soumission ─────────────────────────
CREATE TABLE IF NOT EXISTS europanel.press_dryer_section (
  submission_id  BIGINT PRIMARY KEY REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  comments       TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_press_dryer_section_updated_at ON europanel.press_dryer_section;
CREATE TRIGGER trg_press_dryer_section_updated_at
  BEFORE UPDATE ON europanel.press_dryer_section
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.press_dryer_section TO authenticated;
GRANT ALL ON europanel.press_dryer_section TO service_role;

ALTER TABLE europanel.press_dryer_section ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_press_dryer_section_select" ON europanel.press_dryer_section
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_press_dryer_section_insert" ON europanel.press_dryer_section
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_press_dryer_section_update" ON europanel.press_dryer_section
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_press_dryer_section_delete" ON europanel.press_dryer_section
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── dryers — page 5, section répétable (idx) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS europanel.dryers (
  id              BIGSERIAL PRIMARY KEY,
  submission_id   BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  idx             SMALLINT NOT NULL,
  ref_year        SMALLINT,
  main_type       TEXT,
  system_desc     TEXT,
  product         TEXT,
  install_year    SMALLINT,
  temp_min        NUMERIC,
  temp_max        NUMERIC,
  outlet_temp     NUMERIC,
  mc_before       NUMERIC,
  mc_after        NUMERIC,
  product_dried   NUMERIC,
  drying_rate     NUMERIC,
  residence_val   NUMERIC,
  residence_unit  TEXT,
  recirculation   TEXT,
  heat_regained   TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_ep_dryers_submission_id
  ON europanel.dryers(submission_id);

DROP TRIGGER IF EXISTS trg_dryers_updated_at ON europanel.dryers;
CREATE TRIGGER trg_dryers_updated_at
  BEFORE UPDATE ON europanel.dryers
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.dryers TO authenticated;
GRANT ALL ON europanel.dryers TO service_role;

ALTER TABLE europanel.dryers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_dryers_select" ON europanel.dryers
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_dryers_insert" ON europanel.dryers
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_dryers_update" ON europanel.dryers
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_dryers_delete" ON europanel.dryers
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── presses — page 5, section répétable (idx) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS europanel.presses (
  id                 BIGSERIAL PRIMARY KEY,
  submission_id      BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  idx                SMALLINT NOT NULL,
  ref_year           SMALLINT,
  main_type          TEXT,
  system_desc        TEXT,
  product            TEXT,
  install_year       SMALLINT,
  output             NUMERIC,
  factor             NUMERIC,
  temp               NUMERIC,
  pressure           NUMERIC,
  exhaust_collected  TEXT,
  abatement          TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_ep_presses_submission_id
  ON europanel.presses(submission_id);

DROP TRIGGER IF EXISTS trg_presses_updated_at ON europanel.presses;
CREATE TRIGGER trg_presses_updated_at
  BEFORE UPDATE ON europanel.presses
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.presses TO authenticated;
GRANT ALL ON europanel.presses TO service_role;

ALTER TABLE europanel.presses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_presses_select" ON europanel.presses
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_presses_insert" ON europanel.presses
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_presses_update" ON europanel.presses
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_presses_delete" ON europanel.presses
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── dust_section — page 6, 1:1 avec la soumission ────────────────────────────────
CREATE TABLE IF NOT EXISTS europanel.dust_section (
  submission_id            BIGINT PRIMARY KEY REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  s62_equip_desc           TEXT,
  s62_collected_dust       NUMERIC,
  s62_dust_fate            TEXT,
  s62_energy_recovery_pct  NUMERIC,
  s62_monitoring           TEXT,
  s62_control_measures     TEXT,
  s62_comments             TEXT,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_dust_section_updated_at ON europanel.dust_section;
CREATE TRIGGER trg_dust_section_updated_at
  BEFORE UPDATE ON europanel.dust_section
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.dust_section TO authenticated;
GRANT ALL ON europanel.dust_section TO service_role;

ALTER TABLE europanel.dust_section ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_dust_section_select" ON europanel.dust_section
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_dust_section_insert" ON europanel.dust_section
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_dust_section_update" ON europanel.dust_section
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_dust_section_delete" ON europanel.dust_section
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── abatement_techniques — page 6, section répétable (idx) ───────────────────────
CREATE TABLE IF NOT EXISTS europanel.abatement_techniques (
  id                  BIGSERIAL PRIMARY KEY,
  submission_id       BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  idx                 SMALLINT NOT NULL,
  name                TEXT,
  install_year        SMALLINT,
  annex_ref           TEXT,
  design_features     TEXT,
  removal_efficiency  TEXT,
  comments            TEXT,
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_ep_abatement_techniques_submission_id
  ON europanel.abatement_techniques(submission_id);

DROP TRIGGER IF EXISTS trg_abatement_techniques_updated_at ON europanel.abatement_techniques;
CREATE TRIGGER trg_abatement_techniques_updated_at
  BEFORE UPDATE ON europanel.abatement_techniques
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.abatement_techniques TO authenticated;
GRANT ALL ON europanel.abatement_techniques TO service_role;

ALTER TABLE europanel.abatement_techniques ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_abatement_techniques_select" ON europanel.abatement_techniques
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_abatement_techniques_insert" ON europanel.abatement_techniques
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_abatement_techniques_update" ON europanel.abatement_techniques
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_abatement_techniques_delete" ON europanel.abatement_techniques
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── abatement_technique_sources — page 6, groupe à clés (code, liste « waste_gas_sources »), enfant de abatement_techniques ───
CREATE TABLE IF NOT EXISTS europanel.abatement_technique_sources (
  id                      BIGSERIAL PRIMARY KEY,
  abatement_technique_id  BIGINT NOT NULL REFERENCES europanel.abatement_techniques(id) ON DELETE CASCADE,
  code                    TEXT NOT NULL,
  list_code               TEXT NOT NULL DEFAULT 'waste_gas_sources' CHECK (list_code = 'waste_gas_sources'),
  yn                      TEXT,
  spec                    TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (abatement_technique_id, code),
  FOREIGN KEY (list_code, code) REFERENCES europanel.ref_lists (list_code, code)
);
CREATE INDEX IF NOT EXISTS idx_ep_abatement_technique_sources_abatement_technique_id
  ON europanel.abatement_technique_sources(abatement_technique_id);

DROP TRIGGER IF EXISTS trg_abatement_technique_sources_updated_at ON europanel.abatement_technique_sources;
CREATE TRIGGER trg_abatement_technique_sources_updated_at
  BEFORE UPDATE ON europanel.abatement_technique_sources
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.abatement_technique_sources TO authenticated;
GRANT ALL ON europanel.abatement_technique_sources TO service_role;

ALTER TABLE europanel.abatement_technique_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_abatement_technique_sources_select" ON europanel.abatement_technique_sources
  FOR SELECT TO authenticated USING (abatement_technique_id IN (SELECT id FROM europanel.abatement_techniques WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));
CREATE POLICY "ep_abatement_technique_sources_insert" ON europanel.abatement_technique_sources
  FOR INSERT TO authenticated WITH CHECK (abatement_technique_id IN (SELECT id FROM europanel.abatement_techniques WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));
CREATE POLICY "ep_abatement_technique_sources_update" ON europanel.abatement_technique_sources
  FOR UPDATE TO authenticated USING (abatement_technique_id IN (SELECT id FROM europanel.abatement_techniques WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));
CREATE POLICY "ep_abatement_technique_sources_delete" ON europanel.abatement_technique_sources
  FOR DELETE TO authenticated USING (abatement_technique_id IN (SELECT id FROM europanel.abatement_techniques WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));

-- ─── abatement_technique_flows — page 6, groupe à clés (code, liste « abatement_flows »), enfant de abatement_techniques ───
CREATE TABLE IF NOT EXISTS europanel.abatement_technique_flows (
  id                      BIGSERIAL PRIMARY KEY,
  abatement_technique_id  BIGINT NOT NULL REFERENCES europanel.abatement_techniques(id) ON DELETE CASCADE,
  code                    TEXT NOT NULL,
  list_code               TEXT NOT NULL DEFAULT 'abatement_flows' CHECK (list_code = 'abatement_flows'),
  val                     NUMERIC,
  comment                 TEXT,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (abatement_technique_id, code),
  FOREIGN KEY (list_code, code) REFERENCES europanel.ref_lists (list_code, code)
);
CREATE INDEX IF NOT EXISTS idx_ep_abatement_technique_flows_abatement_technique_id
  ON europanel.abatement_technique_flows(abatement_technique_id);

DROP TRIGGER IF EXISTS trg_abatement_technique_flows_updated_at ON europanel.abatement_technique_flows;
CREATE TRIGGER trg_abatement_technique_flows_updated_at
  BEFORE UPDATE ON europanel.abatement_technique_flows
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.abatement_technique_flows TO authenticated;
GRANT ALL ON europanel.abatement_technique_flows TO service_role;

ALTER TABLE europanel.abatement_technique_flows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_abatement_technique_flows_select" ON europanel.abatement_technique_flows
  FOR SELECT TO authenticated USING (abatement_technique_id IN (SELECT id FROM europanel.abatement_techniques WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));
CREATE POLICY "ep_abatement_technique_flows_insert" ON europanel.abatement_technique_flows
  FOR INSERT TO authenticated WITH CHECK (abatement_technique_id IN (SELECT id FROM europanel.abatement_techniques WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));
CREATE POLICY "ep_abatement_technique_flows_update" ON europanel.abatement_technique_flows
  FOR UPDATE TO authenticated USING (abatement_technique_id IN (SELECT id FROM europanel.abatement_techniques WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));
CREATE POLICY "ep_abatement_technique_flows_delete" ON europanel.abatement_technique_flows
  FOR DELETE TO authenticated USING (abatement_technique_id IN (SELECT id FROM europanel.abatement_techniques WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));

-- ─── emission_points — page 7, section répétable (idx) ────────────────────────────
CREATE TABLE IF NOT EXISTS europanel.emission_points (
  id              BIGSERIAL PRIMARY KEY,
  submission_id   BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  idx             SMALLINT NOT NULL,
  point_ref       TEXT,
  ref_year        TEXT,
  refcond         TEXT,
  waste_gas_desc  TEXT,
  comments        TEXT,
  cross_section   NUMERIC,
  air_pressure    NUMERIC,
  temp_dry        NUMERIC,
  temp_wet        NUMERIC,
  o2              NUMERIC,
  co2             NUMERIC,
  co_gas          NUMERIC,
  inert           NUMERIC,
  moisture        NUMERIC,
  density_std     NUMERIC,
  flow_actual     NUMERIC,
  flow_std        NUMERIC,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_ep_emission_points_submission_id
  ON europanel.emission_points(submission_id);

DROP TRIGGER IF EXISTS trg_emission_points_updated_at ON europanel.emission_points;
CREATE TRIGGER trg_emission_points_updated_at
  BEFORE UPDATE ON europanel.emission_points
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.emission_points TO authenticated;
GRANT ALL ON europanel.emission_points TO service_role;

ALTER TABLE europanel.emission_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_emission_points_select" ON europanel.emission_points
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_emission_points_insert" ON europanel.emission_points
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_emission_points_update" ON europanel.emission_points
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_emission_points_delete" ON europanel.emission_points
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── emission_point_pollutants — page 7, groupe à clés (code, liste « pollutants »), enfant de emission_points ───
CREATE TABLE IF NOT EXISTS europanel.emission_point_pollutants (
  id                 BIGSERIAL PRIMARY KEY,
  emission_point_id  BIGINT NOT NULL REFERENCES europanel.emission_points(id) ON DELETE CASCADE,
  code               TEXT NOT NULL,
  list_code          TEXT NOT NULL DEFAULT 'pollutants' CHECK (list_code = 'pollutants'),
  conc               NUMERIC,
  method             TEXT,
  t_year             NUMERIC,
  short_term         TEXT,
  short_val          NUMERIC,
  limit_val          TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (emission_point_id, code),
  FOREIGN KEY (list_code, code) REFERENCES europanel.ref_lists (list_code, code)
);
CREATE INDEX IF NOT EXISTS idx_ep_emission_point_pollutants_emission_point_id
  ON europanel.emission_point_pollutants(emission_point_id);

DROP TRIGGER IF EXISTS trg_emission_point_pollutants_updated_at ON europanel.emission_point_pollutants;
CREATE TRIGGER trg_emission_point_pollutants_updated_at
  BEFORE UPDATE ON europanel.emission_point_pollutants
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.emission_point_pollutants TO authenticated;
GRANT ALL ON europanel.emission_point_pollutants TO service_role;

ALTER TABLE europanel.emission_point_pollutants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_emission_point_pollutants_select" ON europanel.emission_point_pollutants
  FOR SELECT TO authenticated USING (emission_point_id IN (SELECT id FROM europanel.emission_points WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));
CREATE POLICY "ep_emission_point_pollutants_insert" ON europanel.emission_point_pollutants
  FOR INSERT TO authenticated WITH CHECK (emission_point_id IN (SELECT id FROM europanel.emission_points WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));
CREATE POLICY "ep_emission_point_pollutants_update" ON europanel.emission_point_pollutants
  FOR UPDATE TO authenticated USING (emission_point_id IN (SELECT id FROM europanel.emission_points WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));
CREATE POLICY "ep_emission_point_pollutants_delete" ON europanel.emission_point_pollutants
  FOR DELETE TO authenticated USING (emission_point_id IN (SELECT id FROM europanel.emission_points WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));

-- ─── waste_water_discharges — page 8, section répétable (idx) ─────────────────────
CREATE TABLE IF NOT EXISTS europanel.waste_water_discharges (
  id             BIGSERIAL PRIMARY KEY,
  submission_id  BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  idx            SMALLINT NOT NULL,
  discharge_id   TEXT,
  ref_year       TEXT,
  treated        TEXT,
  wwtp_desc      TEXT,
  sludge_fate    TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_ep_waste_water_discharges_submission_id
  ON europanel.waste_water_discharges(submission_id);

DROP TRIGGER IF EXISTS trg_waste_water_discharges_updated_at ON europanel.waste_water_discharges;
CREATE TRIGGER trg_waste_water_discharges_updated_at
  BEFORE UPDATE ON europanel.waste_water_discharges
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.waste_water_discharges TO authenticated;
GRANT ALL ON europanel.waste_water_discharges TO service_role;

ALTER TABLE europanel.waste_water_discharges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_waste_water_discharges_select" ON europanel.waste_water_discharges
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_waste_water_discharges_insert" ON europanel.waste_water_discharges
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_waste_water_discharges_update" ON europanel.waste_water_discharges
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_waste_water_discharges_delete" ON europanel.waste_water_discharges
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── waste_water_pollutants — page 8, groupe à clés (code, liste « ww_pollutants »), enfant de waste_water_discharges ───
CREATE TABLE IF NOT EXISTS europanel.waste_water_pollutants (
  id                        BIGSERIAL PRIMARY KEY,
  waste_water_discharge_id  BIGINT NOT NULL REFERENCES europanel.waste_water_discharges(id) ON DELETE CASCADE,
  code                      TEXT NOT NULL,
  list_code                 TEXT NOT NULL DEFAULT 'ww_pollutants' CHECK (list_code = 'ww_pollutants'),
  conc                      NUMERIC,
  freq                      TEXT,
  pos                       TEXT,
  comments                  TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (waste_water_discharge_id, code),
  FOREIGN KEY (list_code, code) REFERENCES europanel.ref_lists (list_code, code)
);
CREATE INDEX IF NOT EXISTS idx_ep_waste_water_pollutants_waste_water_discharge_id
  ON europanel.waste_water_pollutants(waste_water_discharge_id);

DROP TRIGGER IF EXISTS trg_waste_water_pollutants_updated_at ON europanel.waste_water_pollutants;
CREATE TRIGGER trg_waste_water_pollutants_updated_at
  BEFORE UPDATE ON europanel.waste_water_pollutants
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.waste_water_pollutants TO authenticated;
GRANT ALL ON europanel.waste_water_pollutants TO service_role;

ALTER TABLE europanel.waste_water_pollutants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_waste_water_pollutants_select" ON europanel.waste_water_pollutants
  FOR SELECT TO authenticated USING (waste_water_discharge_id IN (SELECT id FROM europanel.waste_water_discharges WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));
CREATE POLICY "ep_waste_water_pollutants_insert" ON europanel.waste_water_pollutants
  FOR INSERT TO authenticated WITH CHECK (waste_water_discharge_id IN (SELECT id FROM europanel.waste_water_discharges WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));
CREATE POLICY "ep_waste_water_pollutants_update" ON europanel.waste_water_pollutants
  FOR UPDATE TO authenticated USING (waste_water_discharge_id IN (SELECT id FROM europanel.waste_water_discharges WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));
CREATE POLICY "ep_waste_water_pollutants_delete" ON europanel.waste_water_pollutants
  FOR DELETE TO authenticated USING (waste_water_discharge_id IN (SELECT id FROM europanel.waste_water_discharges WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));

-- ─── waste_water_sources — page 8, groupe à clés (code, liste « ww_sources »), enfant de waste_water_discharges ───
CREATE TABLE IF NOT EXISTS europanel.waste_water_sources (
  id                        BIGSERIAL PRIMARY KEY,
  waste_water_discharge_id  BIGINT NOT NULL REFERENCES europanel.waste_water_discharges(id) ON DELETE CASCADE,
  code                      TEXT NOT NULL,
  list_code                 TEXT NOT NULL DEFAULT 'ww_sources' CHECK (list_code = 'ww_sources'),
  vol                       NUMERIC,
  comment                   TEXT,
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (waste_water_discharge_id, code),
  FOREIGN KEY (list_code, code) REFERENCES europanel.ref_lists (list_code, code)
);
CREATE INDEX IF NOT EXISTS idx_ep_waste_water_sources_waste_water_discharge_id
  ON europanel.waste_water_sources(waste_water_discharge_id);

DROP TRIGGER IF EXISTS trg_waste_water_sources_updated_at ON europanel.waste_water_sources;
CREATE TRIGGER trg_waste_water_sources_updated_at
  BEFORE UPDATE ON europanel.waste_water_sources
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.waste_water_sources TO authenticated;
GRANT ALL ON europanel.waste_water_sources TO service_role;

ALTER TABLE europanel.waste_water_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_waste_water_sources_select" ON europanel.waste_water_sources
  FOR SELECT TO authenticated USING (waste_water_discharge_id IN (SELECT id FROM europanel.waste_water_discharges WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));
CREATE POLICY "ep_waste_water_sources_insert" ON europanel.waste_water_sources
  FOR INSERT TO authenticated WITH CHECK (waste_water_discharge_id IN (SELECT id FROM europanel.waste_water_discharges WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));
CREATE POLICY "ep_waste_water_sources_update" ON europanel.waste_water_sources
  FOR UPDATE TO authenticated USING (waste_water_discharge_id IN (SELECT id FROM europanel.waste_water_discharges WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));
CREATE POLICY "ep_waste_water_sources_delete" ON europanel.waste_water_sources
  FOR DELETE TO authenticated USING (waste_water_discharge_id IN (SELECT id FROM europanel.waste_water_discharges WHERE submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())));

-- ─── waste_section — page 9, 1:1 avec la soumission ───────────────────────────────
CREATE TABLE IF NOT EXISTS europanel.waste_section (
  submission_id         BIGINT PRIMARY KEY REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  waste_comments        TEXT,
  waste_bat_techniques  TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_waste_section_updated_at ON europanel.waste_section;
CREATE TRIGGER trg_waste_section_updated_at
  BEFORE UPDATE ON europanel.waste_section
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.waste_section TO authenticated;
GRANT ALL ON europanel.waste_section TO service_role;

ALTER TABLE europanel.waste_section ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_waste_section_select" ON europanel.waste_section
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_waste_section_insert" ON europanel.waste_section
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_waste_section_update" ON europanel.waste_section
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_waste_section_delete" ON europanel.waste_section
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── waste_streams — page 9, section répétable (idx) ──────────────────────────────
CREATE TABLE IF NOT EXISTS europanel.waste_streams (
  id             BIGSERIAL PRIMARY KEY,
  submission_id  BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  idx            SMALLINT NOT NULL,
  description    TEXT,
  ewc            TEXT,
  source         TEXT,
  qty            NUMERIC,
  dest           TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (submission_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_ep_waste_streams_submission_id
  ON europanel.waste_streams(submission_id);

DROP TRIGGER IF EXISTS trg_waste_streams_updated_at ON europanel.waste_streams;
CREATE TRIGGER trg_waste_streams_updated_at
  BEFORE UPDATE ON europanel.waste_streams
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.waste_streams TO authenticated;
GRANT ALL ON europanel.waste_streams TO service_role;

ALTER TABLE europanel.waste_streams ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_waste_streams_select" ON europanel.waste_streams
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_waste_streams_insert" ON europanel.waste_streams
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_waste_streams_update" ON europanel.waste_streams
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_waste_streams_delete" ON europanel.waste_streams
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── water_consumption — page 10, 1:1 avec la soumission ───────────────────────────
CREATE TABLE IF NOT EXISTS europanel.water_consumption (
  submission_id         BIGINT PRIMARY KEY REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  wc_process            NUMERIC,
  wc_cooling            NUMERIC,
  wc_steam              NUMERIC,
  wc_sanitary           NUMERIC,
  wc_other              NUMERIC,
  wc_refining_total     NUMERIC,
  wc_refining_recycled  NUMERIC,
  wc_recycling_savings  NUMERIC,
  wc_bat_techniques     TEXT,
  wc_comments           TEXT,
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_water_consumption_updated_at ON europanel.water_consumption;
CREATE TRIGGER trg_water_consumption_updated_at
  BEFORE UPDATE ON europanel.water_consumption
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.water_consumption TO authenticated;
GRANT ALL ON europanel.water_consumption TO service_role;

ALTER TABLE europanel.water_consumption ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_water_consumption_select" ON europanel.water_consumption
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_water_consumption_insert" ON europanel.water_consumption
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_water_consumption_update" ON europanel.water_consumption
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_water_consumption_delete" ON europanel.water_consumption
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ─── bat_candidate — page 11, 1:1 avec la soumission ───────────────────────────────
CREATE TABLE IF NOT EXISTS europanel.bat_candidate (
  submission_id            BIGINT PRIMARY KEY REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  bat_plant_name           TEXT,
  bat_name                 TEXT,
  bat_tech_desc            TEXT,
  bat_install_year         TEXT,
  bat_rd_level             TEXT,
  bat_cat_rawmat           BOOLEAN,
  bat_cat_energy           BOOLEAN,
  bat_cat_air              BOOLEAN,
  bat_cat_water            BOOLEAN,
  bat_cat_primary_other    BOOLEAN,
  bat_cat_emissions        BOOLEAN,
  bat_cat_ww               BOOLEAN,
  bat_cat_solid            BOOLEAN,
  bat_cat_secondary_other  BOOLEAN,
  bat_env_air              TEXT,
  bat_env_water            TEXT,
  bat_env_energy           TEXT,
  bat_env_other            TEXT,
  bat_cross_media          TEXT,
  bat_applicability        TEXT,
  bat_invest_cost          TEXT,
  bat_oper_cost            TEXT,
  bat_cost_effectiveness   TEXT,
  bat_reference_plants     TEXT,
  bat_references           TEXT,
  bat_tech_comments        TEXT,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS trg_bat_candidate_updated_at ON europanel.bat_candidate;
CREATE TRIGGER trg_bat_candidate_updated_at
  BEFORE UPDATE ON europanel.bat_candidate
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON europanel.bat_candidate TO authenticated;
GRANT ALL ON europanel.bat_candidate TO service_role;

ALTER TABLE europanel.bat_candidate ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ep_bat_candidate_select" ON europanel.bat_candidate
  FOR SELECT TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_bat_candidate_insert" ON europanel.bat_candidate
  FOR INSERT TO authenticated WITH CHECK (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_bat_candidate_update" ON europanel.bat_candidate
  FOR UPDATE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));
CREATE POLICY "ep_bat_candidate_delete" ON europanel.bat_candidate
  FOR DELETE TO authenticated USING (submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid()));

-- ══════════════════════════════════════════════════════════════════════
--  Privilèges sur les séquences (BIGSERIAL) : sans ce GRANT, un INSERT
--  par authenticated échoue à l'obtention de la valeur suivante, même
--  si la table elle-même lui est accessible.
-- ══════════════════════════════════════════════════════════════════════
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA europanel TO authenticated, service_role;
