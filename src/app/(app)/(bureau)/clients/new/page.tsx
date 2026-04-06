'use client'

import { useState }     from 'react'
import { useRouter }    from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import Link             from 'next/link'

export default function NewClientPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [name,     setName]     = useState('')
  const [org,      setOrg]      = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Inte inloggad.'); setLoading(false); return }

    const { data: profile } = await supabase
      .from('profiles')
      .select('bureau_id')
      .eq('id', user.id)
      .single()

    if (!profile?.bureau_id) { setError('Byrå saknas. Gå till onboarding.'); setLoading(false); return }

    const res = await fetch('/api/companies', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ bureau_id: profile.bureau_id, name: name.trim(), org_number: org.trim() }),
    })

    if (!res.ok) {
      const json = await res.json().catch(() => ({}))
      setError(json.error ?? 'Kunde inte skapa bolag.')
      setLoading(false)
      return
    }

    const { company_id } = await res.json()
    router.push(`/company/${company_id}/voucher`)
  }

  return (
    <div className="p-6 max-w-lg">
      <div className="mb-5">
        <Link href="/clients" className="text-[12px] text-[#64748b] hover:text-[#0f172a] flex items-center gap-1 mb-3">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8 10L4 6l4-4"/></svg>
          Alla klienter
        </Link>
        <h1 className="text-[17px] font-bold tracking-tight">Lägg till bolag</h1>
        <p className="text-[12.5px] text-[#64748b] mt-0.5">BAS 2024-kontoplan seedas automatiskt.</p>
      </div>

      {error && (
        <div className="text-[12.5px] font-medium px-3 py-2 rounded-lg mb-4 bg-[#fef2f2] text-[#b91c1c] border border-[#fecaca]">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm p-6 flex flex-col gap-4">
        <div>
          <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider block mb-1.5">Bolagsnamn *</label>
          <input
            required
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Lyra Music AB"
            className="w-full h-[36px] px-3 border border-[#e2e8f0] rounded-[7px] text-[13.5px] outline-none focus:border-[#1a7a3c] focus:ring-2 focus:ring-[#1a7a3c]/10 transition-all"
          />
        </div>

        <div>
          <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider block mb-1.5">Organisationsnummer</label>
          <input
            value={org}
            onChange={e => setOrg(e.target.value)}
            placeholder="556123-4567"
            className="w-full h-[36px] px-3 border border-[#e2e8f0] rounded-[7px] text-[13.5px] outline-none focus:border-[#1a7a3c] focus:ring-2 focus:ring-[#1a7a3c]/10 transition-all"
          />
        </div>

        <div className="bg-[#e8f5ee] border border-[#b8ddc9] rounded-[7px] px-3 py-2.5 text-[12.5px] text-[#155c2d]">
          ✓ BAS 2024-kontoplan med 85 konton seedas automatiskt vid skapande.
        </div>

        <div className="flex gap-2 pt-1">
          <Link
            href="/clients"
            className="flex-1 h-9 flex items-center justify-center border border-[#e2e8f0] text-[13px] font-semibold text-[#334155] rounded-[7px] hover:bg-[#f1f5f9] transition-colors"
          >
            Avbryt
          </Link>
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="flex-1 h-9 bg-[#1a7a3c] text-white text-[13px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors disabled:opacity-50"
          >
            {loading ? 'Skapar...' : 'Skapa bolag →'}
          </button>
        </div>
      </form>
    </div>
  )
}
