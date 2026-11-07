import type { D1DatabaseLike } from "../dataset-storage";
import type { PostgrestHandler, PostgrestHandlerOptions } from "./postgrest";

type ColumnKind = "uuid" | "text" | "boolean" | "integer" | "real" | "jsonb" | "timestamptz";

interface D1ColumnSpec {
  kind: ColumnKind;
  generated?: boolean;
  defaultUuid?: boolean;
  defaultNow?: boolean;
  defaultValue?: unknown;
}

interface D1TableSpec {
  columns: Map<string, D1ColumnSpec>;
  primaryKey: string[];
}

const KNOWN_TABLES: Record<
  string,
  {
    primaryKey: string[];
    columns: Record<string, D1ColumnSpec>;
  }
> = {
  community_users: {
    primaryKey: ["id"],
    columns: {
      id: { kind: "uuid", defaultUuid: true },
      username: { kind: "text" },
      password_hash: { kind: "text" },
      is_admin: { kind: "boolean", defaultValue: 0 },
      created_at: { kind: "timestamptz", defaultNow: true },
    },
  },
  community_plans: {
    primaryKey: ["id"],
    columns: {
      id: { kind: "uuid", defaultUuid: true },
      name: { kind: "text" },
      description: { kind: "text", defaultValue: "" },
      game_version: { kind: "text", defaultValue: "" },
      dataset_version: { kind: "text", defaultValue: "" },
      plan: { kind: "jsonb" },
      thumbnail_data_url: { kind: "text", defaultValue: null },
      needs: { kind: "jsonb", defaultValue: "[]" },
      outputs: { kind: "jsonb", defaultValue: "[]" },
      total_eu_t: { kind: "real", defaultValue: 0 },
      machine_count: { kind: "integer", defaultValue: 0 },
      node_count: { kind: "integer", defaultValue: 0 },
      storage_count: { kind: "integer", defaultValue: 0 },
      edge_count: { kind: "integer", defaultValue: 0 },
      highest_tier: { kind: "text", defaultValue: null },
      highest_tier_index: { kind: "integer", defaultValue: -1 },
      upvotes: { kind: "integer", defaultValue: 0 },
      downvotes: { kind: "integer", defaultValue: 0 },
      score: { kind: "integer", generated: true },
      downloads: { kind: "integer", defaultValue: 0 },
      views: { kind: "integer", defaultValue: 0 },
      uploader_key: { kind: "text" },
      user_id: { kind: "uuid", defaultValue: null },
      author_name: { kind: "text", defaultValue: "" },
      created_at: { kind: "timestamptz", defaultNow: true },
      updated_at: { kind: "timestamptz", defaultNow: true },
      tags: { kind: "jsonb", defaultValue: "[]" },
      tags_text: { kind: "text", defaultValue: "" },
      is_public: { kind: "boolean", defaultValue: 1 },
      icon: { kind: "jsonb", defaultValue: null },
      stats_version: { kind: "text", defaultValue: "" },
      comment_count: { kind: "integer", defaultValue: 0 },
      last_comment_at: { kind: "timestamptz", defaultValue: null },
      last_activity_at: { kind: "timestamptz", defaultValue: null },
    },
  },
  community_votes: {
    primaryKey: ["plan_id", "voter_key"],
    columns: {
      plan_id: { kind: "uuid" },
      voter_key: { kind: "text" },
      value: { kind: "integer" },
      created_at: { kind: "timestamptz", defaultNow: true },
      user_id: { kind: "uuid", defaultValue: null },
    },
  },
  community_events: {
    primaryKey: ["id"],
    columns: {
      id: { kind: "integer", generated: true },
      actor_key: { kind: "text" },
      action: { kind: "text" },
      created_at: { kind: "timestamptz", defaultNow: true },
    },
  },
  blueprints: {
    primaryKey: ["id"],
    columns: {
      id: { kind: "uuid", defaultUuid: true },
      user_id: { kind: "uuid" },
      name: { kind: "text" },
      payload: { kind: "jsonb" },
      node_count: { kind: "integer", defaultValue: 0 },
      storage_count: { kind: "integer", defaultValue: 0 },
      edge_count: { kind: "integer", defaultValue: 0 },
      pocket_count: { kind: "integer", defaultValue: 0 },
      machine_count: { kind: "integer", defaultValue: 0 },
      is_public: { kind: "boolean", defaultValue: 0 },
      description: { kind: "text", defaultValue: "" },
      author_name: { kind: "text", defaultValue: "" },
      published_at: { kind: "timestamptz", defaultValue: null },
      needs: { kind: "jsonb", defaultValue: "[]" },
      outputs: { kind: "jsonb", defaultValue: "[]" },
      tags: { kind: "jsonb", defaultValue: "[]" },
      tags_text: { kind: "text", defaultValue: "" },
      upvotes: { kind: "integer", defaultValue: 0 },
      downvotes: { kind: "integer", defaultValue: 0 },
      score: { kind: "integer", generated: true },
      downloads: { kind: "integer", defaultValue: 0 },
      created_at: { kind: "timestamptz", defaultNow: true },
      icon: { kind: "jsonb", defaultValue: null },
      highest_tier: { kind: "text", defaultValue: null },
      highest_tier_index: { kind: "integer", defaultValue: -1 },
    },
  },
  blueprint_votes: {
    primaryKey: ["blueprint_id", "voter_key"],
    columns: {
      blueprint_id: { kind: "uuid" },
      voter_key: { kind: "text" },
      value: { kind: "integer" },
      created_at: { kind: "timestamptz", defaultNow: true },
    },
  },
  library_folders: {
    primaryKey: ["user_id", "id"],
    columns: {
      user_id: { kind: "uuid" },
      id: { kind: "text" },
      name: { kind: "text" },
      created_at: { kind: "timestamptz", defaultNow: true },
      updated_at: { kind: "timestamptz", defaultNow: true },
      deleted_at: { kind: "timestamptz", defaultValue: null },
    },
  },
  library_designs: {
    primaryKey: ["user_id", "id"],
    columns: {
      user_id: { kind: "uuid" },
      id: { kind: "text" },
      name: { kind: "text" },
      plan: { kind: "jsonb" },
      icon: { kind: "jsonb", defaultValue: null },
      folder_id: { kind: "text", defaultValue: null },
      closed: { kind: "boolean", defaultValue: 0 },
      sort_order: { kind: "integer", defaultValue: null },
      community_plan_id: { kind: "text", defaultValue: null },
      created_at: { kind: "timestamptz", defaultNow: true },
      updated_at: { kind: "timestamptz", defaultNow: true },
      plan_updated_at: { kind: "timestamptz", defaultNow: true },
      deleted_at: { kind: "timestamptz", defaultValue: null },
      favorite: { kind: "boolean", defaultValue: 0 },
      seq: { kind: "integer", defaultValue: 0 },
      live_lease_until: { kind: "timestamptz", defaultValue: null },
      live_lease_token: { kind: "text", defaultValue: null },
    },
  },
  library_design_members: {
    primaryKey: ["owner_id", "design_id", "member_id"],
    columns: {
      owner_id: { kind: "uuid" },
      design_id: { kind: "text" },
      member_id: { kind: "uuid" },
      role: { kind: "text", defaultValue: "editor" },
      added_at: { kind: "timestamptz", defaultNow: true },
    },
  },
  community_comments: {
    primaryKey: ["id"],
    columns: {
      id: { kind: "uuid", defaultUuid: true },
      plan_id: { kind: "uuid" },
      user_id: { kind: "uuid" },
      author_name: { kind: "text", defaultValue: "" },
      body: { kind: "text" },
      created_at: { kind: "timestamptz", defaultNow: true },
      deleted_at: { kind: "timestamptz", defaultValue: null },
    },
  },
};

function buildKnownSchemaMap(): Map<string, D1TableSpec> {
  const map = new Map<string, D1TableSpec>();
  for (const [tableName, spec] of Object.entries(KNOWN_TABLES)) {
    map.set(tableName, {
      primaryKey: [...spec.primaryKey],
      columns: new Map(Object.entries(spec.columns)),
    });
  }
  return map;
}

class D1RequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: { code: string; message: string; details: string | null; hint: string | null },
  ) {
    super(body.message);
  }
}

function fail(
  status: number,
  code: string,
  message: string,
  details: string | null = null,
): never {
  throw new D1RequestError(status, { code, message, details, hint: null });
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function quoteIdent(name: string): string {
  if (!IDENTIFIER.test(name)) {
    fail(400, "PGRST100", `"${name}" is not a column name this server accepts`);
  }
  return `"${name}"`;
}

export function formatPgTimestamptz(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  const raw = String(value).trim();
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return raw;
  }
  const iso = date.toISOString();
  return iso.endsWith(".000Z") ? `${iso.slice(0, -5)}+00:00` : `${iso.slice(0, -1)}+00:00`;
}

function coerceInputForSqlite(spec: D1ColumnSpec, value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }
  switch (spec.kind) {
    case "boolean":
      if (typeof value === "boolean") return value ? 1 : 0;
      if (typeof value === "number") return value !== 0 ? 1 : 0;
      if (typeof value === "string") {
        const lower = value.trim().toLowerCase();
        if (lower === "true" || lower === "1" || lower === "t") return 1;
        if (lower === "false" || lower === "0" || lower === "f") return 0;
      }
      return Boolean(value) ? 1 : 0;
    case "integer": {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        fail(400, "22P02", `invalid input syntax for type integer: "${String(value)}"`);
      }
      return Math.trunc(n);
    }
    case "real": {
      const n = Number(value);
      if (!Number.isFinite(n)) {
        fail(400, "22P02", `invalid input syntax for type double precision: "${String(value)}"`);
      }
      return n;
    }
    case "jsonb":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "timestamptz":
      return formatPgTimestamptz(value);
    case "uuid":
    case "text":
    default:
      return String(value);
  }
}

function coerceOutputFromSqlite(spec: D1ColumnSpec | undefined, value: unknown): unknown {
  if (value === null || value === undefined || !spec) {
    return value ?? null;
  }
  switch (spec.kind) {
    case "boolean":
      return value === 1 || value === true || value === "1" || value === "true";
    case "integer":
    case "real":
      return typeof value === "number" ? value : Number(value);
    case "jsonb":
      if (typeof value === "string") {
        try {
          return JSON.parse(value);
        } catch {
          return value;
        }
      }
      return value;
    case "timestamptz":
      return formatPgTimestamptz(value);
    default:
      return value;
  }
}

type Condition =
  | { kind: "filter"; column: string; negate: boolean; op: string; value: string }
  | { kind: "logic"; negate: boolean; op: "and" | "or"; items: Condition[] };

function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      current += char;
      if (char === "\\" && i + 1 < text.length) {
        current += text[i + 1];
        i += 1;
      } else if (char === '"') {
        quoted = false;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

function unquote(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  return value;
}

function parseOperation(column: string, text: string): Condition {
  let rest = text;
  let negate = false;
  if (rest.startsWith("not.")) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  if (dot < 0) {
    fail(400, "PGRST100", `"failed to parse filter (${text})" (line 1, column 1)`);
  }
  return { kind: "filter", column, negate, op: rest.slice(0, dot), value: rest.slice(dot + 1) };
}

function parseLogic(op: "and" | "or", negate: boolean, text: string): Condition {
  if (!text.startsWith("(") || !text.endsWith(")")) {
    fail(400, "PGRST100", `"failed to parse logic tree (${text})" (line 1, column 1)`);
  }
  const items = splitTopLevel(text.slice(1, -1)).map((item) => parseLogicItem(item.trim()));
  return { kind: "logic", negate, op, items };
}

function parseLogicItem(item: string): Condition {
  const logic = /^(not\.)?(and|or)(\(.*\))$/s.exec(item);
  if (logic) {
    return parseLogic(logic[2] as "and" | "or", Boolean(logic[1]), logic[3]!);
  }
  const dot = item.indexOf(".");
  if (dot < 0) {
    fail(400, "PGRST100", `"failed to parse logic tree (${item})" (line 1, column 1)`);
  }
  return parseOperation(item.slice(0, dot), item.slice(dot + 1));
}

const RESERVED_PARAMS = new Set(["select", "order", "limit", "offset", "on_conflict", "columns"]);

interface ParsedRequest {
  select: Array<{ alias: string; column: string }> | "*";
  conditions: Condition[];
  order: Array<{ column: string; descending: boolean; nulls?: "first" | "last" }>;
  limit?: number;
  offset?: number;
  onConflict?: string[];
  columns?: string[];
}

function parseInteger(name: string, value: string | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  if (!/^\d+$/.test(value)) {
    fail(400, "PGRST100", `"failed to parse ${name} (${value})" (line 1, column 1)`);
  }
  return Number(value);
}

function parseColumnList(value: string): string[] {
  return value
    .split(",")
    .map((name) => unquote(name.trim()))
    .filter(Boolean);
}

function parseRequest(url: URL): ParsedRequest {
  const params = url.searchParams;
  const conditions: Condition[] = [];
  for (const [key, value] of params) {
    if (RESERVED_PARAMS.has(key)) {
      continue;
    }
    const logic = /^(not\.)?(and|or)$/.exec(key);
    if (logic) {
      conditions.push(parseLogic(logic[2] as "and" | "or", Boolean(logic[1]), value));
    } else if (key.includes(".")) {
      fail(400, "PGRST108", `Filters on embedded resources are not supported here: ${key}`);
    } else {
      conditions.push(parseOperation(key, value));
    }
  }
  const selectParam = params.get("select");
  let select: ParsedRequest["select"] = "*";
  if (selectParam !== null && selectParam !== "" && selectParam !== "*") {
    if (selectParam.includes("(")) {
      fail(400, "PGRST100", "Embedded resources are not supported by the local database");
    }
    select = parseColumnList(selectParam).map((item) => {
      if (item.includes("::")) {
        fail(400, "PGRST100", "Casts in select are not supported by the local database");
      }
      const colon = item.indexOf(":");
      if (colon > 0) {
        return { alias: item.slice(0, colon), column: item.slice(colon + 1) };
      }
      return { alias: item, column: item };
    });
  }
  const order: ParsedRequest["order"] = [];
  const orderParam = params.get("order");
  if (orderParam) {
    for (const term of orderParam.split(",")) {
      const [column, ...modifiers] = term.split(".");
      let descending = false;
      let nulls: "first" | "last" | undefined;
      for (const modifier of modifiers) {
        if (modifier === "desc") descending = true;
        else if (modifier === "asc") descending = false;
        else if (modifier === "nullsfirst") nulls = "first";
        else if (modifier === "nullslast") nulls = "last";
        else fail(400, "PGRST100", `"failed to parse order (${orderParam})" (line 1, column 1)`);
      }
      order.push({ column: column!, descending, nulls });
    }
  }
  const onConflict = params.get("on_conflict");
  const columns = params.get("columns");
  return {
    select,
    conditions,
    order,
    limit: parseInteger("limit", params.get("limit")),
    offset: parseInteger("offset", params.get("offset")),
    onConflict: onConflict ? parseColumnList(onConflict) : undefined,
    columns: columns ? parseColumnList(columns) : undefined,
  };
}

interface Prefer {
  representation: boolean;
  count: boolean;
  resolution?: "merge" | "ignore";
}

function parsePrefer(headers: Headers): Prefer {
  const values = (headers.get("prefer") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const prefer: Prefer = { representation: false, count: false };
  for (const value of values) {
    if (value === "return=representation") prefer.representation = true;
    else if (value === "return=minimal") prefer.representation = false;
    else if (/^count=(exact|planned|estimated)$/.test(value)) prefer.count = true;
    else if (value === "resolution=merge-duplicates") prefer.resolution = "merge";
    else if (value === "resolution=ignore-duplicates") prefer.resolution = "ignore";
  }
  return prefer;
}

class D1SqlBuilder {
  readonly params: unknown[] = [];

  constructor(
    private readonly tableName: string,
    private readonly table: D1TableSpec,
  ) {}

  get qualified(): string {
    return quoteIdent(this.tableName);
  }

  columnSpec(name: string): D1ColumnSpec {
    const spec = this.table.columns.get(name);
    if (!spec) {
      fail(400, "42703", `column ${this.tableName}.${name} does not exist`);
    }
    return spec;
  }

  column(name: string): string {
    this.columnSpec(name);
    return `${this.qualified}.${quoteIdent(name)}`;
  }

  param(value: unknown): string {
    this.params.push(value);
    return "?";
  }

  typedParam(columnName: string, rawValue: string): string {
    const spec = this.columnSpec(columnName);
    return this.param(coerceInputForSqlite(spec, rawValue));
  }

  condition(condition: Condition): string {
    if (condition.kind === "logic") {
      const joined =
        condition.items.length === 0
          ? "1=1"
          : condition.items
              .map((item) => `(${this.condition(item)})`)
              .join(condition.op === "and" ? " AND " : " OR ");
      return condition.negate ? `NOT (${joined})` : joined;
    }
    const sql = this.filter(condition.column, condition.op, condition.value);
    return condition.negate ? `NOT (${sql})` : sql;
  }

  private buildJsonContainsSql(columnSql: string, rawJson: string): string {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      fail(400, "22P02", `invalid input syntax for type json: "${rawJson}"`);
    }

    if (Array.isArray(parsed)) {
      if (parsed.length === 0) {
        return "1=1";
      }
      const clauses = parsed.map((element) => {
        if (element !== null && typeof element === "object" && !Array.isArray(element)) {
          const entries = Object.entries(element as Record<string, unknown>);
          if (entries.length === 0) {
            return `EXISTS (SELECT 1 FROM json_each(${columnSql}))`;
          }
          const subChecks = entries.map(([key, val]) => {
            const pathParam = this.param(`$.${key}`);
            if (val === null) {
              return `json_extract(_je.value, ${pathParam}) IS NULL`;
            }
            const coerced = typeof val === "boolean" ? (val ? 1 : 0) : val;
            return `json_extract(_je.value, ${pathParam}) = ${this.param(coerced)}`;
          });
          return `EXISTS (SELECT 1 FROM json_each(${columnSql}) _je WHERE ${subChecks.join(" AND ")})`;
        }
        const coerced = typeof element === "boolean" ? (element ? 1 : 0) : element;
        return `EXISTS (SELECT 1 FROM json_each(${columnSql}) _je WHERE _je.value = ${this.param(coerced)})`;
      });
      return clauses.join(" AND ");
    }

    if (parsed !== null && typeof parsed === "object") {
      const entries = Object.entries(parsed as Record<string, unknown>);
      if (entries.length === 0) {
        return "1=1";
      }
      return entries
        .map(([key, val]) => {
          const pathParam = this.param(`$.${key}`);
          if (val === null) {
            return `json_extract(${columnSql}, ${pathParam}) IS NULL`;
          }
          const coerced = typeof val === "boolean" ? (val ? 1 : 0) : val;
          return `json_extract(${columnSql}, ${pathParam}) = ${this.param(coerced)}`;
        })
        .join(" AND ");
    }

    return `${columnSql} = ${this.param(JSON.stringify(parsed))}`;
  }

  private filter(columnName: string, op: string, raw: string): string {
    const column = this.column(columnName);
    const value = unquote(raw);
    switch (op) {
      case "eq":
        return `${column} = ${this.typedParam(columnName, value)}`;
      case "neq":
        return `${column} <> ${this.typedParam(columnName, value)}`;
      case "gt":
        return `${column} > ${this.typedParam(columnName, value)}`;
      case "gte":
        return `${column} >= ${this.typedParam(columnName, value)}`;
      case "lt":
        return `${column} < ${this.typedParam(columnName, value)}`;
      case "lte":
        return `${column} <= ${this.typedParam(columnName, value)}`;
      case "like":
        return `CAST(${column} AS TEXT) LIKE ${this.param(value.replace(/\*/g, "%"))}`;
      case "ilike":
        return `LOWER(CAST(${column} AS TEXT)) LIKE LOWER(${this.param(value.replace(/\*/g, "%"))})`;
      case "is": {
        const keyword = value.toLowerCase();
        if (!["null", "true", "false", "unknown", "not_null"].includes(keyword)) {
          fail(400, "PGRST100", `"failed to parse filter (is.${value})" (line 1, column 4)`);
        }
        if (keyword === "not_null") return `${column} IS NOT NULL`;
        if (keyword === "null" || keyword === "unknown") return `${column} IS NULL`;
        return `${column} = ${keyword === "true" ? 1 : 0}`;
      }
      case "isdistinct":
        return `${column} IS NOT ${this.typedParam(columnName, value)}`;
      case "in": {
        if (!raw.startsWith("(") || !raw.endsWith(")")) {
          fail(400, "PGRST100", `"failed to parse filter (in.${raw})" (line 1, column 4)`);
        }
        const inner = raw.slice(1, -1);
        const items = inner === "" ? [] : splitTopLevel(inner).map((item) => unquote(item.trim()));
        if (items.length === 0) {
          return "0=1";
        }
        return `${column} IN (${items.map((item) => this.typedParam(columnName, item)).join(", ")})`;
      }
      case "cs":
        return this.buildJsonContainsSql(column, value);
      default:
        fail(400, "PGRST100", `"unknown operator ${op}" (line 1, column 1)`);
    }
  }

  where(conditions: Condition[]): string {
    if (conditions.length === 0) {
      return "";
    }
    return ` WHERE ${conditions.map((condition) => `(${this.condition(condition)})`).join(" AND ")}`;
  }

  selectList(select: ParsedRequest["select"]): string {
    if (select === "*") {
      return "*";
    }
    return select
      .map((item) => {
        this.columnSpec(item.column);
        return `${quoteIdent(item.column)} AS ${quoteIdent(item.alias)}`;
      })
      .join(", ");
  }

  orderBy(order: ParsedRequest["order"]): string {
    if (order.length === 0) {
      return "";
    }
    const terms = order.map(
      (term) =>
        `${this.column(term.column)} ${term.descending ? "DESC" : "ASC"}${term.nulls ? ` NULLS ${term.nulls.toUpperCase()}` : ""}`,
    );
    return ` ORDER BY ${terms.join(", ")}`;
  }
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function contentRange(offset: number, rows: number, total: number | undefined): string {
  const range = rows > 0 ? `${offset}-${offset + rows - 1}` : "*";
  return `${range}/${total === undefined ? "*" : total}`;
}

const SINGLE_OBJECT = "application/vnd.pgrst.object+json";

function mapSqliteError(error: unknown): { status: number; code: string; message: string } {
  const msg = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed/i.test(msg)) {
    return { status: 409, code: "23505", message: msg };
  }
  if (/FOREIGN KEY constraint failed/i.test(msg)) {
    return { status: 409, code: "23503", message: msg };
  }
  if (/CHECK constraint failed/i.test(msg)) {
    return { status: 400, code: "23514", message: msg };
  }
  if (/NOT NULL constraint failed/i.test(msg)) {
    return { status: 400, code: "23502", message: msg };
  }
  return { status: 500, code: "PGRST000", message: msg };
}

function transformOutputRow(
  row: Record<string, unknown>,
  table: D1TableSpec,
  select: ParsedRequest["select"],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (select === "*") {
    for (const [colName, colSpec] of table.columns) {
      if (colName in row) {
        out[colName] = coerceOutputFromSqlite(colSpec, row[colName]);
      }
    }
    for (const [k, v] of Object.entries(row)) {
      if (!(k in out)) {
        out[k] = v;
      }
    }
    return out;
  }
  for (const item of select) {
    const colSpec = table.columns.get(item.column);
    out[item.alias] = coerceOutputFromSqlite(colSpec, row[item.alias]);
  }
  return out;
}
export const MAX_INLINE_JSON_CHARS = 48_000;

interface D1ChunkSentinel {
  __d1_chunked__: true;
  table: string;
  key: string;
  column: string;
}

function isD1ChunkSentinel(value: unknown): value is D1ChunkSentinel {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).__d1_chunked__ === true &&
    typeof (value as Record<string, unknown>).key === "string"
  );
}

function coerceInputForSqliteWithChunks(
  d1: D1DatabaseLike,
  tableName: string,
  columnName: string,
  spec: D1ColumnSpec,
  value: unknown,
  chunkWrites: Promise<void>[],
): unknown {
  const coerced = coerceInputForSqlite(spec, value);
  if (spec.kind !== "jsonb" || typeof coerced !== "string" || coerced.length <= MAX_INLINE_JSON_CHARS) {
    return coerced;
  }
  const chunkKey = crypto.randomUUID();
  const sentinel: D1ChunkSentinel = {
    __d1_chunked__: true,
    table: tableName,
    key: chunkKey,
    column: columnName,
  };
  chunkWrites.push(
    (async () => {
      for (let i = 0, idx = 0; i < coerced.length; i += MAX_INLINE_JSON_CHARS, idx += 1) {
        const slice = coerced.slice(i, i + MAX_INLINE_JSON_CHARS);
        await d1
          .prepare(
            `INSERT OR REPLACE INTO d1_json_chunks (table_name, row_key, column_name, chunk_index, chunk_text)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(tableName, chunkKey, columnName, idx, slice)
          .run();
      }
    })(),
  );
  return JSON.stringify(sentinel);
}

async function hydrateChunkedJsonRows(
  d1: D1DatabaseLike,
  rows: Record<string, unknown>[],
): Promise<void> {
  const tasks: Promise<void>[] = [];
  for (const row of rows) {
    for (const [colKey, val] of Object.entries(row)) {
      if (isD1ChunkSentinel(val)) {
        tasks.push(
          (async () => {
            const { results } = await d1
              .prepare(
                `SELECT chunk_text FROM d1_json_chunks
                  WHERE table_name = ? AND row_key = ? AND column_name = ?
                  ORDER BY chunk_index ASC`,
              )
              .bind(val.table, val.key, val.column)
              .all<{ chunk_text: string }>();
            const joined = (results ?? []).map((r) => r.chunk_text).join("");
            if (joined) {
              try {
                row[colKey] = JSON.parse(joined);
              } catch {
                row[colKey] = joined;
              }
            }
          })(),
        );
      }
    }
  }
  if (tasks.length > 0) {
    await Promise.all(tasks);
  }
}

async function handleD1Storage(
  d1: D1DatabaseLike,
  request: Request,
  rest: string,
): Promise<Response> {
  const storageJson = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const storageError = (status: number, error: string, message: string) =>
    storageJson(status, { statusCode: String(status), error, message });

  const method = request.method.toUpperCase();
  const parts = rest.split("/").filter(Boolean).map(decodeURIComponent);

  if (parts[0] === "bucket") {
    if (method === "GET" && parts.length === 2) {
      const bucket = await d1
        .prepare("SELECT id, public, created_at FROM local_storage_buckets WHERE id = ?")
        .bind(parts[1])
        .first<{ id: string; public: number; created_at: string }>();
      return bucket
        ? storageJson(200, {
            id: bucket.id,
            name: bucket.id,
            public: Boolean(bucket.public),
            created_at: bucket.created_at,
          })
        : storageError(404, "Bucket not found", "Bucket not found");
    }
    if (method === "POST" && parts.length === 1) {
      const body = (await request.json()) as { id?: string; name?: string; public?: boolean };
      const id = body.id ?? body.name;
      if (!id) {
        return storageError(400, "Invalid request", "A bucket needs a name");
      }
      const existing = await d1
        .prepare("SELECT id FROM local_storage_buckets WHERE id = ?")
        .bind(id)
        .first();
      if (existing) {
        return storageError(409, "Duplicate", "The resource already exists");
      }
      await d1
        .prepare("INSERT INTO local_storage_buckets (id, public) VALUES (?, ?)")
        .bind(id, body.public ? 1 : 0)
        .run();
      return storageJson(200, { name: id });
    }
    return storageError(400, "Invalid request", "Not supported by the D1 storage adapter");
  }

  if (parts[0] !== "object") {
    return storageError(404, "not_found", "Not supported by the D1 storage adapter");
  }

  if (method === "GET" || method === "HEAD") {
    const publicOnly = parts[1] === "public";
    const authenticated = parts[1] === "authenticated";
    const [bucket, ...objectPath] = parts.slice(publicOnly || authenticated ? 2 : 1);
    const found = await d1
      .prepare(
        `SELECT o.bytes, o.content_type, o.cache_control, b.public
           FROM local_storage_objects o
           JOIN local_storage_buckets b ON b.id = o.bucket
          WHERE o.bucket = ? AND o.path = ?`,
      )
      .bind(bucket, objectPath.join("/"))
      .first<{
        bytes: ArrayBuffer | Uint8Array | number[];
        content_type: string;
        cache_control: string | null;
        public: number;
      }>();
    if (!found || (publicOnly && !found.public)) {
      return storageError(404, "not_found", "Object not found");
    }
    const rawBytes =
      found.bytes instanceof Uint8Array
        ? found.bytes
        : found.bytes instanceof ArrayBuffer
          ? new Uint8Array(found.bytes)
          : new Uint8Array(found.bytes);
    return new Response(method === "HEAD" ? null : new Uint8Array(rawBytes), {
      status: 200,
      headers: {
        "content-type": found.content_type,
        ...(found.cache_control ? { "cache-control": found.cache_control } : {}),
      },
    });
  }

  if (method === "DELETE" && parts.length === 2) {
    const body = (await request.json().catch(() => ({}))) as { prefixes?: string[] };
    const prefixes = Array.isArray(body.prefixes) ? body.prefixes.map(String) : [];
    const deleted: Array<{ name: string; bucket_id: string }> = [];
    for (const p of prefixes) {
      const row = await d1
        .prepare("DELETE FROM local_storage_objects WHERE bucket = ? AND path = ? RETURNING path")
        .bind(parts[1], p)
        .first<{ path: string }>();
      if (row) {
        deleted.push({ name: row.path, bucket_id: parts[1]! });
      }
    }
    return storageJson(200, deleted);
  }

  if ((method === "POST" || method === "PUT") && parts.length >= 3) {
    const [, bucket, ...objectPath] = parts;
    const key = objectPath.join("/");
    const upsert = method === "PUT" || request.headers.get("x-upsert") === "true";
    const bucketRow = await d1
      .prepare("SELECT 1 FROM local_storage_buckets WHERE id = ?")
      .bind(bucket)
      .first();
    if (!bucketRow) {
      return storageError(404, "Bucket not found", "Bucket not found");
    }

    const type = request.headers.get("content-type") ?? "application/octet-stream";
    let bytes: Uint8Array;
    let contentType = type;
    let cacheControl = request.headers.get("cache-control") ?? null;
    if (type.startsWith("multipart/form-data")) {
      const form = await request.formData();
      let file: Blob | undefined;
      for (const [, value] of form) {
        if (typeof value !== "string") {
          file = value;
        }
      }
      const cc = form.get("cacheControl");
      bytes = new Uint8Array(await (file ?? new Blob()).arrayBuffer());
      contentType = file?.type || "application/octet-stream";
      cacheControl = typeof cc === "string" ? `max-age=${cc}` : null;
    } else {
      bytes = new Uint8Array(await request.arrayBuffer());
    }

    const conflictClause = upsert
      ? "ON CONFLICT (bucket, path) DO UPDATE SET content_type = excluded.content_type, cache_control = excluded.cache_control, bytes = excluded.bytes, updated_at = strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')"
      : "ON CONFLICT (bucket, path) DO NOTHING";
    const row = await d1
      .prepare(
        `INSERT INTO local_storage_objects (bucket, path, content_type, cache_control, bytes)
         VALUES (?, ?, ?, ?, ?)
         ${conflictClause}
         RETURNING path`,
      )
      .bind(bucket, key, contentType, cacheControl, bytes)
      .first<{ path: string }>();

    if (!row) {
      return storageError(409, "Duplicate", "The resource already exists");
    }
    return storageJson(200, { Key: `${bucket}/${key}`, Id: `${bucket}/${key}` });
  }

  return storageError(400, "Invalid request", "Not supported by the D1 storage adapter");
}

export function createD1PostgrestHandler(
  d1: D1DatabaseLike,
  options: PostgrestHandlerOptions = {},
): PostgrestHandler {
  const schema = buildKnownSchemaMap();

  const tableFor = (name: string): { name: string; info: D1TableSpec } => {
    const info = schema.get(name);
    if (!info) {
      fail(404, "PGRST205", `Could not find the table 'public.${name}' in the schema cache`);
    }
    return { name, info };
  };

  const answerRows = (
    request: Request,
    status: number,
    rows: Record<string, unknown>[],
    headers: Record<string, string>,
  ): Response => {
    const accept = request.headers.get("accept") ?? "";
    if (accept.startsWith(SINGLE_OBJECT)) {
      if (rows.length !== 1) {
        return json(406, {
          code: "PGRST116",
          details: `The result contains ${rows.length} rows`,
          hint: null,
          message: "Cannot coerce the result to a single JSON object",
        });
      }
      return json(status, rows[0], headers);
    }
    return json(status, rows, headers);
  };

  const read = async (
    request: Request,
    tableName: string,
    url: URL,
    head: boolean,
  ): Promise<Response> => {
    const { info } = tableFor(tableName);
    const parsed = parseRequest(url);
    const prefer = parsePrefer(request.headers);
    const builder = new D1SqlBuilder(tableName, info);
    const columns = builder.selectList(parsed.select);
    const where = builder.where(parsed.conditions);
    const filterParams = builder.params.slice();

    let total: number | undefined;
    if (prefer.count) {
      const countRow = await d1
        .prepare(`SELECT COUNT(*) AS n FROM ${builder.qualified}${where}`)
        .bind(...filterParams)
        .first<{ n: number }>();
      total = Number(countRow?.n ?? 0);
    }

    const offset = parsed.offset ?? 0;
    if (head) {
      return new Response(null, {
        status: 200,
        headers: { "content-range": contentRange(offset, 0, total) },
      });
    }

    const orderBy = builder.orderBy(parsed.order);
    let pagination = "";
    if (parsed.limit !== undefined) {
      pagination = ` LIMIT ${parsed.limit}`;
      if (parsed.offset !== undefined) {
        pagination += ` OFFSET ${parsed.offset}`;
      }
    } else if (parsed.offset !== undefined) {
      pagination = ` LIMIT -1 OFFSET ${parsed.offset}`;
    }

    const { results } = await d1
      .prepare(`SELECT ${columns} FROM ${builder.qualified}${where}${orderBy}${pagination}`)
      .bind(...builder.params)
      .all<Record<string, unknown>>();

    const transformed = (results ?? []).map((row) => transformOutputRow(row, info, parsed.select));
    await hydrateChunkedJsonRows(d1, transformed);
    return answerRows(request, 200, transformed, {
      "content-range": contentRange(offset, transformed.length, total),
    });
  };

  const mutate = async (
    request: Request,
    info: D1TableSpec,
    select: ParsedRequest["select"],
    sql: string,
    params: unknown[],
    status: { withBody: number; withoutBody: number },
  ): Promise<Response> => {
    const prefer = parsePrefer(request.headers);
    const { results } = await d1
      .prepare(sql)
      .bind(...params)
      .all<Record<string, unknown>>();
    const rows = (results ?? []).map((row) => transformOutputRow(row, info, select));
    await hydrateChunkedJsonRows(d1, rows);
    const affected = rows.length;
    const headers = {
      "content-range": contentRange(0, affected, prefer.count ? affected : undefined),
    };
    if (!prefer.representation) {
      return new Response(null, { status: status.withoutBody, headers });
    }
    return answerRows(request, status.withBody, rows, headers);
  };

  const write = async (request: Request, tableName: string, url: URL): Promise<Response> => {
    const { info } = tableFor(tableName);
    const parsed = parseRequest(url);
    const prefer = parsePrefer(request.headers);
    const builder = new D1SqlBuilder(tableName, info);
    const returning = builder.selectList(parsed.select);
    const method = request.method.toUpperCase();

    if (method === "DELETE") {
      const where = builder.where(parsed.conditions);
      return mutate(
        request,
        info,
        parsed.select,
        `DELETE FROM ${builder.qualified}${where} RETURNING ${returning}`,
        builder.params,
        { withBody: 200, withoutBody: 204 },
      );
    }

    let payload: unknown;
    try {
      const text = await request.text();
      payload = text === "" ? undefined : JSON.parse(text);
    } catch {
      fail(400, "PGRST102", "Empty or invalid json");
    }

    const checkColumns = (names: string[]) => {
      for (const name of names) {
        const column = info.columns.get(name);
        if (!column) {
          fail(
            400,
            "PGRST204",
            `Could not find the '${name}' column of '${tableName}' in the schema cache`,
          );
        }
        if (column.generated) {
          fail(
            400,
            "428C9",
            `cannot insert a non-DEFAULT value into column "${name}"`,
            `Column "${name}" is a generated column.`,
          );
        }
      }
    };

    if (method === "PATCH") {
      if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
        fail(400, "PGRST102", "A PATCH needs one JSON object");
      }
      const patchObj = payload as Record<string, unknown>;
      const names = Object.keys(patchObj);
      checkColumns(names);
      if (names.length === 0) {
        return read(request, tableName, url, false);
      }
      const chunkWrites: Promise<void>[] = [];
      const assignments = names
        .map((name) => {
          const spec = info.columns.get(name)!;
          const coerced = coerceInputForSqliteWithChunks(
            d1,
            tableName,
            name,
            spec,
            patchObj[name],
            chunkWrites,
          );
          return `${quoteIdent(name)} = ${builder.param(coerced)}`;
        })
        .join(", ");
      if (chunkWrites.length > 0) {
        await Promise.all(chunkWrites);
      }
      const where = builder.where(parsed.conditions);
      return mutate(
        request,
        info,
        parsed.select,
        `UPDATE ${builder.qualified} SET ${assignments}${where} RETURNING ${returning}`,
        builder.params,
        { withBody: 200, withoutBody: 204 },
      );
    }

    if (method === "POST") {
      const rows = (Array.isArray(payload) ? payload : [payload]) as Record<string, unknown>[];
      if (rows.some((row) => typeof row !== "object" || row === null || Array.isArray(row))) {
        fail(400, "PGRST102", "An insert needs JSON objects");
      }
      const explicitNames = parsed.columns ?? [
        ...new Set(rows.flatMap((row) => Object.keys(row))),
      ];
      checkColumns(explicitNames);
      if (rows.length === 0) {
        return prefer.representation
          ? answerRows(request, 201, [], {})
          : new Response(null, { status: 201 });
      }

      // Include auto-UUID columns when not explicitly provided
      const finalNames = [...explicitNames];
      for (const [colName, colSpec] of info.columns) {
        if (colSpec.defaultUuid && !finalNames.includes(colName)) {
          finalNames.unshift(colName);
        }
      }

      const nowFormatted = formatPgTimestamptz(new Date().toISOString());
      const chunkWrites: Promise<void>[] = [];
      const valueTuples = rows.map((row) => {
        const placeholders = finalNames.map((name) => {
          const spec = info.columns.get(name)!;
          let rawVal = row[name];
          if (rawVal === undefined) {
            if (spec.defaultUuid) {
              rawVal = crypto.randomUUID();
            } else if (spec.defaultNow) {
              rawVal = nowFormatted;
            } else if (spec.defaultValue !== undefined) {
              rawVal = spec.defaultValue;
            } else {
              rawVal = null;
            }
          }
          return builder.param(
            coerceInputForSqliteWithChunks(d1, tableName, name, spec, rawVal, chunkWrites),
          );
        });
        return `(${placeholders.join(", ")})`;
      });
      if (chunkWrites.length > 0) {
        await Promise.all(chunkWrites);
      }

      let conflict = "";
      if (prefer.resolution) {
        const target = parsed.onConflict ?? info.primaryKey;
        if (target.length === 0) {
          fail(400, "PGRST100", `Table ${tableName} has no primary key to resolve duplicates on`);
        }
        target.forEach((name) => builder.column(name));
        const updates = explicitNames.filter((name) => !target.includes(name));
        conflict =
          prefer.resolution === "ignore" || updates.length === 0
            ? ` ON CONFLICT (${target.map(quoteIdent).join(", ")}) DO NOTHING`
            : ` ON CONFLICT (${target.map(quoteIdent).join(", ")}) DO UPDATE SET ${updates
                .map((name) => `${quoteIdent(name)} = excluded.${quoteIdent(name)}`)
                .join(", ")}`;
      }

      const columnList = finalNames.map(quoteIdent).join(", ");
      const insertSql =
        finalNames.length === 0
          ? `INSERT INTO ${builder.qualified} DEFAULT VALUES`
          : `INSERT INTO ${builder.qualified} (${columnList}) VALUES ${valueTuples.join(", ")}`;

      return mutate(
        request,
        info,
        parsed.select,
        `${insertSql}${conflict} RETURNING ${returning}`,
        builder.params,
        { withBody: 201, withoutBody: 201 },
      );
    }

    fail(405, "PGRST117", `Unsupported HTTP method: ${method}`);
  };

  const handler = (async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    try {
      const storageMatch = /^\/storage\/v1(\/.*)$/.exec(url.pathname);
      if (storageMatch) {
        return options.storage
          ? await options.storage(request, storageMatch[1]!)
          : await handleD1Storage(d1, request, storageMatch[1]!);
      }
      const rest = /^\/rest\/v1\/([^/]+)$/.exec(url.pathname);
      if (!rest) {
        return json(404, {
          code: "PGRST125",
          message: `Invalid path: ${url.pathname}`,
          details: null,
          hint: null,
        });
      }
      const tableName = decodeURIComponent(rest[1]!);
      if (!IDENTIFIER.test(tableName)) {
        fail(404, "PGRST205", `Could not find the table 'public.${tableName}' in the schema cache`);
      }
      const method = request.method.toUpperCase();
      if (method === "GET" || method === "HEAD") {
        return await read(request, tableName, url, method === "HEAD");
      }
      return await write(request, tableName, url);
    } catch (error) {
      if (error instanceof D1RequestError) {
        return json(error.status, error.body);
      }
      const mapped = mapSqliteError(error);
      return json(mapped.status, {
        code: mapped.code,
        message: mapped.message,
        details: null,
        hint: null,
      });
    }
  }) as PostgrestHandler;

  handler.reloadSchema = async () => {};
  return handler;
}
