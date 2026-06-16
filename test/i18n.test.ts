import { describe, expect, it } from "vitest";
import { CATALOGS, LOCALES, splitAccent, t } from "@/lib/locale/i18n";

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

describe("splitAccent", () => {
  it("splits a mid-string <em> accent into ordered segments", () => {
    expect(splitAccent("Show the songs <em>where people are</em>")).toEqual([
      { text: "Show the songs ", em: false },
      { text: "where people are", em: true },
    ]);
  });

  it("handles an <em> in the middle of the string", () => {
    expect(splitAccent("Zeig die Lieder, <em>wo die Menschen sind</em>")).toEqual([
      { text: "Zeig die Lieder, ", em: false },
      { text: "wo die Menschen sind", em: true },
    ]);
  });

  it("returns a single segment when there is no accent", () => {
    expect(splitAccent("plain title")).toEqual([{ text: "plain title", em: false }]);
  });

  it("reassembles every landing title without losing text", () => {
    for (const locale of LOCALES) {
      const title = CATALOGS[locale]["landing.title"];
      const joined = splitAccent(title)
        .map((s) => s.text)
        .join("");
      expect(joined).toBe(title.replace(/<\/?em>/g, ""));
    }
  });
});
