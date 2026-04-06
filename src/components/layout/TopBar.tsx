'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter }     from 'next/navigation'
import type { User }     from '@supabase/supabase-js'

interface TopBarProps {
  user:    User
  profile: { full_name?: string | null; email: string } | null
}

export function TopBar({ user, profile }: TopBarProps) {
  const router   = useRouter()
  const supabase = createClient()

  async function signOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const initials = (profile?.full_name ?? profile?.email ?? 'U')
    .split(' ')
    .map(p => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

  return (
    <header className="h-[52px] bg-white border-b border-[#e2e8f0] flex items-center px-6 gap-4 shrink-0 z-10 shadow-sm">
      {/* Search */}
      <div className="relative flex-1 max-w-[340px]">
        <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="6.5" cy="6.5" r="4.5"/><path d="M11.5 11.5L14 14"/>
        </svg>
        <input
          placeholder="Sök konto, verifikat, kund..."
          className="w-full h-[33px] bg-[#f8fafc] border border-[#e2e8f0] rounded-[7px] pl-9 pr-3 text-[13px] outline-none focus:bg-white focus:border-[#1a7a3c] focus:ring-2 focus:ring-[#1a7a3c]/10 transition-all placeholder:text-[#94a3b8]"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* User chip */}
        <div className="flex items-center gap-2 pl-4 border-l border-[#e2e8f0]">
          <div className="text-right">
            <div className="text-[12.5px] font-semibold leading-tight">
              {profile?.full_name ?? profile?.email}
            </div>
            <div className="text-[10.5px] text-[#64748b] leading-tight">Systemadmin</div>
          </div>
          <button
            onClick={signOut}
            title="Logga ut"
            className="w-[28px] h-[28px] bg-[#1a7a3c] rounded-full text-[11px] font-bold text-white flex items-center justify-center hover:bg-[#155c2d] transition-colors"
          >
            {initials}
          </button>
        </div>
      </div>
    </header>
  )
}
