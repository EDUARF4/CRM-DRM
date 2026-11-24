-- Apply after 062. Only the authenticated server route may call this function.
-- The same account/actor/version locks used for edits also protect deletion.
CREATE OR REPLACE FUNCTION public.delete_service_appointment(
  p_id uuid, p_account_id uuid, p_actor_id uuid, p_expected_version integer
) RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE appointment public.service_appointments;
BEGIN
  PERFORM 1 FROM public.profiles
    WHERE user_id = p_actor_id AND account_id = p_account_id
      AND account_role IN ('owner', 'admin', 'agent') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENDA_FORBIDDEN'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('agenda:' || p_account_id::text, 0));
  SELECT * INTO appointment FROM public.service_appointments
    WHERE id = p_id AND account_id = p_account_id FOR UPDATE;
  IF appointment.id IS NULL OR p_expected_version IS NULL
    OR appointment.version <> p_expected_version THEN RAISE EXCEPTION 'AGENDA_VERSION'; END IF;
  -- A worker claims this same row under a lock. Never delete an in-flight send.
  IF appointment.reminder_state = 'sending' THEN RAISE EXCEPTION 'AGENDA_SENDING'; END IF;
  DELETE FROM public.service_appointments WHERE id = p_id AND account_id = p_account_id;
END;
$$;
ALTER FUNCTION public.delete_service_appointment(uuid,uuid,uuid,integer) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.delete_service_appointment(uuid,uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_service_appointment(uuid,uuid,uuid,integer) TO service_role;
