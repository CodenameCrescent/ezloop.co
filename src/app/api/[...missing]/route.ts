/**
 * Any /api URL no route file answers.
 *
 * Without this, an unknown API path fell through to the app's page-level
 * catch-all and came back as 200 with an HTML "page not found" — which a fetch
 * reads as success. Every real route is more specific than this one, so Next
 * always prefers it.
 */
function notFound(): Response {
  return Response.json({ error: { code: "not_found", message: "No such endpoint" } }, { status: 404 });
}

export const GET = notFound;
export const POST = notFound;
export const PUT = notFound;
export const PATCH = notFound;
export const DELETE = notFound;
