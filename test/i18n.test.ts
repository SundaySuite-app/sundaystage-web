import { describe, expect, it } from "vitest";
import { CATALOGS, LOCALES, t } from "@/lib/locale/i18n";

describe("locale catalogs", () => {
  const noKeys = Object.keys(CATALOGS.no).sort();
  for (const locale of LOCALES) {
    it(`${locale} mirrors no key-for-key`, () => {
      expect(Object.keys(CATALOGS[locale]).sort()).toEqual(noKeys);
    });
  }

  it("placeholders are identical across locales", () => {
    for (const key of noKeys) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
      const want = ph(CATALOGS.no[key]);
      for (const locale of LOCALES) {
        expect(ph(CATALOGS[locale][key]), `${locale}:${key}`).toBe(want);
      }
    }
  });

  it("t interpolates and falls back", () => {
    expect(t("op.displays", { n: 3 }, "en")).toBe("3 displays");
    expect(t("finnes.ikke", undefined, "de")).toBe("finnes.ikke");
  });
});
