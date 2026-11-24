import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * Adds rows by the HANDFUL, not one at a time.
 *
 * A one-person-one-target dialog cost six clicks per row — fifty-four to set up
 * three people across three targets, before a single hour was typed. That alone
 * would have sunk the "under a minute a week" bar. Ticking both lists and
 * adding every combination at once does the same job in about seven.
 */
export function AddRowDialog({
  open,
  onOpenChange,
  members,
  targets,
  existing,
  onAdd,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  members: Array<{ id: string; name: string }>;
  targets: Array<{ targetType: string; targetId: string; label: string; group: string }>;
  existing: Array<{ personId: string; targetType: string; targetId: string }>;
  onAdd: (rows: Array<{ personId: string; targetType: string; targetId: string; label: string }>) => void;
}) {
  const [people, setPeople] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    // Everyone pre-ticked: the common case is "the whole team worked this week".
    setPeople(new Set(members.map((m) => m.id)));
    setPicked(new Set());
  }, [open, members]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof targets>();
    for (const t of targets) map.set(t.group, [...(map.get(t.group) ?? []), t]);
    return [...map.entries()];
  }, [targets]);

  const toggle = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    next.has(key) ? next.delete(key) : next.add(key);
    apply(next);
  };

  /** Every combination that isn't already on the sheet. */
  const newRows = useMemo(() => {
    const rows: Array<{ personId: string; targetType: string; targetId: string; label: string }> = [];
    for (const personId of people) {
      for (const key of picked) {
        const target = targets.find((t) => `${t.targetType}:${t.targetId}` === key);
        if (!target) continue;
        const already = existing.some(
          (e) => e.personId === personId && e.targetType === target.targetType && e.targetId === target.targetId,
        );
        if (already) continue;
        rows.push({ personId, targetType: target.targetType, targetId: target.targetId, label: target.label });
      }
    }
    return rows;
  }, [people, picked, targets, existing]);

  function add() {
    if (newRows.length === 0) {
      toast.info("Those rows are already on the sheet");
      onOpenChange(false);
      return;
    }
    onAdd(newRows);
    onOpenChange(false);
  }

  const Tick = ({ on }: { on: boolean }) => (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[10px] ${
        on ? "border-primary bg-primary text-primary-foreground" : "border-border"
      }`}
    >
      {on ? "✓" : ""}
    </span>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add rows</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Who worked</Label>
            {members.length === 0 ? (
              <p className="mt-1 text-[11px] text-[color:var(--pl-amber)]">
                No team members yet — add them on the Team page first, so their hours have a cost.
              </p>
            ) : (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {members.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => toggle(people, m.id, setPeople)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
                      people.has(m.id) ? "border-primary bg-[color:var(--pl-orange-tint)]" : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <Tick on={people.has(m.id)} />
                    {m.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <Label>On what</Label>
            <div className="mt-1 space-y-2">
              {grouped.map(([group, items]) => (
                <div key={group}>
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {items.map((t) => {
                      const key = `${t.targetType}:${t.targetId}`;
                      return (
                        <button
                          key={key}
                          onClick={() => toggle(picked, key, setPicked)}
                          className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
                            picked.has(key) ? "border-primary bg-[color:var(--pl-orange-tint)]" : "border-border hover:bg-muted/50"
                          }`}
                        >
                          <Tick on={picked.has(key)} />
                          {t.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <Button className="w-full" onClick={add} disabled={newRows.length === 0}>
            {newRows.length === 0
              ? "Pick who worked, and on what"
              : `Add ${newRows.length} ${newRows.length === 1 ? "row" : "rows"}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
