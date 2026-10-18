import { describe, expect, it } from "vitest";
import { translateMessage } from "./messages";

describe("translateMessage", () => {
  it("returns the source unchanged in English", () => {
    expect(translateMessage("Arrange", "en")).toBe("Arrange");
    expect(translateMessage("3 recipes", "en")).toBe("3 recipes");
  });

  it("answers an exact dictionary entry", () => {
    expect(translateMessage("Arrange", "zh-CN")).toBe("自动整理");
    expect(translateMessage("Close", "zh-CN")).toBe("关闭");
    expect(translateMessage("Search item or fluid...", "zh-CN")).toBe("搜索物品或流体…");
  });

  it("falls back to the English source when nothing matches", () => {
    const unknown = "A string the dictionary has never seen";
    expect(translateMessage(unknown, "zh-CN")).toBe(unknown);
  });

  it("returns the empty string as it is", () => {
    expect(translateMessage("", "zh-CN")).toBe("");
  });

  it("translates a runtime count through the dynamic rules", () => {
    expect(translateMessage("3 recipes", "zh-CN")).toBe("3 个配方");
    expect(translateMessage("12 machines", "zh-CN")).toBe("12 台机器");
    expect(translateMessage("1 item", "zh-CN")).toBe("1 个物品");
  });

  it("matches a dynamic rule case-insensitively where it is flagged so", () => {
    expect(translateMessage("4 Items", "zh-CN")).toBe("4 个物品");
  });

  it("fills several capture groups", () => {
    expect(translateMessage("Page 2 of 5", "zh-CN")).toBe("第 2 / 5 页");
    expect(translateMessage("3 of 10 completed", "zh-CN")).toBe("3 / 10 已完成");
  });

  it("leaves an almost-match alone rather than half-substituting it", () => {
    expect(translateMessage("3 recipes and more", "zh-CN")).toBe("3 recipes and more");
  });

  it("is deterministic across repeated calls", () => {
    expect(translateMessage("Page 2 of 5", "zh-CN")).toBe(translateMessage("Page 2 of 5", "zh-CN"));
  });

  it("loads the planner and secondary catalogs and normalizes JSX whitespace", () => {
    expect(translateMessage("Machine settings", "zh-CN")).toBe("机器设置");
    expect(translateMessage("  Machine\n  settings  ", "zh-CN")).toBe("  机器设置  ");
    expect(translateMessage("Search...", "zh-CN")).toBe("搜索…");
  });
});
