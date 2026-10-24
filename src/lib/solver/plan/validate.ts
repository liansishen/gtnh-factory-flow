/**
 * Numeric constants and the independent conservation check (spec-solver 3.0, 3.3.2). `validate` reads nothing from
 * the LP: it recomputes every port's balance from the point, so a solver that returns garbage is caught.
 */
import type { ModelData } from "./model";

export const NUMERICS = {
  /** Relative: what a variable holds when the solver meant zero. */
  dust: 1e-11,
  /** Relative threshold for gate support. */
  zero: 1e-6,
  /** Conservation and drawer tolerance. */
  validateTol: 1e-6,
  /** Tie tolerance in overshoot notes and alternatives. */
  tieRel: 1e-6,
  /** Slack on quantity and flow caps. */
  qtyEps: 1e-7,
  /** The canonical tie-break weighs the plan's edge this much above internal flow. */
  edgeFirst: 1e6,
  /** A level that reached at most this (times the plan's scale) is closed. */
  heldAtRounding: 1e-9,
  /**
   * The push (docs/up-to.md), in levels (a pool's machine time over its capacity, 0..1): how far past a round's level
   * a pool must reach to count as rising, and the room under stage A's sum.
   */
  pushTol: 1e-8,
  /** A pool's level is held from the level itself to this far above it (wider than `pushTol`). */
  bandAbove: 1e-7,
  /** The Up to read-out, in levels: what a probe must add to count as raising a pool or using more. */
  readoutTol: 1e-6,
} as const;

/** `Double.MIN_NORMAL`: the floor that keeps a scale divisible. */
export const MIN_NORMAL = 2.2250738585072014e-308;

/** The largest magnitude in a vector, never zero. */
export function scaleOf(values: ArrayLike<number>): number {
  let max = 0;
  for (let i = 0; i < values.length; i++) max = Math.max(max, Math.abs(values[i]!));
  return Math.max(max, MIN_NORMAL);
}

/** The largest rate the solution moves anywhere, terminals included. */
export function solutionScale(
  model: ModelData,
  extents: ArrayLike<number>,
  flows: ArrayLike<number>,
  externals: ArrayLike<number>,
): number {
  let max = Math.max(scaleOf(flows), scaleOf(externals));
  for (let m = 0; m < model.machines.length; m++) {
    const md = model.machines[m]!;
    for (const q of md.inQty) max = Math.max(max, extents[m]! * q);
    for (const q of md.outQty) max = Math.max(max, extents[m]! * q);
  }
  return Math.max(max, MIN_NORMAL);
}

/**
 * What dust is measured against, per connected port, per edge and per machine: the largest rate on the network a port
 * sits on (its ports' extents times quantities, its edges' flows, its externals). The solver's error follows the rows
 * a value sits in, so one network's rates say nothing of another's noise: judged over the whole point, a reactor's
 * billions of EU a second made a real 0.03/s item flow read as dust. A machine takes its smallest network, so it reads
 * as dust only where every network it touches would; one with no connected port takes the whole point's scale. Pass null for parts the caller does not hold (externals alone).
 */
export interface DustScales {
  ports: number[];
  edges: number[];
  machines: number[];
}

export function dustScales(
  model: ModelData,
  extents: ArrayLike<number> | null,
  flows: ArrayLike<number> | null,
  externals: ArrayLike<number>,
): DustScales {
  const network = new Map<number, number>();
  model.connectedPorts.forEach((port, p) => {
    let most = Math.abs(externals[p]!);
    if (extents) most = Math.max(most, Math.abs(extents[port.machine]! * port.qtyPerCraft));
    if (flows) for (const e of port.edges) most = Math.max(most, Math.abs(flows[e]!));
    const c = model.portComponent[p]!;
    network.set(c, Math.max(network.get(c) ?? 0, most));
  });
  const ports = model.connectedPorts.map((_, p) =>
    Math.max(network.get(model.portComponent[p]!)!, MIN_NORMAL),
  );
  const whole =
    extents && flows ? solutionScale(model, extents, flows, externals) : scaleOf(externals);
  const machines = new Array<number>(model.machines.length).fill(Infinity);
  model.connectedPorts.forEach((port, p) => {
    machines[port.machine] = Math.min(machines[port.machine]!, ports[p]!);
  });
  for (let m = 0; m < machines.length; m++) if (machines[m] === Infinity) machines[m] = whole;
  return { ports, edges: model.edges.map((edge) => ports[edge.srcPort]!), machines };
}

/**
 * Null when the point conserves, else the offending row as text. A negative counts once it is past dust of the point's
 * scale, or of 1 when the point is smaller (as the conservation rows below): a point that is all but zero (every Up to
 * card idle, solved by an engine without exact vertices) is all noise, and its noise is no negative.
 */
export function validatePoint(
  model: ModelData,
  extents: ArrayLike<number>,
  flows: ArrayLike<number>,
  externals: ArrayLike<number>,
): string | null {
  const floor = -NUMERICS.dust * Math.max(1, solutionScale(model, extents, flows, externals));
  for (let i = 0; i < extents.length; i++)
    if (!(extents[i]! >= floor)) return `negative extent ${extents[i]}`;
  for (let i = 0; i < flows.length; i++)
    if (!(flows[i]! >= floor)) return `negative edge flow ${flows[i]}`;
  for (let i = 0; i < externals.length; i++)
    if (!(externals[i]! >= floor)) return `negative external ${externals[i]}`;
  for (let p = 0; p < model.connectedPorts.length; p++) {
    const port = model.connectedPorts[p]!;
    let flowsSum = 0;
    for (const e of port.edges) flowsSum += flows[e]!;
    const through = extents[port.machine]! * port.qtyPerCraft;
    const residual = flowsSum + externals[p]! - through;
    const scale = Math.max(1, Math.max(port.qtyPerCraft, Math.abs(through)));
    if (!(Math.abs(residual) / scale <= NUMERICS.validateTol)) {
      return `port ${port.input ? "in" : "out"}[${port.portIndex}] of '${model.machines[port.machine]!.spec.name}' residual ${residual}`;
    }
  }
  return null;
}
