'use client'

import { useState }     from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter }    from 'next/navigation'

type Mode = 'choose' | 'bureau' | 'solo'

export default function OnboardingPage() {
  const router   = useRouter()
  const supabase = createClient()

  const [mode,    setMode]    = useState<Mode>('choose')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  // Bureau fields
  const [bureauName, setBureauName] = useState('')
  const [bureauOrg,  setBureauOrg]  = useState('')
  const [coName,     setCoName]     = useState('')
  const [coOrg,      setCoOrg]      = useState('')

  // Solo fields
  const [soloName, setSoloName] = useState('')
  const [soloOrg,  setSoloOrg]  = useState('')

  async function getUser() {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('Inte inloggad.')
    return user
  }

  async function createBureauAndCompany(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const user = await getUser()

      // Create bureau — use service API route to bypass RLS
      const bureauRes = await fetch('/api/onboarding', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          type:        'bureau',
          bureau_name: bureauName.trim(),
          bureau_org:  bureauOrg.trim() || null,
          co_name:     coName.trim() || null,
          co_org:      coOrg.trim() || null,
        }),
      })

      const json = await bureauRes.json()
      if (!bureauRes.ok) throw new Error(json.error ?? 'Kunde inte skapa byrå.')

      if (json.company_id) {
        router.push(`/${json.company_id}/voucher`)
      } else {
        router.push('/dashboard')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Okänt fel')
      setLoading(false)
    }
  }

  async function createSoloCompany(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      await getUser()

      const res = await fetch('/api/onboarding', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          type:    'solo',
          co_name: soloName.trim(),
          co_org:  soloOrg.trim() || null,
        }),
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Kunde inte skapa bolag.')

      router.push(`/${json.company_id}/voucher`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Okänt fel')
      setLoading(false)
    }
  }

  // ── Shared UI helpers ──────────────────────────────────────────────────

  const Field = ({
    label, value, onChange, placeholder, required = false,
  }: {
    label: string; value: string; onChange: (v: string) => void
    placeholder?: string; required?: boolean
  }) => (
    <div>
      <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider block mb-1.5">
        {label}{required && ' *'}
      </label>
      <input
        required={required}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full h-[36px] px-3 border border-[#e2e8f0] rounded-[7px] text-[13.5px] outline-none focus:border-[#1a7a3c] focus:ring-2 focus:ring-[#1a7a3c]/10 transition-all"
      />
    </div>
  )

  // ── Choose mode ────────────────────────────────────────────────────────

  if (mode === 'choose') {
    return (
      <Wrapper step={0}>
        <h1 className="text-[18px] font-bold mb-1">Välkommen till AccountEngine</h1>
        <p className="text-[13px] text-[#64748b] mb-6">Hur vill du använda systemet?</p>

        <div className="flex flex-col gap-3">
          <button
            onClick={() => setMode('bureau')}
            className="flex items-start gap-4 p-4 border-2 border-[#e2e8f0] rounded-[10px] hover:border-[#1a7a3c] hover:bg-[#e8f5ee] transition-all text-left"
          >
            <div className="w-10 h-10 bg-[#e8f5ee] rounded-[8px] flex items-center justify-center text-xl shrink-0">🏢</div>
            <div>
              <div className="text-[14px] font-bold text-[#0f172a] mb-0.5">Bokföringsbyrå</div>
              <div className="text-[12.5px] text-[#64748b]">Jag sköter bokföring för flera bolag. JoJo Business Management AB är ett exempel.</div>
            </div>
          </button>

          <button
            onClick={() => setMode('solo')}
            className="flex items-start gap-4 p-4 border-2 border-[#e2e8f0] rounded-[10px] hover:border-[#1a7a3c] hover:bg-[#e8f5ee] transition-all text-left"
          >
            <div className="w-10 h-10 bg-[#e8f5ee] rounded-[8px] flex items-center justify-center text-xl shrink-0">👤</div>
            <div>
              <div className="text-[14px] font-bold text-[#0f172a] mb-0.5">Eget bolag</div>
              <div className="text-[12.5px] text-[#64748b]">Jag bokför bara för mitt eget bolag. Kom direkt in i systemet.</div>
            </div>
          </button>
        </div>
      </Wrapper>
    )
  }

  // ── Bureau mode ────────────────────────────────────────────────────────

  if (mode === 'bureau') {
    return (
      <Wrapper step={1} onBack={() => setMode('choose')}>
        <h1 className="text-[18px] font-bold mb-1">Din byrå</h1>
        <p className="text-[13px] text-[#64748b] mb-5">Du kan lägga till fler bolag senare.</p>

        {error && <ErrorMsg msg={error} />}

        <form onSubmit={createBureauAndCompany} className="flex flex-col gap-3">
          <Field label="Byrånamn"           value={bureauName} onChange={setBureauName} placeholder="JoJo Business Management AB" required />
          <Field label="Org.nr (valfritt)"  value={bureauOrg}  onChange={setBureauOrg}  placeholder="556123-4567" />

          <div className="h-px bg-[#e2e8f0] my-1" />
          <p className="text-[12px] text-[#64748b]">Första klientbolaget (valfritt, kan läggas till senare):</p>

          <Field label="Bolagsnamn"         value={coName} onChange={setCoName} placeholder="Lyra Music AB" />
          <Field label="Org.nr (valfritt)"  value={coOrg}  onChange={setCoOrg}  placeholder="556999-0001" />

          <button
            type="submit"
            disabled={loading || !bureauName.trim()}
            className="h-[38px] bg-[#1a7a3c] text-white text-[13.5px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors disabled:opacity-50 mt-1"
          >
            {loading ? 'Skapar...' : 'Skapa byrå →'}
          </button>
        </form>
      </Wrapper>
    )
  }

  // ── Solo mode ──────────────────────────────────────────────────────────

  return (
    <Wrapper step={1} onBack={() => setMode('choose')}>
      <h1 className="text-[18px] font-bold mb-1">Ditt bolag</h1>
      <p className="text-[13px] text-[#64748b] mb-5">BAS 2024-kontoplan seedas automatiskt.</p>

      {error && <ErrorMsg msg={error} />}

      <form onSubmit={createSoloCompany} className="flex flex-col gap-3">
        <Field label="Bolagsnamn"          value={soloName} onChange={setSoloName} placeholder="Mitt AB" required />
        <Field label="Org.nr (valfritt)"   value={soloOrg}  onChange={setSoloOrg}  placeholder="556123-4567" />

        <div className="bg-[#e8f5ee] border border-[#b8ddc9] rounded-[7px] px-3 py-2.5 text-[12.5px] text-[#155c2d]">
          ✓ Du kommer direkt in i bokföringsvyn efter skapande.
        </div>

        <button
          type="submit"
          disabled={loading || !soloName.trim()}
          className="h-[38px] bg-[#1a7a3c] text-white text-[13.5px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors disabled:opacity-50 mt-1"
        >
          {loading ? 'Skapar...' : 'Kom igång →'}
        </button>
      </form>
    </Wrapper>
  )
}

// ── Shared components ──────────────────────────────────────────────────────

function Wrapper({
  children, step, onBack,
}: {
  children: React.ReactNode; step: number; onBack?: () => void
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8fafc] px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-6">
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

        {/* Step dots */}
        <div className="flex items-center justify-center gap-2 mb-5">
          {[0, 1].map(i => (
            <div key={i} className={`rounded-full transition-all ${
              i === step
                ? 'w-6 h-2 bg-[#1a7a3c]'
                : i < step
                ? 'w-2 h-2 bg-[#1a7a3c]'
                : 'w-2 h-2 bg-[#e2e8f0]'
            }`} />
          ))}
        </div>

        <div className="bg-white border border-[#e2e8f0] rounded-xl p-7 shadow-sm">
          {onBack && (
            <button
              onClick={onBack}
              className="flex items-center gap-1 text-[12px] text-[#64748b] hover:text-[#0f172a] mb-4 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M8 10L4 6l4-4"/></svg>
              Tillbaka
            </button>
          )}
          {children}
        </div>
      </div>
    </div>
  )
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div className="text-[12.5px] font-medium px-3 py-2.5 rounded-[7px] mb-4 bg-[#fef2f2] text-[#b91c1c] border border-[#fecaca]">
      {msg}
    </div>
  )
}
