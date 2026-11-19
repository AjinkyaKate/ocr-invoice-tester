"use client";
// The parts of the screen that make an AI reader trustworthy to use:
// Steps (what it is doing while you wait), Explain (how this result was produced and checked),
// Feedback (was it right?), and Toasts (every action can be taken back).
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { Analysis } from "@/lib/invoices/analyze";
import { actions, useInvoices } from "@/lib/invoices/store";
import type { Invoice } from "@/lib/invoices/types";
import { BarsTheme } from "@/components/ui/bars-theme";
import { Ago } from "./bits";

const ease = [0.22, 1, 0.36, 1] as const;

/** Re-render every `ms` (for live timers). 0 = never. */
export function useTick(ms: number) {
  return useSyncExternalStore(
    (cb) => { if (!ms) return () => {}; const t = setInterval(cb, ms); return () => clearInterval(t); },
    () => (ms ? Math.floor(Date.now() / ms) : 0),
    () => 0,
  );
}

const secs = (ms?: number) => (ms === undefined ? "" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const short = (model?: string) => model?.split(" · ")[0] ?? "the model";

const Tick = () => (
  <svg viewBox="0 0 16 16" className="size-3.5 text-emerald-600 dark:text-emerald-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3.5 8.5 3 3 6-7" /></svg>
);
const Cross = () => (
  <svg viewBox="0 0 16 16" className="size-3.5 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 5l6 6M11 5l-6 6" /></svg>
);
const Dot = () => <span className="grid size-3.5 place-items-center"><span className="size-1.5 rounded-full bg-border" /></span>;

/**
 * The waiting screen: the three steps, which one is running, how long it has taken, and what is normal.
 * If a model is busy and a backup takes over, it says so instead of silently taking longer.
 */
export function Steps({ inv, compact = false }: { inv: Invoice; compact?: boolean }) {
  const now = useTick(500) * 500; // a clock that advances every half second
  const reading = inv.status === "reading";
  const understanding = inv.status === "understanding";
  const elapsed = inv.understandStartedAt && now ? Math.max(0, now - inv.understandStartedAt) : 0;
  const failed = inv.attempts?.filter((a) => !a.ok) ?? [];
  const found = Object.values(inv.partial ?? {}).filter((v) => v && (Array.isArray(v) ? v.length : typeof v === "object" ? (v as { value: unknown }).value !== null : true)).length;

  if (compact)
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <BarsTheme state="thinking" volume={0.5} size={12} />
        <span className="text-foreground">{short(inv.understandModel)} is reading the fields</span>
        <span className="tabular-nums">· {Math.floor(elapsed / 1000)} s</span>
        {failed.length > 0 && <span>· switched from {short(failed.at(-1)!.model)} (busy)</span>}
      </div>
    );

  const steps = [
    { label: "Read the text", state: reading ? "run" : "done", note: inv.ocr ? `${inv.ocr.lines.length} pieces of text · ${secs(inv.ocr.ms)}` : "Finding every word and where it sits" },
    { label: "Understand the fields", state: reading ? "wait" : "run",
      note: understanding ? `${short(inv.understandModel)} · ${Math.floor(elapsed / 1000)} s${found ? ` · ${found} found so far` : ""}` : "Vendor, number, date, items and totals" },
    { label: "Check the maths", state: "wait", note: "Lines, subtotal, tax and total must agree" },
  ] as const;

  return (
    <div className="text-sm">
      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.label} className="flex gap-3">
            <span className="mt-0.5">{s.state === "done" ? <Tick /> : s.state === "run" ? <BarsTheme state="thinking" volume={0.5} size={14} /> : <Dot />}</span>
            <div>
              <p className={s.state === "wait" ? "text-faint" : "text-foreground"}>{s.label}</p>
              <p className="text-xs tabular-nums text-muted-foreground">{s.note}</p>
            </div>
          </li>
        ))}
      </ol>
      <AnimatePresence>
        {failed.map((f) => (
          <motion.p key={f.model} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="mt-3 rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">
            {short(f.model)} didn&apos;t answer ({f.reason?.split(":")[0] ?? "error"}), so {short(inv.understandModel)} took over. Nothing is lost.
          </motion.p>
        ))}
      </AnimatePresence>
      <p className="mt-4 text-xs text-faint">Usually 8 to 20 seconds. You can go back and add more invoices; this one keeps reading.</p>
    </div>
  );
}

/** "How this was read": the pipeline, the checks (passed and not), and every change a person made. */
export function Explain({ inv, a }: { inv: Invoice; a: Analysis }) {
  const [open, setOpen] = useState(false);
  const history = inv.history ?? [];
  return (
    <div className="border-t border-border pt-4 text-sm">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-muted-foreground hover:text-foreground" aria-expanded={open}>
        <span>How this was read</span>
        <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-xs">▾</motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease }} className="overflow-hidden">
            <ol className="mt-4 space-y-4 border-s border-border ps-4 text-xs">
              <li>
                <p className="text-foreground">1 · Read the text</p>
                <p className="text-muted-foreground">{inv.ocr ? `${inv.ocr.engine} found ${inv.ocr.lines.length} pieces of text and where each sits, in ${secs(inv.ocr.ms)}.` : "Not run."}</p>
              </li>
              <li>
                <p className="text-foreground">2 · Understand the fields</p>
                <p className="text-muted-foreground">
                  {short(inv.understandModel)} looked at the image and the text and picked out each field, pointing at the text it came from{inv.understandMs ? `, in ${secs(inv.understandMs)}` : ""}.
                </p>
                {inv.attempts?.filter((x) => !x.ok).map((x) => (
                  <p key={x.model} className="mt-1 text-faint">Tried {short(x.model)} first: {x.reason}</p>
                ))}
                <p className="mt-1 text-faint">The model copies what is printed. It never fixes the arithmetic; that is the next step&apos;s job.</p>
              </li>
              <li>
                <p className="text-foreground">3 · Check it</p>
                <ul className="mt-1 space-y-1">
                  {a.checks.map((c) => (
                    <li key={c.label} className="flex items-center gap-1.5 text-muted-foreground">{c.ok ? <Tick /> : <Cross />}{c.label}</li>
                  ))}
                </ul>
                {a.flags.length > 0 && <p className="mt-1 text-faint">{a.flags.length} question{a.flags.length === 1 ? "" : "s"} raised, {a.flags.length - a.unresolved.length} answered.</p>}
              </li>
              <li>
                <p className="text-foreground">4 · Your changes</p>
                {history.length ? (
                  <ul className="mt-1 space-y-1">
                    {history.slice().reverse().map((h, k) => (
                      <li key={k} className="flex justify-between gap-3 text-muted-foreground"><span>{h.label}</span><span className="shrink-0 text-faint"><Ago iso={h.at} /></span></li>
                    ))}
                  </ul>
                ) : <p className="text-muted-foreground">None yet. Every value is as read.</p>}
              </li>
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

const REASONS = ["Wrong amounts", "Missed items", "Wrong vendor or date", "Outlined the wrong place", "Too slow"];

/** Thumbs up/down on the reading, with a reason when it was wrong. Corrections are counted automatically. */
export function Feedback({ inv }: { inv: Invoice }) {
  const fb = inv.feedback;
  const [reasons, setReasons] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const corrected = Object.keys(inv.edits).length;

  const vote = (v: "up" | "down") => {
    if (v === "up") { actions.feedback(inv.id, { vote: "up", reasons: [] }); setAsking(false); }
    else { setReasons(fb?.reasons ?? []); setAsking(true); }
  };
  const btn = (v: "up" | "down", active: boolean) => (
    <button onClick={() => vote(v)} aria-pressed={active} aria-label={v === "up" ? "Reading was right" : "Reading was wrong"}
      className={`grid size-8 place-items-center rounded-lg border transition-colors ${active ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:bg-secondary hover:text-foreground"}`}>
      <svg viewBox="0 0 24 24" className={`size-4 ${v === "down" ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 10v11M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
      </svg>
    </button>
  );

  return (
    <div className="rounded-xl border border-border px-4 py-3 text-sm">
      <div className="flex items-center gap-3">
        <div className="me-auto">
          <p className="text-foreground">{fb ? (fb.vote === "up" ? "Thanks, marked as right" : "Thanks, noted what went wrong") : "Was this reading right?"}</p>
          <p className="text-xs text-muted-foreground">
            {corrected ? `You corrected ${corrected} value${corrected === 1 ? "" : "s"}; that is counted too.` : "Your answer helps measure how well it reads."}
          </p>
        </div>
        {btn("up", fb?.vote === "up")}
        {btn("down", fb?.vote === "down" || asking)}
      </div>
      <AnimatePresence initial={false}>
        {asking && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease }} className="overflow-hidden">
            <div className="mt-3 flex flex-wrap gap-1.5">
              {REASONS.map((r) => {
                const on = reasons.includes(r);
                return (
                  <button key={r} onClick={() => setReasons(on ? reasons.filter((x) => x !== r) : [...reasons, r])} aria-pressed={on}
                    className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-foreground bg-foreground text-background" : "border-border text-foreground hover:bg-secondary"}`}>{r}</button>
                );
              })}
            </div>
            <div className="mt-2 flex gap-2">
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything else? (optional)"
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground outline-none focus:border-ring" />
              <button onClick={() => { actions.feedback(inv.id, { vote: "down", reasons, note: note.trim() || undefined }); setAsking(false); }}
                className="rounded-md bg-foreground px-2.5 py-1 text-xs text-background">Send</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** The latest action with an Undo button; disappears after a few seconds. */
export function Toasts() {
  const { toast } = useInvoices();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => actions.dismissToast(), 6000);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-30 flex justify-center px-4">
      <AnimatePresence>
        {toast && (
          <motion.div key={toast.key} initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.25, ease }}
            role="status" className="pointer-events-auto flex items-center gap-4 rounded-xl bg-foreground px-4 py-2.5 text-sm text-background shadow-lg">
            <span>{toast.text}</span>
            {toast.undo?.length ? <button onClick={() => actions.undoToast()} className="font-medium underline underline-offset-4">Undo</button> : null}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
