"use client";
import type { ReactNode } from "react";
import { toggleTheme, useDark } from "./bits";
import { go } from "./nav";

export function Shell({ children }: { children: ReactNode }) {
  const dark = useDark();
  const width = "max-w-6xl";
  return (
    <div className="min-h-dvh">
      <header className={`mx-auto flex h-14 items-center justify-between px-4 sm:px-6 ${width}`}>
        <button onClick={() => go(null)} className="text-foreground">Invoices</button>
        <button onClick={toggleTheme} aria-label="Toggle theme" className="grid size-8 place-items-center rounded-md text-muted-foreground hover:text-foreground">
          {dark
            ? <svg viewBox="0 0 24 24" className="size-[17px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
            : <svg viewBox="0 0 24 24" className="size-[17px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" /></svg>}
        </button>
      </header>
      <main className={`mx-auto px-4 pb-24 pt-6 sm:px-6 ${width}`}>{children}</main>
    </div>
  );
}
