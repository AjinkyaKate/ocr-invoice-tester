"use client";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { analyze, money } from "@/lib/invoices/analyze";
import { actions, useInvoices } from "@/lib/invoices/store";
import type { Invoice } from "@/lib/invoices/types";
import { BarsTheme } from "@/components/ui/bars-theme";
import { Ago } from "./bits";
import { go, idFromPath } from "./nav";
import { ReviewView } from "./review";
import { Shell } from "./shell";

const ease = [0.22, 1, 0.36, 1] as const;

/** The whole app: one screen that changes shape between the upload list and an invoice. */
export function Workspace() {
  const id = idFromPath(usePathname());
  return (
    <Shell>
      <LayoutGroup>
        <AnimatePresence mode="popLayout" initial={false}>
          {id ? (
            <motion.div key={`r-${id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              <ReviewView id={id} />
            </motion.div>
          ) : (
            <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              <Home />
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
    </Shell>
  );
}

function Home() {
  const { invoices } = useInvoices();
  const [dragging, setDragging] = useState(false);
  const [morphId, setMorphId] = useState<string | null>(null); // the drop zone becomes this invoice's image
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);

  const take = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (imgs.length !== 1) { await Promise.all(imgs.map((f) => actions.add(f, f.name))); return; }
    const id = await actions.add(imgs[0], imgs[0].name);
    setMorphId(id); // give the drop zone the image's layout id, then switch: it grows into the invoice
    requestAnimationFrame(() => go(id));
  };

  const trySample = async (s: Sample) => {
    const blob = await (await fetch(s.src)).blob();
    take([new File([blob], `${s.label}.jpg`, { type: blob.type || "image/jpeg" })]);
  };

  return (
    <div className="mx-auto max-w-2xl">
      <motion.button type="button" layoutId={morphId ? `doc-${morphId}` : undefined} transition={{ duration: 0.6, ease }}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); take(Array.from(e.dataTransfer.files)); }}
        className={`group flex w-full flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-14 text-center pointer-coarse:py-10 transition-colors ${dragging ? "border-accent bg-secondary" : "border-border hover:border-ring hover:bg-secondary"}`}>
        <PaperStack lifted={dragging} />
        {/* mouse: drop zone; touch: camera or photo library */}
        <span className="pointer-coarse:hidden">
          <motion.span animate={{ y: dragging ? -3 : 0 }} className="block text-lg text-foreground">{dragging ? "Drop to read it" : "Drop an invoice or receipt here"}</motion.span>
          <span className="mx-auto mt-2 block max-w-md text-sm text-muted-foreground">A photo, scan or screenshot of a supplier bill. The AI pulls out the vendor, every line item and the total for you to check.</span>
          <span className="mt-5 inline-block rounded-full border border-border bg-background px-4 py-1.5 text-sm text-foreground group-hover:border-ring">Choose a file</span>
          <span className="mt-2 block text-xs text-faint">JPG or PNG · you can drop several at once</span>
        </span>
        <span className="hidden w-full max-w-xs flex-col items-center gap-3 pointer-coarse:flex">
          <span className="text-foreground">Add an invoice or receipt</span>
          <span className="-mt-2 text-sm text-muted-foreground">Snap the paper bill. The AI reads every line for you to check.</span>
          <span onClick={(e) => { e.stopPropagation(); camRef.current?.click(); }} className="w-full rounded-xl bg-foreground px-4 py-3 text-sm text-background">Take a photo</span>
          <span className="text-sm text-muted-foreground">or choose from photos</span>
        </span>
      </motion.button>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { take(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { take(Array.from(e.target.files ?? [])); e.target.value = ""; }} />

      <section className="mt-6">
        <p className="mb-3 text-center text-sm text-muted-foreground">No invoice handy? Try one of these</p>
        <div className="grid grid-cols-3 gap-3">
          {SAMPLES.map((s) => (
            <button key={s.src} onClick={() => trySample(s)} className="group/s overflow-hidden rounded-xl border border-border text-left transition-colors hover:border-ring">
              <div className="relative h-24 overflow-hidden bg-white sm:h-28">
                {/* eslint-disable-next-line @next/next/no-img-element -- static sample */}
                <img src={s.src} alt={s.label} style={{ objectPosition: s.pos ?? "top" }} className="h-full w-full object-cover transition-transform duration-300 group-hover/s:scale-105" />
              </div>
              <div className="px-3 py-2">
                <p className="text-xs leading-snug text-foreground sm:truncate sm:text-sm">{s.label}</p>
                <p className="hidden truncate text-xs text-faint sm:block">{s.hint}</p>
              </div>
            </button>
          ))}
        </div>
      </section>

      {invoices.length === 0 && (
        <ol className="mt-10 grid gap-4 text-sm sm:grid-cols-3">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="flex gap-3 sm:flex-col sm:gap-2">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-xs tabular-nums text-foreground">{i + 1}</span>
              <span>
                <span className="block text-foreground">{t}</span>
                <span className="block text-muted-foreground">{d}</span>
              </span>
            </li>
          ))}
        </ol>
      )}

      {invoices.length > 0 && (
        <section className="mt-12">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Recent</span>
            <button onClick={() => { if (confirm("Remove all invoices?")) actions.clear(); }} className="text-faint hover:text-foreground">Clear</button>
          </div>
          <motion.div layout className="divide-y divide-border border-y border-border">
            <AnimatePresence initial={false}>
              {invoices.map((i) => (
                <motion.div key={i.id} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease }}>
                  <Row inv={i} />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        </section>
      )}
    </div>
  );
}

type Sample = { src: string; label: string; hint: string; pos?: string };
const SAMPLES: Sample[] = [
  { src: "/samples/business-invoice.jpg", label: "Business invoice", hint: "Typed, with line items", pos: "center 32%" },
  { src: "/samples/shop-receipt.jpg", label: "Shop receipt", hint: "Phone photo" },
  { src: "/samples/scanned-receipt.jpg", label: "Scanned receipt", hint: "Faded thermal paper" },
];

const STEPS: [string, string][] = [
  ["Add the bill", "Drop a photo or scan of any supplier invoice or receipt."],
  ["AI reads it", "Vendor, date, line items and totals, each linked to where it sits on the page."],
  ["You check and approve", "Anything unsure is flagged. Fix it with a click, then approve."],
];

/** Two little documents in the drop zone, one being scanned, so it is obvious what goes here. */
function PaperStack({ lifted }: { lifted: boolean }) {
  const line = (w: string) => <span className="block h-1 rounded-full bg-zinc-200" style={{ width: w }} />;
  return (
    <span aria-hidden className="relative mb-6 block h-28 w-36">
      <motion.span animate={{ rotate: lifted ? 14 : 9, x: lifted ? 10 : 0 }} transition={{ duration: 0.3, ease }}
        className="absolute right-1 top-3 block h-24 w-16 rounded-md border border-zinc-200 bg-white p-2 shadow-sm">
        <span className="flex flex-col gap-1.5">{line("70%")}{line("100%")}{line("85%")}{line("100%")}{line("60%")}</span>
      </motion.span>
      <motion.span animate={{ rotate: lifted ? -8 : -4, y: lifted ? -6 : 0 }} transition={{ duration: 0.3, ease }}
        className="absolute left-3 top-0 block h-28 w-20 overflow-hidden rounded-md border border-zinc-200 bg-white p-2.5 text-left shadow-md">
        <span className="block text-[7px] font-semibold uppercase tracking-wider text-zinc-800">Invoice</span>
        <span className="mt-1.5 flex flex-col gap-1.5">{line("60%")}{line("100%")}{line("100%")}{line("80%")}</span>
        <span className="mt-2.5 flex items-center justify-between border-t border-zinc-200 pt-1.5">
          <span className="text-[6px] text-zinc-500">TOTAL</span>
          <span className="text-[7px] font-semibold tabular-nums text-zinc-800">$248.00</span>
        </span>
        <span className="scan-beam" />
      </motion.span>
    </span>
  );
}

function Row({ inv }: { inv: Invoice }) {
  const busy = inv.status === "reading" || inv.status === "understanding";
  const open = inv.status === "review" ? analyze(inv).unresolved.length : 0;
  const status = busy ? "Reading" : inv.status === "review" ? (open ? `${open} to check` : "Ready") : inv.status === "done" ? "Approved" : inv.status === "rejected" ? "Rejected" : "Failed";
  return (
    <button onClick={() => go(inv.id)} className="flex w-full items-center gap-4 py-3 text-left hover:bg-secondary/60">
      {/* the thumbnail grows into the full invoice when opened */}
      <motion.div layoutId={`doc-${inv.id}`} transition={{ duration: 0.55, ease }} className="relative size-10 shrink-0 overflow-hidden rounded border border-border bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element -- the uploaded image */}
        <img src={inv.image} alt="" className="h-full w-full object-cover object-top" />
        {busy && <div className="scan-beam" />}
      </motion.div>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm ${inv.status === "rejected" ? "text-faint line-through" : "text-foreground"}`}>{inv.edits.vendor ?? inv.vendor.value ?? inv.name}</p>
        <p className="text-xs text-faint"><Ago iso={inv.receivedAt} /><span className="sm:hidden"> · {status}</span></p>
      </div>
      <div className={`hidden items-center gap-2 text-xs sm:flex ${inv.status === "failed" ? "text-destructive" : open ? "text-foreground" : "text-muted-foreground"}`}>
        {busy && <BarsTheme state="thinking" volume={0.5} size={14} />}{status}
      </div>
      {busy && <BarsTheme state="thinking" volume={0.5} size={14} className="sm:hidden" />}
      <span className="shrink-0 text-right text-sm tabular-nums text-foreground sm:w-24">{money(inv.edits.total !== undefined ? Number(inv.edits.total) : inv.total.value, inv.currency)}</span>
    </button>
  );
}
