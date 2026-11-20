import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const run = vi.hoisted(() => vi.fn());
vi.mock('@/lib/agenda/reminders', () => ({ runServiceReminders: run }));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({ kind: 'admin' }),
}));
import { POST } from './route';
const secret = 'x'.repeat(64);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('AGENDA_CRON_SECRET', secret);
  run.mockResolvedValue({ processed: 1 });
});
afterEach(() => vi.unstubAllEnvs());
describe('Agenda scheduler authentication', () => {
  it('stays inactive until configured', async () => {
    vi.stubEnv('AGENDA_CRON_SECRET', '');
    expect((await POST(new Request('https://crm.example'))).status).toBe(503);
    expect(run).not.toHaveBeenCalled();
  });
  it.each(['', 'bad', 'y'.repeat(64)])(
    'rejects unauthorized runs %#',
    async (value) => {
      expect(
        (
          await POST(
            new Request('https://crm.example', {
              headers: { 'x-cron-secret': value },
            })
          )
        ).status
      ).toBe(401);
      expect(run).not.toHaveBeenCalled();
    }
  );
  it('runs only with the configured secret', async () => {
    expect(
      (
        await POST(
          new Request('https://crm.example', {
            headers: { 'x-cron-secret': secret },
          })
        )
      ).status
    ).toBe(200);
    expect(run).toHaveBeenCalledWith({ kind: 'admin' });
  });
});
