import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.APP_URL ?? "http://127.0.0.1:17840";
const evidence = process.env.I18N_EVIDENCE_DIR;
if (!evidence) throw new Error("Set I18N_EVIDENCE_DIR to a private directory for GT tool observations.");
await fs.mkdir(evidence, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
await context.route("**/*", route => {
  const url = new URL(route.request().url());
  return url.origin === new URL(base).origin || !/^https?:$/.test(url.protocol) ? route.continue() : route.abort("blockedbyclient");
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const observations = [];
const electricTools = [
  ["Drill", "电钻"], ["Chainsaw", "链锯"], ["Wrench", "扳手"], ["JackHammer", "气锤"],
  ["Buzzsaw", "圆锯"], ["Screwdriver", "螺丝刀"], ["Soldering Iron", "电烙铁"],
  ["Wire Cutter", "剪线钳 "], ["File", "锉刀 "],
];
const toolNames = electricTools.flatMap(([name, zh]) => ["LV", "MV", "HV"].map(tier => [`${name} (${tier})`, `${zh}(${tier})`]));
const results = page.getByRole("listbox", { name: /^(Resource results|资源搜索结果)$/ });
const input = () => page.getByRole("textbox", { name: /^(Search items and fluids|搜索物品和流体)$/ });
const tip = page.locator("[data-minecraft-tooltip=true], [data-clean-tip]");
async function locale(value) {
  await page.locator('[data-mb="settings"]').click();
  await page.getByRole("tab", { name: /^(Language|语言)$/ }).click();
  await page.getByLabel("Language / 语言", { exact: true }).selectOption(value);
  await page.waitForFunction(expected => document.documentElement.lang === expected, value);
  await page.keyboard.press("Escape");
}
async function drawer(open) {
  const key = page.locator('[data-mb="drawer-items"]');
  if (await key.isVisible() && ((await key.getAttribute("data-open") !== null) !== open)) await key.click();
}
async function search(query, expected) {
  if (await input().inputValue() !== query) {
    await input().fill("zzzzzqpyn");
    await page.getByText(/^(No matching resource\.|没有匹配的资源。)$/, { exact: true }).waitFor({ timeout: 120000 });
    await input().fill(query);
  }
  const slot = results.getByRole("option", { name: expected, exact: true }).first();
  await slot.waitFor({ timeout: 120000 });
  await input().blur();
  return slot;
}
async function hover(slot, expected, label) {
  await slot.hover();
  await tip.waitFor();
  const title = tip.locator(".tp-title");
  assert.equal(await title.count() ? await title.innerText() : (await tip.innerText()).split("\n")[0], expected, label);
  observations.push({ label, name: expected });
  await page.mouse.move(2, page.viewportSize().height - 2);
  await tip.waitFor({ state: "hidden" });
}
async function exportPlan() {
  await drawer(false);
  await page.locator('[data-mb="share"]').click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /Export plan file|导出方案文件|导出方案/ }).click();
  const file = await (await downloading).path();
  const plan = JSON.parse(await fs.readFile(file, "utf8"));
  await fs.rm(file);
  return plan;
}

try {
  await page.goto(base, { waitUntil: "load", timeout: 120000 });
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await page.getByRole("button", { name: "New design", exact: true }).click();
  for (const [viewport, size] of [["desktop", { width: 1440, height: 1000 }], ["mobile", { width: 390, height: 844 }]]) {
    await page.setViewportSize(size);
    for (const language of ["en", "zh-CN"]) {
      await drawer(false);
      await locale(language);
      await drawer(true);
      await search("gregtech:gt.metatool.01", language === "en" ? "Wrench (LV)" : "扳手(LV)");
      for (const [source, zh] of toolNames) {
        const name = language === "en" ? source : zh;
        await hover(results.getByRole("option", { name, exact: true }).first(), name, `${viewport}/${language}/${source}`);
      }
    }
    for (const [query, name] of [["扳手", "扳手(LV)"], ["banshou", "扳手(LV)"], ["Wrench", "扳手(LV)"], ["锉刀", "锉刀 (LV)"], ["cuodao", "锉刀 (LV)"], ["File", "锉刀 (LV)"]]) {
      await hover(await search(query, name), name, `${viewport}/search/${query}`);
    }
    for (const [source, name] of [["Wrench (LV)", "扳手(LV)"], ["File (LV)", "锉刀 (LV)"], ["JackHammer (LV)", "气锤(LV)"]]) {
      const slot = await search(source, name);
      await slot.click();
      const port = page.locator('[data-recipe=""] [data-port][data-side="output"]').filter({ has: page.getByText(name, { exact: true }) }).first();
      await port.waitFor({ timeout: 120000 });
      await hover(port, name, `${viewport}/recipe/${source}`);
      const close = page.getByRole("button", { name: /^(Close recipe search|关闭配方搜索)$/ });
      await close.click();
      await drawer(true);
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await search("Wrench (LV)", "扳手(LV)").then(slot => slot.click());
  const recipe = page.locator('[data-recipe=""]').filter({ has: page.getByText("扳手(LV)", { exact: true }) }).first();
  await recipe.locator('[data-glyph="plus"]').click();
  const close = page.getByRole("button", { name: /^(Close recipe search|关闭配方搜索)$/ });
  if (await close.isVisible()) await close.click();
  const board = page.locator(".react-flow__node-recipeNode").first();
  await board.waitFor();
  await page.locator('[data-mb="fit"]').click();
  await page.waitForTimeout(500);
  await hover(board.locator('[data-port][data-side="output"]').filter({ hasText: "扳手(LV)" }).first(), "扳手(LV)", "board/zh");
  const before = await exportPlan();
  assert.ok(before.recipes.some(recipe => recipe.outputs.some(output => output.displayName === "Wrench (LV)" && output.id === "gregtech:gt.metatool.01@120")));
  await locale("en");
  await hover(board.locator('[data-port][data-side="output"]').filter({ hasText: "Wrench (LV)" }).first(), "Wrench (LV)", "board/en");
  assert.deepEqual(await exportPlan(), before);
  await page.goto(new URL("/community", base).toString(), { waitUntil: "load" });
  assert.equal(new URL(page.url()).pathname, "/");
  await locale("zh-CN");
  await search("File (LV)", "锉刀 (LV)").then(slot => hover(slot, "锉刀 (LV)", "community-redirect/zh"));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "PASS", observations: observations.length, pageErrors: errors.length }));
} catch (error) {
  await page.screenshot({ path: path.join(evidence, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await fs.writeFile(path.join(evidence, "gt-tools-observations.json"), JSON.stringify({ observations, errors }, null, 2));
  await context.close();
  await browser.close();
}
