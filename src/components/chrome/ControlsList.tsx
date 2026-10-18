"use client";
import { I18nText, useT } from "@/lib/i18n/react";

import "./chrome.css";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useDeviceSettings } from "@/lib/device-settings";
import { useDropdownDismiss } from "@/lib/hooks/use-dropdown-dismiss";
import { getUiScale } from "@/lib/ui-scale";
import { CHROME_SCREEN_K } from "./ChromeMenu";

/** The wheel's row; with "Scroll changes values" off the wheel only zooms. */
const WHEEL_ROW = "Zoom; over a value, change it";

/** Every gesture on the board, in one list (the mod's "How the board works"). */
export const CONTROLS: ReadonlyArray<readonly [string, string]> = [
  ["R or U over an item", "Show its recipes or uses in the items list; + adds a recipe"],
  ["Drag an item out of the list", "Click the board to add a drawer for it"],
  ["Click an item in the list", "Its recipes (left-click) or uses (right-click)"],
  ["Click a port", "Its recipes (left) or uses (right); adding one wires it to the port"],
  ["Drag a port", "Drop on a card to wire it, or on empty board to add a drawer"],
  ["Right-click a wire", "Add a drawer on it, or delete it"],
  ["Middle-click a rate", "Clear the rate"],
  ["Right-click empty board", "Add a sticky note"],
  [
    "Click a sticky note",
    "Write on it (Esc or a click elsewhere when done); drag it anywhere to move it",
  ],
  ["Click a card or drawer", "Select it (Shift-click adds to the selection)"],
  ["Drag the board", "Pan (Shift-drag selects a box)"],
  ["Drag a selected card", "Move the selection"],
  ["Ctrl+A", "Select everything"],
  ["Delete", "Delete the selection (Esc deselects)"],
  ["Wheel", WHEEL_ROW],
  ["WASD or arrows", "Pan (+/- or Page Up/Down zoom)"],
  ["Ctrl+C, Ctrl+X, Ctrl+V", "Copy, cut, paste the selection and its wires"],
  ["Ctrl+Z, Ctrl+Shift+Z", "Undo, redo"],
  ["Double-click an overview row", "Show the cards that make or use it"],
];

/**
 * Gestures that ARE the key rather than a phrase: shown verbatim so the key
 * stays readable (the Ctrl/R/U and other key tokens in translated phrases too).
 */
const KEY_TOKEN_GESTURES = new Set([
  "Ctrl+A",
  "Ctrl+C, Ctrl+X, Ctrl+V",
  "Ctrl+Z, Ctrl+Shift+Z",
  "Delete",
]);

/** The controls list: a menu-skinned panel under the bar, closed like any dropdown. */
export function ControlsList({ onClose }: { onClose: () => void }) {
  const _i18nT = useT();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollChangesValues } = useDeviceSettings();
  useDropdownDismiss(true, { refs: [ref], onClose, insideSelector: "[data-menu-anchor]" });
  useEffect(() => ref.current?.focus(), []);
  // Hung from the Help key's right edge, as its menu is: the items column sits at the window's right edge now, and a
  // panel pinned to the window would slide under it.
  const scale = getUiScale() * CHROME_SCREEN_K;
  const helpKey =
    typeof document === "undefined" ? null : document.querySelector(".mb-key[data-mb='help']");
  const width = Math.min(420, (window.innerWidth - 16) / scale);
  const right = Math.max(8 / scale, Math.min(
    helpKey ? (window.innerWidth - helpKey.getBoundingClientRect().right) / scale : 8 / scale,
    (window.innerWidth - 8) / scale - width,
  ));
  const top = helpKey ? (helpKey.getBoundingClientRect().bottom + 4) / scale : 24;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={_i18nT("How the board works")}
      tabIndex={-1}
      className="mm mc-controls ui-zoom nodrag nowheel"
      style={{ top, right, width, maxHeight: (window.innerHeight - top * scale - 8) / scale }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="mm-title">
        <I18nText>HOW THE BOARD WORKS</I18nText>
      </div>
      <div className="mc-controls-grid">
        {CONTROLS.map(([gesture, effect]) => (
          <div key={gesture} className="mc-controls-row">
            <span className="mc-controls-key">
              {KEY_TOKEN_GESTURES.has(gesture) ? gesture : _i18nT(gesture)}
            </span>
            <span className="mc-controls-effect">
              {effect === WHEEL_ROW && !scrollChangesValues ? _i18nT("Zoom") : _i18nT(effect)}
            </span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
