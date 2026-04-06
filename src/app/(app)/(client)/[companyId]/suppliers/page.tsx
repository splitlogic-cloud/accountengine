import { createUserClient } from '@/lib/supabase/server'
import { redirect }         from 'next/navigation'

interface Props {
  params: Promise<{ companyId: string }>
}

export default async function SuppliersPage({ params }: Props) {
  const { companyId } = await params
  const supabase       = createUserClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = new Date().toISOString().split('T')[0]!

  const { data: invoices } = await supabase
    .from('supplier_invoices')
    .select(`
      id, invoice_number, status, invoice_date, due_date,
      total, paid_amount, currency, vat_amount,
      suppliers ( id, name )
    `)
    .eq('company_id', companyId)
    .order('due_date', { ascending: true, nullsFirst: false })
    .limit(100)

  const fmt = (n: number | null) =>
    (n ?? 0).toLocaleString('sv-SE', { minimumFractionDigits: 2 })

  const statusLabel: Record<string, string> = {
    pending_ocr:      'Tolkning',
    pending_approval: 'Godkänn',
    approved:         'Godkänd',
    scheduled:        'Schemalagd',
    paid:             'Betald',
    overdue:          'Försenad',
    disputed:         'Bestriden',
    cancelled:        'Avbruten',
  }
  const statusColor: Record<string, string> = {
    pending_ocr:      'bg-[#eff6ff] text-[#2563eb]',
    pending_approval: 'bg-[#fef9c3] text-[#854d0e]',
    approved:         'bg-[#e8f5ee] text-[#1a7a3c]',
    scheduled:        'bg-[#ede9fe] text-[#6d28d9]',
    paid:             'bg-[#dcfce7] text-[#15803d]',
    overdue:          'bg-[#fee2e2] text-[#b91c1c]',
    disputed:         'bg-[#fef9c3] text-[#854d0e]',
    cancelled:        'bg-[#f1f5f9] text-[#475569]',
  }

  const unpaidTotal = (invoices ?? [])
    .filter(i => !['paid','cancelled'].includes(i.status))
    .reduce((s, i) => s + ((i.total ?? 0) - (i.paid_amount ?? 0)), 0)

  const overdueCount = (invoices ?? [])
    .filter(i => !['paid','cancelled'].includes(i.status) && i.due_date && i.due_date < today).length

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[17px] font-bold tracking-tight">Leverantörsfakturor</h1>
          <p className="text-[12.5px] text-[#64748b] mt-0.5">{(invoices ?? []).length} fakturor</p>
        </div>
        <button className="h-8 px-3.5 bg-[#1a7a3c] text-white text-[12.5px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors">
          + Ladda upp faktura
        </button>
      </div>

      {unpaidTotal > 0 && (
        <div className="flex gap-3 mb-4">
          <div className="bg-white border border-[#e2e8f0] rounded-[8px] px-4 py-2.5 flex items-center gap-3">
            <div>
              <div className="text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Att betala</div>
              <div className="text-[16px] font-bold text-[#d97706]">{fmt(unpaidTotal)} kr</div>
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
          {['Alla', 'Att hantera', 'Obetalda', 'Förfallna', 'Betalda'].map(f => (
            <span key={f} className={`px-3 py-1 rounded-[20px] text-[12px] font-medium cursor-pointer transition-colors ${
              f === 'Alla' ? 'bg-white border border-[#1a7a3c] text-[#1a7a3c] font-semibold' : 'text-[#64748b] hover:text-[#0f172a]'
            }`}>{f}</span>
          ))}
        </div>

        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
              <th className="text-left px-5 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider w-12">Löpnr</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Leverantör</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Fakturanr</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Faktdatum</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Förfaller</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Status</th>
              <th className="text-right px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Moms</th>
              <th className="text-right px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Valuta</th>
              <th className="text-right px-5 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Totalt</th>
            </tr>
          </thead>
          <tbody>
            {(invoices ?? []).length === 0 ? (
              <tr>
                <td colSpan={9} className="px-5 py-12 text-center">
                  <div className="text-2xl mb-2">📄</div>
                  <div className="text-[14px] font-semibold mb-1">Inga leverantörsfakturor</div>
                  <p className="text-[12.5px] text-[#64748b]">Ladda upp en faktura eller skicka in via e-post.</p>
                </td>
              </tr>
            ) : (
              (invoices ?? []).map((inv: any, i: number) => {
                const isOverdue = !['paid','cancelled'].includes(inv.status) && inv.due_date && inv.due_date < today
                const rowBg = isOverdue
                  ? 'bg-[#fffdf5] hover:bg-[#fffbeb]'
                  : inv.status === 'paid'
                  ? 'bg-[#f9fefb] hover:bg-[#f0fdf4]'
                  : 'hover:bg-[#f8fafc]'
                return (
                  <tr key={inv.id} className={`border-b border-[#e2e8f0] last:border-b-0 cursor-pointer transition-colors ${rowBg}`}>
                    <td className="px-5 py-3 font-mono text-[12px] text-[#64748b]">{i + 1}</td>
                    <td className="px-4 py-3 text-[13px] font-semibold text-[#0f172a]">{inv.suppliers?.name ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[#64748b]">{inv.invoice_number ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-[#64748b]">{inv.invoice_date ?? '—'}</td>
                    <td className={`px-4 py-3 font-mono text-[12px] font-semibold ${isOverdue ? 'text-[#dc2626]' : 'text-[#64748b]'}`}>
                      {inv.due_date ?? '—'}{isOverdue && ' ⚠'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-[4px] ${statusColor[inv.status] ?? 'bg-[#f1f5f9] text-[#475569]'}`}>
                        {statusLabel[inv.status] ?? inv.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[12px] text-[#64748b]">{fmt(inv.vat_amount ?? 0)}</td>
                    <td className="px-4 py-3 text-right font-mono text-[12px] text-[#64748b]">{inv.currency}</td>
                    <td className="px-5 py-3 text-right font-mono text-[12.5px] font-bold text-[#0f172a]">{fmt(inv.total ?? 0)}</td>
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
