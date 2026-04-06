import { NextRequest, NextResponse } from 'next/server'

/** Legacy redirect: Supabase may still have Site URL / redirect as /auth/callback */
export function GET(request: NextRequest) {
  const u = request.nextUrl.clone()
  u.pathname = '/callback'
  return NextResponse.redirect(u)
}
