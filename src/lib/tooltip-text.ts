/** Raw NBT metadata stays in recipe data and is hidden in item tooltips. */
export function isNbtTooltipLine(line: string): boolean {
  return line.trim().toLowerCase().startsWith("nbt:");
}
