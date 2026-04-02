import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { addFingerprints } from '@/lib/ingestion/fingerprint'
import type { NormalizedTransaction, SyncResult } from './types'

export async function saveTransactions(
  transactions: NormalizedTransaction[],
  changeReason: 'initial_import' | 'source_update' = 'initial_import'
): Promise<SyncResult & { dlq_count: number }> {
  if (transactions.length === 0) return { imported: 0, skipped: 0, errors: [], dlq_count: 0 }

  const withFingerprints = addFingerprints(transactions)
  const supabase = createServiceClient()
  let imported = 0, skipped = 0, dlq_count = 0
  const errors: string[] = []

  const CHUNK = 20
  for (let i = 0; i < withFingerprints.length; i += CHUNK) {
    const chunk = withFingerprints.slice(i, i + CHUNK)
    const results = await Promise.allSettled(
      chunk.map(tx => supabase
        .from('transactions')
        .upsert(tx, { onConflict: 'company_id,fingerprint', ignoreDuplicates: true })
      )
    )
    for (let j = 0; j < results.length; j++) {
      const result = results[j]
      if (result.status === 'fulfilled') {
        if (result.value.error) { errors.push(result.value.error.message); dlq_count++ }
        else imported++
      } else {
        errors.push(result.reason?.message ?? String(result.reason))
        dlq_count++
      }
    }
  }

  return { imported, skipped, errors, dlq_count }
}
