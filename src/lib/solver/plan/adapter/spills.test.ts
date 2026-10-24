import { describe, expect, it } from "vitest";
import { calculateThroughput } from "../../throughput";
import { drawer, node, project, recipe, wire } from "./test-kit";

/**
 * A maker that makes more than a buffer's users take (docs/up-to.md, "Buffers"): the extra is the maker's, read out
 * at its port (`PlanSolveExtras.spills`, which the card draws as its forced row) and totalled on the buffer, which
 * itself still passes only what its users take.
 */
describe("spills into a buffer reach the board at the maker's port", () => {
  const plan = () =>
    project({
      recipes: [recipe("a", [["x", 1]], [["y", 1]]), recipe("b", [["y", 1]], [["z", 1]])],
      nodes: [node("m", "a", { solvePin: 2 }), node("t", "b", { solvePin: 1 })],
      storages: [drawer("xs", "x"), drawer("buf", "y"), drawer("zs", "z")],
      edges: [
        wire("xm", "xs", "m", "x", {}, { fromDrawer: true }),
        wire("mb", "m", "buf", "y", {}, { toDrawer: true }),
        wire("bt", "buf", "t", "y", {}, { fromDrawer: true }),
        wire("tz", "t", "zs", "z", {}, { toDrawer: true }),
      ],
    });

  it("the maker runs full; its extra is its spill into the buffer, not a forced flow", () => {
    const result = calculateThroughput(plan(), { generatedAt: "t" });
    const extras = result.plan!;
    expect(extras.spills).toEqual([
      {
        nodeId: "m",
        portKey: expect.stringContaining("m|o|"),
        resourceKey: "item:y",
        perSecond: expect.closeTo(1, 6),
        drawerId: "buf",
      },
    ]);
    expect(extras.forced.filter((entry) => entry.nodeId === "m")).toEqual([]);
    expect(extras.upTo?.["m"]?.reached).toBeCloseTo(2, 6);
  });

  it("no spill when the users take it all", () => {
    const p = plan();
    p.nodes = p.nodes.map((entry) => (entry.id === "t" ? { ...entry, solvePin: 2 } : entry));
    expect(calculateThroughput(p, { generatedAt: "t" }).plan!.spills).toBeUndefined();
  });
});
