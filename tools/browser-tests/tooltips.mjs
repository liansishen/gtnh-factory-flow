import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.APP_URL ?? "http://127.0.0.1:17840";
const evidence = process.env.I18N_EVIDENCE_DIR;
if (!evidence) throw new Error("Set I18N_EVIDENCE_DIR to a private directory for tooltip evidence.");
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
const dataset = "local-2.9.0-rc-2";
const tips = {
  plans: ["Plans: your plans, the ones shared with you, and Community", "方案库：你的方案、分享给你的方案和社区方案"],
  share: ["Share this plan: invite people to edit it with you, or send a copy", "分享此方案：邀请他人共同编辑，或发送副本"],
  account: ["Sign in: your plans are kept in your account, and shared from it", "登录：在账户中保存和分享方案"],
  feedback: ["Feedback: report a bug, share an idea, or ask for help", "反馈：报告问题、提出建议或寻求帮助"],
  settings: ["Settings", "设置"],
  help: ["Help: the tour, and every control", "帮助：操作引导和全部控制说明"],
  nonrecipe: ["Non-recipe machines: generators, turbines, boilers, reactors", "非配方机器：发电机、涡轮机、锅炉和反应堆"],
  undo: ["Undo (Ctrl+Z)", "撤销（Ctrl+Z）"],
  redo: ["Redo (Ctrl+Shift+Z or Ctrl+Y)", "重做（Ctrl+Shift+Z 或 Ctrl+Y）"],
  arrange: ["Auto-arrange the plan (press again to stop)", "自动整理方案（再次点击可停止）"],
  fit: ["Zoom to fit the whole plan", "缩放以显示整个方案"],
  rate: ["Rate unit: per tick, second, minute or hour", "速率单位：每 tick、每秒、每分钟或每小时"],
  power: ["Show power as EU/t, or as amps at each machine's tier", "以 EU/t 或各机器等级对应的安培数显示电力"],
  annotate: ["Add a sticky note, box or arrow, or change the background", "添加便签、方框或箭头，或更改背景"],
  "drawer-items": ["Items: search and place recipes", "物品：搜索物品并放置配方"],
  "drawer-side": ["Overview: inputs, outputs and machines", "概览：输入、产出和机器"],
};

async function observe(label) {
  const size = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(size.scrollWidth <= size.width + 2, `${label}: page overflow`);
  observations.push({ label, size });
  await page.screenshot({ path: path.join(evidence, `${label}.png`), fullPage: true });
}
async function leave() {
  await page.mouse.move(2, page.viewportSize().height - 2);
  await page.locator("[data-clean-tip]").waitFor({ state: "hidden" });
  await page.locator("[data-minecraft-tooltip=true]").waitFor({ state: "hidden" });
}
async function locale(value) {
  await page.locator('[data-mb="settings"]').click();
  await page.getByRole("tab", { name: /^(Language|语言)$/ }).click();
  await page.getByLabel("Language / 语言", { exact: true }).selectOption(value);
  await page.waitForFunction(expected => document.documentElement.lang === expected, value);
  await page.keyboard.press("Escape");
}
async function hoverKeys(ids, language, label) {
  for (const id of ids) {
    const key = page.locator(`[data-mb="${id}"]`);
    await key.hover();
    const panel = page.locator("[data-clean-tip]");
    await panel.waitFor({ state: "visible" });
    assert.equal(await panel.innerText(), tips[id][language === "en" ? 0 : 1], id);
    const box = await panel.boundingBox();
    assert.ok(box.x >= -2 && box.x + box.width <= page.viewportSize().width + 2, `${label}/${id}: tooltip outside viewport`);
    observations.push({ label: `${label}/${id}`, tooltip: await panel.innerText() });
    if (["help", "power", "drawer-items"].includes(id)) await observe(`${label}-${id}`);
    await leave();
  }
}
async function drawer(open) {
  const key = page.locator('[data-mb="drawer-items"]');
  if ((await key.getAttribute("data-open") !== null) !== open) await key.click();
}
async function exportPlan() {
  await page.locator('[data-mb="share"]').click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /Export plan file|导出方案文件|导出方案/ }).click();
  const file = await (await downloading).path();
  const plan = JSON.parse(await fs.readFile(file, "utf8"));
  await fs.rm(file);
  return plan;
}
async function itemTooltip(language, viewport, recipeCount) {
  const name = language === "en" ? "Adventure Backpack" : "探险背包";
  const input = page.getByRole("textbox", { name: /Search items and fluids|搜索物品和流体/ });
  await input.fill("Adventure Backpack");
  const slot = page.getByRole("listbox", { name: /^(Resource results|资源搜索结果)$/ }).getByRole("option", { name, exact: true }).first();
  await slot.waitFor({ state: "visible", timeout: 120000 });
  await input.blur();
  await slot.hover();
  const tip = page.locator("[data-minecraft-tooltip=true]");
  await tip.waitFor({ state: "visible" });
  const text = await tip.innerText();
  assert.ok(text.startsWith(name), text);
  assert.ok(text.includes(language === "en" ? `${recipeCount.toLocaleString()} ${recipeCount === 1 ? "recipe" : "recipes"}` : `${recipeCount.toLocaleString()} 个配方`), text);
  assert.doesNotMatch(text, /NBT:|wearableData|inventory:/i);
  await observe(`backpack-${viewport}-${language}`);
  await leave();
  return slot;
}

try {
  await page.goto(base, { waitUntil: "load", timeout: 120000 });
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await page.getByRole("button", { name: "New design", exact: true }).click();
  const top = ["plans", "share", "account", "feedback", "settings", "help"];
  const board = ["nonrecipe", "undo", "redo", "arrange", "fit", "rate", "power", "annotate"];
  await hoverKeys([...top, ...board], "en", "desktop-en");
  await locale("zh-CN");
  await hoverKeys([...top, ...board], "zh-CN", "desktop-zh");
  await page.locator('[data-mb="plans"]').click();
  await hoverKeys(top, "zh-CN", "library-zh");
  await page.locator('[data-mb="plans"]').click();
  const response = await context.request.get(new URL(`/api/datasets/${dataset}/resources?query=Adventure%20Backpack&limit=1`, base).toString());
  assert.equal(response.status(), 200);
  const backpack = (await response.json()).resources[0];
  assert.ok(backpack.tooltip.some(line => line.startsWith("NBT: ")));
  const slot = await itemTooltip("zh-CN", "desktop", backpack.recipeCount);
  await slot.click();
  await page.locator('[data-recipe=""]').first().waitFor({ state: "visible", timeout: 120000 });
  const port = page.locator('[data-recipe=""] [data-port][data-side="output"]').filter({ hasText: "探险背包" }).first();
  await port.hover();
  const portTip = page.locator("[data-minecraft-tooltip=true]");
  await portTip.waitFor({ state: "visible" });
  assert.doesNotMatch(await portTip.innerText(), /NBT:|wearableData/i);
  await observe("recipe-port-zh");
  await leave();
  const catalyst = page.locator(".nrw-catalyst").first();
  if (await catalyst.isVisible()) {
    await catalyst.hover();
    await page.locator("[data-minecraft-tooltip=true]").waitFor({ state: "visible" });
    assert.doesNotMatch(await page.locator("[data-minecraft-tooltip=true]").innerText(), /NBT:/i);
    await observe("recipe-catalyst-zh");
    await leave();
  }
  await page.locator('[data-recipe=""]').first().locator('[data-glyph="plus"]').click();
  const close = page.getByRole("button", { name: /Close recipe search|关闭配方搜索/ });
  if (await close.isVisible()) await close.click();
  await page.locator(".react-flow__node-recipeNode").first().waitFor();
  const before = await exportPlan();
  assert.ok(before.recipes.flatMap(recipe => [...recipe.inputs, ...recipe.outputs]).some(resource => resource.tooltip?.some(line => line.startsWith("NBT:"))), "export retains recipe NBT");
  await locale("en");
  await itemTooltip("en", "desktop", backpack.recipeCount);
  assert.deepEqual(await exportPlan(), before, "hovering and switching locale preserves recipe NBT and plan data");
  await page.setViewportSize({ width: 390, height: 844 });
  await hoverKeys([...top, ...board, "drawer-side", "drawer-items"], "en", "mobile-en");
  await drawer(true);
  await itemTooltip("en", "mobile", backpack.recipeCount);
  await drawer(false);
  await locale("zh-CN");
  await hoverKeys([...top, ...board, "drawer-side", "drawer-items"], "zh-CN", "mobile-zh");
  await drawer(true);
  await itemTooltip("zh-CN", "mobile", backpack.recipeCount);
  await drawer(false);
  await page.goto(new URL("/community", base).toString(), { waitUntil: "load" });
  assert.equal(new URL(page.url()).pathname, "/");
  await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
  await hoverKeys(top, "zh-CN", "community-redirect-zh");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: "PASS", observations: observations.length, pageErrors: errors.length }));
} catch (error) {
  await observe("failure").catch(() => {});
  throw error;
} finally {
  await fs.writeFile(path.join(evidence, "observations.json"), JSON.stringify({ observations, errors }, null, 2));
  await browser.close();
}
