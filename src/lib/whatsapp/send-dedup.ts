import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import type { SendMessageParams, SendMessageResult } from './send-message';
import { SendMessageError } from './send-error';

function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value))
    return '[' + value.map(canonicalJson).join(',') + ']';
  return (
    '{' +
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ':' + canonicalJson(v))
      .join(',') +
    '}'
  );
}

export async function claimSend(
  accountId: string,
  requestId: string,
  params: SendMessageParams
): Promise<{ result?: SendMessageResult }> {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(requestId)) {
    throw new SendMessageError(
      'invalid_request_id',
      'Identificador de envío inválido.',
      400
    );
  }
  const payload = { ...params };
  delete payload.requestId;
  const fingerprint = createHash('sha256')
    .update(canonicalJson(payload))
    .digest('hex');
  const db = supabaseAdmin();
  const { error } = await db.from('outbound_send_requests').insert({
    account_id: accountId,
    request_id: requestId,
    fingerprint,
    conversation_id: params.conversationId,
  });
  if (!error) return {};
  if (error.code !== '23505') {
    throw new SendMessageError(
      'send_reservation_failed',
      'No se pudo asegurar el envío. Revisa la migración de mensajería del servidor.',
      503
    );
  }
  const { data, error: readError } = await db
    .from('outbound_send_requests')
    .select('fingerprint, message_id, whatsapp_message_id')
    .eq('account_id', accountId)
    .eq('request_id', requestId)
    .single();
  if (readError || !data)
    throw new SendMessageError(
      'send_lookup_failed',
      'No se pudo comprobar el envío anterior. Revisa la conversación antes de repetir.',
      503
    );
  if (data.fingerprint !== fingerprint)
    throw new SendMessageError(
      'request_id_conflict',
      'El identificador ya pertenece a otro mensaje.',
      409
    );
  if (data.message_id && data.whatsapp_message_id) {
    return {
      result: {
        messageId: data.message_id,
        whatsappMessageId: data.whatsapp_message_id,
      },
    };
  }
  throw new SendMessageError(
    'send_pending',
    'El envío anterior está en curso o requiere revisión. Comprueba el chat antes de enviar nuevamente.',
    409
  );
}

export async function completeSend(
  accountId: string,
  requestId: string,
  result: SendMessageResult
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('outbound_send_requests')
    .update({
      message_id: result.messageId,
      whatsapp_message_id: result.whatsappMessageId,
      completed_at: new Date().toISOString(),
    })
    .eq('account_id', accountId)
    .eq('request_id', requestId);
  if (error)
    throw new SendMessageError(
      'send_result_unsaved',
      'El mensaje fue enviado, pero no se pudo confirmar su registro. Revisa el chat antes de repetir.',
      503
    );
}

// Only call after a structured Meta 4xx rejection: no delivery happened.
export async function releaseRejectedSend(
  accountId: string,
  requestId: string
): Promise<void> {
  const { error } = await supabaseAdmin()
    .from('outbound_send_requests')
    .delete()
    .eq('account_id', accountId)
    .eq('request_id', requestId)
    .is('message_id', null);
  if (error)
    console.warn('[send-dedup] rejected reservation retained for review');
}
