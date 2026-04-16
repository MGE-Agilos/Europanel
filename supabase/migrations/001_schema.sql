-- ══════════════════════════════════════════════════════════════════════
--  EuroPanel — WBP BREF Data Collection
--  Supabase / PostgreSQL  ·  Schema: europanel
--
--  IMPORTANT: After running this migration, go to:
--  Supabase Dashboard → Project Settings → API → Exposed schemas
--  and add "europanel" to the list so PostgREST can serve it.
-- ══════════════════════════════════════════════════════════════════════

-- ─── Schema ───────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS europanel;

-- Grant access to Supabase roles
GRANT USAGE ON SCHEMA europanel TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA europanel
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA europanel
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- ─── Companies ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS europanel.companies (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  country     TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Submissions ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS europanel.submissions (
  id              BIGSERIAL PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id      BIGINT REFERENCES europanel.companies(id),
  status          TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted')),
  reference_year  SMALLINT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  submitted_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Page data (one row per page per submission) ─────────────────────
CREATE TABLE IF NOT EXISTS europanel.page_data (
  submission_id  BIGINT NOT NULL REFERENCES europanel.submissions(id) ON DELETE CASCADE,
  page_id        SMALLINT NOT NULL CHECK (page_id BETWEEN 0 AND 12),
  data           JSONB NOT NULL DEFAULT '{}',
  saved_at       TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (submission_id, page_id)
);

-- ─── Indexes ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_ep_submissions_user ON europanel.submissions(user_id);
CREATE INDEX IF NOT EXISTS idx_ep_page_data_sub    ON europanel.page_data(submission_id);

-- ─── updated_at trigger ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION europanel.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_submissions_updated_at ON europanel.submissions;
CREATE TRIGGER trg_submissions_updated_at
  BEFORE UPDATE ON europanel.submissions
  FOR EACH ROW EXECUTE FUNCTION europanel.set_updated_at();

-- ─── Row Level Security ───────────────────────────────────────────────
ALTER TABLE europanel.companies   ENABLE ROW LEVEL SECURITY;
ALTER TABLE europanel.submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE europanel.page_data   ENABLE ROW LEVEL SECURITY;

-- Companies: readable / writable by any authenticated user
CREATE POLICY "ep_companies_select" ON europanel.companies
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "ep_companies_insert" ON europanel.companies
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "ep_companies_update" ON europanel.companies
  FOR UPDATE TO authenticated USING (true);

-- Submissions: users own their rows
CREATE POLICY "ep_submissions_select" ON europanel.submissions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "ep_submissions_insert" ON europanel.submissions
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "ep_submissions_update" ON europanel.submissions
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- Page data: accessible only through owned submissions
CREATE POLICY "ep_page_data_select" ON europanel.page_data
  FOR SELECT TO authenticated USING (
    submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())
  );
CREATE POLICY "ep_page_data_insert" ON europanel.page_data
  FOR INSERT TO authenticated WITH CHECK (
    submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())
  );
CREATE POLICY "ep_page_data_update" ON europanel.page_data
  FOR UPDATE TO authenticated USING (
    submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())
  );
CREATE POLICY "ep_page_data_delete" ON europanel.page_data
  FOR DELETE TO authenticated USING (
    submission_id IN (SELECT id FROM europanel.submissions WHERE user_id = auth.uid())
  );
