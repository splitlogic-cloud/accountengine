import { createUserClient }   from '@/lib/supabase/server'
import { redirect }            from 'next/navigation'
import { VoucherForm }         from '@/components/journal/VoucherForm'

interface Props {
  params: Promise<{ companyId: string }>
}

export default async function VoucherPage({ params }: Props) {
  const { companyId } = await params
  const supabase       = createUserClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Verify access
  const { data: member } = await supabase
    .from('company_members')
    .select('role')
    .eq('company_id', companyId)
    .eq('user_id', user.id)
    .single()

  if (!member || member.role === 'reader') {
    redirect(`/${companyId}`)
  }

  // Fetch company
  const { data: company } = await supabase
    .from('companies')
    .select('id, name, currency, fiscal_year_start')
    .eq('id', companyId)
    .single()

  if (!company) redirect('/dashboard')

  // Fetch active accounts for this company
  const { data: accounts } = await supabase
    .from('accounts')
    .select('id, account_number, name, account_type, normal_side')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('account_number')

  // Next entry number (read only — actual allocation happens on post)
  const { data: seqData } = await supabase
    .from('entry_sequences')
    .select('last_number')
    .eq('company_id', companyId)
    .eq('fiscal_year', new Date().getFullYear())
    .single()

  const nextNum = (seqData?.last_number ?? 0) + 1
  const nextEntryNumber = `VER-${new Date().getFullYear()}-${String(nextNum).padStart(4, '0')} (preliminärt)`

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-[17px] font-bold tracking-tight flex items-center gap-2">
          <span>✍</span> Manuellt verifikat
        </h1>
        <p className="text-[12.5px] text-[#64748b] mt-0.5">
          {company.name} · Alltid tillgängligt oberoende av automation
        </p>
      </div>

      <VoucherForm
        companyId={companyId}
        companyName={company.name}
        currency={company.currency}
        accounts={accounts ?? []}
        nextEntryNumber={nextEntryNumber}
        userId={user.id}
      />
    </div>
  )
}
