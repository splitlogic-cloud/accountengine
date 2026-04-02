import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import BureauSidebar from '@/components/layout/BureauSidebar'
import Topbar from '@/components/layout/Topbar'

export default async function BureauLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Hämta byråinfo
  const { data: bureauUser } = await supabase
    .from('bureau_users')
    .select('*, bureau:bureaus(*)')
    .eq('user_id', user.id)
    .single()

  if (!bureauUser) redirect('/login')

  return (
    <div className="min-h-screen bg-[#f5f4f0]">
      <Topbar user={user} bureau={bureauUser.bureau} />
      <div className="flex" style={{ paddingTop: '92px' }}>
        <BureauSidebar role={bureauUser.role} />
        <main className="flex-1 ml-[228px]">
          {children}
        </main>
      </div>
    </div>
  )
}
