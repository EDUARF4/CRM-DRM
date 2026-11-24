import { describe, expect, it } from 'vitest';
import {
  calendarPeriod,
  eventsForDay,
  eventRangeLabel,
  layoutDay,
  movePeriod,
} from './calendar';
import { localToIso, type Appointment } from './model';
const row = (id: string, start: string, end: string) =>
  ({
    id,
    starts_at: localToIso(start),
    ends_at: localToIso(end),
  }) as Appointment;
describe('Calendar ranges and event geometry', () => {
  it('uses Monday to Sunday, even across year boundaries', () => {
    const period = calendarPeriod('2027-01-03', 'week');
    expect(period.from).toBe('2026-12-28');
    expect(period.to).toBe('2027-01-04');
    expect(period.dates).toHaveLength(7);
  });
  it.each([
    ['2028-02-21', 29],
    ['2027-02-21', 28],
    ['2026-10-31', 31],
  ])(
    'requests only the displayed month, within the 31-day API limit: %s',
    (date, count) => {
      expect(calendarPeriod(date as string, 'month').dates).toHaveLength(
        count as number
      );
    }
  );
  it('moves from a 31st to the next month without skipping February', () => {
    expect(movePeriod('2027-01-31', 'month', 1)).toBe('2027-02-01');
    expect(movePeriod('2027-01-31', 'month', -1)).toBe('2026-12-01');
  });
  it('splits overnight appointments and excludes adjacent boundary events', () => {
    const event = row('a', '2027-01-01T23:30', '2027-01-02T01:30');
    expect(eventsForDay([event], '2027-01-01')[0]).toMatchObject({
      start: 1410,
      end: 1440,
    });
    expect(eventsForDay([event], '2027-01-02')[0]).toMatchObject({
      start: 0,
      end: 90,
    });
    expect(eventsForDay([event], '2027-01-03')).toEqual([]);
    expect(eventRangeLabel(event, '2027-01-01')).toBe('23:30–24:00');
    expect(eventRangeLabel(event, '2027-01-02')).toBe('00:00–01:30');
    expect(
      eventsForDay(
        [row('b', '2027-01-01T23:00', '2027-01-02T00:00')],
        '2027-01-02'
      )
    ).toEqual([]);
  });
  it('keeps simultaneous and chained appointments visible in separate lanes', () => {
    const events = layoutDay(
      eventsForDay(
        [
          row('a', '2027-01-01T09:00', '2027-01-01T10:00'),
          row('b', '2027-01-01T09:30', '2027-01-01T10:30'),
          row('c', '2027-01-01T10:00', '2027-01-01T11:00'),
          row('d', '2027-01-01T12:00', '2027-01-01T13:00'),
        ],
        '2027-01-01'
      )
    );
    expect(events.map((e) => [e.row.id, e.lane, e.lanes])).toEqual([
      ['a', 0, 2],
      ['b', 1, 2],
      ['c', 0, 2],
      ['d', 0, 1],
    ]);
  });
  it('accounts for short visual blocks so adjacent five-minute slots do not cover each other', () => {
    const events = layoutDay(
      eventsForDay(
        [
          row('a', '2027-01-01T09:00', '2027-01-01T09:05'),
          row('b', '2027-01-01T09:05', '2027-01-01T09:10'),
        ],
        '2027-01-01'
      )
    );
    expect(events.map((e) => e.lane)).toEqual([0, 1]);
  });
});
