'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { UserRole } from '@/lib/types/database'
import { LayoutDashboard } from 'lucide-react'

const NAV: { href: string; label: string; icon: typeof LayoutDashboard }[] = [
  { href: '/command', label: 'Command Center', icon: LayoutDashboard },
]

export default function BureauSidebar({ role }: { role: UserRole }) {
  const pathname = usePathname()

  return (
    <aside
      data-user-role={role}
      className="fixed left-0 top-[92px] z-40 h-[calc(100vh-92px)] w-[228px] border-r border-[#e6e4de] bg-white"
    >
      <nav className="flex flex-col gap-0.5 p-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active
                  ? 'bg-[#eaf4ee] text-[#1a6644]'
                  : 'text-[#5c5a54] hover:bg-[#faf9f6] hover:text-[#1a1916]'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0 opacity-80" strokeWidth={2} />
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
