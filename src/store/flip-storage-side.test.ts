import { afterEach, describe, expect, it } from "vitest";
import { getStorageRoles } from "@/lib/model/storage-role";
import { drawer, node, project, recipe, wire } from "@/lib/solver/plan/adapter/test-kit";
import { useFactoryStore } from "./factory-store";

const initial = useFactoryStore.getState();
afterEach(() => useFactoryStore.setState(initial, true));

/** A maker feeding an output drawer, a source feeding a user, and a buffer between the two. */
function board() {
  return project({
    recipes: [recipe("a", [["x", 1]], [["y", 1]]), recipe("b", [["y", 1]], [])],
    nodes: [node("m", "a"), node("u", "b")],
    storages: [
      drawer("in", "x", { targetPerSecond: -2, targetMode: "exact" }),
      drawer("out", "y", { targetPerSecond: 3, targetMode: "at-least", drainMode: "byproduct" }),
      drawer("mid", "y"),
    ],
    edges: [
      wire("in-m", "in", "m", "x", {}, { fromDrawer: true }),
      wire("m-out", "m", "out", "y", {}, { toDrawer: true }),
      wire("m-mid", "m", "mid", "y", {}, { toDrawer: true }),
      wire("mid-u", "mid", "u", "y", {}, { fromDrawer: true }),
    ],
  });
}

describe("flipping a drawer between input and output", () => {
  it("makes an output drawer an input one: its wires come off, its rate and drain mode go, it stays on the board", () => {
    useFactoryStore.setState({ project: board() });
    useFactoryStore.getState().flipStorageSide("out");
    const { project: next } = useFactoryStore.getState();
    expect(next.edges.map((edge) => edge.id).sort()).toEqual(["in-m", "m-mid", "mid-u"]);
    const out = next.storages!.find((entry) => entry.id === "out")!;
    expect([out.targetPerSecond, out.targetMode, out.drainMode, out.poolSide]).toEqual([
      undefined,
      undefined,
      undefined,
      "source",
    ]);
    expect(getStorageRoles(next).get("out")).toBe("source");
  });

  it("makes an input drawer an output one, and back", () => {
    useFactoryStore.setState({ project: board() });
    useFactoryStore.getState().flipStorageSide("in");
    let next = useFactoryStore.getState().project;
    expect(next.edges.some((edge) => edge.source === "in")).toBe(false);
    expect(getStorageRoles(next).get("in")).toBe("product");
    useFactoryStore.getState().flipStorageSide("in");
    next = useFactoryStore.getState().project;
    expect(getStorageRoles(next).get("in")).toBe("source");
  });

  it("leaves a buffer alone", () => {
    useFactoryStore.setState({ project: board() });
    const before = useFactoryStore.getState().project;
    useFactoryStore.getState().flipStorageSide("mid");
    expect(useFactoryStore.getState().project).toBe(before);
  });
});
