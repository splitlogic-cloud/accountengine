'use client'

import Link           from 'next/link'
import { usePathname } from 'next/navigation'

interface SidebarProps {
  profile: {
    full_name?: string | null
    email:      string
    bureaus?:   { name: string } | null
  } | null
}

function NavItem({
  href,
  icon,
  label,
  badge,
  badgeVariant = 'gray',
}: {
  href:          string
  icon:          React.ReactNode
  label:         string
  badge?:        string | number
  badgeVariant?: 'green' | 'amber' | 'red' | 'blue' | 'gray'
}) {
  const pathname = usePathname()
  const active   = pathname === href || (href.length > 1 && pathname.startsWith(href))

  const badgeColors = {
    green: 'bg-[#e8f5ee] text-[#1a7a3c] border-[#b8ddc9]',
    amber: 'bg-[#fffbeb] text-[#d97706] border-[#fde68a]',
    red:   'bg-[#fef2f2] text-[#dc2626] border-[#fecaca]',
    blue:  'bg-[#eff6ff] text-[#2563eb] border-[#bfdbfe]',
    gray:  'bg-[#f1f5f9] text-[#475569] border-[#e2e8f0]',
  }

  return (
    <Link
      href={href}
      className={`flex items-center gap-2.5 px-2.5 py-[7px] mx-2 rounded-[7px] text-[13px] font-medium transition-all ${
        active
          ? 'bg-[#e8f5ee] text-[#155c2d] font-semibold'
          : 'text-[#334155] hover:bg-[#f8fafc] hover:text-[#0f172a]'
      }`}
    >
      <span className={`w-4 h-4 shrink-0 ${active ? 'text-[#1a7a3c]' : 'text-[#94a3b8]'}`}>
        {icon}
      </span>
      <span className="flex-1">{label}</span>
      {badge !== undefined && (
        <span className={`text-[10.5px] font-semibold px-1.5 py-px rounded-[10px] border ${badgeColors[badgeVariant]}`}>
          {badge}
        </span>
      )}
    </Link>
  )
}

function Divider() {
  return <div className="h-px bg-[#e2e8f0] my-2 mx-3.5" />
}

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="text-[10px] font-bold uppercase tracking-[.1em] text-[#94a3b8] px-4 pt-3.5 pb-1">
      {label}
    </div>
  )
}

const icons = {
  dashboard:  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><rect x="1.5" y="1.5" width="5" height="5" rx="1.2"/><rect x="9.5" y="1.5" width="5" height="5" rx="1.2"/><rect x="1.5" y="9.5" width="5" height="5" rx="1.2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1.2"/></svg>,
  clients:    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><circle cx="6" cy="5.5" r="2.5"/><path d="M1.5 13c0-2.5 2-4 4.5-4s4.5 1.5 4.5 4"/><circle cx="12" cy="5.5" r="2"/><path d="M14.5 12c0-1.8-1.1-3-2.5-3"/></svg>,
  events:     <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><circle cx="8" cy="8" r="6"/><path d="M8 5v3l2 2"/></svg>,
  monthly:    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><rect x="2" y="3" width="12" height="11" rx="1"/><path d="M5 1v4M11 1v4M2 7h12"/></svg>,
  voucher:    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><path d="M8 3v10M3 8h10"/></svg>,
  ledger:     <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><rect x="2" y="2" width="12" height="12" rx="1"/><path d="M2 7h12M7 2v12"/></svg>,
  accounts:   <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><path d="M3 12V5l2 2 3-4 3 4 2-2v7"/></svg>,
  invoices:   <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><path d="M3 2h10v12H3z"/><path d="M6 5h4M6 8h4M6 11h2"/></svg>,
  suppliers:  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><circle cx="8" cy="6" r="3"/><path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6"/></svg>,
  reskontra:  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><path d="M2 4h12M2 8h8M2 12h5"/></svg>,
  vat:        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><path d="M2 12L6 4l4 8M4 9h4"/></svg>,
  reports:    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><path d="M2 12V5l3.5 3.5L9 5l3.5 3.5V12"/></svg>,
  integrations: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><circle cx="8" cy="8" r="2"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2M4 4l1.5 1.5M10.5 10.5L12 12M4 12l1.5-1.5M10.5 5.5L12 4"/></svg>,
  import_:    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><path d="M8 2v8M5 7l3 3 3-3"/><path d="M3 12h10"/></svg>,
  oss:        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><circle cx="8" cy="8" r="6"/><path d="M4 8h8M8 2c-1.5 2-2 4-2 6s.5 4 2 6"/></svg>,
  rules:      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><path d="M3 4h10M5 8h6M7 12h2"/></svg>,
  settings:   <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="w-4 h-4"><circle cx="8" cy="8" r="2.5"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14"/></svg>,
  back:       <svg viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="w-3 h-3"><path d="M7 9L4 5.5 7 2"/></svg>,
}

export function Sidebar({ profile }: SidebarProps) {
  const pathname  = usePathname()

  // Detect if we're in a client (company) view
  // Routes look like /[companyId]/voucher, /[companyId]/ledger etc
  // Bureau routes: /dashboard, /clients, /events (bureau-level), /rules, /settings
  const bureauRoutes = ['/dashboard', '/clients', '/events', '/rules', '/settings', '/monthly', '/onboarding']
  const isClientView = !bureauRoutes.some(r => pathname === r || pathname.startsWith(r + '/'))
    && pathname !== '/'

  // Extract companyId from path: /[companyId]/... => companyId is first segment
  const segments  = pathname.split('/').filter(Boolean)
  const companyId = isClientView ? segments[0] : null

  // Base path for client routes
  const c = (path: string) => companyId ? `/${companyId}${path}` : '#'

  return (
    <aside className="w-[228px] h-full bg-white border-r border-[#e2e8f0] flex flex-col shrink-0">
      {/* Brand */}
      <div className="h-[52px] flex items-center gap-2.5 px-[18px] border-b border-[#e2e8f0] shrink-0">
        <div className="w-7 h-7 bg-[#1a7a3c] rounded-[7px] flex items-center justify-center shrink-0">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <rect x="1" y="1" width="5.5" height="5.5" rx="1.2" fill="white"/>
            <rect x="7.5" y="1" width="5.5" height="5.5" rx="1.2" fill="white" opacity=".5"/>
            <rect x="1" y="7.5" width="5.5" height="5.5" rx="1.2" fill="white" opacity=".5"/>
            <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1.2" fill="white"/>
          </svg>
        </div>
        <span className="text-[15px] font-bold tracking-tight">AccountEngine</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-1.5" style={{ scrollbarWidth: 'none' }}>
        {!isClientView ? (
          /* Bureau nav */
          <>
            <SectionLabel label="Byråvy" />
            <NavItem href="/dashboard"  icon={icons.dashboard} label="Översikt" />
            <NavItem href="/clients"    icon={icons.clients}   label="Klienter" />
            <NavItem href="/monthly"    icon={icons.monthly}   label="Månadskörning" />
            <Divider />
            <SectionLabel label="System" />
            <NavItem href="/rules"      icon={icons.rules}     label="Regelbibliotek" />
            <NavItem href="/settings"   icon={icons.settings}  label="Inställningar" />
          </>
        ) : (
          /* Client nav */
          <>
            <div className="px-4 pt-3 pb-1">
              <Link
                href="/clients"
                className="flex items-center gap-1 text-[12px] font-medium text-[#64748b] hover:text-[#0f172a] transition-colors"
              >
                {icons.back}
                Alla klienter
              </Link>
            </div>

            <NavItem href={c('')}            icon={icons.dashboard} label="Översikt" />
            <NavItem href={c('/voucher')}    icon={icons.voucher}   label="✍ Nytt verifikat" />
            <NavItem href={c('/ledger')}     icon={icons.ledger}    label="Huvudbok" />
            <NavItem href={c('/accounts')}   icon={icons.accounts}  label="Kontoplan" />
            <NavItem href={c('/events')}     icon={icons.events}    label="Events" />
            <Divider />
            <NavItem href={c('/invoices')}   icon={icons.invoices}  label="Fakturor" />
            <NavItem href={c('/suppliers')}  icon={icons.suppliers} label="Leverantörer" />
            <NavItem href={c('/reskontra')}  icon={icons.reskontra} label="Reskontra" />
            <Divider />
            <NavItem href={c('/vat')}        icon={icons.vat}       label="Moms" />
            <NavItem href={c('/reports')}    icon={icons.reports}   label="Rapporter" />
            <NavItem href={c('/import')}        icon={icons.import_}      label="Importera" />
            <NavItem href={c('/oss')}           icon={icons.oss}          label="OSS-rapport" />
            <Divider />
            <NavItem href={c('/integrations')} icon={icons.integrations} label="Integrationer" />
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-[#e2e8f0] p-3 shrink-0">
        <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-[7px] hover:bg-[#f8fafc] cursor-pointer transition-colors">
          <div className="w-[30px] h-[30px] bg-[#1a7a3c] rounded-full text-[11px] font-bold text-white flex items-center justify-center shrink-0">
            {(profile?.full_name ?? profile?.email ?? 'U').slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[12.5px] font-semibold truncate">
              {profile?.full_name ?? profile?.email}
            </div>
            <div className="text-[11px] text-[#64748b] truncate">
              {profile?.bureaus?.name ?? 'Ingen byrå'}
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
