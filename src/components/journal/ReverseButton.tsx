'use client'

import { useState }              from 'react'
import { useRouter }             from 'next/navigation'
import { reverseJournalEntry }   from '@/lib/actions/journal-actions'

interface Props {
  entryId:     string
  companyId:   string
  entryNumber: string
  userId:      string
}

export function ReverseButton({ entryId, companyId, entryNumber, userId }: Props) {
  const router              = useRouter()
  const [open,    setOpen]  = useState(false)
  const [reason,  setReason] = useState(`Reversering av ${entryNumber}`)
  const [loading, setLoading] = useState(false)
  const [error,   setError]  = useState<string | null>(null)

  async function handleReverse() {
    setLoading(true)
    setError(null)
    try {
      const today = new Date().toISOString().split('T')[0]!
      await reverseJournalEntry(entryId, companyId, userId, today, reason)
      router.push(`/${companyId}/ledger`)
      router.refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reversering misslyckades')
      setLoading(false)
    }
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="h-8 px-3.5 bg-[#fef2f2] text-[#dc2626] border border-[#fecaca] text-[12.5px] font-semibold rounded-[7px] hover:bg-[#fee2e2] transition-colors"
      >
        Reversera verifikat
      </button>

      {open && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center z-50">
          <div className="bg-white border border-[#e2e8f0] rounded-[12px] shadow-2xl p-6 w-[400px]">
            <h2 className="text-[15px] font-bold mb-1">Reversera {entryNumber}?</h2>
            <p className="text-[12.5px] text-[#64748b] mb-4">
              Ett nytt motverifikat skapas med omvända D/K-rader. Originalverifikatet förblir oförändrat.
            </p>

            <div className="mb-4">
              <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider block mb-1">Anledning</label>
              <input
                value={reason}
                onChange={e => setReason(e.target.value)}
                className="w-full h-9 px-3 border border-[#e2e8f0] rounded-[7px] text-[13px] outline-none focus:border-[#1a7a3c] transition-all"
              />
            </div>

            {error && (
              <div className="text-[12px] text-[#b91c1c] bg-[#fef2f2] px-3 py-2 rounded-[6px] mb-3">{error}</div>
            )}

            <div className="flex gap-2">
              <button
                onClick={() => setOpen(false)}
                className="flex-1 h-9 border border-[#e2e8f0] text-[13px] font-semibold text-[#334155] rounded-[7px] hover:bg-[#f1f5f9] transition-colors"
              >
                Avbryt
              </button>
              <button
                onClick={handleReverse}
                disabled={loading || !reason.trim()}
                className="flex-1 h-9 bg-[#dc2626] text-white text-[13px] font-semibold rounded-[7px] hover:bg-[#b91c1c] transition-colors disabled:opacity-50"
              >
                {loading ? 'Reverserar...' : 'Reversera'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
