import type {
  BusinessType as DomainBusinessType,
  GatedFeature as DomainGatedFeature,
} from "@workspace/domain";

export type OrderStatus = "completed" | "pending" | "cancelled" | "refunded";
export type PaymentStatus = "paid" | "unpaid" | "partially_paid";

export interface Product {
  id: string;
  name: string;
  category: string | null;
  defaultCostPrice: number;
  defaultSellingPrice: number;
  packagingCost: number;
  defaultShippingCost: number;
  imageColor: string;
  supplier: string | null;
  status: string;
  notes: string | null;
}

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitSellingPrice: number;
  unitCostPrice: number;
}

export interface Order {
  id: string;
  /** Customer name, free-form text. */
  customer: string | null;
  /** Customer phone number, free-form text. Used as the primary identity match. */
  phone: string | null;
  /** Acquisition source — channel that brought this order (e.g. "Meta Ads", "Organic"). */
  source: string | null;
  /** Platform / marketplace that fulfilled this order (e.g. "Own Store", "Shopify"). */
  platform: string | null;
  /** External or user-facing order number from a shop, CSV, or manual entry. */
  externalId: string | null;
  paymentStatus: PaymentStatus;
  /** Sum of (qty * unitSellingPrice) across items. Denormalized server-side. */
  sellingPrice: number;
  /** Sum of (qty * unitCostPrice) across items. Denormalized server-side. */
  costPrice: number;
  /** Order-level discount deducted from revenue. */
  discount: number;
  refundAmount: number;
  taxAmount: number;
  shippingCharged: number;
  deliveryCost: number;
  adCost: number;
  date: string;
  status: OrderStatus;
  notes: string | null;
  items: OrderItem[];
  /** Display label: first item name, suffixed with "+N" if more items. */
  productName: string;
  /** First item's productId — for legacy display only, not for attribution. */
  productId: string;
}

export interface AdSpendEntry {
  id: string;
  date: string;
  totalSpend: number;
  productId?: string | null;
  platform?: string | null;
  campaign?: string | null;
  source?: string;
}

export interface DecisionThresholds {
  scaleMargin: number;
  stopScore: number;
  minOrders: number;
}

export type BusinessModel =
  | "products"
  | "services"
  | "subscriptions"
  | "freelance_projects"
  | "digital_products"
  | "mixed";

export interface Settings {
  currency: string;
  currencySymbol: string;
  businessName: string;
  plan: string;
  defaultCostPrice: number;
  defaultSellingPrice: number;
  locale: string;
  toastsEnabled: boolean;
  adAttributionPct: number;
  /** Minimum cash reserve user wants to keep on hand. Used by runway calc. */
  cashBuffer: number;
  businessModels: BusinessModel[];
  /** Decides which features are visible and which expense types get seeded. */
  businessType?: DomainBusinessType;
  /**
   * Owner choices per feature; a missing key means "follow my business type".
   * Writes merge, and `null` clears a key back to following the type.
   */
  featureOverrides?: Partial<Record<DomainGatedFeature, boolean | null>>;
  /** Server-resolved effective state per feature. Read-only — patch featureOverrides. */
  features?: Partial<Record<DomainGatedFeature, boolean>>;
  thresholds: DecisionThresholds;
}

export interface AppData {
  orders: Order[];
  products: Product[];
  adSpend: AdSpendEntry[];
  settings: Settings;
}

export type DecisionCategory = "scale" | "optimize" | "stop";

export interface ProductMetrics {
  productId: string;
  productName: string;
  imageColor: string;
  totalProfit: number;
  totalRevenue: number;
  totalAdCost: number;
  totalCostBase: number;
  orderCount: number;
  marginPct: number;
  avgProfitPerOrder: number;
  score: number;
  category: DecisionCategory;
  reason: string;
  flags: string[];
}
