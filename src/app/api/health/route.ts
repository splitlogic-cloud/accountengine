import { NextResponse }          from 'next/server'
import { createServiceClient }  from '@/lib/supabase/server'

// ---------------------------------------------------------------------------
// GET /api/health
// Returns system health status. Used by monitoring and uptime checks.
// No authentication required.
// ---------------------------------------------------------------------------
export async function GET() {
  const start = Date.now()

  const checks: Record<string, { ok: boolean; latency_ms?: number; error?: string }> = {}

  // Check Supabase connectivity
  try {
    const t0       = Date.now()
    const supabase = createServiceClient()
    await supabase.from('bureaus').select('id').limit(1)
    checks['database'] = { ok: true, latency_ms: Date.now() - t0 }
  } catch (e) {
    checks['database'] = {
      ok:    false,
      error: e instanceof Error ? e.message : String(e),
    }
  }

  const allOk      = Object.values(checks).every(c => c.ok)
  const totalMs    = Date.now() - start

  return NextResponse.json(
    {
      status:    allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      version:   process.env.npm_package_version ?? 'unknown',
      latency_ms: totalMs,
      checks,
    },
    {
      status:  allOk ? 200 : 503,
      headers: { 'Cache-Control': 'no-store' },
    }
  )
}
