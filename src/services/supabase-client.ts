// Compatibility shim — the real client lives in src/lib/api-client.js and
// talks to the Go backend.
export { supabase, api } from '@/lib/api-client';
export { default } from '@/lib/api-client';
