/** Design reference: Home reassembles the original FRAMR story from dedicated, independently maintainable sections. */
import { useState } from "react";
import { FramrMark } from "@/components/framr/FramrMark";
import { FramrButton } from "@/components/framr/FramrPrimitives";
import { AdvertiserSection, CreatorSection, Hero, LandingFooter, MultipleLives, Timeline } from "@/components/framr/LandingSections";
import { SignInModal } from "@/components/framr/WorkspaceModals";
import { ArrowRight } from "lucide-react";

export default function Home({ onEnter }: { onEnter: (role: "creator" | "advertiser") => void }) {
  const [signInOpen, setSignInOpen] = useState(false);
  const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return <div className="min-h-screen bg-paper text-ink"><header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur"><div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-5"><FramrMark onNavigate={() => window.scrollTo({ top: 0, behavior: "smooth" })} /><nav className="hidden items-center gap-7 text-sm font-medium text-inksoft md:flex" aria-label="Landing sections"><button onClick={() => goTo("for-creators")} className="transition hover:text-ink">Creators</button><button onClick={() => goTo("for-advertisers")} className="transition hover:text-ink">Advertisers</button><button onClick={() => goTo("how")} className="transition hover:text-ink">How it works</button></nav><div className="ml-auto flex items-center gap-3"><FramrButton variant="ghost" size="sm" className="hidden sm:inline-flex" onClick={() => setSignInOpen(true)}>Sign in</FramrButton><FramrButton size="sm" onClick={() => onEnter("creator")}>Create a placement <ArrowRight size={14} /></FramrButton></div></div></header><main><Hero onCreator={() => onEnter("creator")} onAdvertiser={() => onEnter("advertiser")} /><MultipleLives /><CreatorSection onCreator={() => onEnter("creator")} /><AdvertiserSection onAdvertiser={() => onEnter("advertiser")} /><Timeline /><LandingFooter onCreator={() => onEnter("creator")} onAdvertiser={() => onEnter("advertiser")} /></main><SignInModal open={signInOpen} onOpenChange={setSignInOpen} onEnter={onEnter} /></div>;
}

