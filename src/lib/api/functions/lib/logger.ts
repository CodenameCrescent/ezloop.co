import pino from "pino";

/**
 * Plain JSON to stdout. The Express build piped this through `pino-pretty`
 * in development, but a pino transport runs in a worker thread that Next's
 * server bundle cannot resolve, so the pretty printer is left to the terminal:
 * `npm run dev | npx pino-pretty` if you want it.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
});
