import { createClient } from '@supabase/supabase-js';

// const supabaseUrl = 'https://gxwpvpqatisvkpgpstst.supabase.co';
const supabaseUrl = 'https://app.caseon.co.za';
const supabaseKey = '***REMOVED-SUPABASE-ANON-KEY***'

export let supabase = createClient(supabaseUrl, supabaseKey);