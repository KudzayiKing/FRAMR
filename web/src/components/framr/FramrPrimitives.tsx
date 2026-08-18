/** Design reference: restrained editorial controls pair warm paper surfaces with ink and vermilion feedback. */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FrameCorners } from "./FrameCorners";

export function FramrButton({ variant = "dark", size = "default", className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "dark" | "accent" | "ghost" | "light"; size?: "default" | "sm" }) {
  return <button className={cn("framr-button", `framr-button--${variant}`, size === "sm" && "framr-button--sm", className)} {...props}>{children}</button>;
}

export function Chip({ className, children }: { className?: string; children: ReactNode }) {
  return <span className={cn("framr-chip", className)}>{children}</span>;
}

export function FramedCard({ className, children, interactive = false }: { className?: string; children: ReactNode; interactive?: boolean }) {
  return <div className={cn("framr-card relative", interactive && "frame-grow", className)}>{interactive && <FrameCorners className="m-1.5 text-ink/35" />}{children}</div>;
}

export function QualityChip({ quality }: { quality: "Excellent" | "Good" | "Limited" | "Fair" }) {
  const style = quality === "Excellent" ? "bg-accent text-white" : quality === "Good" ? "bg-ink text-paper" : "bg-paper2 text-inksoft";
  return <Chip className={style}>{quality}</Chip>;
}

