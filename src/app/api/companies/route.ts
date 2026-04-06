import { NextRequest, NextResponse } from 'next/server'
import { createUserClient, createServiceClient } from '@/lib/supabase/server'

export async function POST(request: NextRequest) {
  const supabase = createUserClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { bureau_id, name, org_number } = body

  if (!bureau_id || !name) {
    return NextResponse.json({ error: 'bureau_id and name are required' }, { status: 400 })
  }

  // Verify user belongs to bureau
  const { data: profile } = await supabase
    .from('profiles')
    .select('bureau_id')
    .eq('id', user.id)
    .single()

  if (profile?.bureau_id !== bureau_id) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  const service = createServiceClient()

  // Generate slug
  const slug = name
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') + '-' + Date.now().toString(36)

  const { data: company, error: coErr } = await service
    .from('companies')
    .insert({
      bureau_id,
      name:       name.trim(),
      org_number: org_number?.trim() || null,
      slug,
      status:     'active',
    })
    .select('id')
    .single()

  if (coErr || !company) {
    return NextResponse.json({ error: coErr?.message ?? 'Failed to create company' }, { status: 500 })
  }

  // Add user as owner member
  await service.from('company_members').insert({
    company_id:  company.id,
    user_id:     user.id,
    role:        'owner',
    is_primary:  true,
    accepted_at: new Date().toISOString(),
  })

  // Link to bureau
  await service.from('bureau_clients').insert({
    bureau_id,
    company_id: company.id,
  })

  // BAS seed happens via DB trigger on companies insert

  return NextResponse.json({ company_id: company.id })
}
