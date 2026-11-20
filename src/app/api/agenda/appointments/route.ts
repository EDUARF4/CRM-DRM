import { NextResponse } from 'next/server';
import { getCurrentAccount, requireRole } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  agendaBody,
  agendaDatabaseError,
  agendaError,
  agendaWriteAllowed,
} from '@/lib/agenda/api';
import { isUuid, validateAppointment } from '@/lib/agenda/model';

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const params = new URL(request.url).searchParams;
    const from = Date.parse(params.get('from') ?? ''),
      to = Date.parse(params.get('to') ?? '');
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      to <= from ||
      to - from > 31 * 86400000
    )
      return NextResponse.json(
        { error: 'Selecciona un periodo de hasta 31 días.' },
        { status: 400 }
      );
    let query = ctx.supabase
      .from('service_appointments')
      .select('*')
      .eq('account_id', ctx.accountId)
      .lt('starts_at', new Date(to).toISOString())
      .gt('ends_at', new Date(from).toISOString())
      .order('starts_at')
      .limit(201);
    const agent = params.get('agent');
    if (agent) {
      if (!isUuid(agent))
        return NextResponse.json(
          { error: 'Responsable no válido.' },
          { status: 400 }
        );
      query = query.eq('assigned_agent_id', agent);
    }
    const { data, error } = await query;
    if (error)
      return NextResponse.json(
        {
          error:
            'No se pudo cargar la agenda. Comprueba que su actualización esté instalada en Supabase.',
        },
        { status: 503 }
      );
    return NextResponse.json({
      appointments: (data ?? []).slice(0, 200),
      truncated: (data?.length ?? 0) > 200,
    });
  } catch (error) {
    return agendaError(error);
  }
}
export async function POST(request: Request) {
  if (!agendaWriteAllowed(request))
    return NextResponse.json(
      { error: 'Solicitud no permitida.' },
      { status: 403 }
    );
  try {
    const ctx = await requireRole('agent');
    const body = await agendaBody(request);
    if (!body || !isUuid(body.id))
      return NextResponse.json(
        { error: 'Datos de cita no válidos.' },
        { status: 400 }
      );
    let values;
    try {
      values = validateAppointment(body);
    } catch (error) {
      return NextResponse.json(
        { error: (error as Error).message },
        { status: 400 }
      );
    }
    const { data, error } = await supabaseAdmin().rpc(
      'save_service_appointment',
      {
        p_id: body.id,
        p_account_id: ctx.accountId,
        p_actor_id: ctx.userId,
        p_expected_version: 0,
        p_values: values,
      }
    );
    if (error) return agendaDatabaseError(error);
    return NextResponse.json(
      { appointment: Array.isArray(data) ? data[0] : data },
      { status: 201 }
    );
  } catch (error) {
    return agendaError(error);
  }
}
