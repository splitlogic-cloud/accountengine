import 'server-only'

import { createServiceClient } from '@/lib/supabase/server'

interface AuditParams {
  company_id:   string
  bureau_id?:   string
  action:       string
  entity_type:  string
  entity_id:    string
  actor_id?:    string
  before_data?: Record<string, unknown>
  after_data?:  Record<string, unknown>
}

export async function writeAudit(params: AuditParams): Promise<void> {
  try {
    const supabase = createServiceClient()
    await supabase.from('audit_log').insert({
      company_id:  params.company_id,
      bureau_id:   params.bureau_id ?? null,
      action:      params.action,
      entity_type: params.entity_type,
      entity_id:   params.entity_id,
      actor_id:    params.actor_id ?? 'system',
      before_data: params.before_data ?? null,
      after_data:  params.after_data  ?? null,
    })
  } catch (e) {
    console.error('[audit] Failed to write audit log:', e)
  }
}

export enum AuditAction {
  IMPORT_COMPLETED = 'import_completed',
}
