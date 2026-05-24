import { createClient } from '@supabase/supabase-js';

export const projectUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
export const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = !!(projectUrl && anonKey);

export const supabase = createClient(projectUrl, anonKey);
