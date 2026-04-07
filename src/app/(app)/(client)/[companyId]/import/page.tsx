import { createUserClient } from '@/lib/supabase/server'
import { redirect }         from 'next/navigation'
import { ImportForm }       from '@/components/import/ImportForm'

interface Props {
  params: Promise<{ companyId: string }>
}

export default async function ImportPage({ params }: Props) {
  const { companyId } = await params
  const supabase       = createUserClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Recent imports
  const { data: imports } = await supabase
    .from('imports')
    .select('id, source, file_name, status, row_count, created_at, metadata')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(10)

  return (
    <div className="p-6">
      <div className="mb-5">
        <h1 className="text-[17px] font-bold tracking-tight">Importera transaktioner</h1>
        <p className="text-[12.5px] text-[#64748b] mt-0.5">
          Ladda upp CSV-filer från Stripe, Shopify eller PayPal. Momsklassificering sker automatiskt.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-5 items-start">
        {/* Import form */}
        <div className="col-span-2 bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm p-5">
          <ImportForm companyId={companyId} />
        </div>

        {/* Sidebar */}
        <div>
          {/* OSS info */}
          <div className="bg-[#eff6ff] border border-[#bfdbfe] rounded-[10px] p-4 mb-4">
            <div className="text-[12.5px] font-bold text-[#1d4ed8] mb-2">🇪🇺 One Stop Shop (OSS)</div>
            <p className="text-[12px] text-[#1e40af] leading-relaxed">
              Systemet klassificerar automatiskt EU-försäljning per land och beräknar rätt momssats.
              OSS-deklarationen sammanställs under Moms → OSS-rapport.
            </p>
          </div>

          {/* Recent imports */}
          {(imports ?? []).length > 0 && (
            <div className="bg-white border border-[#e2e8f0] rounded-[10px] shadow-sm overflow-hidden">
              <div className="px-4 py-2.5 bg-[#f8fafc] border-b border-[#e2e8f0]">
                <span className="text-[12.5px] font-bold">Tidigare importer</span>
              </div>
              {(imports ?? []).map((imp: any) => (
                <div key={imp.id} className="flex items-center gap-3 px-4 py-3 border-b border-[#e2e8f0] last:border-b-0">
                  <span className="text-lg">
                    {imp.source === 'stripe' ? '💳' : imp.source === 'shopify' ? '🛍️' : '🅿️'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12.5px] font-semibold truncate">{imp.file_name}</div>
                    <div className="text-[11.5px] text-[#64748b]">
                      {imp.row_count ?? 0} rader · {imp.created_at?.split('T')[0]}
                    </div>
                  </div>
                  <span className={`text-[10.5px] font-semibold px-2 py-0.5 rounded-[4px] ${
                    imp.status === 'completed' ? 'bg-[#dcfce7] text-[#15803d]' :
                    imp.status === 'failed'    ? 'bg-[#fee2e2] text-[#b91c1c]' :
                    'bg-[#f1f5f9] text-[#475569]'
                  }`}>
                    {imp.status === 'completed' ? 'Klar' : imp.status === 'failed' ? 'Fel' : imp.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
