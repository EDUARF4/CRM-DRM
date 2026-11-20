import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { encrypt } from '@/lib/whatsapp/encryption';
import { isPushConfigured } from '@/lib/push/fcm';
import { readCappedBody } from '@/lib/whatsapp/webhook-body';
import { checkRateLimit } from '@/lib/rate-limit';

export const runtime = 'nodejs';
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const reply = (error: string, status: number) => NextResponse.json({ error }, { status });

function sameOrigin(request: Request): boolean {
  // This is the exact origin allowed by the Android APK's native bridge.
  // Hostinger terminates HTTPS in its proxy; request.url may have the internal
  // HTTP origin. Do not infer trust from that URL or client-supplied forwarded
  // headers. Keep an explicit origin check before the session/installation gates.
  return request.headers.get('origin') === 'https://lightblue-reindeer-349968.hostingersite.com';
}
async function body(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const read = await readCappedBody(request, 8192);
    if (read === null) return null;
    const value = JSON.parse(read);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}
export async function GET() {
  try { await getCurrentAccount(); return NextResponse.json({ configured: isPushConfigured() }); }
  catch (error) { return toErrorResponse(error); }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return reply('Solicitud no permitida.', 403);
  try {
    const ctx = await getCurrentAccount();
    if (ctx.role === 'viewer') return reply('Esta cuenta no puede activar avisos de agente.', 403);
    if (!checkRateLimit(`push:${ctx.userId}`, { limit: 30, windowMs: 60_000 }).success) return reply('Intenta de nuevo más tarde.', 429);
    if (!isPushConfigured()) return reply('Falta configurar los avisos en el servidor.', 503);
    const value = await body(request);
    if (!value || typeof value.installationId !== 'string' || !uuid.test(value.installationId)
      || typeof value.secret !== 'string' || !/^[a-f0-9]{64}$/.test(value.secret)
      || typeof value.token !== 'string' || !/^[A-Za-z0-9_.:\-]{32,4096}$/.test(value.token)) return reply('Datos de dispositivo no válidos.', 400);
    const { data, error } = await supabaseAdmin().rpc('register_android_push_device', {
      p_installation_id: value.installationId, p_secret_hash: hash(value.secret), p_token_hash: hash(value.token),
      p_token_encrypted: encrypt(value.token), p_account_id: ctx.accountId, p_user_id: ctx.userId,
    });
    if (error || data !== true) return reply('No se pudo registrar este dispositivo.', 409);
    return NextResponse.json({ registered: true });
  } catch (error) { return toErrorResponse(error); }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return reply('Solicitud no permitida.', 403);
  try {
    const ctx = await getCurrentAccount();
    const value = await body(request);
    if (!value || typeof value.installationId !== 'string' || !uuid.test(value.installationId)
      || typeof value.secret !== 'string' || !/^[a-f0-9]{64}$/.test(value.secret)) return reply('Datos no válidos.', 400);
    const { error } = await supabaseAdmin().from('android_push_devices').delete()
      .eq('installation_id', value.installationId).eq('secret_hash', hash(value.secret))
      .eq('account_id', ctx.accountId).eq('user_id', ctx.userId);
    if (error) return reply('No se pudo desactivar el dispositivo.', 500);
    return NextResponse.json({ removed: true });
  } catch (error) { return toErrorResponse(error); }
}
