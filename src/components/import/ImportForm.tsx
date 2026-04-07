'use client'

import { useState, useRef } from 'react'
import { useRouter }        from 'next/navigation'

interface Props {
  companyId: string
}

interface PreviewTx {
  source_id:      string
  event_type:     string
  occurred_at:    string
  amount:         number
  currency:       string
  description:    string
  customer_country?: string
  tax_treatment:  string
  vat_rate:       number
  tax_confidence: string
  tax_reason:     string
}

interface PreviewResult {
  ok:           boolean
  preview:      boolean
  transactions: PreviewTx[]
  total:        number
  errors:       string[]
  summary: {
    by_treatment: Record<string, number>
    by_currency:  Record<string, number>
    total_amount: number
  }
}

const SOURCES = [
  {
    id:   'stripe',
    name: 'Stripe',
    icon: '💳',
    color: 'bg-[#635bff]',
    instructions: [
      'Gå till Stripe Dashboard → Rapporter → Balanshistorik',
      'Välj datumintervall → Exportera som CSV',
      'Ladda upp filen nedan',
    ],
    accept: '.csv',
  },
  {
    id:   'shopify',
    name: 'Shopify',
    icon: '🛍️',
    color: 'bg-[#96bf48]',
    instructions: [
      'Gå till Shopify Admin → Betalningar → Shopify Payments → Utbetalningar',
      'ELLER: Admin → Orders → Exportera som CSV',
      'Ladda upp filen nedan (.csv eller .json)',
    ],
    accept: '.csv,.json',
  },
  {
    id:   'paypal',
    name: 'PayPal',
    icon: '🅿️',
    color: 'bg-[#003087]',
    instructions: [
      'Gå till PayPal → Aktivitet → Alla transaktioner',
      'Klicka "Ladda ned aktivitet" → Välj period → CSV',
      'Ladda upp filen nedan',
    ],
    accept: '.csv',
  },
]

const TREATMENT_LABELS: Record<string, { label: string; color: string }> = {
  domestic_vat:            { label: 'SE moms',        color: 'bg-[#dcfce7] text-[#15803d]' },
  eu_oss:                  { label: 'EU OSS',          color: 'bg-[#eff6ff] text-[#2563eb]' },
  eu_b2b_reverse_charge:   { label: 'Reverse charge',  color: 'bg-[#ede9fe] text-[#6d28d9]' },
  export_outside_eu:       { label: 'Export 0%',       color: 'bg-[#f1f5f9] text-[#475569]' },
  outside_scope:           { label: 'Ej momspliktig',  color: 'bg-[#f1f5f9] text-[#475569]' },
  unknown:                 { label: 'Granskas',        color: 'bg-[#fef9c3] text-[#854d0e]' },
}

export function ImportForm({ companyId }: Props) {
  const router            = useRouter()
  const [source, setSource] = useState<string | null>(null)
  const [file,   setFile]   = useState<File | null>(null)
  const [step,   setStep]   = useState<'choose' | 'upload' | 'preview' | 'done'>('choose')
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [result,  setResult]  = useState<{ created: number; skipped: number } | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const fileRef               = useRef<HTMLInputElement>(null)

  const selectedSource = SOURCES.find(s => s.id === source)

  async function handlePreview() {
    if (!file || !source) return
    setLoading(true)
    setError(null)

    const fd = new FormData()
    fd.append('file',       file)
    fd.append('company_id', companyId)
    fd.append('source',     source)
    fd.append('preview',    'true')

    const res  = await fetch('/api/import', { method: 'POST', body: fd })
    const json = await res.json()

    if (!res.ok || !json.ok) {
      setError(json.error ?? json.errors?.[0] ?? 'Parsningsfel')
      setLoading(false)
      return
    }

    setPreview(json)
    setStep('preview')
    setLoading(false)
  }

  async function handleImport() {
    if (!file || !source) return
    setLoading(true)
    setError(null)

    const fd = new FormData()
    fd.append('file',       file)
    fd.append('company_id', companyId)
    fd.append('source',     source)
    fd.append('preview',    'false')

    const res  = await fetch('/api/import', { method: 'POST', body: fd })
    const json = await res.json()

    if (!res.ok) {
      setError(json.error ?? 'Import misslyckades')
      setLoading(false)
      return
    }

    setResult({ created: json.created, skipped: json.skipped })
    setStep('done')
    setLoading(false)
  }

  const fmt = (n: number) => n.toLocaleString('sv-SE', { minimumFractionDigits: 2 })

  // ── Step: Choose source ──────────────────────────────────────────────────
  if (step === 'choose') {
    return (
      <div>
        <p className="text-[13px] text-[#64748b] mb-4">Välj vilken plattform du importerar från:</p>
        <div className="grid grid-cols-3 gap-3">
          {SOURCES.map(s => (
            <button
              key={s.id}
              onClick={() => { setSource(s.id); setStep('upload') }}
              className="flex items-start gap-3 p-4 border-2 border-[#e2e8f0] rounded-[10px] hover:border-[#1a7a3c] hover:bg-[#e8f5ee] transition-all text-left"
            >
              <div className={`w-10 h-10 ${s.color} rounded-[8px] flex items-center justify-center text-xl shrink-0`}>
                {s.icon}
              </div>
              <div className="text-[13.5px] font-bold text-[#0f172a] mt-1">{s.name}</div>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Step: Upload ─────────────────────────────────────────────────────────
  if (step === 'upload' && selectedSource) {
    return (
      <div>
        <button
          onClick={() => { setStep('choose'); setFile(null); setError(null) }}
          className="flex items-center gap-1 text-[12px] text-[#64748b] hover:text-[#0f172a] mb-4 transition-colors"
        >
          ← Tillbaka
        </button>

        <div className="flex items-center gap-3 mb-5">
          <div className={`w-9 h-9 ${selectedSource.color} rounded-[8px] flex items-center justify-center text-xl`}>
            {selectedSource.icon}
          </div>
          <h2 className="text-[15px] font-bold">Importera från {selectedSource.name}</h2>
        </div>

        {/* Instructions */}
        <div className="bg-[#f8fafc] border border-[#e2e8f0] rounded-[8px] p-4 mb-4">
          <div className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider mb-2">Så här exporterar du filen</div>
          <ol className="space-y-1">
            {selectedSource.instructions.map((inst, i) => (
              <li key={i} className="flex items-start gap-2 text-[12.5px] text-[#334155]">
                <span className="text-[#1a7a3c] font-bold shrink-0">{i + 1}.</span>
                {inst}
              </li>
            ))}
          </ol>
        </div>

        {/* File drop zone */}
        <div
          onClick={() => fileRef.current?.click()}
          className={`border-2 border-dashed rounded-[10px] p-8 text-center cursor-pointer transition-all ${
            file
              ? 'border-[#1a7a3c] bg-[#e8f5ee]'
              : 'border-[#e2e8f0] hover:border-[#1a7a3c] hover:bg-[#f8fafc]'
          }`}
        >
          <input
            ref={fileRef}
            type="file"
            accept={selectedSource.accept}
            className="hidden"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div>
              <div className="text-2xl mb-1">📄</div>
              <div className="text-[14px] font-semibold text-[#155c2d]">{file.name}</div>
              <div className="text-[12px] text-[#64748b]">{(file.size / 1024).toFixed(1)} KB</div>
              <button
                onClick={e => { e.stopPropagation(); setFile(null) }}
                className="mt-2 text-[11.5px] text-[#dc2626] hover:underline"
              >
                Ta bort
              </button>
            </div>
          ) : (
            <div>
              <div className="text-3xl mb-2">📁</div>
              <div className="text-[14px] font-semibold text-[#334155]">Klicka för att välja fil</div>
              <div className="text-[12px] text-[#64748b] mt-1">
                {selectedSource.accept.replace(/\./g, '').toUpperCase().split(',').join(' eller ')} · max 10 MB
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-3 bg-[#fef2f2] border border-[#fecaca] rounded-[7px] px-4 py-3 text-[12.5px] text-[#b91c1c]">
            {error}
          </div>
        )}

        <button
          onClick={handlePreview}
          disabled={!file || loading}
          className="mt-4 w-full h-10 bg-[#1a7a3c] text-white text-[13.5px] font-semibold rounded-[8px] hover:bg-[#155c2d] transition-colors disabled:opacity-40"
        >
          {loading ? 'Läser fil...' : 'Förhandsvisa →'}
        </button>
      </div>
    )
  }

  // ── Step: Preview ────────────────────────────────────────────────────────
  if (step === 'preview' && preview) {
    return (
      <div>
        <button
          onClick={() => { setStep('upload'); setPreview(null) }}
          className="flex items-center gap-1 text-[12px] text-[#64748b] hover:text-[#0f172a] mb-4 transition-colors"
        >
          ← Tillbaka
        </button>

        <h2 className="text-[15px] font-bold mb-4">Förhandsgranskning — {preview.total} transaktioner</h2>

        {/* Summary */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="bg-white border border-[#e2e8f0] rounded-[8px] p-3 text-center shadow-sm">
            <div className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-1">Transaktioner</div>
            <div className="text-[22px] font-bold">{preview.total}</div>
          </div>
          <div className="bg-white border border-[#e2e8f0] rounded-[8px] p-3 text-center shadow-sm">
            <div className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-1">Totalt belopp</div>
            <div className="text-[18px] font-bold text-[#1a7a3c]">{fmt(preview.summary.total_amount)}</div>
          </div>
          <div className="bg-white border border-[#e2e8f0] rounded-[8px] p-3 shadow-sm col-span-2">
            <div className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-1.5">Momsbehandling</div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(preview.summary.by_treatment).map(([t, count]) => {
                const info = TREATMENT_LABELS[t] ?? { label: t, color: 'bg-[#f1f5f9] text-[#475569]' }
                return (
                  <span key={t} className={`text-[11px] font-semibold px-2 py-0.5 rounded-[4px] ${info.color}`}>
                    {info.label}: {count}
                  </span>
                )
              })}
            </div>
          </div>
        </div>

        {/* Warnings */}
        {(preview.summary.by_treatment['unknown'] ?? 0) > 0 && (
          <div className="bg-[#fffbeb] border border-[#fde68a] rounded-[8px] px-4 py-3 text-[12.5px] text-[#854d0e] mb-4">
            ⚠ {preview.summary.by_treatment['unknown'] ?? 0} transaktioner har okänt kundland och behöver granskas manuellt efter import.
          </div>
        )}

        {/* Transaction list */}
        <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden mb-4">
          <div className="grid gap-2 px-4 py-2 bg-[#f8fafc] border-b border-[#e2e8f0] text-[10px] font-bold text-[#64748b] uppercase tracking-wider"
            style={{ gridTemplateColumns: '1fr 80px 70px 90px 110px 80px' }}>
            <div>Beskrivning</div>
            <div>Typ</div>
            <div>Land</div>
            <div className="text-right">Belopp</div>
            <div>Momsbehandling</div>
            <div>Konfidens</div>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {preview.transactions.map((tx, i) => {
              const info = TREATMENT_LABELS[tx.tax_treatment] ?? { label: tx.tax_treatment, color: 'bg-[#f1f5f9] text-[#475569]' }
              return (
                <div key={i}
                  className="grid gap-2 px-4 py-2 border-b border-[#f1f5f9] last:border-b-0 items-center hover:bg-[#f8fafc]"
                  style={{ gridTemplateColumns: '1fr 80px 70px 90px 110px 80px' }}
                  title={tx.tax_reason}
                >
                  <div className="truncate">
                    <div className="text-[12.5px] font-medium text-[#0f172a] truncate">{tx.description}</div>
                    <div className="text-[11px] text-[#64748b] font-mono">{tx.occurred_at.split('T')[0]}</div>
                  </div>
                  <div className="text-[11px] text-[#64748b] font-mono truncate">{tx.event_type.replace(/^(stripe|shopify|paypal)_/, '')}</div>
                  <div className="text-[12px] font-mono text-[#64748b]">{tx.customer_country ?? '—'}</div>
                  <div className="text-right font-mono text-[12.5px] font-semibold">
                    {tx.currency} {fmt(tx.amount)}
                  </div>
                  <div>
                    <span className={`text-[10.5px] font-semibold px-1.5 py-0.5 rounded-[3px] ${info.color}`}>
                      {info.label}
                      {tx.vat_rate > 0 && ` ${tx.vat_rate}%`}
                    </span>
                  </div>
                  <div>
                    <span className={`text-[10.5px] font-semibold ${
                      tx.tax_confidence === 'high'   ? 'text-[#15803d]' :
                      tx.tax_confidence === 'medium' ? 'text-[#d97706]' :
                      'text-[#dc2626]'
                    }`}>
                      {tx.tax_confidence === 'high' ? '✓ Säker' : tx.tax_confidence === 'medium' ? '~ Osäker' : '⚠ Granskas'}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
          {preview.total > 50 && (
            <div className="px-4 py-2.5 text-center text-[12px] text-[#64748b] bg-[#f8fafc] border-t border-[#e2e8f0]">
              Visar 50 av {preview.total} transaktioner
            </div>
          )}
        </div>

        {error && (
          <div className="bg-[#fef2f2] border border-[#fecaca] rounded-[7px] px-4 py-3 text-[12.5px] text-[#b91c1c] mb-3">
            {error}
          </div>
        )}

        <div className="flex gap-3">
          <button
            onClick={() => setStep('upload')}
            className="flex-1 h-10 border border-[#e2e8f0] text-[13px] font-semibold text-[#334155] rounded-[8px] hover:bg-[#f1f5f9] transition-colors"
          >
            ← Välj annan fil
          </button>
          <button
            onClick={handleImport}
            disabled={loading}
            className="flex-1 h-10 bg-[#1a7a3c] text-white text-[13px] font-semibold rounded-[8px] hover:bg-[#155c2d] transition-colors disabled:opacity-50"
          >
            {loading ? 'Importerar...' : `Importera ${preview.total} transaktioner →`}
          </button>
        </div>
      </div>
    )
  }

  // ── Step: Done ───────────────────────────────────────────────────────────
  if (step === 'done' && result) {
    return (
      <div className="text-center py-6">
        <div className="text-4xl mb-3">✓</div>
        <h2 className="text-[17px] font-bold text-[#155c2d] mb-1">Import klar!</h2>
        <p className="text-[13px] text-[#64748b] mb-6">
          {result.created} nya events skapade · {result.skipped} dubbletter hoppades över
        </p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => { setStep('choose'); setFile(null); setPreview(null); setResult(null); setError(null) }}
            className="h-9 px-4 border border-[#e2e8f0] text-[13px] font-semibold text-[#334155] rounded-[7px] hover:bg-[#f1f5f9] transition-colors"
          >
            Importera fler
          </button>
          <button
            onClick={() => router.push(`/${companyId}/events`)}
            className="h-9 px-4 bg-[#1a7a3c] text-white text-[13px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors"
          >
            Visa events →
          </button>
        </div>
      </div>
    )
  }

  return null
}
