import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  current: vi.fn(),
  role: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));
vi.mock('@/lib/auth/account', () => ({
  getCurrentAccount: mocks.current,
  requireRole: mocks.role,
  toErrorResponse: (error: { status?: number }) =>
    Response.json({ error: 'Denied' }, { status: error.status ?? 500 }),
}));
vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => ({ rpc: mocks.rpc }),
}));
import { GET, POST } from './route';
import { DELETE, PATCH } from './[id]/route';
const id = '00000000-0000-4000-8000-000000000001';
const payload = {
  id,
  contact_id: id,
  assigned_agent_id: null,
  unit_reference: 'DRM-1',
  service_type: 'Servicio',
  location: 'Taller',
  starts_at: '2027-01-01T16:00:00Z',
  ends_at: '2027-01-01T17:00:00Z',
  status: 'scheduled',
  odometer_km: null,
  notes: '',
  reminder_enabled: false,
  reminder_consent: false,
  reminder_minutes: 1440,
};
function request(
  method = 'POST',
  body: unknown = payload,
  origin = 'https://lightblue-reindeer-349968.hostingersite.com'
) {
  return new Request('http://internal:3000/api/agenda/appointments', {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  const ctx = {
    accountId: 'session-account',
    userId: 'session-user',
    supabase: { from: mocks.from },
  };
  mocks.current.mockResolvedValue(ctx);
  mocks.role.mockResolvedValue(ctx);
  mocks.rpc.mockResolvedValue({
    data: { ...payload, version: 1 },
    error: null,
  });
});
describe('Agenda API access and versions', () => {
  it('requires an authenticated agent and a trusted origin to delete', async () => {
    const ctx = { params: Promise.resolve({ id }) };
    expect(
      (
        await DELETE(
          request('DELETE', { version: 1 }, 'https://evil.example'),
          ctx
        )
      ).status
    ).toBe(403);
    expect(mocks.role).not.toHaveBeenCalled();
    mocks.role.mockRejectedValue({ status: 403 });
    expect((await DELETE(request('DELETE', { version: 1 }), ctx)).status).toBe(
      403
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('deletes only the requested version in the server account, ignoring supplied identities', async () => {
    const response = await DELETE(
      request('DELETE', { version: 4, account_id: 'other', user_id: 'other' }),
      { params: Promise.resolve({ id }) }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(mocks.rpc).toHaveBeenCalledWith('delete_service_appointment', {
      p_id: id,
      p_account_id: 'session-account',
      p_actor_id: 'session-user',
      p_expected_version: 4,
    });
  });
  it.each([{}, { version: 0 }, { version: 1.5 }])(
    'rejects deletion without a valid expected version: %j',
    async (body) => {
      expect(
        (
          await DELETE(request('DELETE', body), {
            params: Promise.resolve({ id }),
          })
        ).status
      ).toBe(400);
      expect(mocks.rpc).not.toHaveBeenCalled();
    }
  );
  it.each(['AGENDA_VERSION', 'AGENDA_SENDING'])(
    'keeps a conflicting deletion visible as a failure: %s',
    async (message) => {
      mocks.rpc.mockResolvedValue({ error: { message } });
      expect(
        (
          await DELETE(request('DELETE', { version: 1 }), {
            params: Promise.resolve({ id }),
          })
        ).status
      ).toBe(409);
    }
  );
  it('requires agent access before any create/edit', async () => {
    mocks.role.mockRejectedValue({ status: 403 });
    expect((await POST(request())).status).toBe(403);
    expect(
      (
        await PATCH(request('PATCH', { ...payload, version: 1 }), {
          params: Promise.resolve({ id }),
        })
      ).status
    ).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects a foreign browser origin behind the proxy', async () => {
    expect(
      (await POST(request('POST', payload, 'https://evil.example'))).status
    ).toBe(403);
    expect(mocks.role).not.toHaveBeenCalled();
  });
  it('binds contact creation to server session identities only', async () => {
    expect(
      (
        await POST(
          request('POST', {
            ...payload,
            account_id: 'other',
            created_by: 'other',
          })
        )
      ).status
    ).toBe(201);
    expect(mocks.role).toHaveBeenCalledWith('agent');
    expect(mocks.rpc).toHaveBeenCalledWith(
      'save_service_appointment',
      expect.objectContaining({
        p_account_id: 'session-account',
        p_actor_id: 'session-user',
        p_expected_version: 0,
      })
    );
    expect(mocks.rpc.mock.calls[0][1].p_values).not.toHaveProperty(
      'account_id'
    );
  });
  it('rejects invalid consent before touching the database', async () => {
    expect(
      (await POST(request('POST', { ...payload, reminder_enabled: true })))
        .status
    ).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('passes the expected version to atomic updates', async () => {
    expect(
      (
        await PATCH(request('PATCH', { ...payload, version: 4 }), {
          params: Promise.resolve({ id }),
        })
      ).status
    ).toBe(200);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({
      p_expected_version: 4,
      p_id: id,
      p_account_id: 'session-account',
    });
  });
  it.each(['AGENDA_VERSION', 'AGENDA_OVERLAP', 'AGENDA_SENDING'])(
    'reports a conflict without claiming success: %s',
    async (message) => {
      mocks.rpc.mockResolvedValue({ error: { message }, data: null });
      expect((await POST(request())).status).toBe(409);
    }
  );
  it('requires authentication to list and rejects unbounded date ranges', async () => {
    mocks.current.mockRejectedValueOnce({ status: 401 });
    expect(
      (await GET(new Request('https://crm.example/api/agenda/appointments')))
        .status
    ).toBe(401);
    expect(
      (
        await GET(
          new Request(
            'https://crm.example/api/agenda/appointments?from=2027-01-01&to=2028-01-01'
          )
        )
      ).status
    ).toBe(400);
  });
  it('scopes reads to the account and reports truncated periods', async () => {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['select', 'eq', 'lt', 'gt', 'order', 'limit'])
      chain[method] = vi.fn(() => chain);
    chain.then = vi.fn((resolve) =>
      Promise.resolve({
        data: Array.from({ length: 201 }, () => payload),
        error: null,
      }).then(resolve)
    );
    mocks.from.mockReturnValue(chain);
    const result = await GET(
      new Request(
        'https://crm.example/api/agenda/appointments?from=2027-01-01&to=2027-01-08&account_id=other'
      )
    );
    expect(chain.eq).toHaveBeenCalledWith('account_id', 'session-account');
    const data = await result.json();
    expect(data.appointments).toHaveLength(200);
    expect(data.truncated).toBe(true);
  });
});
