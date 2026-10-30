"use client";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { analyze, boxFor, initials, money, niceDate, type Analysis, type FieldKey, type Flag } from "@/lib/invoices/analyze";
import { actions, useInvoices } from "@/lib/invoices/store";
import type { Box, Field, Invoice, Line } from "@/lib/invoices/types";
import { ActionButton } from "@/components/ui/action-button";
import { BarsTheme } from "@/components/ui/bars-theme";
import { go } from "./nav";

const ease = [0.22, 1, 0.36, 1] as const;
const item = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.45, ease } } };

/** What the right panel shows: final values (with the user's edits) or the fields still streaming in. */
type Shown = {
  vendor: string | null; number: string | null; date: string | null;
  subtotal: number | null; tax: number | null; total: number | null;
  items: { desc: string; qty: number | null; rate: number | null; amount: number | null; derived?: boolean }[];
  fields: Partial<Record<FieldKey, Field<unknown>>>; // for outlines on the image
  lines: Line[];
};

export function ReviewView({ id }: { id: string }) {
  const { invoices } = useInvoices();
  const inv = invoices.find((i) => i.id === id);
  const [hover, setHover] = useState<string | null>(null); // highlight key: "f:total", "i:3"
  const [focus, setFocus] = useState(0);
  const a = useMemo(() => (inv && ["review", "done", "rejected"].includes(inv.status) ? analyze(inv) : null), [inv]);
  const unresolved = useMemo(() => a?.unresolved ?? [], [a]);
  const flagRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const keyed = useRef(false);

  const editable = inv?.status === "review";
  const next = invoices.find((i) => i.status === "review" && i.id !== id);
  const approve = () => {
    if (!inv || unresolved.length) return;
    actions.approve(inv.id);
    go(next?.id);
  };

  // keyboard: J/K move between questions, 1-3 answer, Enter approves, Esc goes back
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!inv || (e.target as HTMLElement).closest("input, textarea")) return;
      if (e.key === "Escape") go(null);
      if (!editable || !a) return;
      const open = a.unresolved;
      if (["j", "k", "ArrowDown", "ArrowUp"].includes(e.key)) keyed.current = true;
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setFocus((f) => Math.min(f + 1, Math.max(open.length - 1, 0))); }
      if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setFocus((f) => Math.max(f - 1, 0)); }
      const n = Number(e.key);
      const f = open[Math.min(focus, open.length - 1)];
      if (f && n >= 1 && n <= f.options.length && f.options[n - 1].id !== "edit") actions.decide(inv.id, f.id, f.options[n - 1].id);
      if (e.key === "Enter" && !open.length && !(e.target as HTMLElement).closest("button")) approve();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
  useEffect(() => {
    const f = unresolved[Math.min(focus, unresolved.length - 1)];
    if (f && keyed.current) flagRefs.current[f.id]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [focus, unresolved]);
  useEffect(() => {
    if (hover) rowRefs.current[hover]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [hover]);

  if (!inv) return <p className="text-muted-foreground">Not found. <button onClick={() => go(null)} className="underline">Back</button></p>;

  const p = inv.partial;
  const shown: Shown | null = a
    ? {
        vendor: a.value("vendor") as string | null, number: a.value("number") as string | null, date: a.value("date") as string | null,
        subtotal: a.value("subtotal") as number | null, tax: a.value("tax") as number | null, total: a.value("total") as number | null,
        items: a.lines.map((r) => ({ desc: r.desc, qty: r.qty, rate: r.rate, amount: r.amount, derived: r.derived })),
        fields: { vendor: inv.vendor, number: inv.number, date: inv.date, subtotal: inv.subtotal, tax: inv.tax, total: inv.total }, lines: inv.lines,
      }
    : p
      ? {
          vendor: p.vendor?.value ?? null, number: p.number?.value ?? null, date: p.date?.value ?? null,
          subtotal: p.subtotal?.value ?? null, tax: p.tax?.value ?? null, total: p.total?.value ?? null,
          items: (p.items ?? []).map((l) => ({ desc: l.desc, qty: l.qty, rate: l.rate, amount: l.amount })),
          fields: { vendor: p.vendor, number: p.number, date: p.date, subtotal: p.subtotal, tax: p.tax, total: p.total }, lines: p.items ?? [],
        }
      : null;
  const live = !a && !!shown;
  const cur = a ? inv.currency : (p?.currency ?? inv.currency);
  const focused = unresolved[Math.min(focus, unresolved.length - 1)];
  const keyOf = (f?: Flag) => (f?.field ? `f:${f.field}` : f?.line !== undefined ? `i:${f.line}` : null);
  const lit = hover ?? keyOf(focused);

  return (
    <div>
      <div className="flex h-8 items-center gap-3 text-sm">
        <button onClick={() => go(null)} className="text-muted-foreground hover:text-foreground">← All invoices</button>
        {(inv.status === "done" || inv.status === "rejected") && <span className="ms-auto text-muted-foreground">{inv.status === "done" ? "Approved" : "Rejected"}</span>}
      </div>

      {/* one layout that changes shape: the invoice alone while it is read, then the invoice + details */}
      <motion.div layout transition={{ duration: 0.6, ease }} className={`mt-6 ${shown ? "grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]" : "flex flex-col items-center"}`}>
        <motion.div layout transition={{ duration: 0.6, ease }} className={shown ? "lg:sticky lg:top-6 lg:self-start" : "flex w-full flex-col items-center"}>
          <Doc inv={inv} shown={shown} final={!!a} lit={lit} setHover={setHover} />
          {!shown && <Status inv={inv} />}
        </motion.div>

        {shown && (
          <motion.div initial="hidden" animate="show" variants={{ show: { transition: { staggerChildren: 0.08, delayChildren: 0.25 } } }} className="min-w-0 space-y-10">
            <motion.div variants={item}>
              <Hero inv={inv} shown={shown} a={a} live={live} cur={cur} editable={editable} lit={lit} setHover={setHover} />
            </motion.div>

            {a && (
              <motion.section variants={item} className="space-y-2">
                <AnimatePresence initial={false}>
                  {editable && unresolved.map((f) => (
                    <motion.div key={f.id} layout exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.3, ease }}>
                      <FlagCard f={f} inv={inv} focused={f === focused} refEl={(el) => { flagRefs.current[f.id] = el; }} onHover={(on) => setHover(on ? keyOf(f) : null)} />
                    </motion.div>
                  ))}
                </AnimatePresence>
                <Checks a={a} />
              </motion.section>
            )}

            <motion.section variants={item}>
              <Items inv={inv} shown={shown} live={live} cur={cur} editable={editable} lit={lit} setHover={setHover} rowRefs={rowRefs} />
            </motion.section>
          </motion.div>
        )}
      </motion.div>

      <AnimatePresence>
        {editable && (
          <motion.div initial={{ y: 80 }} animate={{ y: 0 }} exit={{ y: 80 }} transition={{ duration: 0.45, ease, delay: 0.5 }}
            className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/90 backdrop-blur">
            <div className="mx-auto flex max-w-6xl items-center justify-end gap-2 px-4 py-3 sm:px-6">
              <button onClick={() => { actions.reject(inv.id); go(null); }} className="rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground">Reject</button>
              <ActionButton size="sm" disabled={unresolved.length > 0} minPendingMs={400}
                idleLabel={unresolved.length ? `${unresolved.length} to check` : "Approve"} pendingLabel="Saving…" successLabel="Approved"
                onAction={async () => { await new Promise((r) => setTimeout(r, 250)); approve(); }} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const pos = ([x, y, w, h]: Box, pad = 0) => ({ left: `${(x - pad) * 100}%`, top: `${(y - pad) * 100}%`, width: `${(w + 2 * pad) * 100}%`, height: `${(h + 2 * pad) * 100}%` });

/** A soft placeholder bar for a value that hasn't arrived yet. */
const Pending = ({ w = "w-24" }: { w?: string }) => <span className={`text-wave inline-block h-[0.9em] translate-y-[0.1em] rounded bg-secondary ${w}`} />;

/** The top of the panel: who, which invoice, and how much, plus the overall state. */
function Hero({ inv, shown, a, live, cur, editable, lit, setHover }: { inv: Invoice; shown: Shown; a: Analysis | null; live: boolean; cur?: string | null; editable: boolean; lit: string | null; setHover: (k: string | null) => void }) {
  const open = a?.unresolved.length ?? 0;
  const edit = (k: FieldKey, display: string, raw: unknown, numeric = false) => <Editable inv={inv} k={k} display={display} raw={raw} numeric={numeric} enabled={editable} />;
  const hl = (k: FieldKey) => ({ onMouseEnter: () => setHover(`f:${k}`), onMouseLeave: () => setHover(null), className: lit === `f:${k}` ? "text-accent" : "" });
  const date = niceDate(shown.date);
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-sm text-foreground">{shown.vendor ? initials(shown.vendor) : <BarsTheme state="thinking" volume={0.4} size={14} />}</span>
          <div className="min-w-0">
            <p {...hl("vendor")} className={`truncate text-foreground ${hl("vendor").className}`}>{shown.vendor ? edit("vendor", shown.vendor, shown.vendor) : live ? <Pending w="w-40" /> : "Unknown vendor"}</p>
            <p className="truncate text-sm text-muted-foreground">
              <span {...hl("number")}>{shown.number ? <>Invoice #{edit("number", shown.number, shown.number)}</> : live ? <Pending w="w-20" /> : "No invoice number"}</span>
              <span className="text-faint"> · </span>
              <span {...hl("date")}>{date ? edit("date", date, shown.date) : live ? <Pending w="w-20" /> : "No date"}</span>
            </p>
          </div>
        </div>
        <StatusChip live={live} open={open} done={inv.status === "done"} />
      </div>
      <p {...hl("total")} className={`mt-6 text-4xl tracking-tight tabular-nums text-foreground ${hl("total").className}`}>
        {shown.total !== null ? edit("total", money(shown.total, cur), shown.total, true) : live ? <Pending w="w-44" /> : "–"}
      </p>
      {(shown.subtotal !== null || shown.tax !== null) && (
        <p className="mt-1 text-sm text-muted-foreground tabular-nums">
          {shown.subtotal !== null && <span {...hl("subtotal")}>Subtotal {money(shown.subtotal, cur)}</span>}
          {shown.subtotal !== null && shown.tax !== null && <span className="text-faint"> · </span>}
          {shown.tax !== null && <span {...hl("tax")}>Tax {money(shown.tax, cur)}</span>}
        </p>
      )}
    </div>
  );
}

function StatusChip({ live, open, done }: { live: boolean; open: number; done: boolean }) {
  const [label, tone] = live ? ["Reading", "bg-secondary text-muted-foreground"]
    : done ? ["Approved", "bg-secondary text-muted-foreground"]
    : open ? [`${open} to check`, "bg-amber-500/10 text-amber-700 dark:text-amber-400"]
    : ["All checks passed", "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"];
  return (
    <AnimatePresence mode="wait">
      <motion.span key={label} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} transition={{ duration: 0.2 }}
        className={`flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${tone}`}>
        {live ? <BarsTheme state="thinking" volume={0.5} size={12} /> : <span className={`size-1.5 rounded-full ${open && !done ? "bg-amber-500" : done ? "bg-muted-foreground" : "bg-emerald-500"}`} />}
        {label}
      </motion.span>
    </AnimatePresence>
  );
}

/** The checks that passed, so it's clear what was verified (failures show as questions above). */
function Checks({ a }: { a: Analysis }) {
  const passed = a.checks.filter((c) => c.ok);
  if (!passed.length) return null;
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1.5 pt-1 text-xs text-muted-foreground">
      {passed.map((c) => (
        <li key={c.label} className="flex items-center gap-1.5">
          <svg viewBox="0 0 16 16" className="size-3.5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 8.5 3 3 6-7" /></svg>
          {c.label}
        </li>
      ))}
    </ul>
  );
}

/** Line items as an aligned table; every value click-to-edit once final. */
function Items({ inv, shown, live, cur, editable, lit, setHover, rowRefs }: { inv: Invoice; shown: Shown; live: boolean; cur?: string | null; editable: boolean; lit: string | null; setHover: (k: string | null) => void; rowRefs: React.RefObject<Record<string, HTMLDivElement | null>> }) {
  const cols = "grid grid-cols-[minmax(0,1fr)_3rem_5.5rem_6.5rem] items-start gap-x-3";
  const field = (i: number, k: "desc" | "qty" | "rate" | "amount", display: string, raw: string | number | null) =>
    live ? <>{display}</> : <Editable inv={inv} k={`line:${i}:${k}`} display={display} raw={raw} numeric={k !== "desc"} enabled={editable} />;
  if (!shown.items.length) return live ? <div className="space-y-3"><Pending w="w-full" /><Pending w="w-3/4" /></div> : <p className="text-sm text-faint">No items found.</p>;
  return (
    <div className="text-sm">
      <div className={`${cols} border-b border-border pb-2 text-xs text-faint`}>
        <span>Item</span><span className="text-right">Qty</span><span className="text-right">Price</span><span className="text-right">Amount</span>
      </div>
      <AnimatePresence initial={false}>
        {shown.items.map((r, i) => (
          <motion.div key={i} ref={(el) => { rowRefs.current[`i:${i}`] = el; }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease }}
            onMouseEnter={() => setHover(`i:${i}`)} onMouseLeave={() => setHover(null)}
            className={`${cols} -mx-2 rounded-md border-b border-border px-2 py-2.5 transition-colors last:border-b-0 ${lit === `i:${i}` ? "bg-secondary" : ""}`}>
            <span className="min-w-0 text-foreground">{field(i, "desc", r.desc, r.desc)}</span>
            <span className="text-right tabular-nums text-muted-foreground">{field(i, "qty", r.qty === null ? "–" : `${r.qty}`, r.qty)}</span>
            <span className="text-right tabular-nums text-muted-foreground">{field(i, "rate", r.rate === null ? "–" : money(r.rate, cur), r.rate)}</span>
            <span className="text-right tabular-nums text-foreground" title={r.derived ? "Worked out as qty × price" : undefined}>{field(i, "amount", money(r.amount, cur), r.amount)}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * The invoice image on a soft "desk". While it is read: a scan beam, then every piece of text OCR found pops in
 * and shimmers. As fields arrive, the place each value was read from lights up.
 */
function Doc({ inv, shown, final, lit, setHover }: { inv: Invoice; shown: Shown | null; final: boolean; lit: string | null; setHover: (k: string | null) => void }) {
  const boxes: [string, Box][] = [];
  if (shown) {
    for (const k of ["vendor", "number", "date", "subtotal", "tax", "total"] as FieldKey[]) { const f = shown.fields[k]; const b = f && boxFor(inv, f.lines); if (b) boxes.push([`f:${k}`, b]); }
    shown.lines.forEach((l, i) => { const b = boxFor(inv, l.lines ?? []); if (b) boxes.push([`i:${i}`, b]); });
  }
  const found = useMemo(() => [...(inv.ocr?.lines ?? [])].sort((p, q) => p.box[1] - q.box[1] || p.box[0] - q.box[0]), [inv.ocr]);

  return (
    <div className={`w-full rounded-2xl bg-secondary/70 ${shown ? "p-4 sm:p-6" : "p-6 sm:p-10"} transition-[padding] duration-500`}>
      <motion.div layoutId={`doc-${inv.id}`} transition={{ duration: 0.6, ease }} className="relative mx-auto w-fit max-w-full overflow-hidden rounded-md bg-white shadow-[0_1px_2px_rgba(0,0,0,0.06),0_8px_24px_-6px_rgba(0,0,0,0.12)]">
        {/* eslint-disable-next-line @next/next/no-img-element -- the user's own upload (data URL) */}
        <img src={inv.image} alt={inv.name} className={`block h-auto w-auto max-w-full dark:brightness-[0.92] ${shown ? "max-h-[calc(100dvh-11rem)]" : "max-h-[62dvh]"}`} />

        {inv.status === "reading" && <div className="scan-beam" />}

        {!final && found.map((l, k) => (
          <motion.div key={k} initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: shown ? 0.5 : 1, scale: 1 }} transition={{ delay: shown ? 0 : Math.min(k * 0.018, 1.6), duration: 0.35, ease }}
            className="pointer-events-none absolute rounded-[2px] bg-[#1100ff]/12" style={pos(l.box)}>
            {inv.status === "understanding" && <div className="text-wave h-full w-full rounded-[2px] bg-[#1100ff]/15" style={{ animationDelay: `${l.box[1] * 1.6}s` }} />}
          </motion.div>
        ))}

        {boxes.map(([key, b]) => (
          <motion.button key={key} type="button" aria-label={`Show ${key}`}
            initial={{ opacity: 0, scale: 1.25 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease }}
            onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(key)}
            className={`absolute rounded-[3px] transition-colors duration-150 ${lit === key ? "bg-[#1100ff]/10 outline-2 outline-[#1100ff]" : final ? "outline-0 hover:bg-[#1100ff]/5" : "bg-[#1100ff]/10 outline outline-1 outline-[#1100ff]/60"}`}
            style={pos(b, 0.004)} />
        ))}
      </motion.div>
    </div>
  );
}

function Status({ inv }: { inv: Invoice }) {
  if (inv.status === "failed")
    return (
      <div className="mt-6 text-center text-sm">
        <p className="text-destructive">{inv.error}</p>
        <button onClick={() => actions.retry(inv.id)} className="mt-2 text-foreground underline underline-offset-4">Try again</button>
      </div>
    );
  const n = inv.ocr?.lines.length ?? 0;
  const label = inv.status === "reading" ? "Reading invoice" : "Understanding it";
  return (
    <div className="mt-6 flex flex-col items-center gap-1 text-sm">
      <div className="flex items-center gap-2 text-foreground">
        <BarsTheme state="thinking" volume={0.5} size={16} />
        <AnimatePresence mode="wait">
          <motion.span key={label} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }}>{label}</motion.span>
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {n > 0 && <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-xs text-faint">{n} pieces of text found</motion.span>}
      </AnimatePresence>
    </div>
  );
}

/** A value you can click to correct. Saves into the invoice's edits. */
function Editable({ inv, k, display, raw, numeric, enabled, flag }: { inv: Invoice; k: string; display: string; raw: unknown; numeric: boolean; enabled: boolean; flag?: string }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState("");
  if (!enabled) return <>{display}</>;
  if (!editing)
    return <button onClick={() => { setV(raw === null || raw === undefined ? "" : String(raw)); setEditing(true); }} className="max-w-full rounded-sm text-left decoration-dotted underline-offset-4 hover:underline">{display}</button>;
  const save = () => {
    const t = v.trim();
    if (t && t !== String(raw ?? "") && (!numeric || Number.isFinite(Number(t)))) actions.edit(inv.id, k, t, flag);
    setEditing(false);
  };
  return (
    <input autoFocus value={v} inputMode={numeric ? "decimal" : "text"} onChange={(e) => setV(numeric ? e.target.value.replace(/[^\d.-]/g, "") : e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }} onBlur={save}
      style={numeric ? { width: `${Math.max(v.length, 4) + 2}ch` } : undefined}
      className={`${numeric ? "text-right" : "w-full"} rounded border border-ring bg-background px-1.5 py-0.5 text-[inherit] text-foreground outline-none`} />
  );
}

function FlagCard({ f, inv, focused, refEl, onHover }: { f: Flag; inv: Invoice; focused: boolean; refEl: (el: HTMLDivElement | null) => void; onHover: (on: boolean) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(f.edit?.current ?? "");
  const save = () => { if (f.edit && v.trim()) { actions.edit(inv.id, f.edit.key, v.trim(), f.id); setEditing(false); } };
  return (
    <div ref={refEl} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}
      className={`rounded-xl border bg-amber-500/[0.04] px-4 py-3 text-sm transition-colors ${focused ? "border-amber-500/60" : "border-amber-500/25"}`}>
      <p className="flex items-center gap-2 text-foreground"><span className="size-1.5 rounded-full bg-amber-500" />{f.title}</p>
      <p className="mt-0.5 ps-3.5 text-muted-foreground">{f.detail}</p>
      <div className="mt-2.5 flex flex-wrap gap-1.5 ps-3.5">
        {editing ? (
          <>
            <input autoFocus value={v} inputMode={f.edit?.numeric ? "decimal" : "text"} onChange={(e) => setV(f.edit?.numeric ? e.target.value.replace(/[^\d.-]/g, "") : e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
              className="w-40 rounded-md border border-ring bg-background px-2 py-1 text-xs text-foreground outline-none" />
            <button onClick={save} className="rounded-md bg-foreground px-2.5 py-1 text-xs text-background">Save</button>
          </>
        ) : f.options.map((o) => (
          <button key={o.id} onClick={() => (o.id === "edit" ? setEditing(true) : actions.decide(inv.id, f.id, o.id))}
            className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground hover:bg-secondary">{o.label}</button>
        ))}
      </div>
    </div>
  );
}
