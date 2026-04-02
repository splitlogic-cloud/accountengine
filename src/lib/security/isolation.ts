import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { writeAuditLog } from '@/lib/audit'

export class IsolationError extends Error {
  company_id: string
  bureau_id: string
  constructor(message: string, company_id: string, bureau_id: string) {
    super(message)
    this.name = 'IsolationError'
    this.company_id = company_id
    this.bureau_id = bureau_id
  }
}

export async function assertCompanyBelongsToBureau(
  company_id: string,
  bureau_id: string
): Promise<void> {
  const supabase = createServiceClient()
  const { data: company } = await supabase
    .from('companies').select('bureau_id, name').eq('id', company_id).single()

  if (!company) throw new IsolationError(`Company ${company_id} not found`, company_id, bureau_id)

  if (company.bureau_id !== bureau_id) {
    await writeAuditLog({
      bureau_id, company_id, action: 'ISOLATION_VIOLATION', entity_type: 'security',
      after_data: { requested_bureau: bureau_id, actual_bureau: company.bureau_id }
    }).catch(console.error)
    throw new IsolationError(
      `ISOLATION VIOLATION: Company ${company.name} belongs to different bureau`,
      company_id, bureau_id
    )
  }
}

export async function getBureauId(userId: string): Promise<string> {
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('bureau_users').select('bureau_id').eq('user_id', userId).single()
  if (!data) throw new Error('User has no bureau')
  return data.bureau_id
}

export async function assertUserCanAccessCompany(
  userId: string, company_id: string
): Promise<{ bureau_id: string }> {
  const bureau_id = await getBureauId(userId)
  await assertCompanyBelongsToBureau(company_id, bureau_id)
  return { bureau_id }
}
