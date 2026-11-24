import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { readMoney, MoneyInputError } from "@/lib/money";

/**
 * Ad spend — what you paid platforms to bring customers in.
 *
 * Everything logged here is an ordinary expense on the ledger, which is why
 * True profit moves the moment you save. That is the whole reason this screen
 * exists before any ad integration does: the profit number is wrong without it,
 * and no API is needed to type in what you spent.
 */

/** Offered by name so the common case is one tap, not typing. */
export const PRESETS = ["Meta Ads", "Google Ads", "TikTok Ads"] as const;

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function LogSpendDialog({
  open,
  onOpenChange,
  knownPlatforms,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  knownPlatforms: string[];
  pending: boolean;
  onSubmit: (body: {
    platform: string;
    spentOn: string;
    amountCents: number;
    paidAt?: string | null;
    campaign?: string | null;
    notes?: string | null;
  }) => void;
}) {
  // Platforms already used come first, then any preset not yet among them, so
  // the list never offers the same platform twice.
  const options = useMemo(() => {
    const seen = new Set(knownPlatforms.map((p) => p.toLowerCase()));
    return [...knownPlatforms, ...PRESETS.filter((p) => !seen.has(p.toLowerCase()))];
  }, [knownPlatforms]);

  const [platform, setPlatform] = useState<string>(options[0] ?? PRESETS[0]);
  const [custom, setCustom] = useState("");
  const [spentOn, setSpentOn] = useState(todayIso());
  const [amount, setAmount] = useState("");
  const [campaign, setCampaign] = useState("");
  const [notes, setNotes] = useState("");
  const [unpaid, setUnpaid] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const usingCustom = platform === "__other";
  const resolvedPlatform = usingCustom ? custom.trim() : platform;

  const reset = () => {
    setCustom("");
    setAmount("");
    setCampaign("");
    setNotes("");
    setUnpaid(false);
    setError(null);
  };

  const submit = () => {
    setError(null);
    if (!resolvedPlatform) {
      setError("Which platform did the money go to?");
      return;
    }
    let amountCents: number;
    try {
      // The shared reader, so a typo here fails the same way it does on every
      // other money box in the app.
      amountCents = readMoney("Amount", amount);
    } catch (err) {
      setError(err instanceof MoneyInputError ? err.message : "Enter how much you spent");
      return;
    }
    if (amountCents <= 0) {
      setError("Enter how much you spent");
      return;
    }

    onSubmit({
      platform: resolvedPlatform,
      spentOn: new Date(`${spentOn}T12:00:00`).toISOString(),
      amountCents,
      // undefined = paid on the day, which is what a card-billed ad account
      // does. null = the platform invoiced you and it has not cleared.
      paidAt: unpaid ? null : undefined,
      campaign: campaign.trim() || null,
      notes: notes.trim() || null,
    });
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log ad spend</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ad-platform">Where did it go?</Label>
            <Select value={platform} onValueChange={setPlatform}>
              <SelectTrigger id="ad-platform">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
                <SelectItem value="__other">Somewhere else…</SelectItem>
              </SelectContent>
            </Select>
            {usingCustom && (
              <Input
                className="mt-2"
                placeholder="Name the platform"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                aria-label="Platform name"
              />
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ad-date">Day</Label>
              <Input id="ad-date" type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ad-amount">How much?</Label>
              <Input
                id="ad-amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ad-campaign">Campaign (optional)</Label>
            <Input
              id="ad-campaign"
              placeholder="e.g. Retargeting"
              value={campaign}
              onChange={(e) => setCampaign(e.target.value)}
            />
          </div>

          <label className="flex items-center gap-2">
            <input type="checkbox" checked={unpaid} onChange={(e) => setUnpaid(e.target.checked)} />
            <span className="t-body">They've billed me but I haven't paid yet</span>
          </label>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ad-notes">Notes (optional)</Label>
            <Textarea id="ad-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>

          {error && <p className="t-body text-[color:var(--pl-red)]">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending ? "Saving…" : "Log spend"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
