import { describe, expect, it } from "vitest";
import {
  isApple,
  isChromium,
  isIOSLike,
  supportsWindowPlacement,
} from "@/lib/client/storskjerm/detect";

const UA = {
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  ipadDesktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.0.0 Mobile/15E148 Safari/604.1",
  winChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  winEdge:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
  chromebook:
    "Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  firefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
};

describe("detect", () => {
  it.each([
    ["macSafari", UA.macSafari, 0, { apple: true, ios: false, chromium: false }],
    ["macChrome", UA.macChrome, 0, { apple: true, ios: false, chromium: true }],
    ["ipadOS desktop UA + touch", UA.ipadDesktop, 5, { apple: true, ios: true, chromium: false }],
    ["iphone Safari", UA.iphoneSafari, 5, { apple: true, ios: true, chromium: false }],
    ["iOS Chrome (CriOS)", UA.iosChrome, 5, { apple: true, ios: true, chromium: false }],
    ["Windows Chrome", UA.winChrome, 0, { apple: false, ios: false, chromium: true }],
    ["Edge", UA.winEdge, 0, { apple: false, ios: false, chromium: true }],
    ["Chromebook", UA.chromebook, 0, { apple: false, ios: false, chromium: true }],
    ["Firefox", UA.firefox, 0, { apple: false, ios: false, chromium: false }],
  ])("%s", (_n, ua, maxTouchPoints, want) => {
    const h = { maxTouchPoints };
    expect({
      apple: isApple(ua, h),
      ios: isIOSLike(ua, h),
      chromium: isChromium(ua, h),
    }).toEqual(want);
  });

  it("Mac uten berøring er ikke iPad", () => {
    expect(isIOSLike(UA.macSafari, { maxTouchPoints: 0 })).toBe(false);
    expect(isIOSLike(UA.macSafari)).toBe(false);
  });

  it("supportsWindowPlacement ser etter getScreenDetails", () => {
    expect(supportsWindowPlacement({ getScreenDetails: () => {} })).toBe(true);
    expect(supportsWindowPlacement({})).toBe(false);
    expect(supportsWindowPlacement(undefined)).toBe(false);
  });
});
