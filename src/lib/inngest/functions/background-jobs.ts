import { inngest }              from '../client'
import { createServiceClient }  from '@/lib/supabase/server'
import { fetchAndStoreECBRates } from '@/lib/currency/rates'
import { previewBatch, postBatch, approveBatch } from '@/lib/batch/posting-service'
import { writeAudit, AuditAction } from '@/lib/accounting/audit'

// ---------------------------------------------------------------------------
// Cron: fetch ECB exchange rates daily at 18:00 CET
// ECB publishes rates at ~16:00 CET on banking days.
// ---------------------------------------------------------------------------
export const fetchECBRatesFn = inngest.createFunction(
  { id: 'fetch-ecb-rates', name: 'Hämta ECB valutakurser' },
  { cron: 'TZ=Europe/Stockholm 0 18 * * 1-5' },  // Mon–Fri 18:00 Stockholm time
  async ({ logger }) => {
    const result = await fetchAndStoreECBRates()

    if (!result.ok) {
      logger.error('ECB rate fetch failed', { error: result.error.message })
      throw result.error  // Inngest will retry
    }

    logger.info('ECB rates stored', { count: result.value })
    return { rates_stored: result.value }
  }
)

// ---------------------------------------------------------------------------
// Cron: bureau mass sync — runs nightly at 02:00
// Triggers sync for all active companies in all bureaus.
// ---------------------------------------------------------------------------
export const bureauNightlySyncFn = inngest.createFunction(
  {
    id:      'bureau-nightly-sync',
    name:    'Nattkörning — synka alla bolag',
    retries: 1,
  },
  { cron: 'TZ=Europe/Stockholm 0 2 * * *' },
  async ({ step, logger }) => {
    const supabase = createServiceClient()

    // Fetch all active companies with integrations
    const { data: companies } = await supabase
      .from('companies')
      .select('id, bureau_id, name')
      .eq('status', 'active')
      .order('bureau_id')

    if (!companies?.length) {
      logger.info('No active companies to sync.')
      return { synced: 0 }
    }

    const today     = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    const fromDate = yesterday.toISOString().split('T')[0]!
    const toDate   = today.toISOString().split('T')[0]!

    // Fan out: send sync event for each company
    // Inngest will handle concurrency via the sync-company function's concurrency config
    await step.sendEvent(
      'trigger-company-syncs',
      companies.map(co => ({
        name: 'company/sync.requested',
        data: {
          company_id:   co.id,
          bureau_id:    co.bureau_id,
          from_date:    fromDate,
          to_date:      toDate,
          triggered_by: 'system:nightly-sync',
        },
      }))
    )

    logger.info('Nightly sync triggered', { company_count: companies.length })
    return { triggered: companies.length }
  }
)

// ---------------------------------------------------------------------------
// Bureau batch job: sync all companies in a bureau
// ---------------------------------------------------------------------------
export const bureauSyncAllFn = inngest.createFunction(
  {
    id:      'bureau-sync-all',
    name:    'Byråjobb — Synka alla klienter',
    retries: 1,
  },
  { event: 'bureau/job.sync_all' as const },
  async ({ event, step, logger }) => {
    const { bureau_id, job_id, from_date, to_date, triggered_by } = event.data as {
      bureau_id:    string
      job_id:       string
      from_date:    string
      to_date:      string
      triggered_by: string
    }

    const supabase = createServiceClient()

    // Update job to running
    await step.run('mark-running', async () => {
      await supabase
        .from('bureau_jobs')
        .update({ status: 'running', started_at: new Date().toISOString() })
        .eq('id', job_id)
    })

    // Fetch all client company IDs for this bureau
    const companyIds = await step.run('fetch-clients', async () => {
      const { data } = await supabase
        .from('bureau_clients')
        .select('company_id')
        .eq('bureau_id', bureau_id)
      return (data ?? []).map((bc: { company_id: string }) => bc.company_id)
    })

    logger.info('Bureau sync starting', { bureau_id, company_count: companyIds.length })

    // Update job with total
    await supabase
      .from('bureau_jobs')
      .update({ total_companies: companyIds.length })
      .eq('id', job_id)

    // Process in parallel batches of 5 (respect API rate limits)
    const PARALLEL = 5
    const results: Array<{ company_id: string; ok: boolean; error?: string }> = []

    for (let i = 0; i < companyIds.length; i += PARALLEL) {
      const chunk = companyIds.slice(i, i + PARALLEL) as string[]

      const chunkResults = await step.run(`sync-chunk-${i}`, async () => {
        return Promise.allSettled(
          chunk.map(async (companyId: string) => {
            try {
              await inngest.send({
                name: 'company/sync.requested',
                data: {
                  company_id:   companyId,
                  bureau_id,
                  from_date,
                  to_date,
                  triggered_by,
                },
              })
              return { company_id: companyId, ok: true }
            } catch (e) {
              return {
                company_id: companyId,
                ok:         false,
                error:      e instanceof Error ? e.message : String(e),
              }
            }
          })
        )
      })

      for (const result of chunkResults) {
        const value = result.status === 'fulfilled'
          ? result.value
          : { company_id: chunk[chunkResults.indexOf(result)]!, ok: false, error: String(result.reason) }
        results.push(value as typeof results[number])
      }

      const done   = Math.min(i + PARALLEL, companyIds.length)
      const failed = results.filter(r => !r.ok).length

      // Update progress
      await supabase
        .from('bureau_jobs')
        .update({ done_companies: done, failed_companies: failed })
        .eq('id', job_id)
    }

    const finalFailed = results.filter(r => !r.ok).length

    await step.run('complete-job', async () => {
      await supabase
        .from('bureau_jobs')
        .update({
          status:          finalFailed === companyIds.length ? 'failed' : 'completed',
          done_companies:  companyIds.length,
          failed_companies: finalFailed,
          results,
          completed_at:   new Date().toISOString(),
        })
        .eq('id', job_id)
    })

    return {
      total:   companyIds.length,
      ok:      results.filter(r => r.ok).length,
      failed:  finalFailed,
    }
  }
)

// ---------------------------------------------------------------------------
// Reminder scheduler: runs daily, creates reminders for overdue invoices
// ---------------------------------------------------------------------------
export const reminderSchedulerFn = inngest.createFunction(
  {
    id:      'reminder-scheduler',
    name:    'Påminnelseschemaläggare',
    retries: 2,
  },
  { cron: 'TZ=Europe/Stockholm 0 9 * * 1-5' },  // Mon–Fri 09:00
  async ({ step, logger }) => {
    const supabase = createServiceClient()
    const today    = new Date().toISOString().split('T')[0]!

    // Find overdue invoices that need reminders
    const { data: overdueInvoices } = await supabase
      .from('invoices')
      .select(`
        id, company_id, customer_id, due_date, total, paid_amount,
        reminders(id, reminder_number, status)
      `)
      .in('status', ['sent', 'partial', 'overdue'])
      .lt('due_date', today)
      .limit(500)

    let created = 0

    for (const invoice of overdueInvoices ?? []) {
      const existingNums = (invoice.reminders ?? [])
        .filter((r: any) => r.status !== 'cancelled')
        .map((r: any) => r.reminder_number as number)

      const maxExisting = Math.max(0, ...existingNums)
      if (maxExisting >= 3) continue  // Max 3 reminders

      const nextNum = maxExisting + 1
      const daysOverdue = Math.floor(
        (new Date(today).getTime() - new Date(invoice.due_date).getTime()) / 86_400_000
      )

      // Reminder 1: 7 days overdue
      // Reminder 2: 21 days overdue
      // Reminder 3: 35 days overdue
      const thresholds: Record<number, number> = { 1: 7, 2: 21, 3: 35 }
      if (daysOverdue < (thresholds[nextNum] ?? 999)) continue

      const feeAmount = nextNum >= 2 ? 60 : 0  // 60 SEK fee from reminder 2
      const amountDue = invoice.total - invoice.paid_amount

      await supabase.from('reminders').insert({
        company_id:      invoice.company_id,
        invoice_id:      invoice.id,
        customer_id:     invoice.customer_id,
        reminder_number: nextNum,
        reminder_date:   today,
        due_date:        new Date(Date.now() + 14 * 86_400_000).toISOString().split('T')[0],
        amount_due:      amountDue,
        fee_amount:      feeAmount,
        status:          'draft',
      })

      // Update invoice status
      await supabase
        .from('invoices')
        .update({ status: 'overdue', overdue_since: invoice.due_date })
        .eq('id', invoice.id)

      created++
    }

    logger.info('Reminder scheduler complete', { created })
    return { reminders_created: created }
  }
)

// ---------------------------------------------------------------------------
// VAT due date notifier: alerts 14 days before filing deadline
// ---------------------------------------------------------------------------
export const vatDueNotifierFn = inngest.createFunction(
  {
    id:      'vat-due-notifier',
    name:    'Momspåminnelse',
    retries: 1,
  },
  { cron: 'TZ=Europe/Stockholm 0 8 * * *' },
  async ({ step, logger }) => {
    const supabase = createServiceClient()

    const targetDate = new Date()
    targetDate.setDate(targetDate.getDate() + 14)
    const target = targetDate.toISOString().split('T')[0]!

    const { data: dueFiling } = await supabase
      .from('filings')
      .select('id, company_id, filing_type, due_date, data')
      .eq('status', 'draft')
      .eq('due_date', target)
      .in('filing_type', ['vat_return', 'oss'])

    logger.info('VAT due notifier', { filings_due_in_14d: dueFiling?.length ?? 0 })

    // In a full implementation: send emails via Resend here
    return { notified: dueFiling?.length ?? 0 }
  }
)
