"use client";
// Invoices, kept in the browser (localStorage) so they survive reloads.
// An upload runs in two steps: /api/read (OCR: text + positions), then /api/understand (fields).
import { useSyncExternalStore } from "react";
import type { Field, Invoice, Line, OcrLine } from "./types";

type State = { invoices: Invoice[] };
const KEY = "invoices-v1";
const KEEP = 30; // older finished invoices are dropped so images fit in browser storage

let state: State = { invoices: [] };
const serverState = state;
let loaded = false;
const listeners = new Set<() => void>();

function persist() {
  for (let keep = KEEP; keep >= 0; keep -= 5) {
    try {
      const open = state.invoices.filter((i) => i.status !== "done" && i.status !== "rejected");
      const closed = state.invoices.filter((i) => i.status === "done" || i.status === "rejected").slice(0, keep);
      localStorage.setItem(KEY, JSON.stringify({ invoices: [...open, ...closed] }));
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
const patch = (id: string, f: (i: Invoice) => Invoice) => set({ invoices: state.invoices.map((i) => (i.id === id ? f(i) : i)) });
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
  const fixed = { ...i, decisions: i.decisions ?? {}, edits: i.edits ?? {}, lines: Array.isArray(i.lines) ? i.lines : [] } as Invoice;
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
      const r = await post<{ lines: OcrLine[]; ms: number; engine: string }>("/api/read", { image: inv.image });
      patch(id, (i) => ({ ...i, ocr: { lines: r.lines, ms: r.ms, engine: r.engine } }));
      inv = get(id)!;
    }
    patch(id, (i) => ({ ...i, status: "understanding", error: undefined, partial: undefined }));
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
        else if (e.type === "error") throw new Error(e.message);
        else if (e.type === "done") done = { ...e.data, ms: e.ms, model: e.model };
      }
    }
    if (!done) throw new Error("The reading stopped early. Try again.");
    const u = done;
    patch(id, (i) => ({ ...i, status: "review", partial: undefined, understandMs: u.ms, understandModel: u.model, currency: u.currency, vendor: u.vendor, number: u.number, date: u.date, subtotal: u.subtotal, tax: u.tax, total: u.total, lines: u.items }));
  } catch (err) {
    patch(id, (i) => ({ ...i, status: "failed", error: err instanceof Error ? err.message : String(err) }));
  } finally {
    running.delete(id);
  }
}

export const actions = {
  /** Add an image and start reading it. Returns its id. */
  async add(file: Blob, name: string): Promise<string> {
    const id = `inv-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const image = await shrink(file);
    const inv: Invoice = { id, name, receivedAt: new Date().toISOString(), status: "reading", image, vendor: empty(), number: empty(), date: empty(), subtotal: empty(), tax: empty(), total: empty(), lines: [], decisions: {}, edits: {} };
    set({ invoices: [inv, ...state.invoices] });
    void run(id);
    return id;
  },
  retry(id: string) {
    void run(id);
  },
  decide(id: string, flag: string, option: string) {
    patch(id, (i) => ({ ...i, decisions: { ...i.decisions, [flag]: option } }));
  },
  edit(id: string, key: string, value: string, flag?: string) {
    patch(id, (i) => ({ ...i, edits: { ...i.edits, [key]: value }, decisions: flag ? { ...i.decisions, [flag]: "edit" } : i.decisions }));
  },
  approve(id: string) {
    patch(id, (i) => (i.status === "review" ? { ...i, status: "done", resolvedAt: new Date().toISOString() } : i));
  },
  reject(id: string) {
    patch(id, (i) => ({ ...i, status: "rejected", resolvedAt: new Date().toISOString() }));
  },
  remove(id: string) {
    set({ invoices: state.invoices.filter((i) => i.id !== id) });
  },
  clear() {
    set({ invoices: [] });
  },
};

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
