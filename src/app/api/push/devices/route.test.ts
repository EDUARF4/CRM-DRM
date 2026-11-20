import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ ctx: vi.fn(), rpc: vi.fn(), from: vi.fn(), configured: vi.fn(), encrypt: vi.fn(() => 'ciphertext'), rate: vi.fn() }));
vi.mock('@/lib/auth/account', () => ({ getCurrentAccount: mocks.ctx, toErrorResponse: () => Response.json({error:'unauthorized'},{status:401}) }));
vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: () => ({rpc:mocks.rpc,from:mocks.from}) }));
vi.mock('@/lib/whatsapp/encryption', () => ({encrypt:mocks.encrypt}));
vi.mock('@/lib/push/fcm', () => ({isPushConfigured:mocks.configured}));
vi.mock('@/lib/rate-limit', () => ({checkRateLimit:mocks.rate}));
import { DELETE, GET, POST } from './route';
const payload = { installationId:'00000000-0000-4000-8000-000000000004', secret:'a'.repeat(64), token:'t'.repeat(150) };
function request(method = 'POST', value: unknown = payload, origin = 'https://crm.example') {
  return new Request('https://crm.example/api/push/devices',{method,headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(value)});
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.ctx.mockResolvedValue({accountId:'account-from-session',userId:'user-from-session',role:'agent'});
  mocks.configured.mockReturnValue(true); mocks.rate.mockReturnValue({success:true}); mocks.rpc.mockResolvedValue({data:true,error:null});
});
afterEach(() => vi.unstubAllGlobals());
describe('Android device registration API', () => {
  it('requires a signed-in account', async () => {
    mocks.ctx.mockRejectedValue(new Error('no session'));
    expect((await POST(request())).status).toBe(401); expect((await GET()).status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects cross-origin changes before authentication', async () => {
    expect((await POST(request('POST',payload,'https://other.example'))).status).toBe(403);
    expect((await DELETE(request('DELETE',payload,'https://other.example'))).status).toBe(403);
    expect(mocks.ctx).not.toHaveBeenCalled();
  });
  it('does not register until the server is configured', async () => {
    mocks.configured.mockReturnValue(false);
    expect((await POST(request())).status).toBe(503); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('binds only session identities, encrypts tokens and hashes the device secret', async () => {
    const response = await POST(request('POST',{...payload,accountId:'attacker-account',userId:'attacker-user'}));
    expect(response.status).toBe(200);
    const args = mocks.rpc.mock.calls[0][1];
    expect(args.p_account_id).toBe('account-from-session'); expect(args.p_user_id).toBe('user-from-session');
    expect(args.p_token_encrypted).toBe('ciphertext'); expect(args.p_token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(args.p_secret_hash).toMatch(/^[a-f0-9]{64}$/); expect(args.p_secret_hash).not.toBe(payload.secret);
    expect(JSON.stringify(await response.json())).not.toContain(payload.token);
  });
  it.each([{...payload,secret:'bad'},{...payload,token:'short'},{...payload,installationId:'not-uuid'},[],null])('rejects malformed device input %#', async value => {
    expect((await POST(request('POST',value))).status).toBe(400); expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('rejects oversized bodies', async () => {
    expect((await POST(request('POST',{...payload,extra:'x'.repeat(9000)}))).status).toBe(400);
  });
  it('rejects a viewer account and limits registration traffic', async () => {
    mocks.ctx.mockResolvedValueOnce({role:'viewer'}); expect((await POST(request())).status).toBe(403);
    mocks.rate.mockReturnValueOnce({success:false}); expect((await POST(request())).status).toBe(429);
  });
  it('does not claim success if the installation secret did not match', async () => {
    mocks.rpc.mockResolvedValue({data:false,error:null}); expect((await POST(request())).status).toBe(409);
  });
  it('revokes only this installation, user and account', async () => {
    const chain = {delete:vi.fn(),eq:vi.fn(),then:vi.fn()};
    chain.delete.mockReturnValue(chain);chain.eq.mockReturnValue(chain);chain.then.mockImplementation(resolve=>Promise.resolve({error:null}).then(resolve));
    mocks.from.mockReturnValue(chain);
    expect((await DELETE(request('DELETE',payload))).status).toBe(200);
    expect(chain.eq).toHaveBeenCalledWith('installation_id',payload.installationId);
    expect(chain.eq).toHaveBeenCalledWith('user_id','user-from-session');
    expect(chain.eq).toHaveBeenCalledWith('account_id','account-from-session');
    expect(chain.eq).toHaveBeenCalledWith('secret_hash',expect.stringMatching(/^[a-f0-9]{64}$/));
  });
});
