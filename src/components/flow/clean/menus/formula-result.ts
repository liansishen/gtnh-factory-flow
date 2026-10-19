/** Translate read-outs at display time so formula models retain their canonical values. */
export function localizeFormulaResult(result: string, t: (source: string) => string): string {
  if (result === "none") return t("none");
  const over = /^(.+) K over$/.exec(result);
  if (over) return `${over[1]} ${t("K over")}`;
  const power = /^(.+)% power$/.exec(result);
  if (power) return `${power[1]}% ${t("power")}`;
  const perfect = /^(.+) \((.+) perfect\)$/.exec(result);
  if (perfect) return `${perfect[1]} (${perfect[2]} ${t("perfect")})`;
  return result;
}
