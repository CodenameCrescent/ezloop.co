import { z } from "zod";
import { defineEndpoint } from "./shared";

/**
 * Delete the signed-in person's account: every business, every record, and the
 * sign-in itself. There is no undo, so the body must carry the word the owner
 * typed — a stray request without it is refused before anything is touched.
 */
export const deleteAccount = defineEndpoint({
  method: "POST",
  path: "/account/delete",
  body: z.object({ confirm: z.literal("DELETE") }),
  response: z.object({ ok: z.literal(true) }),
});
