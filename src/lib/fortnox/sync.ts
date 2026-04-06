import { fortnoxRequest, refreshFortnoxToken } from './client'
import { createServiceClient } from '@/lib/supabase/server'
import type { Company, Transaction } from '@/lib/types/database'

export async function syncCompany(company: Company): Promise<{
  imported: number
  errors: string[]
}> {
  const supabase = createServiceClient()
  const errors: string[] = []
  let accessToken = company.fortnox_access_token!

  // Refresha token om den löper ut inom 5 minuter
  if (company.fortnox_token_expires) {
    const expires = new Date(company.fortnox_token_expires)
    if (expires.getTime() - Date.now() < 5 * 60 * 1000) {
      const tokens = await refreshFortnoxToken(company.fortnox_refresh_token!)
      accessToken = tokens.access_token
      await supabase
        .from('companies')
        .update({
          fortnox_access_token:  tokens.access_token,
          fortnox_refresh_token: tokens.refresh_token ?? company.fortnox_refresh_token,
          fortnox_token_expires: new Date(
            Date.now() + tokens.expires_in * 1000
          ).toISOString(),
        })
        .eq('id', company.id)
    }
  }

  // Märk bolaget som synkande
  await supabase
    .from('companies')
    .update({ sync_status: 'syncing' })
    .eq('id', company.id)

  try {
    // Hämta verifikat från Fortnox (senaste 90 dagarna)
    const fromDate = new Date()
    fromDate.setDate(fromDate.getDate() - 90)
    const fromStr = fromDate.toISOString().split('T')[0]

    const data = await fortnoxRequest<{ Vouchers: { Voucher: FortnoxVoucher[] } }>(
      `/vouchers?filter=UNBOOKED&fromdate=${fromStr}`,
      accessToken
    )

    const vouchers = data?.Vouchers?.Voucher ?? []
    const transactions = vouchers.map(v =>
      normalizeFortnoxVoucher(v, company)
    ).filter(Boolean) as Transaction[]

    if (transactions.length > 0) {
      // Upsert — inga duplikat
      const { error } = await supabase
        .from('transactions')
        .upsert(transactions, {
          onConflict: 'company_id,source,external_id',
          ignoreDuplicates: false,
        })
      if (error) errors.push(error.message)
    }

    // Markera som klar
    await supabase
      .from('companies')
      .update({
        sync_status: 'synced',
        last_synced_at: new Date().toISOString(),
        sync_error: null,
      })
      .eq('id', company.id)

    return { imported: transactions.length, errors }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    errors.push(msg)
    await supabase
      .from('companies')
      .update({
        sync_status: 'error',
        sync_error: msg,
      })
      .eq('id', company.id)
    return { imported: 0, errors }
  }
}

// Normalisera ett Fortnox-verifikat till vårt transaktionsformat
function normalizeFortnoxVoucher(
  voucher: FortnoxVoucher,
  company: Company
): Omit<Transaction, 'id' | 'created_at' | 'updated_at'> | null {
  const totalDebit = voucher.VoucherRows?.reduce(
    (sum, row) => sum + (parseFloat(row.Debit) || 0), 0
  ) ?? 0

  return {
    company_id:         company.id,
    bureau_id:          company.bureau_id,
    source:             'fortnox',
    external_id:        `${voucher.Series}-${voucher.VoucherNumber}`,
    external_ref:       voucher.ReferenceNumber ?? null,
    transaction_type:   'manual',
    amount:             totalDebit,
    currency:           'SEK',
    transaction_date:   voucher.TransactionDate,
    description:        voucher.Description ?? null,
    counterpart_name:   null,
    counterpart_org:    null,
    customer_country:   null,
    tax_treatment:      'unknown',
    vat_rate:           null,
    posting_status:     'pending',
    rule_id:            null,
    raw_data:           voucher as unknown as Record<string, unknown>,
  }
}

// Fortnox API typer
interface FortnoxVoucher {
  VoucherNumber: string
  Series: string
  TransactionDate: string
  Description?: string
  ReferenceNumber?: string
  VoucherRows?: Array<{
    Account: string
    Debit: string
    Credit: string
    Description?: string
  }>
}
