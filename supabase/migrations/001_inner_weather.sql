-- Apply with a privileged migration connection. Request handlers switch to authenticated.
CREATE TABLE IF NOT EXISTS public.users (id uuid PRIMARY KEY, email text UNIQUE NOT NULL, password_hash text, auth_kind text NOT NULL DEFAULT 'local', created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.profiles (user_id uuid PRIMARY KEY REFERENCES public.users ON DELETE CASCADE, timezone text NOT NULL DEFAULT 'Asia/Tokyo', display_name text NOT NULL DEFAULT '', ai_consent boolean NOT NULL DEFAULT false, consent_at timestamptz);
CREATE TABLE IF NOT EXISTS public.local_sessions (id text PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users ON DELETE CASCADE, expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS public.journal_entries (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users ON DELETE CASCADE, recorded_at timestamptz NOT NULL DEFAULT now(), event_date date, date_kind text NOT NULL CHECK (date_kind IN ('explicit','estimated','unknown')), payload text NOT NULL, source_message_id uuid, candidate_id uuid UNIQUE, updated_at timestamptz NOT NULL DEFAULT now(), CHECK ((event_date IS NULL) = (date_kind = 'unknown')));
CREATE TABLE IF NOT EXISTS public.emotions (id text PRIMARY KEY, label text NOT NULL);
INSERT INTO public.emotions VALUES ('joy','喜び'),('calm','穏やか'),('anxiety','不安'),('sadness','悲しみ'),('anger','怒り'),('gratitude','感謝'),('hope','希望'),('loneliness','孤独') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS public.emotion_scores (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users ON DELETE CASCADE, journal_id uuid NOT NULL REFERENCES public.journal_entries ON DELETE CASCADE, emotion_id text NOT NULL REFERENCES public.emotions, score real NOT NULL CHECK(score BETWEEN 0 AND 10), UNIQUE(journal_id,emotion_id));
CREATE TABLE IF NOT EXISTS public.anchors (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users ON DELETE CASCADE, journal_id uuid NOT NULL UNIQUE REFERENCES public.journal_entries ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.import_jobs (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users ON DELETE CASCADE, fingerprint text NOT NULL, status text NOT NULL CHECK(status IN ('queued','running','paused','completed','failed')), method text NOT NULL CHECK(method IN ('local','openai')), consent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), total integer NOT NULL DEFAULT 0, processed integer NOT NULL DEFAULT 0, input_tokens integer NOT NULL DEFAULT 0, output_tokens integer NOT NULL DEFAULT 0, cost_usd real NOT NULL DEFAULT 0, error text, lease_until timestamptz, lease_token uuid, warnings text NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS public.imported_conversations (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users ON DELETE CASCADE, external_id text NOT NULL, payload text NOT NULL, created_at timestamptz, updated_at timestamptz, current_node text, UNIQUE(user_id,external_id));
CREATE TABLE IF NOT EXISTS public.imported_messages (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users ON DELETE CASCADE, conversation_id uuid NOT NULL REFERENCES public.imported_conversations ON DELETE CASCADE, external_id text NOT NULL, parent_external_id text, children jsonb NOT NULL DEFAULT '[]', role text NOT NULL CHECK(role IN ('user','assistant','system','tool')), sent_at timestamptz, on_path boolean NOT NULL DEFAULT false, payload text NOT NULL, content_hash text NOT NULL, UNIQUE(user_id,conversation_id,external_id));
CREATE TABLE IF NOT EXISTS public.import_job_conversations (user_id uuid NOT NULL REFERENCES public.users ON DELETE CASCADE, job_id uuid NOT NULL REFERENCES public.import_jobs ON DELETE CASCADE, conversation_id uuid NOT NULL REFERENCES public.imported_conversations ON DELETE CASCADE, PRIMARY KEY(job_id,conversation_id));
CREATE TABLE IF NOT EXISTS public.import_job_messages (user_id uuid NOT NULL REFERENCES public.users ON DELETE CASCADE, job_id uuid NOT NULL REFERENCES public.import_jobs ON DELETE CASCADE, message_id uuid NOT NULL REFERENCES public.imported_messages ON DELETE CASCADE, PRIMARY KEY(job_id,message_id));
CREATE TABLE IF NOT EXISTS public.import_job_items (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users ON DELETE CASCADE, job_id uuid NOT NULL REFERENCES public.import_jobs ON DELETE CASCADE, message_id uuid NOT NULL REFERENCES public.imported_messages ON DELETE CASCADE, chunk_index integer NOT NULL, payload text NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done','failed')), attempts integer NOT NULL DEFAULT 0, error text, UNIQUE(job_id,message_id,chunk_index));
CREATE TABLE IF NOT EXISTS public.extracted_journal_candidates (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users ON DELETE CASCADE, source_message_id uuid NOT NULL REFERENCES public.imported_messages ON DELETE CASCADE, chunk_index integer NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected')), payload text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,source_message_id,chunk_index));
ALTER TABLE public.journal_entries DROP CONSTRAINT IF EXISTS journal_entries_source_fk;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_source_fk FOREIGN KEY(source_message_id) REFERENCES public.imported_messages ON DELETE CASCADE;
ALTER TABLE public.journal_entries DROP CONSTRAINT IF EXISTS journal_entries_candidate_fk;
ALTER TABLE public.journal_entries ADD CONSTRAINT journal_entries_candidate_fk FOREIGN KEY(candidate_id) REFERENCES public.extracted_journal_candidates ON DELETE CASCADE;
CREATE TABLE IF NOT EXISTS public.ai_insights (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users ON DELETE CASCADE, period text NOT NULL, range_from date NOT NULL, range_to date NOT NULL, payload text NOT NULL, method text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.ai_chat_sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.ai_chat_messages (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users ON DELETE CASCADE, session_id uuid NOT NULL REFERENCES public.ai_chat_sessions ON DELETE CASCADE, role text NOT NULL CHECK(role IN ('user','assistant')), payload text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS messages_user_time ON public.imported_messages(user_id,sent_at);
CREATE INDEX IF NOT EXISTS journal_user_date ON public.journal_entries(user_id,event_date);
CREATE INDEX IF NOT EXISTS jobs_status ON public.import_jobs(status,lease_until);
CREATE INDEX IF NOT EXISTS items_pending ON public.import_job_items(job_id,status);
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.emotions TO authenticated;
ALTER TABLE public.emotions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS emotions_read ON public.emotions;
CREATE POLICY emotions_read ON public.emotions FOR SELECT TO authenticated USING(true);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['users','profiles','local_sessions','journal_entries','emotion_scores','anchors','import_jobs','imported_conversations','imported_messages','import_job_conversations','import_job_messages','import_job_items','extracted_journal_candidates','ai_insights','ai_chat_sessions','ai_chat_messages'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS own_rows ON public.%I',t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated',t);
    EXECUTE format('CREATE POLICY own_rows ON public.%I TO authenticated USING (%I = coalesce(nullif(current_setting(''request.jwt.claim.sub'',true),''''), nullif(current_setting(''request.jwt.claims'',true),'''')::jsonb->>''sub'')::uuid) WITH CHECK (%I = coalesce(nullif(current_setting(''request.jwt.claim.sub'',true),''''), nullif(current_setting(''request.jwt.claims'',true),'''')::jsonb->>''sub'')::uuid)', t, CASE WHEN t='users' THEN 'id' ELSE 'user_id' END, CASE WHEN t='users' THEN 'id' ELSE 'user_id' END);
  END LOOP;
END $$;
-- Block direct authenticated access to password hashes and session tokens.
REVOKE ALL ON public.users, public.local_sessions FROM authenticated;
-- Tenant-aware foreign keys prevent cross-user references even through direct Supabase REST.
DO $$ DECLARE t text; edge text[]; BEGIN
  FOREACH t IN ARRAY ARRAY['journal_entries','import_jobs','imported_conversations','imported_messages','extracted_journal_candidates','ai_chat_sessions'] LOOP
    BEGIN EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I UNIQUE(user_id,id)',t,t||'_tenant_unique'); EXCEPTION WHEN duplicate_table THEN NULL; WHEN duplicate_object THEN NULL; END;
  END LOOP;
  FOREACH edge SLICE 1 IN ARRAY ARRAY[
    ['emotion_scores','journal_id','journal_entries'],['anchors','journal_id','journal_entries'],
    ['imported_messages','conversation_id','imported_conversations'],
    ['import_job_conversations','job_id','import_jobs'],['import_job_conversations','conversation_id','imported_conversations'],
    ['import_job_messages','job_id','import_jobs'],['import_job_messages','message_id','imported_messages'],
    ['import_job_items','job_id','import_jobs'],['import_job_items','message_id','imported_messages'],
    ['extracted_journal_candidates','source_message_id','imported_messages'],
    ['journal_entries','source_message_id','imported_messages'],['journal_entries','candidate_id','extracted_journal_candidates'],
    ['ai_chat_messages','session_id','ai_chat_sessions']
  ] LOOP
    BEGIN EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY(user_id,%I) REFERENCES public.%I(user_id,id) ON DELETE CASCADE',edge[1],edge[1]||'_'||edge[2]||'_tenant_fk',edge[2],edge[3]); EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;
-- Large uploads persist normalized source data before bounded ingestion batches.
ALTER TABLE public.import_jobs ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'extract' CHECK(stage IN ('ingest','extract'));
ALTER TABLE public.import_jobs ADD COLUMN IF NOT EXISTS staging_payload text;
ALTER TABLE public.import_jobs ADD COLUMN IF NOT EXISTS ingest_cursor integer NOT NULL DEFAULT 0;
ALTER TABLE public.import_jobs ADD COLUMN IF NOT EXISTS ingest_total integer NOT NULL DEFAULT 0;
ALTER TABLE public.import_jobs ADD COLUMN IF NOT EXISTS added integer NOT NULL DEFAULT 0;
ALTER TABLE public.import_jobs ADD COLUMN IF NOT EXISTS duplicates integer NOT NULL DEFAULT 0;
ALTER TABLE public.import_job_items ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;
