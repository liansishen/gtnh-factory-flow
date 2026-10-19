import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

/**
 * Exercise localized pickers, tab/share menus and settings in the real app.
 * Exported plans retain canonical settings and authored names across locale changes.
 */

const base = process.env.APP_URL ?? "http://127.0.0.1:17840";
const evidence = process.env.I18N_EVIDENCE_DIR;
if (!evidence) throw new Error("Set I18N_EVIDENCE_DIR to a private directory for screenshots and observations.");
await fs.mkdir(evidence, { recursive: true });

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const i18nDir = path.join(repoRoot, "src/lib/i18n");

// Catalog order matches the shipped translator.
const MESSAGE_FILES = [
  "messages-zh.json",
  "messages-secondary-zh.json",
  "messages-planner-zh.json",
  "messages-inventory-zh.json",
  "messages-runtime-zh.json",
  "messages-nonrecipe-zh.json",
  "messages-machine-settings-zh.json",
  "messages-menus-zh.json",
];
const normalize = (source) => source.trim().replace(/\s+/g, " ");
const catalog = new Map();
for (const file of MESSAGE_FILES) {
  const full = path.join(i18nDir, file);
  if (!existsSync(full)) continue;
  // Last spread wins, exactly as messages.ts merges the catalogs.
  for (const [key, value] of Object.entries(JSON.parse(readFileSync(full, "utf8")))) {
    catalog.set(normalize(key), String(value).trim());
  }
}

/** The Chinese the app should render for an English source string. */
function zh(source) {
  const value = catalog.get(normalize(source));
  assert.ok(
    value !== undefined,
    `missing zh-CN translation for ${JSON.stringify(source)} in src/lib/i18n/messages-*-zh.json`,
  );
  return value;
}

// The picker's groups, in the mod's column order (POWER_GROUPS in src/lib/power/registry.ts).
const GROUPS = [
  "Other",
  "Generators",
  "Engines",
  "Boilers and exchangers",
  "Turbines",
  "Reactors",
  "Solar",
  "Endgame",
];
const GROUP_ID = {
  Other: "other",
  Generators: "burners",
  Engines: "engines",
  "Boilers and exchangers": "steam",
  Turbines: "turbines",
  Reactors: "reactors",
  Solar: "passive",
  Endgame: "endgame",
};
const USER_NAME = "我的钢板厂";
const SECOND_NAME = "第二个方案";

const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(base).origin });
const externalRequests = [];
await context.route("**/*", (route) => {
  const url = new URL(route.request().url());
  if (url.origin === new URL(base).origin || !/^https?:$/.test(url.protocol)) return route.continue();
  externalRequests.push(url.origin + url.pathname);
  return route.abort("blockedbyclient");
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.stack ?? error.message));
const observations = [];

async function observe(label) {
  const size = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  assert.ok(size.scrollWidth <= size.width + 2, `${label}: horizontal page overflow`);
  observations.push({ label, size });
  await page.screenshot({ path: path.join(evidence, `${label}.png`), fullPage: true });
}

async function locale(target) {
  await page.locator('[data-mb="settings"]').click();
  await page.getByRole("tab", { name: /^(Language|语言)$/ }).click();
  await page.getByLabel("Language / 语言", { exact: true }).selectOption(target);
  await page.waitForFunction((value) => document.documentElement.lang === value, target);
  await page.keyboard.press("Escape");
}

const menu = () => page.locator("[data-mod-menu]").last();
const menuLabels = async () => (await menu().locator(".mm-label").allInnerTexts()).map((text) => text.trim());
const menuDetails = async () => (await menu().locator(".mm-detail").allInnerTexts()).map((text) => text.trim());

async function openMenuByLabel(source) {
  const row = menu().getByText(zh(source), { exact: true });
  await row.waitFor({ state: "visible" });
  await row.click();
}

async function expectText(locator, source, where) {
  const text = (await locator.innerText()).trim();
  assert.equal(text, zh(source), `${where}: ${JSON.stringify(text)} !== ${JSON.stringify(zh(source))}`);
}

async function exportPlan() {
  await page.locator('[data-mb="share"]').click();
  await menu().waitFor();
  const downloading = page.waitForEvent("download");
  await openMenuByLabel("Export plan file");
  const file = await (await downloading).path();
  const project = JSON.parse(await fs.readFile(file, "utf8"));
  await fs.rm(file);
  return project;
}

async function searchResource(query) {
  const input = page.getByRole("textbox", { name: /Search items and fluids|搜索物品和流体/ });
  // Clear to a known-empty answer first, so a stale list can never be picked from.
  await input.fill("zzzzzqpyn");
  await page.getByText(/^(No matching resource\.|没有匹配的资源。)$/, { exact: true }).waitFor({ timeout: 120000 });
  await input.fill(query);
  const results = page.getByRole("listbox", { name: /^(Resource results|资源搜索结果)$/ });
  const option = results.getByRole("option", { name: /^(Steel Plate|钢板)$/ }).first();
  await option.waitFor({ state: "visible", timeout: 120000 });
  await option.click();
  await page.locator('[data-recipe=""]').first().waitFor({ state: "visible", timeout: 120000 });
}

async function addFirstRecipe() {
  await page.locator('[data-recipe=""]').first().locator('[data-glyph="plus"]').click();
  const closeRecipe = page.getByRole("button", { name: /Close recipe search|关闭配方搜索/ });
  if (await closeRecipe.isVisible().catch(() => false)) await closeRecipe.click();
  await page.locator(".react-flow__node-recipeNode").first().waitFor({ state: "visible", timeout: 120000 });
}

/* ------------------------------------------------------------------ pickers */

async function pickerDesktop() {
  await page.locator('[data-mb="nonrecipe"]').click();
  const dialog = page.locator("[data-mod-power-picker]");
  await dialog.waitFor();
  assert.equal(await dialog.getAttribute("aria-label"), zh("Non-recipe machines"), "picker dialog label");
  await expectText(dialog.locator(".mp-title"), "NON-RECIPE MACHINES", "picker title");
  assert.equal(
    await dialog.locator(".mp-search").getAttribute("placeholder"),
    zh("Machine, fuel, or product..."),
    "picker search placeholder",
  );
  const keys = dialog.locator(".mp-head .ml-drop");
  assert.deepEqual((await keys.allInnerTexts()).map((t) => t.trim()), [zh("All types"), zh("All tiers")], "filter keys");

  // Group columns: every brass header must be a translated group name.
  const translatedGroups = GROUPS.map(zh);
  const headers = (await dialog.locator(".mp-brass span").allInnerTexts()).map((t) => t.trim());
  assert.ok(headers.length > 0, "picker lists group columns");
  for (const header of headers) {
    assert.ok(translatedGroups.includes(header), `group header ${JSON.stringify(header)} is not translated`);
  }

  // Type filter: the menu lists All types plus every group, all translated.
  await keys.nth(0).click();
  await menu().waitFor();
  assert.equal(await menu().getAttribute("aria-label"), zh("Type"), "type menu label");
  assert.deepEqual(await menuLabels(), [zh("All types"), ...GROUPS.map(zh)], "type menu rows");
  await page.keyboard.press("Escape");
  await menu().waitFor({ state: "hidden" });

  // Every group filter narrows to that one group, keeping the translated header.
  for (const group of GROUPS) {
    await keys.nth(0).click();
    await menu().waitFor();
    await openMenuByLabel(group);
    assert.equal((await keys.nth(0).innerText()).trim(), zh(group), `type key for ${group}`);
    const shown = (await dialog.locator(".mp-brass span").allInnerTexts()).map((t) => t.trim());
    assert.deepEqual(shown, [zh(group)], `only ${group} is shown`);
    assert.ok((await dialog.locator(".mp-tile").count()) > 0, `${group} has tiles`);
  }
  await keys.nth(0).click();
  await menu().waitFor();
  await openMenuByLabel("All types");
  await observe("picker-desktop-groups-zh");

  // Tier filter: All tiers plus the tiers the catalog holds; each narrows the tiles.
  await keys.nth(1).click();
  await menu().waitFor();
  assert.equal(await menu().getAttribute("aria-label"), zh("Tier"), "tier menu label");
  const tierLabels = await menuLabels();
  assert.equal(tierLabels[0], zh("All tiers"), "tier menu first row");
  const tiers = tierLabels.slice(1);
  assert.ok(tiers.length > 0, "tier menu lists tiers");
  await page.keyboard.press("Escape");
  await menu().waitFor({ state: "hidden" });
  for (const tier of tiers) {
    await keys.nth(1).click();
    await menu().waitFor();
    await openMenuByLabel(tier);
    assert.equal((await keys.nth(1).innerText()).trim(), tier, `tier key for ${tier}`);
    const tags = (await dialog.locator(".mp-tier").allInnerTexts()).map((t) => t.trim());
    assert.ok(tags.length > 0, `${tier} has tiles`);
    for (const tag of tags) assert.equal(tag, tier, `tier tag ${tag} under ${tier}`);
  }
  await keys.nth(1).click();
  await menu().waitFor();
  await openMenuByLabel("All tiers");

  // Search: English, Chinese and pinyin all find the same canonical machine.
  const search = dialog.locator(".mp-search");
  for (const query of ["Gas Turbine", "燃气涡轮", "ranqiwolun"]) {
    await search.fill(query);
    await dialog.locator('[data-source="gas-turbine"]').waitFor({ state: "visible", timeout: 30000 });
    const name = (await dialog.locator('[data-source="gas-turbine"] .mp-line').first().innerText()).trim();
    assert.match(name, /[\u3400-\u9fff]/, `machine name for ${query} is translated: ${name}`);
  }
  await observe("picker-desktop-search-zh");

  // Hover preview: the rested tile shows its translated kind, unlock tier and blurb.
  await search.fill("");
  const tile = dialog.locator('[data-source="gas-turbine"]').first();
  await tile.waitFor({ state: "visible" });
  await tile.hover();
  // The preview is a sibling of the sheet inside the backdrop, so it is not under [data-mod-power-picker].
  const preview = page.locator(".mp-preview");
  await preview.waitFor({ state: "visible", timeout: 5000 });
  assert.equal(
    (await preview.locator(".mp-preview-kind").innerText()).trim(),
    `${zh("Generators")}${zh(", unlocks at")} LV`,
    "preview kind and unlock tier",
  );
  await expectText(preview.locator(".mp-preview-blurb"), "Burns benzene and the other gas fuels.", "preview blurb");
  const previewName = (await preview.locator(".mp-preview-name").innerText()).trim();
  assert.match(previewName, /[\u3400-\u9fff]/, `preview name is translated: ${previewName}`);
  await observe("picker-desktop-preview-zh");

  // Empty search.
  await search.fill("zzzzzqpyn");
  await dialog.locator(".mp-none").waitFor({ state: "visible" });
  await expectText(dialog.locator(".mp-none"), "No machine burns, makes or is named that.", "picker empty");
  await observe("picker-desktop-empty-zh");
  await search.fill("");
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
}

async function pickerMobile() {
  await page.locator('[data-mb="nonrecipe"]').click();
  const sheet = page.getByRole("region", { name: /^(Power sources|电力来源)$/ });
  await sheet.waitFor();
  assert.equal(await sheet.getAttribute("aria-label"), zh("Power sources"), "overlay region label");
  assert.equal(
    await sheet.locator("input").first().getAttribute("placeholder"),
    zh("Machine, fuel, or product..."),
    "overlay search placeholder",
  );
  const groupSelect = sheet.getByRole("combobox", { name: zh("Power type") });
  const tierSelect = sheet.getByRole("combobox", { name: zh("Unlock tier") });
  const groupOptions = (await groupSelect.locator("option").allInnerTexts()).map((t) => t.trim());
  assert.deepEqual(groupOptions, [zh("All types"), ...GROUPS.map(zh)], "group options");
  const tierOptions = (await tierSelect.locator("option").allInnerTexts()).map((t) => t.trim());
  assert.equal(tierOptions[0], zh("All tiers"), "tier options first");

  // Every group filter keeps at least one machine and drops the others.
  for (const group of GROUPS) {
    await groupSelect.selectOption(GROUP_ID[group]);
    await sheet.locator("[data-source]").first().waitFor({ state: "visible", timeout: 15000 });
  }
  await groupSelect.selectOption("burners");
  await sheet.locator('[data-source="gas-turbine"]').waitFor({ state: "visible" });
  assert.equal(await sheet.locator('[data-source="railcraft-water-tank"]').count(), 0, "burners hides other");
  await groupSelect.selectOption("other");
  await sheet.locator('[data-source="railcraft-water-tank"]').waitFor({ state: "visible" });
  assert.equal(await sheet.locator('[data-source="gas-turbine"]').count(), 0, "other hides burners");
  await groupSelect.selectOption("all");

  // Every tier filter keeps the cards of that tier only.
  for (const tier of tierOptions.slice(1)) {
    await tierSelect.selectOption(tier);
    await sheet.locator("[data-source]").first().waitFor({ state: "visible", timeout: 15000 });
  }
  await tierSelect.selectOption("LV");
  await sheet.locator('[data-source="gas-turbine"]').waitFor({ state: "visible" });
  assert.equal(await sheet.locator('[data-source="large-gas-turbine"]').count(), 0, "LV hides EV machines");
  await groupSelect.selectOption("all");
  await tierSelect.selectOption("all");
  await observe("picker-mobile-filters-zh");

  // Search by English, Chinese and pinyin.
  const search = sheet.locator("input").first();
  for (const query of ["Gas Turbine", "燃气涡轮", "ranqiwolun"]) {
    await search.fill(query);
    await sheet.locator('[data-source="gas-turbine"]').waitFor({ state: "visible", timeout: 30000 });
  }
  // Empty.
  await search.fill("zzzzzqpyn");
  await sheet
    .getByText(zh("No power source matches. Machines are searched by name and by every fuel and product they can run on."))
    .waitFor({ state: "visible" });
  await observe("picker-mobile-empty-zh");
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "hidden" });
}

/* ------------------------------------------------------------- tabs + menus */

async function tabMenus() {
  // The + menu.
  await page.locator(".mt-plus").click();
  await menu().waitFor();
  assert.equal(await menu().getAttribute("aria-label"), zh("New plan"), "+ menu label");
  assert.deepEqual(
    await menuLabels(),
    [zh("New plan"), zh("Open a plan..."), zh("Open plan file..."), zh("Paste plan"), zh("Browse Community")],
    "+ menu rows",
  );
  assert.deepEqual(
    await menuDetails(),
    [zh("My plans"), ".json", zh("a plan link, code or file"), zh("public plans")],
    "+ menu details",
  );
  await observe("menu-plus-zh");
  await page.keyboard.press("Escape");
  await menu().waitFor({ state: "hidden" });

  // Rename the open plan to a user name, then add a second plan so Close rows appear.
  const firstTab = page.locator('[role="tab"][data-design-id]').first();
  await firstTab.focus();
  await page.keyboard.press("F2");
  const rename = firstTab.locator("input");
  await rename.fill(USER_NAME);
  await rename.press("Enter");
  await page.waitForFunction(
    (value) => document.querySelector('[role="tab"][data-design-id][data-active] .mt-name')?.textContent === value,
    USER_NAME,
  );

  await page.locator(".mt-plus").click();
  await menu().waitFor();
  await openMenuByLabel("New plan");
  await page.waitForFunction((count) => document.querySelectorAll('[role="tab"][data-design-id]').length > count, 1);
  const secondTab = page.locator('[role="tab"][data-design-id]').nth(1);
  await secondTab.focus();
  await page.keyboard.press("F2");
  await secondTab.locator("input").fill(SECOND_NAME);
  await secondTab.locator("input").press("Enter");
  await page.waitForFunction(
    (value) => document.querySelector('[role="tab"][data-design-id][data-active] .mt-name')?.textContent === value,
    SECOND_NAME,
  );

  // The tab context menu on the active plan: every row translated, the name kept verbatim.
  await page
    .locator('[role="tab"][data-design-id] .mt-name')
    .filter({ hasText: SECOND_NAME })
    .first()
    .click({ button: "right" });
  await menu().waitFor();
  assert.match(await menu().getAttribute("aria-label"), new RegExp(SECOND_NAME), "tab menu names the plan verbatim");
  const rows = await menuLabels();
  for (const source of ["Rename", "Copy plan code", "Post a copy to Community...", "Close tab", "Close other tabs", "Delete plan"]) {
    assert.ok(rows.includes(zh(source)), `tab menu row ${JSON.stringify(source)} missing from ${JSON.stringify(rows)}`);
  }
  await observe("menu-tab-zh");

  // Rename from the menu on the active plan keeps the user's words.
  await openMenuByLabel("Rename");
  const inline = page.locator('[role="tab"][data-design-id] input');
  await inline.fill(`${SECOND_NAME}二`);
  await inline.press("Enter");
  await page.waitForFunction(
    (value) => [...document.querySelectorAll('[role="tab"][data-design-id] .mt-name')].some((el) => el.textContent === value),
    `${SECOND_NAME}二`,
  );
  await page.waitForTimeout(800);

  // Delete plan asks first, keeping the name, then Keep it leaves it.
  await page
    .locator('[role="tab"][data-design-id] .mt-name')
    .filter({ hasText: `${SECOND_NAME}二` })
    .first()
    .click({ button: "right" });
  await menu().waitFor();
  await openMenuByLabel("Delete plan");
  await menu().waitFor();
  assert.match(await menu().locator(".mm-title").innerText(), new RegExp(`${SECOND_NAME}二`), "delete confirm keeps the name");
  assert.deepEqual(await menuLabels(), [zh("Delete it"), zh("Keep it")], "delete confirm rows");
  await openMenuByLabel("Keep it");
  await observe("menu-delete-confirm-zh");

  // Close the other tab; the renamed plan stays open and keeps its user name.
  await page
    .locator('[role="tab"][data-design-id] .mt-name')
    .filter({ hasText: USER_NAME })
    .first()
    .click({ button: "right" });
  await menu().waitFor();
  await openMenuByLabel("Close tab");
  await page.waitForFunction(() => document.querySelectorAll('[role="tab"][data-design-id]').length === 1);
  assert.equal(
    await page.locator('[role="tab"][data-design-id] .mt-name').first().innerText(),
    `${SECOND_NAME}二`,
    "the renamed tab stayed",
  );

  // Reopen the closed plan from the library: the user's name is preserved verbatim.
  await page.locator('[data-mb="plans"]').click();
  await page.locator("[data-mod-library] .ml-tile:not(.ml-new)").first().waitFor();
  await page
    .locator("[data-mod-library] .ml-tile:not(.ml-new)")
    .filter({ hasText: USER_NAME })
    .first()
    .click();
  await page.waitForFunction(
    (value) => [...document.querySelectorAll('[role="tab"][data-design-id] .mt-name')].some((el) => el.textContent === value),
    USER_NAME,
  );
  await observe("tab-reopened-zh");

  // Close other tabs leaves the one under the menu.
  await page
    .locator('[role="tab"][data-design-id] .mt-name')
    .filter({ hasText: USER_NAME })
    .first()
    .click({ button: "right" });
  await menu().waitFor();
  await openMenuByLabel("Close other tabs");
  await page.waitForFunction(() => document.querySelectorAll('[role="tab"][data-design-id]').length === 1);
  assert.equal(
    await page.locator('[role="tab"][data-design-id] .mt-name').first().innerText(),
    USER_NAME,
    "close other tabs kept the one under the menu",
  );
}

/* -------------------------------------------------------------------- share */

async function shareMenu() {
  await page.locator('[data-mb="share"]').click();
  await menu().waitFor();
  const rows = await menuLabels();
  for (const source of ["Copy plan link", "Copy plan code", "Export plan file", "Screenshot...", "Open in the game"]) {
    assert.ok(rows.includes(zh(source)), `share row ${JSON.stringify(source)} missing from ${JSON.stringify(rows)}`);
  }
  await observe("menu-share-zh");

  // Copy plan code reaches the clipboard and says so, in Chinese.
  await openMenuByLabel("Copy plan code");
  await page.locator(".rail-notice-text").filter({ hasText: zh("Copied the plan code.") }).first().waitFor();
  const code = await page.evaluate(() => navigator.clipboard.readText());
  assert.ok(code.length > 20, "the plan code reached the clipboard");
  await observe("share-copied-zh");

  // Put a recipe on the board so the export carries canonical resource ids.
  await searchResource("钢板");
  await addFirstRecipe();

  // Export plan file carries the user's name and canonical resource ids.
  await page.locator('[data-mb="share"]').click();
  await menu().waitFor();
  const downloading = page.waitForEvent("download");
  await openMenuByLabel("Export plan file");
  const file = await (await downloading).path();
  const exported = JSON.parse(await fs.readFile(file, "utf8"));
  await fs.rm(file);
  assert.equal(exported.name, USER_NAME, "the exported plan keeps the user's name");
  const resourceIds = exported.recipes.flatMap((recipe) => [...recipe.inputs, ...recipe.outputs]).map((resource) => resource.id);
  assert.ok(resourceIds.some((id) => /^[a-z0-9_.-]+:/.test(id)), `exported plan keeps canonical resource ids: ${resourceIds.slice(0, 3)}`);
  observations.push({ label: "share-export", name: exported.name, resources: resourceIds.slice(0, 4) });

  // The signed-out account state is translated and the live-only row is absent.
  assert.equal((await page.locator('[data-mb="account"]').innerText()).trim(), zh("Sign in"), "account key signed out");
  assert.ok(!rows.includes(zh("Invite people...")), "no Invite row without live plans");
  await page.locator('[data-mb="account"]').click();
  const signIn = page.getByRole("dialog", { name: zh("Sign in") });
  await signIn.waitFor();
  const signInText = await signIn.innerText();
  for (const source of ["Sign in", "Username", "Password"]) {
    assert.ok(signInText.includes(zh(source)), `sign-in panel shows ${JSON.stringify(zh(source))}`);
  }
  await observe("account-signed-out-zh");
  await page.keyboard.press("Escape");
  await signIn.waitFor({ state: "hidden" });
}

/* --------------------------------------------------------- machine settings */

async function settingsSheet() {
  // A plain recipe card: the sheet's chrome and its formulas are translated.
  await searchResource("钢板");
  await addFirstRecipe();
  const recipeCard = page.locator(".react-flow__node-recipeNode").first();
  await recipeCard.locator('[data-glyph="gear"]').click();
  const sheet = page.locator("[data-cc-sheet]").first();
  await sheet.waitFor();
  const titles = (await sheet.locator(".cs-title").allInnerTexts()).map((t) => t.trim());
  assert.ok(titles.includes(zh("Settings")), `settings sheet has ${JSON.stringify(zh("Settings"))}`);
  assert.ok(titles.includes(zh("Formulas")), `settings sheet has ${JSON.stringify(zh("Formulas"))}`);
  const formulaLabels = (await sheet.locator(".cs-f-label").allInnerTexts()).map((t) => t.trim());
  for (const source of ["supply", "overclocks", "time", "recipes"]) {
    assert.ok(formulaLabels.includes(zh(source)), `formula row ${JSON.stringify(source)} is translated`);
  }
  if ((await sheet.locator(".cs-row").count()) > 0) {
    await expectText(
      sheet.locator(".cs-foot"),
      "Pinned settings show on the card. Click, right-click or scroll to change.",
      "settings sheet foot",
    );
  } else {
    await expectText(sheet.locator(".cs-none"), "No settings for this machine.", "settings sheet empty");
  }
  await observe("machine-settings-recipe-zh");
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "hidden" });

  // A generator's sheet: pick a canonical fuel and prove the export stores it.
  await page.locator('[data-mb="nonrecipe"]').click();
  const picker = page.locator("[data-mod-power-picker]");
  await picker.waitFor();
  await picker.locator(".mp-search").fill("ranqiwolun");
  await picker.locator('[data-source="gas-turbine"]').first().click();
  await picker.waitFor({ state: "hidden" });
  const generator = page.locator(".react-flow__node-recipeNode").last();
  await generator.waitFor();
  await generator.locator('[data-glyph="gear"]').click();
  const genSheet = page.locator("[data-cc-sheet]").first();
  await genSheet.waitFor();
  const genTitles = (await genSheet.locator(".cs-title").allInnerTexts()).map((t) => t.trim());
  assert.ok(genTitles.includes(zh("Settings")), "generator sheet is titled Settings");
  // The fuel row's list: its filter placeholder, its empty state and the canonical pick.
  const fuelRow = genSheet.locator(".cs-row").filter({ hasText: zh("Fuel") }).first();
  await fuelRow.locator(".cs-well").click();
  const optionMenu = page.locator("[role=menu]").last();
  await optionMenu.waitFor();
  const filter = optionMenu.locator("input.cm-filter");
  assert.equal(await filter.getAttribute("placeholder"), zh("Filter..."), "option list filter placeholder");
  await filter.fill("zzzzzqpyn");
  await optionMenu.locator(".cm-empty").waitFor({ state: "visible" });
  await expectText(optionMenu.locator(".cm-empty"), "Nothing matches.", "option list empty");
  await filter.fill("");
  const fuelOption = optionMenu.getByRole("menuitem").filter({ hasText: "硝基苯" }).first();
  await fuelOption.waitFor({ state: "visible" });
  await fuelOption.click();
  await observe("machine-settings-generator-zh");
  await page.keyboard.press("Escape");
  await genSheet.waitFor({ state: "hidden" });

  const exported = await exportPlan();
  const recipe = exported.recipes.find((entry) => entry.power?.sourceId === "gas-turbine");
  assert.ok(recipe, "the generator recipe is in the export");
  const node = exported.nodes.find((entry) => entry.recipeId === recipe.id);
  assert.equal(node?.machineConfigTiers?.fuel, "Nitrobenzene", "the canonical fuel key was saved");
  observations.push({ label: "settings-export", fuel: node?.machineConfigTiers?.fuel });
}

/* ------------------------------------------------------------------- mobile */

async function mobileLibraryMenus() {
  await page.locator('[data-mb="plans"]').click();
  await page.waitForTimeout(400);
  const tile = page.locator('[role="button"]').filter({ hasText: USER_NAME }).first();
  await tile.waitFor();
  await tile.click({ button: "right" });
  await page.getByRole("menu").first().waitFor();
  const rows = await page.getByRole("menu").first().locator("button, [role=menuitem]").allInnerTexts();
  const flat = rows.map((text) => text.trim());
  for (const source of ["Rename", "Duplicate"]) {
    assert.ok(flat.some((row) => row === zh(source)), `library tile menu shows ${JSON.stringify(zh(source))}: ${JSON.stringify(flat)}`);
  }
  await observe("library-tile-menu-mobile-zh");

  // Duplicate makes a second tab that keeps the user's name.
  const before = await page.locator('[role="tab"][data-design-id]').count();
  await page.getByRole("menu").first().getByText(zh("Duplicate"), { exact: true }).click();
  await page.waitForFunction(
    (count) => document.querySelectorAll('[role="tab"][data-design-id]').length > count,
    before,
    { timeout: 30000 },
  );
  assert.ok(
    await page.locator('[role="tab"][data-design-id] .mt-name').filter({ hasText: USER_NAME }).first().isVisible(),
    "the duplicate keeps the user's name",
  );
  await observe("library-duplicate-mobile-zh");
}

async function mobileShare() {
  await page.locator('[data-mb="share"]').click();
  await menu().waitFor();
  const rows = await menuLabels();
  for (const source of ["Copy plan link", "Copy plan code", "Export plan file"]) {
    assert.ok(rows.includes(zh(source)), `mobile share row ${JSON.stringify(source)}`);
  }
  await observe("menu-share-mobile-zh");
  await page.keyboard.press("Escape");
  await menu().waitFor({ state: "hidden" });
}

async function mobileSettingsSheet() {
  // Leave the library, then the same sheet a recipe card opens on a phone. The
  // board is virtualized, so add a fresh card from the items drawer and open its
  // own gear, which is on screen right after the add.
  if (!(await page.locator(".react-flow").first().isVisible().catch(() => false))) {
    await page.locator('[data-mb="plans"]').click();
  }
  await page.locator('[data-mb="drawer-items"]').click();
  await searchResource("钢板");
  await addFirstRecipe();
  const card = page.locator(".react-flow__node-recipeNode").last();
  await card.locator('[data-glyph="gear"]').click();
  const sheet = page.locator("[data-cc-sheet]").first();
  await sheet.waitFor();
  const titles = (await sheet.locator(".cs-title").allInnerTexts()).map((text) => text.trim());
  assert.ok(titles.includes(zh("Settings")), `mobile settings sheet has ${JSON.stringify(zh("Settings"))}`);
  await observe("machine-settings-mobile-zh");
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "hidden" });
}

/* --------------------------------------------------------------------- run */

try {
  const root = await page.goto(base, { waitUntil: "load", timeout: 120000 });
  assert.equal(root.status(), 200);
  await page.getByRole("button", { name: "Dismiss", exact: true }).waitFor({ state: "visible", timeout: 30000 });
  await page.getByRole("button", { name: "Dismiss", exact: true }).click();
  await page.getByRole("button", { name: "New design", exact: true }).click();
  await locale("zh-CN");
  await observe("board-desktop-zh");

  await pickerDesktop();
  await tabMenus();
  await shareMenu();
  await settingsSheet();

  // English restores the source strings on the same surfaces.
  await locale("en");
  await page.locator('[data-mb="nonrecipe"]').click();
  const dialog = page.locator("[data-mod-power-picker]");
  await dialog.waitFor();
  assert.equal(await dialog.locator(".mp-title").innerText(), "NON-RECIPE MACHINES", "picker title in English");
  assert.deepEqual(
    (await dialog.locator(".mp-head .ml-drop").allInnerTexts()).map((t) => t.trim()),
    ["All types", "All tiers"],
    "filter keys in English",
  );
  await page.keyboard.press("Escape");
  await locale("zh-CN");

  // Phone: the overlay picker, the library menus, Share and the settings sheet.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await observe("board-mobile-zh");
  await pickerMobile();
  await mobileLibraryMenus();
  await mobileShare();
  await mobileSettingsSheet();

  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.deepEqual(errors, [], "real application page errors");
  observations.push({
    label: "passed",
    pageErrors: errors,
    blockedExternalRequests: externalRequests,
    scope:
      "desktop/mobile non-recipe picker (group, type and tier filters, zh/en/pinyin search, hover preview, empty), tab + and context menus (rename, duplicate, close, delete, user names preserved), Share menu (copy link/code, export, signed-out account), machine settings sheet on desktop and phone (chrome, formulas, canonical fuel pick + export); all cross-origin browser requests blocked",
  });
  await fs.writeFile(path.join(evidence, "observations.json"), JSON.stringify(observations, null, 2));
  console.log(JSON.stringify({ result: "PASS", observations: observations.length, pageErrors: errors.length }));
} catch (error) {
  await observe("failure").catch(() => {});
  await fs.writeFile(path.join(evidence, "observations.json"), JSON.stringify({ error: error.stack, errors, observations }, null, 2));
  throw error;
} finally {
  await browser.close();
}
