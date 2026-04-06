import { createUserClient } from '@/lib/supabase/server'
import { redirect }         from 'next/navigation'

interface Props {
  params:      Promise<{ companyId: string }>
  searchParams: Promise<{ q?: string }>
}

export default async function AccountsPage({ params, searchParams }: Props) {
  const { companyId } = await params
  const { q }          = await searchParams
  const supabase        = createUserClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let query = supabase
    .from('accounts')
    .select('*')
    .eq('company_id', companyId)
    .order('account_number')

  if (q) {
    query = query.or(`account_number.ilike.${q}%,name.ilike.%${q}%`)
  }

  const { data: accounts } = await query

  const typeLabel: Record<string, string> = {
    asset:     'Tillgång',
    liability: 'Skuld',
    equity:    'Eget kapital',
    revenue:   'Intäkt',
    expense:   'Kostnad',
    tax:       'Skatt',
  }

  const typeColor: Record<string, string> = {
    asset:     'bg-[#eff6ff] text-[#2563eb]',
    liability: 'bg-[#fef9c3] text-[#854d0e]',
    equity:    'bg-[#ede9fe] text-[#6d28d9]',
    revenue:   'bg-[#dcfce7] text-[#15803d]',
    expense:   'bg-[#fee2e2] text-[#b91c1c]',
    tax:       'bg-[#f1f5f9] text-[#475569]',
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[17px] font-bold tracking-tight">Kontoplan</h1>
          <p className="text-[12.5px] text-[#64748b] mt-0.5">BAS 2024 · {accounts?.length ?? 0} konton</p>
        </div>
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="Sök konto eller namn..."
            className="h-8 px-3 border border-[#e2e8f0] rounded-[7px] text-[13px] outline-none focus:border-[#1a7a3c] w-[220px] bg-white"
          />
          <button
            type="submit"
            className="h-8 px-3.5 bg-[#1a7a3c] text-white text-[12.5px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors"
          >
            Sök
          </button>
        </form>
      </div>

      <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
              <th className="text-left px-5 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Konto</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Namn</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Typ</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Normal</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">SKV-ruta</th>
              <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody>
            {(accounts ?? []).map((account: any) => (
              <tr key={account.id} className="border-b border-[#e2e8f0] last:border-b-0 hover:bg-[#f8fafc] transition-colors">
                <td className="px-5 py-2.5 font-mono text-[13px] font-bold text-[#0f172a]">{account.account_number}</td>
                <td className="px-4 py-2.5 text-[13px] text-[#334155]">{account.name}</td>
                <td className="px-4 py-2.5">
                  <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-[4px] ${typeColor[account.account_type] ?? 'bg-[#f1f5f9] text-[#475569]'}`}>
                    {typeLabel[account.account_type] ?? account.account_type}
                  </span>
                </td>
                <td className="px-4 py-2.5 font-mono text-[11.5px] text-[#64748b]">
                  {account.normal_side === 'debit' ? 'D' : 'K'}
                </td>
                <td className="px-4 py-2.5 font-mono text-[11.5px] text-[#64748b]">
                  {account.vat_code ?? '—'}
                </td>
                <td className="px-4 py-2.5">
                  {account.is_active ? (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[4px] bg-[#dcfce7] text-[#15803d]">Aktiv</span>
                  ) : (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[4px] bg-[#f1f5f9] text-[#475569]">Inaktiv</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {(accounts ?? []).length === 0 && (
          <div className="px-4 py-10 text-center text-[13px] text-[#64748b]">
            {q ? `Inga konton matchar "${q}".` : 'Kontoplan saknas. Kontrollera att migrationer körts.'}
          </div>
        )}
      </div>
    </div>
  )
}
