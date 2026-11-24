import { useState, useMemo, type ReactNode } from "react";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { readOptionalMoney, readMoney, MoneyInputError } from "@/lib/money";
import { useArchivedMatches } from "@/lib/archivedMatch";
import { DEFAULT_BILLABLE_TARGET_HOURS, findPersonMatches } from "@workspace/domain";
import { useOverheadDefault } from "@/api/hooks";
import type { EndpointBody, createPerson, createClient, setTeamMemberRate, PersonShape } from "@workspace/api-contract";
import type { PeopleKind } from "../columns";

export type PersonCreateBody = EndpointBody<typeof createPerson>;

/** What else to set up in the same flow as adding the person. */
export type SetupPayload =
  | { kind: "client"; engagement: EndpointBody<typeof createClient>["engagement"] }
  | { kind: "pay"; rate: EndpointBody<typeof setTeamMemberRate> };
export type PersonDialogProps = {
  open: boolean;
  editing: PersonShape | null;
  kind: PeopleKind;
  candidates: PersonShape[];
  moduleOn: boolean;
  symbol: string;
  onOpenExisting: (id: string) => void;
  saving: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmit: (input: PersonCreateBody, setup?: SetupPayload) => void;
};

/** PersonDialog's state and handlers, kept out of its render so each file stays short. */
export function usePersonDialogLogic({
  open,
  editing,
  kind,
  candidates,
  moduleOn,
  onSubmit,
}: Pick<PersonDialogProps, "open" | "editing" | "kind" | "candidates" | "moduleOn" | "onSubmit">) {
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [company, setCompany] = useState("");
  const [notes, setNotes] = useState("");

  /**
   * The optional second half: their terms, or their pay.
   *
   * Off until asked for, because most people added here are neither — and the
   * name-and-email path has to stay a five-second job. Opening it is what the
   * two retired screens used to be: the only way to create a client or a team
   * member. Now it is a section of the one create path, so the duplicate check
   * above runs no matter which of the three the owner is really adding.
   */
  const [setupOpen, setSetupOpen] = useState(false);
  const [terms, setTerms] = useState({ status: "active", amount: "", amountPeriod: "total", hours: "", hoursPeriod: "total" });
  const [pay, setPay] = useState({ costType: "salaried", monthly: "", hourly: "", overhead: "", target: DEFAULT_BILLABLE_TARGET_HOURS });

  const offersSetup = !editing && moduleOn && (kind === "customer" || kind === "employee");
  /** Only asked for once the pay section is actually open. */
  const overhead = useOverheadDefault({ enabled: offersSetup && setupOpen && kind === "employee" });
  const suggestedOverhead = overhead.data?.perPersonCents ?? null;

  const [syncedFor, setSyncedFor] = useState<string | null>(null);
  const currentKey = open ? editing?.id ?? "new" : null;
  if (currentKey !== syncedFor) {
    setSyncedFor(currentKey);
    if (currentKey !== null) {
      setDisplayName(editing?.displayName ?? "");
      setEmail(editing?.email ?? "");
      setPhone(editing?.phone ?? "");
      setCompany(editing?.company ?? "");
      setNotes(editing?.notes ?? "");
      setSetupOpen(false);
      setTerms({ status: "active", amount: "", amountPeriod: "total", hours: "", hoursPeriod: "total" });
      setPay({ costType: "salaried", monthly: "", hourly: "", overhead: "", target: DEFAULT_BILLABLE_TARGET_HOURS });
    }
  }

  /**
   * Who this might already be, checked while the name is typed.
   *
   * The retired Clients screen did this and People did not, so folding the two
   * together would have lost it: People only noticed a duplicate AFTER it
   * existed, via the banner above the list. Catching it here is what stops a
   * second Acme appearing beside the one carrying two years of revenue.
   *
   * Matched with `findPersonMatches` — the same domain function the server uses
   * for client matching and CSV imports, so the rules cannot drift apart. No
   * request is needed: this list is already loaded and is not paginated.
   */
  const matches = useMemo(() => {
    if (editing || !displayName.trim()) return [];
    return findPersonMatches({ name: displayName, email: email.trim() || null }, candidates).slice(0, 4);
  }, [editing, displayName, email, candidates]);

  /**
   * The same question asked of the people who are no longer in the list.
   *
   * A separate lookup rather than archived rows mixed into `candidates`,
   * because the answer is a different one: an active match offers "open the one
   * you have", an archived match offers to bring them back. Loose matches are
   * kept here — the owner is being asked whether this is someone they already
   * have, and "you archived an Acme Corp" is worth saying even when what they
   * typed would create a separate record.
   */
  const archived = useArchivedMatches({ name: displayName, email: email.trim() || null }, kind, {
    enabled: !editing && open,
  });

  /** Reads the open setup section, naming the offending field if a figure is unreadable. */
  function buildSetup(): SetupPayload | undefined | "invalid" {
    if (!offersSetup || !setupOpen) return undefined;
    try {
      if (kind === "customer") {
        return {
          kind: "client",
          engagement: {
            engagementStatus: terms.status as "active" | "completed" | "churned",
            agreedAmountCents: readOptionalMoney("Agreed amount", terms.amount),
            agreedAmountPeriod: terms.amountPeriod as "total" | "monthly",
            agreedHours: terms.hours.trim() || null,
            agreedHoursPeriod: terms.hoursPeriod as "total" | "monthly",
          },
        };
      }
      return {
        kind: "pay",
        rate: {
          costType: pay.costType as "salaried" | "hourly" | "contractor",
          monthlyCostCents: pay.monthly.trim() ? readMoney("Monthly pay", pay.monthly) : 0,
          hourlyRateCents: pay.hourly.trim() ? readMoney("Hourly rate", pay.hourly) : null,
          overheadShareCents: pay.overhead.trim() ? readMoney("Overhead share", pay.overhead) : 0,
          billableTargetHours: pay.target,
        },
      };
    } catch (err) {
      if (err instanceof MoneyInputError) {
        toast.error(err.message);
        return "invalid";
      }
      throw err;
    }
  }

  function submit() {
    if (!displayName.trim()) {
      toast.error("Name is required");
      return;
    }
    const setup = buildSetup();
    if (setup === "invalid") return;
    onSubmit(
      {
        displayName: displayName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        company: company.trim() || null,
        notes: notes.trim() || null,
      },
      setup,
    );
  }

  return {
    displayName,
    setDisplayName,
    company,
    setCompany,
    email,
    setEmail,
    phone,
    setPhone,
    notes,
    setNotes,
    archived,
    matches,
    offersSetup,
    setupOpen,
    setSetupOpen,
    pay,
    suggestedOverhead,
    setPay,
    terms,
    setTerms,
    submit,
  };
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}
