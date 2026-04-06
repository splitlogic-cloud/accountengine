import { createUserClient } from '@/lib/supabase/server'
import { redirect }         from 'next/navigation'

interface Props {
  params:      Promise<{ companyId: string }>
  searchParams: Promise<{ year?: string; q?: string }>
}

export default async function VatPage({ params, searchParams }: Props) {
  const { companyId }         = await params
  const { year = String(new Date().getFullYear()), q = '1' } = await searchParams
  const supabase               = createUserClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Determine quarter months
  const quarter   = parseInt(q)
  const qMonths   = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
    [10, 11, 12],
  ][quarter - 1] ?? [1, 2, 3]

  const { data: buckets } = await supabase
    .from('vat_buckets')
    .select('*')
    .eq('company_id', companyId)
    .eq('fiscal_year', parseInt(year))
    .in('period_month', qMonths)

  const fmt = (n: number) => n.toLocaleString('sv-SE', { minimumFractionDigits: 2 })

  // Aggregate
  const outgoing = (buckets ?? [])
    .filter(b => ['domestic_vat', 'eu_oss'].includes(b.treatment))
    .reduce((s, b) => s + (b.vat_amount ?? 0), 0)

  const incoming = (buckets ?? [])
    .filter(b => b.treatment === 'incoming_vat')
    .reduce((s, b) => s + (b.vat_amount ?? 0), 0)

  const toPay = outgoing - incoming

  const skv05 = (buckets ?? []).filter(b => b.treatment === 'domestic_vat' && b.vat_rate === 25)
    .reduce((s, b) => s + (b.taxable_amount ?? 0), 0)
  const skv06 = (buckets ?? []).filter(b => b.treatment === 'domestic_vat' && b.vat_rate === 12)
    .reduce((s, b) => s + (b.taxable_amount ?? 0), 0)
  const skv07 = (buckets ?? []).filter(b => b.treatment === 'domestic_vat' && b.vat_rate === 6)
    .reduce((s, b) => s + (b.taxable_amount ?? 0), 0)
  const skv10 = (buckets ?? []).filter(b => b.treatment === 'export_outside_eu')
    .reduce((s, b) => s + (b.taxable_amount ?? 0), 0)
  const skv20 = (buckets ?? []).filter(b => b.treatment === 'domestic_vat' && b.vat_rate === 25)
    .reduce((s, b) => s + (b.vat_amount ?? 0), 0)
  const skv22 = (buckets ?? []).filter(b => b.treatment === 'domestic_vat' && b.vat_rate === 12)
    .reduce((s, b) => s + (b.vat_amount ?? 0), 0)
  const skv23 = (buckets ?? []).filter(b => b.treatment === 'domestic_vat' && b.vat_rate === 6)
    .reduce((s, b) => s + (b.vat_amount ?? 0), 0)

  const Row = ({ ruta, label, value }: { ruta: string; label: string; value: number }) => (
    <div className="flex items-center justify-between py-2.5 border-b border-[#e2e8f0] last:border-b-0">
      <div>
        <span className="font-mono text-[11.5px] font-bold text-[#94a3b8] mr-3">Ruta {ruta}</span>
        <span className="text-[13px] text-[#334155]">{label}</span>
      </div>
      <span className="font-mono text-[13px] font-semibold text-[#0f172a]">{fmt(value)}</span>
    </div>
  )

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-[17px] font-bold tracking-tight">Momsdeklaration</h1>
          <p className="text-[12.5px] text-[#64748b] mt-0.5">Kvartal {q} {year}</p>
        </div>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map(qn => (
            <a
              key={qn}
              href={`?year=${year}&q=${qn}`}
              className={`h-8 w-9 flex items-center justify-center text-[12.5px] font-semibold rounded-[7px] transition-colors ${
                quarter === qn
                  ? 'bg-[#1a7a3c] text-white'
                  : 'border border-[#e2e8f0] bg-white text-[#334155] hover:bg-[#f1f5f9]'
              }`}
            >
              Q{qn}
            </a>
          ))}
        </div>
      </div>

      {(buckets ?? []).length === 0 ? (
        <div className="bg-[#fffbeb] border border-[#fde68a] rounded-[10px] px-5 py-6 text-[13px] text-[#854d0e]">
          Inga momsdata för kvartal {q} {year}. Kör en import och klassificera transaktioner för att se momsunderlaget.
        </div>
      ) : (
        <>
          {/* Utgående moms */}
          <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden mb-4">
            <div className="px-5 py-3 bg-[#f8fafc] border-b border-[#e2e8f0]">
              <span className="text-[12.5px] font-bold">Utgående moms</span>
            </div>
            <div className="px-5">
              <Row ruta="05" label="Momspliktig försäljning 25%" value={skv05} />
              <Row ruta="06" label="Momspliktig försäljning 12%" value={skv06} />
              <Row ruta="07" label="Momspliktig försäljning 6%"  value={skv07} />
              <Row ruta="10" label="Export utanför EU"            value={skv10} />
              <Row ruta="20" label="Utgående moms 25%"           value={skv20} />
              <Row ruta="22" label="Utgående moms 12%"           value={skv22} />
              <Row ruta="23" label="Utgående moms 6%"            value={skv23} />
            </div>
          </div>

          {/* Ingående moms */}
          <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden mb-4">
            <div className="px-5 py-3 bg-[#f8fafc] border-b border-[#e2e8f0]">
              <span className="text-[12.5px] font-bold">Ingående moms</span>
            </div>
            <div className="px-5">
              <Row ruta="48" label="Ingående moms att dra av" value={incoming} />
            </div>
          </div>

          {/* Att betala */}
          <div className={`rounded-[10px] px-5 py-4 flex items-center justify-between border ${
            toPay > 0
              ? 'bg-[#fef2f2] border-[#fecaca]'
              : 'bg-[#e8f5ee] border-[#b8ddc9]'
          }`}>
            <div>
              <div className={`text-[14px] font-bold ${toPay > 0 ? 'text-[#b91c1c]' : 'text-[#155c2d]'}`}>
                Ruta 49 — {toPay > 0 ? 'Att betala till Skatteverket' : 'Att återfå från Skatteverket'}
              </div>
            </div>
            <div className={`font-mono text-[22px] font-bold ${toPay > 0 ? 'text-[#b91c1c]' : 'text-[#155c2d]'}`}>
              {fmt(Math.abs(toPay))} kr
            </div>
          </div>
        </>
      )}
    </div>
  )
}
