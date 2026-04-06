import { createBrowserClient } from '@supabase/ssr'

// ---------------------------------------------------------------------------
// Browser client — used in Client Components only.
// RLS enforced. Never has service role access.
// ---------------------------------------------------------------------------
export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (typeof window !== 'undefined' && (!url || !key)) {
    throw new Error(
      'Saknar NEXT_PUBLIC_SUPABASE_URL eller NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    )
  }

  const fallbackUrl = 'http://127.0.0.1:54321'
  const fallbackKey =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'

  return createBrowserClient(url ?? fallbackUrl, key ?? fallbackKey)
}
