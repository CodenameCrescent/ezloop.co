/**
 * What each import kind accepts, defined once.
 *
 * The matching screen, the template generator and the row parser all read this
 * table. Defining the columns three times is how a template drifts from what
 * the importer will actually take, so they read one list or none.
 *
 * `synonyms` are compared against normalized headers (lowercased, punctuation
 * dropped, whitespace collapsed) — see `normalizeHeader` in importMatch.ts.
 */

export type ImportKind = "transactions" | "revenue_items" | "expense_items" | "people";

/**
 * The three kinds that describe the business rather than move its money.
 *
 * Named here, beside the kinds themselves, so the one parser that reads them can
 * refuse a transactions table at compile time — those columns hold dates and a
 * direction, and reading them as catalog cells would produce a shape nothing
 * downstream could use.
 */
export type CatalogKind = Exclude<ImportKind, "transactions">;

export const IMPORT_KINDS = ["transactions", "revenue_items", "expense_items", "people"] as const;

/** How a cell is read. Drives parsing and the template's example row. */
export type CellKind = "text" | "money" | "date" | "decimal" | "enum" | "list";

export interface ColumnDef {
  /** Stable machine key. Used in mappings, groups and commit — never shown. */
  field: string;
  /** The header written into our template and shown on the matching screen. */
  label: string;
  kind: CellKind;
  required: boolean;
  /** Normalized header names that map here automatically. Includes the label. */
  synonyms: string[];
  /** For `enum`: accepted values. `example` must be one of them. */
  values?: readonly string[];
  /** One cell for the template's sample row. */
  example: string;
  /** Shown under the dropdown on the matching screen. Plain English. */
  hint?: string;
}

const revenueItemTypes = ["product", "service", "subscription", "rental", "commission", "royalty", "other"] as const;
const pricingModels = ["fixed", "per_unit", "hourly", "variable", "tiered"] as const;
const expensePurposes = ["marketing", "operational", "maintenance", "payroll", "cogs", "custom"] as const;
const costNatures = ["fixed", "variable", "semi_variable"] as const;
const expenseBehaviors = ["one_time", "recurring", "usage_based"] as const;
const personKinds = ["customer", "vendor", "employee", "other"] as const;

const TRANSACTIONS: ColumnDef[] = [
  {
    field: "date", label: "Date", kind: "date", required: true, example: "2026-04-03",
    synonyms: ["date", "transaction date", "txn date", "value date", "order date", "posted", "posted date", "created at", "datum", "fecha"],
    hint: "The day the sale or cost happened.",
  },
  {
    field: "description", label: "Description", kind: "text", required: false, example: "Facebook Ads",
    // "name" belongs to orderId, not here: Shopify's order export heads its
    // order-number column "Name", and losing the id loses grouping and dedupe.
    synonyms: ["description", "details", "narrative", "memo", "reference detail", "particulars", "transaction description", "narration", "counter party", "payee"],
    hint: "What it was. Used as the label when nothing else identifies the row.",
  },
  {
    field: "amount", label: "Amount", kind: "money", required: false, example: "45.00",
    // A currency-suffixed header normalizes to this shape: Starling writes
    // "Amount (GBP)", which `normalizeHeader` folds to "amount gbp".
    synonyms: ["amount", "value", "total", "net amount", "transaction amount", "betrag", "amount gbp", "amount usd", "amount eur", "amount pkr", "amount inr"],
    hint: "One column with a sign, or paired with a Type column.",
  },
  {
    field: "moneyIn", label: "Money in", kind: "money", required: false, example: "",
    synonyms: ["money in", "paid in", "paid in amount", "credit", "credits", "credit amount", "deposit", "deposit amt", "deposit amount", "received", "inflow"],
    hint: "The bank-statement shape: two columns instead of a sign.",
  },
  {
    field: "moneyOut", label: "Money out", kind: "money", required: false, example: "",
    synonyms: ["money out", "paid out", "paid out amount", "debit", "debits", "debit amount", "withdrawal", "withdrawal amt", "withdrawal amount", "spent", "outflow"],
  },
  {
    // The example is filled rather than blank on purpose: an unsigned positive
    // Amount with no Type reads as money IN, so a blank cell here would have
    // taught the owner the one shape that files a cost as income.
    field: "type", label: "Type", kind: "text", required: false, example: "Expense",
    synonyms: ["type", "direction", "kind", "dr cr", "debit credit", "transaction type"],
    hint: "Words like Sale, Income, Purchase, Expense.",
  },
  {
    field: "item", label: "Item", kind: "text", required: false, example: "",
    synonyms: ["item", "product", "product name", "service", "line item", "sku name", "lineitem name"],
    hint: "Matched to your catalogue by name. Unmatched is fine — it stays a label.",
  },
  { field: "qty", label: "Quantity", kind: "decimal", required: false, example: "1", synonyms: ["quantity", "qty", "units", "lineitem quantity"] },
  // "account" is deliberately NOT a synonym: on a bank export it claims the
  // Account column and files a source label into the user's category tree.
  // Type, category and source are orthogonal. An accounting export loses one
  // guess and the owner fixes it with a dropdown; the reverse pollutes data.
  { field: "category", label: "Category", kind: "text", required: false, example: "Marketing", synonyms: ["category", "categories", "class"] },
  { field: "channel", label: "Channel", kind: "text", required: false, example: "", synonyms: ["channel", "source", "store", "account name", "shop", "platform"] },
  { field: "person", label: "Person", kind: "text", required: false, example: "", synonyms: ["person", "customer", "client", "supplier", "vendor", "customer name", "billing name"] },
  {
    field: "taxCollected", label: "Tax collected", kind: "money", required: false, example: "",
    synonyms: ["tax collected", "tax", "taxes", "vat", "gst", "sales tax", "tax amount"],
    hint: "Tax you charged. Never counted as revenue.",
  },
  { field: "shippingCharged", label: "Shipping charged", kind: "money", required: false, example: "", synonyms: ["shipping charged", "shipping", "delivery", "postage", "freight"] },
  { field: "discount", label: "Discount", kind: "money", required: false, example: "", synonyms: ["discount", "discount amount", "discounts"] },
  { field: "reference", label: "Reference", kind: "text", required: false, example: "", synonyms: ["reference", "invoice number", "invoice no", "receipt number", "ref"] },
  {
    field: "orderId", label: "Order ID", kind: "text", required: false, example: "",
    synonyms: ["order id", "order number", "order", "id", "charge id", "transaction id", "name"],
    hint: "Rows sharing an ID become one sale with several items.",
  },
  {
    field: "paidOn", label: "Paid on", kind: "date", required: false, example: "",
    synonyms: ["paid on", "paid date", "payment date", "settled on", "paid at"],
    hint: "Leave blank if paid the same day. Write \"unpaid\" if it is still owed.",
  },
  { field: "notes", label: "Notes", kind: "text", required: false, example: "", synonyms: ["notes", "note", "comment", "comments"] },
];

const REVENUE_ITEMS: ColumnDef[] = [
  { field: "name", label: "Name", kind: "text", required: true, example: "Logo design", synonyms: ["name", "item", "item name", "product", "product name", "service", "title"] },
  { field: "type", label: "Kind", kind: "enum", required: false, values: revenueItemTypes, example: "product", synonyms: ["kind", "type", "item type"], hint: "product, service, subscription, rental, commission, royalty, other" },
  { field: "pricingModel", label: "Pricing", kind: "enum", required: false, values: pricingModels, example: "fixed", synonyms: ["pricing", "pricing model", "price model"], hint: "fixed, per_unit, hourly, variable, tiered" },
  { field: "price", label: "Price", kind: "money", required: false, example: "250.00", synonyms: ["price", "unit price", "sell price", "rate", "amount"] },
  { field: "directCost", label: "Direct cost", kind: "money", required: false, example: "60.00", synonyms: ["direct cost", "cost", "unit cost", "cogs", "cost price"] },
  { field: "category", label: "Category", kind: "text", required: false, example: "Design", synonyms: ["category", "categories", "class"] },
  { field: "soldOn", label: "Sold on", kind: "list", required: false, example: "Manual", synonyms: ["sold on", "channels", "channel", "sources", "source", "stores"], hint: "Comma-separated channel names." },
  { field: "unitLabel", label: "Unit", kind: "text", required: false, example: "job", synonyms: ["unit", "unit label", "units", "measure"] },
  { field: "notes", label: "Notes", kind: "text", required: false, example: "", synonyms: ["notes", "note", "description", "comment"] },
];

const EXPENSE_ITEMS: ColumnDef[] = [
  { field: "name", label: "Name", kind: "text", required: true, example: "Office rent", synonyms: ["name", "item", "item name", "expense", "expense name", "title"] },
  { field: "type", label: "Purpose", kind: "enum", required: false, values: expensePurposes, example: "operational", synonyms: ["purpose", "type", "expense type"], hint: "marketing, operational, maintenance, payroll, cogs, custom" },
  { field: "costNature", label: "Cost nature", kind: "enum", required: false, values: costNatures, example: "fixed", synonyms: ["cost nature", "nature", "behaviour type", "fixed or variable"], hint: "fixed, variable, semi_variable" },
  { field: "behavior", label: "How often", kind: "enum", required: false, values: expenseBehaviors, example: "one_time", synonyms: ["how often", "behavior", "behaviour", "frequency", "recurrence"], hint: "one_time, recurring, usage_based" },
  { field: "defaultAmount", label: "Typical amount", kind: "money", required: false, example: "1200.00", synonyms: ["typical amount", "amount", "default amount", "cost", "monthly amount"] },
  { field: "unitLabel", label: "Unit", kind: "text", required: false, example: "", synonyms: ["unit", "unit label", "units", "measure"] },
  { field: "category", label: "Category", kind: "text", required: false, example: "Premises", synonyms: ["category", "categories", "class"] },
  { field: "vendorName", label: "Supplier", kind: "text", required: false, example: "", synonyms: ["supplier", "vendor", "vendor name", "supplier name", "paid to"] },
  { field: "notes", label: "Notes", kind: "text", required: false, example: "", synonyms: ["notes", "note", "description", "comment"] },
];

const PEOPLE: ColumnDef[] = [
  { field: "name", label: "Name", kind: "text", required: false, example: "Acme Ltd", synonyms: ["name", "full name", "customer", "customer name", "client", "company", "contact"] },
  { field: "email", label: "Email", kind: "text", required: false, example: "hello@acme.com", synonyms: ["email", "e mail", "email address", "contact email"] },
  { field: "kind", label: "Kind", kind: "enum", required: false, values: personKinds, example: "customer", synonyms: ["kind", "type", "role"], hint: "customer, vendor, employee, other" },
];

const BY_KIND: Record<ImportKind, ColumnDef[]> = {
  transactions: TRANSACTIONS,
  revenue_items: REVENUE_ITEMS,
  expense_items: EXPENSE_ITEMS,
  people: PEOPLE,
};

export function columnsFor(kind: ImportKind): readonly ColumnDef[] {
  return BY_KIND[kind];
}

/**
 * Is this field pointed at a real column?
 *
 * A dropdown left on "not in my file" sends an empty header rather than
 * dropping the key, so an empty string is no column at all — not a column
 * named "".
 */
export function isMapped(mapping: Record<string, string>, field: string): boolean {
  return (mapping[field] ?? "").trim() !== "";
}

/**
 * The columns this mapping does not use — named, never quietly dropped.
 *
 * Claimed BY POSITION, like `guessMapping`: a file with two columns both called
 * "Amount" gives the first to Amount and reports the second as ignored. Claiming
 * by name would silently swallow both.
 *
 * It lives here, in the domain, for the same reason `mappingProblem` does: the
 * MATCHING SCREEN prints this list under the dropdowns ("Not used: Balance, Sort
 * Code"), and the preview response carries the server's copy of it. A column
 * that disappears without explanation is how somebody wonders where their data
 * went, so the two sides must name the same columns — which one function
 * guarantees and two would not. The screen can also answer it the instant a
 * dropdown moves, instead of showing last request's answer for 300 ms.
 */
export function ignoredHeadersFor(headers: string[], mapping: Record<string, string>): string[] {
  const claimed = headers.map(() => false);
  for (const header of Object.values(mapping)) {
    if (!header.trim()) continue;
    const index = headers.findIndex((candidate, position) => !claimed[position] && candidate === header);
    if (index !== -1) claimed[index] = true;
  }
  return headers.filter((_header, position) => !claimed[position]);
}

/**
 * Every cell of the column a field was mapped to, trimmed.
 *
 * A header that is not in the file reads as no cells at all rather than
 * throwing: a mapping saved against last month's export can name a column this
 * month's file does not have, and that is a thing to notice (see
 * `headerIsPresent`), not a thing to crash on.
 *
 * Here rather than in the server because the matching screen reads one date cell
 * out of this to quote back at the owner — "so 03/04/2026 is 3 April 2026" is
 * only worth anything if it is a date from THEIR file, in the column the server
 * is actually reading.
 */
export function cellsOf(
  table: { headers: string[]; rows: string[][] },
  header: string | undefined,
): string[] {
  const index = header === undefined ? -1 : table.headers.indexOf(header);
  if (index === -1) return [];
  return table.rows.map((cells) => (cells[index] ?? "").trim());
}

/**
 * Why this mapping cannot read the file, in one sentence — or `null` when it
 * can.
 *
 * Asked BEFORE a row is parsed, and it is the difference between one sentence
 * and three hundred identical row failures. No `required` flag can express "one
 * of these", so a file mapped with only a Date column would otherwise fail every
 * row with "This row has no amount" and never say what the owner has to fix. Two
 * kinds need that shape — a transaction's amount, and a person's name-or-email —
 * and each gets its own clause below.
 *
 * It lives in the domain, and returns the sentence rather than throwing it, for
 * two readers rather than one. The server wraps it in `invalid()`
 * (`assertMappingIsUsable`) and refuses the request. The UPLOAD SCREEN asks it
 * of the guess it can compute locally, so it can tell "we could not guess your
 * columns — here they are, match them yourself" apart from every other reason a
 * preview can be refused, and send the owner to the matching step instead of a
 * dead end. Both need the identical sentence for that to be reliable, which is
 * what one function returning it guarantees and two copies would not.
 */
export function mappingProblem(kind: ImportKind, mapping: Record<string, string>): string | null {
  for (const column of columnsFor(kind)) {
    if (column.required && !isMapped(mapping, column.field)) {
      return `Tell us which column holds the ${column.label.toLowerCase()}.`;
    }
  }
  if (kind === "transactions" && !["amount", "moneyIn", "moneyOut"].some((field) => isMapped(mapping, field))) {
    return "Tell us which column holds the amount.";
  }
  // A contact is identified by a name OR an email, so neither column can carry
  // `required` on its own — and without this, a file that is plainly not a
  // contacts list (an orders export, say) matches nothing, and every one of its
  // rows comes back with "A person needs a name or an email".
  if (kind === "people" && !["name", "email"].some((field) => isMapped(mapping, field))) {
    return "Tell us which column holds the name or the email.";
  }
  return null;
}

/*
 * `TRANSACTION_HEADER_FIELDS` used to sit here, listing the seven order-level
 * fields and claiming grouping resolved them off it. Nothing ever read it, and
 * `importGroup.ts` names its fields inline — so the comment was a description of
 * code that did not exist.
 *
 * Deleted rather than made true, because making it true is not the one-line
 * change it looks like. `groupRows` agrees on SIX of those seven (orderId is the
 * grouping key, not a field to agree on); it reads them off `ParsedTxnRow`,
 * whose property names are a different vocabulary from the mapping field names
 * here (`date` → `occurredOn`, `channel` → `channelName`); `paidOn` needs a
 * conversion the others do not; each needs its own human label for the refusal
 * ("the date", "the channel"); and they land in a typed object literal that a
 * loop cannot build without losing the typing that keeps it honest. A list here
 * would have to carry an accessor and a label per entry and would still not
 * remove a line from `importGroup.ts`.
 *
 * `TRANSACTION_TOTAL_FIELDS` below earns its keep on the other side of exactly
 * that test: three genuinely uniform money fields, governed by one toggle, with
 * three readers.
 */

/** Header fields carrying money, which the whole-order/per-item toggle governs. */
export const TRANSACTION_TOTAL_FIELDS = ["taxCollected", "shippingCharged", "discount"] as const;
