// Share the same request for double clicks. Retain the key on ambiguous
// network/server failures so retrying the same payload cannot send it twice.
const requests = new Map<string, { id: string; pending?: Promise<Response> }>();
export async function sendInboxRequest(
  body: Record<string, unknown>
): Promise<Response> {
  const key = JSON.stringify(body);
  let entry = requests.get(key);
  if (!entry) {
    entry = { id: crypto.randomUUID() };
    requests.set(key, entry);
  }
  if (!entry.pending) {
    const current = entry;
    current.pending = fetch('/api/whatsapp/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': current.id,
      },
      body: key,
    })
      .then((response) => {
        // Validation/auth errors did not send anything; a new attempt may proceed.
        if (response.ok || [400, 401, 403, 404, 429].includes(response.status))
          requests.delete(key);
        return response;
      })
      .finally(() => {
        current.pending = undefined;
      });
  }
  // Each caller reads its own body, even when sharing an in-flight response.
  const pending = entry.pending!;
  return (await pending).clone();
}
