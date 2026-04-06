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

  const { data: invoices } = await supabase
    .from('invoices')
    .select(`
      id, invoice_number, status, invoice_date, due_date, total, paid_amount,
      customers(customer_token, customer_data(name))
    `)
    .eq('company_id', companyId)
    .order('invoice_date', { ascending: false })
    .limit(100)

  const fmt = (n: number) => n.toLocaleString('sv-SE', { minimumFractionDigits: 2 })

  const statusLabel: Record<string, string> = {
    draft:         'Utkast',
    sent:          'Skickad',
    partial:       'Delbetald',
    paid:          'Betald',
    overdue:       'Försenad',
    credited:      'Krediterad',
    cancelled:     'Avbruten',
    uncollectable: 'Osäker',
  }

  const statusColor: Record<string, string> = {
    draft:     'bg-[#f1f5f9] text-[#475569]',
    sent:      'bg-[#eff6ff] text-[#2563eb]',
    partial:   'bg-[#fef9c3] text-[#854d0e]',
    paid:      'bg-[#dcfce7] text-[#15803d]',
    overdue:   'bg-[#fee2e2] text-[#b91c1c]',
    credited:  'bg-[#f1f5f9] text-[#475569]',
    cancelled: 'bg-[#f1f5f9] text-[#475569]',
  }

  const today = new Date().toISOString().split('T')[0]!

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[17px] font-bold tracking-tight">Kundfakturor</h1>
          <p className="text-[12.5px] text-[#64748b] mt-0.5">{invoices?.length ?? 0} fakturor</p>
        </div>
        <button className="h-8 px-3.5 bg-[#1a7a3c] text-white text-[12.5px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors">
          + Ny faktura
        </button>
      </div>

      <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
              <th className="text-left px-5 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Nr</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Kund</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Datum</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Förfaller</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Status</th>
              <th className="text-right px-5 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Belopp</th>
            </tr>
          </thead>
          <tbody>
            {(invoices ?? []).length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-[13px] text-[#64748b]">Inga fakturor ännu.</td></tr>
            ) : (
              (invoices ?? []).map((inv: any) => {
                const isOverdue = inv.status !== 'paid' && inv.due_date < today
                const customerName = inv.customers?.customer_data?.name ?? 'Okänd kund'
                return (
                  <tr key={inv.id} className={`border-b border-[#e2e8f0] last:border-b-0 hover:bg-[#f8fafc] transition-colors cursor-pointer ${isOverdue ? 'bg-[#fef9f9]' : ''}`}>
                    <td className="px-5 py-3 font-mono text-[12.5px] font-semibold text-[#0f172a]">{inv.invoice_number}</td>
                    <td className="px-4 py-3 text-[13px] font-medium text-[#0f172a]">{customerName}</td>
                    <td className="px-4 py-3 font-mono text-[11.5px] text-[#64748b]">{inv.invoice_date}</td>
                    <td className={`px-4 py-3 font-mono text-[11.5px] font-semibold ${isOverdue ? 'text-[#dc2626]' : 'text-[#64748b]'}`}>
                      {inv.due_date}{isOverdue ? ' ⚠' : ''}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-[4px] ${statusColor[inv.status] ?? 'bg-[#f1f5f9] text-[#475569]'}`}>
                        {statusLabel[inv.status] ?? inv.status}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-[13px] font-semibold">{fmt(inv.total)}</td>
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
