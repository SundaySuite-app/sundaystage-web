import { describe, expect, it } from "vitest";
import {
  generatePin,
  generateResumeCode,
  generateUnique,
  isValidPin,
  normalizeResumeCode,
} from "@/lib/codes";

function seqRng(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("generatePin", () => {
  it("produces 6 digits", () => {
    for (let i = 0; i < 50; i++) {
      expect(generatePin()).toMatch(/^\d{6}$/);
    }
  });
  it("is deterministic under an injected RNG", () => {
    expect(generatePin(seqRng([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]))).toBe("123456");
  });
});

describe("generateResumeCode", () => {
  it("matches XXXX-YY without ambiguous characters", () => {
    for (let i = 0; i < 100; i++) {
      const code = generateResumeCode();
      expect(code).toMatch(/^[A-HJ-NP-Z]{4}-[A-HJ-NP-Z2-9]{2}$/);
      expect(code).not.toMatch(/[IO01]/);
    }
  });
});

describe("normalizeResumeCode", () => {
  it("uppercases and reinserts the dash", () => {
    expect(normalizeResumeCode("kole7f")).toBe("KOLE-7F");
    expect(normalizeResumeCode(" kole-7f ")).toBe("KOLE-7F");
    expect(normalizeResumeCode("KOLE-7F")).toBe("KOLE-7F");
  });
});

describe("isValidPin", () => {
  it("accepts exactly 6 digits", () => {
    expect(isValidPin("123456")).toBe(true);
    expect(isValidPin(" 123456 ")).toBe(true);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("12345a")).toBe(false);
  });
});

describe("generateUnique", () => {
  it("retries past taken codes", () => {
    const taken = new Set(["AAAA-AA"]);
    let calls = 0;
    const gen = () => (calls++ === 0 ? "AAAA-AA" : "BBBB-BB");
    expect(generateUnique(gen, taken)).toBe("BBBB-BB");
  });
  it("throws when exhausted", () => {
    expect(() =>
      generateUnique(() => "AAAA-AA", new Set(["AAAA-AA"]), Math.random, 3),
    ).toThrow();
  });
});
