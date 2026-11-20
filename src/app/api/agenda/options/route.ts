import { NextResponse } from 'next/server';
import { getCurrentAccount } from '@/lib/auth/account';
import { agendaError } from '@/lib/agenda/api';
import { contactSearchFilter } from '@/lib/contacts/search-filter';
import { REMINDER_LANGUAGE, REMINDER_TEMPLATE } from '@/lib/agenda/model';
import { validReminderTemplate } from '@/lib/agenda/reminders';

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    let query = ctx.supabase
      .from('contacts')
      .select('id,name,phone')
      .eq('account_id', ctx.accountId)
      .order('name')
      .limit(25);
    const filter = contactSearchFilter(
      (new URL(request.url).searchParams.get('q') ?? '').slice(0, 120)
    );
    if (filter) query = query.or(filter);
    const [contacts, members, template] = await Promise.all([
      query,
      ctx.supabase
        .from('profiles')
        .select('user_id,full_name,account_role')
        .eq('account_id', ctx.accountId)
        .in('account_role', ['owner', 'admin', 'agent']),
      ctx.supabase
        .from('message_templates')
        .select('*')
        .eq('account_id', ctx.accountId)
        .eq('name', REMINDER_TEMPLATE)
        .eq('language', REMINDER_LANGUAGE)
        .maybeSingle(),
    ]);
    if (contacts.error || members.error)
      return NextResponse.json(
        { error: 'No se pudieron cargar los contactos o responsables.' },
        { status: 500 }
      );
    return NextResponse.json({
      contacts: contacts.data ?? [],
      members: members.data ?? [],
      reminderReady: validReminderTemplate(template.data),
    });
  } catch (error) {
    return agendaError(error);
  }
}
