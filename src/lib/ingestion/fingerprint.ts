import { createHash } from 'crypto'
import type { NormalizedTransaction } from '@/lib/connectors/types'

export function computeFingerprint(
  tx: Pick<NormalizedTransaction,
    | 'company_id' | 'source' | 'transaction_date'
    | 'amount' | 'currency' | 'counterpart_name' | 'external_id'>
): string {
  const parts = [
    tx.company_id,
    tx.source,
    tx.transaction_date,
    Math.round(tx.amount * 100).toString(),
    tx.currency.toUpperCase(),
    (tx.counterpart_name ?? '').toLowerCase().trim(),
    tx.external_id ?? '',
  ]
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 40)
}

export function addFingerprints(
  transactions: NormalizedTransaction[]
): (NormalizedTransaction & { fingerprint: string })[] {
  return transactions.map(tx => ({ ...tx, fingerprint: computeFingerprint(tx) }))
}
