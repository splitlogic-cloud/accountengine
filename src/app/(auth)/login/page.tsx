'use client'

import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'

export default function LoginPage() {
  const [email,     setEmail]     = useState('')
  const [password,  setPassword]  = useState('')
  const [mode,      setMode]      = useState<'magic' | 'password'>('magic')
  const [loading,   setLoading]   = useState(false)
  const [message,   setMessage]   = useState<{ text: string; type: 'ok' | 'err' } | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setMessage(null)
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseAnonKey) {
      setMessage({ text: 'Supabase saknar konfiguration.', type: 'err' })
      setLoading(false)
      return
    }
    const supabase = createClient(supabaseUrl, supabaseAnonKey)

    if (mode === 'magic') {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}/auth/callback` },
      })
      if (error) {
        setMessage({ text: error.message, type: 'err' })
      } else {
        setMessage({ text: 'Kolla din e-post — vi har skickat en inloggningslänk.', type: 'ok' })
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setMessage({ text: 'Fel e-post eller lösenord.', type: 'err' })
      } else {
        window.location.href = '/dashboard'
      }
    }
    setLoading(false)
  }

  return (
    <div className="bg-white border border-[#e2e8f0] rounded-xl p-8 shadow-sm">
      <h1 className="text-[18px] font-bold text-[#0f172a] mb-1">Logga in</h1>
      <p className="text-[13px] text-[#64748b] mb-6">
        {mode === 'magic' ? 'Vi skickar en länk till din e-post.' : 'E-post och lösenord.'}
      </p>

      {message && (
        <div className={`text-[12.5px] font-medium px-3 py-2 rounded-lg mb-4 ${
          message.type === 'ok'
            ? 'bg-[#e8f5ee] text-[#155c2d]'
            : 'bg-[#fef2f2] text-[#b91c1c]'
        }`}>
          {message.text}
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider block mb-1">
            E-post
          </label>
          <input
            type="email"
            required
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="jonas@jojo.se"
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
              className="w-full h-[36px] px-3 border border-[#e2e8f0] rounded-lg text-[13.5px] outline-none focus:border-[#1a7a3c] focus:ring-2 focus:ring-[#1a7a3c]/10 transition-all"
            />
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !email}
          className="h-[36px] bg-[#1a7a3c] text-white text-[13px] font-semibold rounded-lg hover:bg-[#155c2d] transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-1"
        >
          {loading ? 'Skickar...' : mode === 'magic' ? 'Skicka inloggningslänk' : 'Logga in'}
        </button>
      </form>

      <button
        onClick={() => setMode(mode === 'magic' ? 'password' : 'magic')}
        className="mt-4 text-[12.5px] text-[#64748b] hover:text-[#0f172a] w-full text-center transition-colors"
      >
        {mode === 'magic' ? 'Logga in med lösenord istället' : 'Använd magic link istället'}
      </button>
    </div>
  )
}
