import { NextRequest, NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { EmailOtpType } from '@supabase/supabase-js'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const rawType = searchParams.get('type')
  const type = rawType as EmailOtpType | null
  const next = searchParams.get('next') ?? '/command'

  if (code || (tokenHash && type)) {
    const cookieStore = await cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() { return cookieStore.getAll() },
          setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          }
        }
      }
    )

    let error: { message?: string } | null = null

    if (code) {
      const result = await supabase.auth.exchangeCodeForSession(code)
      error = result.error
    } else if (tokenHash && type) {
      const result = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      })
      error = result.error
    }

    if (!error) {
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: bureauUser } = await supabase
          .from('bureau_users').select('bureau_id').eq('user_id', user.id).single()
        const redirect = bureauUser ? next : '/setup'
        return NextResponse.redirect(`${origin}${redirect}`)
      }
    }

    const encoded = encodeURIComponent(error?.message ?? 'auth_failed')
    return NextResponse.redirect(`${origin}/login?error=${encoded}`)
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`)
}
