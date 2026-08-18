/** Design reference: restrained sign-in screen; routes through Supabase Auth when configured, demo fallback otherwise. */
"use client";

import { useState } from "react";
import { Clapperboard, Loader2, Megaphone, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { Toaster } from "@/components/ui/sonner";
import ErrorBoundary from "@/components/ErrorBoundary";
import { FramrButton } from "@/components/framr/FramrPrimitives";
import { cn } from "@/lib/utils";
import { resolveSession, type AuthRole } from "@/lib/auth";
import { isSupabaseConfigured } from "@/lib/supabase-browser";

export default function SignInPage() {
  const router = useRouter();
  const [role, setRole] = useState<AuthRole>("creator");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = isSupabaseConfigured
      ? await resolveSession(email, password, role)
      : { ok: true };
    if (!result.ok) {
      setError(result.error ?? "Sign-in failed.");
      setBusy(false);
      return;
    }
    router.replace(`/workspace?role=${role}`);
  };

  return (
    <ErrorBoundary>
      <Toaster richColors position="bottom-center" />
      <div className="flex min-h-screen items-center justify-center bg-paper p-5 text-ink">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-extrabold tracking-tight">Sign in to FRAMR</h1>
          <p className="mt-1 text-sm text-inksoft">Choose a workspace, then confirm your credentials.</p>
          {isSupabaseConfigured ? (
            <p className="mt-3 flex items-center gap-2 rounded-md border border-line bg-paper2/60 px-3 py-2 text-xs text-inksoft">
              <ShieldCheck size={14} className="text-accent" />
              <span>
                Demo accounts: <span className="font-semibold text-ink">lena.cooks@framr.demo</span> (creator) or <span className="font-semibold text-ink">auris@framr.demo</span> (advertiser) — password <span className="font-semibold text-ink">framr-demo</span>.
              </span>
            </p>
          ) : (
            <p className="mt-3 flex items-center gap-2 rounded-md border border-line bg-paper2/60 px-3 py-2 text-xs text-inksoft">
              <ShieldCheck size={14} className="text-accent" />
              Running in demo mode — Supabase is not configured, any credentials continue.
            </p>
          )}
          <form onSubmit={submit} className="mt-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setRole("creator")} className={cn("relative flex items-center gap-3 rounded-lg border p-4 text-left transition", role === "creator" ? "border-ink bg-paper2/70" : "border-line hover:border-ink/40")}>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink text-paper"><Clapperboard size={18} /></span>
                <span className="text-sm font-bold">Creator</span>
              </button>
              <button type="button" onClick={() => setRole("advertiser")} className={cn("relative flex items-center gap-3 rounded-lg border p-4 text-left transition", role === "advertiser" ? "border-accent bg-accent-soft/60" : "border-line hover:border-accent/50")}>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-white"><Megaphone size={18} /></span>
                <span className="text-sm font-bold">Advertiser</span>
              </button>
            </div>
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-semibold text-inksoft">Email</span>
              <input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} disabled={!isSupabaseConfigured} placeholder="you@example.com" className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none transition focus:border-ink/60 disabled:opacity-50" />
            </label>
            <label className="block text-sm">
              <span className="mb-1.5 block text-xs font-semibold text-inksoft">Password</span>
              <input required type="password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={!isSupabaseConfigured} placeholder="••••••••" className="h-10 w-full rounded-md border border-line bg-white px-3 text-sm outline-none transition focus:border-ink/60 disabled:opacity-50" />
            </label>
            {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
            <FramrButton type="submit" className="w-full" disabled={busy}>
              {busy ? <><Loader2 size={16} className="animate-spin" /> Signing in…</> : "Continue"}
            </FramrButton>
          </form>
        </div>
      </div>
    </ErrorBoundary>
  );
}
