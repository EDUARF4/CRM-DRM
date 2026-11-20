-- Run only AFTER migration 062, server configuration and deployment approval.
-- The matching AGENDA_CRON_SECRET must already be stored in Supabase Vault.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'drm_agenda_cron_secret' AND length(decrypted_secret) >= 32)
    THEN RAISE EXCEPTION 'Configure drm_agenda_cron_secret in Vault first'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.invoke_service_agenda_worker()
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE secret text;
BEGIN
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name = 'drm_agenda_cron_secret';
  IF secret IS NULL OR length(secret)<32 THEN RAISE EXCEPTION 'Agenda secret missing'; END IF;
  RETURN net.http_post(
    url := 'https://lightblue-reindeer-349968.hostingersite.com/api/agenda/reminders/run',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',secret),
    body := '{}'::jsonb, timeout_milliseconds := 55000
  );
END;
$$;
ALTER FUNCTION public.invoke_service_agenda_worker() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.invoke_service_agenda_worker() FROM PUBLIC, anon, authenticated, service_role;
SELECT cron.schedule('drm-service-reminders', '* * * * *', 'SELECT public.invoke_service_agenda_worker();');
