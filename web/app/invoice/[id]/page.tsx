import { Suspense } from "react";
import { Workspace } from "@/components/invoices/workspace";

// Same screen as "/": the workspace reads the invoice id from the URL.
export default function InvoicePage() {
  return (
    <Suspense>
      <Workspace />
    </Suspense>
  );
}
