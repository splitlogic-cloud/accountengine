import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function CommandPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: bureauUser } = await supabase
    .from('bureau_users')
    .select('bureau_id, role')
    .eq('user_id', user.id)
    .single()

  // Hämta alla bolag med status
  const { data: companies } = await supabase
    .from('companies')
    .select('*')
    .eq('bureau_id', bureauUser!.bureau_id)
    .order('name')

  // Räkna pending transaktioner per bolag
  const { data: pendingCounts } = await supabase
    .from('transactions')
    .select('company_id')
    .eq('bureau_id', bureauUser!.bureau_id)
    .eq('posting_status', 'pending')

  const countMap = (pendingCounts ?? []).reduce<Record<string, number>>(
    (acc, row) => {
      acc[row.company_id] = (acc[row.company_id] ?? 0) + 1
      return acc
    }, {}
  )

  const stats = {
    total:    companies?.length ?? 0,
    active:   companies?.filter(c => c.status === 'active').length ?? 0,
    error:    companies?.filter(c => c.status === 'error').length ?? 0,
    pending:  Object.values(countMap).reduce((a, b) => a + b, 0),
  }

  return (
    <div>
      <div className="bg-white border-b border-[#e6e4de] px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[#1a1916] tracking-tight">Command Center</h1>
          <p className="text-sm text-[#908e87] mt-0.5">{stats.total} klientbolag</p>
        </div>
      </div>

      <div className="p-6">
        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {[
            ['Totalt', stats.total, '#256644'],
            ['Aktiva', stats.active, '#1a6644'],
            ['Pending tx', stats.pending, '#8a5c12'],
            ['Fel', stats.error, '#9b2020'],
          ].map(([label, value, color]) => (
            <div key={String(label)} className="bg-white border border-[#e6e4de] rounded-xl p-4 border-t-[3px]"
              style={{ borderTopColor: String(color) }}>
              <div className="text-xs text-[#908e87] font-medium mb-1">{label}</div>
              <div className="text-2xl font-semibold" style={{ color: String(color) }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Company table */}
        <div className="bg-white border border-[#e6e4de] rounded-xl overflow-hidden">
          <div className="bg-[#faf9f6] border-b border-[#e6e4de] px-5 py-3">
            <span className="text-sm font-semibold text-[#1a1916]">Alla klienter</span>
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-[#faf9f6] border-b border-[#e6e4de]">
                {['Bolag','Org.nr','Status','Sync','Pending',''].map(h => (
                  <th key={h} className="text-left px-4 py-2 text-[11px] font-semibold text-[#908e87] uppercase tracking-wider">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(companies ?? []).map(company => (
                <tr key={company.id} className="border-b border-[#e6e4de] hover:bg-[#edf7f1] transition-colors">
                  <td className="px-4 py-3 font-semibold text-[#1a1916] text-sm">{company.name}</td>
                  <td className="px-4 py-3 text-xs font-mono text-[#908e87]">{company.org_number ?? '—'}</td>
                  <td className="px-4 py-3">
                    <StatusPill status={company.status} />
                  </td>
                  <td className="px-4 py-3">
                    <SyncPill status={company.sync_status} />
                  </td>
                  <td className="px-4 py-3 text-sm font-mono">{countMap[company.id] ?? 0}</td>
                  <td className="px-4 py-3">
                    <a href={`/${company.slug}/overview`}
                      className="text-xs font-medium text-[#256644] hover:underline">
                      Öppna →
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active:   'bg-[#eaf4ee] text-[#1a6644]',
    error:    'bg-[#fdf0f0] text-[#9b2020]',
    pending:  'bg-[#fdf3e4] text-[#8a5c12]',
    inactive: 'bg-[#faf9f6] text-[#908e87] border border-[#d4d2cb]',
  }
  const labels: Record<string, string> = {
    active: 'Aktiv', error: 'Fel', pending: 'Pending', inactive: 'Inaktiv'
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-md text-[11.5px] font-medium ${styles[status] ?? styles.inactive}`}>
      {labels[status] ?? status}
    </span>
  )
}

function SyncPill({ status }: { status: string }) {
  const styles: Record<string, string> = {
    synced:  'bg-[#eaf4ee] text-[#1a6644]',
    syncing: 'bg-[#f0eeff] text-[#4c3d9e]',
    error:   'bg-[#fdf0f0] text-[#9b2020]',
    idle:    'bg-[#faf9f6] text-[#908e87] border border-[#d4d2cb]',
  }
  const labels: Record<string, string> = {
    synced: 'Synkad', syncing: 'Synkar...', error: 'Fel', idle: 'Idle'
  }
  return (
    <span className={`inline-flex px-2 py-0.5 rounded-md text-[11.5px] font-medium ${styles[status] ?? styles.idle}`}>
      {labels[status] ?? status}
    </span>
  )
}
