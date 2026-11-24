import crypto from "node:crypto";
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";
const LENGTH = 12;

/**
 * `<prefix>_` + 12 lowercase base-36 characters — the same shape ids have
 * always had, so every stored id, the business-id header check
 * (`^[a-zA-Z0-9_-]{1,64}$`) and anything that displays them are unchanged.
 *
 * All 12 characters now come from the OS's cryptographic generator (about 62
 * bits). They used to be 8 from `Math.random()` — whose state can be
 * recovered from outputs an attacker sees in their own ids — plus 4 from the
 * clock, which made other businesses' ids guessable. `randomInt` is unbiased.
 */
export function uid(prefix: string): string {
  let id = "";
  for (let i = 0; i < LENGTH; i++) id += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return `${prefix}_${id}`;
}
