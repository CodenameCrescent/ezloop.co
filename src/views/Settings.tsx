import { TopBar } from "@/components/TopBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ImportHistory } from "@/views/settings/ImportHistory";
import { DeleteAccountRow } from "@/views/settings/DeleteAccount";
import { Trash2, Sparkles, RotateCcw, Package } from "lucide-react";
// Shared with the create-a-business screens, so the wording an owner uses to
// decide which type they are cannot drift between creating and changing one.
import { BusinessSection, type SettingsPageState, useSettingsPageLogic, Section, Row } from "./Settings.parts/UseSettingsPageLogic";
import { BusinessTypeSection } from "./Settings.parts/BusinessTypeSection";

export default function SettingsPage() {
  const {
    settings,
    updateSettings,
    selectedBusinessModels,
    toggleBusinessModel,
    businessType,
    features,
    featureOverrides,
    isFashionTest,
    demoProducts,
    setConfirmDemo,
    setConfirmReset,
    setConfirmErase,
    confirmDemo,
    handleLoadDemo,
    confirmReset,
    confirmErase,
    handleErase,
  } = useSettingsPageLogic();

  return (
    <>
      <TopBar
        title="Settings"
        subtitle="Preferences and your data"
      />
      <div className="app-page-shell">
        {/* The Light / Dark / System switch is gone: the app is light-only by
            decision (DESIGN.md), and a control that changes nothing costs
            trust in every control beside it. */}
        <BusinessSection settings={settings} updateSettings={updateSettings} selectedBusinessModels={selectedBusinessModels} toggleBusinessModel={toggleBusinessModel} />

        <BusinessTypeSection businessType={businessType} updateSettings={updateSettings} features={features} featureOverrides={featureOverrides} />

        <ThresholdsSection settings={settings} updateSettings={updateSettings} />

        <Section title="Notifications">
          <Row
            label="Toast on data change"
            hint="Show small confirmations when data updates"
          >
            <Switch
              checked={settings.toastsEnabled}
              onCheckedChange={(v) => updateSettings({ toastsEnabled: v })}
            />
          </Row>
        </Section>

        {/* ── Demo Data ───────────────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-xl bg-[color:var(--pl-orange-tint)]">
          <div className="flex items-center gap-2 px-5 py-3">
            <Sparkles className="h-3.5 w-3.5 text-[color:var(--pl-orange-text)]" />
            <h2 className="t-section text-[color:var(--pl-orange-text)]">Demo Data</h2>
          </div>

          {/* Product preview chips */}
          <div className="px-5 py-4 space-y-4">
            {isFashionTest && (
              <p className="text-sm text-muted-foreground">
                Load three months of realistic fashion-store data for the Fashion Test account, including products, orders, refunds, ads, and expenses.
              </p>
            )}
            {!isFashionTest && <p className="text-sm text-muted-foreground">
              Load a hand-crafted week of realistic demo data to see every chart, KPI, and product decision come to life — 8 products, ~80 orders, ad spend, and expenses included.
            </p>}

            <div className="flex flex-wrap gap-2">
              {demoProducts.map((p) => (
                <span
                  key={p.name}
                  className="inline-flex items-center gap-1.5 rounded-full border border-card-border bg-card px-2.5 py-1 text-xs text-muted-foreground"
                >
                  <span
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: `hsl(${p.imageColor})` }}
                  />
                  {p.name}
                </span>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                onClick={() => setConfirmDemo(true)}
                className="gap-2"
              >
                <Sparkles className="h-4 w-4" />
                Load Demo Data
              </Button>
              <Button
                onClick={() => setConfirmReset(true)}
                variant="outline"
                className="gap-2"
              >
                <RotateCcw className="h-4 w-4" />
                Reset to Demo
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              {/* The old second sentence told the owner to export first. That
                  export is gone, and it would not have saved them anyway — it
                  wrote one page of rows in a shape nothing could read back. A
                  warning that points at a rescue which does not exist is worse
                  than the plain warning on its own. */}
              Loading demo data will replace everything currently recorded for this business.
            </p>
          </div>
        </div>

        {/* ── Spreadsheets brought in ─────────────────────────────────────── */}
        {/* Above "Data", so the erase-everything block stays the last thing on
            the page. `Section` supplies the panel and the hairlines; the history
            supplies the rows. */}
        <Section title="Imported files">
          <ImportHistory />
        </Section>

        {/* ── Data management ─────────────────────────────────────────────── */}
        <Section title="Data">
          <Row
            label="Erase all data"
            hint="Permanently delete every order, product, and setting"
          >
            <Button
              onClick={() => setConfirmErase(true)}
              variant="destructive"
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" /> Erase Everything
            </Button>
          </Row>
          <DeleteAccountRow />
        </Section>
      </div>

      {/* ── Load Demo confirmation ─────────────────────────────────────────── */}
      <AlertDialog open={confirmDemo} onOpenChange={setConfirmDemo}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5 text-primary" />
              Load demo data?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will replace all your current products, orders, expenses, and ad spend with a realistic demo week. Your existing data will be lost.
              <br /><br />
              The demo includes 8 products, ~80 orders across 7 days, Meta and Google ad spend, and 4 operating expenses.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                handleLoadDemo();
                setConfirmDemo(false);
              }}
              className=""
            >
              Load Demo Data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Reset to Demo confirmation ─────────────────────────────────────── */}
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to demo data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will reload the demo dataset, replacing everything you currently have. Use this to start a fresh walkthrough of the app.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                handleLoadDemo();
                setConfirmReset(false);
              }}
            >
              Reset to Demo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Erase all confirmation ─────────────────────────────────────────── */}
      <AlertDialog open={confirmErase} onOpenChange={setConfirmErase}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Erase all data?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove every order, product, expense, and setting. You will start with a completely empty account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleErase}>
              Erase
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ThresholdsSection({ settings, updateSettings }: Pick<SettingsPageState, "settings" | "updateSettings">) {
  return (
    <Section title="Decision Thresholds">
          <Row
            label="Scale margin threshold"
            hint="Offers above this margin can be marked as Scale"
          >
            <div className="flex items-center gap-2">
              <Input
                type="number"
                value={settings.thresholds.scaleMargin}
                onChange={(e) =>
                  updateSettings({
                    thresholds: {
                      ...settings.thresholds,
                      scaleMargin: Number(e.target.value),
                    },
                  })
                }
                className="w-28"
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          </Row>
          <Row
            label="Stop score threshold"
            hint="Offers with score below this are marked as Stop"
          >
            <Input
              type="number"
              value={settings.thresholds.stopScore}
              onChange={(e) =>
                updateSettings({
                  thresholds: {
                    ...settings.thresholds,
                    stopScore: Number(e.target.value),
                  },
                })
              }
              className="w-28"
            />
          </Row>
          <Row
            label="Min orders for stable decision"
            hint="Below this, products are kept in Optimize"
          >
            <Input
              type="number"
              value={settings.thresholds.minOrders}
              onChange={(e) =>
                updateSettings({
                  thresholds: {
                    ...settings.thresholds,
                    minOrders: Number(e.target.value),
                  },
                })
              }
              className="w-28"
            />
          </Row>
        </Section>
  );
}
