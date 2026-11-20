import type { SupabaseClient } from '@supabase/supabase-js';
import { sendMessageToConversation } from '@/lib/whatsapp/send-message';
import { extractTemplateVariables } from '@/lib/whatsapp/template-validators';
import {
  displayDate,
  displayTime,
  REMINDER_LANGUAGE,
  REMINDER_TEMPLATE,
  type Appointment,
} from './model';

export function validReminderTemplate(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const t = value as Record<string, unknown>;
  return (
    t.name === REMINDER_TEMPLATE &&
    t.language === REMINDER_LANGUAGE &&
    t.status === 'APPROVED' &&
    String(t.category).toLowerCase() === 'utility' &&
    typeof t.body_text === 'string' &&
    extractTemplateVariables(t.body_text).join(',') === '1,2,3,4,5,6' &&
    (!t.header_type || t.header_type === 'text') &&
    !/\{\{/.test(String(t.header_content ?? '')) &&
    (!t.buttons || (Array.isArray(t.buttons) && t.buttons.length === 0))
  );
}
export function reminderParams(appointment: Appointment): string[] {
  return [
    appointment.contact_name,
    appointment.unit_reference,
    appointment.service_type,
    displayDate(appointment.starts_at),
    displayTime(appointment.starts_at),
    appointment.location,
  ];
}
async function conversationFor(
  db: SupabaseClient,
  appointment: Appointment,
  ownerId: string
): Promise<string> {
  const find = () =>
    db
      .from('conversations')
      .select('id')
      .eq('account_id', appointment.account_id)
      .eq('contact_id', appointment.contact_id)
      .maybeSingle();
  const existing = await find();
  if (existing.error) throw new Error('No se pudo comprobar el chat.');
  if (existing.data) return existing.data.id;
  const created = await db
    .from('conversations')
    .insert({
      account_id: appointment.account_id,
      contact_id: appointment.contact_id,
      user_id: ownerId,
    })
    .select('id')
    .single();
  if (!created.error && created.data) return created.data.id;
  if (created.error?.code === '23505') {
    const raced = await find();
    if (raced.data) return raced.data.id;
  }
  throw new Error('No se pudo abrir el chat del cliente.');
}
/** Claim one at a time; interrupted/ambiguous sends require review, never retry. */
export async function runServiceReminders(
  db: SupabaseClient
): Promise<{ processed: number }> {
  let processed = 0;
  const deadline = Date.now() + 40000;
  while (processed < 3 && Date.now() < deadline) {
    const { data, error } = await db.rpc('claim_service_reminder');
    if (error) throw new Error('No se pudieron tomar los recordatorios.');
    const appointment = (data as Appointment[] | null)?.[0];
    if (!appointment) break;
    processed++;
    let sendStarted = false;
    try {
      if (
        !appointment.reminder_enabled ||
        !appointment.reminder_consent ||
        !appointment.contact_id ||
        !['scheduled', 'confirmed'].includes(appointment.status) ||
        Date.parse(appointment.starts_at) <= Date.now()
      )
        throw new Error('La cita ya no está disponible para enviar el aviso.');
      const [contact, template, config] = await Promise.all([
        db
          .from('contacts')
          .select('id')
          .eq('id', appointment.contact_id)
          .eq('account_id', appointment.account_id)
          .maybeSingle(),
        db
          .from('message_templates')
          .select('*')
          .eq('account_id', appointment.account_id)
          .eq('name', REMINDER_TEMPLATE)
          .eq('language', REMINDER_LANGUAGE)
          .maybeSingle(),
        db
          .from('whatsapp_config')
          .select('user_id')
          .eq('account_id', appointment.account_id)
          .maybeSingle(),
      ]);
      if (contact.error || !contact.data)
        throw new Error('El contacto ya no está disponible.');
      if (template.error || !validReminderTemplate(template.data))
        throw new Error(
          'Falta la plantilla drm_recordatorio_servicio (es_MX), Utility, aprobada con seis variables.'
        );
      if (config.error || !config.data)
        throw new Error('Falta configurar WhatsApp en esta cuenta.');
      const conversationId = await conversationFor(
        db,
        appointment,
        config.data.user_id
      );
      sendStarted = true;
      const result = await sendMessageToConversation(
        db,
        appointment.account_id,
        {
          conversationId,
          messageType: 'template',
          templateName: REMINDER_TEMPLATE,
          templateLanguage: REMINDER_LANGUAGE,
          templateParams: reminderParams(appointment),
          requestId: `agenda_${appointment.id}_${appointment.reminder_revision}`,
          preserveActiveFlow: true,
        }
      );
      const saved = await db
        .from('service_appointments')
        .update({
          reminder_state: 'sent',
          reminder_sent_at: new Date().toISOString(),
          reminder_message_id: result.messageId,
          reminder_error: null,
        })
        .eq('id', appointment.id)
        .eq('account_id', appointment.account_id)
        .eq('reminder_revision', appointment.reminder_revision)
        .eq('reminder_state', 'sending');
      if (saved.error)
        throw new Error('No se pudo guardar el resultado del aviso.');
    } catch (error) {
      const message = sendStarted
        ? 'El envío necesita revisión: comprueba el chat antes de volver a programar.'
        : error instanceof Error
          ? error.message
          : 'No se pudo preparar el recordatorio.';
      await db
        .from('service_appointments')
        .update({
          reminder_state: sendStarted ? 'review' : 'failed',
          reminder_error: message,
        })
        .eq('id', appointment.id)
        .eq('account_id', appointment.account_id)
        .eq('reminder_revision', appointment.reminder_revision)
        .eq('reminder_state', 'sending');
    }
  }
  return { processed };
}
