import { createUserClient } from '@/lib/supabase/server'
import { redirect }         from 'next/navigation'
import Link                 from 'next/link'

interface Props {
  params: Promise<{ companyId: string }>
}

export default async function CompanyOverviewPage({ params }: Props) {
  const { companyId } = await params
  const supabase       = createUserClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: company } = await supabase
    .from('companies')
    .select('id, name, org_number, currency, status')
    .eq('id', companyId)
    .single()

  if (!company) redirect('/dashboard')

  // Recent entries
  const { data: entries } = await supabase
    .from('journal_entries')
    .select('id, entry_number, entry_date, description, status, source')
    .eq('company_id', companyId)
    .order('entry_date', { ascending: false })
    .limit(5)

  // Open invoices count
  const { count: openInvoices } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .in('status', ['sent', 'partial', 'overdue'])

  // Overdue supplier invoices count
  const { count: overdueSupplier } = await supabase
    .from('supplier_invoices')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', companyId)
    .eq('status', 'approved')
    .lt('due_date', new Date().toISOString().split('T')[0])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[17px] font-bold tracking-tight">{company.name}</h1>
          <p className="text-[12.5px] text-[#64748b] mt-0.5">{company.org_number ?? 'Org.nr saknas'} · {company.currency}</p>
        </div>
        <Link
          href={`/${companyId}/voucher`}
          className="h-8 px-3.5 bg-[#1a7a3c] text-white text-[12.5px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors flex items-center gap-1.5"
        >
          + Nytt verifikat
        </Link>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="bg-white border border-[#e2e8f0] rounded-[10px] p-4 shadow-sm">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#94a3b8] mb-2">Öppna kundfakturor</div>
          <div className={`text-[24px] font-bold ${(openInvoices ?? 0) > 0 ? 'text-[#d97706]' : 'text-[#0f172a]'}`}>{openInvoices ?? 0}</div>
          <Link href={`/${companyId}/invoices`} className="text-[11.5px] text-[#1a7a3c] font-semibold hover:underline">Visa fakturor →</Link>
        </div>
        <div className="bg-white border border-[#e2e8f0] rounded-[10px] p-4 shadow-sm">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#94a3b8] mb-2">Förfallna lev.fakturor</div>
          <div className={`text-[24px] font-bold ${(overdueSupplier ?? 0) > 0 ? 'text-[#dc2626]' : 'text-[#0f172a]'}`}>{overdueSupplier ?? 0}</div>
          <Link href={`/${companyId}/suppliers`} className="text-[11.5px] text-[#1a7a3c] font-semibold hover:underline">Visa leverantörer →</Link>
        </div>
        <div className="bg-white border border-[#e2e8f0] rounded-[10px] p-4 shadow-sm">
          <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#94a3b8] mb-2">Senaste verifikat</div>
          <div className="text-[24px] font-bold">{entries?.length ?? 0}</div>
          <Link href={`/${companyId}/ledger`} className="text-[11.5px] text-[#1a7a3c] font-semibold hover:underline">Visa huvudbok →</Link>
        </div>
      </div>

      {/* Recent entries */}
      <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between">
          <span className="text-[12.5px] font-bold">Senaste verifikat</span>
          <Link href={`/${companyId}/ledger`} className="text-[12px] text-[#64748b] hover:text-[#0f172a]">Huvudboken →</Link>
        </div>
        {(entries ?? []).length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-[#64748b]">
            Inga verifikat ännu.{' '}
            <Link href={`/${companyId}/voucher`} className="text-[#1a7a3c] font-semibold hover:underline">Skapa det första →</Link>
          </div>
        ) : (
          (entries ?? []).map((entry: any) => (
            <Link
              key={entry.id}
              href={`/${companyId}/ledger/${entry.id}`}
              className="flex items-center gap-3 px-4 py-3 border-b border-[#e2e8f0] last:border-b-0 hover:bg-[#f8fafc] transition-colors"
            >
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                entry.source === 'manual' ? 'bg-[#7c3aed]' : 'bg-[#2563eb]'
              }`} />
              <span className="font-mono text-[12px] font-semibold text-[#0f172a] w-36 shrink-0">{entry.entry_number}</span>
              <span className="font-mono text-[11.5px] text-[#64748b] w-24 shrink-0">{entry.entry_date}</span>
              <span className="text-[13px] text-[#334155] flex-1 truncate">{entry.description}</span>
              <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-[4px] shrink-0 ${
                entry.status === 'posted' ? 'bg-[#dcfce7] text-[#15803d]' : 'bg-[#f1f5f9] text-[#475569]'
              }`}>
                {entry.status === 'posted' ? 'Postad' : 'Utkast'}
              </span>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
