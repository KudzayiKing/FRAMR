import { getBrowserClient, isSupabaseConfigured } from "./supabase-browser";

export type AuthRole = "creator" | "advertiser";

/**
 * Session resolution:
 * - When Supabase is configured, sign in via Supabase Auth. Demo accounts are
 *   pre-seeded with email confirmation already set, so signing in is all that
 *   is needed — never fall back to signUp (it is disabled-by-confirmation and
 *   the obfuscated "check your email" response would mask a bad password).
 * - Otherwise (local demo), persist the chosen role so the workspace renders.
 */
export async function resolveSession(email: string, password: string, role: AuthRole): Promise<{ ok: boolean; error?: string }> {
  const client = getBrowserClient();

  if (!isSupabaseConfigured || !client) {
    localStorage.setItem("framr.demo.role", role);
    return { ok: true };
  }

  const signIn = await client.auth.signInWithPassword({ email, password });
  if (!signIn.error) return { ok: true };

  const message = signIn.error.message;
  if (/invalid login credentials/i.test(message)) {
    return { ok: false, error: "Invalid email or password. Try the demo credentials listed above." };
  }
  return { ok: false, error: message };
}

export async function signOut() {
  const client = getBrowserClient();
  if (client) await client.auth.signOut();
  localStorage.removeItem("framr.demo.role");
}
