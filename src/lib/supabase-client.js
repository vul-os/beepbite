// Compatibility shim — the real client lives in ./api-client.js and talks to
// the Go backend. Every `import { supabase } from '@/lib/supabase-client'`
// keeps working unchanged.
export { supabase, api } from './api-client';
export { default } from './api-client';
