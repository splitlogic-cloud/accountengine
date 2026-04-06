import { createUserClient }  from '@/lib/supabase/server'
import { redirect }          from 'next/navigation'
import Link                  from 'next/link'

export default async function DashboardPage() {
  const supabase = createUserClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Fetch profile to get bureau_id
  const { data: profile } = await supabase
    .from('profiles')
    .select('bureau_id')
    .eq('id', user.id)
    .single()

  if (!profile?.bureau_id) {
    // No bureau yet — show onboarding
    return <OnboardingPrompt />
  }

  // Fetch companies for this bureau
  const { data: clients } = await supabase
    .from('bureau_clients')
    .select(`
      company_id,
      assigned_to,
      companies (
        id, name, status, updated_at
      )
    `)
    .eq('bureau_id', profile.bureau_id)
    .order('created_at', { ascending: false })
    .limit(10)

  const companies = (clients ?? []).map(c => c.companies).filter(Boolean)

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[17px] font-bold tracking-tight">Översikt</h1>
          <p className="text-[12.5px] text-[#64748b] mt-0.5">
            {new Date().toLocaleDateString('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <Link
          href="/clients/new"
          className="h-8 px-3.5 bg-[#1a7a3c] text-white text-[12.5px] font-semibold rounded-[7px] flex items-center gap-1.5 hover:bg-[#155c2d] transition-colors"
        >
          <span>+</span> Ny klient
        </Link>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Klienter',     value: companies.length, sub: 'aktiva bolag',     color: '' },
          { label: 'Events idag',  value: '—',              sub: 'synka för att se', color: '' },
          { label: 'Blockerade',   value: '—',              sub: 'events (auto)',    color: 'text-[#d97706]' },
          { label: 'Manuella ver.', value: '—',             sub: 'denna månad',      color: 'text-[#1a7a3c]' },
        ].map(k => (
          <div key={k.label} className="bg-white border border-[#e2e8f0] rounded-[10px] p-4 shadow-sm">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-[#94a3b8] mb-2">{k.label}</div>
            <div className={`text-[26px] font-bold tracking-tight leading-none mb-1 ${k.color}`}>{k.value}</div>
            <div className="text-[11.5px] text-[#64748b]">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Clients list */}
      <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 bg-[#f8fafc] border-b border-[#e2e8f0] flex items-center justify-between">
          <span className="text-[12.5px] font-bold">Klienter</span>
          <Link href="/clients" className="text-[12px] text-[#64748b] hover:text-[#0f172a]">Visa alla →</Link>
        </div>
        {companies.length === 0 ? (
          <div className="px-4 py-10 text-center text-[13px] text-[#64748b]">
            Inga klienter ännu.{' '}
            <Link href="/clients/new" className="text-[#1a7a3c] font-semibold hover:underline">Lägg till den första →</Link>
          </div>
        ) : (
          companies.map((co: any) => (
            <Link
              key={co.id}
              href={`/company/${co.id}`}
              className="flex items-center gap-3 px-4 py-3 border-b border-[#e2e8f0] last:border-b-0 hover:bg-[#f8fafc] transition-colors"
            >
              <div className="w-8 h-8 rounded-[7px] bg-[#f1f5f9] border border-[#e2e8f0] flex items-center justify-center text-[11px] font-bold text-[#64748b] shrink-0">
                {co.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13.5px] font-semibold truncate">{co.name}</div>
                <div className="text-[12px] text-[#64748b]">{co.status}</div>
              </div>
              <div className="w-2 h-2 rounded-full bg-[#22c55e] shrink-0" />
            </Link>
          ))
        )}
      </div>
    </div>
  )
}

function OnboardingPrompt() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-center max-w-sm">
        <div className="text-[32px] mb-3">🏢</div>
        <h2 className="text-[17px] font-bold mb-2">Skapa din byrå</h2>
        <p className="text-[13px] text-[#64748b] mb-5">Du behöver skapa en byrå för att komma igång med AccountEngine.</p>
        <Link
          href="/onboarding"
          className="inline-flex h-9 px-5 bg-[#1a7a3c] text-white text-[13px] font-semibold rounded-[7px] items-center hover:bg-[#155c2d] transition-colors"
        >
          Kom igång →
        </Link>
      </div>
    </div>
  )
}
