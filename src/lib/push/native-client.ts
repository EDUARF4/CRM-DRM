'use client';

interface Bridge { postMessage(value: string): void; onmessage: ((event: { data: string }) => void) | null }
export interface NativePushStatus {
  id: string; enabled: boolean; permission: boolean; installationId: string; secret: string;
  token?: string; binding?: string; error?: string;
}
declare global { interface Window { DrmPush?: Bridge } }
const pending = new Map<string, { resolve: (value: NativePushStatus) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
let attached: Bridge | undefined;

export function hasNativePush(): boolean { return typeof window !== 'undefined' && !!window.DrmPush; }
export async function nativePush(action: 'get' | 'enable' | 'bound' | 'disable', binding?: string): Promise<NativePushStatus> {
  const bridge = window.DrmPush;
  if (!bridge) throw new Error('Abre esta opción desde la nueva APK de DRM CRM.');
  if (attached !== bridge) {
    attached = bridge;
    bridge.onmessage = event => {
      try {
        const reply = JSON.parse(event.data) as NativePushStatus;
        const item = pending.get(reply.id);
        if (!item) return;
        clearTimeout(item.timer); pending.delete(reply.id);
        if (reply.error) item.reject(new Error(reply.error)); else item.resolve(reply);
      } catch { /* Ignore malformed or unrelated native messages. */ }
    };
  }
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('La app no respondió. Vuelve a intentarlo.')); }, 20_000);
    pending.set(id, { resolve, reject, timer });
    bridge.postMessage(JSON.stringify({ id, action, binding }));
  });
}
export async function registerNativePush(status: NativePushStatus, binding: string): Promise<void> {
  if (!status.token) throw new Error('No se pudo obtener el identificador de notificaciones.');
  const response = await fetch('/api/push/devices', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationId: status.installationId, secret: status.secret, token: status.token }) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'No se pudo registrar el teléfono.');
  }
  await nativePush('bound', binding);
}
export async function disableNativePush(): Promise<void> {
  if (!hasNativePush()) return;
  // Local disable happens before any network request, including offline logout.
  const status = await nativePush('disable');
  await fetch('/api/push/devices', { method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ installationId: status.installationId, secret: status.secret }), signal: AbortSignal.timeout(3000) }).catch(() => {});
}
