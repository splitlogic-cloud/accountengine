'use server'

import { createServiceClient }   from '@/lib/supabase/server'
import { createDraftEntry, postEntry } from '@/lib/accounting/journal-service'
import { assertCompanyAccess }   from '@/lib/security/access'
import { revalidatePath }        from 'next/cache'
import type { CreateJournalEntryDTO } from '@/types/database'

// ---------------------------------------------------------------------------
// saveDraftEntry
// Saves a draft journal entry without posting it.
// ---------------------------------------------------------------------------
export async function saveDraftEntry(
  dto:    CreateJournalEntryDTO,
  userId: string,
): Promise<{ id: string; entry_number_preview: string }> {
  // Validate access
  const access = await assertCompanyAccess(dto.company_id, userId, 'accountant')
  if (!access.ok) throw new Error(access.error.message)

  const result = await createDraftEntry(dto, userId)
  if (!result.ok) throw new Error(result.error.message)

  revalidatePath(`/${dto.company_id}/ledger`)

  return {
    id:                    result.value.id,
    entry_number_preview:  result.value.entry_number,
  }
}

// ---------------------------------------------------------------------------
// postManualEntry
// Creates draft + immediately posts it.
// ---------------------------------------------------------------------------
export async function postManualEntry(
  dto:    CreateJournalEntryDTO,
  userId: string,
): Promise<{ entry_number: string; entry_id: string }> {
  // Validate access
  const access = await assertCompanyAccess(dto.company_id, userId, 'accountant')
  if (!access.ok) throw new Error(access.error.message)

  // Create draft
  const draftResult = await createDraftEntry(dto, userId)
  if (!draftResult.ok) throw new Error(draftResult.error.message)

  const entryId = draftResult.value.id

  // Post it
  const postResult = await postEntry(entryId, dto.company_id, userId)
  if (!postResult.ok) throw new Error(postResult.error.message)

  revalidatePath(`/${dto.company_id}/ledger`)
  revalidatePath(`/${dto.company_id}`)

  return {
    entry_id:     entryId,
    entry_number: postResult.value.entry_number ?? draftResult.value.entry_number,
  }
}

// ---------------------------------------------------------------------------
// reverseEntry
// ---------------------------------------------------------------------------
export async function reverseJournalEntry(
  entryId:      string,
  companyId:    string,
  userId:       string,
  reversalDate: string,
  reason:       string,
): Promise<{ entry_number: string }> {
  const access = await assertCompanyAccess(companyId, userId, 'accountant')
  if (!access.ok) throw new Error(access.error.message)

  const { reverseEntry } = await import('@/lib/accounting/journal-service')
  const result = await reverseEntry(entryId, companyId, userId, {
    reversal_date: reversalDate,
    description:   reason,
  })

  if (!result.ok) throw new Error(result.error.message)

  revalidatePath(`/${companyId}/ledger`)

  return { entry_number: result.value.entry_number }
}

// ---------------------------------------------------------------------------
// closePeriod
// ---------------------------------------------------------------------------
export async function closePeriod(
  companyId:   string,
  fiscalYear:  number,
  periodMonth: number,
  userId:      string,
): Promise<void> {
  const access = await assertCompanyAccess(companyId, userId, 'admin')
  if (!access.ok) throw new Error(access.error.message)

  const supabase = createServiceClient()
  const { error } = await supabase.rpc('close_period', {
    p_company_id:   companyId,
    p_fiscal_year:  fiscalYear,
    p_period_month: periodMonth,
    p_closed_by:    userId,
  })

  if (error) throw new Error(error.message)
  revalidatePath(`/${companyId}/ledger`)
}

// ---------------------------------------------------------------------------
// createCompany — used in onboarding
// ---------------------------------------------------------------------------
export async function createCompany(input: {
  bureau_id:  string
  name:       string
  org_number: string
  user_id:    string
}): Promise<{ company_id: string }> {
  const supabase = createServiceClient()

  const slug = input.name
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')

  const { data: company, error: coErr } = await supabase
    .from('companies')
    .insert({
      bureau_id:   input.bureau_id,
      name:        input.name,
      org_number:  input.org_number || null,
      slug:        slug + '-' + Date.now().toString(36),
      status:      'active',
    })
    .select('id')
    .single()

  if (coErr || !company) throw new Error(coErr?.message ?? 'Could not create company')

  // Add creator as owner
  await supabase.from('company_members').insert({
    company_id:  company.id,
    user_id:     input.user_id,
    role:        'owner',
    is_primary:  true,
    accepted_at: new Date().toISOString(),
  })

  // Link to bureau
  await supabase.from('bureau_clients').insert({
    bureau_id:  input.bureau_id,
    company_id: company.id,
  })

  // BAS seed happens via DB trigger (company_seed_bas)

  revalidatePath('/dashboard')
  revalidatePath('/clients')

  return { company_id: company.id }
}
