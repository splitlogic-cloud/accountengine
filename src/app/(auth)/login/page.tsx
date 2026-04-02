'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

type Mode = 'magic_link' | 'password' | 'signup'
type Step = 'input' | 'sent'

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('magic_link')
  const [step, setStep] = useState<Step>('input')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  async function handleMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` }
    })
    setLoading(false)
    if (error) { setError(error.message); return }
    setStep('sent')
  }

  async function handlePassword(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) { setError('Fel e-post eller lösenord'); return }
    router.push('/command')
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError(null)

    if (password.length < 8) {
      setLoading(false)
      setError('Lösenordet måste vara minst 8 tecken')
      return
    }
    if (password !== confirmPassword) {
      setLoading(false)
      setError('Lösenorden matchar inte')
      return
    }

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })

    setLoading(false)
    if (error) {
      setError(error.message)
      return
    }

    // If email confirmation is disabled in Supabase, user gets a session directly.
    if (data.session) {
      router.push('/setup')
      return
    }

    setStep('sent')
  }

  if (step === 'sent') {
    return (
      <div className="min-h-screen bg-[#f5f4f0] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-[#e2ddd5] w-full max-w-md p-10 text-center shadow-sm">
          <div className="text-5xl mb-5">📬</div>
          <h2 className="text-xl font-semibold text-[#1a1814] mb-2">Kolla din e-post</h2>
          <p className="text-sm text-[#7a7570] mb-6">
            Vi skickade en inloggningslänk till <strong>{email}</strong>.<br />
            Länken är giltig i 10 minuter.
          </p>
          <button onClick={() => setStep('input')} className="text-sm text-[#1e5235] font-medium hover:underline">
            ← Tillbaka
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f5f4f0] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-[#e2ddd5] w-full max-w-md overflow-hidden shadow-sm">
        <div className="bg-gradient-to-br from-[#112a1a] to-[#1a3d28] px-8 py-7 text-center">
          <div className="inline-flex items-center gap-2.5 mb-1">
            <div className="w-8 h-8 bg-white/15 rounded-lg flex items-center justify-center border border-white/15">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <rect x="2" y="2" width="5" height="5" rx="1.5" fill="white"/>
                <rect x="9" y="2" width="5" height="5" rx="1.5" fill="white" opacity=".5"/>
                <rect x="2" y="9" width="5" height="5" rx="1.5" fill="white" opacity=".5"/>
                <rect x="9" y="9" width="5" height="5" rx="1.5" fill="white"/>
              </svg>
            </div>
            <span className="text-xl font-semibold text-white tracking-tight" style={{ fontFamily: 'Georgia, serif' }}>
              AccountEngine
            </span>
          </div>
          <p className="text-[#a8d8bc] text-sm mt-2">Logga in på byrå-portalen</p>
        </div>

        <div className="p-8">
          <div className="flex bg-[#f5f2ec] rounded-lg p-1 mb-6">
            {(['magic_link', 'password', 'signup'] as Mode[]).map((m) => (
              <button key={m}
                onClick={() => { setMode(m); setError(null) }}
                className={`flex-1 h-8 rounded-md text-sm font-medium transition-all ${
                  mode === m ? 'bg-white text-[#1a1814] shadow-sm' : 'text-[#7a7570] hover:text-[#4a463f]'
                }`}>
                {m === 'magic_link' ? 'Magic Link' : m === 'password' ? 'Lösenord' : 'Skapa konto'}
              </button>
            ))}
          </div>

          <form
            onSubmit={
              mode === 'magic_link'
                ? handleMagicLink
                : mode === 'password'
                  ? handlePassword
                  : handleSignup
            }
            className="space-y-4"
          >
            <div>
              <label className="block text-xs font-semibold text-[#7a7570] uppercase tracking-wider mb-1.5">
                E-postadress
              </label>
              <input
                type="email" required autoFocus
                value={email} onChange={e => setEmail(e.target.value)}
                placeholder="jonas@jojobiz.se"
                className="w-full h-11 px-3.5 border border-[#cdc8be] rounded-xl text-sm outline-none transition-colors focus:border-[#3d9467] focus:ring-2 focus:ring-[#3d9467]/10"
              />
            </div>
            {mode === 'password' && (
              <div>
                <div className="flex justify-between mb-1.5">
                  <label className="text-xs font-semibold text-[#7a7570] uppercase tracking-wider">Lösenord</label>
                  <button type="button" className="text-xs text-[#1e5235] font-medium hover:underline"
                    onClick={async () => {
                      if (!email) { setError('Ange e-post först'); return }
                      await supabase.auth.resetPasswordForEmail(email, {
                        redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`
                      })
                      setStep('sent')
                    }}>
                    Glömt lösenord?
                  </button>
                </div>
                <input type="password" required
                  value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full h-11 px-3.5 border border-[#cdc8be] rounded-xl text-sm outline-none transition-colors focus:border-[#3d9467] focus:ring-2 focus:ring-[#3d9467]/10"
                />
              </div>
            )}
            {mode === 'signup' && (
              <>
                <div>
                  <label className="block text-xs font-semibold text-[#7a7570] uppercase tracking-wider mb-1.5">
                    Lösenord
                  </label>
                  <input type="password" required minLength={8}
                    value={password} onChange={e => setPassword(e.target.value)}
                    placeholder="Minst 8 tecken"
                    className="w-full h-11 px-3.5 border border-[#cdc8be] rounded-xl text-sm outline-none transition-colors focus:border-[#3d9467] focus:ring-2 focus:ring-[#3d9467]/10"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#7a7570] uppercase tracking-wider mb-1.5">
                    Bekräfta lösenord
                  </label>
                  <input type="password" required minLength={8}
                    value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                    placeholder="Upprepa lösenord"
                    className="w-full h-11 px-3.5 border border-[#cdc8be] rounded-xl text-sm outline-none transition-colors focus:border-[#3d9467] focus:ring-2 focus:ring-[#3d9467]/10"
                  />
                </div>
              </>
            )}
            {error && (
              <div className="bg-[#fdf0f0] border border-[#f0b8b8] rounded-xl px-4 py-3 text-sm text-[#8b1a1a]">
                {error}
              </div>
            )}
            <button type="submit" disabled={loading}
              className="w-full h-11 bg-[#1e5235] hover:bg-[#1a3d28] text-white rounded-xl font-semibold text-sm transition-colors disabled:opacity-50">
              {loading
                ? 'Skickar...'
                : mode === 'magic_link'
                  ? 'Skicka inloggningslänk'
                  : mode === 'password'
                    ? 'Logga in'
                    : 'Skapa konto'}
            </button>
          </form>

          <p className="text-center text-xs text-[#b0aba4] mt-6">
            Har du inget konto? Kontakta din byråadmin.
          </p>
        </div>
      </div>
    </div>
  )
}
