import 'server-only'

import { createServiceClient } from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// writeAuditChain
// Delegates to the DB-level write_audit_chain() function.
// The hash computation happens in PostgreSQL to avoid timing issues.
// ---------------------------------------------------------------------------
export async function writeAuditChain(params: {
  company_id:  string
  event_id?:   string
  entry_id?:   string
  action:      string
  actor_id:    string
  actor_type?: 'user' | 'system' | 'inngest'
  payload:     Record<string, unknown>
}): Promise<void> {
  try {
    const supabase = createServiceClient()

    await supabase.rpc('write_audit_chain', {
      p_company_id: params.company_id,
      p_event_id:   params.event_id   ?? null,
      p_entry_id:   params.entry_id   ?? null,
      p_action:     params.action,
      p_actor_id:   params.actor_id,
      p_actor_type: params.actor_type ?? 'system',
      p_payload:    params.payload,
    })
  } catch (err) {
    // Audit chain writes must never break business flow
    console.error('[audit-chain] Failed to write:', {
      action:   params.action,
      event_id: params.event_id,
      error:    err instanceof Error ? err.message : String(err),
    })
  }
}

// ---------------------------------------------------------------------------
// verifyIntegrity
// Checks hash chain integrity for a company.
// Returns list of broken links.
// ---------------------------------------------------------------------------
export async function verifyIntegrity(
  companyId: string,
  fromSeq:   number = 1,
  limit:     number = 1000,
): Promise<Array<{ sequence_num: number; is_valid: boolean }>> {
  const supabase = createServiceClient()

  const { data } = await supabase.rpc('verify_audit_chain_integrity', {
    p_company_id: companyId,
    p_from_seq:   fromSeq,
    p_limit:      limit,
  })

  return (data ?? []) as Array<{ sequence_num: number; is_valid: boolean }>
}
