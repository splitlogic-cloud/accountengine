import { inngest } from '../client'
import { createServiceClient } from '@/lib/supabase/server'
import { saveTransactions } from '@/lib/connectors/save'
import { writeAuditLog, AuditActions } from '@/lib/audit'
import { decrypt, encrypt } from '@/lib/crypto'

export const syncCompanyFn = inngest.createFunction(
  {
    id: 'sync-company',
    name: 'Synkronisera bolag mot Fortnox',
    concurrency: { limit: 5, key: 'event.data.bureau_id' },
    retries: 3,
    timeouts: { finish: '10m' },
  },
  { event: 'company/sync.requested' as const },
  async ({ event, step, logger }) => {
    const { company_id, bureau_id, triggered_by } = event.data as {
      company_id: string; bureau_id: string; triggered_by: string
    }

    // Temporärt: Fortnox-synken är avstängd som default.
    // Sätt `FORTNOX_SYNC_ENABLED=true` för att slå på igen.
    if (process.env.FORTNOX_SYNC_ENABLED !== 'true') {
      const supabase = createServiceClient()
      await supabase.from('companies').update({
        sync_status: 'idle',
        sync_error: null,
      }).eq('id', company_id)

      logger.info('Fortnox sync skipped (FORTNOX_SYNC_ENABLED != true)')
      return { success: true, imported: 0, errors: [] as string[] }
    }

    const company = await step.run('fetch-company', async () => {
      const supabase = createServiceClient()
      const { data, error } = await supabase
        .from('companies').select('*').eq('id', company_id).single()
      if (error || !data) throw new Error(`Company not found: ${company_id}`)
      return data
    })

    const transactions = await step.run('fortnox-sync', async () => {
      const {
        fortnoxRequest,
        refreshFortnoxToken,
        FortnoxTokenExpiredError,
        FortnoxRateLimitError,
      } = await import('@/lib/fortnox/client')

      let accessToken = decrypt(company.fortnox_access_token!)

      // Refresh token if expiring within 5 minutes
      if (company.fortnox_token_expires) {
        const expires = new Date(company.fortnox_token_expires)
        if (expires.getTime() - Date.now() < 5 * 60 * 1000) {
          try {
            const tokens = await refreshFortnoxToken(decrypt(company.fortnox_refresh_token!))
            accessToken = tokens.access_token
            const supabase = createServiceClient()
            await supabase.from('companies').update({
              fortnox_access_token:  encrypt(tokens.access_token),
              fortnox_refresh_token: encrypt(tokens.refresh_token ?? decrypt(company.fortnox_refresh_token!)),
              fortnox_token_expires: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
            }).eq('id', company_id)
          } catch (err) {
            if (err instanceof FortnoxTokenExpiredError || err instanceof FortnoxRateLimitError) throw err
          }
        }
      }

      const fromDate = new Date()
      fromDate.setDate(fromDate.getDate() - 90)
      const fromStr = fromDate.toISOString().split('T')[0]

      const data = await fortnoxRequest<{ Vouchers?: { Voucher?: any[] } }>(
        `/vouchers?fromdate=${fromStr}`,
        accessToken
      )

      const vouchers = data?.Vouchers?.Voucher ?? []
      return vouchers.map((v: any) => ({
        company_id,
        bureau_id,
        source: 'fortnox',
        external_id: `${v.Series}-${v.VoucherNumber}`,
        external_ref: v.ReferenceNumber ?? null,
        transaction_type: 'manual' as const,
        amount: v.VoucherRows?.reduce((s: number, r: any) => s + (parseFloat(r.Debit) || 0), 0) ?? 0,
        currency: 'SEK',
        transaction_date: v.TransactionDate,
        description: v.Description ?? null,
        counterpart_name: null,
        counterpart_org: null,
        customer_country: null,
        tax_treatment: 'unknown' as const,
        vat_rate: null,
        posting_status: 'pending' as const,
        rule_id: null,
        raw_data: v,
      }))
    })

    const result = await step.run('save', async () => saveTransactions(transactions))

    await step.run('update-status', async () => {
      const supabase = createServiceClient()
      await supabase.from('companies').update({
        sync_status: 'synced',
        last_synced_at: new Date().toISOString(),
        sync_error: null,
      }).eq('id', company_id)
    })

    await step.run('audit', async () => {
      await writeAuditLog({
        bureau_id, company_id,
        action: AuditActions.FORTNOX_SYNC_COMPLETED,
        entity_type: 'company', entity_id: company_id,
        after_data: { imported: result.imported, errors: result.errors, triggered_by },
      })
    })

    logger.info(`Sync done: ${result.imported} imported`)
    return { success: true, ...result }
  }
)

export async function triggerCompanySync(
  company_id: string, bureau_id: string, triggered_by: string
) {
  await inngest.send({
    name: 'company/sync.requested',
    data: { company_id, bureau_id, triggered_by },
  })
}
