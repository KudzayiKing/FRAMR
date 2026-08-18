/** Design reference: the reusable four-corner framing motif anchors every FRAMR media interaction. */
import { cn } from "@/lib/utils";

export function FrameCorners({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("frame-corners", className)} />;
}

