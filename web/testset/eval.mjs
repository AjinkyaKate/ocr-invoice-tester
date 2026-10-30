// Runs every document in testset.json through the app's real pipeline (/api/read then /api/understand)
// and scores the result against the ground truth.   node testset/eval.mjs [id ...]   (dev server + OCR server running)
// Uses one free OpenRouter request per document.
import fs from "node:fs";
import path from "node:path";

const dir = import.meta.dirname;
const BASE = process.env.BASE ?? "http://localhost:3000";
const only = process.argv.slice(2);
const tests = JSON.parse(fs.readFileSync(path.join(dir, "testset.json"), "utf8")).filter((t) => !only.length || only.includes(t.id));

// "$ 978,12" -> 978.12 ; "1,080.00" -> 1080 ; "60.000" (IDR) -> 60000
const num = (s, idr = false) => {
  if (s === null || s === undefined) return null;
  let t = String(s).replace(/[^\d.,-]/g, "");
  if (idr) t = t.replace(/[.,]/g, "");
  else if (/,\d{2}$/.test(t)) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  return t === "" ? null : Number(t);
};
const near = (a, b) => a !== null && b !== null && Math.abs(a - b) <= Math.max(0.011, Math.abs(b) * 0.001);
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// what we expect, in one shape for all three datasets
function expected(t) {
  const g = t.truth;
  if (t.id.startsWith("invoice")) return {
    number: g.header.invoice_no, date: g.header.invoice_date, vendor: g.header.seller.split(" ").slice(0, 2).join(" "),
    total: num(g.summary.total_gross_worth), amounts: list(g.items).map((i) => num(i.item_net_worth)),
  };
  if (t.id.startsWith("receipt")) return {
    total: num(g.total?.total_price, true), amounts: list(g.menu).map((m) => num(m.price, true)),
  };
  return { number: g.document_no, date: g.date, vendor: g.vendor.split(" ")[0], total: num(g.total), amounts: g.items.map((i) => num(i.amount)) };
}

async function post(url, body) {
  const r = await fetch(BASE + url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error);
  return d;
}

const GAP = Number(process.env.GAP ?? 0); // ms between documents, to stay under free per-minute token limits
const rows = [];
let pts = 0, max = 0;
for (const t of tests) {
  const img = fs.readFileSync(path.join(dir, t.image));
  const image = `data:image/jpeg;base64,${img.toString("base64")}`;
  const e = expected(t);
  const t0 = Date.now();
  try {
    const ocr = await post("/api/read", { image });
    const r2 = await fetch(BASE + "/api/understand", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image, lines: ocr.lines }) });
    const events = (await r2.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const fin = events.find((x) => x.type === "done");
    if (!fin) throw new Error(events.at(-1)?.message ?? "no result");
    const u = fin.data;
    const checks = [];
    if (e.vendor) checks.push(["vendor", (u.vendor.value ?? "").toLowerCase().includes(e.vendor.toLowerCase().replace(/[^a-z0-9 &-]/g, "").trim().split(" ")[0])]);
    if (e.number) checks.push(["number", (u.number.value ?? "").replace(/\s/g, "") === e.number.replace(/\s/g, "")]);
    if (e.date) checks.push(["date", (u.date.value ?? "").includes(e.date)]);
    if (e.total !== null) checks.push(["total", near(u.total.value, e.total)]);
    // discounts come back as their own negative lines (so items add up); the ground truth lists products only
    checks.push(["item count", u.items.filter((i) => !(i.amount < 0)).length === e.amounts.length]);
    const got = u.items.map((i) => i.amount);
    e.amounts.forEach((a, k) => checks.push([`item ${k + 1} amount`, got.some((g) => near(g, a))]));
    const located = [u.vendor, u.number, u.date, u.total].filter((f) => f.value !== null && f.lines.length).length + u.items.filter((i) => i.lines.length).length;
    const locatable = [u.vendor, u.number, u.date, u.total].filter((f) => f.value !== null).length + u.items.length;
    const ok = checks.filter((c) => c[1]).length;
    pts += ok; max += checks.length;
    rows.push({ id: t.id, score: `${ok}/${checks.length}`, located: `${located}/${locatable}`, s: ((Date.now() - t0) / 1000).toFixed(0), misses: checks.filter((c) => !c[1]).map((c) => c[0]).join(", "), got: { vendor: u.vendor.value, number: u.number.value, date: u.date.value, total: u.total.value, items: got }, want: e });
  } catch (err) {
    rows.push({ id: t.id, score: "error", located: "", s: ((Date.now() - t0) / 1000).toFixed(0), misses: String(err.message).slice(0, 90) });
    max += 1;
  }
  const r = rows.at(-1);
  if (GAP) await new Promise((res) => setTimeout(res, GAP));
  console.log(r.id.padEnd(11), String(r.score).padEnd(7), "outlined", String(r.located).padEnd(6), `${r.s}s`.padEnd(5), r.misses);
}
console.log(`\nfield accuracy ${pts}/${max} = ${Math.round((100 * pts) / max)}%`);
fs.writeFileSync(path.join(dir, "last-run.json"), JSON.stringify(rows, null, 1));
