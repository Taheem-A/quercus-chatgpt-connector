-- Quercus Pocket Cloud v1.
-- Apply only in the SEPARATE Quercus Pocket Cloud Neon database, after
-- provisioning Managed Better Auth and the Neon Data API.
-- Never run this against the University Planner databases.
CREATE TABLE IF NOT EXISTS public.pocket_snapshots (
  user_id text PRIMARY KEY NOT NULL DEFAULT (auth.user_id()),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  source_synced_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pocket_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pocket_snapshots FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='pocket_snapshots' AND policyname='pocket_own_read') THEN
    CREATE POLICY pocket_own_read ON public.pocket_snapshots
      FOR SELECT TO authenticated USING (user_id = (SELECT auth.user_id()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='pocket_snapshots' AND policyname='pocket_own_insert') THEN
    CREATE POLICY pocket_own_insert ON public.pocket_snapshots
      FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.user_id()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='pocket_snapshots' AND policyname='pocket_own_update') THEN
    CREATE POLICY pocket_own_update ON public.pocket_snapshots
      FOR UPDATE TO authenticated USING (user_id = (SELECT auth.user_id()))
      WITH CHECK (user_id = (SELECT auth.user_id()));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public'
    AND tablename='pocket_snapshots' AND policyname='pocket_own_delete') THEN
    CREATE POLICY pocket_own_delete ON public.pocket_snapshots
      FOR DELETE TO authenticated USING (user_id = (SELECT auth.user_id()));
  END IF;
END $$;

REVOKE ALL ON public.pocket_snapshots FROM PUBLIC, anonymous;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pocket_snapshots TO authenticated;

-- Runtime identity is supplied and JWT-verified by the Neon Data API.
-- Do not grant anonymous read/write or disable FORCE ROW LEVEL SECURITY.
-- Concurrent writes use the revision equality condition in the client
-- and are rejected if a second device has already committed a revision.
