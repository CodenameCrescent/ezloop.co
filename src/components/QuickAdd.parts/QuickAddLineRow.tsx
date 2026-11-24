import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { quantityFieldLabel } from "@workspace/domain";
import { type LineDraft, SPREAD_CHOICES, spreadChoiceLabel, shareNote, TargetPicker, spreadNote } from "./DraftFromTransaction";
import { type QuickAddState } from "./UseQuickAddLogic";

export function QuickAddLineRow({ line, revCatalog, expCatalog, typedIn, setLineDirection, lines, setLines, updateLine, selectItem, moneySymbol, showAdvanced, categories, hasRevenue, paid, targetGroups, updateShare, removeShare, addShare }: Pick<QuickAddState, "revCatalog" | "expCatalog" | "typedIn" | "setLineDirection" | "lines" | "setLines" | "updateLine" | "selectItem" | "moneySymbol" | "showAdvanced" | "categories" | "hasRevenue" | "paid" | "targetGroups" | "updateShare" | "removeShare" | "addShare"> & { line: LineDraft }) {
            const items = line.direction === "in" ? revCatalog : expCatalog;
            const selected = items.find((i) => i.id === line.itemId);
            const isVariable = line.direction === "in" && selected && "pricingModel" in selected && selected.pricingModel === "variable";
            const priceEditable = !line.itemId || isVariable || line.direction === "out" || typedIn !== null;
            const unitLabel = selected && "unitLabel" in selected ? selected.unitLabel : null;
            return (
              <div key={line.key} className="space-y-2 rounded-lg border border-card-border p-3">
                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-md border border-card-border p-0.5 text-xs">
                    <button
                      className={`rounded px-2 py-1 ${line.direction === "in" ? "bg-[color:var(--pl-green-tint)] text-[color:var(--pl-green)]" : "text-muted-foreground"}`}
                      onClick={() => setLineDirection(line.key, "in")}
                    >
                      Money in
                    </button>
                    <button
                      className={`rounded px-2 py-1 ${line.direction === "out" ? "bg-[color:var(--pl-red-tint)] text-destructive" : "text-muted-foreground"}`}
                      onClick={() => setLineDirection(line.key, "out")}
                    >
                      Money out
                    </button>
                  </div>
                  {lines.length > 1 && (
                    <Button variant="ghost" size="icon" className="ml-auto" onClick={() => setLines((p) => p.filter((l) => l.key !== line.key))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <Select value={line.itemId || "__free__"} onValueChange={(v) => (v === "__free__" ? updateLine(line.key, { itemId: "" }) : selectItem(line.key, line.direction, v))}>
                  <SelectTrigger><SelectValue placeholder="Pick or type…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__free__">Type a label…</SelectItem>
                    {items.map((i) => (
                      <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {!line.itemId && (
                  <Input placeholder={line.direction === "in" ? "What did you sell?" : "What was it for?"} value={line.label} onChange={(e) => updateLine(line.key, { label: e.target.value })} />
                )}

                <div className="flex gap-2">
                  <div className="flex-1">
                    {/* The item says what its quantity is counted in — hours,
                        units, months. "Qty" only stands in until one is picked. */}
                    <Label className="text-xs text-muted-foreground">{quantityFieldLabel(unitLabel)}</Label>
                    <Input value={line.qty} onChange={(e) => updateLine(line.key, { qty: e.target.value })} />
                  </div>
                  <div className="flex-[2]">
                    <Label className="text-xs text-muted-foreground">
                      {line.direction === "in" ? (unitLabel ? `Price per ${unitLabel}` : "Price (each)") : "Amount"}
                      {typedIn ? ` (${moneySymbol})` : ""}
                    </Label>
                    <Input
                      type="number"
                      placeholder={priceEditable ? "0.00" : "auto"}
                      value={line.priceRupees}
                      disabled={!priceEditable && !!line.itemId}
                      onChange={(e) => updateLine(line.key, { priceRupees: e.target.value })}
                    />
                  </div>
                </div>

                {showAdvanced && (
                  <div className="flex gap-2">
                    <div className="flex-[2]">
                      <Label className="text-xs text-muted-foreground">Category (optional)</Label>
                      <Select value={line.categoryId || "__none__"} onValueChange={(v) => updateLine(line.key, { categoryId: v === "__none__" ? "" : v })}>
                        <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">None</SelectItem>
                          {(categories.data ?? []).map((c) => (
                            <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {line.direction === "in" && (
                      <div className="flex-1">
                        <Label className="text-xs text-muted-foreground">Discount</Label>
                        <Input type="number" value={line.lineDiscountRupees} onChange={(e) => updateLine(line.key, { lineDiscountRupees: e.target.value })} />
                      </div>
                    )}
                    {line.direction === "out" && !hasRevenue && !line.isAdvance && (
                      <div className="flex-[2]">
                        <Label className="text-xs text-muted-foreground">Charge it to</Label>
                        <Select
                          value={line.spreadMonths || "__now__"}
                          onValueChange={(v) => updateLine(line.key, { spreadMonths: v === "__now__" ? "" : v })}
                        >
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__now__">This month</SelectItem>
                            {SPREAD_CHOICES.map((m) => (
                              <SelectItem key={m} value={String(m)}>{spreadChoiceLabel(m)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}

                {/*
                  Said in money, not in months. "Spread over 24 months" is a
                  setting; "Rs 3,958.34 a month" is the thing the owner is
                  actually agreeing to, and it is what they will see on the
                  page afterwards.
                */}
                {showAdvanced && line.direction === "out" && !hasRevenue && !line.isAdvance && spreadNote(line, moneySymbol) && (
                  <p className="text-xs text-muted-foreground">{spreadNote(line, moneySymbol)}</p>
                )}

                {/*
                  Only on a PAID standalone line. An advance is by definition
                  money that has already moved, and a cost recorded inside a
                  sale has already been incurred — the server refuses both, so
                  the control does not offer them.
                */}
                {/*
                  Waste is INFORMATION, and the helper says so in the owner's own
                  words. Recording it must never look like recording a second
                  cost — you already paid for the whole delivery.
                */}
                {showAdvanced && line.direction === "out" && (
                  <div>
                    <Label className="text-xs text-muted-foreground">How much of it was wasted? (optional)</Label>
                    <Input
                      value={line.wastedQty}
                      onChange={(e) => updateLine(line.key, { wastedQty: e.target.value })}
                      inputMode="decimal"
                      placeholder="0"
                    />
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Ruined, scrapped or left over. This does not add a cost — you already paid
                      for it — it just shows up on What you own as money going nowhere.
                    </p>
                  </div>
                )}

                {showAdvanced && !hasRevenue && paid && (
                  <label className="flex items-start justify-between gap-3 rounded-lg border border-card-border p-3">
                    <span>
                      <span className="block text-sm">
                        {line.direction === "out" ? "Is this paid ahead of the work?" : "Is this a deposit you are holding?"}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">
                        {line.direction === "out"
                          ? "An advance to a subcontractor or supplier. It leaves your bank now and only becomes a cost when the bill arrives."
                          : "A deposit taken before the work. It is cash in now and only becomes a sale when you have earned it."}
                      </span>
                    </span>
                    <Switch
                      checked={line.isAdvance}
                      onCheckedChange={(v) => updateLine(line.key, { isAdvance: v, spreadMonths: v ? "" : line.spreadMonths })}
                    />
                  </label>
                )}

                {showAdvanced && line.direction === "out" && !hasRevenue && (
                  <div className="space-y-2">
                    {line.splitParts === null ? (
                      <div className="flex items-end gap-2">
                        <div className="flex-[3]">
                          <Label className="text-xs text-muted-foreground">Who was this for?</Label>
                          <TargetPicker
                            groups={targetGroups}
                            value={line.targetKey}
                            onChange={(v) => updateLine(line.key, { targetKey: v })}
                          />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            updateLine(line.key, {
                              // Carry whatever was already picked into the first
                              // share, so choosing to split never loses it.
                              splitParts: [
                                { key: Math.random().toString(36).slice(2), targetKey: line.targetKey, percent: "50" },
                                { key: Math.random().toString(36).slice(2), targetKey: "", percent: "50" },
                              ],
                              targetKey: "",
                            })
                          }
                        >
                          Split it
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs text-muted-foreground">Who was this for?</Label>
                          <button
                            className="text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => updateLine(line.key, { splitParts: null })}
                          >
                            Don't split
                          </button>
                        </div>
                        {line.splitParts.map((share) => (
                          <div key={share.key} className="flex items-center gap-2">
                            <div className="flex-[3]">
                              <TargetPicker
                                groups={targetGroups}
                                value={share.targetKey}
                                onChange={(v) => updateShare(line.key, share.key, { targetKey: v })}
                                allowNobody={false}
                              />
                            </div>
                            <div className="flex flex-1 items-center gap-1">
                              <Input
                                type="number"
                                value={share.percent}
                                onChange={(e) => updateShare(line.key, share.key, { percent: e.target.value })}
                              />
                              <span className="text-xs text-muted-foreground">%</span>
                            </div>
                            <button
                              className="text-muted-foreground hover:text-destructive"
                              disabled={line.splitParts!.length <= 2}
                              onClick={() => removeShare(line.key, share.key)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                        <div className="flex items-center justify-between">
                          <Button variant="outline" size="sm" onClick={() => addShare(line.key)} className="gap-1">
                            <Plus className="h-4 w-4" /> Another share
                          </Button>
                          {/*
                            Shares are RELATIVE, so 33/33/33 is a clean three-way
                            split and not a 1% error. Saying what will happen
                            beats refusing arithmetic the owner did in their head.
                          */}
                          <span className="text-xs text-muted-foreground">{shareNote(line)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
}

export function AdvancedFields({ reference, setReference, notes, setNotes, hasRevenue, orderDiscountRupees, setOrderDiscountRupees, taxPaidRupees, setTaxPaidRupees, taxReclaimable, setTaxReclaimable }: Pick<QuickAddState, "reference" | "setReference" | "notes" | "setNotes" | "hasRevenue" | "orderDiscountRupees" | "setOrderDiscountRupees" | "taxPaidRupees" | "setTaxPaidRupees" | "taxReclaimable" | "setTaxReclaimable">) {
  return (
    <>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Reference # (optional)</Label>
                  <Input placeholder="Invoice or receipt no." value={reference} onChange={(e) => setReference(e.target.value)} />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              {hasRevenue && (
                <div>
                  <Label className="text-xs text-muted-foreground">Order discount (optional)</Label>
                  <Input type="number" placeholder="0.00" value={orderDiscountRupees} onChange={(e) => setOrderDiscountRupees(e.target.value)} />
                </div>
              )}
              <div>
                <Label className="text-xs text-muted-foreground">Tax included in this amount (optional)</Label>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={taxPaidRupees}
                  onChange={(e) => setTaxPaidRupees(e.target.value)}
                />
                {taxPaidRupees.trim() !== "" && (
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <div>
                      <Label className="text-xs">Can you claim this tax back?</Label>
                      <p className="text-[11px] text-muted-foreground">
                        {taxReclaimable
                          ? "Then it isn't a real cost, so it won't count against your profit."
                          : "If not, it stays part of what this cost you."}
                      </p>
                    </div>
                    <Switch checked={taxReclaimable} onCheckedChange={setTaxReclaimable} />
                  </div>
                )}
              </div>
            </>
  );
}
