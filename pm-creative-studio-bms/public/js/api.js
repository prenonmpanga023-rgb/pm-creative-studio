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
  /rate limit|too many/i.test(m) ? "Too many emails were sent. Wait a few minutes and try again (or set up custom SMTP in Supabase, see README)." :
  /not confirmed/i.test(m) ? "Please confirm your email first. Use the link below to resend the message." :
  /row-level security/i.test(m) ? "You do not have permission to do that." :
  m || "Something went wrong.";

const home = location.origin + location.pathname;

export const api = {
  signIn: (email, password) => sb.auth.signInWithPassword({ email, password }).then(ok),
  signUp: (email, password, meta) => sb.auth.signUp({ email, password, options: { data: { ...meta, password_set: true }, emailRedirectTo: home } }).then(ok),
  resetPassword: email => sb.auth.resetPasswordForEmail(email, { redirectTo: home }).then(ok),
  resend: email => sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: home } }).then(ok),
  // Invitation email: a one-time sign-in link sent to the invitee (no service key needed).
  magicLink: email => sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: home, data: { intent: "join" } } }).then(ok),
  customer: id => sb.from("customers").select("*").eq("id", id).maybeSingle().then(ok),
  signOut: () => sb.auth.signOut(),
  session: () => sb.auth.getSession().then(r => r.data.session),
  setPassword: password => sb.auth.updateUser({ password, data: { password_set: true } }).then(ok),

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
