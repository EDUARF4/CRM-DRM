import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { readCappedBody } from '@/lib/whatsapp/webhook-body';

export function agendaWriteAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  return (
    origin === 'https://lightblue-reindeer-349968.hostingersite.com' ||
    (process.env.NODE_ENV !== 'production' &&
      origin === new URL(request.url).origin)
  );
}

export async function agendaBody(
  request: Request
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readCappedBody(request, 16384);
    if (raw === null) return null;
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? value
      : null;
  } catch {
    return null;
  }
}
export function agendaError(error: unknown): Response {
  return toErrorResponse(error);
}
export function agendaDatabaseError(error: {
  message?: string;
  code?: string;
}): Response {
  const messages: Record<string, string> = {
    AGENDA_VERSION:
      'La cita cambió en otro dispositivo. Recarga antes de guardar.',
    AGENDA_OVERLAP: 'Ese responsable ya tiene una cita en ese horario.',
    AGENDA_AGENT: 'El responsable ya no está disponible en este equipo.',
    AGENDA_CONTACT: 'El contacto ya no está disponible.',
    AGENDA_SENDING:
      'Se está enviando el aviso de esta cita. Intenta editarla de nuevo en unos momentos.',
    AGENDA_CONSENT: 'Falta la autorización del cliente para enviar el aviso.',
    AGENDA_FORBIDDEN: 'Tu cuenta no puede modificar esta agenda.',
  };
  const code = Object.keys(messages).find((key) =>
    error.message?.includes(key)
  );
  if (code)
    return NextResponse.json(
      { error: messages[code] },
      { status: code === 'AGENDA_FORBIDDEN' ? 403 : 409 }
    );
  return NextResponse.json(
    {
      error:
        'No se pudo guardar la cita. Revisa que la actualización de agenda esté instalada en Supabase.',
    },
    { status: 500 }
  );
}
