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

  // Customer open items — invoices not fully paid
  const { data: custInv } = await supabase
    .from('invoices')
    .select('id, invoice_number, invoice_date, due_date, total, paid_amount, currency, customers(customer_token)')
    .eq('company_id', companyId)
    .in('status', ['sent', 'partial', 'overdue'])
    .order('due_date', { ascending: true })

  // Supplier open items — approved/scheduled not paid
  const { data: suppInv } = await supabase
    .from('supplier_invoices')
    .select('id, invoice_number, invoice_date, due_date, total, paid_amount, currency, suppliers(name)')
    .eq('company_id', companyId)
    .in('status', ['approved', 'scheduled', 'pending_approval'])
    .order('due_date', { ascending: true, nullsFirst: false })

  const fmt = (n: number | null) =>
    (n ?? 0).toLocaleString('sv-SE', { minimumFractionDigits: 2 })

  function daysOverdue(dueDate: string | null): number {
    if (!dueDate) return 0
    return Math.floor((new Date(today).getTime() - new Date(dueDate).getTime()) / 86_400_000)
  }

  function agingLabel(days: number) {
    if (days <= 0)  return { label: 'Ej förfallet',  color: 'text-[#15803d]',  bg: 'bg-[#dcfce7]' }
    if (days <= 30) return { label: '1–30 dagar',    color: 'text-[#d97706]',  bg: 'bg-[#fef9c3]' }
    if (days <= 60) return { label: '31–60 dagar',   color: 'text-[#dc2626]',  bg: 'bg-[#fee2e2]' }
    return              { label: '60+ dagar',        color: 'text-[#7c3aed]',  bg: 'bg-[#ede9fe]' }
  }

  const custTotal = (custInv ?? []).reduce((s, i) => s + ((i.total ?? 0) - (i.paid_amount ?? 0)), 0)
  const suppTotal = (suppInv ?? []).reduce((s, i) => s + ((i.total ?? 0) - (i.paid_amount ?? 0)), 0)

  // Aging buckets for customer
  const custAging = {
    current: (custInv ?? []).filter(i => daysOverdue(i.due_date) <= 0),
    d30:     (custInv ?? []).filter(i => { const d = daysOverdue(i.due_date); return d > 0 && d <= 30 }),
    d60:     (custInv ?? []).filter(i => { const d = daysOverdue(i.due_date); return d > 30 && d <= 60 }),
    d60p:    (custInv ?? []).filter(i => daysOverdue(i.due_date) > 60),
  }

  const RowHeader = ({ children }: { children: React.ReactNode }) => (
    <div className="grid gap-3 px-5 py-2 bg-[#f8fafc] border-b border-[#e2e8f0] text-[10px] font-bold text-[#64748b] uppercase tracking-wider"
      style={{ gridTemplateColumns: '1fr 120px 100px 100px 100px' }}>
      {children}
    </div>
  )

  const CustomerRow = ({ inv }: { inv: any }) => {
    const days      = daysOverdue(inv.due_date)
    const aging     = agingLabel(days)
    const saldo     = (inv.total ?? 0) - (inv.paid_amount ?? 0)
    const token     = inv.customers?.customer_token ?? null
    return (
      <div className="grid gap-3 px-5 py-2.5 border-b border-[#e2e8f0] last:border-b-0 hover:bg-[#f8fafc] items-center transition-colors cursor-pointer"
        style={{ gridTemplateColumns: '1fr 120px 100px 100px 100px' }}>
        <div>
          <div className="text-[13px] font-semibold text-[#0f172a]">
            {token ? <span className="font-mono text-[11px] text-[#94a3b8]">{token.slice(0,12)}...</span> : '—'}
          </div>
          <div className="text-[11.5px] text-[#64748b]">{inv.invoice_number} · {inv.currency}</div>
        </div>
        <div className="font-mono text-[12px] text-[#64748b]">{inv.due_date ?? '—'}</div>
        <div>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-[4px] ${aging.bg} ${aging.color}`}>
            {aging.label}
          </span>
        </div>
        <div className="font-mono text-[12.5px] font-semibold text-[#0f172a] text-right">{fmt(inv.total ?? 0)}</div>
        <div className={`font-mono text-[12.5px] font-bold text-right ${saldo > 0 ? 'text-[#dc2626]' : 'text-[#15803d]'}`}>
          {fmt(saldo)}
        </div>
      </div>
    )
  }

  const SupplierRow = ({ inv }: { inv: any }) => {
    const days  = daysOverdue(inv.due_date)
    const aging = agingLabel(days)
    const saldo = (inv.total ?? 0) - (inv.paid_amount ?? 0)
    return (
      <div className="grid gap-3 px-5 py-2.5 border-b border-[#e2e8f0] last:border-b-0 hover:bg-[#f8fafc] items-center transition-colors cursor-pointer"
        style={{ gridTemplateColumns: '1fr 120px 100px 100px 100px' }}>
        <div>
          <div className="text-[13px] font-semibold text-[#0f172a]">{inv.suppliers?.name ?? '—'}</div>
          <div className="text-[11.5px] text-[#64748b]">{inv.invoice_number ?? '—'} · {inv.currency}</div>
        </div>
        <div className="font-mono text-[12px] text-[#64748b]">{inv.due_date ?? '—'}</div>
        <div>
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-[4px] ${aging.bg} ${aging.color}`}>
            {aging.label}
          </span>
        </div>
        <div className="font-mono text-[12.5px] font-semibold text-[#0f172a] text-right">{fmt(inv.total ?? 0)}</div>
        <div className={`font-mono text-[12.5px] font-bold text-right ${saldo > 0 ? 'text-[#d97706]' : 'text-[#15803d]'}`}>
          {fmt(saldo)}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-[17px] font-bold tracking-tight">Reskontra</h1>
        <p className="text-[12.5px] text-[#64748b] mt-0.5">Öppna poster · kundfordringar och leverantörsskulder</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className={`border rounded-[10px] p-4 ${custTotal > 0 ? 'bg-[#fef2f2] border-[#fecaca]' : 'bg-white border-[#e2e8f0]'}`}>
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1">Kundfordringar</div>
          <div className={`text-[26px] font-bold tracking-tight ${custTotal > 0 ? 'text-[#dc2626]' : 'text-[#0f172a]'}`}>
            {fmt(custTotal)} kr
          </div>
          <div className="text-[12px] text-[#64748b] mt-0.5">{(custInv ?? []).length} öppna fakturor</div>
          {Object.values(custAging).some(a => a.length > 0) && (
            <div className="flex gap-2 mt-2 flex-wrap">
              {custAging.d60p.length > 0 && <span className="text-[11px] bg-[#ede9fe] text-[#6d28d9] font-semibold px-2 py-0.5 rounded-[4px]">60+ dagar: {custAging.d60p.length}</span>}
              {custAging.d60.length  > 0 && <span className="text-[11px] bg-[#fee2e2] text-[#b91c1c] font-semibold px-2 py-0.5 rounded-[4px]">31–60 d: {custAging.d60.length}</span>}
              {custAging.d30.length  > 0 && <span className="text-[11px] bg-[#fef9c3] text-[#854d0e] font-semibold px-2 py-0.5 rounded-[4px]">1–30 d: {custAging.d30.length}</span>}
            </div>
          )}
        </div>
        <div className={`border rounded-[10px] p-4 ${suppTotal > 0 ? 'bg-[#fffbeb] border-[#fde68a]' : 'bg-white border-[#e2e8f0]'}`}>
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#94a3b8] mb-1">Leverantörsskulder</div>
          <div className={`text-[26px] font-bold tracking-tight ${suppTotal > 0 ? 'text-[#d97706]' : 'text-[#0f172a]'}`}>
            {fmt(suppTotal)} kr
          </div>
          <div className="text-[12px] text-[#64748b] mt-0.5">{(suppInv ?? []).length} obetalda fakturor</div>
        </div>
      </div>

      {/* Customer open items */}
      <div className="mb-6">
        <h2 className="text-[14px] font-bold mb-3">Kundreskontra — öppna poster</h2>
        <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden">
          {(custInv ?? []).length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-[#64748b]">Inga öppna kundfordringar. ✓</div>
          ) : (
            <>
              <RowHeader>
                <div>Kund / Faktura</div><div>Förfaller</div><div>Ålder</div>
                <div className="text-right">Fakturerat</div><div className="text-right">Saldo</div>
              </RowHeader>
              {(custInv ?? []).map(inv => <CustomerRow key={inv.id} inv={inv} />)}
              <div className="grid gap-3 px-5 py-3 bg-[#f8fafc] border-t border-[#e2e8f0] font-bold"
                style={{ gridTemplateColumns: '1fr 120px 100px 100px 100px' }}>
                <div className="text-[12.5px]">Totalt</div>
                <div /><div />
                <div className="text-right font-mono text-[12.5px]">
                  {fmt((custInv ?? []).reduce((s,i) => s + (i.total ?? 0), 0))}
                </div>
                <div className="text-right font-mono text-[12.5px] text-[#dc2626]">{fmt(custTotal)}</div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Supplier open items */}
      <div>
        <h2 className="text-[14px] font-bold mb-3">Leverantörsreskontra — att betala</h2>
        <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden">
          {(suppInv ?? []).length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-[#64748b]">Inga obetalda leverantörsfakturor. ✓</div>
          ) : (
            <>
              <RowHeader>
                <div>Leverantör / Faktura</div><div>Förfaller</div><div>Ålder</div>
                <div className="text-right">Fakturerat</div><div className="text-right">Saldo</div>
              </RowHeader>
              {(suppInv ?? []).map(inv => <SupplierRow key={inv.id} inv={inv} />)}
              <div className="grid gap-3 px-5 py-3 bg-[#f8fafc] border-t border-[#e2e8f0] font-bold"
                style={{ gridTemplateColumns: '1fr 120px 100px 100px 100px' }}>
                <div className="text-[12.5px]">Totalt</div>
                <div /><div />
                <div className="text-right font-mono text-[12.5px]">
                  {fmt((suppInv ?? []).reduce((s,i) => s + (i.total ?? 0), 0))}
                </div>
                <div className="text-right font-mono text-[12.5px] text-[#d97706]">{fmt(suppTotal)}</div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
