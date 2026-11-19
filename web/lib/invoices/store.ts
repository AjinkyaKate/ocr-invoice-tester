"use client";
// Invoices, kept in the browser (localStorage) so they survive reloads.
// An upload runs in two steps: /api/read (OCR: text + positions), then /api/understand (fields).
import { useSyncExternalStore } from "react";
import type { Feedback, Field, Invoice, Line, OcrLine } from "./types";

/** A short message after an action, with a way to take it back. */
export type Toast = { key: number; text: string; undo?: string[] }; // ids whose last change Undo rolls back
type State = { invoices: Invoice[]; toast?: Toast };
const KEY = "invoices-v1";
const KEEP = 30; // older finished invoices are dropped so images fit in browser storage
const HISTORY = 50; // undo steps kept per invoice

let state: State = { invoices: [] };
const serverState = state;
let loaded = false;
const listeners = new Set<() => void>();

function persist() {
  for (let keep = KEEP; keep >= 0; keep -= 5) {
    try {
      const open = state.invoices.filter((i) => i.status !== "done" && i.status !== "rejected");
      const closed = state.invoices.filter((i) => i.status === "done" || i.status === "rejected").slice(0, keep);
      localStorage.setItem(KEY, JSON.stringify({ invoices: [...open, ...closed].map((i) => ({ ...i, history: i.history?.slice(-HISTORY) })) }));
      return;
    } catch {} // quota: try again keeping fewer finished invoices
  }
}
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function set(next: State) {
  state = next;
  // images make each save a few hundred KB, so batch saves while fields stream in
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 400);
  listeners.forEach((l) => l());
}
const patch = (id: string, f: (i: Invoice) => Invoice) => set({ ...state, invoices: state.invoices.map((i) => (i.id === id ? f(i) : i)) });
const get = (id: string) => state.invoices.find((i) => i.id === id);

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) state = { invoices: (JSON.parse(saved).invoices ?? []).map(normalize) };
  } catch {}
  // anything left mid-pipeline by a reload starts again
  for (const i of state.invoices) if (i.status === "reading" || i.status === "understanding") void run(i.id);
}

function subscribe(l: () => void) {
  load();
  listeners.add(l);
  queueMicrotask(l);
  return () => listeners.delete(l);
}

export function useInvoices(): State {
  return useSyncExternalStore(subscribe, () => state, () => serverState);
}

const empty = <T,>(): Field<T> => ({ value: null, lines: [] });

/** Repair an invoice saved by an older or interrupted version, so a bad record can't break the page. */
function normalize(i: Invoice): Invoice {
  const fields = ["vendor", "number", "date", "subtotal", "tax", "total"] as const;
  const broken = (i.status === "review" || i.status === "done") && fields.some((k) => !i[k]);
  const fixed = { ...i, decisions: i.decisions ?? {}, edits: i.edits ?? {}, history: i.history ?? [], lines: Array.isArray(i.lines) ? i.lines : [] } as Invoice;
  for (const k of fields) if (!fixed[k]) (fixed as Record<string, unknown>)[k] = empty();
  return broken ? { ...fixed, status: "failed", error: "This invoice wasn't read completely. Try again." } : fixed;
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

type Understood = { ms: number; model: string; currency: string | null; vendor: Field<string>; number: Field<string>; date: Field<string>; subtotal: Field<number>; tax: Field<number>; total: Field<number>; items: Line[] };

const running = new Set<string>();
async function run(id: string) {
  if (running.has(id)) return;
  running.add(id);
  try {
    let inv = get(id);
    if (!inv) return;
    if (!inv.ocr) {
      patch(id, (i) => ({ ...i, status: "reading", error: undefined }));
      const t0 = Date.now();
      try {
        const r = await post<{ lines: OcrLine[]; ms: number; engine: string }>("/api/read", { image: inv.image });
        patch(id, (i) => ({ ...i, ocr: { lines: r.lines, ms: r.ms, engine: r.engine } }));
      } catch (err) {
        // no word positions: keep going, the vision model reads the image on its own (values just can't be outlined)
        patch(id, (i) => ({ ...i, ocr: { lines: [], ms: Date.now() - t0, engine: "none", error: err instanceof Error ? err.message : String(err) } }));
      }
      inv = get(id)!;
    }
    patch(id, (i) => ({ ...i, status: "understanding", error: undefined, partial: undefined, attempts: [], understandStartedAt: Date.now() }));
    // the model's answer streams in as NDJSON: partial fields, then the final result
    const res = await fetch("/api/understand", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: inv.image, lines: inv.ocr!.lines }) });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error ?? `Request failed (${res.status})`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let done: Understood | null = null;
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop() ?? "";
      for (const line of parts.filter(Boolean)) {
        const e = JSON.parse(line);
        if (e.type === "partial") patch(id, (i) => ({ ...i, partial: { ...e.data, items: e.data.items } }));
        else if (e.type === "reset") patch(id, (i) => ({ ...i, partial: undefined }));
        else if (e.type === "attempt") patch(id, (i) => ({ ...i, understandModel: e.model }));
        else if (e.type === "failed") patch(id, (i) => ({ ...i, attempts: [...(i.attempts ?? []), { model: e.model, ok: false, ms: e.ms, reason: e.reason }] }));
        else if (e.type === "error") throw new Error(e.message);
        else if (e.type === "done") done = { ...e.data, ms: e.ms, model: e.model };
      }
    }
    if (!done) throw new Error("The reading stopped early. Try again.");
    const u = done;
    patch(id, (i) => ({ ...i, status: "review", partial: undefined, understandMs: u.ms, understandModel: u.model, currency: u.currency, vendor: u.vendor, number: u.number, date: u.date, subtotal: u.subtotal, tax: u.tax, total: u.total, lines: u.items,
      attempts: [...(i.attempts ?? []), { model: u.model, ok: true, ms: u.ms }] }));
    patch(id, (i) => ({ ...i, suggest: suggestFor(i) }));
  } catch (err) {
    patch(id, (i) => ({ ...i, status: "failed", error: err instanceof Error ? err.message : String(err) }));
  } finally {
    running.delete(id);
  }
}

// ---- what the app learns from corrections, kept in this browser ----------------------------------
const ALIASES = "vendor-aliases-v1"; // vendor name as read -> the name the person corrected it to
const norm = (v: string | null | undefined) => (v ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
function aliases(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(ALIASES) ?? "{}"); } catch { return {}; }
}
function remember(read: string | null, corrected: string) {
  if (!read || norm(read) === norm(corrected)) return;
  try { localStorage.setItem(ALIASES, JSON.stringify({ ...aliases(), [norm(read)]: corrected })); } catch {}
}

/** Learn only from approved invoices: a vendor name the person corrected is suggested next time. */
const learn = (inv: Invoice) => { if (inv.edits.vendor) remember(inv.vendor.value, inv.edits.vendor); };

/** Suggestions worked out once an invoice is read: a vendor name corrected before, and a possible duplicate. */
function suggestFor(inv: Invoice): Invoice["suggest"] {
  const vendor = aliases()[norm(inv.vendor.value)];
  const dup = inv.vendor.value && inv.number.value
    ? state.invoices.find((o) => o.id !== inv.id && o.status !== "rejected" && o.status !== "failed"
        && norm(o.edits.number ?? o.number.value) === norm(inv.number.value)
        && [norm(o.edits.vendor ?? o.vendor.value), norm(o.vendor.value)].some((v) => v === norm(inv.vendor.value) || v === norm(vendor)))
    : undefined;
  return vendor || dup ? { vendor, duplicateOf: dup?.id } : undefined;
}

// ---- every change a person makes goes through here, so it can be undone ---------------------------
function change(id: string, label: string, f: (i: Invoice) => Invoice) {
  patch(id, (i) => {
    const snap = { label, at: new Date().toISOString(), status: i.status, edits: i.edits, decisions: i.decisions };
    return { ...f(i), history: [...(i.history ?? []), snap].slice(-HISTORY) };
  });
}
let toastKey = 0;
const toast = (text: string, undo?: string[]) => set({ ...state, toast: { key: ++toastKey, text, undo } });
const nameOf = (i?: Invoice) => i?.edits.vendor ?? i?.vendor.value ?? "Invoice";

export const actions = {
  /** Add an image and start reading it. Returns its id. */
  async add(file: Blob, name: string): Promise<string> {
    const id = `inv-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const image = await shrink(file);
    const inv: Invoice = { id, name, receivedAt: new Date().toISOString(), status: "reading", image, vendor: empty(), number: empty(), date: empty(), subtotal: empty(), tax: empty(), total: empty(), lines: [], decisions: {}, edits: {}, history: [] };
    set({ ...state, invoices: [inv, ...state.invoices] });
    void run(id);
    return id;
  },
  retry(id: string) {
    patch(id, (i) => (i.ocr?.error ? { ...i, ocr: undefined } : i)); // a retry also tries the text step again
    void run(id);
  },
  decide(id: string, flag: string, option: string, label = "Answered a check") {
    change(id, label, (i) => ({ ...i, decisions: { ...i.decisions, [flag]: option } }));
  },
  edit(id: string, key: string, value: string, flag?: string) {
    change(id, `Changed ${label(key)}`, (i) => ({ ...i, edits: { ...i.edits, [key]: value }, decisions: flag ? { ...i.decisions, [flag]: "edit" } : i.decisions }));
  },
  /** Go back to the value the AI read for one field. */
  revert(id: string, key: string) {
    change(id, `Restored ${label(key)}`, (i) => {
      const edits = { ...i.edits };
      delete edits[key];
      return { ...i, edits };
    });
  },
  /** Roll back the last change (answer, edit, approve or reject). */
  undo(id: string) {
    const inv = get(id);
    const last = inv?.history?.at(-1);
    if (!inv || !last) return;
    patch(id, (i) => ({ ...i, status: last.status, edits: last.edits, decisions: last.decisions, history: i.history!.slice(0, -1),
      resolvedAt: last.status === "done" || last.status === "rejected" ? i.resolvedAt : undefined }));
    toast(`Undid: ${last.label.toLowerCase()}`);
  },
  approve(id: string) {
    if (get(id)?.status !== "review") return;
    learn(get(id)!);
    change(id, "Approved", (i) => ({ ...i, status: "done", resolvedAt: new Date().toISOString() }));
    toast(`Approved ${nameOf(get(id))}`, [id]);
  },
  /** Approve several invoices that passed every check, in one step (with one Undo). */
  approveMany(ids: string[]) {
    for (const id of ids) { if (get(id)) learn(get(id)!); }
    for (const id of ids) change(id, "Approved", (i) => (i.status === "review" ? { ...i, status: "done", resolvedAt: new Date().toISOString() } : i));
    toast(`Approved ${ids.length} invoice${ids.length === 1 ? "" : "s"}`, ids);
  },
  reject(id: string) {
    change(id, "Rejected", (i) => ({ ...i, status: "rejected", resolvedAt: new Date().toISOString() }));
    toast(`Rejected ${nameOf(get(id))}`, [id]);
  },
  /** Take an approved or rejected invoice back to review. */
  reopen(id: string) {
    change(id, "Reopened", (i) => ({ ...i, status: "review", resolvedAt: undefined }));
  },
  undoToast() {
    const ids = state.toast?.undo ?? [];
    set({ ...state, toast: undefined });
    for (const id of ids) actions.undo(id);
  },
  dismissToast() {
    set({ ...state, toast: undefined });
  },
  feedback(id: string, fb: Omit<Feedback, "at"> | null) {
    patch(id, (i) => ({ ...i, feedback: fb ? { ...fb, at: new Date().toISOString() } : undefined }));
  },
  remove(id: string) {
    set({ ...state, invoices: state.invoices.filter((i) => i.id !== id) });
  },
  clear() {
    set({ invoices: [] });
  },
};

/** "line:3:amount" -> "line 4 amount", "total" -> "total". */
function label(key: string) {
  const m = /^line:(\d+):(\w+)$/.exec(key);
  return m ? `line ${Number(m[1]) + 1} ${m[2] === "rate" ? "price" : m[2] === "desc" ? "item" : m[2]}` : key === "number" ? "invoice no." : key;
}

/** Downscale big photos and return a JPEG data URL; kept under ~1 MB, the hosted OCR's upload limit. */
async function shrink(file: Blob): Promise<string> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale);
  c.height = Math.round(bmp.height * scale);
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff"; // transparent PNGs become white, not black
  g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  for (const q of [0.88, 0.8, 0.7, 0.6]) {
    const url = c.toDataURL("image/jpeg", q);
    if (url.length * 0.75 < 950_000) return url;
  }
  return c.toDataURL("image/jpeg", 0.5);
}
