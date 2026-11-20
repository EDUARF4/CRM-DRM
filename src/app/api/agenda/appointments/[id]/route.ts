import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  agendaBody,
  agendaDatabaseError,
  agendaError,
  agendaWriteAllowed,
} from '@/lib/agenda/api';
import { isUuid, validateAppointment } from '@/lib/agenda/model';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  if (!agendaWriteAllowed(request))
    return NextResponse.json(
      { error: 'Solicitud no permitida.' },
      { status: 403 }
    );
  try {
    const ctx = await requireRole('agent');
    const { id } = await context.params;
    const body = await agendaBody(request);
    if (
      !isUuid(id) ||
      !body ||
      !Number.isInteger(body.version) ||
      (body.version as number) < 1
    )
      return NextResponse.json(
        { error: 'Datos de cita no válidos.' },
        { status: 400 }
      );
    let values;
    try {
      values = validateAppointment(body, true);
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 400 }
      );
    }
    const { data, error } = await supabaseAdmin().rpc(
      'save_service_appointment',
      {
        p_id: id,
        p_account_id: ctx.accountId,
        p_actor_id: ctx.userId,
        p_expected_version: body.version,
        p_values: values,
      }
    );
    if (error) return agendaDatabaseError(error);
    return NextResponse.json({
      appointment: Array.isArray(data) ? data[0] : data,
    });
  } catch (error) {
    return agendaError(error);
  }
}
