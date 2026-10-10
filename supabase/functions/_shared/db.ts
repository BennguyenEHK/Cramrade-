// The server's database client. It uses the service role, so it bypasses
// Row Level Security and sees every row. Every function must check that the
// caller owns (or may see) a row before reading or writing it for them.

import { createClient } from 'npm:@supabase/supabase-js@2';

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');

/**
 * The service-role key Supabase gives every function. It is a JWT while the
 * project's legacy API keys are on (checked 2026-10-10), which is what lets
 * one function call another through verify_jwt (see invoke.ts).
 */
export const serviceRoleKey: string = key;

/** One shared service-role client per running function. */
export const db = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
