import { NextRequest, NextResponse } from 'next/server'
import { createUserClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = createUserClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { company_id, provider, config } = await request.json()
  if (!company_id || !provider) {
    return NextResponse.json({ error: 'company_id and provider required' }, { status: 400 })
  }

  const service = createServiceClient()

  // Verify access
  const { data: member } = await service
    .from('company_members')
    .select('role')
    .eq('company_id', company_id)
    .eq('user_id', user.id)
    .single()

  if (!member) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  // Upsert integration — store config (API keys etc)
  // In production you'd encrypt these with AE_VAULT_KEY
  const { error } = await service
    .from('integrations')
    .upsert({
      company_id,
      provider,
      name:       provider,
      config,         // NOTE: encrypt in production
      is_active:  true,
      status:     'active',
    }, {
      onConflict: 'company_id,provider',
    })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(request: NextRequest) {
  const supabase = createUserClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { company_id, provider } = await request.json()
  const service = createServiceClient()

  await service
    .from('integrations')
    .update({ is_active: false, status: 'disconnected' })
    .eq('company_id', company_id)
    .eq('provider', provider)

  return NextResponse.json({ ok: true })
}
