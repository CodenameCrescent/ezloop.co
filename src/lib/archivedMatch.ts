import { useMemo } from "react";
import { toast } from "sonner";
import { findPersonMatches, isReusable } from "@workspace/domain";
import { apiErrorMessage, usePeople, useUpdatePerson } from "@/api/hooks";

type Kind = "customer" | "vendor" | "employee" | "other";

/**
 * "That name belongs to someone you archived."
 *
 * The server resolves a free-typed name by exact email, then exact name, then
 * creates — and it does NOT filter on status. So typing the name of an archived
 * person attaches the money to them, which is right (splitting their history
 * would be worse) and was invisible, which is not. This is what the screens say
 * about it before the owner commits.
 *
 * `reusableOnly` mirrors that server rule. Where a match means "this WILL
 * reattach" the notice must only fire on the exact matches the server actually
 * reuses — claiming a sale will land on "Acme Corp" when the server is about to
 * create a second "Acme Corporation" would be a lie. Where the owner is simply
 * being asked "is this someone you already have", loose matches are useful and
 * it is left off.
 */
export function useArchivedMatches(
  input: { name: string; email?: string | null },
  kind: Kind,
  opts?: { enabled?: boolean; reusableOnly?: boolean },
) {
  const enabled = (opts?.enabled ?? true) && !!input.name.trim();
  // Gating the QUERY, not just the matching: Quick Add sits mounted behind every
  // screen, so an ungated fetch here would be a request on every page load.
  const archived = usePeople(kind, "archived", { enabled });
  const restoreM = useUpdatePerson();

  const matches = useMemo(() => {
    if (!enabled) return [];
    const found = findPersonMatches(input, archived.data?.items ?? []);
    return opts?.reusableOnly ? found.filter((m) => isReusable(m.strength)) : found;
    // `input` is a fresh object each render; its parts are the real inputs.
  }, [enabled, input.name, input.email, archived.data, opts?.reusableOnly]);

  function restore(id: string, displayName: string) {
    restoreM.mutate(
      { id, body: { status: "active" } },
      {
        onSuccess: () => toast.success(`${displayName} is back in your lists`),
        onError: (e) => toast.error(apiErrorMessage(e, "Could not restore that person")),
      },
    );
  }

  return { matches, restore, restoring: restoreM.isPending };
}
