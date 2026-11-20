import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '@/lib/whatsapp/encryption';
import { isPushConfigured, sendAndroidPush } from './fcm';

export function pushRecipientIds(members: { user_id: string; account_role: string }[], assignedTo: string | null): Set<string> {
  return new Set(members.filter(member => ['owner', 'admin', 'agent'].includes(member.account_role)
    && (!assignedTo || member.user_id === assignedTo)).map(member => member.user_id));
}

/** Await inside webhook after(): bounded best-effort, never throws into messaging. */
export async function deliverAndroidPush(db: SupabaseClient, accountId: string, conversationId: string, messageId: string): Promise<void> {
  if (!isPushConfigured()) return;
  try {
    const { data: conversation, error: conversationError } = await db.from('conversations').select('assigned_agent_id')
      .eq('id', conversationId).eq('account_id', accountId).maybeSingle();
    if (conversationError || !conversation) return;
    const { data: members, error: memberError } = await db.from('profiles').select('user_id, account_role').eq('account_id', accountId);
    if (memberError || !members) return;
    const recipients = pushRecipientIds(members, conversation.assigned_agent_id);
    if (!recipients.size) return;
    const { data: devices, error } = await db.from('android_push_devices').select('installation_id, token_encrypted, token_hash, user_id')
      .eq('account_id', accountId).in('user_id', [...recipients]).gt('expires_at', new Date().toISOString());
    if (error || !devices) { console.warn('[push] Device lookup unavailable'); return; }
    // Concurrency 4, bounded network budget. Push is separate from message storage.
    const signal = AbortSignal.timeout(8000);
    for (let start = 0; start < devices.length && !signal.aborted; start += 4) {
      await Promise.all(devices.slice(start, start + 4).map(async device => {
        try {
          const status = await sendAndroidPush(decrypt(device.token_encrypted), conversationId, messageId, `${accountId}:${device.user_id}`, signal);
          if (status === 'expired') await db.from('android_push_devices').delete()
            .eq('installation_id', device.installation_id).eq('token_hash', device.token_hash).eq('account_id', accountId);
        } catch { console.warn('[push] Device delivery unavailable'); }
      }));
    }
  } catch { console.warn('[push] Android notifications unavailable'); }
}
