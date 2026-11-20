import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Appointment } from './model';
const send = vi.hoisted(() => vi.fn());
vi.mock('@/lib/whatsapp/send-message', () => ({
  sendMessageToConversation: send,
}));
import {
  reminderParams,
  runServiceReminders,
  validReminderTemplate,
} from './reminders';
const template = {
  name: 'drm_recordatorio_servicio',
  language: 'es_MX',
  status: 'APPROVED',
  category: 'Utility',
  body_text: 'Hola {{1}}, {{2}} / {{3}} / {{4}} / {{5}} / {{6}}',
  buttons: [],
};
const visit = {
  id: '00000000-0000-4000-8000-000000000001',
  account_id: 'account',
  contact_id: 'contact',
  contact_name: 'Cliente',
  unit_reference: 'DRM-001',
  service_type: 'Servicio',
  location: 'Taller',
  status: 'scheduled',
  starts_at: '2090-01-01T16:00:00Z',
  ends_at: '2090-01-01T17:00:00Z',
  reminder_enabled: true,
  reminder_consent: true,
  reminder_revision: 1,
} as Appointment;
function database(
  input: { visit?: Appointment; template?: unknown; saveError?: boolean } = {}
) {
  const updates: unknown[] = [];
  const filters: unknown[] = [];
  const rpc = vi
    .fn()
    .mockResolvedValueOnce({ data: [input.visit ?? visit], error: null })
    .mockResolvedValue({ data: [], error: null });
  const from = vi.fn((table: string) => {
    const data =
      table === 'contacts'
        ? { id: 'contact' }
        : table === 'message_templates'
          ? (input.template ?? template)
          : table === 'whatsapp_config'
            ? { user_id: 'owner' }
            : table === 'conversations'
              ? { id: 'conversation' }
              : null;
    const result = {
      data,
      error:
        table === 'service_appointments' && input.saveError
          ? { message: 'save failed' }
          : null,
    };
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['select', 'eq', 'insert', 'update'])
      chain[method] = vi.fn((...args) => {
        if (method === 'update') updates.push(args[0]);
        if (method === 'eq') filters.push(args);
        return chain;
      });
    chain.maybeSingle = vi.fn(async () => result);
    chain.single = vi.fn(async () => result);
    chain.then = vi.fn((resolve) => Promise.resolve(result).then(resolve));
    return chain;
  });
  return {
    db: { rpc, from } as unknown as SupabaseClient,
    rpc,
    from,
    updates,
    filters,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  send.mockResolvedValue({
    messageId: 'sent-message',
    whatsappMessageId: 'wamid',
  });
});
describe('Service reminders', () => {
  it('uses six explicit template variables in the documented order', () => {
    expect(validReminderTemplate(template)).toBe(true);
    expect(reminderParams(visit)).toEqual([
      'Cliente',
      'DRM-001',
      'Servicio',
      '1 de enero de 2090',
      '10:00',
      'Taller',
    ]);
  });
  it.each([
    { status: 'PENDING' },
    { category: 'Marketing' },
    { language: 'en' },
    { header_type: 'image' },
    { header_content: 'Hola {{1}}' },
    { buttons: [{ type: 'URL' }] },
    { body_text: '{{1}} {{2}}' },
    { body_text: '{{name}}' },
  ])('rejects an incompatible/unapproved template %#', (patch) =>
    expect(validReminderTemplate({ ...template, ...patch })).toBe(false)
  );
  it('sends only claimed, consented visits, with idempotency and no human takeover', async () => {
    const state = database();
    expect(await runServiceReminders(state.db)).toEqual({ processed: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toBe('account');
    expect(send.mock.calls[0][2]).toMatchObject({
      requestId: `agenda_${visit.id}_1`,
      messageType: 'template',
      preserveActiveFlow: true,
    });
    expect(state.updates).toContainEqual(
      expect.objectContaining({
        reminder_state: 'sent',
        reminder_message_id: 'sent-message',
      })
    );
    expect(state.filters).toContainEqual(['account_id', 'account']);
    expect(state.filters).toContainEqual(['reminder_revision', 1]);
  });
  it.each([
    { reminder_consent: false },
    { reminder_enabled: false },
    { status: 'cancelled' },
    { status: 'completed' },
    { starts_at: '2020-01-01T10:00:00Z' },
    { contact_id: null },
  ])('does not send an ineligible visit %#', async (patch) => {
    const state = database({ visit: { ...visit, ...patch } as Appointment });
    await runServiceReminders(state.db);
    expect(send).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual(
      expect.objectContaining({ reminder_state: 'failed' })
    );
  });
  it('fails before sending when the template is not approved', async () => {
    const state = database({ template: { ...template, status: 'PENDING' } });
    await runServiceReminders(state.db);
    expect(send).not.toHaveBeenCalled();
    expect(state.updates).toContainEqual(
      expect.objectContaining({ reminder_state: 'failed' })
    );
  });
  it('requires review after uncertain delivery and does not automatically send again', async () => {
    send.mockRejectedValue(new Error('network failure'));
    const state = database();
    await runServiceReminders(state.db);
    expect(send).toHaveBeenCalledTimes(1);
    expect(state.updates).toContainEqual(
      expect.objectContaining({ reminder_state: 'review' })
    );
  });
});
