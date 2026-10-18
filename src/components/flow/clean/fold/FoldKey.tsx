
import { I18nText } from "@/lib/i18n/react";
import "./fold.css";

/** Which way the panel goes: "left" draws «, "right" draws ». */
export type FoldDirection = "left" | "right";

/** The bare fold arrow, as the mod draws it at the top of a folded strip. */
export function FoldGlyph({ direction }: { direction: FoldDirection }) {
  return (
    <span className="fold-glyph" aria-hidden>
      <I18nText>{direction === "left" ? "«" : "»"}</I18nText>
    </span>
  );
}
