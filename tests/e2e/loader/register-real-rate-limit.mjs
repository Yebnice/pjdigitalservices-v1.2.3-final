// The hooks run on their own thread and copy the environment when registered,
// so the flag has to be set BEFORE register().
process.env.REAL_RATE_LIMIT = "1";
const { register } = await import("node:module");
register("./hooks.mjs", import.meta.url);
