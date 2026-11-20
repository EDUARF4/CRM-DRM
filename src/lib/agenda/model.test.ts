import { describe, expect, it } from 'vitest';
import {
  localToIso,
  mexicoLocal,
  shiftDay,
  validateAppointment,
} from './model';
const id = '00000000-0000-4000-8000-000000000001';
const values = {
  contact_id: id,
  assigned_agent_id: null,
  unit_reference: 'DRM-123',
  service_type: 'Primer servicio',
  location: 'Taller DRM',
  starts_at: '2027-01-01T16:00:00Z',
  ends_at: '2027-01-01T17:00:00Z',
  status: 'scheduled',
  odometer_km: 1000,
  notes: 'Revisión',
  reminder_enabled: true,
  reminder_consent: true,
  reminder_minutes: 1440,
};
describe('Agenda time and validation', () => {
  it('uses Mexico time regardless of the browser/server local zone', () => {
    expect(localToIso('2027-01-01T10:00')).toBe('2027-01-01T16:00:00.000Z');
    expect(mexicoLocal('2027-01-01T16:00:00Z')).toBe('2027-01-01T10:00');
    expect(localToIso('2027-07-01T10:00')).toBe('2027-07-01T16:00:00.000Z');
    expect(mexicoLocal('2027-01-01T03:00:00Z')).toBe('2026-12-31T21:00');
  });
  it.each([
    '2027-02-30T12:00',
    '2027-13-01T09:00',
    '2027-01-01T25:00',
    'bad',
    '2027-01-01',
  ])('rejects invalid local date %s', (value) =>
    expect(() => localToIso(value)).toThrow()
  );
  it('moves dates over month/year boundaries', () => {
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2027-03-01', -1)).toBe('2027-02-28');
  });
  it('keeps only editable fields and normalizes dates/text', () => {
    const result = validateAppointment({
      ...values,
      unit_reference: ' DRM-123 ',
      account_id: 'spoof',
      reminder_state: 'sent',
      version: 99,
    });
    expect(result.unit_reference).toBe('DRM-123');
    expect(result.starts_at).toBe('2027-01-01T16:00:00.000Z');
    expect(result).not.toHaveProperty('account_id');
    expect(result).not.toHaveProperty('reminder_state');
    expect(result).not.toHaveProperty('version');
  });
  it.each([
    { contact_id: 'bad' },
    { assigned_agent_id: 'bad' },
    { status: 'constructor' },
    { starts_at: 'yesterday' },
    { ends_at: values.starts_at },
    { ends_at: '2027-01-02T17:00:00Z' },
    { reminder_consent: false },
    { reminder_enabled: 'true' },
    { reminder_minutes: 15 },
    { odometer_km: -1 },
    { odometer_km: 1.5 },
    { notes: 'x'.repeat(2001) },
    { unit_reference: ' ' },
    { service_type: '' },
    { location: '' },
  ])('rejects invalid appointment %#', (patch) =>
    expect(() => validateAppointment({ ...values, ...patch })).toThrow()
  );
  it('allows visits with no reminder and no consent', () =>
    expect(
      validateAppointment({
        ...values,
        reminder_enabled: false,
        reminder_consent: false,
      })
    ).toMatchObject({ reminder_enabled: false }));
});
