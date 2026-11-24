import { useState, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { readMoney, MoneyInputError } from "@/lib/money";
import { useRevenueItems, useExpenseItems, useSources, useCreateRecurringSchedule, apiErrorMessage } from "@/api/hooks";
import type { EndpointBody, createRecurringSchedule, RecurringScheduleShape } from "@workspace/api-contract";

export type CreateBody = EndpointBody<typeof createRecurringSchedule>;
export type Interval = RecurringScheduleShape["interval"];

export const INTERVALS: Array<{ value: Interval; label: string }> = [
  { value: "daily", label: "Every day" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
  { value: "quarterly", label: "Every quarter" },
  { value: "yearly", label: "Every year" },
];

export const ALL_RANGE = { startDate: new Date(new Date().getFullYear() - 3, 0, 1).toISOString(), endDate: new Date().toISOString() };

export function Fld({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}

// ── New recurring schedule dialog ─────────────────────────────────────────────
export function NewRecurringDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [direction, setDirection] = useState<"in" | "out">("out");
  const [itemId, setItemId] = useState("");
  const [amountRupees, setAmountRupees] = useState("");
  const [interval, setInterval] = useState<Interval>("monthly");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [postingMode, setPostingMode] = useState<"auto_post" | "confirm_first">("auto_post");
  const [sourceId, setSourceId] = useState("");

  const revenueItems = useRevenueItems(ALL_RANGE, "active");
  const expenseItems = useExpenseItems(ALL_RANGE, "active");
  const sources = useSources();
  const createM = useCreateRecurringSchedule();

  const items = direction === "in" ? revenueItems.data?.items ?? [] : expenseItems.data?.items ?? [];
  const sourceList = sources.data ?? [];

  const body = useMemo<CreateBody | null>(() => {
    if (!itemId) return null;
    const base: CreateBody = {
      direction,
      interval,
      startDate: new Date(startDate).toISOString(),
      postingMode,
    };
    if (direction === "in") base.revenueItemId = itemId;
    else base.expenseItemId = itemId;
    if (amountRupees.trim()) base.amountCents = readMoney("Amount", amountRupees);
    if (sourceId) base.sourceId = sourceId;
    return base;
  }, [direction, itemId, amountRupees, interval, startDate, postingMode, sourceId]);

  function reset() {
    setItemId("");
    setAmountRupees("");
    setSourceId("");
    setInterval("monthly");
    setPostingMode("auto_post");
  }

  function save() {
    // A money box that is not an amount is named here, by the label printed
    // beside it — the server can only answer "Invalid request".
    try {
      buildAndSave();
    } catch (err) {
      if (err instanceof MoneyInputError) { toast.error(err.message); return; }
      throw err;
    }
  }

  function buildAndSave() {
    if (!body) {
      toast.error("Pick an item first");
      return;
    }
    createM.mutate(body, {
      onSuccess: () => {
        toast.success("Recurring schedule created");
        reset();
        onOpenChange(false);
      },
      onError: (e) => toast.error(apiErrorMessage(e, "Could not create schedule")),
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? onOpenChange(true) : (reset(), onOpenChange(false)))}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New recurring</DialogTitle>
          <DialogDescription>The engine posts this on schedule with origin “recurring”. Amounts left blank use the item’s default at posting time.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <Fld label="Direction">
            <Select
              value={direction}
              onValueChange={(v) => {
                setDirection(v as "in" | "out");
                setItemId("");
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="out">Money out (expense)</SelectItem>
                <SelectItem value="in">Money in (revenue)</SelectItem>
              </SelectContent>
            </Select>
          </Fld>
          <Fld label={direction === "in" ? "Revenue item" : "Expense item"}>
            <Select value={itemId} onValueChange={setItemId}>
              <SelectTrigger>
                <SelectValue placeholder="Pick an item…" />
              </SelectTrigger>
              <SelectContent>
                {items.map((i) => (
                  <SelectItem key={i.id} value={i.id}>
                    {i.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Fld>
          <Fld label="Amount (optional)">
            <Input type="number" placeholder="Item default" value={amountRupees} onChange={(e) => setAmountRupees(e.target.value)} />
          </Fld>
          <Fld label="How often?">
            <Select value={interval} onValueChange={(v) => setInterval(v as Interval)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVALS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Fld>
          <Fld label="Starts">
            {/* The ONE date in the app that may point at the future, and on
                purpose: this is a schedule, not a record of something that
                happened. "Starts next month" is the ordinary case, and it
                becomes the schedule's first run date. Everything else the owner
                can type a date into is capped at today. */}
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Fld>
          <Fld label="Added from (optional)">
            <Select value={sourceId || "__none__"} onValueChange={(v) => setSourceId(v === "__none__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="Default" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Default source</SelectItem>
                {sourceList.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Fld>
          <div className="sm:col-span-2">
            <Fld label="Posting">
              <Select value={postingMode} onValueChange={(v) => setPostingMode(v as "auto_post" | "confirm_first")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto_post">Auto-post — lands in the ledger automatically</SelectItem>
                  <SelectItem value="confirm_first">Confirm first — waits in the pending queue for you to approve</SelectItem>
                </SelectContent>
              </Select>
            </Fld>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => (reset(), onOpenChange(false))}>
            Cancel
          </Button>
          <Button onClick={save} disabled={createM.isPending || !body}>
            {createM.isPending ? "Creating…" : "Create schedule"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
