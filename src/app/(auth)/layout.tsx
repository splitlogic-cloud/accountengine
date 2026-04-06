export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f8fafc]">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-8 h-8 bg-[#1a7a3c] rounded-lg flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 14 14" fill="none">
              <rect x="1" y="1" width="5.5" height="5.5" rx="1.2" fill="white"/>
              <rect x="7.5" y="1" width="5.5" height="5.5" rx="1.2" fill="white" opacity=".5"/>
              <rect x="1" y="7.5" width="5.5" height="5.5" rx="1.2" fill="white" opacity=".5"/>
              <rect x="7.5" y="7.5" width="5.5" height="5.5" rx="1.2" fill="white"/>
            </svg>
          </div>
          <span className="text-[15px] font-bold tracking-tight">AccountEngine</span>
        </div>
        {children}
      </div>
    </div>
  )
}
