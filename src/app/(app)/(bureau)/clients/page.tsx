import { createUserClient } from '@/lib/supabase/server'
import { redirect }         from 'next/navigation'
import Link                 from 'next/link'

export default async function ClientsPage() {
  const supabase = createUserClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('bureau_id')
    .eq('id', user.id)
    .single()

  if (!profile?.bureau_id) redirect('/onboarding')

  const { data: clients } = await supabase
    .from('bureau_clients')
    .select('company_id, companies(id, name, org_number, status)')
    .eq('bureau_id', profile.bureau_id)
    .order('created_at', { ascending: false })

  const companies = (clients ?? []).map((c: any) => c.companies).filter(Boolean)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[17px] font-bold tracking-tight">Klienter</h1>
          <p className="text-[12.5px] text-[#64748b] mt-0.5">{companies.length} bolag</p>
        </div>
        <Link
          href="/clients/new"
          className="h-8 px-3.5 bg-[#1a7a3c] text-white text-[12.5px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors flex items-center gap-1.5"
        >
          + Lägg till bolag
        </Link>
      </div>

      <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden">
        {companies.length === 0 ? (
          <div className="px-4 py-16 text-center">
            <div className="text-3xl mb-3">🏢</div>
            <div className="text-[14px] font-semibold mb-1">Inga bolag ännu</div>
            <p className="text-[13px] text-[#64748b] mb-5">Lägg till ditt första klientbolag för att komma igång.</p>
            <Link
              href="/clients/new"
              className="inline-flex h-9 px-5 bg-[#1a7a3c] text-white text-[13px] font-semibold rounded-[7px] items-center hover:bg-[#155c2d] transition-colors"
            >
              + Lägg till bolag
            </Link>
          </div>
        ) : (
          companies.map((co: any) => (
            <Link
              key={co.id}
              href={`/company/${co.id}/voucher`}
              className="flex items-center gap-3 px-5 py-3.5 border-b border-[#e2e8f0] last:border-b-0 hover:bg-[#f8fafc] transition-colors"
            >
              <div className="w-9 h-9 rounded-[8px] bg-[#f1f5f9] border border-[#e2e8f0] flex items-center justify-center text-[11px] font-bold text-[#64748b] shrink-0">
                {co.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold text-[#0f172a] truncate">{co.name}</div>
                <div className="text-[12px] text-[#64748b]">{co.org_number ?? 'Org.nr saknas'}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-[4px] ${
                  co.status === 'active'
                    ? 'bg-[#dcfce7] text-[#15803d]'
                    : 'bg-[#f1f5f9] text-[#475569]'
                }`}>
                  {co.status === 'active' ? 'Aktiv' : co.status}
                </span>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#94a3b8" strokeWidth="1.6"><path d="M6 3l5 5-5 5"/></svg>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}
