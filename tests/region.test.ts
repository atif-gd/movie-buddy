import { expect, test } from "vitest";
import { regionFromAcceptLanguage } from "@/lib/region";

test.each([
  ["en-GB,en;q=0.9", "GB"],
  ["de", "US"],
  [null, "US"],
  ["pt-br", "BR"],
  ["zh-Hant-TW,zh;q=0.8", "TW"],
])("%s → %s", (header, region) => {
  expect(regionFromAcceptLanguage(header)).toBe(region);
});
