import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import { runServiceReminders } from '@/lib/agenda/reminders';

export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request: Request) {
  const expected = process.env.AGENDA_CRON_SECRET;
  if (!expected || expected.length < 32)
    return NextResponse.json(
      { error: 'Agenda scheduler not configured' },
      { status: 503 }
    );
  const provided = request.headers.get('x-cron-secret') ?? '';
  if (
    Buffer.byteLength(provided) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(expected))
  )
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json(await runServiceReminders(supabaseAdmin()));
  } catch {
    return NextResponse.json(
      { error: 'No se pudieron procesar los recordatorios.' },
      { status: 500 }
    );
  }
}
