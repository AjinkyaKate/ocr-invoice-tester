import { Suspense } from "react";
import { Workspace } from "@/components/invoices/workspace";

export default function Home() {
  return (
    <Suspense>
      <Workspace />
    </Suspense>
  );
}
