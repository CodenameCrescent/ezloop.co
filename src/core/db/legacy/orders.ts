import {
  pgTable,
  text,
  doublePrecision,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const orderStatusValues = ["completed", "pending", "cancelled", "refunded"] as const;
export const paymentStatusValues = ["paid", "unpaid", "partially_paid"] as const;

export const ordersTable = pgTable(
  "orders",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    customer: text("customer"),
    phone: text("phone"),
    source: text("source"),
    platform: text("platform"),
    paymentStatus: text("payment_status").notNull().default("paid"),
    refundAmount: doublePrecision("refund_amount").notNull().default(0),
    taxAmount: doublePrecision("tax_amount").notNull().default(0),
    shippingCharged: doublePrecision("shipping_charged").notNull().default(0),
    deliveryCost: doublePrecision("delivery_cost").notNull().default(0),
    adCost: doublePrecision("ad_cost").notNull().default(0),
    discount: doublePrecision("discount").notNull().default(0),
    date: timestamp("date", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("completed"),
    externalId: text("external_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("orders_user_idx").on(t.userId),
    userDateIdx: index("orders_user_date_idx").on(t.userId, t.date),
    userExternalIdx: uniqueIndex("orders_user_external_idx").on(t.userId, t.externalId),
  }),
);

export const orderItemsTable = pgTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => ordersTable.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    productName: text("product_name").notNull(),
    quantity: integer("quantity").notNull().default(1),
    unitSellingPrice: doublePrecision("unit_selling_price").notNull().default(0),
    unitCostPrice: doublePrecision("unit_cost_price").notNull().default(0),
    position: integer("position").notNull().default(0),
  },
  (t) => ({
    orderIdx: index("order_items_order_idx").on(t.orderId),
    productIdx: index("order_items_product_idx").on(t.productId),
  }),
);

export const ordersRelations = relations(ordersTable, ({ many }) => ({
  items: many(orderItemsTable),
}));

export const orderItemsRelations = relations(orderItemsTable, ({ one }) => ({
  order: one(ordersTable, {
    fields: [orderItemsTable.orderId],
    references: [ordersTable.id],
  }),
}));

export const insertOrderSchema = createInsertSchema(ordersTable).omit({
  id: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;

export const insertOrderItemSchema = createInsertSchema(orderItemsTable).omit({
  id: true,
  orderId: true,
});
export type InsertOrderItem = z.infer<typeof insertOrderItemSchema>;
export type OrderItem = typeof orderItemsTable.$inferSelect;
