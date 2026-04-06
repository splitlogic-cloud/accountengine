import 'server-only'

import { createServiceClient } from '@/lib/supabase/server'
import type { Result }         from '@/types/database'
import { ok, err }             from '@/types/database'

export class AccessError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'AccessError'
  }
}

type Role = 'reader' | 'accountant' | 'admin' | 'owner'

const ROLE_LEVEL: Record<Role, number> = {
  reader:     1,
  accountant: 2,
  admin:      3,
  owner:      4,
}

export async function assertCompanyAccess(
  companyId:   string,
  userId:      string,
  minimumRole: Role = 'accountant',
): Promise<Result<{ role: Role }, AccessError>> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('company_members')
    .select('role')
    .eq('company_id', companyId)
    .eq('user_id', userId)
    .not('accepted_at', 'is', null)
    .single()

  if (error || !data) {
    return err(new AccessError(
      `Åtkomst nekad till bolag ${companyId}.`,
      'ACCESS_DENIED',
    ))
  }

  const userLevel     = ROLE_LEVEL[data.role as Role] ?? 0
  const requiredLevel = ROLE_LEVEL[minimumRole]

  if (userLevel < requiredLevel) {
    return err(new AccessError(
      `Otillräcklig roll. Kräver: ${minimumRole}, har: ${data.role}.`,
      'INSUFFICIENT_ROLE',
    ))
  }

  return ok({ role: data.role as Role })
}

export function validateUUID(value: unknown): value is string {
  if (typeof value !== 'string') return false
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
