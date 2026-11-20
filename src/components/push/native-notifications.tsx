'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { disableNativePush, hasNativePush, nativePush, registerNativePush } from '@/lib/push/native-client';

/** Renews registrations while open; Firebase handles delivery when closed. */
export function NativePushSync() {
  const { user, accountId, accountStatus } = useAuth();
  useEffect(() => {
    if (!user || !accountId || accountStatus !== 'ready' || !hasNativePush()) return;
    const binding = `${accountId}:${user.id}`;
    const sync = async () => {
      try {
        const status = await nativePush('get');
        if (!status.enabled) return;
        if (status.binding !== binding) { await disableNativePush(); return; }
        await registerNativePush(status, binding);
      } catch { /* A notification failure must not interrupt the inbox. */ }
    };
    void sync();
    window.addEventListener('focus', sync);
    window.addEventListener('drm-native-resume', sync);
    const timer = setInterval(sync, 4 * 60 * 60 * 1000);
    return () => { clearInterval(timer); window.removeEventListener('focus', sync); window.removeEventListener('drm-native-resume', sync); };
  }, [user, accountId, accountStatus]);
  return null;
}

export function NativeNotificationsCard() {
  const { user, accountId, accountRole } = useAuth();
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    setSupported(hasNativePush());
    if (hasNativePush()) void nativePush('get').then(status => setEnabled(status.enabled)).catch(() => {});
  }, []);
  if (!supported || accountRole === 'viewer') return null;
  const toggle = async () => {
    if (!user || !accountId) return;
    setBusy(true); setMessage('');
    try {
      if (enabled) { await disableNativePush(); setEnabled(false); return; }
      const status = await nativePush('enable');
      if (!status.permission) throw new Error('Permite las notificaciones de DRM CRM en los ajustes de Android.');
      await registerNativePush(status, `${accountId}:${user.id}`);
      setEnabled(true);
      setMessage('Avisos activados en este teléfono.');
    } catch (error) {
      // Keep the local receive gate closed if the server registration failed.
      await disableNativePush().catch(() => {}); setEnabled(false);
      setMessage(error instanceof Error ? error.message : 'No se pudieron activar los avisos.');
    } finally { setBusy(false); }
  };
  return <section className="mt-6 rounded-xl border border-border bg-card p-5" aria-labelledby="android-push-title">
    <h2 id="android-push-title" className="font-semibold">Notificaciones en Android</h2>
    <p className="mt-2 text-sm text-muted-foreground">Recibe avisos con la app cerrada. Los chats asignados avisan al agente responsable; los chats sin asignar, al equipo.</p>
    <p className="mt-2 text-sm text-muted-foreground">El aviso no muestra nombres ni el contenido del mensaje en la pantalla bloqueada.</p>
    <Button className="mt-4" disabled={busy} onClick={toggle}>{busy ? 'Espera…' : enabled ? 'Desactivar avisos' : 'Activar avisos'}</Button>
    {message && <p role="status" className="mt-3 text-sm">{message}</p>}
  </section>;
}
