import { createUserClient } from '@/lib/supabase/server'
import { redirect }         from 'next/navigation'

interface Props {
  params: Promise<{ companyId: string }>
}

export default async function InvoicesPage({ params }: Props) {
  const { companyId } = await params
  const supabase       = createUserClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch invoices — don't join customer_data (may not exist)
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select(`
      id, invoice_number, status, invoice_date, due_date,
      total, paid_amount, currency,
      customers ( id, customer_token )
    `)
    .eq('company_id', companyId)
    .order('invoice_date', { ascending: false })
    .limit(100)

  const fmt = (n: number | null) =>
    (n ?? 0).toLocaleString('sv-SE', { minimumFractionDigits: 2 })

  const today = new Date().toISOString().split('T')[0]!

  const statusLabel: Record<string, string> = {
    draft: 'Utkast', sent: 'Skickad', partial: 'Delbetald',
    paid: 'Betald', overdue: 'Försenad', credited: 'Krediterad',
    cancelled: 'Avbruten', uncollectable: 'Osäker',
  }
  const statusColor: Record<string, string> = {
    draft:         'bg-[#f1f5f9] text-[#475569]',
    sent:          'bg-[#eff6ff] text-[#2563eb]',
    partial:       'bg-[#fef9c3] text-[#854d0e]',
    paid:          'bg-[#dcfce7] text-[#15803d]',
    overdue:       'bg-[#fee2e2] text-[#b91c1c]',
    credited:      'bg-[#f1f5f9] text-[#475569]',
    cancelled:     'bg-[#f1f5f9] text-[#475569]',
    uncollectable: 'bg-[#fef2f2] text-[#b91c1c]',
  }

  // Summary counts
  const openCount    = (invoices ?? []).filter(i => ['sent','partial','overdue'].includes(i.status)).length
  const overdueCount = (invoices ?? []).filter(i => i.status !== 'paid' && i.due_date < today).length
  const openTotal    = (invoices ?? []).filter(i => ['sent','partial','overdue'].includes(i.status))
    .reduce((s, i) => s + ((i.total ?? 0) - (i.paid_amount ?? 0)), 0)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[17px] font-bold tracking-tight">Kundfakturor</h1>
          <p className="text-[12.5px] text-[#64748b] mt-0.5">{(invoices ?? []).length} fakturor</p>
        </div>
        <button className="h-8 px-3.5 bg-[#1a7a3c] text-white text-[12.5px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors">
          + Ny faktura
        </button>
      </div>

      {/* Summary pills */}
      {openCount > 0 && (
        <div className="flex gap-3 mb-4">
          <div className="bg-white border border-[#e2e8f0] rounded-[8px] px-4 py-2.5 flex items-center gap-3">
            <div>
              <div className="text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Öppna</div>
              <div className="text-[16px] font-bold text-[#0f172a]">{openCount} st</div>
            </div>
            <div className="w-px h-8 bg-[#e2e8f0]" />
            <div>
              <div className="text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Totalt</div>
              <div className="text-[16px] font-bold text-[#dc2626]">{fmt(openTotal)} kr</div>
            </div>
            {overdueCount > 0 && (
              <>
                <div className="w-px h-8 bg-[#e2e8f0]" />
                <div>
                  <div className="text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Förfallna</div>
                  <div className="text-[16px] font-bold text-[#dc2626]">{overdueCount} st ⚠</div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden">
        {/* Filter tabs */}
        <div className="flex gap-1 px-4 py-2.5 border-b border-[#e2e8f0] bg-[#f8fafc]">
          {['Alla', 'Öppna', 'Förfallna', 'Betalda'].map(f => (
            <span key={f} className={`px-3 py-1 rounded-[20px] text-[12px] font-medium cursor-pointer transition-colors ${
              f === 'Alla' ? 'bg-white border border-[#1a7a3c] text-[#1a7a3c] font-semibold' : 'text-[#64748b] hover:text-[#0f172a]'
            }`}>{f}</span>
          ))}
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
              <th className="text-left px-5 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Fakturanr</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Kund</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Faktdatum</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Förfaller</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Valuta</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Status</th>
              <th className="text-right px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Totalt</th>
              <th className="text-right px-5 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Saldo</th>
            </tr>
          </thead>
          <tbody>
            {(invoices ?? []).length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-12 text-center">
                  <div className="text-2xl mb-2">🧾</div>
                  <div className="text-[14px] font-semibold mb-1">Inga kundfakturor</div>
                  <p className="text-[12.5px] text-[#64748b]">Skapa din första faktura för att komma igång.</p>
                </td>
              </tr>
            ) : (
              (invoices ?? []).map((inv: any) => {
                const isOverdue = !['paid','cancelled','credited'].includes(inv.status) && inv.due_date < today
                const saldo     = (inv.total ?? 0) - (inv.paid_amount ?? 0)
                const rowBg     = isOverdue ? 'bg-[#fef9f9] hover:bg-[#fef2f2]' :
                                  inv.status === 'paid' ? 'bg-[#f9fefb] hover:bg-[#f0fdf4]' :
                                  'hover:bg-[#f8fafc]'
                return (
                  <tr key={inv.id} className={`border-b border-[#e2e8f0] last:border-b-0 cursor-pointer transition-colors ${rowBg}`}>
                    <td className="px-5 py-3 font-mono text-[12.5px] font-bold text-[#0f172a]">{inv.invoice_number}</td>
                    <td className="px-4 py-3 text-[13px] text-[#334155]">
                      {inv.customers?.customer_token ? (
                        <span className="font-mono text-[11px] text-[#94a3b8]">{inv.customers.customer_token.slice(0,8)}...</span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[#64748b]">{inv.invoice_date}</td>
                    <td className={`px-4 py-3 font-mono text-[12px] font-semibold ${isOverdue ? 'text-[#dc2626]' : 'text-[#64748b]'}`}>
                      {inv.due_date}{isOverdue && ' ⚠'}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[#64748b]">{inv.currency}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-[4px] ${statusColor[inv.status] ?? 'bg-[#f1f5f9] text-[#475569]'}`}>
                        {statusLabel[inv.status] ?? inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[12.5px] font-semibold">{fmt(inv.total)}</td>
                    <td className={`px-5 py-3 text-right font-mono text-[12.5px] font-bold ${saldo > 0 ? 'text-[#dc2626]' : 'text-[#15803d]'}`}>
                      {saldo > 0 ? fmt(saldo) : '—'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
