import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey || supabaseUrl === 'YOUR_SUPABASE_PROJECT_URL_HERE') {
  console.error("Supabase URL and Anon Key must be provided in the .env file");
}

export const supabase = createClient(supabaseUrl || 'http://localhost', supabaseAnonKey || 'public-anon-key');
