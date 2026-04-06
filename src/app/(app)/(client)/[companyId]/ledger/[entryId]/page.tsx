import { createUserClient }  from '@/lib/supabase/server'
import { redirect }          from 'next/navigation'
import { getEntry }          from '@/lib/accounting/journal-service'
import Link                  from 'next/link'
import { ReverseButton }     from '@/components/journal/ReverseButton'

interface Props {
  params: Promise<{ companyId: string; entryId: string }>
}

export default async function EntryDetailPage({ params }: Props) {
  const { companyId, entryId } = await params
  const supabase                = createUserClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const result = await getEntry(entryId, companyId)
  if (!result.ok) redirect(`/company/${companyId}/ledger`)

  const entry = result.value

  const totalDebit  = entry.lines.filter(l => l.side === 'debit').reduce((s, l) => s + l.amount, 0)
  const totalCredit = entry.lines.filter(l => l.side === 'credit').reduce((s, l) => s + l.amount, 0)

  const fmt = (n: number) => n.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  return (
    <div className="p-6 max-w-3xl">
      <div className="mb-4">
        <Link
          href={`/company/${companyId}/ledger`}
          className="text-[12px] text-[#64748b] hover:text-[#0f172a] flex items-center gap-1 mb-3"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8 10L4 6l4-4"/></svg>
          Huvudbok
        </Link>
        <div className="flex items-center gap-3">
          <h1 className="text-[17px] font-bold font-mono tracking-tight">{entry.entry_number}</h1>
          <span className={`text-[11.5px] font-semibold px-2.5 py-0.5 rounded-[4px] ${
            entry.status === 'posted'   ? 'bg-[#dcfce7] text-[#15803d]' :
            entry.status === 'reversed' ? 'bg-[#fee2e2] text-[#b91c1c]' :
            'bg-[#f1f5f9] text-[#475569]'
          }`}>
            {entry.status === 'posted' ? 'Postad' : entry.status === 'reversed' ? 'Reverserad' : 'Utkast'}
          </span>
          {entry.source === 'manual' && (
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-[4px] bg-[#ede9fe] text-[#6d28d9]">Manuell</span>
          )}
        </div>
      </div>

      <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden mb-4">
        {/* Meta */}
        <div className="grid grid-cols-3 gap-4 px-5 py-4 border-b border-[#e2e8f0]">
          <div>
            <div className="text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider mb-1">Datum</div>
            <div className="text-[13.5px] font-semibold">{entry.entry_date}</div>
          </div>
          <div className="col-span-2">
            <div className="text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider mb-1">Verifikationstext</div>
            <div className="text-[13.5px]">{entry.description}</div>
          </div>
        </div>

        {/* Lines */}
        <div>
          <div className="grid px-5 py-2 bg-[#f8fafc] border-b border-[#e2e8f0] text-[10px] font-bold text-[#64748b] uppercase tracking-wider"
            style={{ gridTemplateColumns: '50px 80px 1fr 130px' }}>
            <div>D/K</div><div>Konto</div><div>Benämning</div><div className="text-right">Belopp</div>
          </div>

          {entry.lines.map((line: any) => (
            <div
              key={line.id}
              className="grid px-5 py-2.5 border-b border-[#e2e8f0] last:border-b-0 items-center"
              style={{ gridTemplateColumns: '50px 80px 1fr 130px' }}
            >
              <div className={`text-[10px] font-bold uppercase tracking-wider ${line.side === 'debit' ? 'text-[#1a7a3c]' : 'text-[#94a3b8]'}`}>
                {line.side === 'debit' ? 'D' : 'K'}
              </div>
              <div className="font-mono text-[12.5px] font-semibold">{line.account_number}</div>
              <div className="text-[13px] text-[#334155]">{line.account_name}</div>
              <div className="text-right font-mono text-[13px] font-medium">{fmt(line.amount)}</div>
            </div>
          ))}

          {/* Totals */}
          <div className="grid px-5 py-2.5 bg-[#f8fafc] border-t border-[#e2e8f0] text-[12px] font-semibold"
            style={{ gridTemplateColumns: '50px 80px 1fr 130px' }}>
            <div></div>
            <div></div>
            <div className="flex gap-6 text-[#64748b]">
              <span>Debet <span className="font-mono text-[#0f172a]">{fmt(totalDebit)}</span></span>
              <span>Kredit <span className="font-mono text-[#0f172a]">{fmt(totalCredit)}</span></span>
            </div>
            <div className="text-right">
              {Math.abs(totalDebit - totalCredit) < 0.005 ? (
                <span className="text-[#15803d]">✓ Balanserar</span>
              ) : (
                <span className="text-[#b91c1c]">⚠ Obalans</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      {entry.status === 'posted' && !entry.reversed_by && (
        <div className="flex gap-2">
          <ReverseButton
            entryId={entryId}
            companyId={companyId}
            entryNumber={entry.entry_number}
            userId={user.id}
          />
        </div>
      )}

      {entry.reversed_by && (
        <div className="bg-[#fef2f2] border border-[#fecaca] rounded-[7px] px-4 py-3 text-[12.5px] text-[#b91c1c]">
          Detta verifikat har reverserats.
        </div>
      )}
    </div>
  )
}
