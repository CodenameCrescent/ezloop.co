import { z } from "zod";
import { defineEndpoint } from "./shared";

export const clientCustomerType = z.enum(["customer", "client", "both"]);
export type ClientCustomerType = z.infer<typeof clientCustomerType>;

export const clientCustomer = z.object({
  id: z.string(),
  type: clientCustomerType,
  name: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  companyName: z.string().nullable(),
  notes: z.string().nullable(),
  legacyCustomerKey: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ClientCustomer = z.infer<typeof clientCustomer>;

export const listClientCustomers = defineEndpoint({
  method: "GET",
  path: "/client-customers",
  response: z.array(clientCustomer),
});

export const clientCustomerInput = z.object({
  name: z.string().min(1).max(255),
  type: clientCustomerType.optional(),
  phone: z.string().max(50).nullish(),
  email: z.string().max(255).nullish(),
  companyName: z.string().max(255).nullish(),
  notes: z.string().max(2000).nullish(),
  legacyCustomerKey: z.string().max(255).nullish(),
});

export const createClientCustomer = defineEndpoint({
  method: "POST",
  path: "/client-customers",
  body: clientCustomerInput,
  response: clientCustomer,
});

export const updateClientCustomer = defineEndpoint({
  method: "PATCH",
  path: "/client-customers/:id",
  params: z.object({ id: z.string() }),
  body: clientCustomerInput.partial(),
  response: clientCustomer,
});

export const deleteClientCustomer = defineEndpoint({
  method: "DELETE",
  path: "/client-customers/:id",
  params: z.object({ id: z.string() }),
  response: z.object({ ok: z.boolean() }),
});
