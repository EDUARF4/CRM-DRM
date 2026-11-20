-- Apply before enabling Android push. No existing CRM rows are changed.
BEGIN;
CREATE TABLE IF NOT EXISTS public.android_push_devices (
  installation_id uuid PRIMARY KEY,
  secret_hash text NOT NULL CHECK (secret_hash ~ '^[a-f0-9]{64}$'),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  token_encrypted text NOT NULL,
  account_id uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '14 days'
);
CREATE INDEX IF NOT EXISTS android_push_devices_account_idx ON public.android_push_devices(account_id, expires_at);
ALTER TABLE public.android_push_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.android_push_devices FROM anon, authenticated;
GRANT ALL ON public.android_push_devices TO service_role;

-- A per-installation secret prevents a second user/device from stealing an
-- existing registration. Account/user always come from the server session.
CREATE OR REPLACE FUNCTION public.register_android_push_device(
  p_installation_id uuid, p_secret_hash text, p_token_hash text,
  p_token_encrypted text, p_account_id uuid, p_user_id uuid
) RETURNS boolean LANGUAGE plpgsql SET search_path = public AS $$
DECLARE changed integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.profiles
    WHERE user_id = p_user_id AND account_id = p_account_id
      AND account_role IN ('owner', 'admin', 'agent')) THEN
    RETURN false;
  END IF;
  INSERT INTO public.android_push_devices AS device
    (installation_id, secret_hash, token_hash, token_encrypted, account_id, user_id)
  VALUES (p_installation_id, p_secret_hash, p_token_hash, p_token_encrypted, p_account_id, p_user_id)
  ON CONFLICT (installation_id) DO UPDATE SET
    token_hash = EXCLUDED.token_hash, token_encrypted = EXCLUDED.token_encrypted,
    account_id = EXCLUDED.account_id, user_id = EXCLUDED.user_id,
    updated_at = now(), expires_at = now() + interval '14 days'
  WHERE device.secret_hash = EXCLUDED.secret_hash;
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END;
$$;
REVOKE ALL ON FUNCTION public.register_android_push_device(uuid,text,text,text,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_android_push_device(uuid,text,text,text,uuid,uuid) TO service_role;
COMMIT;
