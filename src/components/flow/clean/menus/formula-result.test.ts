import { describe, expect, it } from "vitest";
import { translateMessage } from "@/lib/i18n/messages";
import { localizeFormulaResult } from "./formula-result";

const zh = (source: string) => translateMessage(source, "zh-CN");
const en = (source: string) => translateMessage(source, "en");

describe("localizeFormulaResult", () => {
  it("rewrites the word fragments in Chinese, leaving numbers and units alone", () => {
    expect(localizeFormulaResult("2140 K over", zh)).toBe("2140 K 超出");
    expect(localizeFormulaResult("95% power", zh)).toBe("95% 功率");
    expect(localizeFormulaResult("3 (1 perfect)", zh)).toBe("3 (1 完美)");
    expect(localizeFormulaResult("none", zh)).toBe("无");
    expect(localizeFormulaResult("2,048 EU/t", zh)).toBe("2,048 EU/t");
    expect(localizeFormulaResult("0.4/s", zh)).toBe("0.4/s");
  });

  it("returns the source read-out unchanged in English", () => {
    for (const result of ["2140 K over", "95% power", "3 (1 perfect)", "none", "2,048 EU/t", "50 t"]) {
      expect(localizeFormulaResult(result, en)).toBe(result);
    }
  });
});
