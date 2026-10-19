import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const base = process.env.APP_URL ?? "http://127.0.0.1:17840";
const evidence = process.env.I18N_EVIDENCE_DIR;
if (!evidence) throw new Error("Set I18N_EVIDENCE_DIR to a private directory for screenshots and observations.");
await fs.mkdir(evidence, { recursive: true });
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const observations = [];
const errors = [];
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
const externalRequests = [];
await context.route("**/*", route => {
  const requestUrl = new URL(route.request().url());
  if (requestUrl.origin === new URL(base).origin || !/^https?:$/.test(requestUrl.protocol)) return route.continue();
  externalRequests.push(requestUrl.origin + requestUrl.pathname);
  return route.abort("blockedbyclient");
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.stack ?? error.message));
const dataset = "local-2.9.0-rc-2";
const canonical = "gregtech:gt.metaitem.01@17305";
const userName = "Steel Plate 我的工厂";
const appDialog = page.locator('[role="dialog"]:not([data-tour="offer"])');
const resourceResults = page.getByRole("listbox", { name: /^(Resource results|资源搜索结果)$/ });

async function observe(label) {
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, font: getComputedStyle(document.body).fontFamily }));
  const dialogs = await page.getByRole("dialog").evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { label: element.getAttribute("aria-label"), left: rect.left, right: rect.right }; }));
  observations.push({ label, url: page.url(), lang: await page.locator("html").getAttribute("lang"), text: await page.locator("body").innerText(), dimensions, dialogs });
  await page.screenshot({ path: path.join(evidence, `${label}.png`), fullPage: true });
  assert.ok(dimensions.scrollWidth <= dimensions.width + 2, `${label}: horizontal page overflow`);
  for (const dialog of dialogs) assert.ok(dialog.left >= -2 && dialog.right <= dimensions.width + 2, `${label}: dialog outside viewport ${JSON.stringify(dialog)}`);
}
async function locale(target) {
  await page.locator('[data-mb="settings"]').click();
  await page.getByRole("tab", { name: /^(Language|语言)$/ }).click();
  await page.getByLabel("Language / 语言", { exact: true }).selectOption(target);
  await page.waitForFunction(value => document.documentElement.lang === value, target);
  assert.equal(await page.getByLabel("Language / 语言").inputValue(), target);
  await observe(`settings-${target}-${await page.viewportSize().width}`);
  await page.keyboard.press("Escape");
}
async function drawer(id, open) {
  const key = page.locator(`[data-mb="${id}"]`);
  if ((await key.getAttribute("data-open") !== null) !== open) await key.click();
  await page.waitForFunction(({ id, open }) => document.querySelector(`[data-mb="${id}"]`).hasAttribute("data-open") === open, { id, open });
}
async function exportPlan() {
  await page.locator('[data-mb="share"]').click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /Export plan file|导出方案文件|导出方案/ }).click();
  const download = await downloading;
  const file = await download.path();
  const project = JSON.parse(await fs.readFile(file, "utf8"));
  await fs.rm(file);
  return project;
}
async function search(query) {
  const input = page.getByRole("textbox", { name: /Search items and fluids|搜索物品和流体/ });
  if (await input.inputValue() !== query) {
    await input.fill("zzzzzqpyn");
    await page.getByText(/^(No matching resource\.|没有匹配的资源。)$/, { exact: true }).waitFor({ timeout: 120000 });
    await input.fill(query);
  }
  await resourceResults.getByRole("option", { name: /^(Steel Plate|钢板)$/ }).first().waitFor({ state: "visible", timeout: 120000 });
}
async function queryResources(query, extra = {}) {
  const url = new URL(`/api/datasets/${dataset}/resources`, base);
  for (const [key, value] of Object.entries({ query, offset: "0", limit: "12", ...extra })) url.searchParams.set(key, value);
  const response = await context.request.get(url.toString(), { timeout: 120000 });
  assert.equal(response.status(), 200);
  return response.json();
}
async function emptySearchStates(viewport) {
  const input = page.getByRole("textbox", { name: /Search items and fluids|搜索物品和流体/ });
  await input.fill("龘靐齉");
  await page.getByText("没有匹配的资源。", { exact: true }).waitFor();
  await observe(`search-empty-${viewport}-zh`);
  for (const [filter, message] of [
    ["在此画布上", "画布上还没有放置任何东西。"],
    ["作物产出", "没有作物能长出这个。"],
    ["蜜蜂产出", "没有蜜蜂能产出这个。"],
  ]) {
    await page.getByRole("button", { name: "显示与排序", exact: true }).click();
    const menu = page.getByRole("menu", { name: "显示与排序", exact: true });
    await menu.getByRole("menuitem", { name: filter, exact: true }).click();
    await page.getByText(message, { exact: true }).waitFor();
    await observe(`search-empty-${viewport}-${filter}-zh`);
  }
  await page.getByRole("button", { name: "显示与排序", exact: true }).click();
  await page.getByRole("menu", { name: "显示与排序", exact: true }).getByRole("menuitem", { name: /^全部资源/ }).click();
  await page.getByText("没有匹配的资源。", { exact: true }).waitFor();
  const errorRoute = "**/api/datasets/*/resources?*query=i18n-query-error*";
  await page.route(errorRoute, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Resource query failed." }) }));
  try {
    await input.fill("i18n-query-error");
    await page.getByText("资源查询失败。", { exact: true }).waitFor();
    await observe(`search-error-${viewport}-zh`);
    await locale("en");
    await page.getByText("Resource query failed.", { exact: true }).waitFor();
    await locale("zh-CN");
    await page.getByText("资源查询失败。", { exact: true }).waitFor();
  } finally {
    await page.unroute(errorRoute);
  }
  await search("钢板");
}

async function recipePinyin(viewport) {
  await page.getByRole("button", { name: /^(Filter recipes by name|按名称筛选配方)$/ }).click();
  const input = page.getByRole("textbox", { name: /^(Filter recipes by name|按名称筛选配方)$/ });
  await input.fill("zzzzzqpyn");
  await page.waitForFunction(() => document.querySelectorAll('[data-recipe=""]').length === 0);
  await input.fill("gangban");
  await page.locator('[data-recipe=""]').first().waitFor({ state: "visible", timeout: 120000 });
  await observe(`pinyin-recipe-filter-${viewport}`);
  await page.getByRole("button", { name: /^(Filter recipes by name|按名称筛选配方)$/ }).click();
  await page.locator('[data-recipe=""]').first().waitFor({ state: "visible", timeout: 120000 });
}
async function boardAndOverviewPinyin(viewport = "desktop") {
  if (viewport === "mobile") await drawer("drawer-items", true);
  await page.getByRole("button", { name: "显示与排序", exact: true }).click();
  await page.getByRole("menu", { name: "显示与排序", exact: true }).getByRole("menuitem", { name: "在此画布上", exact: true }).click();
  const input = page.getByRole("textbox", { name: "搜索物品和流体", exact: true });
  await input.fill("zzzzzqpyn");
  await page.getByText("画布上还没有放置任何东西。", { exact: true }).waitFor();
  await input.fill("gangban");
  await resourceResults.getByRole("option", { name: "钢板", exact: true }).waitFor();
  await observe(`pinyin-board-subset-${viewport}`);
  await page.getByRole("button", { name: "显示与排序", exact: true }).click();
  await page.getByRole("menu", { name: "显示与排序", exact: true }).getByRole("menuitem", { name: /^全部资源/ }).click();
  if (viewport === "mobile") await drawer("drawer-side", true);
  const overview = page.locator('input.rail-filter');
  await overview.click();
  await overview.fill("zzzzzqpyn");
  await page.waitForFunction(() => document.querySelectorAll('[data-resource-row]').length === 0);
  await overview.fill("gangban");
  await page.locator(`[data-resource-row="item:${canonical}"]`).first().waitFor();
  assert.equal(await page.locator('[data-resource-row="item:gregtech:gt.metaitem.01@11305"]').count(), 0);
  await observe(`pinyin-overview-filter-${viewport}`);
  await overview.fill("");
  if (viewport === "mobile") await drawer("drawer-side", false);
}
async function powerPinyin(viewport, place = false) {
  for (const id of ["drawer-items", "drawer-side"]) {
    const key = page.locator(`[data-mb="${id}"][data-open]`);
    if (await key.isVisible()) await key.click();
  }
  await page.locator('[data-mb="nonrecipe"]').click();
  if (viewport === "mobile") {
    const sheet = page.getByRole("region", { name: /^(Power sources|电力来源)$/ });
    await sheet.waitFor();
    const input = sheet.getByRole("textbox");
    const cards = sheet.locator("button.group");
    for (const query of ["ranqiwolun", "rqwl", "ranqi涡轮"]) {
      await input.fill(query);
      await sheet.getByRole("button", { name: /^Gas Turbine\b/ }).waitFor();
      assert.equal(await cards.count(), 3);
    }
    await input.fill("zzzzzqpyn");
    await page.waitForFunction(() => document.querySelectorAll('section[aria-label] button.group').length === 0);
    await input.fill("benfen");
    await sheet.getByRole("button", { name: /^Universal Chemical Fuel Engine\b/ }).waitFor();
    await observe("pinyin-power-fuel-mobile");
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden" });
    return;
  }
  const dialog = page.locator('[data-mod-power-picker]');
  await dialog.waitFor();
  const input = dialog.getByRole("textbox");
  for (const query of ["ranqiwolun", "rqwl", "ranqi涡轮"]) {
    await input.fill(query);
    await dialog.locator('[data-source="gas-turbine"]').waitFor();
    if (query === "ranqi涡轮") assert.deepEqual(await dialog.locator('[data-source]').evaluateAll(nodes => nodes.map(node => node.dataset.source)), ["gas-turbine", "large-gas-turbine", "xl-turbo-gas-turbine"]);
  }
  await input.fill("zzzzzqpyn");
  await page.waitForFunction(() => document.querySelectorAll('[data-mod-power-picker] [data-source]').length === 0);
  await input.fill("benfen");
  const source = dialog.locator('[data-source="universal-chemical-fuel-engine"]');
  await source.waitFor();
  await input.fill("ben酚");
  await source.waitFor();
  await observe(`pinyin-power-fuel-${viewport}`);
  if (place) {
    await source.click();
    await dialog.waitFor({ state: "hidden" });
    const exported = await exportPlan();
    const recipe = exported.recipes.find(recipe => recipe.power?.sourceId === "universal-chemical-fuel-engine");
    assert.ok(recipe, "pinyin fuel search must place the canonical power recipe");
    const node = exported.nodes.find(node => node.recipeId === recipe.id);
    assert.equal(node?.machineConfigTiers?.fuel, "Phenol");
    await page.locator(`.react-flow__node[data-id="${node.id}"] [data-glyph="gear"]`).click();
    await page.locator('[data-cc-sheet] .cs-row').filter({ has: page.locator('.cs-label', { hasText: /^(Fuel|燃料)$/ }) }).locator('.cs-well').click();
    const filter = page.locator('input.cm-filter').last();
    await filter.fill("zzzzzqpyn");
    await page.locator('.cm-empty').waitFor();
    await filter.fill("xiaojiben");
    const fuelOption = page.getByRole("menuitem").filter({ hasText: /^(Nitrobenzene|硝基苯)$/ });
    await fuelOption.waitFor();
    await observe(`pinyin-fuel-options-${viewport}`);
    await fuelOption.click();
    await filter.waitFor({ state: "hidden" });
    await page.keyboard.press("Escape");
    assert.equal((await exportPlan()).nodes.find(entry => entry.id === node.id)?.machineConfigTiers?.fuel, "Nitrobenzene");
  } else await page.keyboard.press("Escape");
}
try {
  const root = await page.goto(base, { waitUntil: "load", timeout: 120000 });
  assert.equal(root.status(), 200);
  assert.match(await page.title(), /GTNH/);
  const dismiss = page.getByRole("button", { name: "Dismiss", exact: true });
  await dismiss.waitFor({ state: "visible", timeout: 30000 });
  await dismiss.click();
  await page.getByRole("button", { name: "New design", exact: true }).click();
  await locale("zh-CN");
  assert.equal(await page.locator('[data-mb="plans"]').innerText(), "方案库");
  assert.equal(await page.locator('[data-mb="share"]').innerText(), "分享");
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
  assert.equal(await page.locator('[data-mb="plans"]').innerText(), "方案库");
  assert.doesNotMatch(await page.locator("body").innerText(), /\bINPUTS\b|\bOUTPUTS\b|\bINTERNAL\b|\bMACHINES\b/);
  const zh = await queryResources("钢板");
  const en = await queryResources("Steel Plate");
  assert.equal(zh.resources[0].id, canonical);
  assert.equal(en.resources[0].id, canonical);
  for (const query of ["钢", "gt 钢板"]) assert.ok((await queryResources(query)).resources.some(item => item.id === canonical), query);
  assert.equal((await queryResources("龘靐齉")).total, 0);
  const second = await queryResources("钢板", { offset: "1", limit: "1" });
  assert.equal(second.total, zh.total);
  assert.equal(second.resources[0].id, zh.resources[1].id);
  observations.push({ label: "api-identities", zh: zh.resources.map(item => item.id), en: en.resources.map(item => item.id), total: zh.total });
  const pinyinReadings = ["gangban", "gang ban", "gb", "gangb", "gban", "钢ban", "gang板", "gt gangban"];
  for (const query of pinyinReadings) {
    const result = await queryResources(query);
    assert.ok(result.resources.some(item => item.id === canonical), query);
    if (query === "gangban") assert.equal(result.resources[0].id, canonical);
  }
  assert.equal((await queryResources("zzzzzqpyn")).total, 0);
  const phenol = await queryResources("ben酚");
  assert.equal(phenol.resources[0].displayName, "Phenol");
  assert.ok(phenol.resources.every(resource => resource.displayName !== "Benzene"));
  assert.equal((await queryResources("ben龘")).total, 0);
  for (const prefix of ["gang", "ban", "dan"]) {
    const result = await queryResources(prefix);
    assert.ok(result.resources[0].displayName.toLowerCase().startsWith(prefix), `${prefix}: literal English prefix ranks first`);
  }

  const emptySearchResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/resources") && url.searchParams.get("query") === "龘靐齉";
  });
  await page.getByRole("textbox", { name: /Search items and fluids|搜索物品和流体/ }).fill("龘靐齉");
  await emptySearchResponse;
  await page.waitForFunction(() => document.querySelectorAll('[role="option"]').length === 0);
  await emptySearchStates("desktop");
  await search("Steel Plate");
  await search("gt 钢板");
  for (const query of pinyinReadings) await search(query);
  await observe("pinyin-desktop-zh");
  await search("钢板");
  await resourceResults.getByRole("option", { name: "钢板", exact: true }).first().click();
  await page.locator('[data-recipe=""]').first().waitFor({ state: "visible", timeout: 120000 });
  assert.match(await page.locator("body").innerText(), /不消耗/);
  assert.match(await page.locator("body").innerText(), /所有等级/);
  await observe("recipe-desktop-zh");
  await recipePinyin("desktop");
  const add = page.locator('[data-recipe=""]').first().locator('[data-glyph="plus"]');
  await add.click();
  const closeRecipe = page.getByRole("button", { name: /Close recipe search|关闭配方搜索/ });
  if (await closeRecipe.isVisible()) await closeRecipe.click();
  await page.locator(".react-flow__node-recipeNode").first().waitFor({ state: "visible", timeout: 120000 });
  const machineCount = page.locator('.react-flow__node-recipeNode .cc-count').first();
  await machineCount.click();
  await machineCount.locator('input').fill("2");
  await machineCount.locator('input').press("Enter");
  await page.waitForFunction(() => document.querySelector('.react-flow__node-recipeNode .cc-count')?.getAttribute("data-set") === "2");
  await search("钢板");
  await resourceResults.getByRole("option", { name: "钢板", exact: true }).first().dragTo(page.locator(".react-flow").first(), { targetPosition: { x: 200, y: 500 } });
  await page.locator('.react-flow__node-storageNode .cd-box').first().waitFor();
  assert.equal(await page.locator('.react-flow__node-storageNode .cd-box').first().getAttribute("data-text"), "设置");
  await observe("pinned-count-and-drawer-desktop-zh");
  await boardAndOverviewPinyin();
  await powerPinyin("desktop", true);
  const tab = page.locator('[role="tab"][data-design-id][data-active]').first();
  await tab.focus();
  await page.keyboard.press("F2");
  const rename = tab.locator("input");
  await rename.fill(userName);
  await rename.press("Enter");
  await page.waitForFunction(value => document.querySelector('[role="tab"][data-design-id][data-active] .mt-name')?.textContent === value, userName);
  assert.equal(await tab.locator(".mt-name").innerText(), userName);
  const before = await exportPlan();
  await fs.writeFile(path.join(evidence, "export-before.json"), JSON.stringify(before, null, 2));
  assert.ok(before.nodes.length > 0);
  assert.equal(before.name, userName);
  assert.ok(before.recipes.some(recipe => [...recipe.inputs, ...recipe.outputs].some(resource => resource.id === canonical)));
  assert.ok(before.recipes.flatMap(recipe => [...recipe.inputs, ...recipe.outputs]).some(resource => resource.displayName === "Steel Plate"));
  await observe("board-desktop-zh");
  assert.doesNotMatch(await page.locator("body").innerText(), /\bSet\b|Nothing to calculate yet/);
  await locale("en");
  assert.equal(await page.locator('.react-flow__node-storageNode .cd-box').first().getAttribute("data-text"), "Set");
  await search("gangban");
  await observe("pinyin-desktop-en");
  const after = await exportPlan();
  await fs.writeFile(path.join(evidence, "export-after.json"), JSON.stringify(after, null, 2));
  assert.deepEqual(after, before, "locale switching must not alter exported canonical plan data");
  assert.equal(await page.locator('[role="tab"][data-design-id][data-active] .mt-name').innerText(), userName);
  await page.reload({ waitUntil: "load" });
  await page.waitForFunction(() => document.documentElement.lang === "en");
  await page.locator(".react-flow__node-recipeNode").first().waitFor({ timeout: 120000 });
  assert.equal(await page.locator('[role="tab"][data-design-id][data-active] .mt-name').innerText(), userName);
  await locale("zh-CN");
  const upload = page.locator("[data-plan-file-input]");
  const previousTabs = await page.locator('[role="tab"][data-design-id]').count();
  await upload.setInputFiles({ name: "saved-plan.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(before)) });
  await page.waitForFunction(count => document.querySelectorAll('[role="tab"][data-design-id]').length > count, previousTabs);
  const imported = await exportPlan();
  assert.equal(imported.nodes.length, before.nodes.length);
  assert.deepEqual(imported.recipes.map(recipe => recipe.id), before.recipes.map(recipe => recipe.id));
  assert.equal(imported.name, userName);
  await page.locator('[data-mb="plans"]').click();
  await observe("library-desktop-zh");
  assert.match(await page.locator("body").innerText(), /我的方案|方案库/);
  assert.match(await page.locator('[data-mod-library]').innerText(), /当前显示/);
  assert.doesNotMatch(await page.locator('[data-mod-library]').innerText(), /just now|\bSHOWING\b|\bOPEN\b/);
  const planFilter = page.locator('[data-mod-library] input').first();
  await planFilter.fill("no-matching-plan-龘");
  await page.waitForFunction(() => document.querySelectorAll('.ml-tile:not(.ml-new)').length === 0);
  await observe("library-empty-desktop-zh");
  await planFilter.fill("");
  await page.locator('[data-mod-library] .ml-tile:not(.ml-new)').first().waitFor();
  await page.locator('[data-mod-library] [role="tab"]').filter({ hasText: "社区" }).click();
  await page.locator('[data-mod-library] .ml-public').waitFor();
  await observe("community-unconfigured-desktop-zh");
  await page.locator('[data-mb="plans"]').click();
  await page.locator('[data-mb="help"]').click();
  await observe("help-menu-desktop-zh");
  await page.keyboard.press("Escape");
  await page.locator('[data-mb="help"]').click();
  await page.getByRole("menuitem", { name: /Controls and shortcuts|操作与快捷键/ }).click();
  await appDialog.waitFor();
  await observe("controls-desktop-zh");
  assert.match(await appDialog.innerText(), /在物品上按 R 或 U/);
  assert.doesNotMatch(await appDialog.innerText(), /Show its recipes|Click the board|Select everything/);
  await page.keyboard.press("Escape");
  await page.locator('[data-mb="help"]').click();
  await page.getByRole("menuitem", { name: /What's new|更新内容/ }).click();
  await appDialog.waitFor();
  await observe("changelog-desktop-zh");
  assert.match(await appDialog.innerText(), /选择缩小视图的起点/);
  await page.keyboard.press("Escape");
  await page.locator('[data-mb="account"]').click();
  await appDialog.waitFor();
  await observe("signin-desktop-zh");
  await page.keyboard.press("Escape");
  await page.locator('[data-mb="settings"]').click();
  const settingsTabs = page.locator('[data-mod-settings] [role="tab"]');
  for (let index = 0; index < await settingsTabs.count(); index += 1) {
    await settingsTabs.nth(index).click();
    await observe(`settings-section-${index}-desktop-zh`);
  }
  await page.keyboard.press("Escape");

  const tourOffer = page.locator('[data-tour="offer"]');
  if (await tourOffer.isVisible()) await tourOffer.getByRole("button", { name: /Not now|暂时跳过/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await observe("board-mobile-zh");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  await locale("en");
  await locale("zh-CN");
  assert.equal(await page.locator('[data-mb="drawer-side"]').innerText(), "概览");
  await page.locator('[data-mb="settings"]').click();
  const mobileSettingsTabs = page.locator('[data-mod-settings] [role="tab"]');
  for (let index = 0; index < await mobileSettingsTabs.count(); index += 1) {
    await mobileSettingsTabs.nth(index).click();
    await observe(`settings-section-${index}-mobile-zh`);
    if (index === 0) {
      const rows = page.locator('[data-mod-settings] .ms-rows');
      await rows.hover({ position: { x: 2, y: 2 } });
      await page.mouse.wheel(0, 2500);
      await page.waitForFunction(() => (document.querySelector('[data-mod-settings] .ms-rows')?.scrollTop ?? 0) > 0);
      await page.getByText("设置规划器的字体。", { exact: true }).waitFor({ state: "visible" });
      await observe("settings-board-scroll-mobile-zh");
    }
  }
  await page.keyboard.press("Escape");
  await page.locator('[data-mb="plans"]').click();
  await observe("library-mobile-zh");
  await page.locator('[data-mb="plans"]').click();
  await drawer("drawer-items", true);
  await emptySearchStates("mobile");
  for (const query of ["gangban", "gang ban", "gb", "钢ban"]) await search(query);
  await observe("pinyin-mobile-zh");
  await search("钢板");
  await resourceResults.getByRole("option", { name: "钢板", exact: true }).first().click();
  await page.locator('[data-recipe=""]').first().waitFor({ timeout: 120000 });
  await observe("recipe-mobile-zh");
  await recipePinyin("mobile");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2));
  await page.getByRole("button", { name: /Close recipe search|关闭配方搜索/ }).click();
  await boardAndOverviewPinyin("mobile");
  await powerPinyin("mobile");
  await page.locator('[data-mb="help"]').click();
  await page.getByRole("menuitem", { name: /Controls and shortcuts|操作与快捷键/ }).click();
  await appDialog.waitFor();
  await observe("controls-mobile-zh");
  await appDialog.hover();
  await page.mouse.wheel(0, 2500);
  await page.waitForFunction(() => (document.querySelector('.mc-controls')?.scrollTop ?? 0) > 0);
  await page.getByText("双击概览中的一行", { exact: true }).waitFor({ state: "visible" });
  await observe("controls-mobile-scrolled-zh");
  await page.keyboard.press("Escape");
  await page.goto(new URL("/community", base).toString(), { waitUntil: "load" });
  assert.equal(new URL(page.url()).pathname, "/");
  await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
  assert.equal(await page.locator('[role="tab"][data-design-id][data-active] .mt-name').innerText(), userName);
  await observe("legacy-community-redirect-zh");
  assert.deepEqual(errors, [], "real application page errors");
  observations.push({ label: "passed", pageErrors: errors, blockedExternalRequests: externalRequests, scope: "language switch/reload, Chinese/English/pinyin API and resource search, empty/error states, recipe-name and canvas/overview filters, generator/fuel search and placement, add canonical recipe, pin count, drag resource drawer, rename, export equality, persisted reload, import as new design, library filtering, unconfigured Community, settings, help and latest release notes, mobile scrolling, legacy route redirect, desktop/mobile; all cross-origin browser requests blocked" });
  await fs.writeFile(path.join(evidence, "observations.json"), JSON.stringify(observations, null, 2));
  console.log(JSON.stringify({ result: "PASS", observations: observations.length, pageErrors: errors.length }));
} catch (error) {
  await observe("failure").catch(() => {});
  await fs.writeFile(path.join(evidence, "observations.json"), JSON.stringify({ error: error.stack, errors, observations }, null, 2));
  throw error;
} finally {
  await browser.close();
}
