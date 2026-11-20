import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
const { send, configured, decrypt } = vi.hoisted(() => ({ send: vi.fn(), configured: vi.fn(), decrypt: vi.fn(value => `clear-${value}`) }));
vi.mock('./fcm', () => ({ sendAndroidPush: send, isPushConfigured: configured }));
vi.mock('@/lib/whatsapp/encryption', () => ({ decrypt }));
import { deliverAndroidPush, pushRecipientIds } from './deliver';
const members = [{user_id:'a',account_role:'agent'},{user_id:'b',account_role:'owner'},{user_id:'c',account_role:'viewer'}];
function database(assigned: string | null = null, devices = [{installation_id:'device',token_hash:'hash',token_encrypted:'cipher',user_id:'a'}]) {
  const chains: Record<string, Record<string, ReturnType<typeof vi.fn>>> = {};
  const from = vi.fn((table: string) => {
    const result = table === 'conversations' ? {data:{assigned_agent_id:assigned}} : table === 'profiles' ? {data:members} : {data:devices};
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['select','eq','in','gt','delete']) chain[method] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(async () => result);
    chain.then = vi.fn((resolve) => Promise.resolve(result).then(resolve));
    chains[table] = chain; return chain;
  });
  return {db:{from} as unknown as SupabaseClient,from,chains};
}
beforeEach(() => { vi.clearAllMocks(); configured.mockReturnValue(true); send.mockResolvedValue('sent'); });
describe('Android recipients and delivery', () => {
  it('alerts the assignee only and excludes removed/unknown/viewer users', () => {
    expect([...pushRecipientIds(members,'a')]).toEqual(['a']);
    expect([...pushRecipientIds(members,'removed')]).toEqual([]);
    expect([...pushRecipientIds(members,'c')]).toEqual([]);
    expect([...pushRecipientIds(members,null)]).toEqual(['a','b']);
  });
  it('does no database work until configured', async () => {
    configured.mockReturnValue(false); const {db,from}=database();
    await deliverAndroidPush(db,'account','conversation','message'); expect(from).not.toHaveBeenCalled();
  });
  it('filters current membership, account, assignment and expiry before decrypting', async () => {
    const {db,chains}=database('a');
    await deliverAndroidPush(db,'account','conversation','message');
    expect(chains.conversations.eq).toHaveBeenCalledWith('account_id','account');
    expect(chains.profiles.eq).toHaveBeenCalledWith('account_id','account');
    expect(chains.android_push_devices.eq).toHaveBeenCalledWith('account_id','account');
    expect(chains.android_push_devices.in).toHaveBeenCalledWith('user_id',['a']);
    expect(chains.android_push_devices.gt).toHaveBeenCalledWith('expires_at',expect.any(String));
    expect(send).toHaveBeenCalledWith('clear-cipher','conversation','message','account:a',expect.any(AbortSignal));
  });
  it('never fails normal messaging on delivery errors', async () => {
    send.mockRejectedValue(new Error('failure')); const {db}=database();
    await expect(deliverAndroidPush(db,'a','c','m')).resolves.toBeUndefined();
  });
  it('does not notify a former member assigned to the thread', async () => {
    const {db}=database('removed'); await deliverAndroidPush(db,'a','c','m'); expect(send).not.toHaveBeenCalled();
  });
});
