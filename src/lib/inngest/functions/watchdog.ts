import { inngest } from '../client'
import { createServiceClient } from '@/lib/supabase/server'
import { writeAuditLog } from '@/lib/audit'

export const syncWatchdogFn = inngest.createFunction(
  { id: 'sync-watchdog', name: 'Sync timeout watchdog' },
  { cron: '*/15 * * * *' },
  async ({ step, logger }) => {
    const supabase = createServiceClient()

    const stuckCompanies = await step.run('find-stuck', async () => {
      const { data } = await supabase
        .from('companies')
        .select('id, name, bureau_id, updated_at')
        .eq('sync_status', 'syncing')
        .lt('updated_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
      return data ?? []
    })

    if (stuckCompanies.length === 0) {
      logger.info('Watchdog: no stuck syncs')
      return { recovered: 0 }
    }

    const recovered = await step.run('recover', async () => {
      let count = 0
      for (const company of stuckCompanies) {
        await supabase.from('companies').update({
          sync_status: 'error',
          sync_error: 'Sync timeout: job did not respond within 15 minutes',
          updated_at: new Date().toISOString(),
        }).eq('id', company.id)
        await writeAuditLog({
          bureau_id: company.bureau_id, company_id: company.id,
          action: 'sync_timeout_recovered', entity_type: 'company', entity_id: company.id,
          after_data: { reason: 'watchdog', stuck_since: company.updated_at },
        }).catch(console.error)
        count++
      }
      return count
    })

    logger.info(`Watchdog recovered ${recovered} companies`)
    return { recovered }
  }
)
