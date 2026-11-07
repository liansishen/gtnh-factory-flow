import { readFileSync } from "node:fs";
import path from "node:path";
interface SqliteDatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number | bigint };
  };
  close(): void;
}
const { DatabaseSync } = (
  process as unknown as { getBuiltinModule: (id: string) => unknown }
).getBuiltinModule("node:sqlite") as {
  DatabaseSync: new (location: string) => SqliteDatabaseSync;
};
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { GET as getMe } from "@/app/api/community/auth/me/route";
import { POST as postLogin } from "@/app/api/community/auth/login/route";
import { POST as postRegister } from "@/app/api/community/auth/register/route";
import { GET as getLibrary } from "@/app/api/library/route";
import { PUT as putDesign } from "@/app/api/library/designs/[designId]/route";
import { PROJECT_SCHEMA_VERSION } from "@/lib/model/types";
import {
  setCloudflareRuntimeBindings,
  type D1DatabaseLike,
  type D1PreparedStatementLike,
} from "../dataset-storage";
import { createD1PostgrestHandler } from "./d1-postgrest";
import type { PostgrestHandler } from "./postgrest";

function createNodeSqliteD1Adapter(sqlite: SqliteDatabaseSync): D1DatabaseLike {
  const bindValues = (values: unknown[]) =>
    values.map((v) => {
      if (v === undefined) return null;
      if (typeof v === "boolean") return v ? 1 : 0;
      return v as string | number | bigint | Uint8Array | null;
    });

  return {
    prepare(query: string): D1PreparedStatementLike {
      let bound: unknown[] = [];
      const stmt: D1PreparedStatementLike = {
        bind(...values: unknown[]) {
          bound = values;
          return stmt;
        },
        async all<T = Record<string, unknown>>() {
          const prepared = sqlite.prepare(query);
          const rows = prepared.all(...bindValues(bound)) as T[];
          return { results: rows };
        },
        async first<T = Record<string, unknown>>() {
          const prepared = sqlite.prepare(query);
          const row = prepared.get(...bindValues(bound)) as T | undefined;
          return row ?? null;
        },
        async run() {
          const prepared = sqlite.prepare(query);
          const info = prepared.run(...bindValues(bound));
          return { success: true, meta: { changes: Number(info.changes) } };
        },
      };
      return stmt;
    },
    async exec(query: string) {
      sqlite.exec(query);
    },
  };
}

let sqlite: SqliteDatabaseSync;
let d1: D1DatabaseLike;
let handle: PostgrestHandler;
let db: SupabaseClient;

beforeAll(() => {
  sqlite = new DatabaseSync(":memory:");
  const schemaSql = readFileSync(path.join(process.cwd(), "supabase", "d1-schema.sql"), "utf8");
  sqlite.exec(schemaSql);
  d1 = createNodeSqliteD1Adapter(sqlite);
  handle = createD1PostgrestHandler(d1);
  db = createClient("http://d1-db.test", "key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => handle(new Request(input, init)) },
  });
});

afterEach(() => {
  setCloudflareRuntimeBindings(undefined);
});

afterAll(() => {
  sqlite?.close();
});

async function makeUser(username: string): Promise<string> {
  const { data, error } = await db
    .from("community_users")
    .insert({ username, password_hash: "salt:hash" })
    .select("id,username")
    .single();
  expect(error).toBeNull();
  return (data as { id: string }).id;
}

describe("Cloudflare D1 (SQLite) PostgREST adapter", () => {
  it("inserts, reads one row back, and answers no row as maybeSingle does", async () => {
    const id = await makeUser("alice_d1");
    const { data } = await db
      .from("community_users")
      .select("id,username,is_admin")
      .eq("id", id)
      .single();
    expect(data).toEqual({ id, username: "alice_d1", is_admin: false });

    const missing = await db
      .from("community_users")
      .select("id")
      .eq("id", "00000000-0000-4000-8000-000000000000")
      .maybeSingle();
    expect(missing).toMatchObject({ data: null, error: null });

    const single = await db
      .from("community_users")
      .select("id")
      .eq("id", "00000000-0000-4000-8000-000000000000")
      .single();
    expect(single.error?.code).toBe("PGRST116");
  });

  it("refuses a duplicate with Postgres's code and PostgREST's status", async () => {
    await makeUser("bob_d1");
    const { error, status } = await db
      .from("community_users")
      .insert({ username: "bob_d1", password_hash: "x" });
    expect(status).toBe(409);
    expect(error?.code).toBe("23505");
  });

  it("counts with head and a time window (rate limits)", async () => {
    await db.from("community_events").insert([
      { actor_key: "k_d1", action: "save" },
      { actor_key: "k_d1", action: "save" },
      { actor_key: "k_d1", action: "other" },
    ]);
    const since = new Date(Date.now() - 60_000).toISOString();
    const { count, data } = await db
      .from("community_events")
      .select("id", { count: "exact", head: true })
      .eq("actor_key", "k_d1")
      .eq("action", "save")
      .gte("created_at", since);
    expect(count).toBe(2);
    expect(data).toBeNull();
  });

  it("writes and reads library designs: jsonb, timestamps, update, tombstone filter", async () => {
    const userId = await makeUser("carol_d1");
    const plan = { schemaVersion: 1, nodes: [{ id: "n1", gtnhplanner: { v: 1 } }], ratio: 1.5 };
    const stamp = "2026-10-14T12:00:00.000Z";
    const inserted = await db
      .from("library_designs")
      .insert({
        user_id: userId,
        id: "design-1",
        name: "Steel",
        plan,
        created_at: stamp,
        updated_at: stamp,
        plan_updated_at: stamp,
        deleted_at: null,
      })
      .select("id,name,updated_at,deleted_at")
      .single();
    expect(inserted.data).toEqual({
      id: "design-1",
      name: "Steel",
      updated_at: "2026-10-14T12:00:00+00:00",
      deleted_at: null,
    });

    const read = await db
      .from("library_designs")
      .select("id,plan")
      .eq("user_id", userId)
      .eq("id", "design-1")
      .maybeSingle();
    expect((read.data as { plan: unknown }).plan).toEqual(plan);

    const updated = await db
      .from("library_designs")
      .update({ name: "Steel 2", favorite: true })
      .eq("user_id", userId)
      .eq("id", "design-1")
      .select("name,favorite")
      .single();
    expect(updated.data).toEqual({ name: "Steel 2", favorite: true });

    const { count } = await db
      .from("library_designs")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("deleted_at", null);
    expect(count).toBe(1);
  });

  it("upserts on a named conflict target and supports JSON contains, ilike, and nulls last", async () => {
    const userId = await makeUser("erin_d1");
    const row = { user_id: userId, id: "folder-1", name: "Ores", deleted_at: null };
    await db.from("library_folders").upsert(row, { onConflict: "user_id,id" });
    const again = await db
      .from("library_folders")
      .upsert({ ...row, name: "Ores 2" }, { onConflict: "user_id,id" })
      .select("id,name")
      .single();
    expect(again.data).toEqual({ id: "folder-1", name: "Ores 2" });

    const base = {
      uploader_key: "u",
      user_id: userId,
      author_name: "erin_d1",
      plan: {},
      description: "",
      tags: [],
      tags_text: "",
      is_public: true,
      last_activity_at: null,
    };
    const inserted = await db.from("community_plans").insert([
      {
        ...base,
        name: "Oil cracking",
        tags: ["oil"],
        tags_text: "oil",
        outputs: [{ kind: "fluid", resourceId: "diesel", rate: 2 }],
        highest_tier_index: 3,
        last_activity_at: "2026-10-01T00:00:00Z",
      },
      {
        ...base,
        name: "Steel line",
        tags_text: "metal",
        outputs: [],
        highest_tier_index: 1,
        is_public: false,
      },
      {
        ...base,
        name: "Diesel power",
        description: "oil to EU",
        outputs: [{ kind: "fluid", resourceId: "diesel", rate: 9 }],
        highest_tier_index: 2,
      },
    ]);
    expect(inserted.error).toBeNull();

    const term = "oil";
    const { data, count } = await db
      .from("community_plans")
      .select("id,name,last_activity_at", { count: "exact" })
      .or(`name.ilike.%${term}%,description.ilike.%${term}%,tags_text.ilike.%${term}%`)
      .lte("highest_tier_index", 3)
      .contains("outputs", JSON.stringify([{ kind: "fluid", resourceId: "diesel" }]))
      .eq("is_public", true)
      .order("last_activity_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .range(0, 0);
    expect(count).toBe(2);
    expect((data as Array<{ name: string }>).map((r) => r.name)).toEqual(["Oil cracking"]);
  });

  it("supports end-to-end account registration, login, session check, and cloud library CRUD via D1 binding", async () => {
    setCloudflareRuntimeBindings({ DB: d1 });

    const regResponse = await postRegister(
      new Request("https://plan.playgtnh.dpdns.org/api/community/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "d1player", password: "password123" }),
      }),
    );
    expect(regResponse.status).toBe(201);
    const regBody = (await regResponse.json()) as { username: string; isAdmin: boolean };
    expect(regBody.username).toBe("d1player");
    const cookieHeader = regResponse.headers.get("set-cookie");
    expect(cookieHeader).toBeTruthy();
    const sessionCookie = cookieHeader!.split(";")[0]!;

    // Verify login endpoint with the same credentials
    const loginResponse = await postLogin(
      new Request("https://plan.playgtnh.dpdns.org/api/community/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "d1player", password: "password123" }),
      }),
    );
    expect(loginResponse.status).toBe(200);

    // Verify /api/community/auth/me
    const meResponse = await getMe(
      new Request("https://plan.playgtnh.dpdns.org/api/community/auth/me", {
        headers: { Cookie: sessionCookie },
      }),
    );
    expect(meResponse.status).toBe(200);
    const meBody = (await meResponse.json()) as { user: { username: string } };
    expect(meBody.user.username).toBe("d1player");

    // Save a cloud design via /api/library/designs/[designId]
    const stamp = "2026-10-20T10:00:00.000Z";
    const putResponse = await putDesign(
      new Request("https://plan.playgtnh.dpdns.org/api/library/designs/d1-design-1", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Cookie: sessionCookie,
        },
        body: JSON.stringify({
          name: "D1 Cloud Factory",
          plan: {
            schemaVersion: PROJECT_SCHEMA_VERSION,
            id: "plan-d1-1",
            name: "D1 Cloud Factory",
            recipes: [],
            nodes: [],
            storages: [],
            edges: [],
            fuelProfiles: [],
            tasks: [],
          },
          createdAt: stamp,
          updatedAt: stamp,
          planUpdatedAt: stamp,
        }),
      }),
      { params: Promise.resolve({ designId: "d1-design-1" }) },
    );
    expect(putResponse.status).toBe(200);

    // List library via /api/library
    const libResponse = await getLibrary(
      new Request("https://plan.playgtnh.dpdns.org/api/library", {
        headers: { Cookie: sessionCookie },
      }),
    );
    expect(libResponse.status).toBe(200);
    const libBody = (await libResponse.json()) as {
      designs: Array<{ id: string; name: string }>;
    };
    expect(libBody.designs).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "d1-design-1", name: "D1 Cloud Factory" })]),
    );

    // Save and read back a >100 KB plan exercising d1_json_chunks splitting & reassembly
    const largePlan = {
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: "plan-large",
      name: "Large Platline",
      recipes: [],
      nodes: [],
      storages: [],
      edges: [],
      fuelProfiles: [],
      tasks: Array.from({ length: 1200 }, (_, i) => ({
        id: `t-${i}`,
        title: `Task ${i} ${"x".repeat(80)}`,
        status: "todo" as const,
        order: `a${i}`,
      })),
    };
    const largeUserId = await makeUser("large_user");
    const insertedLarge = await db
      .from("library_designs")
      .insert({
        user_id: largeUserId,
        id: "large-design-1",
        name: "Large Platline",
        plan: largePlan,
        created_at: stamp,
        updated_at: stamp,
        plan_updated_at: stamp,
      })
      .select("id,plan")
      .single();
    expect(insertedLarge.error).toBeNull();
    expect((insertedLarge.data as { plan: typeof largePlan }).plan.tasks.length).toBe(1200);
  });
});
