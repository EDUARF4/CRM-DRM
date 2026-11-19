import { describe, it, expect } from "vitest";
import { compareAndAssign, resolveAssignmentResult } from "./assignment";

describe("resolveAssignmentResult", () => {
  it("accepts an assignment the database stored as requested", () => {
    expect(resolveAssignmentResult("agent-1", "agent-1")).toEqual({
      assignedAgentId: "agent-1",
      rejected: false,
    });
  });

  it("accepts an unassignment", () => {
    expect(resolveAssignmentResult(null, null)).toEqual({
      assignedAgentId: null,
      rejected: false,
    });
  });

  it("treats a missing stored value as unassigned", () => {
    expect(resolveAssignmentResult(null, undefined)).toEqual({
      assignedAgentId: null,
      rejected: false,
    });
  });

  it("flags a non-member assignee that the database kept as the previous agent", () => {
    expect(resolveAssignmentResult("removed-agent", "agent-1")).toEqual({
      assignedAgentId: "agent-1",
      rejected: true,
    });
  });

  it("flags a non-member assignee that the database cleared", () => {
    expect(resolveAssignmentResult("removed-agent", null)).toEqual({
      assignedAgentId: null,
      rejected: true,
    });
  });
});

describe('concurrent assignment', () => {
  it('allows one agent to claim a free conversation and rejects a stale claim', async () => {
    let stored: string | null = null;
    const db = { from: () => {
      let expected: string | null = null;
      let requested: string | null = null;
      const query = {
        update: (patch: { assigned_agent_id: string | null }) => { requested = patch.assigned_agent_id; return query; },
        eq: (field: string, value: string) => { if (field === 'assigned_agent_id') expected = value; return query; },
        is: () => { expected = null; return query; },
        select: () => query,
        maybeSingle: async () => {
          if (stored !== expected) return { data: null, error: null };
          stored = requested;
          return { data: { assigned_agent_id: stored }, error: null };
        },
      };
      return query;
    } } as unknown as import('@supabase/supabase-js').SupabaseClient;
    const [first, stale] = await Promise.all([
      compareAndAssign(db, 'conversation-a', null, 'agent-a'),
      compareAndAssign(db, 'conversation-a', null, 'agent-b'),
    ]);
    expect(first.data).toEqual({ assigned_agent_id: 'agent-a' });
    expect(stale.data).toBeNull();
    const transfer = await compareAndAssign(db, 'conversation-a', 'agent-a', 'agent-b');
    expect(transfer.data).toEqual({ assigned_agent_id: 'agent-b' });
  });
});
