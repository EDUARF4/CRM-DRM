export interface AssignmentResult {
  assignedAgentId: string | null;
  rejected: boolean;
}

export function resolveAssignmentResult(
  requestedAgentId: string | null,
  storedAgentId: string | null | undefined,
): AssignmentResult {
  const assignedAgentId = storedAgentId ?? null;
  return {
    assignedAgentId,
    rejected: assignedAgentId !== requestedAgentId,
  };
}

/** Compare-and-set: a stale agent view must not overwrite a newer assignment. */
export async function compareAndAssign(
  db: import('@supabase/supabase-js').SupabaseClient,
  conversationId: string,
  expectedAgentId: string | null,
  requestedAgentId: string | null,
) {
  let query = db.from('conversations')
    .update({ assigned_agent_id: requestedAgentId }).eq('id', conversationId);
  query = expectedAgentId === null
    ? query.is('assigned_agent_id', null)
    : query.eq('assigned_agent_id', expectedAgentId);
  return query.select('assigned_agent_id').maybeSingle();
}
