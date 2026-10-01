// A small in-memory stand-in for the parts of supabase-js this app uses.
export const db = { tables: { orders: [], audit_log: [], app_settings: [], paystack_webhook_events: [], customers: [], feedback: [], reviews: [] }, seq: 1 };
export function reset() { for (const k of Object.keys(db.tables)) db.tables[k] = []; db.seq = 1; }
const uniq = { orders: ["reference"], paystack_webhook_events: ["event_key"], app_settings: ["key"] };

function parseOr(expr) {
  return expr.split(",").map((part) => {
    const m = part.match(/^([a-z_]+)\.(is|neq|eq|ilike)\.(.*)$/);
    if (!m) throw new Error("fake db cannot parse or() part: " + part);
    const [, col, op, raw] = m;
    return (r) => {
      const v = r[col];
      if (op === "is") return raw === "null" ? v == null : String(v) === raw;
      if (op === "eq") return String(v) === raw;
      if (op === "neq") return v == null ? true : String(v) !== raw; // SQL: NULL <> x is NULL, but the app pairs it with is.null
      if (op === "ilike") { const needle = raw.replace(/%/g, "").toLowerCase(); return String(v ?? "").toLowerCase().includes(needle); }
      return false;
    };
  }).reduce((a, b) => (r) => a(r) || b(r));
}

function builder(table) {
  let op = "select", payload = null, returning = false, single = null, count = null, head = false, lim = null, rng = null;
  const filters = [], orders = [];
  const b = {
    select(_cols, opts) { returning = true; if (opts?.count) count = opts.count; head = !!opts?.head; return b; },
    insert(row) { op = "insert"; payload = row; return b; },
    update(patch) { op = "update"; payload = patch; return b; },
    upsert(row) { op = "upsert"; payload = row; return b; },
    delete() { op = "delete"; return b; },
    eq(c, v) { filters.push((r) => r[c] === v); return b; },
    neq(c, v) { filters.push((r) => r[c] !== v); return b; },
    in(c, arr) { filters.push((r) => arr.includes(r[c])); return b; },
    is(c, v) { filters.push((r) => (v === null ? r[c] == null : r[c] === v)); return b; },
    lt(c, v) { filters.push((r) => r[c] != null && r[c] < v); return b; },
    lte(c, v) { filters.push((r) => r[c] != null && r[c] <= v); return b; },
    gt(c, v) { filters.push((r) => r[c] != null && r[c] > v); return b; },
    gte(c, v) { filters.push((r) => r[c] != null && r[c] >= v); return b; },
    or(expr) { filters.push(parseOr(expr)); return b; },
    order(c, o) { orders.push([c, o?.ascending !== false]); return b; },
    limit(n) { lim = n; return b; },
    range(a, z) { rng = [a, z]; return b; },
    maybeSingle() { single = "maybe"; return b; },
    single() { single = "one"; return b; },
    then(resolve, reject) { try { resolve(exec()); } catch (e) { (reject || ((x) => { throw x; }))(e); } },
  };
  function exec() {
    const rows = db.tables[table];
    const match = () => rows.filter((r) => filters.every((f) => f(r)));
    const finish = (data, extra = {}) => {
      if (single === "maybe") return { data: data[0] ? { ...data[0] } : null, error: null, ...extra };
      if (single === "one") return data[0] ? { data: { ...data[0] }, error: null, ...extra } : { data: null, error: { message: "no rows" }, ...extra };
      return { data: data.map((r) => ({ ...r })), error: null, ...extra };
    };
    if (op === "insert" || op === "upsert") {
      const list = Array.isArray(payload) ? payload : [payload];
      const out = [];
      for (const raw of list) {
        const row = { ...raw };
        if (table === "orders") { row.created_at ??= new Date().toISOString(); row.fulfilled ??= false; row.fulfillment_status ??= "pending"; row.fulfillment_attempts ??= 0; }
        if (table === "audit_log") { row.id = db.seq++; row.created_at ??= new Date().toISOString(); }
        if (table === "paystack_webhook_events") { row.id = db.seq++; row.attempts ??= 0; row.received_at ??= new Date().toISOString(); }
        const keys = uniq[table] || [];
        const dup = keys.length && rows.find((r) => keys.every((k) => r[k] === row[k]));
        if (dup) {
          if (op === "upsert") { Object.assign(dup, row); out.push(dup); continue; }
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        rows.push(row); out.push(row);
      }
      return returning ? finish(out) : { data: null, error: null };
    }
    if (op === "update") {
      // Test hook: db.missingColumns simulates a migration that has not been run yet.
      const missing = db.missingColumns && Object.keys(payload || {}).find((k) => db.missingColumns.has(k));
      if (missing) return { data: null, error: { code: "PGRST204", message: `Could not find the '${missing}' column of '${table}' in the schema cache` } };
      const hit = match(); hit.forEach((r) => Object.assign(r, payload));
      return returning ? finish(hit) : { data: null, error: null };
    }
    if (op === "delete") { const hit = match(); db.tables[table] = rows.filter((r) => !hit.includes(r)); return { data: null, error: null }; }
    let hit = match();
    for (const [c, asc] of [...orders].reverse()) hit = [...hit].sort((x, y) => (x[c] < y[c] ? -1 : x[c] > y[c] ? 1 : 0) * (asc ? 1 : -1));
    const total = hit.length;
    if (rng) hit = hit.slice(rng[0], rng[1] + 1); else if (lim != null) hit = hit.slice(0, lim);
    const extra = count ? { count: total } : {};
    if (head) return { data: null, error: null, ...extra };
    return finish(hit, extra);
  }
  return b;
}
export function getSupabase() { return { from: (t) => builder(t) }; }
