'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { postManualEntry, saveDraftEntry }           from '@/lib/actions/journal-actions'

// ── Types ──────────────────────────────────────────────────────────────────

interface Account {
  id:             string
  account_number: string
  name:           string
  account_type:   string
  normal_side:    string
}

interface JournalLine {
  id:             string
  side:           'debit' | 'credit'
  account_number: string
  account_name:   string
  amount:         string
}

interface Props {
  companyId:       string
  companyName:     string
  currency:        string
  accounts:        Account[]
  nextEntryNumber: string
  userId:          string
}

// ── Helpers ────────────────────────────────────────────────────────────────

function parseAmount(val: string): number {
  return parseFloat(val.replace(/\s/g, '').replace(',', '.')) || 0
}

function fmtAmt(n: number): string {
  if (n === 0) return ''
  return n.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

let _id = 0
function uid() { return String(++_id) }

function blank(side: 'debit' | 'credit' = 'debit'): JournalLine {
  return { id: uid(), side, account_number: '', account_name: '', amount: '' }
}

// ── Templates ──────────────────────────────────────────────────────────────

const TEMPLATES = [
  {
    id: 'avskrivning', label: 'Avskrivning', icon: '🏭', desc: '7820/1229',
    text: 'Avskrivning inventarier',
    lines: [
      { side: 'debit'  as const, account_number: '7820', account_name: 'Avskrivning inventarier' },
      { side: 'credit' as const, account_number: '1229', account_name: 'Ack. avskrivning' },
    ],
  },
  {
    id: 'periodisering', label: 'Periodisering', icon: '📅', desc: '1710/2990',
    text: 'Periodisering',
    lines: [
      { side: 'debit'  as const, account_number: '1710', account_name: 'Förutbetalda kostnader' },
      { side: 'credit' as const, account_number: '2990', account_name: 'Upplupna kostnader' },
    ],
  },
  {
    id: 'lon', label: 'Lönekörning', icon: '💼', desc: '7010/2710/2730/1930',
    text: 'Löneutbetalning',
    lines: [
      { side: 'debit'  as const, account_number: '7010', account_name: 'Löner tjänstemän' },
      { side: 'credit' as const, account_number: '2710', account_name: 'Personalskatt' },
      { side: 'credit' as const, account_number: '2730', account_name: 'Arbetsgivaravgifter' },
      { side: 'credit' as const, account_number: '1930', account_name: 'Företagskonto' },
    ],
  },
  {
    id: 'valuta', label: 'Valutadiff.', icon: '💱', desc: '1930/3960',
    text: 'Valutakursdifferens',
    lines: [
      { side: 'debit'  as const, account_number: '1930', account_name: 'Företagskonto' },
      { side: 'credit' as const, account_number: '3960', account_name: 'Valutakursvinst' },
    ],
  },
]

// ── AccountPicker ──────────────────────────────────────────────────────────
// FIX: fully uncontrolled local state — parent only gets callbacks, never
// re-renders the input. This is what fixes the "one character at a time" bug.

function AccountPicker({
  accounts,
  initialValue,
  onSelect,
  onQueryChange,
  inputRef,
}: {
  accounts:      Account[]
  initialValue:  string
  onSelect:      (num: string, name: string) => void
  onQueryChange: (q: string) => void
  inputRef?:     React.RefObject<HTMLInputElement>
}) {
  const [query, setQuery]   = useState(initialValue)
  const [open,  setOpen]    = useState(false)
  const localRef            = useRef<HTMLInputElement>(null)
  const ref                 = inputRef ?? localRef

  // Sync if parent resets (template change) — only if value actually differs
  useEffect(() => {
    if (initialValue !== query) {
      setQuery(initialValue)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue])

  const filtered = query.length === 0 ? [] : accounts.filter(a =>
    a.account_number.startsWith(query) ||
    a.name.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 10)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    setQuery(v)
    onQueryChange(v)
    setOpen(true)
  }

  function handleSelect(num: string, name: string) {
    setQuery(num)
    onSelect(num, name)
    setOpen(false)
  }

  return (
    <div className="relative">
      <input
        ref={ref}
        className="w-full h-8 px-2.5 border border-[#e2e8f0] rounded-[6px] text-[13px] font-mono outline-none focus:border-[#1a7a3c] focus:ring-2 focus:ring-[#1a7a3c]/10 bg-white transition-all"
        value={query}
        placeholder="Konto"
        autoComplete="off"
        onChange={handleChange}
        onFocus={() => query.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        onKeyDown={e => {
          if (e.key === 'Escape') setOpen(false)
          if (e.key === 'Enter' && filtered.length === 1) {
            e.preventDefault()
            handleSelect(filtered[0]!.account_number, filtered[0]!.name)
          }
        }}
      />
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 z-50 mt-0.5 bg-white border border-[#e2e8f0] rounded-[8px] shadow-2xl overflow-hidden"
          style={{ minWidth: '280px' }}>
          {filtered.map(a => (
            <button
              key={a.id}
              type="button"
              className="w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-[#e8f5ee] transition-colors"
              onMouseDown={e => { e.preventDefault(); handleSelect(a.account_number, a.name) }}
            >
              <span className="font-mono text-[12.5px] font-bold text-[#0f172a] w-11 shrink-0">{a.account_number}</span>
              <span className="text-[12.5px] text-[#334155] truncate">{a.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── VoucherForm ────────────────────────────────────────────────────────────

export function VoucherForm({ companyId, companyName, currency, accounts, nextEntryNumber, userId }: Props) {
  const today = new Date().toISOString().split('T')[0]!

  const [description, setDescription] = useState('')
  const [date,        setDate]         = useState(today)
  const [series,      setSeries]       = useState('VER — Generell')
  const [lines,       setLines]        = useState<JournalLine[]>([blank('debit'), blank('credit')])
  const [status,      setStatus]       = useState<'idle' | 'saving' | 'posting' | 'posted' | 'saved'>('idle')
  const [posted,      setPosted]       = useState<{ entry_number: string } | null>(null)
  const [error,       setError]        = useState<string | null>(null)

  // Template reset key — incrementing this forces AccountPickers to re-sync
  const [resetKey, setResetKey] = useState(0)

  const totalDebit  = lines.filter(l => l.side === 'debit').reduce((s, l) => s + parseAmount(l.amount), 0)
  const totalCredit = lines.filter(l => l.side === 'credit').reduce((s, l) => s + parseAmount(l.amount), 0)
  const diff        = Math.abs(totalDebit - totalCredit)
  const balanced    = diff < 0.005 && totalDebit > 0

  const updateLine = useCallback((id: string, patch: Partial<JournalLine>) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l))
  }, [])

  function addLine() {
    setLines(prev => [...prev, blank('debit')])
  }

  function removeLine(id: string) {
    setLines(prev => prev.length > 2 ? prev.filter(l => l.id !== id) : prev)
  }

  function loadTemplate(tmpl: typeof TEMPLATES[number]) {
    setDescription(tmpl.text)
    setLines(tmpl.lines.map(l => ({ ...l, id: uid(), amount: '' })))
    setResetKey(k => k + 1)  // force AccountPickers to re-sync
    setError(null)
  }

  function buildDTO() {
    return {
      company_id:  companyId,
      entry_date:  date,
      description: description.trim(),
      source:      'manual' as const,
      lines:       lines.map(l => ({
        side:           l.side,
        account_number: l.account_number,
        amount:         parseAmount(l.amount),
        description:    undefined,
      })),
    }
  }

  async function handleDraft() {
    if (!description.trim()) { setError('Ange verifikationstext.'); return }
    setStatus('saving'); setError(null)
    try {
      await saveDraftEntry(buildDTO(), userId)
      setStatus('saved')
      setTimeout(() => setStatus('idle'), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fel vid sparande')
      setStatus('idle')
    }
  }

  async function handlePost() {
    if (!balanced)          { setError('Verifikatet balanserar inte.'); return }
    if (!description.trim()) { setError('Ange verifikationstext.'); return }
    const emptyAccount = lines.find(l => !l.account_number)
    if (emptyAccount)       { setError('Alla rader måste ha ett konto.'); return }

    setStatus('posting'); setError(null)
    try {
      const result = await postManualEntry(buildDTO(), userId)
      setPosted(result)
      setStatus('posted')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fel vid postning')
      setStatus('idle')
    }
  }

  function reset() {
    setDescription(''); setDate(today)
    setLines([blank('debit'), blank('credit')])
    setPosted(null); setStatus('idle'); setError(null)
    setResetKey(k => k + 1)
  }

  // ── Posted confirmation ──────────────────────────────────────────────────

  if (status === 'posted' && posted) {
    return (
      <div className="max-w-3xl bg-[#e8f5ee] border border-[#b8ddc9] rounded-[10px] p-8 text-center">
        <div className="text-3xl mb-2">✓</div>
        <div className="text-[17px] font-bold text-[#155c2d] mb-1">{posted.entry_number} bokförd</div>
        <div className="text-[13px] text-[#334155] mb-6">{description} · {fmtAmt(totalDebit)} {currency}</div>
        <div className="flex justify-center gap-3">
          <button
            onClick={() => { window.location.href = `/${companyId}/ledger` }}
            className="h-9 px-4 border border-[#b8ddc9] text-[#155c2d] text-[13px] font-semibold rounded-[7px] hover:bg-white transition-colors"
          >
            Visa i huvudbok
          </button>
          <button
            onClick={reset}
            className="h-9 px-4 bg-[#1a7a3c] text-white text-[13px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors"
          >
            Nytt verifikat
          </button>
        </div>
      </div>
    )
  }

  // ── Main form ────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl">
      {/* Templates */}
      <div className="flex gap-2 flex-wrap mb-4">
        {TEMPLATES.map(t => (
          <button
            key={t.id}
            type="button"
            onClick={() => loadTemplate(t)}
            className="flex items-center gap-2 px-3 py-2 border border-[#e2e8f0] bg-white rounded-[8px] hover:border-[#1a7a3c] hover:bg-[#e8f5ee] transition-all text-left"
          >
            <span>{t.icon}</span>
            <div>
              <div className="text-[12.5px] font-semibold text-[#0f172a]">{t.label}</div>
              <div className="text-[11px] text-[#64748b] font-mono">{t.desc}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden">

        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 bg-[#e8f5ee] border-b border-[#b8ddc9]">
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#155c2d" strokeWidth="1.7"><path d="M8 3v10M3 8h10"/></svg>
          <span className="text-[14px] font-bold text-[#155c2d]">Nytt verifikat</span>
          <span className="ml-auto text-[11.5px] font-mono text-[#64748b]">{nextEntryNumber}</span>
        </div>

        {/* Meta row */}
        <div className="grid gap-3 px-5 py-4 border-b border-[#e2e8f0]"
          style={{ gridTemplateColumns: '130px 1fr 140px 170px' }}>
          <div>
            <label className="block text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider mb-1">Datum</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full h-8 px-2.5 border border-[#e2e8f0] rounded-[6px] text-[13px] outline-none focus:border-[#1a7a3c] bg-white transition-all"
            />
          </div>
          <div>
            <label className="block text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider mb-1">Text *</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Beskriv affärshändelsen..."
              className="w-full h-8 px-2.5 border border-[#e2e8f0] rounded-[6px] text-[13px] outline-none focus:border-[#1a7a3c] bg-white transition-all"
            />
          </div>
          <div>
            <label className="block text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider mb-1">Valuta</label>
            <input
              value={currency}
              readOnly
              className="w-full h-8 px-2.5 border border-[#e2e8f0] rounded-[6px] text-[13px] bg-[#f8fafc] text-[#64748b]"
            />
          </div>
          <div>
            <label className="block text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider mb-1">Verifikationsserie</label>
            <select
              value={series}
              onChange={e => setSeries(e.target.value)}
              className="w-full h-8 px-2.5 border border-[#e2e8f0] rounded-[6px] text-[13px] bg-white outline-none focus:border-[#1a7a3c] transition-all"
            >
              <option>VER — Generell</option>
              <option>LON — Lön</option>
              <option>AVS — Avskrivning</option>
              <option>MOM — Moms</option>
            </select>
          </div>
        </div>

        {/* Lines table */}
        <div>
          {/* Header */}
          <div
            className="grid gap-2 px-5 py-2 bg-[#f8fafc] border-b border-[#e2e8f0] text-[10px] font-bold text-[#64748b] uppercase tracking-wider"
            style={{ gridTemplateColumns: '90px 140px 1fr 130px 130px 32px' }}
          >
            <div>D / K</div>
            <div>Konto</div>
            <div>Kontonamn</div>
            <div className="text-right">Debet ({currency})</div>
            <div className="text-right">Kredit ({currency})</div>
            <div />
          </div>

          {/* Lines */}
          {lines.map((line) => (
            <div
              key={line.id}
              className="grid gap-2 px-5 py-1.5 border-b border-[#f1f5f9] last:border-b-0 items-center hover:bg-[#fafcfe]"
              style={{ gridTemplateColumns: '90px 140px 1fr 130px 130px 32px' }}
            >
              {/* D/K toggle */}
              <select
                value={line.side}
                onChange={e => updateLine(line.id, { side: e.target.value as 'debit' | 'credit' })}
                className="h-8 px-2 border border-[#e2e8f0] rounded-[6px] text-[12.5px] bg-white outline-none focus:border-[#1a7a3c] transition-all cursor-pointer"
              >
                <option value="debit">Debet</option>
                <option value="credit">Kredit</option>
              </select>

              {/* Account picker — key={resetKey} forces full remount on template change */}
              <AccountPicker
                key={`acc-${line.id}-${resetKey}`}
                accounts={accounts}
                initialValue={line.account_number}
                onSelect={(num, name) => updateLine(line.id, { account_number: num, account_name: name })}
                onQueryChange={q => updateLine(line.id, { account_number: q })}
              />

              {/* Account name (editable) */}
              <input
                value={line.account_name}
                onChange={e => updateLine(line.id, { account_name: e.target.value })}
                placeholder="Kontonamn"
                className="h-8 px-2.5 border border-[#e2e8f0] rounded-[6px] text-[13px] outline-none focus:border-[#1a7a3c] bg-white transition-all"
              />

              {/* Debit amount */}
              <input
                value={line.side === 'debit' ? line.amount : ''}
                onChange={e => { if (line.side === 'debit') updateLine(line.id, { amount: e.target.value }) }}
                onFocus={e => { if (line.side === 'credit') { updateLine(line.id, { side: 'debit', amount: '' }); } }}
                placeholder={line.side === 'debit' ? '0,00' : ''}
                readOnly={line.side === 'credit'}
                className={`h-8 px-2.5 border border-[#e2e8f0] rounded-[6px] text-[13px] text-right font-mono outline-none focus:border-[#1a7a3c] transition-all ${line.side === 'credit' ? 'bg-[#f8fafc] text-[#94a3b8]' : 'bg-white'}`}
              />

              {/* Credit amount */}
              <input
                value={line.side === 'credit' ? line.amount : ''}
                onChange={e => { if (line.side === 'credit') updateLine(line.id, { amount: e.target.value }) }}
                onFocus={e => { if (line.side === 'debit') { updateLine(line.id, { side: 'credit', amount: '' }) } }}
                placeholder={line.side === 'credit' ? '0,00' : ''}
                readOnly={line.side === 'debit'}
                className={`h-8 px-2.5 border border-[#e2e8f0] rounded-[6px] text-[13px] text-right font-mono outline-none focus:border-[#1a7a3c] transition-all ${line.side === 'debit' ? 'bg-[#f8fafc] text-[#94a3b8]' : 'bg-white'}`}
              />

              {/* Remove */}
              <button
                type="button"
                onClick={() => removeLine(line.id)}
                disabled={lines.length <= 2}
                className="h-8 w-8 flex items-center justify-center rounded-[6px] text-[#94a3b8] hover:text-[#dc2626] hover:bg-[#fef2f2] transition-all disabled:opacity-20 disabled:cursor-not-allowed text-[16px]"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {/* Add row */}
        <button
          type="button"
          onClick={addLine}
          className="w-full flex items-center gap-2 px-5 py-2.5 text-[12.5px] font-semibold text-[#1a7a3c] hover:bg-[#e8f5ee] border-t border-[#e2e8f0] transition-colors"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 2v10M2 7h10"/></svg>
          Lägg till rad
          <span className="text-[11px] text-[#94a3b8] font-normal ml-1">Tab = nästa fält</span>
        </button>

        {/* Balance bar */}
        <div className="flex items-center justify-between px-5 py-3 bg-[#f8fafc] border-t border-[#e2e8f0]">
          <div className="flex gap-6 text-[12px]">
            <span className="text-[#64748b]">Debet <strong className="font-mono text-[#0f172a] ml-1">{fmtAmt(totalDebit) || '0,00'}</strong></span>
            <span className="text-[#64748b]">Kredit <strong className="font-mono text-[#0f172a] ml-1">{fmtAmt(totalCredit) || '0,00'}</strong></span>
            {diff > 0.005 && totalDebit > 0 && (
              <span className="text-[#dc2626]">Differens <strong className="font-mono ml-1">{fmtAmt(diff)}</strong></span>
            )}
          </div>
          <span className={`text-[12px] font-semibold px-3 py-1 rounded-[5px] ${
            balanced ? 'bg-[#dcfce7] text-[#15803d]' : totalDebit > 0 ? 'bg-[#fee2e2] text-[#b91c1c]' : 'bg-[#f1f5f9] text-[#475569]'
          }`}>
            {balanced ? '✓ Balanserar' : totalDebit > 0 ? '⚠ Balanserar ej' : 'Fyll i belopp'}
          </span>
        </div>

        {/* Error */}
        {error && (
          <div className="px-5 py-2.5 bg-[#fef2f2] border-t border-[#fecaca] text-[12.5px] text-[#b91c1c] font-medium">
            {error}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center gap-2 px-5 py-3 border-t border-[#e2e8f0] bg-[#f8fafc]">
          <button
            type="button"
            onClick={handleDraft}
            disabled={status !== 'idle'}
            className="h-9 px-4 border border-[#e2e8f0] bg-white text-[13px] font-semibold text-[#334155] rounded-[7px] hover:bg-[#f1f5f9] transition-colors disabled:opacity-50"
          >
            {status === 'saved' ? '✓ Sparat' : status === 'saving' ? 'Sparar...' : 'Spara utkast'}
          </button>

          <button
            type="button"
            className="h-9 px-4 border border-[#e2e8f0] bg-white text-[13px] font-semibold text-[#334155] rounded-[7px] hover:bg-[#f1f5f9] transition-colors"
          >
            Bifoga dokument
          </button>

          <div className="flex-1" />

          <button
            type="button"
            onClick={handlePost}
            disabled={!balanced || !description.trim() || status === 'posting' || status === 'saving'}
            className="h-9 px-5 bg-[#1a7a3c] text-white text-[13px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {status === 'posting' ? (
              <><span className="animate-spin inline-block">⟳</span> Bokför...</>
            ) : (
              'Bokför →'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
