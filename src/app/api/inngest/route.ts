import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { syncCompanyFn } from '@/lib/inngest/functions/sync-company'
import { syncWatchdogFn } from '@/lib/inngest/functions/watchdog'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    syncCompanyFn,
    syncWatchdogFn,
  ],
})
