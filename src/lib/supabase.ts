import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * Null when the build carries usable Supabase credentials; otherwise a
 * human-readable reason.
 *
 * This is exported so the UI can render an explicit "misconfigured" state. The
 * client used to fall back to `http://localhost`, which made a credential-less
 * production build fail as an opaque `NetworkError` per request — and, because
 * the public landing only checked `loading`, those failures rendered as a real
 * looking $0 / +0.0% / 0% portfolio. Never let a config fault read as data.
 */
export const supabaseConfigError: string | null =
  !supabaseUrl || supabaseUrl === 'YOUR_SUPABASE_PROJECT_URL_HERE'
    ? 'VITE_SUPABASE_URL is not set for this build.'
    : !supabaseAnonKey
      ? 'VITE_SUPABASE_ANON_KEY is not set for this build.'
      : null;

if (supabaseConfigError) {
  console.error(
    `[supabase] ${supabaseConfigError} Set it under the Vercel project's ` +
      'Environment Variables and redeploy — the client below cannot reach anything.'
  );
}

// The placeholder host only keeps createClient from throwing at module load; a
// throw here would blank the entire app, including routes that need no data.
// It is a reserved-by-RFC-2606 `.invalid` name, so unlike `localhost` it can
// never silently resolve to something real. Requests against it always fail —
// `supabaseConfigError` is the flag callers must check.
export const supabase = createClient(
  supabaseUrl || 'https://unconfigured.invalid',
  supabaseAnonKey || 'unconfigured'
);
