import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        // The page gate refreshes the token. A second refresh here signs the user out.
        autoRefreshToken: false,
        detectSessionInUrl: true,
        persistSession: true,
      },
    },
  );
}
