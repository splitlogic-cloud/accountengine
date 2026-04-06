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
    .select('id, invoice_number, status, invoice_date, due_date, total, paid_amount, suppliers(name)')
    .eq('company_id', companyId)
    .order('due_date', { ascending: true })
    .limit(100)

  const fmt = (n: number) => (n ?? 0).toLocaleString('sv-SE', { minimumFractionDigits: 2 })

  const statusLabel: Record<string, string> = {
    pending_ocr:      'OCR-granskning',
    pending_approval: 'Väntar godkännande',
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

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[17px] font-bold tracking-tight">Leverantörsfakturor</h1>
          <p className="text-[12.5px] text-[#64748b] mt-0.5">{invoices?.length ?? 0} fakturor</p>
        </div>
        <button className="h-8 px-3.5 bg-[#1a7a3c] text-white text-[12.5px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors">
          + Ladda upp faktura
        </button>
      </div>

      <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
              <th className="text-left px-5 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Leverantör</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Fakturanr</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Förfaller</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Status</th>
              <th className="text-right px-5 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Belopp</th>
            </tr>
          </thead>
          <tbody>
            {(invoices ?? []).length === 0 ? (
              <tr><td colSpan={5} className="px-5 py-10 text-center text-[13px] text-[#64748b]">Inga leverantörsfakturor ännu.</td></tr>
            ) : (
              (invoices ?? []).map((inv: any) => {
                const isOverdue = !['paid', 'cancelled'].includes(inv.status) && inv.due_date < today
                const supplierName = inv.suppliers?.name ?? 'Okänd leverantör'
                return (
                  <tr key={inv.id} className={`border-b border-[#e2e8f0] last:border-b-0 hover:bg-[#f8fafc] transition-colors cursor-pointer ${isOverdue ? 'bg-[#fef9f9]' : ''}`}>
                    <td className="px-5 py-3 text-[13px] font-semibold text-[#0f172a]">{supplierName}</td>
                    <td className="px-4 py-3 font-mono text-[11.5px] text-[#64748b]">{inv.invoice_number ?? '—'}</td>
                    <td className={`px-4 py-3 font-mono text-[11.5px] font-semibold ${isOverdue ? 'text-[#dc2626]' : 'text-[#64748b]'}`}>
                      {inv.due_date ?? '—'}{isOverdue ? ' ⚠' : ''}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-[4px] ${statusColor[inv.status] ?? 'bg-[#f1f5f9] text-[#475569]'}`}>
                        {statusLabel[inv.status] ?? inv.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-[13px] font-semibold">{fmt(inv.total ?? 0)}</td>
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
