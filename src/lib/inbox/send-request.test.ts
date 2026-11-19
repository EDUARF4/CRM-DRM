import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
const body = { conversation_id: 'test-conversation', message_type: 'text', content_text: 'Hola' };
describe('inbox request deduplication', () => {
  it('shares concurrent requests and gives each caller a readable response', async () => {
    const fetchMock = vi.fn(async () => Response.json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { sendInboxRequest } = await import('./send-request');
    const [a, b] = await Promise.all([sendInboxRequest(body), sendInboxRequest(body)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await a.json()).toEqual({ success: true });
    expect(await b.json()).toEqual({ success: true });
  });
  it('keeps the same key when retrying after a network failure', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Response.json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { sendInboxRequest } = await import('./send-request');
    await expect(sendInboxRequest(body)).rejects.toThrow('offline');
    await sendInboxRequest(body);
    expect(fetchMock.mock.calls[0][1].headers['Idempotency-Key']).toBe(fetchMock.mock.calls[1][1].headers['Idempotency-Key']);
  });
  it('keeps uncertain server results but allows deliberate repeated text after success', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ success: true })).mockResolvedValueOnce(Response.json({ success: true }));
    vi.stubGlobal('fetch', fetchMock);
    const { sendInboxRequest } = await import('./send-request');
    await sendInboxRequest(body);
    await sendInboxRequest(body);
    await sendInboxRequest(body);
    const keys = fetchMock.mock.calls.map(call => call[1].headers['Idempotency-Key']);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });
});
