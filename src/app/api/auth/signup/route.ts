import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Tillfällig öppen registrering: skapar användare med bekräftad e-post (ingen bekräftelsemail).
 * Kräver SUPABASE_SERVICE_ROLE_KEY — sätts i Vercel env, aldrig i klienten.
 */
export async function POST(request: NextRequest) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'Saknar SUPABASE_SERVICE_ROLE_KEY på servern.' }, { status: 500 })
  }

  let body: { email?: string; password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Ogiltig begäran.' }, { status: 400 })
  }

  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'Ogiltig e-postadress.' }, { status: 400 })
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: 'Lösenordet måste vara minst 6 tecken.' },
      { status: 400 },
    )
  }

  const admin = createServiceClient()
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })

  if (error) {
    const raw = error.message.toLowerCase()
    const duplicate =
      raw.includes('already') ||
      raw.includes('registered') ||
      raw.includes('exists')
    return NextResponse.json(
      {
        error: duplicate
          ? 'Det finns redan ett konto med den e-postadressen.'
          : error.message,
      },
      { status: 400 },
    )
  }

  if (!data.user) {
    return NextResponse.json({ error: 'Kunde inte skapa användare.' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
