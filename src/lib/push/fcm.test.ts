import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, verify } from 'node:crypto';
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account = { project_id: 'drm-test', client_email: 'firebase@drm-test.iam.gserviceaccount.com', private_key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };

beforeEach(() => { vi.resetModules(); vi.stubEnv('FCM_SERVICE_ACCOUNT_JSON', JSON.stringify(account)); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('FCM server delivery', () => {
  it('does not require a server credential until configured', async () => {
    vi.stubEnv('FCM_SERVICE_ACCOUNT_JSON', '');
    const fcm = await import('./fcm');
    expect(fcm.isPushConfigured()).toBe(false);
    await expect(fcm.sendAndroidPush('token','conversation','message','account:user')).rejects.toThrow('not configured');
  });
  it('rejects malformed configuration', async () => {
    vi.stubEnv('FCM_SERVICE_ACCOUNT_JSON', '{bad');
    expect((await import('./fcm')).isPushConfigured()).toBe(false);
  });
  it('signs a short-lived scoped JWT and sends only generic data', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'oauth', expires_in: 3600 }))
      .mockResolvedValue(Response.json({ name: 'accepted' }));
    vi.stubGlobal('fetch', fetcher);
    const fcm = await import('./fcm');
    expect(await fcm.sendAndroidPush('device-token','conv-id','message-id','account:user')).toBe('sent');
    const assertion = (fetcher.mock.calls[0][1].body as URLSearchParams).get('assertion')!;
    const [head,payload,signature] = assertion.split('.');
    expect(verify('RSA-SHA256',Buffer.from(`${head}.${payload}`),keys.publicKey,Buffer.from(signature,'base64url'))).toBe(true);
    const claims = JSON.parse(Buffer.from(payload,'base64url').toString());
    expect(claims.scope).toBe('https://www.googleapis.com/auth/firebase.messaging');
    expect(claims.exp - claims.iat).toBe(3600);
    expect(claims.aud).toBe('https://oauth2.googleapis.com/token');
    const sent = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(sent.message.token).toBe('device-token');
    expect(sent.message.notification).toBeUndefined();
    expect(sent.message.data).toEqual({ conversation_id: 'conv-id', message_id: 'message-id', binding: 'account:user', title: 'DRM CRM', body: 'Tienes un mensaje nuevo. Abre el CRM para verlo.' });
    expect(sent.message.android.priority).toBe('HIGH');
    await fcm.sendAndroidPush('another-token','conv','message','account:user');
    expect(fetcher).toHaveBeenCalledTimes(3); // Reuse the cached OAuth token.
  });
  it('removes only an explicitly unregistered device', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ access_token: 'oauth' }))
      .mockResolvedValueOnce(Response.json({ error: { details: [{ errorCode: 'UNREGISTERED' }] } }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ error: { details: [{ errorCode: 'INVALID_ARGUMENT' }] } }, { status: 400 }));
    vi.stubGlobal('fetch',fetcher);
    const fcm = await import('./fcm');
    expect(await fcm.sendAndroidPush('token','conv','message','account:user')).toBe('expired');
    await expect(fcm.sendAndroidPush('token','conv','message','account:user')).rejects.toThrow('400');
  });
  it('shares concurrent OAuth refreshes', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string) => url.includes('oauth2') ? Response.json({ access_token: 'oauth' }) : Response.json({ name: 'ok' }));
    vi.stubGlobal('fetch',fetcher);
    const fcm = await import('./fcm');
    await Promise.all([fcm.sendAndroidPush('a','c','m','account:user'),fcm.sendAndroidPush('b','c','m','account:user')]);
    expect(fetcher.mock.calls.filter(([url]) => String(url).includes('oauth2'))).toHaveLength(1);
  });
  it('does not leak OAuth provider errors and retries a failed refresh', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('private-detail',{status:403}))
      .mockResolvedValueOnce(Response.json({access_token:'oauth'})).mockResolvedValueOnce(Response.json({name:'ok'}));
    vi.stubGlobal('fetch',fetcher);
    const fcm = await import('./fcm');
    await expect(fcm.sendAndroidPush('a','c','m','account:user')).rejects.toThrow('server authentication failed');
    expect(await fcm.sendAndroidPush('a','c','m','account:user')).toBe('sent');
  });
  it('honors the delivery deadline after OAuth authentication', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({access_token:'oauth'}));
    vi.stubGlobal('fetch',fetcher);
    const controller = new AbortController(); controller.abort();
    const fcm = await import('./fcm');
    await expect(fcm.sendAndroidPush('a','c','m','account:user',controller.signal)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
