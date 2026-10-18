import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadBiodieselDemoProject } from "@/examples";
import { parseFactoryProjectJson, serializeFactoryProject } from "@/lib/import-export/factory-json";
import type { FactoryProject } from "@/lib/model/types";
import { useFactoryStore } from "@/store/factory-store";
import { translateGameName } from "./game-names";
import { LOCALE_STORAGE_KEY, getLocale, setLocale, subscribeLocale, type Locale } from "./locale";

/*
 * The locale is a device preference (`locale.ts`): it lives in localStorage
 * under its own key and never in a plan. These tests pin the consequence that
 * matters to a player: switching language cannot change a plan. They run the
 * real store load path, the real JSON import/export and the real solver
 * (`lastResult`), not a stand-in.
 *
 * Node has no window, so a minimal one is installed for the file: a
 * localStorage map and a storage-event listener set, exactly what locale.ts
 * touches.
 */
const storedValues = new Map<string, string>();
const storageListeners = new Set<(event: StorageEvent) => void>();

const fakeWindow = {
  localStorage: {
    getItem: (key: string) => storedValues.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storedValues.set(key, value);
    },
    removeItem: (key: string) => {
      storedValues.delete(key);
    },
  },
  addEventListener: (type: string, listener: (event: StorageEvent) => void) => {
    if (type === "storage") {
      storageListeners.add(listener);
    }
  },
  removeEventListener: (type: string, listener: (event: StorageEvent) => void) => {
    storageListeners.delete(listener);
  },
};

beforeAll(() => {
  Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true, writable: true });
});

afterAll(() => {
  delete (globalThis as { window?: unknown }).window;
});

/** The identity a plan is addressed by: nothing a language may touch. */
function canonicalIds(project: FactoryProject) {
  return {
    projectId: project.id,
    recipes: project.recipes.map((recipe) => recipe.id),
    nodes: project.nodes.map((node) => node.id),
    storages: (project.storages ?? []).map((storage) => storage.id),
    edges: project.edges.map((edge) => edge.id),
    resources: project.recipes.flatMap((recipe) =>
      [...recipe.inputs, ...recipe.outputs].map((resource) => `${resource.kind}:${resource.id}`),
    ),
  };
}

describe("the locale is a device preference", () => {
  beforeEach(() => {
    storedValues.clear();
    setLocale("en");
  });

  it("keeps the choice under its own key and never writes a plan", () => {
    const seen: Locale[] = [];
    const unsubscribe = subscribeLocale(() => seen.push(getLocale()));

    setLocale("zh-CN");
    expect(storedValues.get(LOCALE_STORAGE_KEY)).toBe("zh-CN");
    expect(getLocale()).toBe("zh-CN");
    expect(seen).toContain("zh-CN");

    // The default carries no stored entry, so a fresh profile and a reset one match.
    setLocale("en");
    expect(storedValues.has(LOCALE_STORAGE_KEY)).toBe(false);
    expect(getLocale()).toBe("en");

    unsubscribe();
  });
});

describe("a locale change never edits the open plan", () => {
  beforeEach(() => {
    storedValues.clear();
    setLocale("en");
    useFactoryStore.getState().markHydratedProject(loadBiodieselDemoProject());
  });

  afterEach(() => {
    setLocale("en");
  });

  it("leaves the project, its graph and the solved books the same objects", () => {
    const before = useFactoryStore.getState();
    setLocale("zh-CN");
    const after = useFactoryStore.getState();

    expect(after.project).toBe(before.project);
    expect(after.project.nodes).toBe(before.project.nodes);
    expect(after.project.edges).toBe(before.project.edges);
    expect(after.project.recipes).toBe(before.project.recipes);
    expect(after.project.storages).toBe(before.project.storages);
    expect(after.lastResult).toBe(before.lastResult);
    expect(after.undoHistory).toEqual([]);
    expect(after.redoHistory).toEqual([]);
  });

  it("serializes the plan byte for byte the same in either language", () => {
    const before = serializeFactoryProject(useFactoryStore.getState().project);
    const ids = canonicalIds(useFactoryStore.getState().project);

    setLocale("zh-CN");

    expect(serializeFactoryProject(useFactoryStore.getState().project)).toBe(before);
    expect(canonicalIds(useFactoryStore.getState().project)).toEqual(ids);
  });

  it("re-solves to the same numbers in either language", () => {
    const englishBooks = useFactoryStore.getState().lastResult;

    setLocale("zh-CN");
    useFactoryStore.getState().markHydratedProject(loadBiodieselDemoProject());

    // The solver is language-blind: a fresh solve under zh-CN equals the en one.
    expect(useFactoryStore.getState().lastResult).toEqual(englishBooks);
  });
});

describe("import and export are language-blind", () => {
  beforeEach(() => {
    storedValues.clear();
    setLocale("en");
  });

  afterEach(() => {
    setLocale("en");
  });

  it("parses the same plan to the same canonical ids under either locale", () => {
    const source = serializeFactoryProject(loadBiodieselDemoProject());

    setLocale("en");
    const english = parseFactoryProjectJson(source);
    setLocale("zh-CN");
    const chinese = parseFactoryProjectJson(source);

    expect(serializeFactoryProject(chinese)).toBe(serializeFactoryProject(english));
    expect(canonicalIds(chinese)).toEqual(canonicalIds(english));
  });

  it("keeps a player's name and note through a locale change and a save/import", () => {
    useFactoryStore.getState().markHydratedProject(loadBiodieselDemoProject());
    const store = useFactoryStore.getState();
    store.renameProject("My salt line");
    store.addAnnotation({
      kind: "text",
      text: "Salt loop",
      position: { x: 100, y: 100 },
      size: { width: 200, height: 80 },
    });

    const before = serializeFactoryProject(useFactoryStore.getState().project);
    expect(before).toContain("My salt line");
    expect(before).toContain("Salt loop");

    setLocale("zh-CN");
    const after = serializeFactoryProject(useFactoryStore.getState().project);
    expect(after).toBe(before);

    const imported = parseFactoryProjectJson(after);
    expect(imported.name).toBe("My salt line");
    expect(imported.annotations?.[0]?.text).toBe("Salt loop");
  });
});

describe("the game-name engine is a pure lookup", () => {
  it("translates a display name without touching the stored resource id", () => {
    useFactoryStore.getState().markHydratedProject(loadBiodieselDemoProject());
    const project = useFactoryStore.getState().project;
    const output = project.recipes[0].outputs[0];
    const before = serializeFactoryProject(project);

    const translated = translateGameName(output.displayName ?? output.id, "zh-CN");
    expect(translated).not.toBe(output.displayName);

    // The lookup returns a string; it never rewrites the plan it was read from.
    expect(project.recipes[0].outputs[0].id).toBe(output.id);
    expect(project.recipes[0].outputs[0].displayName).toBe(output.displayName);
    expect(serializeFactoryProject(project)).toBe(before);
  });

  it("returns English unchanged and answers a real label from the dictionary", () => {
    expect(translateGameName("Fish", "en")).toBe("Fish");
    expect(translateGameName("Steel Plate", "zh-CN")).toBe("钢板");
  });
});
