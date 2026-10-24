import { create } from "zustand";

/**
 * The buffer whose spill is under the pointer: its Forced tile, or a maker's row that spills into it. Every Forced tile
 * of that spill (the buffer's and each maker's) lights, and nothing else. Its own store, outside the board's: a hover
 * re-renders only the tiles whose answer changes, never a card.
 */
export const useSpillHover = create<{ drawerId?: string }>(() => ({}));

export function setSpillHover(drawerId: string | undefined): void {
  if (useSpillHover.getState().drawerId !== drawerId) useSpillHover.setState({ drawerId });
}
