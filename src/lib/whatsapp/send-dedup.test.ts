import { beforeEach, describe, expect, it, vi } from 'vitest';
const { state } = vi.hoisted(() => ({
  state: new Map<string, Record<string, string>>(),
}));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: async (row: Record<string, string>) => {
        const key = row.account_id + ':' + row.request_id;
        if (state.has(key)) return { error: { code: '23505' } };
        state.set(key, { ...row });
        return { error: null };
      },
      select: () => {
        const filters: string[] = [];
        const query = {
          eq: (_: string, value: string) => {
            filters.push(value);
            return query;
          },
          single: async () => ({
            data: state.get(filters.join(':')),
            error: null,
          }),
        };
        return query;
      },
      update: (patch: Record<string, string>) => {
        const filters: string[] = [];
        const query = {
          eq: (_: string, value: string) => {
            filters.push(value);
            if (filters.length === 2) {
              const row = state.get(filters.join(':'));
              if (row) Object.assign(row, patch);
              return Promise.resolve({ error: null });
            }
            return query;
          },
        };
        return query;
      },
    }),
  }),
}));
import { claimSend, completeSend } from './send-dedup';
const key = 'a-valid-request-key-0001';
const params = {
  conversationId: 'conversation-a',
  messageType: 'text',
  contentText: 'Hola',
};
beforeEach(() => state.clear());
describe('durable outbound reservation', () => {
  it('admits only one of concurrent requests', async () => {
    const results = await Promise.allSettled([
      claimSend('a', key, params),
      claimSend('a', key, params),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
  it('replays the saved result without admitting a second send', async () => {
    await claimSend('a', key, params);
    const sent = {
      messageId: 'saved-message',
      whatsappMessageId: 'wamid.test',
    };
    await completeSend('a', key, sent);
    expect(await claimSend('a', key, params)).toEqual({ result: sent });
  });
  it('rejects the same key for different content or conversation', async () => {
    await claimSend('a', key, params);
    await expect(
      claimSend('a', key, { ...params, contentText: 'Adiós' })
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      claimSend('a', key, { ...params, conversationId: 'other' })
    ).rejects.toMatchObject({ status: 409 });
  });
  it('scopes keys to account and keeps ambiguous attempts blocked', async () => {
    await claimSend('a', key, params);
    await expect(claimSend('b', key, params)).resolves.toEqual({});
    await expect(claimSend('a', key, params)).rejects.toMatchObject({
      code: 'send_pending',
    });
  });
  it('rejects invalid keys before touching the database', async () => {
    await expect(claimSend('a', 'short', params)).rejects.toMatchObject({
      status: 400,
    });
    expect(state.size).toBe(0);
  });
});

const { metaSend } = vi.hoisted(() => ({ metaSend: vi.fn() }));
vi.mock('@/lib/whatsapp/meta-api', () => ({
  MetaApiError: class extends Error {},
  sendTextMessage: metaSend,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt: () => 'test-token', isLegacyFormat: () => false }));
vi.mock('@/lib/whatsapp/message-status-sync', () => ({ applyPendingMessageStatuses: async () => {} }));
import { sendMessageToConversation } from './send-message';
import type { SupabaseClient } from '@supabase/supabase-js';

function sendDb(assignedTo: string | null = null, saveFails = false): SupabaseClient {
  return { from: (table: string) => {
    const query = {
      select: () => query, eq: () => query, insert: () => query, update: () => query,
      single: async () => {
        if (table === 'conversations') return { data: { id: params.conversationId, assigned_agent_id: assignedTo,
          contact: { id: 'contact-a', phone: '5217770000001' } }, error: null };
        if (table === 'whatsapp_config') return { data: { id: 'config-a', phone_number_id: 'test-phone', access_token: 'encrypted' }, error: null };
        if (table === 'messages') return { data: saveFails ? null : { id: 'saved-message' }, error: saveFails ? { message: 'DB offline' } : null };
        return { data: null, error: null };
      },
      then: (resolve: (value: unknown) => unknown) => resolve({ error: null }),
    };
    return query;
  } } as unknown as SupabaseClient;
}

describe('send core with durable reservation', () => {
  beforeEach(() => { metaSend.mockReset().mockResolvedValue({ messageId: 'wamid.test' }); });
  it('makes one external send for simultaneous requests and replays the same result', async () => {
    const input = { ...params, requestId: key };
    const results = await Promise.allSettled([
      sendMessageToConversation(sendDb(), 'a', input),
      sendMessageToConversation(sendDb(), 'a', input),
    ]);
    expect(metaSend).toHaveBeenCalledTimes(1);
    expect(metaSend).toHaveBeenCalledWith(expect.objectContaining({ to: '527770000001' }));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(await sendMessageToConversation(sendDb(), 'a', input)).toEqual({ messageId: 'saved-message', whatsappMessageId: 'wamid.test' });
    expect(metaSend).toHaveBeenCalledTimes(1);
  });
  it('does not send again if Meta accepted but saving the chat failed', async () => {
    const input = { ...params, requestId: key };
    await expect(sendMessageToConversation(sendDb(null, true), 'a', input)).rejects.toMatchObject({ code: 'db_error' });
    await expect(sendMessageToConversation(sendDb(), 'a', input)).rejects.toMatchObject({ code: 'send_pending' });
    expect(metaSend).toHaveBeenCalledTimes(1);
  });
  it('blocks a different agent before making any external send', async () => {
    await expect(sendMessageToConversation(sendDb('agent-b'), 'a', { ...params, senderId: 'agent-a', requestId: key })).rejects.toMatchObject({ status: 409, code: 'assigned_to_other_agent' });
    expect(metaSend).not.toHaveBeenCalled();
    expect(state.size).toBe(0);
  });
  it('keeps a network timeout reserved because delivery is uncertain', async () => {
    metaSend.mockRejectedValue(new Error('network timeout'));
    const input = { ...params, requestId: key };
    await expect(sendMessageToConversation(sendDb(), 'a', input)).rejects.toMatchObject({ code: 'meta_error' });
    await expect(sendMessageToConversation(sendDb(), 'a', input)).rejects.toMatchObject({ code: 'send_pending' });
    expect(metaSend).toHaveBeenCalledTimes(1);
  });
});
