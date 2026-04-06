import { redirect }          from 'next/navigation'
import { createUserClient }  from '@/lib/supabase/server'
import { Sidebar }           from '@/components/layout/Sidebar'
import { TopBar }            from '@/components/layout/TopBar'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createUserClient()
  const { data: { user }, error } = await supabase.auth.getUser()

  if (error || !user) {
    redirect('/login')
  }

  // Fetch profile + bureau
  const { data: profile } = await supabase
    .from('profiles')
    .select('*, bureaus(*)')
    .eq('id', user.id)
    .single()

  return (
    <div className="flex h-screen overflow-hidden bg-[#f8fafc]">
      <Sidebar profile={profile} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopBar user={user} profile={profile} />
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
