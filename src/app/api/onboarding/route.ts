import { NextRequest, NextResponse } from 'next/server'
import { createUserClient, createServiceClient } from '@/lib/supabase/server'

function slug(name: string) {
  return name
    .toLowerCase()
    .replace(/[åä]/g, 'a').replace(/ö/g, 'o')
    .replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    + '-' + Date.now().toString(36)
}

export async function POST(request: NextRequest) {
  const supabase = createUserClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const service = createServiceClient()

  // ── BUREAU mode ─────────────────────────────────────────────────────────
  if (body.type === 'bureau') {
    const { bureau_name, bureau_org, co_name, co_org } = body
    if (!bureau_name?.trim()) {
      return NextResponse.json({ error: 'Byrånamn krävs.' }, { status: 400 })
    }

    // 1. Create bureau
    const { data: bureau, error: bErr } = await service
      .from('bureaus')
      .insert({ name: bureau_name.trim(), org_number: bureau_org || null })
      .select('id').single()

    if (bErr || !bureau) {
      return NextResponse.json({ error: bErr?.message ?? 'Kunde inte skapa byrå.' }, { status: 500 })
    }

    // 2. Link user to bureau
    await service.from('profiles').update({ bureau_id: bureau.id }).eq('id', user.id)

    // 3. Optionally create first company
    let company_id: string | null = null
    if (co_name?.trim()) {
      const { data: co, error: coErr } = await service
        .from('companies')
        .insert({
          bureau_id:  bureau.id,
          name:       co_name.trim(),
          org_number: co_org || null,
          slug:       slug(co_name),
          status:     'active',
        })
        .select('id').single()

      if (coErr || !co) {
        return NextResponse.json({ error: coErr?.message ?? 'Kunde inte skapa bolag.' }, { status: 500 })
      }

      company_id = co.id

      await service.from('company_members').insert({
        company_id: co.id,
        user_id:    user.id,
        role:       'owner',
        is_primary: true,
        accepted_at: new Date().toISOString(),
      })

      await service.from('bureau_clients').insert({
        bureau_id:  bureau.id,
        company_id: co.id,
      })
    }

    return NextResponse.json({ bureau_id: bureau.id, company_id })
  }

  // ── SOLO mode ────────────────────────────────────────────────────────────
  if (body.type === 'solo') {
    const { co_name, co_org } = body
    if (!co_name?.trim()) {
      return NextResponse.json({ error: 'Bolagsnamn krävs.' }, { status: 400 })
    }

    // 1. Create a bureau named after the company (hidden from UI, just for schema)
    const { data: bureau, error: bErr } = await service
      .from('bureaus')
      .insert({ name: co_name.trim(), org_number: co_org || null })
      .select('id').single()

    if (bErr || !bureau) {
      return NextResponse.json({ error: bErr?.message ?? 'Kunde inte skapa konto.' }, { status: 500 })
    }

    // 2. Link user
    await service.from('profiles').update({ bureau_id: bureau.id }).eq('id', user.id)

    // 3. Create company
    const { data: co, error: coErr } = await service
      .from('companies')
      .insert({
        bureau_id:  bureau.id,
        name:       co_name.trim(),
        org_number: co_org || null,
        slug:       slug(co_name),
        status:     'active',
      })
      .select('id').single()

    if (coErr || !co) {
      return NextResponse.json({ error: coErr?.message ?? 'Kunde inte skapa bolag.' }, { status: 500 })
    }

    await service.from('company_members').insert({
      company_id:  co.id,
      user_id:     user.id,
      role:        'owner',
      is_primary:  true,
      accepted_at: new Date().toISOString(),
    })

    await service.from('bureau_clients').insert({
      bureau_id:  bureau.id,
      company_id: co.id,
    })

    return NextResponse.json({ company_id: co.id })
  }

  return NextResponse.json({ error: 'Invalid type.' }, { status: 400 })
}
