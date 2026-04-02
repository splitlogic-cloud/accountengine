import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'

interface AuditEntry {
  bureau_id: string
  company_id?: string
  user_id?: string
  action: string
  entity_type: string
  entity_id?: string
  before_data?: Record<string, unknown>
  after_data?: Record<string, unknown>
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    const supabase = createServiceClient()
    await supabase.from('audit_log').insert(entry)
  } catch (err) {
    console.error('Audit log error:', err)
  }
}

export const AuditActions = {
  RULE_MATCHED:           'rule_matched',
  RULE_CREATED:           'rule_created',
  POSTING_APPROVED:       'posting_approved',
  POSTING_REJECTED:       'posting_rejected',
  FORTNOX_CONNECTED:      'fortnox_connected',
  FORTNOX_SYNC_COMPLETED: 'fortnox_sync_completed',
  FORTNOX_SYNC_FAILED:    'fortnox_sync_failed',
  TOKEN_REFRESHED:        'token_refreshed',
  COMPANY_CREATED:        'company_created',
  USER_INVITED:           'user_invited',
  ISOLATION_VIOLATION:    'isolation_violation',
} as const
