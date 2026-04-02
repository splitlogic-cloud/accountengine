import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'AccountEngine',
  description: 'Byråportal för ekonomi',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="sv">
      <body className="antialiased text-[#1a1916] bg-[#f5f4f0]">
        {children}
      </body>
    </html>
  )
}
