'use client'

import { useState, useCallback, useRef }    from 'react'
import { postManualEntry, saveDraftEntry }  from '@/lib/actions/journal-actions'

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
  description:    string
}

interface Props {
  companyId:       string
  companyName:     string
  currency:        string
  accounts:        Account[]
  nextEntryNumber: string
  userId:          string
}

// ── Templates ──────────────────────────────────────────────────────────────

const TEMPLATES = [
  {
    id:          'avskrivning',
    label:       'Avskrivning',
    icon:        '🏭',
    desc:        '7820 / 1229',
    text:        'Avskrivning inventarier',
    lines: [
      { side: 'debit'  as const, account_number: '7820', account_name: 'Avskrivning inventarier', amount: '', description: '' },
      { side: 'credit' as const, account_number: '1229', account_name: 'Ack. avskrivning inventarier', amount: '', description: '' },
    ],
  },
  {
    id:          'periodisering',
    label:       'Periodisering',
    icon:        '📅',
    desc:        '1710 / 2990',
    text:        'Periodisering',
    lines: [
      { side: 'debit'  as const, account_number: '1710', account_name: 'Förutbetalda kostnader', amount: '', description: '' },
      { side: 'credit' as const, account_number: '2990', account_name: 'Upplupna kostnader', amount: '', description: '' },
    ],
  },
  {
    id:          'lon',
    label:       'Lönekörning',
    icon:        '💼',
    desc:        '7010 / 2710 / 2730',
    text:        'Löneutbetalning',
    lines: [
      { side: 'debit'  as const, account_number: '7010', account_name: 'Löner tjänstemän', amount: '', description: 'Bruttolön' },
      { side: 'credit' as const, account_number: '2710', account_name: 'Personalskatt',   amount: '', description: 'Källskatt' },
      { side: 'credit' as const, account_number: '2730', account_name: 'Arbetsgivaravgifter', amount: '', description: 'Sociala avgifter' },
      { side: 'credit' as const, account_number: '1930', account_name: 'Företagskonto',   amount: '', description: 'Nettoutbetalning' },
    ],
  },
  {
    id:          'valutadiff',
    label:       'Valutadiff.',
    icon:        '💱',
    desc:        '3960 / 7960',
    text:        'Valutakursdifferens',
    lines: [
      { side: 'debit'  as const, account_number: '1930', account_name: 'Företagskonto', amount: '', description: '' },
      { side: 'credit' as const, account_number: '3960', account_name: 'Valutakursvinst', amount: '', description: '' },
    ],
  },
]

// ── Helpers ────────────────────────────────────────────────────────────────

function parseAmount(val: string): number {
  return parseFloat(val.replace(/\s/g, '').replace(',', '.')) || 0
}

function fmtAmount(n: number): string {
  if (n === 0) return ''
  return n.toFixed(2).replace('.', ',')
}

let idCounter = 100
function newId() { return String(++idCounter) }

function blankLine(): JournalLine {
  return {
    id:             newId(),
    side:           'debit',
    account_number: '',
    account_name:   '',
    amount:         '',
    description:    '',
  }
}

// ── AccountPicker ──────────────────────────────────────────────────────────

function AccountPicker({
  accounts,
  value,
  onChange,
}: {
  accounts: Account[]
  value:    string
  onChange: (num: string, name: string) => void
}) {
  const [open,   setOpen]   = useState(false)
  const [query,  setQuery]  = useState(value)
  const ref                 = useRef<HTMLDivElement>(null)

  const filtered = query.length < 1 ? [] : accounts.filter(a =>
    a.account_number.startsWith(query) ||
    a.name.toLowerCase().includes(query.toLowerCase())
  ).slice(0, 8)

  return (
    <div className="relative" ref={ref}>
      <input
        className="w-full h-8 px-2 border border-[#e2e8f0] rounded-[6px] text-[12.5px] font-mono outline-none focus:border-[#1a7a3c] focus:ring-2 focus:ring-[#1a7a3c]/10 transition-all"
        value={query}
        placeholder="Konto"
        onChange={e => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
      />
      {open && filtered.length > 0 && (
        <div className="absolute top-full left-0 right-0 bg-white border border-[#e2e8f0] rounded-[7px] shadow-xl z-50 mt-0.5 overflow-hidden">
          {filtered.map(a => (
            <button
              key={a.id}
              type="button"
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#f8fafc] transition-colors"
              onMouseDown={() => {
                onChange(a.account_number, a.name)
                setQuery(a.account_number)
                setOpen(false)
              }}
            >
              <span className="font-mono text-[12px] font-semibold text-[#0f172a] w-11 shrink-0">{a.account_number}</span>
              <span className="text-[12.5px] text-[#334155] truncate">{a.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ── VoucherForm ────────────────────────────────────────────────────────────

export function VoucherForm({
  companyId,
  companyName,
  currency,
  accounts,
  nextEntryNumber,
  userId,
}: Props) {
  const today = new Date().toISOString().split('T')[0]!

  const [description,  setDescription]  = useState('')
  const [date,         setDate]         = useState(today)
  const [series,       setSeries]       = useState('VER')
  const [lines,        setLines]        = useState<JournalLine[]>([
    { ...blankLine(), side: 'debit'  },
    { ...blankLine(), side: 'credit' },
  ])
  const [status,       setStatus]       = useState<'idle' | 'saving' | 'posting' | 'posted' | 'draft_saved'>('idle')
  const [postedEntry,  setPostedEntry]  = useState<{ entry_number: string } | null>(null)
  const [error,        setError]        = useState<string | null>(null)

  // Computed balance
  const totalDebit  = lines.filter(l => l.side === 'debit').reduce((s, l) => s + parseAmount(l.amount), 0)
  const totalCredit = lines.filter(l => l.side === 'credit').reduce((s, l) => s + parseAmount(l.amount), 0)
  const diff        = Math.abs(totalDebit - totalCredit)
  const balanced    = diff < 0.005 && totalDebit > 0

  // Line mutations
  const updateLine = useCallback((id: string, patch: Partial<JournalLine>) => {
    setLines(prev => prev.map(l => l.id === id ? { ...l, ...patch } : l))
  }, [])

  const addLine = useCallback(() => {
    setLines(prev => [...prev, blankLine()])
  }, [])

  const removeLine = useCallback((id: string) => {
    setLines(prev => {
      if (prev.length <= 2) return prev
      return prev.filter(l => l.id !== id)
    })
  }, [])

  // Load template
  function loadTemplate(tmpl: typeof TEMPLATES[number]) {
    setDescription(tmpl.text)
    setLines(tmpl.lines.map(l => ({ ...l, id: newId(), amount: '', description: l.description })))
  }

  // Build DTO
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
        description:    l.description || undefined,
      })),
    }
  }

  async function handleDraft() {
    setStatus('saving')
    setError(null)
    try {
      await saveDraftEntry(buildDTO(), userId)
      setStatus('draft_saved')
      setTimeout(() => setStatus('idle'), 3000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Okänt fel')
      setStatus('idle')
    }
  }

  async function handlePost() {
    if (!balanced) { setError('Verifikatet balanserar inte.'); return }
    if (!description.trim()) { setError('Ange en verifikationstext.'); return }
    setStatus('posting')
    setError(null)
    try {
      const result = await postManualEntry(buildDTO(), userId)
      setPostedEntry(result)
      setStatus('posted')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Okänt fel')
      setStatus('idle')
    }
  }

  function reset() {
    setDescription('')
    setDate(today)
    setLines([{ ...blankLine(), side: 'debit' }, { ...blankLine(), side: 'credit' }])
    setPostedEntry(null)
    setStatus('idle')
    setError(null)
  }

  // ── Render ────────────────────────────────────────────────────────────

  if (status === 'posted' && postedEntry) {
    return (
      <div className="bg-[#e8f5ee] border border-[#b8ddc9] rounded-[10px] p-8 text-center">
        <div className="text-3xl mb-2">✓</div>
        <div className="text-[16px] font-bold text-[#155c2d] mb-1">{postedEntry.entry_number} postad</div>
        <div className="text-[13px] text-[#334155] mb-6">{description} · {totalDebit.toFixed(2).replace('.', ',')} {currency}</div>
        <div className="flex justify-center gap-3">
          <button
            className="h-8 px-4 border border-[#b8ddc9] text-[#155c2d] text-[12.5px] font-semibold rounded-[7px] hover:bg-white transition-colors"
            onClick={() => window.location.href = `/company/${companyId}/ledger`}
          >
            Visa i huvudboken
          </button>
          <button
            className="h-8 px-4 bg-[#1a7a3c] text-white text-[12.5px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors"
            onClick={reset}
          >
            Nytt verifikat
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl">
      {/* Templates */}
      <div className="mb-4">
        <div className="text-[11px] font-bold text-[#64748b] uppercase tracking-wider mb-2">Mallar</div>
        <div className="flex gap-2 flex-wrap">
          {TEMPLATES.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => loadTemplate(t)}
              className="flex items-center gap-2 px-3 py-2 border border-[#e2e8f0] bg-white rounded-[8px] hover:border-[#1a7a3c] hover:bg-[#e8f5ee] transition-colors text-left"
            >
              <span className="text-base">{t.icon}</span>
              <div>
                <div className="text-[12.5px] font-semibold text-[#0f172a]">{t.label}</div>
                <div className="text-[11px] text-[#64748b] font-mono">{t.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Form card */}
      <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden">
        {/* Header */}
        <div className="bg-[#e8f5ee] border-b border-[#b8ddc9] px-5 py-3 flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#155c2d" strokeWidth="1.6"><path d="M8 3v10M3 8h10"/></svg>
          <span className="text-[14px] font-bold text-[#155c2d]">Manuellt verifikat</span>
          <span className="ml-auto text-[11px] font-mono text-[#64748b]">{nextEntryNumber}</span>
        </div>

        {/* Meta fields */}
        <div className="grid grid-cols-4 gap-3 px-5 py-4 border-b border-[#e2e8f0]">
          <div>
            <label className="text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider block mb-1">Datum</label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              className="w-full h-8 px-2.5 border border-[#e2e8f0] rounded-[6px] text-[13px] outline-none focus:border-[#1a7a3c] transition-all"
            />
          </div>
          <div className="col-span-2">
            <label className="text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider block mb-1">Verifikationstext *</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Beskriv affärshändelsen..."
              className="w-full h-8 px-2.5 border border-[#e2e8f0] rounded-[6px] text-[13px] outline-none focus:border-[#1a7a3c] transition-all"
            />
          </div>
          <div>
            <label className="text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider block mb-1">Serie</label>
            <select
              value={series}
              onChange={e => setSeries(e.target.value)}
              className="w-full h-8 px-2.5 border border-[#e2e8f0] rounded-[6px] text-[13px] outline-none focus:border-[#1a7a3c] bg-white transition-all"
            >
              <option>VER — Generell</option>
              <option>LON — Lön</option>
              <option>AVS — Avskrivning</option>
              <option>MOM — Moms</option>
            </select>
          </div>
        </div>

        {/* Lines header */}
        <div className="grid gap-2 px-5 py-2 bg-[#f8fafc] border-b border-[#e2e8f0] text-[10px] font-bold text-[#64748b] uppercase tracking-wider"
          style={{ gridTemplateColumns: '80px 120px 1fr 130px 130px 32px' }}>
          <div>D / K</div><div>Konto</div><div>Benämning</div>
          <div className="text-right">Debet ({currency})</div>
          <div className="text-right">Kredit ({currency})</div>
          <div></div>
        </div>

        {/* Lines */}
        <div>
          {lines.map((line, idx) => (
            <div
              key={line.id}
              className="grid gap-2 px-5 py-2 border-b border-[#e2e8f0] last:border-b-0 items-center hover:bg-[#fafcfe] transition-colors"
              style={{ gridTemplateColumns: '80px 120px 1fr 130px 130px 32px' }}
            >
              {/* D/K */}
              <select
                value={line.side}
                onChange={e => updateLine(line.id, { side: e.target.value as 'debit' | 'credit' })}
                className="h-8 px-2 border border-[#e2e8f0] rounded-[6px] text-[12.5px] bg-white outline-none focus:border-[#1a7a3c] transition-all"
              >
                <option value="debit">Debet</option>
                <option value="credit">Kredit</option>
              </select>

              {/* Account picker */}
              <AccountPicker
                accounts={accounts}
                value={line.account_number}
                onChange={(num, name) => updateLine(line.id, { account_number: num, account_name: name })}
              />

              {/* Name */}
              <input
                value={line.account_name}
                onChange={e => updateLine(line.id, { account_name: e.target.value })}
                placeholder="Kontonamn"
                className="h-8 px-2.5 border border-[#e2e8f0] rounded-[6px] text-[12.5px] outline-none focus:border-[#1a7a3c] transition-all"
              />

              {/* Debit amount */}
              <input
                value={line.side === 'debit' ? line.amount : ''}
                onChange={e => {
                  updateLine(line.id, { side: 'debit', amount: e.target.value })
                }}
                readOnly={line.side === 'credit'}
                placeholder={line.side === 'debit' ? '0,00' : ''}
                className={`h-8 px-2.5 border border-[#e2e8f0] rounded-[6px] text-[12.5px] text-right font-mono outline-none focus:border-[#1a7a3c] transition-all ${line.side === 'credit' ? 'bg-[#f8fafc]' : ''}`}
              />

              {/* Credit amount */}
              <input
                value={line.side === 'credit' ? line.amount : ''}
                onChange={e => {
                  updateLine(line.id, { side: 'credit', amount: e.target.value })
                }}
                readOnly={line.side === 'debit'}
                placeholder={line.side === 'credit' ? '0,00' : ''}
                className={`h-8 px-2.5 border border-[#e2e8f0] rounded-[6px] text-[12.5px] text-right font-mono outline-none focus:border-[#1a7a3c] transition-all ${line.side === 'debit' ? 'bg-[#f8fafc]' : ''}`}
              />

              {/* Remove */}
              <button
                type="button"
                onClick={() => removeLine(line.id)}
                disabled={lines.length <= 2}
                className="h-8 w-8 flex items-center justify-center border border-[#e2e8f0] rounded-[6px] text-[#94a3b8] hover:text-[#dc2626] hover:border-[#fecaca] hover:bg-[#fef2f2] transition-all disabled:opacity-30 disabled:cursor-not-allowed"
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
          className="w-full px-5 py-2.5 flex items-center gap-2 text-[12.5px] font-semibold text-[#1a7a3c] hover:bg-[#e8f5ee] transition-colors border-t border-[#e2e8f0]"
        >
          <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M7 2v10M2 7h10"/></svg>
          Lägg till rad
          <span className="text-[11px] text-[#94a3b8] font-normal ml-1">Tab → nästa fält · Enter → ny rad</span>
        </button>

        {/* Balance bar */}
        <div className="flex items-center justify-between px-5 py-3 bg-[#f8fafc] border-t border-[#e2e8f0]">
          <div className="flex gap-5 text-[12px] text-[#64748b]">
            <span>Debet <strong className="font-mono text-[#0f172a]">{fmtAmount(totalDebit) || '0,00'}</strong></span>
            <span>Kredit <strong className="font-mono text-[#0f172a]">{fmtAmount(totalCredit) || '0,00'}</strong></span>
            <span>Diff <strong className={`font-mono ${diff > 0.005 ? 'text-[#dc2626]' : 'text-[#0f172a]'}`}>{fmtAmount(diff) || '0,00'}</strong></span>
          </div>
          <span className={`text-[12px] font-semibold px-3 py-1 rounded-[5px] ${
            balanced ? 'bg-[#dcfce7] text-[#15803d]' : 'bg-[#fee2e2] text-[#b91c1c]'
          }`}>
            {balanced ? '✓ Balanserar' : '⚠ Balanserar ej'}
          </span>
        </div>

        {/* Error */}
        {error && (
          <div className="px-5 py-2.5 bg-[#fef2f2] border-t border-[#fecaca] text-[12.5px] text-[#b91c1c] font-medium">
            {error}
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center gap-2 px-5 py-3 bg-[#f8fafc] border-t border-[#e2e8f0]">
          <button
            type="button"
            onClick={handleDraft}
            disabled={status === 'saving' || status === 'posting'}
            className="h-8 px-3.5 border border-[#e2e8f0] bg-white text-[12.5px] font-semibold text-[#334155] rounded-[7px] hover:bg-[#f1f5f9] transition-colors disabled:opacity-50"
          >
            {status === 'draft_saved' ? '✓ Sparat' : status === 'saving' ? 'Sparar...' : 'Spara utkast'}
          </button>

          <div className="flex-1" />

          <button
            type="button"
            className="h-8 px-3.5 border border-[#e2e8f0] bg-white text-[12.5px] font-semibold text-[#334155] rounded-[7px] hover:bg-[#f1f5f9] transition-colors"
          >
            Bifoga dokument
          </button>

          <button
            type="button"
            onClick={handlePost}
            disabled={!balanced || !description.trim() || status === 'posting' || status === 'saving'}
            className="h-8 px-4 bg-[#1a7a3c] text-white text-[12.5px] font-semibold rounded-[7px] hover:bg-[#155c2d] transition-colors disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {status === 'posting' ? (
              <><span className="animate-spin">⟳</span> Postar...</>
            ) : (
              'Posta verifikat →'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
