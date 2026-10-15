import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const configured = !SUPABASE_URL.includes("YOUR-PROJECT") && !SUPABASE_ANON_KEY.includes("YOUR-ANON");
export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } });

// Every call goes through here so errors surface as readable messages.
const ok = ({ data, error }) => {
  if (error) throw new Error(friendly(error.message));
  return data;
};
const friendly = (m = "") =>
  /duplicate key/i.test(m) ? "That value already exists (for example, a SKU in use)." :
  /row-level security/i.test(m) ? "You do not have permission to do that." :
  m || "Something went wrong.";

export const api = {
  signIn: (email, password) => sb.auth.signInWithPassword({ email, password }).then(ok),
  signUp: (email, password, meta) => sb.auth.signUp({ email, password, options: { data: meta } }).then(ok),
  signOut: () => sb.auth.signOut(),
  session: () => sb.auth.getSession().then(r => r.data.session),
  setPassword: password => sb.auth.updateUser({ password }).then(ok),

  profile: id => sb.from("profiles").select("*, company:companies(*)").eq("id", id).maybeSingle().then(ok),
  rpc: (fn, args) => sb.rpc(fn, args).then(ok),

  list: (table, opts = {}) => {
    let q = sb.from(table).select(opts.select || "*");
    for (const [k, v] of Object.entries(opts.eq || {})) q = q.eq(k, v);
    if (opts.order) q = q.order(opts.order, { ascending: false });
    return q.limit(opts.limit || 500).then(ok);
  },
  insert: (table, row) => sb.from(table).insert(row).select().single().then(ok),
  update: (table, id, patch) => sb.from(table).update(patch).eq("id", id).select().single().then(ok),
};
