import { redirect } from 'next/navigation'
import { createUserClient } from '@/lib/supabase/server'

export default async function RootPage() {
  const supabase = createUserClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    redirect('/dashboard')
  } else {
    redirect('/login')
  }
}
