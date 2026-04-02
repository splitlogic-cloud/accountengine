import type { User } from '@supabase/supabase-js'
import type { Bureau } from '@/lib/types/database'
import SignOutButton from '@/components/layout/SignOutButton'

export default function Topbar({
  user,
  bureau,
}: {
  user: User
  bureau: Bureau | null
}) {
  const bureauName = bureau?.name ?? 'Byrå'

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 h-[92px] border-b border-[#e6e4de] bg-white/95 backdrop-blur-sm"
    >
      <div className="flex h-full items-center justify-between px-6">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#e6e4de] bg-[#faf9f6]">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x="2" y="2" width="5" height="5" rx="1.5" fill="#256644" />
              <rect x="9" y="2" width="5" height="5" rx="1.5" fill="#256644" opacity=".35" />
              <rect x="2" y="9" width="5" height="5" rx="1.5" fill="#256644" opacity=".35" />
              <rect x="9" y="9" width="5" height="5" rx="1.5" fill="#256644" opacity=".65" />
            </svg>
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-[#908e87]">
              AccountEngine
            </div>
            <div className="truncate text-sm font-semibold text-[#1a1916]">{bureauName}</div>
          </div>
        </div>
        <div className="flex items-center gap-4 shrink-0">
          <span className="hidden sm:inline text-xs text-[#908e87] truncate max-w-[200px]">
            {user.email}
          </span>
          <SignOutButton />
        </div>
      </div>
    </header>
  )
}
