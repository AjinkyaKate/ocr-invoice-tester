// Turns an extracted invoice into: the questions a person must answer (flags), and the effective
// value of every field and line after their answers and edits.
import type { Box, Invoice, Line } from "./types";

export type FieldKey = "vendor" | "number" | "date" | "subtotal" | "tax" | "total";
export const FIELD_LABEL: Record<FieldKey, string> = { vendor: "Vendor", number: "Invoice no.", date: "Date", subtotal: "Subtotal", tax: "Tax", total: "Total" };
const NUMERIC: FieldKey[] = ["subtotal", "tax", "total"];

export type Flag = {
  id: string;
  line?: number; // item index
  field?: FieldKey;
  title: string;
  detail: string;
  options: { id: string; label: string }[]; // option "edit" opens an input for `edit`
  edit?: { key: string; numeric: boolean; current: string };
};

export type LineResult = {
  index: number;
  line: Line;
  desc: string; // desc / qty / rate / amount are after the user's answers and edits
  qty: number | null;
  rate: number | null;
  amount: number | null;
  derived: boolean; // amount worked out as qty × price because it wasn't read
};

export type Check = { label: string; ok: boolean };

export type Analysis = {
  flags: Flag[];
  checks: Check[]; // what was verified, shown as a trust list
  unresolved: Flag[];
  lines: LineResult[];
  value: (k: FieldKey) => string | number | null;
  itemsTotal: number;
};

const UNSURE = 0.85; // OCR confidence below this asks the user to look
const round2 = (n: number) => Math.round(n * 100) / 100;
const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.05, Math.abs(b) * 0.005);

export const money = (n: number | null | undefined, currency?: string | null) => {
  if (n === null || n === undefined) return "–";
  const s = n.toLocaleString("en-IN", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return !currency || currency === "INR" ? `₹${s}` : currency === "USD" ? `$${s}` : `${currency} ${s}`;
};

/** Union of the OCR boxes for some OCR pieces (null when there are none). */
export function boxFor(inv: Invoice, ids: number[]): Box | null {
  const bs = ids.map((i) => inv.ocr?.lines[i]?.box).filter((b): b is Box => !!b);
  if (!bs.length) return null;
  const x0 = Math.min(...bs.map((b) => b[0])), y0 = Math.min(...bs.map((b) => b[1]));
  const x1 = Math.max(...bs.map((b) => b[0] + b[2])), y1 = Math.max(...bs.map((b) => b[1] + b[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}

const minScore = (inv: Invoice, ids: number[]) => Math.min(1, ...ids.map((i) => inv.ocr?.lines[i]?.score ?? 1));
const textOf = (inv: Invoice, ids: number[]) => ids.map((i) => inv.ocr?.lines[i]?.text).filter(Boolean).join(" ");

export function analyze(inv: Invoice): Analysis {
  const flags: Flag[] = [];
  const d = inv.decisions, e = inv.edits;
  const cur = inv.currency;
  const value = (k: FieldKey) => (e[k] !== undefined ? (NUMERIC.includes(k) ? Number(e[k]) : e[k]) : (inv[k]?.value ?? null));

  // header: missing total, values OCR wasn't sure about
  if (value("total") === null)
    flags.push({ id: "missing:total", field: "total", title: "Total not found", detail: "Enter the amount payable.", options: [{ id: "edit", label: "Enter total" }], edit: { key: "total", numeric: true, current: "" } });
  for (const k of ["vendor", "number", "date", "total"] as FieldKey[]) {
    const f = inv[k];
    if (!f || f.value === null || !f.lines?.length || e[k] !== undefined) continue;
    const score = minScore(inv, f.lines);
    if (score < UNSURE)
      flags.push({ id: `unsure:${k}`, field: k, title: `Check ${FIELD_LABEL[k].toLowerCase()}`, detail: `Read as ${NUMERIC.includes(k) ? money(f.value as number, cur) : `"${f.value}"`}; the image is unclear here.`,
        options: [{ id: "ok", label: "Looks right" }, { id: "edit", label: "Correct it" }], edit: { key: k, numeric: NUMERIC.includes(k), current: String(f.value) } });
  }

  const lines: LineResult[] = inv.lines.map((l, i) => {
    const n = i + 1;
    const edited = Object.keys(e).some((k) => k.startsWith(`line:${i}:`));
    const desc = e[`line:${i}:desc`] ?? l.desc;
    const qty = e[`line:${i}:qty`] !== undefined ? Number(e[`line:${i}:qty`]) : l.qty;
    const rate = e[`line:${i}:rate`] !== undefined ? Number(e[`line:${i}:rate`]) : l.rate;
    let amount = e[`line:${i}:amount`] !== undefined ? Number(e[`line:${i}:amount`]) : l.amount;
    if (qty !== null && rate !== null && amount !== null && e[`line:${i}:amount`] === undefined) {
      const calc = round2(qty * rate);
      if (!close(calc, amount)) {
        flags.push({ id: `${i}:math`, line: i, title: `Line ${n} doesn't add up`, detail: `${qty} × ${money(rate, cur)} = ${money(calc, cur)}, not ${money(amount, cur)}.`,
          options: [{ id: "calc", label: `Use ${money(calc, cur)}` }, { id: "printed", label: `Keep ${money(amount, cur)}` }] });
        if (d[`${i}:math`] === "calc") amount = calc;
      }
    }
    // amount not read: work it out from qty × price, or ask for it
    let derived = false;
    if (amount === null && qty !== null && rate !== null) { amount = round2(qty * rate); derived = true; }
    if (amount === null)
      flags.push({ id: `${i}:noamount`, line: i, title: `Line ${n} has no amount`, detail: desc, options: [{ id: "edit", label: "Enter amount" }], edit: { key: `line:${i}:amount`, numeric: true, current: "" } });
    if (l.lines.length && minScore(inv, l.lines) < 0.7 && !edited)
      flags.push({ id: `${i}:unsure`, line: i, title: `Check line ${n}`, detail: `"${textOf(inv, l.lines)}" is unclear on the image.`, options: [{ id: "ok", label: "Looks right" }] });
    return { index: i, line: l, desc, qty, rate, amount, derived };
  });

  // items should add up to the subtotal, or the total before or after tax
  const itemsTotal = round2(lines.reduce((s, r) => s + (r.amount ?? 0), 0));
  const sub = value("subtotal") as number | null, tax = value("tax") as number | null, total = value("total") as number | null;
  if (lines.length && lines.every((r) => r.amount !== null)) {
    const targets = [sub, total, total !== null && tax !== null ? total - tax : null].filter((t): t is number => t !== null);
    if (targets.length && !targets.some((t) => close(itemsTotal, t)))
      flags.push({ id: "totals", title: "Items don't add up", detail: `Items come to ${money(itemsTotal, cur)}; the invoice says ${money(sub ?? total, cur)}.`, options: [{ id: "ok", label: "I've checked it" }] });
  }
  if (sub !== null && tax !== null && total !== null && !close(sub + tax, total))
    flags.push({ id: "subtax", title: "Subtotal + tax ≠ total", detail: `${money(sub, cur)} + ${money(tax, cur)} = ${money(round2(sub + tax), cur)}, not ${money(total, cur)}.`, options: [{ id: "ok", label: "I've checked it" }] });

  const has = (prefix: string) => flags.some((f) => f.id.includes(prefix));
  const checks: Check[] = [
    { label: "Vendor, number and date found", ok: ["vendor", "number", "date"].every((k) => value(k as FieldKey) !== null) },
    ...(lines.some((r) => r.qty !== null && r.rate !== null) ? [{ label: "Each line matches qty × price", ok: !has(":math") }] : []),
    ...(lines.length ? [{ label: "Items add up to the total", ok: !has("totals") && !has("subtax") && !has("noamount") && total !== null }] : []),
    { label: "Text read clearly", ok: !has("unsure") },
  ];
  return { flags, checks, unresolved: flags.filter((f) => !d[f.id]), lines, value, itemsTotal };
}

/** "22 May, 2026 01:06 PM" -> "22 May 2026"; numeric dates (ambiguous day/month) stay as printed, minus any time. */
export function niceDate(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.replace(/[,\s]+\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\s*$/i, "").trim();
  if (/[a-z]{3}/i.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const t = Date.parse(s.replace(/(\d)(st|nd|rd|th)\b/i, "$1"));
    if (!Number.isNaN(t)) return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }
  return s;
}

/** "Ravi Kumar" -> "RK", "INDAH GIFT & HOME DECO" -> "IG". */
export function initials(name: string | null): string {
  const skip = new Set(["and", "the", "of", "pvt", "ltd", "llc", "inc", "co"]);
  const words = (name ?? "").replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w && !skip.has(w.toLowerCase()));
  return ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase();
}
