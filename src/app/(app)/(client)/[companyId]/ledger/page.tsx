import { createUserClient }  from '@/lib/supabase/server'
import { redirect }          from 'next/navigation'
import Link                  from 'next/link'
import { listEntries }       from '@/lib/accounting/journal-service'

interface Props {
  params:      Promise<{ companyId: string }>
  searchParams: Promise<{ page?: string; status?: string; source?: string }>
}

export default async function LedgerPage({ params, searchParams }: Props) {
  const { companyId }                    = await params
  const { page = '1', status, source }   = await searchParams
  const supabase                          = createUserClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: company } = await supabase
    .from('companies')
    .select('id, name, currency')
    .eq('id', companyId)
    .single()

  if (!company) redirect('/dashboard')

  const result = await listEntries({
    company_id: companyId,
    status,
    source,
    page:       parseInt(page),
    page_size:  50,
  })

  if (!result.ok) {
    return <div className="p-6 text-red-600">Fel: {result.error.message}</div>
  }

  const { entries, total, total_pages } = result.value

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[17px] font-bold tracking-tight">Huvudbok</h1>
          <p className="text-[12.5px] text-[#64748b] mt-0.5">{company.name} · {total} verifikat</p>
        </div>
        <div className="flex gap-2">
          <button className="h-8 px-3.5 border border-[#e2e8f0] bg-white text-[12.5px] font-semibold text-[#334155] rounded-[7px] hover:bg-[#f1f5f9] transition-colors">
            SIE4-export
          </button>
          <Link
            href={`/company/${companyId}/voucher`}
            className="h-8 px-3.5 bg-[#1a7a3c] text-white text-[12.5px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors flex items-center gap-1.5"
          >
            + Manuellt verifikat
          </Link>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1.5 mb-4">
        {[
          { label: 'Alla',       val: undefined },
          { label: 'Manuella',   val: 'manual'  },
          { label: 'Auto',       val: 'import'  },
          { label: 'Utkast',     val: 'draft', status: 'draft' },
        ].map(f => {
          const active = (!f.val && !source && !status) ||
                         (f.val === source) ||
                         (f.status && status === f.status)
          return (
            <Link
              key={f.label}
              href={`/company/${companyId}/ledger${f.val ? `?source=${f.val}` : f.status ? `?status=${f.status}` : ''}`}
              className={`px-3 py-1.5 rounded-[20px] text-[12px] font-medium border transition-all ${
                active
                  ? 'bg-white border-[#1a7a3c] text-[#1a7a3c] font-semibold'
                  : 'border-transparent text-[#64748b] hover:bg-white hover:border-[#e2e8f0] hover:text-[#0f172a]'
              }`}
            >
              {f.label}
            </Link>
          )
        })}
      </div>

      {/* Entries list */}
      <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden">
        {entries.length === 0 ? (
          <div className="px-4 py-12 text-center text-[13px] text-[#64748b]">
            Inga verifikat ännu.{' '}
            <Link href={`/company/${companyId}/voucher`} className="text-[#1a7a3c] font-semibold hover:underline">
              Skapa det första →
            </Link>
          </div>
        ) : (
          entries.map(entry => (
            <div key={entry.id} className="border-b border-[#e2e8f0] last:border-b-0">
              {/* Entry header */}
              <Link
                href={`/company/${companyId}/ledger/${entry.id}`}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#f8fafc] transition-colors group"
              >
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  entry.source === 'manual' ? 'bg-[#7c3aed]' :
                  entry.source === 'import' ? 'bg-[#2563eb]' :
                  'bg-[#94a3b8]'
                }`} />
                <span className="font-mono text-[12px] font-semibold text-[#0f172a] w-36 shrink-0">{entry.entry_number}</span>
                <span className="font-mono text-[11.5px] text-[#64748b] w-24 shrink-0">{entry.entry_date}</span>
                <span className="text-[13px] text-[#334155] flex-1 truncate">{entry.description}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-[4px] ${
                    entry.source === 'manual' ? 'bg-[#ede9fe] text-[#6d28d9]' :
                    entry.source === 'import' ? 'bg-[#eff6ff] text-[#2563eb]' :
                    'bg-[#f1f5f9] text-[#475569]'
                  }`}>
                    {entry.source === 'manual' ? 'Manuell' : 'Auto'}
                  </span>
                  <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-[4px] ${
                    entry.status === 'posted'   ? 'bg-[#dcfce7] text-[#15803d]' :
                    entry.status === 'draft'    ? 'bg-[#f1f5f9] text-[#475569]' :
                    entry.status === 'reversed' ? 'bg-[#fee2e2] text-[#b91c1c]' :
                    'bg-[#f1f5f9] text-[#475569]'
                  }`}>
                    {entry.status === 'posted' ? 'Postad' : entry.status === 'draft' ? 'Utkast' : entry.status === 'reversed' ? 'Reverserad' : entry.status}
                  </span>
                </div>
              </Link>
            </div>
          ))
        )}
      </div>

      {/* Pagination */}
      {total_pages > 1 && (
        <div className="flex justify-center gap-2 mt-4">
          {parseInt(page) > 1 && (
            <Link href={`/company/${companyId}/ledger?page=${parseInt(page) - 1}`}
              className="h-8 px-3 border border-[#e2e8f0] bg-white text-[12.5px] rounded-[7px] hover:bg-[#f1f5f9] transition-colors flex items-center">
              ← Föregående
            </Link>
          )}
          <span className="h-8 px-3 flex items-center text-[12.5px] text-[#64748b]">
            Sida {page} av {total_pages}
          </span>
          {parseInt(page) < total_pages && (
            <Link href={`/company/${companyId}/ledger?page=${parseInt(page) + 1}`}
              className="h-8 px-3 border border-[#e2e8f0] bg-white text-[12.5px] rounded-[7px] hover:bg-[#f1f5f9] transition-colors flex items-center">
              Nästa →
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
