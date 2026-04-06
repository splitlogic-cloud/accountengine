import { createUserClient } from '@/lib/supabase/server'
import { redirect }         from 'next/navigation'
import Link                 from 'next/link'

interface Props {
  params: Promise<{ companyId: string }>
}

export default async function ReportsPage({ params }: Props) {
  const { companyId } = await params
  const supabase       = createUserClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Trial balance — aggregate from general_ledger view
  const { data: glData } = await supabase
    .from('general_ledger')
    .select('account_number, account_name, account_type, normal_side, net_amount')
    .eq('company_id', companyId)

  // Aggregate per account
  const accountMap = new Map<string, { name: string; type: string; normal_side: string; balance: number }>()
  for (const row of glData ?? []) {
    const key = row.account_number as string
    const existing = accountMap.get(key)
    if (existing) {
      existing.balance += row.net_amount as number
    } else {
      accountMap.set(key, {
        name:        row.account_name as string,
        type:        row.account_type as string,
        normal_side: row.normal_side  as string,
        balance:     row.net_amount   as number,
      })
    }
  }

  const accounts = Array.from(accountMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .filter(([, v]) => Math.abs(v.balance) > 0.005)

  const fmt = (n: number) => Math.abs(n).toLocaleString('sv-SE', { minimumFractionDigits: 2 })

  const totalDebit  = accounts.filter(([, v]) => v.balance > 0).reduce((s, [, v]) => s + v.balance, 0)
  const totalCredit = accounts.filter(([, v]) => v.balance < 0).reduce((s, [, v]) => s + Math.abs(v.balance), 0)

  const reports = [
    { title: 'Provbalans',        desc: 'Saldolista per konto · nedan', href: '#trialbalance', icon: '📊' },
    { title: 'Resultaträkning',   desc: 'Intäkter – kostnader',         href: '#',             icon: '📈' },
    { title: 'Balansräkning',     desc: 'Tillgångar = Skulder + EK',    href: '#',             icon: '⚖️' },
    { title: 'Momsrapport',       desc: 'Deklarationsunderlag',         href: `../vat`,        icon: '🧾' },
    { title: 'SIE4-export',       desc: 'För revisor',                  href: '#',             icon: '📁' },
    { title: 'Kundreskontra',     desc: 'Öppna poster + åldersanalys',  href: `../reskontra`,  icon: '📋' },
  ]

  return (
    <div className="p-6">
      <h1 className="text-[17px] font-bold tracking-tight mb-5">Rapporter</h1>

      <div className="grid grid-cols-3 gap-3 mb-8">
        {reports.map(r => (
          <Link
            key={r.title}
            href={r.href}
            className="bg-white border border-[#e2e8f0] rounded-[10px] p-4 shadow-sm hover:border-[#1a7a3c] hover:shadow-md transition-all"
          >
            <div className="text-2xl mb-2">{r.icon}</div>
            <div className="text-[13.5px] font-bold mb-1">{r.title}</div>
            <div className="text-[12px] text-[#64748b]">{r.desc}</div>
          </Link>
        ))}
      </div>

      {/* Trial balance */}
      <div id="trialbalance">
        <h2 className="text-[15px] font-bold mb-3">Provbalans</h2>
        <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden">
          <div className="grid px-5 py-2.5 bg-[#f8fafc] border-b border-[#e2e8f0] text-[10px] font-bold text-[#64748b] uppercase tracking-wider"
            style={{ gridTemplateColumns: '80px 1fr 130px 130px' }}>
            <div>Konto</div><div>Namn</div><div className="text-right">Debet</div><div className="text-right">Kredit</div>
          </div>

          {accounts.length === 0 ? (
            <div className="px-5 py-10 text-center text-[13px] text-[#64748b]">
              Inga postade verifikat ännu. Provbalansen visas när du har bokfört något.
            </div>
          ) : (
            <>
              {accounts.map(([accNum, acc]) => (
                <div
                  key={accNum}
                  className="grid px-5 py-2 border-b border-[#e2e8f0] last:border-b-0 hover:bg-[#f8fafc] transition-colors"
                  style={{ gridTemplateColumns: '80px 1fr 130px 130px' }}
                >
                  <div className="font-mono text-[12.5px] font-semibold text-[#0f172a]">{accNum}</div>
                  <div className="text-[13px] text-[#334155]">{acc.name}</div>
                  <div className="text-right font-mono text-[12.5px]">
                    {acc.balance > 0 ? fmt(acc.balance) : '—'}
                  </div>
                  <div className="text-right font-mono text-[12.5px]">
                    {acc.balance < 0 ? fmt(acc.balance) : '—'}
                  </div>
                </div>
              ))}

              {/* Totals */}
              <div
                className="grid px-5 py-3 bg-[#f8fafc] border-t border-[#e2e8f0] font-bold"
                style={{ gridTemplateColumns: '80px 1fr 130px 130px' }}
              >
                <div></div>
                <div className="text-[12.5px] text-[#334155]">Totalt</div>
                <div className="text-right font-mono text-[12.5px]">{fmt(totalDebit)}</div>
                <div className="text-right font-mono text-[12.5px]">{fmt(totalCredit)}</div>
              </div>

              {Math.abs(totalDebit - totalCredit) > 0.01 && (
                <div className="px-5 py-2 bg-[#fef2f2] border-t border-[#fecaca] text-[12px] text-[#b91c1c] font-medium">
                  ⚠ Provbalansen balanserar inte. Debet={fmt(totalDebit)} Kredit={fmt(totalCredit)}.
                  Kontrollera verifikaten.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
