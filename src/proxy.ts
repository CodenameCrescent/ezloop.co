import type { NextRequest } from "next/server";
import { gatePage } from "@/lib/api/functions/http/pageGate";

/** Signed-in-only pages. The rules and their limits are in `pageGate.ts`. */
export function proxy(request: NextRequest) {
  return gatePage(request);
}

export const config = {
  // Pages only: not the API (it answers 401 itself), Next's own files, or any
  // path ending in a file extension (images, fonts, robots.txt, the manifest).
  matcher: ["/((?!api(?:/|$)|_next/|favicon\\.ico$|.*\\.[A-Za-z0-9]+$).*)"],
};
