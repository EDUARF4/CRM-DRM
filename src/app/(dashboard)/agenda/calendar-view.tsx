'use client';
import type { CSSProperties } from 'react';
import { CalendarDays } from 'lucide-react';
import { displayTime, STATUSES, type Appointment } from '@/lib/agenda/model';
import {
  calendarDate,
  calendarPeriod,
  eventColor,
  eventRangeLabel,
  eventsForDay,
  layoutDay,
  type CalendarView,
} from '@/lib/agenda/calendar';
import styles from './calendar.module.css';
interface Props {
  day: string;
  today: string;
  view: CalendarView;
  rows: Appointment[];
  selectedId: string | null;
  memberName: (id: string | null) => string;
  onSelect: (row: Appointment) => void;
  onDay: (day: string) => void;
}
const eventStyle = (row: Appointment): CSSProperties => {
  const palette = eventColor(row.service_type);
  return {
    '--event-color': palette.color,
    '--event-bg': palette.background,
  } as CSSProperties;
};
export function CalendarViewPanel({
  day,
  today,
  view,
  rows,
  selectedId,
  memberName,
  onSelect,
  onDay,
}: Props) {
  const period = calendarPeriod(day, view);
  if (view === 'month') {
    const offset = (new Date(`${period.from}T12:00:00Z`).getUTCDay() + 6) % 7;
    const cells = Math.ceil((period.dates.length + offset) / 7) * 7;
    return (
      <div className={styles.monthScroll}>
        <div className={styles.month}>
          {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((name) => (
            <div className={styles.monthWeekday} key={name}>
              {name}
            </div>
          ))}
          {Array.from({ length: cells }, (_, index) => {
            const date = period.dates[index - offset];
            if (!date)
              return <div key={index} className={styles.monthOutside} />;
            const events = eventsForDay(rows, date);
            return (
              <div
                className={`${styles.monthCell} ${date === today ? styles.today : ''}`}
                key={date}
              >
                <button
                  className={`${styles.dayNumber} ${date === today ? styles.todayNumber : ''}`}
                  onClick={() => onDay(date)}
                  aria-label={`Ver día ${calendarDate(date, { dateStyle: 'long' })}`}
                >
                  {Number(date.slice(8))}
                </button>
                {events.slice(0, 3).map(({ row }) => (
                  <button
                    key={row.id}
                    style={eventStyle(row)}
                    className={`${styles.monthEvent} ${row.id === selectedId ? styles.selectedEvent : ''} ${row.status === 'cancelled' ? styles.cancelled : ''}`}
                    onClick={() => onSelect(row)}
                    aria-pressed={row.id === selectedId}
                    title={`${row.contact_name} · ${row.service_type} · ${STATUSES[row.status]}`}
                  >
                    <span>{displayTime(row.starts_at)}</span> {row.contact_name}
                  </button>
                ))}
                {events.length > 3 && (
                  <button
                    className={styles.moreEvents}
                    onClick={() => onDay(date)}
                  >
                    +{events.length - 3} citas
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }
  const byDay = period.dates.map((date) => ({
    date,
    events: layoutDay(eventsForDay(rows, date)),
  }));
  const allEvents = byDay.flatMap((d) => d.events);
  const firstHour = Math.min(
    9,
    ...allEvents.map((e) => Math.floor(e.start / 60))
  );
  const lastHour = Math.min(
    24,
    Math.max(
      19,
      ...allEvents.map((e) => Math.ceil(Math.max(e.end, e.start + 30) / 60))
    )
  );
  const hours = Array.from(
    { length: lastHour - firstHour },
    (_, i) => firstHour + i
  );
  const height = hours.length * 64;
  return (
    <div className={styles.timeScroll}>
      <div
        className={`${styles.timeGrid} ${view === 'week' ? styles.weekGrid : ''}`}
        style={{ '--day-count': period.dates.length } as CSSProperties}
      >
        <div className={styles.timeCorner}>
          <span>
            Hora
            <br />
            México
          </span>
        </div>
        {byDay.map(({ date }) => (
          <div
            className={`${styles.dayHeader} ${date === today ? styles.today : ''}`}
            key={date}
          >
            <span>
              {calendarDate(date, { weekday: 'short' }).replace('.', '')}
            </span>
            <button
              onClick={() => onDay(date)}
              className={`${styles.dayNumber} ${date === today ? styles.todayNumber : ''}`}
              aria-label={`Ver día ${calendarDate(date, { dateStyle: 'long' })}`}
            >
              {Number(date.slice(8))}
            </button>
          </div>
        ))}
        <div className={styles.timeAxis} style={{ height }}>
          {hours.map((hour) => (
            <span key={hour} style={{ top: (hour - firstHour) * 64 }}>
              {String(hour).padStart(2, '0')}:00
            </span>
          ))}
        </div>
        {byDay.map(({ date, events }) => (
          <div
            key={date}
            className={`${styles.dayColumn} ${date === today ? styles.today : ''}`}
            style={{ height }}
          >
            {hours.map((hour) => (
              <div
                className={styles.hourLine}
                key={hour}
                style={{ top: (hour - firstHour) * 64 }}
              />
            ))}
            {events.map((event) => {
              const { row } = event;
              const eventHeight = Math.min(
                height - ((event.start - firstHour * 60) * 64) / 60,
                Math.max(32, ((event.end - event.start) * 64) / 60)
              );
              return (
                <button
                  key={row.id}
                  style={{
                    ...eventStyle(row),
                    top: ((event.start - firstHour * 60) * 64) / 60,
                    height: eventHeight,
                    left: `calc(${(event.lane / event.lanes) * 100}% + 3px)`,
                    width: `calc(${100 / event.lanes}% - 6px)`,
                  }}
                  className={`${styles.timeEvent} ${row.id === selectedId ? styles.selectedEvent : ''} ${row.status === 'cancelled' ? styles.cancelled : ''}`}
                  onClick={() => onSelect(row)}
                  aria-pressed={row.id === selectedId}
                  aria-label={`${row.contact_name}, ${row.service_type}, ${eventRangeLabel(row, date)}, ${STATUSES[row.status]}`}
                  title={`${row.contact_name}\n${row.service_type} · ${row.unit_reference}\n${eventRangeLabel(row, date)} · ${memberName(row.assigned_agent_id)}\n${STATUSES[row.status]}`}
                >
                  <strong>{row.contact_name}</strong>
                  {eventHeight >= 48 && <span>{row.service_type}</span>}
                  {eventHeight >= 60 && (
                    <span>{memberName(row.assigned_agent_id)}</span>
                  )}
                  {eventHeight >= 42 && (
                    <span>{eventRangeLabel(row, date)}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      {rows.length === 0 && (
        <div className={styles.calendarEmpty}>
          <CalendarDays size={19} /> No hay citas con estos filtros.
        </div>
      )}
    </div>
  );
}
