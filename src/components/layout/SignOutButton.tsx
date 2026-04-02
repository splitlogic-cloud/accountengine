'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function SignOutButton() {
  const router = useRouter()

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      className="text-xs font-medium text-[#908e87] hover:text-[#1a1916] transition-colors"
    >
      Logga ut
    </button>
  )
}
