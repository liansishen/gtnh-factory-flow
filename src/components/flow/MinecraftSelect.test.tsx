// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MinecraftSelect } from "./MinecraftSelect";

// jsdom has no layout, so the component's "scroll the selected option into
// view" needs a no-op.
Element.prototype.scrollIntoView = () => {};
afterEach(cleanup);

const options = [
  { key: "plate", label: "Steel Plate" },
  { key: "ingot", label: "Steel Ingot" },
  { key: "log", label: "Oak Log" },
];

function openFilter() {
  render(
    <MinecraftSelect
      value="plate"
      options={options}
      onSelect={() => {}}
      searchable
      ariaLabel="Resource"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Resource" }));
  return screen.getByPlaceholderText("Filter...");
}

const shown = () => screen.getAllByRole("option").map((option) => option.textContent);

describe("MinecraftSelect's filter", () => {
  it("keeps English filtering as it was", () => {
    const input = openFilter();
    fireEvent.change(input, { target: { value: "log" } });
    expect(shown()).toEqual(["Oak Log"]);
  });

  it("finds a resource by its Chinese name", () => {
    const input = openFilter();
    fireEvent.change(input, { target: { value: "钢板" } });
    expect(shown()).toEqual(["Steel Plate"]);
  });

  it("finds every resource a Chinese fragment covers", () => {
    const input = openFilter();
    fireEvent.change(input, { target: { value: "钢" } });
    expect(shown()).toEqual(["Steel Plate", "Steel Ingot"]);
  });

  it("shows nothing, not everything, for an unknown Chinese word", () => {
    const input = openFilter();
    fireEvent.change(input, { target: { value: "不存在的词" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });
});
