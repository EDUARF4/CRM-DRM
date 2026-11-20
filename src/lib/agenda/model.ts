export const AGENDA_ZONE = 'America/Mexico_City';
export const REMINDER_TEMPLATE = 'drm_recordatorio_servicio';
export const REMINDER_LANGUAGE = 'es_MX';
export const STATUSES = {
  scheduled: 'Agendada',
  confirmed: 'Confirmada',
  completed: 'Realizada',
  cancelled: 'Cancelada',
} as const;
export const REMINDER_STATES = {
  disabled: 'Sin recordatorio',
  pending: 'Programado',
  sending: 'Enviando',
  sent: 'Enviado',
  failed: 'No enviado',
  review: 'Revisar envío',
} as const;
export interface Appointment {
  id: string;
  account_id: string;
  contact_id: string | null;
  contact_name: string;
  assigned_agent_id: string | null;
  unit_reference: string;
  service_type: string;
  location: string;
  starts_at: string;
  ends_at: string;
  status: keyof typeof STATUSES;
  odometer_km: number | null;
  notes: string;
  version: number;
  reminder_enabled: boolean;
  reminder_consent: boolean;
  reminder_minutes: number;
  reminder_revision: number;
  reminder_state: keyof typeof REMINDER_STATES;
  reminder_error: string | null;
  reminder_sent_at: string | null;
  created_by: string | null;
}
export type AppointmentValues = Pick<
  Appointment,
  | 'contact_id'
  | 'assigned_agent_id'
  | 'unit_reference'
  | 'service_type'
  | 'location'
  | 'starts_at'
  | 'ends_at'
  | 'status'
  | 'odometer_km'
  | 'notes'
  | 'reminder_enabled'
  | 'reminder_consent'
  | 'reminder_minutes'
>;
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: AGENDA_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export function mexicoLocal(iso: string | Date): string {
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(iso)).map((p) => [p.type, p.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export function localToIso(local: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local))
    throw new Error('Fecha u hora no válida.');
  const [y, m, d, h, min] = local.match(/\d+/g)!.map(Number);
  const desired = Date.UTC(y, m - 1, d, h, min);
  let guess = desired;
  for (let i = 0; i < 3; i++) {
    const [gy, gm, gd, gh, gmin] = mexicoLocal(new Date(guess))
      .match(/\d+/g)!
      .map(Number);
    guess += desired - Date.UTC(gy, gm - 1, gd, gh, gmin);
  }
  if (mexicoLocal(new Date(guess)) !== local)
    throw new Error('Fecha u hora no válida.');
  return new Date(guess).toISOString();
}
export function shiftDay(day: string, amount: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + amount * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function displayTime(iso: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: AGENDA_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}
export function displayDate(iso: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: AGENDA_ZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(iso));
}
export const isUuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    v
  );
export function validateAppointment(
  input: unknown,
  allowMissingContact = false
): AppointmentValues {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Datos no válidos.');
  const v = input as Record<string, unknown>;
  const text = (key: string, max: number) => {
    if (
      typeof v[key] !== 'string' ||
      !(v[key] as string).trim() ||
      (v[key] as string).length > max
    )
      throw new Error(`Revisa el campo ${key}.`);
    return (v[key] as string).trim();
  };
  if (!isUuid(v.contact_id) && !(allowMissingContact && v.contact_id === null))
    throw new Error('Selecciona un contacto.');
  if (v.assigned_agent_id !== null && !isUuid(v.assigned_agent_id))
    throw new Error('Selecciona un responsable válido.');
  if (typeof v.status !== 'string' || !Object.hasOwn(STATUSES, v.status))
    throw new Error('Estado no válido.');
  const absoluteTime =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (
    typeof v.starts_at !== 'string' ||
    typeof v.ends_at !== 'string' ||
    !absoluteTime.test(v.starts_at) ||
    !absoluteTime.test(v.ends_at)
  )
    throw new Error('La fecha y hora deben incluir su zona horaria.');
  const start = Date.parse(String(v.starts_at)),
    end = Date.parse(String(v.ends_at));
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 12 * 3600000 ||
    new Date(start).getUTCFullYear() < 2023 ||
    new Date(start).getUTCFullYear() > 2100
  )
    throw new Error(
      'La duración debe ser de hasta 12 horas y terminar después del inicio.'
    );
  if (
    typeof v.reminder_enabled !== 'boolean' ||
    typeof v.reminder_consent !== 'boolean' ||
    ![60, 120, 1440].includes(v.reminder_minutes as number)
  )
    throw new Error('Recordatorio no válido.');
  if (v.reminder_enabled && !v.reminder_consent)
    throw new Error(
      'Confirma que el cliente autorizó el recordatorio por WhatsApp.'
    );
  if (
    v.odometer_km !== null &&
    (!Number.isInteger(v.odometer_km) ||
      (v.odometer_km as number) < 0 ||
      (v.odometer_km as number) > 2000000)
  )
    throw new Error('Kilometraje no válido.');
  if (typeof v.notes !== 'string' || v.notes.length > 2000)
    throw new Error('Las notas admiten hasta 2,000 caracteres.');
  return {
    contact_id: v.contact_id as string | null,
    assigned_agent_id: v.assigned_agent_id as string | null,
    unit_reference: text('unit_reference', 120),
    service_type: text('service_type', 120),
    location: text('location', 200),
    starts_at: new Date(start).toISOString(),
    ends_at: new Date(end).toISOString(),
    status: v.status as Appointment['status'],
    odometer_km: v.odometer_km as number | null,
    notes: v.notes.trim(),
    reminder_enabled: v.reminder_enabled,
    reminder_consent: v.reminder_consent,
    reminder_minutes: v.reminder_minutes as number,
  };
}
