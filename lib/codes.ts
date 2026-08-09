// Code generation for join PINs. Pure + injectable RNG so it is deterministic
// under test. (The scaffold also carried "resume code" helpers — XXXX-YY host
// codes — for a resume flow that was never built; removed as dead code.)

type Rng = () => number; // returns [0,1)

/** 6-digit room PIN, e.g. "402815". Leading digits allowed. */
export function generatePin(rng: Rng = Math.random): string {
  let pin = "";
  for (let i = 0; i < 6; i++) pin += Math.floor(rng() * 10).toString();
  return pin;
}

const PIN_RE = /^\d{6}$/;
export function isValidPin(input: string): boolean {
  return PIN_RE.test(input.trim());
}

/** Generate a code guaranteed unique against an existing set (retry on clash). */
export function generateUnique(
  gen: (rng: Rng) => string,
  taken: ReadonlySet<string>,
  rng: Rng = Math.random,
  maxTries = 50,
): string {
  for (let i = 0; i < maxTries; i++) {
    const code = gen(rng);
    if (!taken.has(code)) return code;
  }
  throw new Error("Could not generate a unique code");
}
