import { createClient } from '@supabase/supabase-js';

const metaEnv = typeof import.meta !== 'undefined' ? (import.meta as any).env : undefined;
const supabaseUrl = metaEnv?.VITE_SUPABASE_URL || 'https://bsdhmlgjuncyvltehezb.supabase.co';
const supabaseKey = metaEnv?.VITE_SUPABASE_ANON_KEY || 'sb_publishable_yXjuJ9Sb5qZ-CR32NH2pKw_KYJ2I6Hy';

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

export const supabase = createClient(supabaseUrl, supabaseKey);

