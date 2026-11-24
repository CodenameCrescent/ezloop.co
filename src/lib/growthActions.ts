import type { GeneratedInsight } from "./insightsEngine";

export type GrowthActionPriority = "high" | "medium" | "low";
export type GrowthActionStatus = "pending" | "in_progress" | "done" | "ignored";

export interface GrowthAction {
  id: string;
  title: string;
  description: string;
  reason: string;
  linkedInsightId: string;
  relatedOfferId?: string | null;
  relatedClientId?: string | null;
  relatedCampaignId?: string | null;
  relatedCategory?: string | null;
  priority: GrowthActionPriority;
  expectedImpact?: string;
  status: GrowthActionStatus;
  createdAt: string;
  updatedAt: string;
}

export interface StoredGrowthActionState {
  id: string;
  linkedInsightId: string;
  status: GrowthActionStatus;
  createdAt: string;
  updatedAt: string;
}

export type StoredGrowthActionMap = Record<string, StoredGrowthActionState>;

export const GROWTH_ACTION_STORAGE_KEY = "profit-loop:growth-action-status:v1";

const STATUS_VALUES = new Set<GrowthActionStatus>([
  "pending",
  "in_progress",
  "done",
  "ignored",
]);

function isStatus(value: unknown): value is GrowthActionStatus {
  return typeof value === "string" && STATUS_VALUES.has(value as GrowthActionStatus);
}

function priorityFromInsight(insight: GeneratedInsight): GrowthActionPriority {
  if (insight.priority >= 85 || insight.severity === "critical") return "high";
  if (insight.priority >= 60 || insight.severity === "warning") return "medium";
  return "low";
}

function categoryFromInsight(insight: GeneratedInsight): string | null {
  const category = insight.relatedMetrics.category;
  return typeof category === "string" ? category : null;
}

function templateForInsight(insight: GeneratedInsight): {
  title: string;
  description: string;
  expectedImpact?: string;
} | null {
  if (insight.id === "summary-revenue-up-profit-down") {
    return {
      title: "Review fast-growing costs before scaling",
      description: "Review the cost categories that grew fastest this period before scaling more.",
      expectedImpact: "Protects profit while revenue is growing.",
    };
  }

  if (insight.id.startsWith("offers-high-revenue-low-margin")) {
    const offerName = insight.relatedMetrics.offerName;
    return {
      title: "Improve margin before pushing more sales",
      description:
        typeof offerName === "string"
          ? `Improve margin on ${offerName} before pushing more sales.`
          : "Improve margin on this offer before pushing more sales.",
      expectedImpact: "More sales should turn into stronger true profit.",
    };
  }

  if (insight.id.startsWith("costs-spike")) {
    const category = categoryFromInsight(insight);
    return {
      title: category ? `Review ${category} cost` : "Review cost spike",
      description: "Review this cost category and set a limit or find a cheaper option.",
      expectedImpact: "Reduces pressure on net profit.",
    };
  }

  if (insight.id === "ads-spend-pressure") {
    return {
      title: "Check ad spend before increasing budget",
      description: "Check campaigns with high spend and weak true profit before increasing budget.",
      expectedImpact: "Prevents buying sales that do not create profit.",
    };
  }

  if (insight.id === "summary-weak-cash-flow") {
    return {
      title: "Protect cash flow",
      description: "Delay non-essential spending or follow up unpaid receivables.",
      expectedImpact: "Improves available cash without needing more sales first.",
    };
  }

  if (insight.id.startsWith("offers-winner")) {
    const offerName = insight.relatedMetrics.offerName;
    return {
      title: "Consider promoting a healthy offer",
      description:
        typeof offerName === "string"
          ? `Consider promoting ${offerName} more if stock or capacity allows.`
          : "Consider promoting this offer more if stock or capacity allows.",
      expectedImpact: "Focuses growth on an offer that already keeps profit.",
    };
  }

  if (insight.id === "profit-leak-negative-net-profit" || insight.id === "profit-leak-thin-margin") {
    return {
      title: "Fix the biggest profit leak",
      description: "Review the largest cost or margin leak before adding more growth spend.",
      expectedImpact: "Raises true profit before the business gets busier.",
    };
  }

  return null;
}

export function loadGrowthActionState(storage: Storage | undefined = globalThis.localStorage): StoredGrowthActionMap {
  if (!storage) return {};
  try {
    const raw = storage.getItem(GROWTH_ACTION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const map: StoredGrowthActionMap = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const row = value as Partial<StoredGrowthActionState>;
      if (row.id !== id || !row.linkedInsightId || !isStatus(row.status)) continue;
      map[id] = {
        id,
        linkedInsightId: row.linkedInsightId,
        status: row.status,
        createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date().toISOString(),
        updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : new Date().toISOString(),
      };
    }
    return map;
  } catch {
    return {};
  }
}

export function saveGrowthActionState(
  state: StoredGrowthActionMap,
  storage: Storage | undefined = globalThis.localStorage,
) {
  if (!storage) return;
  try {
    storage.setItem(GROWTH_ACTION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage can be disabled or full; actions still render as pending.
  }
}

export function updateGrowthActionStatus(
  state: StoredGrowthActionMap,
  action: GrowthAction,
  status: GrowthActionStatus,
  now = new Date(),
): StoredGrowthActionMap {
  const existing = state[action.id];
  return {
    ...state,
    [action.id]: {
      id: action.id,
      linkedInsightId: action.linkedInsightId,
      status,
      createdAt: existing?.createdAt ?? action.createdAt,
      updatedAt: now.toISOString(),
    },
  };
}

export function buildGrowthActionsFromInsights(
  insights: GeneratedInsight[],
  storedState: StoredGrowthActionMap = {},
  now = new Date(),
): GrowthAction[] {
  const seen = new Set<string>();
  const actions: GrowthAction[] = [];
  const nowIso = now.toISOString();

  for (const insight of insights) {
    const template = templateForInsight(insight);
    if (!template) continue;
    const id = `growth-action:${insight.id}`;
    if (seen.has(id)) continue;
    seen.add(id);

    const stored = storedState[id];
    actions.push({
      id,
      title: template.title,
      description: template.description,
      reason: insight.plainEnglishMessage,
      linkedInsightId: insight.id,
      relatedOfferId: insight.relatedOfferId,
      relatedClientId: insight.relatedClientId,
      relatedCampaignId: insight.relatedCampaignId,
      relatedCategory: categoryFromInsight(insight),
      priority: priorityFromInsight(insight),
      expectedImpact: template.expectedImpact,
      status: stored?.status ?? "pending",
      createdAt: stored?.createdAt ?? nowIso,
      updatedAt: stored?.updatedAt ?? nowIso,
    });
  }

  return actions.sort((a, b) => {
    const priorityOrder: Record<GrowthActionPriority, number> = { high: 3, medium: 2, low: 1 };
    return priorityOrder[b.priority] - priorityOrder[a.priority] || a.title.localeCompare(b.title);
  });
}
