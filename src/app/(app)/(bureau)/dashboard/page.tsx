import { redirect }         from 'next/navigation'
import { createUserClient } from '@/lib/supabase/server'
import Link                  from 'next/link'

export default async function DashboardPage() {
  const supabase = createUserClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('bureau_id, full_name')
    .eq('id', user.id)
    .single()

  if (!profile?.bureau_id) redirect('/onboarding')

  // Fetch all companies this user has access to
  const { data: members } = await supabase
    .from('company_members')
    .select('company_id, role, companies(id, name, org_number, status)')
    .eq('user_id', user.id)
    .not('accepted_at', 'is', null)

  const companies = (members ?? [])
    .map((m: any) => m.companies)
    .filter(Boolean)

  // Solo user with exactly one company — go straight there
  if (companies.length === 1) {
    redirect(`/${companies[0].id}/voucher`)
  }

  // No companies yet
  if (companies.length === 0) {
    redirect('/onboarding')
  }

  // Bureau user with multiple companies — show list
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[17px] font-bold tracking-tight">Översikt</h1>
          <p className="text-[12.5px] text-[#64748b] mt-0.5">
            {new Date().toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <Link
          href="/clients/new"
          className="h-8 px-3.5 bg-[#1a7a3c] text-white text-[12.5px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors flex items-center gap-1.5"
        >
          + Nytt bolag
        </Link>
      </div>

      <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between">
          <span className="text-[12.5px] font-bold">Bolag ({companies.length})</span>
        </div>
        {companies.map((co: any) => (
          <Link
            key={co.id}
            href={`/${co.id}/voucher`}
            className="flex items-center gap-3 px-5 py-3.5 border-b border-[#e2e8f0] last:border-b-0 hover:bg-[#f8fafc] transition-colors"
          >
            <div className="w-9 h-9 rounded-[8px] bg-[#f1f5f9] border border-[#e2e8f0] flex items-center justify-center text-[11px] font-bold text-[#64748b] shrink-0">
              {co.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[13.5px] font-semibold text-[#0f172a] truncate">{co.name}</div>
              <div className="text-[12px] text-[#64748b]">{co.org_number ?? 'Org.nr saknas'}</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#94a3b8" strokeWidth="1.6"><path d="M6 3l5 5-5 5"/></svg>
          </Link>
        ))}
      </div>
    </div>
  )
}
