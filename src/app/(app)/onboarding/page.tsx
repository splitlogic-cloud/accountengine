'use client'

import { useState }         from 'react'
import { createClient }     from '@/lib/supabase/client'
import { useRouter }        from 'next/navigation'

export default function OnboardingPage() {
  const router   = useRouter()
  const supabase = createClient()
  const [step,   setStep]    = useState<1 | 2>(1)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const [bureauName,   setBureauName]   = useState('')
  const [bureauOrg,    setBureauOrg]    = useState('')
  const [companyName,  setCompanyName]  = useState('')
  const [companyOrg,   setCompanyOrg]   = useState('')

  async function handleBureau(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setError('Inte inloggad.'); setLoading(false); return }

    // Create bureau
    const { data: bureau, error: bErr } = await supabase
      .from('bureaus')
      .insert({ name: bureauName.trim(), org_number: bureauOrg.trim() || null })
      .select('id')
      .single()

    if (bErr || !bureau) { setError(bErr?.message ?? 'Kunde inte skapa byrå.'); setLoading(false); return }

    // Link user to bureau
    await supabase
      .from('profiles')
      .update({ bureau_id: bureau.id })
      .eq('id', user.id)

    setStep(2)
    setLoading(false)
  }

  async function handleCompany(e: React.FormEvent) {
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

    if (!profile?.bureau_id) { setError('Byrå saknas.'); setLoading(false); return }

    // Create company via server action (which also seeds BAS)
    const res = await fetch('/api/companies', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        bureau_id:  profile.bureau_id,
        name:       companyName.trim(),
        org_number: companyOrg.trim(),
      }),
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
    <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 bg-[#1a7a3c] rounded-lg flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="5.5" height="5.5" rx="1.2" fill="white"/>
              <rect x="7.5" y="1" width="5.5" height="5.5" rx="1.2" fill="white" opacity=".5"/>
              <rect x="1" y="7.5" width="5.5" height="5.5" rx="1.2" fill="white" opacity=".5"/>
              <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1.2" fill="white"/>
            </svg>
          </div>
          <span className="text-[15px] font-bold tracking-tight">AccountEngine</span>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center justify-center gap-2 mb-6">
          <div className={`w-2 h-2 rounded-full ${step >= 1 ? 'bg-[#1a7a3c]' : 'bg-[#e2e8f0]'}`} />
          <div className="w-8 h-px bg-[#e2e8f0]" />
          <div className={`w-2 h-2 rounded-full ${step >= 2 ? 'bg-[#1a7a3c]' : 'bg-[#e2e8f0]'}`} />
        </div>

        <div className="bg-white border border-[#e2e8f0] rounded-xl p-8 shadow-sm">
          {step === 1 ? (
            <>
              <h1 className="text-[18px] font-bold mb-1">Din byrå</h1>
              <p className="text-[13px] text-[#64748b] mb-6">Berätta om din bokföringsbyrå eller ditt bolag.</p>

              {error && (
                <div className="text-[12.5px] font-medium px-3 py-2 rounded-lg mb-4 bg-[#fef2f2] text-[#b91c1c]">{error}</div>
              )}

              <form onSubmit={handleBureau} className="flex flex-col gap-3">
                <div>
                  <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider block mb-1">Byrånamn *</label>
                  <input
                    required
                    value={bureauName}
                    onChange={e => setBureauName(e.target.value)}
                    placeholder="JoJo Business Management AB"
                    className="w-full h-[36px] px-3 border border-[#e2e8f0] rounded-lg text-[13.5px] outline-none focus:border-[#1a7a3c] transition-all"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider block mb-1">Organisationsnummer</label>
                  <input
                    value={bureauOrg}
                    onChange={e => setBureauOrg(e.target.value)}
                    placeholder="556123-4567"
                    className="w-full h-[36px] px-3 border border-[#e2e8f0] rounded-lg text-[13.5px] outline-none focus:border-[#1a7a3c] transition-all"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !bureauName.trim()}
                  className="h-[36px] bg-[#1a7a3c] text-white text-[13px] font-semibold rounded-lg hover:bg-[#155c2d] transition-colors disabled:opacity-50 mt-1"
                >
                  {loading ? 'Skapar...' : 'Nästa →'}
                </button>
              </form>
            </>
          ) : (
            <>
              <h1 className="text-[18px] font-bold mb-1">Första klientbolaget</h1>
              <p className="text-[13px] text-[#64748b] mb-6">Lägg till ditt första bolag. BAS-kontoplan seedas automatiskt.</p>

              {error && (
                <div className="text-[12.5px] font-medium px-3 py-2 rounded-lg mb-4 bg-[#fef2f2] text-[#b91c1c]">{error}</div>
              )}

              <form onSubmit={handleCompany} className="flex flex-col gap-3">
                <div>
                  <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider block mb-1">Bolagsnamn *</label>
                  <input
                    required
                    value={companyName}
                    onChange={e => setCompanyName(e.target.value)}
                    placeholder="Lyra Music AB"
                    className="w-full h-[36px] px-3 border border-[#e2e8f0] rounded-lg text-[13.5px] outline-none focus:border-[#1a7a3c] transition-all"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider block mb-1">Organisationsnummer</label>
                  <input
                    value={companyOrg}
                    onChange={e => setCompanyOrg(e.target.value)}
                    placeholder="556123-4567"
                    className="w-full h-[36px] px-3 border border-[#e2e8f0] rounded-lg text-[13.5px] outline-none focus:border-[#1a7a3c] transition-all"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !companyName.trim()}
                  className="h-[36px] bg-[#1a7a3c] text-white text-[13px] font-semibold rounded-lg hover:bg-[#155c2d] transition-colors disabled:opacity-50 mt-1"
                >
                  {loading ? 'Skapar...' : 'Kom igång →'}
                </button>
                <button
                  type="button"
                  onClick={() => router.push('/dashboard')}
                  className="text-[12.5px] text-[#64748b] hover:text-[#0f172a] text-center transition-colors"
                >
                  Hoppa över — lägg till bolag senare
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
