import { createUserClient } from '@/lib/supabase/server'
import { redirect }         from 'next/navigation'

interface Props {
  params:      Promise<{ companyId: string }>
  searchParams: Promise<{ status?: string }>
}

export default async function EventsPage({ params, searchParams }: Props) {
  const { companyId } = await params
  const { status }     = await searchParams
  const supabase        = createUserClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let query = supabase
    .from('financial_events')
    .select('id, event_type, occurred_at, source, source_id, amount, currency, amount_sek, processing_status, rule_version')
    .eq('company_id', companyId)
    .order('occurred_at', { ascending: false })
    .limit(100)

  if (status) query = query.eq('processing_status', status)

  const { data: events } = await query

  const fmt = (n: number | null) =>
    n == null ? '—' : Math.abs(n).toLocaleString('sv-SE', { minimumFractionDigits: 2 })

  const statusLabel: Record<string, string> = {
    pending:   'Väntande',
    validated: 'Validerad',
    posted:    'Postad',
    blocked:   'Pausad (auto)',
    skipped:   'Hoppas över',
    failed:    'Fel',
    reversed:  'Reverserad',
  }

  const statusColor: Record<string, string> = {
    pending:   'bg-[#eff6ff] text-[#2563eb]',
    validated: 'bg-[#e8f5ee] text-[#1a7a3c]',
    posted:    'bg-[#dcfce7] text-[#15803d]',
    blocked:   'bg-[#fef9c3] text-[#854d0e]',
    skipped:   'bg-[#f1f5f9] text-[#475569]',
    failed:    'bg-[#fee2e2] text-[#b91c1c]',
    reversed:  'bg-[#f1f5f9] text-[#475569]',
  }

  const typeIcon: Record<string, string> = {
    stripe_charge:    '↑',
    stripe_refund:    '↓',
    stripe_fee:       '−',
    stripe_payout:    '→',
    stripe_chargeback:'⚠',
    shopify_order:    '🛒',
    shopify_refund:   '↩',
    paypal_payment:   '💰',
    bank_credit:      '↑',
    bank_debit:       '↓',
    manual_entry:     '✍',
  }

  const counts = {
    total:    events?.length ?? 0,
    posted:   (events ?? []).filter(e => e.processing_status === 'posted').length,
    blocked:  (events ?? []).filter(e => e.processing_status === 'blocked').length,
    pending:  (events ?? []).filter(e => ['pending', 'validated'].includes(e.processing_status)).length,
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[17px] font-bold tracking-tight">Financial events</h1>
          <p className="text-[12.5px] text-[#64748b] mt-0.5">
            Automation · blockerade events pausar ej manuell bokföring
          </p>
        </div>
        {counts.pending > 0 && (
          <button className="h-8 px-3.5 bg-[#1a7a3c] text-white text-[12.5px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors">
            ⚡ Posta {counts.pending} validerade
          </button>
        )}
      </div>

      {counts.blocked > 0 && (
        <div className="bg-[#fffbeb] border border-[#fde68a] rounded-[8px] px-4 py-3 text-[12.5px] text-[#854d0e] mb-4 flex items-start gap-2">
          <span>ℹ</span>
          <span>
            {counts.blocked} event{counts.blocked > 1 ? 's' : ''} har pausad automation. 
            Du kan alltid bokföra manuellt i huvudboken — det är helt oberoende av events.
          </span>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-4">
        {[
          { label: `Alla (${counts.total})`,       val: undefined },
          { label: `Postade (${counts.posted})`,   val: 'posted'  },
          { label: `Väntande (${counts.pending})`, val: 'pending' },
          { label: `Pausade (${counts.blocked})`,  val: 'blocked' },
        ].map(f => (
          <a
            key={f.label}
            href={f.val ? `?status=${f.val}` : '?'}
            className={`px-3 py-1.5 rounded-[20px] text-[12px] font-medium border transition-all ${
              (!f.val && !status) || status === f.val
                ? 'bg-white border-[#1a7a3c] text-[#1a7a3c] font-semibold'
                : 'border-transparent text-[#64748b] hover:bg-white hover:border-[#e2e8f0] hover:text-[#0f172a]'
            }`}
          >
            {f.label}
          </a>
        ))}
      </div>

      <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden">
        {(events ?? []).length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="text-3xl mb-3">⚡</div>
            <div className="text-[14px] font-semibold mb-1">Inga events ännu</div>
            <p className="text-[13px] text-[#64748b]">
              Events skapas automatiskt när du kopplar Stripe, Shopify eller importerar bankfiler.
            </p>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
                <th className="text-left px-5 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Typ</th>
                <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Source-ID</th>
                <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Datum</th>
                <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Regelversion</th>
                <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Status</th>
                <th className="text-right px-5 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Belopp SEK</th>
              </tr>
            </thead>
            <tbody>
              {(events ?? []).map((evt: any) => (
                <tr
                  key={evt.id}
                  className={`border-b border-[#e2e8f0] last:border-b-0 hover:bg-[#f8fafc] transition-colors ${
                    evt.processing_status === 'blocked' ? 'bg-[#fffdf5]' : ''
                  }`}
                >
                  <td className="px-5 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{typeIcon[evt.event_type] ?? '•'}</span>
                      <span className="text-[12.5px] font-semibold text-[#0f172a]">{evt.event_type}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11.5px] text-[#64748b]">
                    {evt.source_id ? evt.source_id.slice(0, 20) + (evt.source_id.length > 20 ? '…' : '') : '—'}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11.5px] text-[#64748b]">
                    {evt.occurred_at?.split('T')[0]}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-[11px] text-[#94a3b8]">
                    {evt.rule_version ?? '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-[4px] ${statusColor[evt.processing_status] ?? 'bg-[#f1f5f9] text-[#475569]'}`}>
                      {statusLabel[evt.processing_status] ?? evt.processing_status}
                    </span>
                  </td>
                  <td className={`px-5 py-2.5 text-right font-mono text-[12.5px] font-semibold ${(evt.amount_sek ?? evt.amount) < 0 ? 'text-[#dc2626]' : 'text-[#0f172a]'}`}>
                    {(evt.amount_sek ?? evt.amount) < 0 ? '−' : ''}{fmt(evt.amount_sek ?? evt.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
