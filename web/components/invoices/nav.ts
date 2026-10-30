// The app is one screen that changes shape; moving between the list and an invoice only updates the URL
// (Next.js keeps usePathname in sync with history.pushState), so nothing reloads or jumps.
export function go(id?: string | null) {
  window.history.pushState(null, "", id ? `/invoice/${id}` : "/");
}
export const idFromPath = (path: string) => (path.startsWith("/invoice/") ? decodeURIComponent(path.split("/")[2] ?? "") || null : null);
