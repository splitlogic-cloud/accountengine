import { createUserClient } from '@/lib/supabase/server'
import { redirect }         from 'next/navigation'

interface Props {
  params: Promise<{ companyId: string }>
}

export default async function ReskontraPage({ params }: Props) {
  const { companyId } = await params
  const supabase       = createUserClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const today = new Date().toISOString().split('T')[0]!

  // Open customer invoices
  const { data: customerInvoices } = await supabase
    .from('invoices')
    .select(`
      id, invoice_number, invoice_date, due_date, total, paid_amount,
      customers(customer_token, customer_data(name))
    `)
    .eq('company_id', companyId)
    .in('status', ['sent', 'partial', 'overdue'])
    .order('due_date', { ascending: true })

  // Open supplier invoices
  const { data: supplierInvoices } = await supabase
    .from('supplier_invoices')
    .select('id, invoice_number, due_date, total, paid_amount, suppliers(name)')
    .eq('company_id', companyId)
    .in('status', ['approved', 'scheduled'])
    .order('due_date', { ascending: true })

  const fmt = (n: number) => (n ?? 0).toLocaleString('sv-SE', { minimumFractionDigits: 2 })

  function daysOverdue(dueDate: string): number {
    const due  = new Date(dueDate).getTime()
    const now  = new Date(today).getTime()
    return Math.floor((now - due) / 86_400_000)
  }

  function agingBucket(days: number): string {
    if (days <= 0)  return 'Ej förfallet'
    if (days <= 30) return '1–30 dagar'
    if (days <= 60) return '31–60 dagar'
    return '60+ dagar'
  }

  function agingColor(days: number): string {
    if (days <= 0)  return 'text-[#15803d]'
    if (days <= 30) return 'text-[#d97706]'
    if (days <= 60) return 'text-[#dc2626]'
    return 'text-[#7c3aed] font-bold'
  }

  const totalCustomer  = (customerInvoices ?? []).reduce((s, i) => s + ((i.total ?? 0) - (i.paid_amount ?? 0)), 0)
  const totalSupplier  = (supplierInvoices ?? []).reduce((s, i) => s + ((i.total ?? 0) - (i.paid_amount ?? 0)), 0)

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-[17px] font-bold tracking-tight">Reskontra</h1>
        <p className="text-[12.5px] text-[#64748b] mt-0.5">Öppen post-hantering</p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-white border border-[#e2e8f0] rounded-[10px] p-4 shadow-sm">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1">Kundfordringar</div>
          <div className={`text-[24px] font-bold ${totalCustomer > 0 ? 'text-[#dc2626]' : 'text-[#0f172a]'}`}>{fmt(totalCustomer)} kr</div>
          <div className="text-[12px] text-[#64748b]">{customerInvoices?.length ?? 0} öppna fakturor</div>
        </div>
        <div className="bg-white border border-[#e2e8f0] rounded-[10px] p-4 shadow-sm">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1">Leverantörsskulder</div>
          <div className={`text-[24px] font-bold ${totalSupplier > 0 ? 'text-[#d97706]' : 'text-[#0f172a]'}`}>{fmt(totalSupplier)} kr</div>
          <div className="text-[12px] text-[#64748b]">{supplierInvoices?.length ?? 0} obetalda fakturor</div>
        </div>
      </div>

      {/* Customer open items */}
      <div className="mb-6">
        <h2 className="text-[14px] font-bold mb-3">Kundreskontra — öppna poster</h2>
        <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden">
          {(customerInvoices ?? []).length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px] text-[#64748b]">Inga öppna kundfordringar.</div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
                  <th className="text-left px-5 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Kund</th>
                  <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Fakturanr</th>
                  <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Förfaller</th>
                  <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Ålder</th>
                  <th className="text-right px-5 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Kvarstående</th>
                </tr>
              </thead>
              <tbody>
                {(customerInvoices ?? []).map((inv: any) => {
                  const days = daysOverdue(inv.due_date)
                  const outstanding = (inv.total ?? 0) - (inv.paid_amount ?? 0)
                  const customerName = inv.customers?.customer_data?.name ?? 'Okänd kund'
                  return (
                    <tr key={inv.id} className={`border-b border-[#e2e8f0] last:border-b-0 ${days > 0 ? 'bg-[#fef9f9]' : ''}`}>
                      <td className="px-5 py-3 text-[13px] font-semibold text-[#0f172a]">{customerName}</td>
                      <td className="px-4 py-3 font-mono text-[11.5px] text-[#64748b]">{inv.invoice_number}</td>
                      <td className="px-4 py-3 font-mono text-[11.5px] text-[#64748b]">{inv.due_date}</td>
                      <td className={`px-4 py-3 text-[12px] font-semibold ${agingColor(days)}`}>{agingBucket(days)}</td>
                      <td className="px-5 py-3 text-right font-mono text-[13px] font-semibold text-[#dc2626]">{fmt(outstanding)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#e2e8f0] bg-[#f8fafc]">
                  <td className="px-5 py-2.5 text-[12.5px] font-bold" colSpan={4}>Totalt</td>
                  <td className="px-5 py-2.5 text-right font-mono text-[13px] font-bold text-[#dc2626]">{fmt(totalCustomer)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>

      {/* Supplier open items */}
      <div>
        <h2 className="text-[14px] font-bold mb-3">Leverantörsreskontra — att betala</h2>
        <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden">
          {(supplierInvoices ?? []).length === 0 ? (
            <div className="px-5 py-8 text-center text-[13px] text-[#64748b]">Inga obetalda leverantörsfakturor.</div>
          ) : (
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
                  <th className="text-left px-5 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Leverantör</th>
                  <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Fakturanr</th>
                  <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Förfaller</th>
                  <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Ålder</th>
                  <th className="text-right px-5 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Att betala</th>
                </tr>
              </thead>
              <tbody>
                {(supplierInvoices ?? []).map((inv: any) => {
                  const days = daysOverdue(inv.due_date ?? today)
                  const outstanding = (inv.total ?? 0) - (inv.paid_amount ?? 0)
                  return (
                    <tr key={inv.id} className={`border-b border-[#e2e8f0] last:border-b-0 ${days > 0 ? 'bg-[#fffdf5]' : ''}`}>
                      <td className="px-5 py-3 text-[13px] font-semibold text-[#0f172a]">{inv.suppliers?.name ?? 'Okänd'}</td>
                      <td className="px-4 py-3 font-mono text-[11.5px] text-[#64748b]">{inv.invoice_number ?? '—'}</td>
                      <td className="px-4 py-3 font-mono text-[11.5px] text-[#64748b]">{inv.due_date ?? '—'}</td>
                      <td className={`px-4 py-3 text-[12px] font-semibold ${agingColor(days)}`}>{agingBucket(days)}</td>
                      <td className="px-5 py-3 text-right font-mono text-[13px] font-semibold text-[#d97706]">{fmt(outstanding)}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[#e2e8f0] bg-[#f8fafc]">
                  <td className="px-5 py-2.5 text-[12.5px] font-bold" colSpan={4}>Totalt</td>
                  <td className="px-5 py-2.5 text-right font-mono text-[13px] font-bold text-[#d97706]">{fmt(totalSupplier)}</td>
                </tr>
              </tfoot>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
