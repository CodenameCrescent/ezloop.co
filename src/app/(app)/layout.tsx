import { BusinessShell } from "@/components/shell/BusinessShell";
import { requireSignedIn } from "@/lib/api/functions/session";

/** Every screen that belongs to one business: sidebar, period filter, store. */
export default async function BusinessAppLayout({ children }: { children: React.ReactNode }) {
  await requireSignedIn();
  return <BusinessShell>{children}</BusinessShell>;
}
