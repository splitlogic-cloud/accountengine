'use client'

import { useState } from 'react'

interface Field {
  key:         string
  label:       string
  placeholder: string
  type:        'text' | 'password'
}

interface Props {
  companyId: string
  provider:  string
  fields:    Field[]
  existing:  Record<string, any> | null
  isActive:  boolean
}

export function ConnectForm({ companyId, provider, fields, existing, isActive }: Props) {
  const [open,    setOpen]    = useState(!isActive)
  const [values,  setValues]  = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const res = await fetch('/api/integrations', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ company_id: companyId, provider, config: values }),
    })

    const json = await res.json()
    if (!res.ok) {
      setError(json.error ?? 'Kunde inte spara integration.')
      setLoading(false)
      return
    }

    setSuccess(true)
    setLoading(false)
    setOpen(false)
    setTimeout(() => window.location.reload(), 1000)
  }

  async function handleDisconnect() {
    if (!confirm(`Koppla bort ${provider}? Events slutar importeras.`)) return
    setLoading(true)

    await fetch('/api/integrations', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ company_id: companyId, provider }),
    })

    window.location.reload()
  }

  if (success) {
    return (
      <div className="bg-[#e8f5ee] border border-[#b8ddc9] rounded-[7px] px-4 py-3 text-[13px] text-[#155c2d] font-semibold">
        ✓ {provider} ansluten! Events importeras automatiskt från nu.
      </div>
    )
  }

  return (
    <div>
      {isActive ? (
        <div className="flex items-center gap-3">
          <div className="text-[12.5px] text-[#64748b]">
            Ansluten · events importeras automatiskt
          </div>
          <button
            onClick={() => setOpen(!open)}
            className="h-7 px-3 border border-[#e2e8f0] text-[12px] font-semibold text-[#334155] rounded-[6px] hover:bg-[#f1f5f9] transition-colors"
          >
            {open ? 'Avbryt' : 'Uppdatera nycklar'}
          </button>
          <button
            onClick={handleDisconnect}
            className="h-7 px-3 border border-[#fecaca] text-[12px] font-semibold text-[#dc2626] rounded-[6px] hover:bg-[#fef2f2] transition-colors"
          >
            Koppla bort
          </button>
        </div>
      ) : (
        <button
          onClick={() => setOpen(!open)}
          className="h-8 px-4 bg-[#1a7a3c] text-white text-[12.5px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors"
        >
          {open ? 'Avbryt' : `Anslut ${provider}`}
        </button>
      )}

      {open && (
        <form onSubmit={handleConnect} className="mt-4 border border-[#e2e8f0] rounded-[8px] p-4 bg-[#f8fafc] flex flex-col gap-3">
          {fields.map(field => (
            <div key={field.key}>
              <label className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider block mb-1">
                {field.label}
              </label>
              <input
                type={field.type}
                required
                value={values[field.key] ?? ''}
                onChange={e => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.placeholder}
                className="w-full h-9 px-3 border border-[#e2e8f0] rounded-[7px] text-[13px] font-mono bg-white outline-none focus:border-[#1a7a3c] transition-all"
              />
            </div>
          ))}

          {error && (
            <div className="text-[12px] text-[#b91c1c] bg-[#fef2f2] border border-[#fecaca] rounded-[6px] px-3 py-2">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="h-9 bg-[#1a7a3c] text-white text-[13px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors disabled:opacity-50"
          >
            {loading ? 'Sparar...' : 'Spara och anslut'}
          </button>
        </form>
      )}
    </div>
  )
}
