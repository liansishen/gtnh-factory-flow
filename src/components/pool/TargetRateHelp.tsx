
import { I18nText } from "@/lib/i18n/react";
import type { FactoryProject, FactoryStorage, StorageThroughputResult } from "@/lib/model/types";
import { storageTargetMode, TARGET_MODE_LABELS } from "@/lib/model/storage-target";
import { formatPoolRate, isPoolDisplayZero } from "./worksheet-format";

/** Explain the selected target using the current plan, without guessing a solver cause. */
export function TargetRateHelp({ storage, input, result, project }: {
  storage: FactoryStorage;
  input: boolean;
  result: StorageThroughputResult | undefined;
  project: FactoryProject;
}) {
  const mode = storageTargetMode(storage, input ? "source" : "product");
  const actual = input ? result?.consumedPerSecond : result?.producedPerSecond;
  const stopped = actual !== undefined && isPoolDisplayZero(actual);
  const hasRecipes = project.nodes.some(node => node.enabled);
  return <div className="pool-target-explanation">
    <strong className="pool-target-help-name"><I18nText game>{storage.displayName ?? storage.resourceId}</I18nText></strong>
    <div className="pool-target-help-rates">
      <span><I18nText>{input ? "Use" : "Make"}</I18nText> {TARGET_MODE_LABELS[mode].toLowerCase()} <strong className="pool-help-goal">{formatPoolRate(Math.abs(storage.targetPerSecond ?? 0), storage.kind)}</strong></span>
      <span><I18nText>Currently </I18nText><I18nText>{input ? "using" : "making"}</I18nText> <strong className="pool-help-actual">{formatPoolRate(Math.abs(actual ?? 0), storage.kind)}</strong></span>
    </div>
    {stopped ? <p className="pool-help-actual"><strong><I18nText>No flow.</I18nText></strong><I18nText> This target is stopped.</I18nText></p> : null}
    {!hasRecipes ? <p><I18nText>Add or enable recipes that </I18nText><I18nText>{input ? "use" : "make"}</I18nText><I18nText> this item.</I18nText></p> : <p><I18nText>The solver could not identify which constraint blocks this rate.</I18nText></p>}
  </div>;
}
