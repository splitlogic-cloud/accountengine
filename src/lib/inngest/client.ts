import { Inngest } from 'inngest'

// ---------------------------------------------------------------------------
// Inngest client
// Single instance shared across all functions.
// ---------------------------------------------------------------------------
export const inngest = new Inngest({
  id:   'accountengine',
  name: 'AccountEngine',
})
