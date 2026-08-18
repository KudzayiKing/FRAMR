/** Design reference: widely tracked all-caps wordmark in Ramabhadra, paired with a centered square dot framed by the four-corner motif. */
import { cn } from "@/lib/utils";
import { FrameCorners } from "./FrameCorners";

export function FramrMark({ compact = false, onNavigate, className }: { compact?: boolean; className?: string; onNavigate?: () => void }) {
  return (
    <button type="button" onClick={onNavigate} aria-label="FRAMR home" className={cn("wordmark inline-flex select-none items-center gap-2.5 tracking-[.05em] text-ink", compact ? "text-sm" : "text-lg", !onNavigate && "pointer-events-none", onNavigate && "cursor-pointer transition-opacity hover:opacity-70", className)}>
      <span className={cn("relative flex items-center justify-center text-accent", compact ? "h-4 w-4" : "h-5 w-5")}>
        <FrameCorners />
        <span className={cn("bg-accent", compact ? "h-1 w-1" : "h-1.5 w-1.5")} />
      </span>
      FRAMR
    </button>
  );
}
