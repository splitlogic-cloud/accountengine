import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

function normalizeOptional(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const service = createServiceClient()

    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Inte inloggad' }, { status: 401 })
    }

    const body = await request.json().catch(() => ({}))
    const bureau_name =
      typeof body?.bureau_name === 'string' ? body.bureau_name.trim() : ''
    const company_name =
      typeof body?.company_name === 'string' ? body.company_name.trim() : ''

    if (!bureau_name || !company_name) {
      return NextResponse.json(
        { error: 'Byrånamn och bolagsnamn krävs' },
        { status: 400 }
      )
    }

    const { data: existingMembership } = await service
      .from('bureau_users')
      .select('bureau_id')
      .eq('user_id', user.id)
      .maybeSingle()

    if (existingMembership?.bureau_id) {
      return NextResponse.json({ redirect: '/command' })
    }

    const bureauSlugBase = slugify(bureau_name) || `bureau-${Date.now()}`
    const companySlugBase = slugify(company_name) || `company-${Date.now()}`
    const suffix = Math.random().toString(36).slice(2, 7)

    const { data: bureau, error: bureauError } = await service
      .from('bureaus')
      .insert({
        name: bureau_name,
        slug: `${bureauSlugBase}-${suffix}`,
        org_number: normalizeOptional(body?.bureau_org_nr),
        plan: 'starter',
        settings: {},
      })
      .select('id')
      .single()

    if (bureauError || !bureau) {
      return NextResponse.json(
        { error: bureauError?.message ?? 'Kunde inte skapa byrå' },
        { status: 500 }
      )
    }

    const { error: memberError } = await service.from('bureau_users').insert({
      bureau_id: bureau.id,
      user_id: user.id,
      role: 'admin',
      email: user.email ?? null,
      full_name:
        (user.user_metadata?.full_name as string | undefined) ??
        (user.user_metadata?.name as string | undefined) ??
        null,
    })

    if (memberError) {
      return NextResponse.json(
        { error: memberError.message ?? 'Kunde inte skapa byråmedlem' },
        { status: 500 }
      )
    }

    const { error: companyError } = await service.from('companies').insert({
      bureau_id: bureau.id,
      name: company_name,
      slug: `${companySlugBase}-${suffix}`,
      org_number: normalizeOptional(body?.company_org_nr),
      vat_number: null,
      status: 'active',
      fortnox_access_token: null,
      fortnox_refresh_token: null,
      fortnox_token_expires: null,
      fortnox_company_id: null,
      sync_status: 'idle',
      last_synced_at: null,
      sync_error: null,
      settings: {},
      modules_enabled: {},
    })

    if (companyError) {
      return NextResponse.json(
        { error: companyError.message ?? 'Kunde inte skapa bolag' },
        { status: 500 }
      )
    }

    return NextResponse.json({ redirect: '/command' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

