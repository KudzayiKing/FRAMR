/** Design reference: Home reassembles the original FRAMR story from dedicated, independently maintainable sections. */
"use client";

import { ArrowRight, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import ErrorBoundary from "@/components/ErrorBoundary";
import { FramrMark } from "@/components/framr/FramrMark";
import { FramrButton } from "@/components/framr/FramrPrimitives";
import { AdvertiserSection, CreatorSection, Hero, LandingFooter, MultipleLives, Timeline } from "@/components/framr/LandingSections";
import { signOut } from "@/lib/auth";

export default function LandingClient({ sessionEmail }: { sessionEmail?: string }) {
  const router = useRouter();
  const enter = (role: "creator" | "advertiser") => router.push(sessionEmail ? `/workspace?role=${role}` : "/signin");
  const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const handleSignOut = async () => {
    await signOut();
    router.refresh();
  };
  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-paper text-ink"><header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur"><div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-5"><FramrMark onNavigate={() => window.scrollTo({ top: 0, behavior: "smooth" })} /><nav className="hidden items-center gap-7 text-sm font-medium text-inksoft md:flex" aria-label="Landing sections"><button onClick={() => goTo("for-creators")} className="transition hover:text-ink">Creators</button><button onClick={() => goTo("for-advertisers")} className="transition hover:text-ink">Advertisers</button><button onClick={() => goTo("how")} className="transition hover:text-ink">How it works</button></nav><div className="ml-auto flex items-center gap-3">{sessionEmail ? <><span className="hidden text-xs font-semibold text-inksoft sm:inline">{sessionEmail}</span><FramrButton size="sm" onClick={() => router.push("/workspace?role=creator")}>Workspace <ArrowRight size={14} /></FramrButton><button onClick={handleSignOut} title="Sign out" aria-label="Sign out" className="p-2 text-inksoft transition hover:text-accent"><LogOut size={16} /></button></> : <><FramrButton variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => router.push("/signin")}>Sign in</FramrButton><FramrButton size="sm" onClick={() => enter("creator")}>Create a placement <ArrowRight size={14} /></FramrButton></>}</div></div></header><main><Hero onCreator={() => enter("creator")} onAdvertiser={() => enter("advertiser")} /><MultipleLives /><CreatorSection onCreator={() => enter("creator")} /><AdvertiserSection onAdvertiser={() => enter("advertiser")} /><Timeline /><LandingFooter onCreator={() => enter("creator")} onAdvertiser={() => enter("advertiser")} /></main></div>
    </ErrorBoundary>
  );
}
