'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type AuthTab = 'login' | 'signup'

function LoginForm() {
  const searchParams = useSearchParams()
  const [email,           setEmail]           = useState('')
  const [password,        setPassword]        = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [tab,             setTab]             = useState<AuthTab>('login')
  const [mode,            setMode]            = useState<'magic' | 'password'>('magic')
  const [loading,         setLoading]         = useState(false)
  const [message,         setMessage]         = useState<{ text: string; type: 'ok' | 'err' } | null>(null)

  const supabase = createClient()

  useEffect(() => {
    const err = searchParams.get('error')
    if (err) {
      setMessage({ text: decodeURIComponent(err.replace(/\+/g, ' ')), type: 'err' })
    }
  }, [searchParams])

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    if (mode === 'magic') {
      const redirectTo =
        typeof window !== 'undefined' ? `${window.location.origin}/callback` : ''
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo },
      })
      if (error) {
        setMessage({ text: error.message, type: 'err' })
      } else {
        setMessage({ text: 'Kolla din e-post — vi har skickat en inloggningslänk.', type: 'ok' })
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setMessage({
          text:
            error.message === 'Invalid login credentials'
              ? 'Fel e-post eller lösenord.'
              : error.message,
          type: 'err',
        })
      } else {
        window.location.href = '/dashboard'
      }
    }
    setLoading(false)
  }

  async function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)

    if (password.length < 6) {
      setMessage({ text: 'Lösenordet måste vara minst 6 tecken.', type: 'err' })
      setLoading(false)
      return
    }
    if (password !== confirmPassword) {
      setMessage({ text: 'Lösenorden matchar inte.', type: 'err' })
      setLoading(false)
      return
    }

    const res = await fetch('/api/auth/signup', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    })
    const json = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean }

    if (!res.ok || json.error) {
      setMessage({ text: json.error ?? 'Kunde inte skapa konto.', type: 'err' })
      setLoading(false)
      return
    }

    const { error: signErr } = await supabase.auth.signInWithPassword({ email, password })
    if (signErr) {
      setMessage({
        text:
          'Kontot skapades men inloggning misslyckades. Prova logga in med lösenord.',
        type: 'err',
      })
      setLoading(false)
      return
    }

    window.location.href = '/dashboard'
  }

  return (
    <div className="bg-white border border-[#e2e8f0] rounded-xl p-8 shadow-sm">
      <h1 className="text-[18px] font-bold text-[#0f172a] mb-1">
        {tab === 'login' ? 'Logga in' : 'Skapa konto'}
      </h1>
      <p className="text-[13px] text-[#64748b] mb-5">
        {tab === 'login'
          ? mode === 'magic'
            ? 'Vi skickar en länk till din e-post.'
            : 'E-post och lösenord.'
          : 'E-post och lösenord — du loggas in direkt.'}
      </p>

      <div className="flex rounded-lg border border-[#e2e8f0] p-0.5 mb-6">
        <button
          type="button"
          onClick={() => { setTab('login'); setMessage(null) }}
          className={`flex-1 py-2 text-[13px] font-semibold rounded-md transition-colors ${
            tab === 'login' ? 'bg-[#1a7a3c] text-white' : 'text-[#64748b] hover:text-[#0f172a]'
          }`}
        >
          Logga in
        </button>
        <button
          type="button"
          onClick={() => { setTab('signup'); setMessage(null) }}
          className={`flex-1 py-2 text-[13px] font-semibold rounded-md transition-colors ${
            tab === 'signup' ? 'bg-[#1a7a3c] text-white' : 'text-[#64748b] hover:text-[#0f172a]'
          }`}
        >
          Skapa konto
        </button>
      </div>

      {message && (
        <div
          className={`text-[12.5px] font-medium px-3 py-2 rounded-lg mb-4 ${
            message.type === 'ok'
              ? 'bg-[#e8f5ee] text-[#155c2d]'
              : 'bg-[#fef2f2] text-[#b91c1c]'
          }`}
        >
          {message.text}
        </div>
      )}

      {tab === 'login' && (
        <>
          <form onSubmit={handleLogin} className="flex flex-col gap-3">
            <div>
              <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider block mb-1">
                E-post
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="du@foretag.se"
                autoComplete="email"
                className="w-full h-[36px] px-3 border border-[#e2e8f0] rounded-lg text-[13.5px] outline-none focus:border-[#1a7a3c] focus:ring-2 focus:ring-[#1a7a3c]/10 transition-all"
              />
            </div>

            {mode === 'password' && (
              <div>
                <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider block mb-1">
                  Lösenord
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  autoComplete="current-password"
                  className="w-full h-[36px] px-3 border border-[#e2e8f0] rounded-lg text-[13.5px] outline-none focus:border-[#1a7a3c] focus:ring-2 focus:ring-[#1a7a3c]/10 transition-all"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !email || (mode === 'password' && !password)}
              className="h-[36px] bg-[#1a7a3c] text-white text-[13px] font-semibold rounded-lg hover:bg-[#155c2d] transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-1"
            >
              {loading ? 'Skickar...' : mode === 'magic' ? 'Skicka inloggningslänk' : 'Logga in'}
            </button>
          </form>

          <button
            type="button"
            onClick={() => { setMode(mode === 'magic' ? 'password' : 'magic'); setMessage(null) }}
            className="mt-4 text-[12.5px] text-[#64748b] hover:text-[#0f172a] w-full text-center transition-colors"
          >
            {mode === 'magic' ? 'Logga in med lösenord istället' : 'Använd magic link istället'}
          </button>
        </>
      )}

      {tab === 'signup' && (
        <form onSubmit={handleSignup} className="flex flex-col gap-3">
          <div>
            <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider block mb-1">
              E-post
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="du@foretag.se"
              autoComplete="email"
              className="w-full h-[36px] px-3 border border-[#e2e8f0] rounded-lg text-[13.5px] outline-none focus:border-[#1a7a3c] focus:ring-2 focus:ring-[#1a7a3c]/10 transition-all"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider block mb-1">
              Lösenord
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full h-[36px] px-3 border border-[#e2e8f0] rounded-lg text-[13.5px] outline-none focus:border-[#1a7a3c] focus:ring-2 focus:ring-[#1a7a3c]/10 transition-all"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider block mb-1">
              Bekräfta lösenord
            </label>
            <input
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              autoComplete="new-password"
              className="w-full h-[36px] px-3 border border-[#e2e8f0] rounded-lg text-[13.5px] outline-none focus:border-[#1a7a3c] focus:ring-2 focus:ring-[#1a7a3c]/10 transition-all"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !email || !password}
            className="h-[36px] bg-[#1a7a3c] text-white text-[13px] font-semibold rounded-lg hover:bg-[#155c2d] transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-1"
          >
            {loading ? 'Skapar konto...' : 'Skapa konto'}
          </button>
        </form>
      )}
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="bg-white border border-[#e2e8f0] rounded-xl p-8 shadow-sm text-[13px] text-[#64748b]">
          Laddar…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  )
}
