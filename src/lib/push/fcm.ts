import { createHash, createSign } from 'node:crypto';

interface ServiceAccount { project_id: string; client_email: string; private_key: string }
let cached: { key: string; value: string; expiresAt: number } | undefined;
let refreshing: Promise<string> | undefined;

function config(): ServiceAccount | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const value = JSON.parse(raw) as ServiceAccount;
  if (!/^[a-z][a-z0-9-]{4,62}$/.test(value.project_id ?? '')
    || !value.client_email?.endsWith('.iam.gserviceaccount.com') || !value.private_key?.includes('PRIVATE KEY')) {
    throw new Error('Invalid FCM server configuration');
  }
  return value;
}
export function isPushConfigured(): boolean {
  try { return config() !== null; } catch { return false; }
}
async function accessToken(account: ServiceAccount): Promise<string> {
  const key = createHash('sha256').update(JSON.stringify(account)).digest('hex');
  if (cached?.key === key && cached.expiresAt > Date.now() + 60_000) return cached.value;
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const now = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })).toString('base64url');
    const input = `${header}.${payload}`;
    const signature = createSign('RSA-SHA256').update(input).sign(account.private_key.replace(/\\n/g, '\n'), 'base64url');
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${input}.${signature}` }),
      signal: AbortSignal.timeout(5000), cache: 'no-store', redirect: 'error',
    });
    if (!response.ok) throw new Error('FCM server authentication failed');
    const data = await response.json() as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error('FCM server authentication failed');
    cached = { key, value: data.access_token, expiresAt: Date.now() + Math.min(data.expires_in ?? 3600, 3600) * 1000 };
    return data.access_token;
  })();
  try { return await refreshing; } finally { refreshing = undefined; }
}

/** Data-only: native service checks local opt-in even after offline logout. */
export async function sendAndroidPush(token: string, conversationId: string, messageId: string, binding: string, signal?: AbortSignal): Promise<'sent' | 'expired'> {
  const account = config();
  if (!account) throw new Error('FCM is not configured');
  const bearer = await accessToken(account);
  signal?.throwIfAborted();
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { token, data: { conversation_id: conversationId, message_id: messageId, binding,
      title: 'DRM CRM', body: 'Tienes un mensaje nuevo. Abre el CRM para verlo.' },
      android: { priority: 'HIGH', ttl: '300s', collapse_key: conversationId } } }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000), redirect: 'error', cache: 'no-store',
  });
  if (response.ok) return 'sent';
  if (response.status === 401) cached = undefined;
  const data = await response.json().catch(() => null) as { error?: { details?: { errorCode?: string }[] } } | null;
  // Do not delete devices on generic INVALID_ARGUMENT/configuration failures.
  if (data?.error?.details?.some(item => item.errorCode === 'UNREGISTERED')) return 'expired';
  throw new Error(`FCM delivery failed (${response.status})`);
}
