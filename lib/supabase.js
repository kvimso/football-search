import { createClient } from "@supabase/supabase-js";

// Browser/client-side Supabase client (uses anon key, respects RLS)
let browserClient = null;

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) return null;

  browserClient = createClient(url, anonKey);
  return browserClient;
}

// Server-side Supabase client (uses service role key, bypasses RLS)
export function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) return null;

  return createClient(url, serviceKey);
}

// Check if Supabase is configured (not just placeholder values)
export function isSupabaseConfigured() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return !!(
    url && key &&
    !url.includes("your-project") && !url.includes("your_project") &&
    !key.includes("your") && !key.includes("_here")
  );
}
