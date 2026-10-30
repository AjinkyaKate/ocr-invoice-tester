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

  const take = async (files: File[]) => {
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    if (imgs.length !== 1) { await Promise.all(imgs.map((f) => actions.add(f, f.name))); return; }
    const id = await actions.add(imgs[0], imgs[0].name);
    setMorphId(id); // give the drop zone the image's layout id, then switch: it grows into the invoice
    requestAnimationFrame(() => go(id));
  };

  return (
    <div className="mx-auto max-w-2xl">
      <motion.button type="button" layoutId={morphId ? `doc-${morphId}` : undefined} transition={{ duration: 0.6, ease }}
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); take(Array.from(e.dataTransfer.files)); }}
        className={`flex w-full flex-col items-center justify-center rounded-2xl border border-dashed px-6 py-20 text-center transition-colors ${dragging ? "border-foreground bg-secondary" : "border-border hover:bg-secondary"}`}>
        <motion.span animate={{ y: dragging ? -3 : 0 }} className="text-foreground">{dragging ? "Drop to read" : "Drop invoice images"}</motion.span>
        <span className="mt-1 text-sm text-muted-foreground">or click to choose</span>
      </motion.button>
      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { take(Array.from(e.target.files ?? [])); e.target.value = ""; }} />

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
        <p className="text-xs text-faint"><Ago iso={inv.receivedAt} /></p>
      </div>
      <div className={`flex items-center gap-2 text-xs ${inv.status === "failed" ? "text-destructive" : open ? "text-foreground" : "text-muted-foreground"}`}>
        {busy && <BarsTheme state="thinking" volume={0.5} size={14} />}{status}
      </div>
      <span className="w-24 text-right text-sm tabular-nums text-foreground">{money(inv.edits.total !== undefined ? Number(inv.edits.total) : inv.total.value, inv.currency)}</span>
    </button>
  );
}
