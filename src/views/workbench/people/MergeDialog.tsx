import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { apiErrorMessage, useMergePeople } from "@/api/hooks";

// ── Merge dialog ──────────────────────────────────────────────────────────────
export function MergeDialog({
  group,
  onClose,
  onDone,
}: {
  group: { keepId: string; candidates: { id: string; displayName: string }[] };
  onClose: () => void;
  onDone: () => void;
}) {
  const [keepId, setKeepId] = useState(group.keepId);
  const mergeM = useMergePeople();
  const mergeIds = group.candidates.filter((c) => c.id !== keepId).map((c) => c.id);

  function submit() {
    // Merge each other record into the keeper, one at a time.
    let remaining = mergeIds.length;
    if (remaining === 0) return onClose();
    let failed = false;
    for (const mergeId of mergeIds) {
      mergeM.mutate(
        { id: keepId, mergeId },
        {
          onError: (e) => {
            if (!failed) toast.error(apiErrorMessage(e, "Merge failed"));
            failed = true;
          },
          onSettled: () => {
            remaining -= 1;
            if (remaining === 0 && !failed) {
              toast.success("People merged");
              onDone();
            }
          },
        },
      );
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Merge duplicates</DialogTitle>
          <DialogDescription>
            Keep one record; the others are archived and their transactions, subscriptions, and history repoint to the keeper. This cannot move money.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label className="text-xs font-medium">Keep this record</Label>
          <Select value={keepId} onValueChange={setKeepId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {group.candidates.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Archiving: {group.candidates.filter((c) => c.id !== keepId).map((c) => c.displayName).join(", ") || "none"}
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mergeM.isPending || mergeIds.length === 0}>
            {mergeM.isPending ? "Merging…" : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
