import { serve }   from 'inngest/next'
import { inngest }  from '@/lib/inngest/client'

// Import all functions so they are registered
import { syncCompanyFn, createBatchesFn }           from '@/lib/inngest/functions/sync-company'
import {
  fetchECBRatesFn,
  bureauNightlySyncFn,
  bureauSyncAllFn,
  reminderSchedulerFn,
  vatDueNotifierFn,
}                                                    from '@/lib/inngest/functions/background-jobs'

export const { GET, POST, PUT } = serve({
  client:    inngest,
  functions: [
    // Import pipeline
    syncCompanyFn,
    createBatchesFn,
    // Background jobs
    fetchECBRatesFn,
    bureauNightlySyncFn,
    bureauSyncAllFn,
    reminderSchedulerFn,
    vatDueNotifierFn,
  ],
})
