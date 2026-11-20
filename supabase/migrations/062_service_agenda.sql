BEGIN;
CREATE TABLE IF NOT EXISTS public.service_appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  contact_name text NOT NULL,
  assigned_agent_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  unit_reference text NOT NULL CHECK (length(unit_reference) BETWEEN 1 AND 120),
  service_type text NOT NULL CHECK (length(service_type) BETWEEN 1 AND 120),
  location text NOT NULL CHECK (length(location) BETWEEN 1 AND 200),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','confirmed','completed','cancelled')),
  odometer_km integer CHECK (odometer_km >= 0),
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  version integer NOT NULL DEFAULT 1,
  reminder_enabled boolean NOT NULL DEFAULT false,
  reminder_consent boolean NOT NULL DEFAULT false,
  reminder_minutes integer NOT NULL DEFAULT 1440 CHECK (reminder_minutes IN (60,120,1440)),
  reminder_revision integer NOT NULL DEFAULT 1,
  reminder_state text NOT NULL DEFAULT 'disabled' CHECK (reminder_state IN ('disabled','pending','sending','sent','failed','review')),
  reminder_attempted_at timestamptz,
  reminder_sent_at timestamptz,
  reminder_message_id uuid,
  reminder_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at AND ends_at <= starts_at + interval '12 hours'),
  CHECK (NOT reminder_enabled OR reminder_consent)
);
CREATE INDEX IF NOT EXISTS service_appointments_calendar_idx ON public.service_appointments(account_id, starts_at);
CREATE INDEX IF NOT EXISTS service_appointments_due_idx ON public.service_appointments(starts_at) WHERE reminder_state = 'pending';
ALTER TABLE public.service_appointments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_appointments FROM anon, authenticated;
GRANT SELECT ON public.service_appointments TO authenticated;
GRANT ALL ON public.service_appointments TO service_role;
DROP POLICY IF EXISTS service_appointments_read ON public.service_appointments;
CREATE POLICY service_appointments_read ON public.service_appointments FOR SELECT TO authenticated
  USING (public.is_account_member(account_id, 'viewer'));

-- Server-only mutations: optimistic versions, account-scoped contacts/staff,
-- a per-account lock for overlapping bookings and a local opt-in per visit.
CREATE OR REPLACE FUNCTION public.save_service_appointment(
  p_id uuid, p_account_id uuid, p_actor_id uuid, p_expected_version integer, p_values jsonb
) RETURNS public.service_appointments LANGUAGE plpgsql SET search_path = public AS $$
DECLARE old_row public.service_appointments; result public.service_appointments;
  client public.contacts; assigned uuid; selected_contact uuid; active boolean; changed boolean;
  start_time timestamptz; end_time timestamptz; enabled boolean; consent boolean; minutes integer; state text;
BEGIN
  PERFORM 1 FROM public.profiles WHERE user_id = p_actor_id AND account_id = p_account_id
    AND account_role IN ('owner','admin','agent') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENDA_FORBIDDEN'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('agenda:' || p_account_id::text, 0));
  SELECT * INTO old_row FROM public.service_appointments WHERE id = p_id AND account_id = p_account_id FOR UPDATE;
  IF (old_row.id IS NULL AND p_expected_version <> 0) OR
     (old_row.id IS NOT NULL AND old_row.version <> p_expected_version) THEN RAISE EXCEPTION 'AGENDA_VERSION'; END IF;
  IF old_row.reminder_state = 'sending' AND old_row.reminder_attempted_at > now() - interval '10 minutes'
    THEN RAISE EXCEPTION 'AGENDA_SENDING'; END IF;
  selected_contact := (p_values->>'contact_id')::uuid;
  IF selected_contact IS NULL THEN
    IF old_row.id IS NULL OR old_row.contact_id IS NOT NULL THEN RAISE EXCEPTION 'AGENDA_CONTACT'; END IF;
  ELSE
    SELECT * INTO client FROM public.contacts WHERE id = selected_contact AND account_id = p_account_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'AGENDA_CONTACT'; END IF;
  END IF;
  assigned := NULLIF(p_values->>'assigned_agent_id','')::uuid;
  IF assigned IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = assigned
    AND account_id = p_account_id AND account_role IN ('owner','admin','agent')) THEN RAISE EXCEPTION 'AGENDA_AGENT'; END IF;
  start_time := (p_values->>'starts_at')::timestamptz;
  end_time := (p_values->>'ends_at')::timestamptz;
  state := p_values->>'status';
  active := state IN ('scheduled','confirmed');
  enabled := (p_values->>'reminder_enabled')::boolean;
  consent := (p_values->>'reminder_consent')::boolean;
  minutes := (p_values->>'reminder_minutes')::integer;
  IF enabled AND NOT consent THEN RAISE EXCEPTION 'AGENDA_CONSENT'; END IF;
  IF assigned IS NOT NULL AND active AND EXISTS (SELECT 1 FROM public.service_appointments
    WHERE account_id = p_account_id AND assigned_agent_id = assigned AND id <> p_id
      AND status IN ('scheduled','confirmed') AND starts_at < end_time AND ends_at > start_time)
    THEN RAISE EXCEPTION 'AGENDA_OVERLAP'; END IF;
  changed := old_row.id IS NULL OR old_row.starts_at IS DISTINCT FROM start_time
    OR old_row.ends_at IS DISTINCT FROM end_time OR old_row.contact_id IS DISTINCT FROM selected_contact
    OR old_row.unit_reference IS DISTINCT FROM p_values->>'unit_reference'
    OR old_row.service_type IS DISTINCT FROM p_values->>'service_type'
    OR old_row.location IS DISTINCT FROM p_values->>'location'
    OR old_row.reminder_enabled IS DISTINCT FROM enabled OR old_row.reminder_minutes IS DISTINCT FROM minutes
    OR (old_row.status IN ('completed','cancelled') AND active);
  INSERT INTO public.service_appointments AS appointment
    (id, account_id, contact_id, contact_name, assigned_agent_id, created_by, unit_reference, service_type,
     location, starts_at, ends_at, status, odometer_km, notes, reminder_enabled, reminder_consent,
     reminder_minutes, reminder_state)
  VALUES (p_id, p_account_id, selected_contact, COALESCE(NULLIF(client.name,''),NULLIF(client.phone,''),old_row.contact_name,'Cliente'), assigned, p_actor_id,
    p_values->>'unit_reference', p_values->>'service_type', p_values->>'location', start_time, end_time, state,
    NULLIF(p_values->>'odometer_km','')::integer, COALESCE(p_values->>'notes',''), enabled, consent, minutes,
    CASE WHEN enabled AND active THEN 'pending' ELSE 'disabled' END)
  ON CONFLICT (id) DO UPDATE SET contact_id = EXCLUDED.contact_id, contact_name = EXCLUDED.contact_name,
    assigned_agent_id = EXCLUDED.assigned_agent_id, unit_reference = EXCLUDED.unit_reference,
    service_type = EXCLUDED.service_type, location = EXCLUDED.location, starts_at = EXCLUDED.starts_at,
    ends_at = EXCLUDED.ends_at, status = EXCLUDED.status, odometer_km = EXCLUDED.odometer_km,
    notes = EXCLUDED.notes, version = appointment.version + 1, updated_at = now(),
    reminder_enabled = EXCLUDED.reminder_enabled, reminder_consent = EXCLUDED.reminder_consent,
    reminder_minutes = EXCLUDED.reminder_minutes,
    reminder_revision = appointment.reminder_revision + CASE WHEN changed THEN 1 ELSE 0 END,
    reminder_state = CASE WHEN NOT enabled OR NOT active THEN 'disabled'
      WHEN changed AND appointment.reminder_state <> 'review' THEN 'pending'
      WHEN appointment.reminder_state = 'sending' THEN 'review' ELSE appointment.reminder_state END,
    reminder_error = CASE WHEN changed AND appointment.reminder_state NOT IN ('review','sending') THEN NULL ELSE appointment.reminder_error END
  WHERE appointment.account_id = p_account_id AND appointment.version = p_expected_version
  RETURNING * INTO result;
  IF result.id IS NULL THEN RAISE EXCEPTION 'AGENDA_VERSION'; END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION public.save_service_appointment(uuid,uuid,uuid,integer,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_service_appointment(uuid,uuid,uuid,integer,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_service_reminder()
RETURNS SETOF public.service_appointments LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  -- A crashed worker may have sent to Meta: never automatically retry it.
  UPDATE public.service_appointments SET reminder_state = 'review', reminder_error = 'Envío interrumpido: revisa el chat antes de volver a programar.'
    WHERE reminder_state = 'sending' AND reminder_attempted_at < now() - interval '10 minutes';
  UPDATE public.service_appointments SET reminder_state = 'failed', reminder_error = 'La hora de la cita ya pasó.'
    WHERE reminder_state = 'pending' AND starts_at <= now();
  RETURN QUERY UPDATE public.service_appointments SET reminder_state = 'sending', reminder_attempted_at = now(), reminder_error = NULL
    WHERE id = (SELECT id FROM public.service_appointments WHERE reminder_state = 'pending'
      AND reminder_enabled AND reminder_consent AND status IN ('scheduled','confirmed') AND starts_at > now()
      AND starts_at - make_interval(mins => reminder_minutes) <= now()
      ORDER BY starts_at FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_service_reminder() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_service_reminder() TO service_role;
CREATE OR REPLACE FUNCTION public.redeem_invitation(
  p_token_hash TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_inv account_invitations%ROWTYPE;
  v_old_account_id UUID;
  v_old_account_owner UUID;
  v_has_other_members BOOLEAN;
  v_has_data BOOLEAN;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_inv
  FROM account_invitations
  WHERE token_hash = p_token_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found' USING ERRCODE = '22023';
  END IF;
  IF v_inv.accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invitation has already been redeemed'
      USING ERRCODE = '22023';
  END IF;
  IF v_inv.expires_at <= NOW() THEN
    RAISE EXCEPTION 'Invitation has expired' USING ERRCODE = '22023';
  END IF;

  SELECT p.account_id, a.owner_user_id
  INTO v_old_account_id, v_old_account_owner
  FROM profiles p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.user_id = v_caller_id
  FOR UPDATE OF p, a;

  IF v_old_account_id IS NULL THEN
    RAISE EXCEPTION 'Caller has no profile' USING ERRCODE = '42501';
  END IF;

  IF v_old_account_id = v_inv.account_id THEN
    RAISE EXCEPTION 'You are already a member of this account'
      USING ERRCODE = '23505';
  END IF;

  IF v_old_account_owner <> v_caller_id THEN
    RAISE EXCEPTION 'You are already in a shared account; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE account_id = v_old_account_id
      AND user_id <> v_caller_id
  ) INTO v_has_other_members;

  IF v_has_other_members THEN
    RAISE EXCEPTION 'Your account has other members; remove them or transfer ownership before joining another account'
      USING ERRCODE = '23505';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM service_appointments WHERE account_id = v_old_account_id
  ) OR EXISTS (
    SELECT 1 FROM contacts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM conversations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM broadcasts WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automations WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_logs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM automation_pending_executions WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flows WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM flow_runs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM pipelines WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM deals WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM message_templates WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM tags WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM custom_fields WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM contact_notes WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM whatsapp_config WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM api_keys WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM webhook_endpoints WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM quick_replies WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM notifications WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_configs WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_documents WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_knowledge_chunks WHERE account_id = v_old_account_id
    UNION ALL SELECT 1 FROM ai_usage_log WHERE account_id = v_old_account_id
    LIMIT 1
  ) INTO v_has_data;

  IF v_has_data THEN
    RAISE EXCEPTION 'Your account already contains data; sign up with a different email to join this one'
      USING ERRCODE = '23505';
  END IF;

  UPDATE profiles
  SET account_id = v_inv.account_id,
      account_role = v_inv.role
  WHERE user_id = v_caller_id;

  UPDATE account_invitations
  SET accepted_at = NOW(),
      accepted_by_user_id = v_caller_id
  WHERE id = v_inv.id;

  DELETE FROM accounts WHERE id = v_old_account_id;

  RETURN v_inv.account_id;
END;
$$;
ALTER FUNCTION public.redeem_invitation(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.redeem_invitation(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_invitation(text) TO authenticated;
COMMIT;
