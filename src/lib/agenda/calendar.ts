import { localToIso, mexicoLocal, shiftDay, type Appointment } from './model';

export type CalendarView = 'day' | 'week' | 'month';
export function calendarPeriod(day: string, view: CalendarView) {
  let from = day;
  let length = 1;
  if (view === 'week') {
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    from = shiftDay(day, -((weekday + 6) % 7));
    length = 7;
  } else if (view === 'month') {
    from = `${day.slice(0, 7)}-01`;
    const date = new Date(`${from}T12:00:00Z`);
    length = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
    ).getUTCDate();
  }
  return {
    from,
    to: shiftDay(from, length),
    dates: Array.from({ length }, (_, i) => shiftDay(from, i)),
  };
}
export function movePeriod(day: string, view: CalendarView, direction: number) {
  if (view !== 'month')
    return shiftDay(day, direction * (view === 'week' ? 7 : 1));
  const date = new Date(`${day.slice(0, 7)}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + direction);
  return date.toISOString().slice(0, 10);
}
export const calendarDate = (
  day: string,
  options: Intl.DateTimeFormatOptions
) =>
  new Intl.DateTimeFormat('es-MX', { ...options, timeZone: 'UTC' }).format(
    new Date(`${day}T12:00:00Z`)
  );

export const EVENT_COLORS = {
  sales: {
    label: 'Venta / visita',
    color: '#f52245',
    background: 'rgba(245,34,69,.11)',
  },
  workshop: {
    label: 'Taller',
    color: '#2878f5',
    background: 'rgba(40,120,245,.12)',
  },
  followup: {
    label: 'Seguimiento',
    color: '#9333ea',
    background: 'rgba(147,51,234,.11)',
  },
  delivery: {
    label: 'Entrega',
    color: '#08a653',
    background: 'rgba(8,166,83,.12)',
  },
} as const;
/** Presentation only: the original service text remains the saved source of truth. */
export function eventColor(service: string) {
  const text = service
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (/entrega/.test(text)) return EVENT_COLORS.delivery;
  if (/seguimiento|cotiza|llamada|confirmar/.test(text))
    return EVENT_COLORS.followup;
  if (/venta|visita|demostra/.test(text)) return EVENT_COLORS.sales;
  return EVENT_COLORS.workshop;
}

export interface DayEvent {
  row: Appointment;
  start: number;
  end: number;
  lane: number;
  lanes: number;
}
/** Split overnight appointments into the portion visible on each Mexico day. */
export function eventsForDay(rows: Appointment[], day: string): DayEvent[] {
  const from = Date.parse(localToIso(`${day}T00:00`));
  const to = Date.parse(localToIso(`${shiftDay(day, 1)}T00:00`));
  return rows
    .filter((r) => Date.parse(r.starts_at) < to && Date.parse(r.ends_at) > from)
    .map((row) => ({
      row,
      start: Math.max(0, (Date.parse(row.starts_at) - from) / 60000),
      end: Math.min(1440, (Date.parse(row.ends_at) - from) / 60000),
      lane: 0,
      lanes: 1,
    }))
    .sort(
      (a, b) =>
        a.start - b.start || b.end - a.end || a.row.id.localeCompare(b.row.id)
    );
}
/** Pack simultaneous appointments side by side, including short visual blocks. */
export function layoutDay(events: DayEvent[]): DayEvent[] {
  const result: DayEvent[] = [];
  let group: DayEvent[] = [];
  let ends: number[] = [];
  let groupEnd = -1;
  const finish = () => {
    for (const event of group) result.push({ ...event, lanes: ends.length });
    group = [];
    ends = [];
    groupEnd = -1;
  };
  for (const event of events) {
    if (event.start >= groupEnd && group.length) finish();
    let lane = ends.findIndex((end) => end <= event.start);
    if (lane < 0) lane = ends.length;
    const visualEnd = Math.max(event.end, event.start + 30);
    ends[lane] = visualEnd;
    groupEnd = Math.max(groupEnd, visualEnd);
    group.push({ ...event, lane });
  }
  finish();
  return result;
}
export function eventRangeLabel(row: Appointment, day: string) {
  const start = mexicoLocal(row.starts_at),
    end = mexicoLocal(row.ends_at);
  return `${start.slice(0, 10) < day ? '00:00' : start.slice(11)}–${end.slice(0, 10) > day ? '24:00' : end.slice(11)}`;
}
