/** Design reference: these sections reproduce the original editorial landing narrative and media-first composition. */
import { ArrowRight, Clock3, Download, Layers3, ScanSearch, ShieldCheck, Smartphone, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { IMG } from "@/data/framr";
import { FrameCorners } from "./FrameCorners";
import { Chip, FramrButton, FramedCard } from "./FramrPrimitives";

type LandingProps = { onCreator: () => void; onAdvertiser: () => void; onSignIn: () => void };

export function Hero({ onCreator, onAdvertiser }: Pick<LandingProps, "onCreator" | "onAdvertiser">) {
  const slides = [
    { label: "Original", sub: "no sponsor", image: IMG.original, chip: "Rice cooker · placement detected" },
    { label: "Auris Model A", sub: "+$320", image: IMG.auris, chip: "Auris Model A · placed" },
    { label: "Nordpeak Steel 900", sub: "+$280", image: IMG.nordpeak, chip: "Nordpeak Steel 900 · placed" },
  ];
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const interval = window.setInterval(() => { if (!paused) setActive((index) => (index + 1) % slides.length); }, 4200);
    return () => window.clearInterval(interval);
  }, [paused, slides.length]);
  const select = (index: number) => { setActive(index); setPaused(true); window.setTimeout(() => setPaused(false), 9000); };
  return (
    <section className="mx-auto grid max-w-7xl items-center gap-14 px-5 pb-24 pt-16 lg:grid-cols-2">
      <div>
        <Chip className="bg-ink text-paper"><span className="rec-dot" />PROGRAMMABLE VIDEO PLACEMENT</Chip>
        <h1 className="mt-6 max-w-3xl text-5xl font-extrabold leading-[1.02] tracking-[-.045em] sm:text-6xl xl:text-7xl">Change what&apos;s in the <span className="relative inline-block px-2 text-accent"><FrameCorners />frame</span>.</h1>
        <p className="serif-italic mt-6 text-xl text-inksoft sm:text-2xl">Content stays. Commerce changes.</p>
        <p className="mt-4 max-w-md leading-relaxed text-inksoft">FRAMR lets creators turn existing videos into new commercial opportunities — without reshooting. One video, multiple commercial lives.</p>
        <div className="mt-8 flex flex-wrap gap-3"><FramrButton variant="accent" onClick={onCreator}>Create a placement <ArrowRight size={16} /></FramrButton><FramrButton variant="ghost" onClick={onAdvertiser}>Find placements</FramrButton></div>
        <div className="mt-10 flex flex-wrap gap-x-6 gap-y-2 text-[11px] font-semibold tracking-wide text-inksoft">
          <span className="flex items-center gap-1.5"><Smartphone size={14} />1080×1920 MP4</span><span className="flex items-center gap-1.5"><Clock3 size={14} />15–60s SHORT-FORM</span><span className="flex items-center gap-1.5"><Layers3 size={14} />UNLIMITED VERSIONS</span><span className="flex items-center gap-1.5"><ShieldCheck size={14} />CREATOR APPROVAL BUILT-IN</span>
        </div>
      </div>
      <div className="relative mx-auto w-[290px] sm:w-[330px]">
        <FrameCorners className="-m-4 text-ink/60" />
        <div className="relative aspect-[9/16] overflow-hidden rounded-[26px] bg-night ring-1 ring-ink/20 shadow-lift">
          {slides.map((slide, index) => <img key={slide.label} src={slide.image} alt={slide.label} className={`hero-image ${index === active ? "hero-image--active" : ""}`} />)}
          <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-night/70 to-transparent" /><div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-night/80 to-transparent" />
          <div className="absolute inset-x-4 top-3 flex items-center justify-between text-[10px] font-bold tracking-wider text-white/90"><span className="flex items-center gap-1.5"><span className="rec-dot" />REC 00:14</span><span>1080×1920 · 24FPS</span></div>
          <div className="absolute pop-marker" style={{ left: "45%", top: "11%", width: "49%", height: "47%" }}><FrameCorners className="text-accent" /><Chip className="absolute -bottom-7 left-0 whitespace-nowrap bg-night/85 text-white backdrop-blur">{slides[active].chip}</Chip></div>
          <div className="absolute inset-x-4 bottom-3 text-white"><div className="text-[11px] font-bold">Perfect Fried Rice</div><div className="text-[10px] text-white/70">@lena.cooks · 00:12 / 00:34</div></div>
        </div>
        <div className="mt-8"><div className="mb-2 text-[10px] font-bold uppercase tracking-[.16em] text-inksoft">Swap the product — the video stays</div><div className="flex flex-wrap gap-2">{slides.map((slide, index) => <FramrButton key={slide.label} size="sm" variant={active === index ? "dark" : "ghost"} aria-pressed={active === index} onClick={() => select(index)}><span className={`h-2 w-2 rounded-full ${index === 0 ? "bg-inksoft" : "bg-accent"}`} />{slide.label}<span className="text-[10px] opacity-60">{slide.sub}</span></FramrButton>)}</div></div>
      </div>
    </section>
  );
}

export function MultipleLives() {
  const versions = [{ title: "Original", copy: "Source · never modified", label: "MASTER", image: IMG.original, accent: false }, { title: "Auris Model A", copy: "Active · Jul 20 – Aug 30", label: "+$320", image: IMG.auris, accent: true }, { title: "Nordpeak Steel 900", copy: "Draft · awaiting export", label: "+$280", image: IMG.nordpeak, accent: false }];
  return <section className="border-y border-line bg-paper2/50"><div className="mx-auto max-w-7xl px-5 py-24"><div className="max-w-2xl reveal"><div className="serif-italic text-lg text-accent">One video. Multiple commercial lives.</div><h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-5xl">Your best video keeps earning — long after posting day.</h2></div><div className="mt-12 grid gap-4 sm:grid-cols-3">{versions.map((version) => <FramedCard key={version.title} interactive className="group overflow-hidden"><div className="aspect-[9/10] overflow-hidden"><img className="h-full w-full object-cover transition duration-700 group-hover:scale-[1.03]" src={version.image} alt={`${version.title} version`} /></div><div className="flex items-center justify-between p-4"><div><div className="text-sm font-bold">{version.title}</div><div className="text-[11px] text-inksoft">{version.copy}</div></div><Chip className={version.accent ? "bg-accent-soft text-accent" : "bg-paper2 text-inksoft"}>{version.label}</Chip></div></FramedCard>)}</div></div></section>;
}

export function CreatorSection({ onCreator }: Pick<LandingProps, "onCreator">) {
  const steps = [["1 · Upload", "Drop in any 9:16 video, 15–60s. It stays private and untouched.", Upload, false], ["2 · Detect", "Scene analysis finds placement opportunities with visibility scores.", ScanSearch, false], ["3 · Replace", "Pick your own product or accept a sponsor. AI renders a new version.", Layers3, true], ["4 · Export", "1080×1920 MP4, audio preserved. Publish anywhere you already post.", Download, false]] as const;
  return <section id="for-creators" className="mx-auto grid max-w-7xl items-center gap-14 px-5 py-24 lg:grid-cols-2"><div className="reveal"><div className="serif-italic text-lg text-accent">For creators</div><h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">Your content already exists.<br />Make it work again.</h2><p className="mt-5 max-w-md leading-relaxed text-inksoft">Upload the vertical videos you&apos;ve already made. FRAMR finds the products in your frame, and turns them into sponsored, exportable versions — no reshoot, no editing suite.</p><FramrButton className="mt-8" onClick={onCreator}>Start creating <ArrowRight size={16} /></FramrButton></div><div id="how" className="grid gap-4 sm:grid-cols-2">{steps.map(([title, copy, Icon, accent]) => <FramedCard key={title} interactive className="reveal p-5"><span className={`flex h-9 w-9 items-center justify-center rounded-lg ${accent ? "bg-accent text-white" : "bg-ink text-paper"}`}><Icon size={16} /></span><div className="mt-4 text-sm font-bold">{title}</div><p className="mt-1.5 text-xs leading-relaxed text-inksoft">{copy}</p></FramedCard>)}</div></section>;
}

export function AdvertiserSection({ onAdvertiser }: Pick<LandingProps, "onAdvertiser">) {
  const placements = [[IMG.original, "RICE COOKER · 12.4s · $320"], [IMG.espresso, "ESPRESSO · 8.2s · $180"], [IMG.headphones, "HEADPHONES · 6.8s · $450"]] as const;
  return <section id="for-advertisers" className="bg-night text-paper"><div className="mx-auto grid max-w-7xl items-center gap-14 px-5 py-24 lg:grid-cols-2"><div className="order-2 grid gap-3 reveal lg:order-1"><div className="grid grid-cols-3 gap-3">{placements.map(([image, label], index) => <div key={label} className="frame-grow relative overflow-hidden rounded-lg"><FrameCorners className={`m-1.5 z-10 ${index === 0 ? "text-accent" : "text-white/50"}`} /><img src={image} alt={label} className="aspect-[9/14] w-full object-cover" /></div>)}</div><div className="flex items-center justify-between px-1 text-[11px] font-semibold tracking-wider text-white/60">{placements.map(([, label], index) => <span className={index === 2 ? "hidden sm:block" : ""} key={label}>{label}</span>)}</div></div><div className="order-1 reveal lg:order-2"><div className="serif-italic text-lg text-accent">For advertisers</div><h2 className="mt-3 text-3xl font-extrabold leading-tight tracking-tight sm:text-5xl">Don&apos;t interrupt the content.<br />Become part of it.</h2><p className="mt-5 max-w-md leading-relaxed text-white/60">Browse real creator frames, reserve the exact object and seconds your product should occupy, and track every generated version. You&apos;re buying a placement — not a shout-out.</p><FramrButton variant="accent" className="mt-8" onClick={onAdvertiser}>Find placements <ArrowRight size={16} /></FramrButton></div></div></section>;
}

export function Timeline() {
  const entries = [["MAR 02 · UPLOADED", "Original published", "One cooking video, zero ad value left behind.", false], ["MAR 14 · AURIS", "First sponsored version", "Rice cooker replaced · +$320 · exported to TikTok.", true], ["JUL 20 · NORDPEAK", "Second commercial life", "Same footage, new brand, new quarter's budget.", false], ["NEXT", "Your next sponsor", "The frame stays open for future campaigns.", false]] as const;
  return <section className="mx-auto max-w-7xl px-5 py-24"><div className="max-w-2xl reveal"><div className="serif-italic text-lg text-accent">Commercial inventory over time</div><h2 className="mt-3 text-3xl font-extrabold tracking-tight sm:text-5xl">Yesterday&apos;s video. Tomorrow&apos;s sponsor.</h2></div><div className="relative mt-16 reveal"><div className="absolute left-0 right-0 top-[7px] h-0.5 bg-line" /><div className="grid grid-cols-2 gap-8 md:grid-cols-4">{entries.map(([date, title, copy, active]) => <div className={`timeline-node relative pt-8 ${active ? "timeline-node--active" : ""}`} key={date}><div className={`text-[11px] font-bold ${active ? "text-accent" : "text-inksoft"}`}>{date}</div><div className="mt-1 text-sm font-bold">{title}</div><p className="mt-1 text-xs text-inksoft">{copy}</p></div>)}</div></div></section>;
}

export function LandingFooter({ onCreator, onAdvertiser }: Pick<LandingProps, "onCreator" | "onAdvertiser">) {
  return <section className="bg-night text-paper"><div className="mx-auto max-w-4xl px-5 py-28 text-center reveal"><span className="relative mx-auto mb-8 block h-10 w-10 text-accent"><FrameCorners /></span><h2 className="serif-italic text-4xl leading-tight sm:text-6xl">Your content isn&apos;t finished.</h2><p className="mt-4 text-2xl font-extrabold tracking-tight sm:text-3xl">Make it programmable.</p><div className="mt-10 flex flex-wrap justify-center gap-3"><FramrButton variant="accent" onClick={onCreator}>Start creating</FramrButton><FramrButton variant="light" onClick={onAdvertiser}>Find placements</FramrButton></div></div><footer className="border-t border-white/10"><div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-5 py-10 text-xs text-white/50 md:flex-row"><span className="wordmark tracking-[.05em] text-white/80">FRAMR</span><span>Programmable video placement · Not a social network — we power the ones you use.</span><span>Demo build · seeded data · © 2026</span></div></footer></section>;
}

