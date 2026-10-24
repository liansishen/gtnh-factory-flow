import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROW_TYPE, measureClean, measureRowFigure, measureRowName } from "./text-measure";

function rule(css: string, selector: string): Record<string, string> {
  const plain = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`).exec(plain);
  expect(match, selector).not.toBeNull();
  const out: Record<string, string> = {};
  for (const line of match![1]!.split(";")) {
    const [name, value] = line.split(":").map((part) => part.trim());
    if (name && value) out[name] = value;
  }
  return out;
}

const px = (value: string | undefined) => Number.parseFloat(value ?? "NaN");

describe("a port row's fit check", () => {
  // The check measures the words as the stylesheets draw them, so a word it lets stand runs past no box in any face.
  it.each([
    ["clean.css", ".cc-num", ".cc-pname"],
    ["drawer/drawer.css", ".cd-num", ".cd-name"],
  ])("measures %s as it draws its rows", (file, figure, name) => {
    const css = readFileSync(path.resolve(__dirname, file), "utf8");
    const type = (selector: string) => {
      const body = rule(css, selector);
      return { size: px(body["font-size"]), spacing: px(body["letter-spacing"]) };
    };
    expect(type(figure)).toEqual(ROW_TYPE.figure);
    const unit = rule(css, `${figure}::after`);
    expect({ ...type(`${figure}::after`), gap: px(unit["margin-left"]) }).toEqual(ROW_TYPE.unit);
    expect(type(name)).toEqual(ROW_TYPE.name);
    expect(type(`${name}[data-small]`)).toEqual(ROW_TYPE.smallName);
  });

  it("counts the letter spacing after every character and the unit's gap", () => {
    expect(measureRowName("Copper Dust", false)).toBeCloseTo(measureClean("Copper Dust", 9) - 0.6 * 11);
    expect(measureRowName("Copper Dust", true)).toBeCloseTo(measureClean("Copper Dust", 7) - 0.45 * 11);
    expect(measureRowFigure("0.045", "/s")).toBeCloseTo(
      measureClean("0.045", 14) - 0.8 * 5 + 1 + measureClean("/s", 9) - 0.6 * 2,
    );
    expect(measureRowFigure("12", "")).toBeCloseTo(measureClean("12", 14) - 0.8 * 2 + 1);
  });
});
