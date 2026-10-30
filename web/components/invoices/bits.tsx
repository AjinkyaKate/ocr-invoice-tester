"use client";
import { useSyncExternalStore } from "react";

export function ago(iso: string, now: number) {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

// A clock that ticks every 30s; null on the server so server and client HTML match.
const tick = (cb: () => void) => { const t = setInterval(cb, 30_000); return () => clearInterval(t); };
const useNow = () => useSyncExternalStore(tick, () => Math.floor(Date.now() / 30_000) * 30_000, () => null);

/** Relative time, e.g. "12m ago". */
export function Ago({ iso }: { iso: string }) {
  const now = useNow();
  return <span>{now ? ago(iso, now) : ""}</span>;
}

// The theme lives on <html class="dark">; watch it so every toggle stays in sync.
const watchTheme = (cb: () => void) => { const o = new MutationObserver(cb); o.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] }); return () => o.disconnect(); };
export const useDark = () => useSyncExternalStore(watchTheme, () => document.documentElement.classList.contains("dark"), () => false);
export function toggleTheme() {
  const next = !document.documentElement.classList.contains("dark");
  document.documentElement.classList.toggle("dark", next);
  try { localStorage.setItem("theme", next ? "dark" : "light"); } catch {}
}
