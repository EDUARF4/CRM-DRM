-- Apply in Supabase SQL Editor BEFORE deploying the updated server.
-- Transactional: existing Mexico aliases are never deleted or merged silently.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.contacts
    WHERE phone_normalized <> ''
    GROUP BY account_id, CASE WHEN phone_normalized ~ '^521[0-9]{10}$'
      THEN '52' || substring(phone_normalized FROM 4) ELSE phone_normalized END
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DRM: existen contactos duplicados 52/521. Revisar y consolidar su historial antes de aplicar esta migración.';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_account_mexico_phone
  ON public.contacts (account_id, (CASE WHEN phone_normalized ~ '^521[0-9]{10}$'
    THEN '52' || substring(phone_normalized FROM 4) ELSE phone_normalized END))
  WHERE phone_normalized <> '';

-- No automatic re-send or expiration: a crashed/timed-out worker may have
-- delivered to Meta. Keep the reservation to prevent a second delivery.
CREATE TABLE IF NOT EXISTS public.outbound_send_requests (
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  whatsapp_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  PRIMARY KEY (account_id, request_id),
  CHECK (request_id ~ '^[A-Za-z0-9_-]{16,128}$'),
  CHECK (length(fingerprint) = 64)
);
ALTER TABLE public.outbound_send_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.outbound_send_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.outbound_send_requests TO service_role;
COMMIT;
