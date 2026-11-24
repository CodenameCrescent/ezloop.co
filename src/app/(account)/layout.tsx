import { AppShellLoading } from "@/components/AppShellLoading";
import { ClientOnly } from "@/components/ClientOnly";
import { requireSignedIn } from "@/lib/api/functions/session";

/** Signed in, but above any one business: no sidebar and no period. */
export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  await requireSignedIn();
  return <ClientOnly fallback={<AppShellLoading />}>{children}</ClientOnly>;
}
