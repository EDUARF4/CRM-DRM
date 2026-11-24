import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import manifest from '@/app/manifest';

function worker() {
  const listeners = new Map<string, (event: Record<string, unknown>) => void>();
  const cache = { add: vi.fn(async () => {}), match: vi.fn(async () => new Response('Offline only')), put: vi.fn() };
  const cacheApi = { open: vi.fn(async () => cache), keys: vi.fn(async () => ['drm-offline-v0', 'drm-offline-v1', 'unrelated-cache']), delete: vi.fn(async () => true) };
  const network = vi.fn(async () => new Response('Private chat'));
  const claim = vi.fn(async () => {});
  vm.runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    self: { addEventListener: (name: string, listener: (event: Record<string, unknown>) => void) => listeners.set(name, listener), location: { origin: 'https://crm.example' }, clients: { claim } },
    caches: cacheApi, fetch: network, URL, Response,
  });
  return { listeners, cache, cacheApi, network, claim };
}

describe('DRM installable app', () => {
  it('opens the authenticated inbox in a standalone window with real icons', () => {
    const app = manifest();
    expect(app.start_url).toBe('/inbox');
    expect(app.scope).toBe('/');
    expect(app.display).toBe('standalone');
    for (const icon of app.icons!) {
      const png = readFileSync('public' + icon.src);
      expect(png.subarray(1,4).toString()).toBe('PNG');
      const size = Number(icon.sizes!.split('x')[0]);
      expect(png.readUInt32BE(16)).toBe(size);
      expect(png.readUInt32BE(20)).toBe(size);
    }
  });
  it('pre-caches only the generic offline document', async () => {
    const w = worker();
    let pending: Promise<unknown> | undefined;
    w.listeners.get('install')!({ waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
    expect(w.cache.add).toHaveBeenCalledExactlyOnceWith('/offline.html');
    expect(w.cache.put).not.toHaveBeenCalled();
  });
  it('returns live navigation responses without caching private data', async () => {
    const w = worker();
    let response: Promise<Response> | undefined;
    w.listeners.get('fetch')!({ request: { url: 'https://crm.example/inbox', method: 'GET', mode: 'navigate' }, respondWith: (value: Promise<Response>) => { response = value; } });
    expect(await (await response!).text()).toBe('Private chat');
    expect(w.cache.put).not.toHaveBeenCalled();
    expect(w.cacheApi.open).not.toHaveBeenCalled();
  });
  it('uses only the generic fallback when an offline navigation fails', async () => {
    const w = worker(); w.network.mockRejectedValueOnce(new Error('offline'));
    let response: Promise<Response> | undefined;
    w.listeners.get('fetch')!({ request: { url: 'https://crm.example/inbox', method: 'GET', mode: 'navigate' }, respondWith: (value: Promise<Response>) => { response = value; } });
    expect(await (await response!).text()).toBe('Offline only');
    expect(w.cache.match).toHaveBeenCalledExactlyOnceWith('/offline.html');
  });
  it.each([
    { url: 'https://crm.example/api/whatsapp/send', method: 'POST', mode: 'same-origin' },
    { url: 'https://crm.example/api/messages', method: 'GET', mode: 'navigate' },
    { url: 'https://crm.example/auth/callback', method: 'GET', mode: 'navigate' },
    { url: 'https://storage.example/file.pdf', method: 'GET', mode: 'navigate' },
    { url: 'https://crm.example/api/messages', method: 'GET', mode: 'cors' },
  ])('does not intercept private API, auth, file or non-navigation traffic: %o', (request) => {
    const w = worker(); const respondWith = vi.fn();
    w.listeners.get('fetch')!({ request, respondWith });
    expect(respondWith).not.toHaveBeenCalled();
    expect(w.network).not.toHaveBeenCalled();
  });
  it('cleans only old DRM offline caches', async () => {
    const w = worker(); let pending: Promise<unknown> | undefined;
    w.listeners.get('activate')!({ waitUntil: (promise: Promise<unknown>) => { pending = promise; } });
    await pending;
    expect(w.cacheApi.delete).toHaveBeenCalledExactlyOnceWith('drm-offline-v0');
    expect(w.claim).toHaveBeenCalledOnce();
  });
});
