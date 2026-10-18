"use client";
import { useT } from "@/lib/i18n/react";


import { Bug } from "lucide-react";
import { openFeedback } from "./feedback-store";

/**
 * The top bar's red bug key (the mod's Feedback key). The chrome places it; it only opens the box
 * (FeedbackHost shows it).
 */
export function FeedbackKey({ className = "" }: { className?: string }) {
  const _i18nT = useT();
  return (
    <button
      type="button"
      aria-label={_i18nT("Send feedback")}
      title={_i18nT("Send feedback: a bug, an idea, or a question")}
      className={`fb-topkey ${className}`}
      onClick={openFeedback}
    >
      <Bug size={14} strokeWidth={2.4} />
    </button>
  );
}
