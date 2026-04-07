import { createUserClient } from '@/lib/supabase/server'
import { redirect }         from 'next/navigation'
import { EU_VAT_RATES }     from '@/lib/tax/classifier'

interface Props {
  params:      Promise<{ companyId: string }>
  searchParams: Promise<{ year?: string; q?: string }>
}

const COUNTRY_NAMES: Record<string, string> = {
  AT: 'Österrike', BE: 'Belgien', BG: 'Bulgarien', CY: 'Cypern',
  CZ: 'Tjeckien', DE: 'Tyskland', DK: 'Danmark', EE: 'Estland',
  ES: 'Spanien', FI: 'Finland', FR: 'Frankrike', GR: 'Grekland',
  HR: 'Kroatien', HU: 'Ungern', IE: 'Irland', IT: 'Italien',
  LT: 'Litauen', LU: 'Luxemburg', LV: 'Lettland', MT: 'Malta',
  NL: 'Nederländerna', PL: 'Polen', PT: 'Portugal', RO: 'Rumänien',
  SE: 'Sverige', SI: 'Slovenien', SK: 'Slovakien', EL: 'Grekland',
}

export default async function OSSPage({ params, searchParams }: Props) {
  const { companyId }      = await params
  const { year = String(new Date().getFullYear()), q = '1' } = await searchParams
  const supabase            = createUserClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const quarter = parseInt(q)
  const qMonths = [[1,2,3],[4,5,6],[7,8,9],[10,11,12]][quarter-1] ?? [1,2,3]

  // Get OSS vat_buckets (treatment = eu_oss)
  const { data: buckets } = await supabase
    .from('vat_buckets')
    .select('*')
    .eq('company_id', companyId)
    .eq('treatment', 'eu_oss')
    .eq('fiscal_year', parseInt(year))
    .in('period_month', qMonths)

  // Also get from financial_events for more granular data
  const { data: events } = await supabase
    .from('financial_events')
    .select('amount, currency, amount_sek, payload, occurred_at')
    .eq('company_id', companyId)
    .eq('processing_status', 'posted')
    .gte('occurred_at', `${year}-${String(qMonths[0]).padStart(2,'0')}-01`)
    .lte('occurred_at', `${year}-${String(qMonths[qMonths.length-1]).padStart(2,'0')}-31`)
    .filter('payload->>tax_treatment', 'eq', 'eu_oss')

  const fmt = (n: number) => n.toLocaleString('sv-SE', { minimumFractionDigits: 2 })

  // Build per-country summary from events
  const byCountry: Record<string, {
    country_code: string
    country_name: string
    vat_rate:     number
    taxable_sek:  number
    vat_sek:      number
    tx_count:     number
  }> = {}

  for (const evt of events ?? []) {
    const payload = evt.payload as any
    const country = payload?.customer_country ?? payload?.country_code
    if (!country || !(country in EU_VAT_RATES)) continue

    const rate    = EU_VAT_RATES[country] ?? 20
    const amtSEK  = evt.amount_sek ?? evt.amount
    const vatSEK  = Math.round(amtSEK * rate / (100 + rate) * 100) / 100
    const netSEK  = amtSEK - vatSEK

    if (!byCountry[country]) {
      byCountry[country] = {
        country_code: country,
        country_name: COUNTRY_NAMES[country] ?? country,
        vat_rate:     rate,
        taxable_sek:  0,
        vat_sek:      0,
        tx_count:     0,
      }
    }

    byCountry[country]!.taxable_sek += netSEK
    byCountry[country]!.vat_sek     += vatSEK
    byCountry[country]!.tx_count    += 1
  }

  // Also aggregate from vat_buckets if available
  for (const bucket of buckets ?? []) {
    const country = bucket.country_code
    if (!country) continue

    if (!byCountry[country]) {
      byCountry[country] = {
        country_code: country,
        country_name: COUNTRY_NAMES[country] ?? country,
        vat_rate:     EU_VAT_RATES[country] ?? 20,
        taxable_sek:  0,
        vat_sek:      0,
        tx_count:     0,
      }
    }

    // Add from buckets (avoid double-counting with events by using only one source)
    // Prefer events if available
    if ((events ?? []).length === 0) {
      byCountry[country]!.taxable_sek += bucket.taxable_amount ?? 0
      byCountry[country]!.vat_sek     += bucket.vat_amount ?? 0
    }
  }

  const rows = Object.values(byCountry).sort((a, b) => b.vat_sek - a.vat_sek)
  const totalVAT     = rows.reduce((s, r) => s + r.vat_sek, 0)
  const totalTaxable = rows.reduce((s, r) => s + r.taxable_sek, 0)

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[17px] font-bold tracking-tight">OSS-rapport</h1>
          <p className="text-[12.5px] text-[#64748b] mt-0.5">
            One Stop Shop — EU B2C-försäljning kvartal {q} {year}
          </p>
        </div>
        <div className="flex gap-2">
          {[1,2,3,4].map(qn => (
            <a key={qn} href={`?year=${year}&q=${qn}`}
              className={`h-8 w-9 flex items-center justify-center text-[12.5px] font-semibold rounded-[7px] transition-colors ${
                quarter === qn
                  ? 'bg-[#1a7a3c] text-white'
                  : 'border border-[#e2e8f0] bg-white text-[#334155] hover:bg-[#f1f5f9]'
              }`}>Q{qn}</a>
          ))}
        </div>
      </div>

      {/* Info box */}
      <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded-[10px] px-4 py-3 mb-5 text-[12.5px] text-[#1e40af]">
        <strong>One Stop Shop (OSS)</strong> — du deklarerar och betalar moms för all EU B2C-försäljning
        via Skatteverkets OSS-portal. Deadline: 31 oktober (Q3), 31 januari (Q4), 30 april (Q1), 31 juli (Q2).
        <a href="https://www.skatteverket.se/oss" target="_blank" className="ml-1 underline">skatteverket.se/oss →</a>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white border border-[#e2e8f0] rounded-[10px] p-10 text-center shadow-sm">
          <div className="text-3xl mb-2">🇪🇺</div>
          <div className="text-[14px] font-semibold mb-1">Ingen OSS-försäljning kvartal {q} {year}</div>
          <p className="text-[12.5px] text-[#64748b]">
            Importera transaktioner från Stripe/Shopify/PayPal för att se OSS-underlaget.
          </p>
        </div>
      ) : (
        <>
          {/* Per-country table */}
          <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden mb-4">
            <div className="px-5 py-3 bg-[#f8fafc] border-b border-[#e2e8f0]">
              <span className="text-[12.5px] font-bold">Försäljning per EU-land</span>
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-[#f8fafc] border-b border-[#e2e8f0]">
                  <th className="text-left px-5 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Land</th>
                  <th className="text-left px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Momssats</th>
                  <th className="text-right px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Antal tx</th>
                  <th className="text-right px-4 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Skattepliktig (SEK)</th>
                  <th className="text-right px-5 py-2.5 text-[10.5px] font-bold text-[#64748b] uppercase tracking-wider">Moms att betala (SEK)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(row => (
                  <tr key={row.country_code} className="border-b border-[#e2e8f0] last:border-b-0 hover:bg-[#f8fafc]">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{getFlagEmoji(row.country_code)}</span>
                        <div>
                          <div className="text-[13px] font-semibold">{row.country_name}</div>
                          <div className="text-[11px] text-[#64748b] font-mono">{row.country_code}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-[13px] font-semibold text-[#2563eb]">{row.vat_rate}%</span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-[12.5px]">{row.tx_count}</td>
                    <td className="px-4 py-3 text-right font-mono text-[12.5px]">{fmt(row.taxable_sek)}</td>
                    <td className="px-5 py-3 text-right font-mono text-[13px] font-bold text-[#dc2626]">
                      {fmt(row.vat_sek)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[#e2e8f0] bg-[#f8fafc]">
                  <td className="px-5 py-3 font-bold text-[13px]" colSpan={3}>Totalt att deklarera</td>
                  <td className="px-4 py-3 text-right font-mono text-[13px] font-bold">{fmt(totalTaxable)}</td>
                  <td className="px-5 py-3 text-right font-mono text-[15px] font-bold text-[#dc2626]">{fmt(totalVAT)} kr</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Accounting entries */}
          <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm p-5">
            <div className="text-[12.5px] font-bold mb-3">Kontering i svenska böcker (konto 2614)</div>
            <div className="grid grid-cols-2 gap-3 text-[12.5px]">
              <div className="bg-[#f8fafc] border border-[#e2e8f0] rounded-[7px] p-3">
                <div className="font-bold mb-1">Debet</div>
                <div className="font-mono">2614 Utgående moms OSS</div>
                <div className="font-mono font-bold text-[#1a7a3c] mt-1">{fmt(totalVAT)} kr</div>
              </div>
              <div className="bg-[#f8fafc] border border-[#e2e8f0] rounded-[7px] p-3">
                <div className="font-bold mb-1">Kredit</div>
                <div className="font-mono">2650 Momsredovisningskonto</div>
                <div className="font-mono font-bold text-[#dc2626] mt-1">{fmt(totalVAT)} kr</div>
              </div>
            </div>
            <p className="text-[11.5px] text-[#64748b] mt-3">
              Deklarera och betala via <a href="https://www.skatteverket.se" target="_blank" className="text-[#1a7a3c] hover:underline">Skatteverkets OSS-portal</a>.
              Betalning i SEK till Skatteverket, de vidarebefordrar till respektive EU-land.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

function getFlagEmoji(countryCode: string): string {
  try {
    return countryCode
      .toUpperCase()
      .split('')
      .map(c => String.fromCodePoint(c.charCodeAt(0) + 127397))
      .join('')
  } catch {
    return '🏳️'
  }
}
