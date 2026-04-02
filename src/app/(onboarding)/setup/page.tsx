'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SetupPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({ bureau_name: '', bureau_org_nr: '', company_name: '', company_org_nr: '' })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/onboarding/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Okänt fel')
      router.push(data.redirect)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Okänt fel')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f5f4f0] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-[#e2ddd5] w-full max-w-md overflow-hidden shadow-sm">
        <div className="bg-gradient-to-br from-[#112a1a] to-[#1a3d28] px-8 py-6">
          <h1 className="text-2xl font-semibold text-white" style={{ fontFamily: 'Georgia, serif' }}>
            Välkommen till AccountEngine
          </h1>
          <p className="text-[#a8d8bc] text-sm mt-1">Konfigurera din byrå för att komma igång</p>
        </div>
        <form onSubmit={handleSubmit} className="p-8 space-y-5">
          <div>
            <div className="text-xs font-semibold text-[#7a7570] uppercase tracking-wider mb-1.5">Byråns namn</div>
            <input className="w-full h-10 px-3 border border-[#cdc8be] rounded-lg text-sm outline-none focus:border-[#3d9467]"
              placeholder="JoJo Business Management AB"
              value={form.bureau_name} onChange={e => setForm(f => ({ ...f, bureau_name: e.target.value }))} required />
          </div>
          <div>
            <div className="text-xs font-semibold text-[#7a7570] uppercase tracking-wider mb-1.5">Byrå org.nr (valfritt)</div>
            <input className="w-full h-10 px-3 border border-[#cdc8be] rounded-lg text-sm outline-none focus:border-[#3d9467]"
              placeholder="556XXX-XXXX"
              value={form.bureau_org_nr} onChange={e => setForm(f => ({ ...f, bureau_org_nr: e.target.value }))} />
          </div>
          <div className="border-t border-[#e2ddd5] pt-5">
            <div className="text-xs font-semibold text-[#7a7570] uppercase tracking-wider mb-1.5">Första klientbolag</div>
            <input className="w-full h-10 px-3 border border-[#cdc8be] rounded-lg text-sm outline-none focus:border-[#3d9467]"
              placeholder="Lyra Music AB"
              value={form.company_name} onChange={e => setForm(f => ({ ...f, company_name: e.target.value }))} required />
          </div>
          <div>
            <div className="text-xs font-semibold text-[#7a7570] uppercase tracking-wider mb-1.5">Bolagets org.nr (valfritt)</div>
            <input className="w-full h-10 px-3 border border-[#cdc8be] rounded-lg text-sm outline-none focus:border-[#3d9467]"
              placeholder="559XXX-XXXX"
              value={form.company_org_nr} onChange={e => setForm(f => ({ ...f, company_org_nr: e.target.value }))} />
          </div>
          {error && (
            <div className="bg-[#fdf0f0] border border-[#f0b8b8] rounded-lg px-4 py-3 text-sm text-[#8b1a1a]">{error}</div>
          )}
          <button type="submit" disabled={loading}
            className="w-full h-11 bg-[#1e5235] hover:bg-[#1a3d28] text-white rounded-lg font-semibold text-sm transition-colors disabled:opacity-50">
            {loading ? 'Skapar byrå...' : 'Kom igång →'}
          </button>
        </form>
      </div>
    </div>
  )
}
