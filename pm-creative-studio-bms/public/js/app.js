import { api, configured, sb } from "./api.js";

/* ───────── helpers ───────── */
const $ = id => document.getElementById(id);
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const S = { user: null, me: null, co: null, products: [], cart: [], period: "month" };
const money = n => new Intl.NumberFormat("en-ZM", { style: "currency", currency: S.co?.currency || "ZMW" }).format(Number(n || 0));
const when = v => (v ? new Date(v).toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const label = s => String(s).replaceAll("_", " ");
const isMgr = () => ["OWNER", "ADMIN"].includes(S.me?.role);
const fd = form => Object.fromEntries(new FormData(form));

function say(id, text, type = "error") {
  const el = $(id);
  el.textContent = text;
  el.className = `msg ${type}`;
  if (id === "flash") { clearTimeout(say.t); say.t = setTimeout(() => el.classList.add("hidden"), 5000); }
}
const hide = id => $(id).classList.add("hidden");

// Wraps async handlers: disables the submit button while working and reports errors.
function guard(form, msgId, fn) {
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const btn = form.querySelector("button:not([type=button])");
    btn && (btn.disabled = true);
    try { await fn(fd(form), form); }
    catch (err) { say(msgId, err.message); }
    finally { btn && (btn.disabled = false); }
  });
}

/* ───────── modal ───────── */
function modal(title, body) {
  $("modal").innerHTML = `<div class="back"><div class="dlg" role="dialog" aria-modal="true"><h3>${esc(title)}</h3>${body}</div></div>`;
  $("modal").querySelector(".back").addEventListener("mousedown", e => e.target.classList.contains("back") && closeModal());
  $("modal").querySelector("input,select")?.focus();
}
const closeModal = () => ($("modal").innerHTML = "");
document.addEventListener("keydown", e => e.key === "Escape" && closeModal());
const cancelBtn = `<button type="button" class="btn light" data-close>Cancel</button>`;
document.addEventListener("click", e => e.target.closest("[data-close]") && closeModal());

function dialogForm(title, fields, submitText, onSubmit) {
  modal(title, `<form id="dlgForm"><p id="dlgMsg" class="msg error hidden"></p><div class="grid2">${fields}</div><div class="actions">${cancelBtn}<button class="btn">${submitText}</button></div></form>`);
  guard($("dlgForm"), "dlgMsg", async (v, f) => { await onSubmit(v, f); closeModal(); });
}

/* ───────── auth ───────── */
const tabs = { Login: "formLogin", Create: "formCreate", Join: "formJoin", Customer: "formCustomer" };
Object.keys(tabs).forEach(k => $(`tab${k}`).addEventListener("click", () => {
  Object.entries(tabs).forEach(([t, f]) => { $(f).classList.toggle("hidden", t !== k); $(`tab${t}`).classList.toggle("on", t === k); });
  hide("authMsg");
}));
const shopParam = new URLSearchParams(location.search).get("shop");
if (shopParam) { $("tabCustomer").click(); $("formCustomer").elements.shop.value = shopParam; }

guard($("formLogin"), "authMsg", async v => {
  try { await api.signIn(v.email.trim(), v.password); }
  catch (err) { if (/confirm/i.test(err.message)) $("resend").classList.remove("hidden"); throw err; }
  await boot();
});
const loginEmail = () => $("formLogin").elements.email.value.trim();
$("forgot").onclick = async () => {
  if (!loginEmail()) return say("authMsg", "Type your email above first, then press “Forgot password?”.");
  try { await api.resetPassword(loginEmail()); say("authMsg", "If that email has an account, a reset link is on its way. Check your spam folder too.", "ok"); }
  catch (err) { say("authMsg", err.message); }
};
$("resend").onclick = async () => {
  if (!loginEmail()) return say("authMsg", "Type your email above first.");
  try { await api.resend(loginEmail()); say("authMsg", "Confirmation email sent again. Check your inbox and spam folder.", "ok"); }
  catch (err) { say("authMsg", err.message); }
};
const signUpFlow = intent => async v => {
  const res = await api.signUp(v.email.trim(), v.password, { intent, company: v.company, name: v.name, phone: v.phone, shop: v.shop?.trim().toLowerCase() });
  if (res.session) return boot();
  $("tabLogin").click(); $("formLogin").elements.email.value = v.email.trim(); $("resend").classList.remove("hidden");
  say("authMsg", "Account created. We sent a confirmation email: open it, then sign in here.", "ok");
};
guard($("formCreate"), "authMsg", signUpFlow("create"));
guard($("formJoin"), "authMsg", signUpFlow("join"));
guard($("formCustomer"), "authMsg", signUpFlow("customer"));

$("logout").addEventListener("click", async () => { await api.signOut(); location.reload(); });

function passwordDialog() {
  dialogForm("Set your password", `<p class="hint full">Choose a password so you can sign in directly next time.</p>
    <label class="full">New password<input name="p" type="password" minlength="10" required autocomplete="new-password"></label>`, "Save password", async v => {
    await api.setPassword(v.p); S.recovery = false; say("flash", "Password saved.", "ok");
  });
}

async function boot() {
  const hashError = new URLSearchParams(location.hash.slice(1)).get("error_description");
  const session = await api.session();
  if (!session) return showAuth(hashError || undefined);
  S.user = session.user;
  const m = S.user.user_metadata || {};
  let p = await api.profile(S.user.id), cust = p ? null : await api.customer(S.user.id);
  if (!p && !cust) {
    if (m.intent === "create") await api.rpc("create_workspace", { p_company: m.company, p_name: m.name });
    else if (m.intent === "join") await api.rpc("join_workspace", { p_name: m.name || S.user.email.split("@")[0] });
    else if (m.intent === "customer") await api.rpc("join_shop", { p_slug: m.shop, p_name: m.name, p_phone: m.phone || null });
    p = await api.profile(S.user.id); cust = p ? null : await api.customer(S.user.id);
  }
  if ((p && !p.active) || (!p && !cust)) {
    await api.signOut();
    return showAuth(p ? "This account has been deactivated. Contact your owner." : "No workspace found for this account. Create one, or ask to be invited.");
  }
  S.kind = cust ? "customer" : "staff";
  if (cust) { S.me = { ...cust, role: "CUSTOMER" }; S.co = await api.rpc("my_shop"); }
  else { S.me = p; S.co = p.company; }
  $("auth").classList.add("hidden"); $("shell").classList.remove("hidden");
  $("coName").textContent = S.co.name;
  $("who").textContent = `${S.me.full_name} · ${S.me.role}`;
  buildNav(); go(location.hash.slice(1));
  // Arrived from an invitation or reset email without choosing a password yet.
  if (S.recovery || (m.intent === "join" && !m.name && !m.password_set)) passwordDialog();
}
function showAuth(msg) {
  $("shell").classList.add("hidden"); $("auth").classList.remove("hidden");
  msg && say("authMsg", msg);
}

/* ───────── navigation ───────── */
// Access: "all" = any staff · "mgr" = owner/admin · "cust" = customers · "any" = everyone signed in
const PAGES = {
  overview: ["Overview", overview, "all"], orders: ["Orders", orders, "all"], products: ["Inventory", products, "all"], sales: ["Sales", sales, "all"],
  expenses: ["Expenses", expenses, "all"], suppliers: ["Suppliers", suppliers, "all"], reports: ["Reports", reports, "mgr"],
  staff: ["Staff", staff, "mgr"], audit: ["Audit log", audit, "mgr"], settings: ["Company settings", settings, "mgr"],
  shop: ["Shop", shop, "cust"], myorders: ["My orders", myorders, "cust"], account: ["My account", account, "any"],
};
const allowed = () => Object.entries(PAGES).filter(([, [, , r]]) => r === "any" || (S.kind === "customer" ? r === "cust" : r === "all" || (r === "mgr" && isMgr())));
function buildNav() {
  $("nav").innerHTML = allowed().map(([k, [t]]) => `<button data-page="${k}">${t}</button>`).join("");
}
$("nav").addEventListener("click", e => { const b = e.target.closest("[data-page]"); b && go(b.dataset.page); });
const drawer = open => { $("side").classList.toggle("open", open); $("scrim").classList.toggle("show", open); };
$("menuBtn").addEventListener("click", () => drawer(true));
$("scrim").addEventListener("click", () => drawer(false));
window.addEventListener("hashchange", () => S.me && go(location.hash.slice(1)));

async function go(page) {
  if (!allowed().some(([k]) => k === page)) page = S.kind === "customer" ? "shop" : "overview";
  location.hash = page; drawer(false); hide("flash");
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("on", b.dataset.page === page));
  $("title").textContent = PAGES[page][0];
  $("view").innerHTML = `<p class="muted">Loading…</p>`;
  try { await PAGES[page][1](); }
  catch (err) { $("view").innerHTML = `<div class="panel"><h3>Could not load this page</h3><p class="muted">${esc(err.message)}</p><br><button class="btn" id="retry">Try again</button></div>`; $("retry").onclick = () => go(page); }
}
const card = (l, v, foot = "") => `<div class="card"><small>${esc(l)}</small><b>${v}</b>${foot ? `<small>${esc(foot)}</small>` : ""}</div>`;
const table = (heads, rows, empty) => `<div class="tbl"><table><thead><tr>${heads.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td class="empty" colspan="${heads.length}">${empty}</td></tr>`}</tbody></table></div>`;
const filterRows = (input, tbodySel) => input.addEventListener("input", () => {
  const q = input.value.toLowerCase();
  document.querySelectorAll(`${tbodySel} tbody tr`).forEach(r => r.classList.toggle("hidden", !r.textContent.toLowerCase().includes(q)));
});
const periodStart = p => { const d = new Date(); d.setHours(0, 0, 0, 0); if (p === "all") return null; if (p === "week") d.setDate(d.getDate() - 6); if (p === "month") d.setDate(1); return d.toISOString(); };

/* ───────── overview ───────── */
async function overview() {
  const [items, sum, recent, pending] = await Promise.all([
    api.list("products", { eq: { archived: false } }),
    api.rpc("report_summary", { p_from: periodStart("month") }),
    api.list("sales", { order: "created_at", limit: 6 }),
    api.list("orders", { eq: { status: "PENDING" } }),
  ]);
  const low = items.filter(p => p.stock <= p.reorder_level);
  $("view").innerHTML = `
    <div class="cards">
      ${card("Revenue this month", money(sum.revenue), `${sum.transactions} sales`)}
      ${card("Expenses this month", money(sum.expenses))}
      ${card("Products", items.length, `${items.reduce((a, p) => a + p.stock, 0)} units in stock`)}
      ${card("Low stock", low.length, "At or below reorder level")}
      ${card("Pending orders", pending.length, "Waiting for approval")}
    </div>
    <div class="split">
      <div class="panel"><h3>Recent sales</h3>${table(["Receipt", "Date", "Total"], recent.map(s => `<tr><td><b>${esc(s.receipt_no)}</b></td><td>${when(s.created_at)}</td><td>${money(s.total)}</td></tr>`).join(""), "No sales yet.")}</div>
      <div class="panel"><h3>Needs restocking</h3>${low.length ? low.slice(0, 8).map(p => `<div class="line"><span>${esc(p.name)}</span><span class="tag ${p.stock ? "low" : "out"}">${p.stock} left</span></div>`).join("") : `<p class="muted">Everything is above its reorder level.</p>`}</div>
    </div>`;
}

/* ───────── inventory ───────── */
const stockTag = p => p.stock === 0 ? `<span class="tag out">Out of stock</span>` : p.stock <= p.reorder_level ? `<span class="tag low">Low</span>` : `<span class="tag">In stock</span>`;
async function products() {
  S.products = await api.list("products", { eq: { archived: false }, order: "created_at" });
  const rows = S.products.map(p => `<tr><td><b>${esc(p.name)}</b><br><small>${esc(p.sku || "No SKU")}</small></td><td>${esc(p.category || "—")}</td>${isMgr() ? `<td>${money(p.cost_price)}</td>` : ""}<td>${money(p.unit_price)}</td><td>${p.stock}</td><td>${stockTag(p)}</td>${isMgr() ? `<td><button class="btn light sm" data-edit="${p.id}">Edit</button><button class="btn light sm" data-stock="${p.id}">Stock</button><button class="btn red sm" data-archive="${p.id}">Archive</button></td>` : ""}</tr>`).join("");
  $("view").innerHTML = `<div class="panel"><div class="bar"><input id="q" placeholder="Search name, SKU or category" aria-label="Search products">${isMgr() ? `<button class="btn" id="add">+ Add product</button>` : ""}</div>
    <div id="pt">${table(["Product", "Category", ...(isMgr() ? ["Cost"] : []), "Price", "Stock", "Status", ...(isMgr() ? ["Actions"] : [])], rows, "No products yet.")}</div></div>
    ${isMgr() ? `<div class="panel"><h3>Recent stock movements</h3><div id="mv"></div></div>` : ""}`;
  filterRows($("q"), "#pt");
  if (!isMgr()) return;
  $("add").onclick = () => productDialog();
  $("view").onclick = async e => {
    const t = e.target.closest("button"); if (!t) return;
    const find = id => S.products.find(p => p.id === id);
    if (t.dataset.edit) productDialog(find(t.dataset.edit));
    if (t.dataset.stock) stockDialog(find(t.dataset.stock));
    if (t.dataset.archive && confirm("Archive this product? It will be hidden from inventory and sales.")) {
      try { await api.update("products", t.dataset.archive, { archived: true }); say("flash", "Product archived.", "ok"); products(); } catch (err) { say("flash", err.message); }
    }
  };
  const mv = await api.list("stock_movements", { order: "created_at", limit: 15 });
  $("mv").innerHTML = table(["Product", "Type", "Qty", "Before → After", "Note", "Date"], mv.map(m => `<tr><td>${esc(m.product_name)}</td><td>${label(m.kind)}</td><td>${m.qty}</td><td>${m.before_qty} → ${m.after_qty}</td><td>${esc(m.note || "")}</td><td>${when(m.created_at)}</td></tr>`).join(""), "No stock movements yet.");
}
function productDialog(p) {
  const f = (name, lab, val = "", attrs = "") => `<label>${lab}<input name="${name}" value="${esc(val)}" ${attrs}></label>`;
  dialogForm(p ? "Edit product" : "Add product", `
    <label class="full">Product name<input name="name" required maxlength="160" value="${esc(p?.name || "")}"></label>
    ${f("sku", "SKU (optional)", p?.sku, 'maxlength="80"')}${f("category", "Category", p?.category, 'maxlength="100"')}
    ${f("unit_price", "Selling price", p?.unit_price ?? "", 'type="number" min="0" step="0.01" required')}
    ${f("cost_price", "Cost price", p?.cost_price ?? 0, 'type="number" min="0" step="0.01" required')}
    ${p ? "" : f("stock", "Opening stock", 0, 'type="number" min="0" step="1" required')}
    ${f("reorder_level", "Reorder level", p?.reorder_level ?? 5, 'type="number" min="0" step="1" required')}`,
    p ? "Save changes" : "Add product", async v => {
      const row = { name: v.name.trim(), sku: v.sku.trim() || null, category: v.category.trim() || null, unit_price: +v.unit_price, cost_price: +v.cost_price, reorder_level: +v.reorder_level };
      if (p) await api.update("products", p.id, row);
      else await api.insert("products", { ...row, stock: +v.stock, company_id: S.co.id });
      say("flash", p ? "Product updated." : "Product added.", "ok"); products();
    });
}
function stockDialog(p) {
  dialogForm(`Adjust stock — ${p.name}`, `
    <label>Action<select name="kind"><option value="STOCK_IN">Receive stock (add)</option><option value="STOCK_OUT">Remove stock (loss/damage)</option><option value="COUNT">Set counted quantity</option></select></label>
    <label>Quantity<input name="qty" type="number" min="0" step="1" required></label>
    <label class="full">Note<input name="note" placeholder="e.g. Delivery note 123" maxlength="200"></label>
    <p class="hint full">Currently in stock: ${p.stock}</p>`, "Save", async v => {
    await api.rpc("adjust_stock", { p_product: p.id, p_kind: v.kind, p_qty: +v.qty, p_note: v.note });
    say("flash", "Stock updated.", "ok"); products();
  });
}

/* ───────── sales / point of sale ───────── */
const cartTotal = () => S.cart.reduce((a, c) => a + c.price * c.qty, 0);
async function sales() {
  const [list, items] = await Promise.all([api.list("sales", { order: "created_at" }), api.list("products", { eq: { archived: false }, order: "created_at" })]);
  S.products = items;
  const rows = list.map(s => `<tr><td><b>${esc(s.receipt_no)}</b></td><td>${when(s.created_at)}</td><td>${esc(s.served_by || "—")}</td><td>${label(s.payment_method)}</td><td>${money(s.total)}</td><td><button class="btn light sm" data-receipt="${s.id}">Receipt</button></td></tr>`).join("");
  $("view").innerHTML = `<div class="split">
    <div class="panel"><h3>New sale</h3><div class="bar"><input id="pq" placeholder="Search products" aria-label="Search products"></div><div id="pos"></div></div>
    <div class="panel"><h3>Cart</h3><div id="cart"></div></div></div>
    <div class="panel"><h3>Sales history</h3><div class="bar"><input id="sq" placeholder="Search receipt or staff" aria-label="Search sales"></div><div id="sh">${table(["Receipt", "Date", "Served by", "Payment", "Total", ""], rows, "No sales recorded yet.")}</div></div>`;
  $("pq").addEventListener("input", renderPos); filterRows($("sq"), "#sh");
  renderPos(); renderCart();
  $("view").onclick = async e => {
    const t = e.target.closest("button"); if (!t) return;
    cartClicks(t);
    if (t.dataset.receipt) showReceipt(list.find(s => s.id === t.dataset.receipt));
  };
}
function cartClicks(t) {
  if (t.dataset.add) addToCart(t.dataset.add);
  if (t.dataset.dec) changeQty(t.dataset.dec, -1);
  if (t.dataset.inc) changeQty(t.dataset.inc, 1);
  if (t.id === "clear") { S.cart = []; renderCart(); }
  if (t.id === "checkout") S.kind === "customer" ? orderDialog() : checkout();
}
function renderPos() {
  const q = ($("pq")?.value || "").toLowerCase();
  const list = S.products.filter(p => `${p.name} ${p.sku || ""}`.toLowerCase().includes(q));
  $("pos").innerHTML = list.map(p => `<div class="line"><span><b>${esc(p.name)}</b><br><small>${money(p.unit_price)} · ${p.stock} available</small></span><button class="btn sm" data-add="${p.id}" ${p.stock < 1 ? "disabled" : ""}>${p.stock < 1 ? "Sold out" : "Add"}</button></div>`).join("") || `<p class="muted">No products found. Add products in Inventory first.</p>`;
}
function renderCart() {
  if (!S.cart.length) return ($("cart").innerHTML = `<p class="muted">Cart is empty.</p>`);
  $("cart").innerHTML = S.cart.map(c => `<div class="line"><span><b>${esc(c.name)}</b><br><small>${money(c.price)} × ${c.qty}</small></span><span class="qty"><button class="btn light sm" data-dec="${c.id}" aria-label="Decrease">−</button><button class="btn light sm" data-inc="${c.id}" aria-label="Increase">+</button></span></div>`).join("")
    + `<div class="line"><b>Total</b><b>${money(cartTotal())}</b></div><div class="actions"><button class="btn light" id="clear">Clear</button><button class="btn" id="checkout">${S.kind === "customer" ? "Place order" : "Checkout"}</button></div>`;
}
function addToCart(id) {
  const p = S.products.find(x => x.id === id), c = S.cart.find(x => x.id === id);
  if (c) { if (c.qty >= p.stock) return say("flash", "No more stock available.", "error"); c.qty++; }
  else S.cart.push({ id, name: p.name, price: p.unit_price, qty: 1 });
  renderCart();
}
function changeQty(id, d) {
  const c = S.cart.find(x => x.id === id), p = S.products.find(x => x.id === id);
  c.qty = Math.min(c.qty + d, p.stock);
  if (c.qty <= 0) S.cart = S.cart.filter(x => x.id !== id);
  renderCart();
}
function checkout() {
  const sub = cartTotal();
  dialogForm("Complete sale", `
    <label>Discount<input name="discount" type="number" min="0" max="${sub}" step="0.01" value="0"></label>
    <label>Amount paid<input name="paid" type="number" min="0" step="0.01" value="${sub}" required></label>
    <label class="full">Payment method<select name="method"><option value="CASH">Cash</option><option value="MOBILE_MONEY">Mobile money</option><option value="CARD">Card</option><option value="BANK_TRANSFER">Bank transfer</option><option value="OTHER">Other</option></select></label>
    <p class="hint full">Subtotal ${money(sub)}. Final prices and stock are confirmed by the server.</p>`, "Confirm sale", async v => {
    const sale = await api.rpc("record_sale", { p_items: S.cart.map(c => ({ product_id: c.id, qty: c.qty })), p_payment: v.method, p_discount: +v.discount || 0, p_paid: +v.paid });
    S.cart = [];
    setTimeout(async () => { await go("sales"); showReceipt(sale); }, 0); // after the checkout dialog closes
  });
}
async function showReceipt(s) {
  const items = await api.list("sale_items", { eq: { sale_id: s.id } });
  modal("Receipt", `<div class="receipt"><h3>${esc(S.co.name)}</h3><p>${esc(s.receipt_no)}</p><p>${when(s.created_at)}</p><p>Served by ${esc(s.served_by || "—")}</p><hr>
    ${items.map(i => `<div class="line"><span>${esc(i.name)} × ${i.qty}</span><span>${money(i.qty * i.unit_price)}</span></div>`).join("")}<hr>
    <div class="line"><span>Subtotal</span><span>${money(s.subtotal)}</span></div><div class="line"><span>Discount</span><span>${money(s.discount)}</span></div>
    <div class="line"><b>Total</b><b>${money(s.total)}</b></div><div class="line"><span>Paid (${label(s.payment_method)})</span><span>${money(s.paid)}</span></div>
    <div class="line"><span>Change</span><span>${money(s.paid - s.total)}</span></div><hr><p>Thank you for your business.</p></div>
    <div class="actions">${cancelBtn.replace("Cancel", "Close")}<button class="btn" onclick="window.print()">Print</button></div>`);
}

/* ───────── expenses ───────── */
async function expenses() {
  const list = await api.list("expenses", { order: "spent_at" });
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const month = list.filter(x => new Date(x.spent_at) >= monthStart).reduce((a, x) => a + +x.amount, 0);
  $("view").innerHTML = `<div class="cards">${card("This month", money(month))}${card("Entries", list.length)}${card("Categories", new Set(list.map(x => x.category)).size)}</div>
    <div class="panel"><div class="bar"><input id="q" placeholder="Search expenses" aria-label="Search expenses"><button class="btn" id="add">+ Add expense</button></div>
    <div id="et">${table(["Description", "Category", "Date", "Amount"], list.map(x => `<tr><td>${esc(x.description)}</td><td>${esc(x.category)}</td><td>${when(x.spent_at)}</td><td>${money(x.amount)}</td></tr>`).join(""), "No expenses recorded.")}</div></div>`;
  filterRows($("q"), "#et");
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $("add").onclick = () => dialogForm("Add expense", `
    <label class="full">Description<input name="description" required maxlength="240"></label>
    <label>Category<input name="category" required maxlength="100" placeholder="Rent, transport…"></label>
    <label>Amount<input name="amount" type="number" min="0" step="0.01" required></label>
    <label class="full">Date<input name="date" type="datetime-local" value="${now}" required></label>`, "Save expense", async v => {
    await api.insert("expenses", { company_id: S.co.id, created_by: S.user.id, description: v.description.trim(), category: v.category.trim(), amount: +v.amount, spent_at: new Date(v.date).toISOString() });
    say("flash", "Expense saved.", "ok"); expenses();
  });
}

/* ───────── suppliers ───────── */
async function suppliers() {
  const list = await api.list("suppliers", { order: "created_at" });
  $("view").innerHTML = `<div class="panel"><div class="bar"><input id="q" placeholder="Search suppliers" aria-label="Search suppliers"><button class="btn" id="add">+ Add supplier</button></div>
    <div id="st">${table(["Supplier", "Contact", "Phone", "Email"], list.map(s => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.contact_name || "—")}</td><td>${esc(s.phone || "—")}</td><td>${esc(s.email || "—")}</td></tr>`).join(""), "No suppliers yet.")}</div></div>`;
  filterRows($("q"), "#st");
  $("add").onclick = () => dialogForm("Add supplier", `
    <label class="full">Supplier name<input name="name" required maxlength="160"></label>
    <label>Contact person<input name="contact" maxlength="120"></label><label>Phone<input name="phone" maxlength="40"></label>
    <label class="full">Email<input name="email" type="email" maxlength="254"></label>`, "Save supplier", async v => {
    await api.insert("suppliers", { company_id: S.co.id, name: v.name.trim(), contact_name: v.contact.trim() || null, phone: v.phone.trim() || null, email: v.email.trim() || null });
    say("flash", "Supplier added.", "ok"); suppliers();
  });
}

/* ───────── reports ───────── */
async function reports() {
  const from = periodStart(S.period), r = await api.rpc("report_summary", { p_from: from });
  const gross = r.revenue - r.cost, net = gross - r.expenses, pay = Object.entries(r.by_payment || {});
  const pct = v => (r.revenue > 0 ? Math.max(0, Math.min(100, (v / r.revenue) * 100)) : 0);
  $("view").innerHTML = `<div class="bar"><select id="period" aria-label="Report period">${[["today", "Today"], ["week", "Last 7 days"], ["month", "This month"], ["all", "All time"]].map(([k, l]) => `<option value="${k}" ${k === S.period ? "selected" : ""}>${l}</option>`).join("")}</select><button class="btn light" id="csv">Export sales CSV</button></div>
    <div class="cards">${card("Revenue", money(r.revenue), `${r.transactions} sales`)}${card("Cost of goods", money(r.cost))}${card("Gross profit", money(gross))}${card("Net profit", money(net), `After ${money(r.expenses)} expenses`)}</div>
    <div class="split"><div class="panel"><h3>Breakdown</h3>
      ${[["Cost of goods", r.cost], ["Expenses", r.expenses], ["Net profit", Math.max(net, 0)]].map(([l, v]) => `<div class="pay-row"><span>${l}</span><b>${money(v)}</b></div><div class="meter"><i style="width:${pct(v)}%"></i></div>`).join("")}</div>
      <div class="panel"><h3>Payment methods</h3>${pay.map(([k, v]) => `<div class="pay-row"><span>${label(k)}</span><b>${money(v)}</b></div>`).join("") || `<p class="muted">No sales in this period.</p>`}</div></div>`;
  $("period").onchange = e => { S.period = e.target.value; reports(); };
  $("csv").onclick = async () => {
    const rows = (await api.list("sales", { order: "created_at", limit: 5000 })).filter(s => !from || s.created_at >= from);
    const csv = [["Receipt", "Date", "Served by", "Payment", "Subtotal", "Discount", "Total", "Cost"], ...rows.map(s => [s.receipt_no, s.created_at, s.served_by, s.payment_method, s.subtotal, s.discount, s.total, s.cost_total])]
      .map(r => r.map(v => `"${String(v ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv" })), download: "pm-creative-studio-sales.csv" });
    a.click(); URL.revokeObjectURL(a.href);
  };
}

/* ───────── staff ───────── */
async function staff() {
  const [team, invites] = await Promise.all([api.list("profiles", { order: "created_at" }), api.list("invites", { order: "created_at" })]);
  const rows = team.map(m => `<tr><td><b>${esc(m.full_name)}</b><br><small>${esc(m.email)}</small></td><td>${m.role}</td><td><span class="tag ${m.active ? "" : "out"}">${m.active ? "Active" : "Inactive"}</span></td><td>${m.role === "OWNER" || m.id === S.user.id || (m.role === "ADMIN" && S.me.role !== "OWNER") ? "" : `<button class="btn light sm" data-toggle="${m.id}" data-to="${!m.active}">${m.active ? "Deactivate" : "Activate"}</button>`}</td></tr>`).join("");
  $("view").innerHTML = `<div class="panel"><div class="bar"><h3>Team</h3><button class="btn" id="invite">+ Invite staff</button></div>${table(["Member", "Role", "Status", ""], rows, "No team members.")}</div>
    <div class="panel"><h3>Pending invitations</h3>${table(["Email", "Role", ""], invites.map(i => `<tr><td>${esc(i.email)}</td><td>${i.role}</td><td><button class="btn light sm" data-resend="${esc(i.email)}">Resend email</button> <button class="btn red sm" data-cancel="${i.id}">Cancel</button></td></tr>`).join(""), "No pending invitations.")}
    <p class="hint">Invited people receive an email with a sign-in link, then choose their own password. If the email does not arrive, they can use “Join team” with the invited address.</p></div>`;
  $("invite").onclick = () => dialogForm("Invite staff", `
    <label class="full">Email<input name="email" type="email" required></label>
    <label class="full">Role<select name="role"><option value="EMPLOYEE">Employee (sales, expenses)</option>${S.me.role === "OWNER" ? `<option value="ADMIN">Administrator (stock, staff, reports)</option>` : ""}</select></label>`, "Send invitation", async v => {
    await api.rpc("invite_staff", { p_email: v.email, p_role: v.role });
    try { await api.magicLink(v.email.trim().toLowerCase()); say("flash", "Invitation emailed.", "ok"); }
    catch (err) { say("flash", `Invitation saved, but the email could not be sent (${err.message}). They can still use “Join team”.`); }
    staff();
  });
  $("view").onclick = async e => {
    const t = e.target.closest("button"); if (!t) return;
    try {
      if (t.dataset.resend) { await api.magicLink(t.dataset.resend); say("flash", "Invitation email sent again.", "ok"); }
      if (t.dataset.toggle) await api.rpc("set_staff_active", { p_user: t.dataset.toggle, p_active: t.dataset.to === "true" });
      if (t.dataset.cancel) await api.rpc("cancel_invite", { p_id: t.dataset.cancel });
      if (t.dataset.toggle || t.dataset.cancel) staff();
    } catch (err) { say("flash", err.message); }
  };
}


/* ───────── customer shop + orders ───────── */
const statusTag = st => `<span class="tag ${{ PENDING: "info", APPROVED: "", REJECTED: "out", CANCELLED: "out" }[st]}">${label(st)}</span>`;
const itemList = o => o.order_items.map(i => `${esc(i.name)} × ${i.qty}`).join(", ");

async function shop() {
  S.products = await api.rpc("shop_catalog");
  $("view").innerHTML = `<div class="split"><div class="panel"><h3>${esc(S.co.name)}</h3><div class="bar"><input id="pq" placeholder="Search products" aria-label="Search products"></div><div id="pos"></div></div>
    <div class="panel"><h3>Your order</h3><div id="cart"></div></div></div>`;
  $("pq").addEventListener("input", renderPos); renderPos(); renderCart();
  $("view").onclick = e => { const t = e.target.closest("button"); t && cartClicks(t); };
}
function orderDialog() {
  dialogForm("Place order", `<label class="full">Note for the shop (optional)<input name="note" maxlength="300" placeholder="Delivery or pickup details"></label>
    <p class="hint full">Total ${money(cartTotal())}. The shop confirms your order once stock is checked.</p>`, "Send order", async v => {
    await api.rpc("place_order", { p_items: S.cart.map(c => ({ product_id: c.id, qty: c.qty })), p_note: v.note });
    S.cart = []; setTimeout(() => { go("myorders"); say("flash", "Order sent. You can follow its status here.", "ok"); }, 0);
  });
}
async function myorders() {
  const list = await api.list("orders", { select: "*, order_items(*)", order: "created_at" });
  $("view").innerHTML = `<div class="panel">${table(["Order", "Date", "Items", "Total", "Status", ""], list.map(o => `<tr><td><b>${esc(o.order_no)}</b></td><td>${when(o.created_at)}</td><td style="white-space:normal;min-width:180px">${itemList(o)}</td><td>${money(o.total)}</td><td>${statusTag(o.status)}${o.decision_note ? `<br><small>${esc(o.decision_note)}</small>` : ""}</td><td>${o.status === "PENDING" ? `<button class="btn red sm" data-cancel="${o.id}">Cancel</button>` : ""}</td></tr>`).join(""), "You have not placed any orders yet.")}</div>`;
  $("view").onclick = async e => {
    const id = e.target.closest("[data-cancel]")?.dataset.cancel; if (!id || !confirm("Cancel this order?")) return;
    try { await api.rpc("cancel_order", { p_id: id }); say("flash", "Order cancelled.", "ok"); myorders(); } catch (err) { say("flash", err.message); }
  };
}
async function orders() {
  const list = await api.list("orders", { select: "*, customer:customers(full_name, phone, email), order_items(*)", order: "created_at" });
  $("view").innerHTML = `<div class="panel"><div class="bar"><input id="q" placeholder="Search orders or customers" aria-label="Search orders"></div><div id="ot">${table(["Order", "Customer", "Items", "Total", "Status", ""], list.map(o => `<tr><td><b>${esc(o.order_no)}</b><br><small>${when(o.created_at)}</small></td><td>${esc(o.customer?.full_name)}<br><small>${esc(o.customer?.phone || o.customer?.email || "")}</small></td><td style="white-space:normal;min-width:180px">${itemList(o)}${o.note ? `<br><small>Note: ${esc(o.note)}</small>` : ""}</td><td>${money(o.total)}</td><td>${statusTag(o.status)}</td><td>${o.status === "PENDING" ? `<button class="btn sm" data-ok="${o.id}">Approve</button> <button class="btn red sm" data-no="${o.id}">Reject</button>` : ""}</td></tr>`).join(""), "No orders yet. Share your shop link from Company settings.")}</div></div>`;
  filterRows($("q"), "#ot");
  $("view").onclick = async e => {
    const t = e.target.closest("button"); if (!t || !(t.dataset.ok || t.dataset.no)) return;
    try {
      if (t.dataset.ok) { if (!confirm("Approve this order? Stock will be deducted and a sale recorded.")) return; await api.rpc("decide_order", { p_id: t.dataset.ok, p_approve: true }); say("flash", "Order approved and recorded as a sale.", "ok"); }
      else { const reason = prompt("Reason for rejecting (shown to the customer):"); if (reason === null) return; await api.rpc("decide_order", { p_id: t.dataset.no, p_approve: false, p_reason: reason }); say("flash", "Order rejected.", "ok"); }
      orders();
    } catch (err) { say("flash", err.message); }
  };
}

/* ───────── audit log ───────── */
async function audit() {
  const list = await api.list("audit_log", { order: "created_at", limit: 300 });
  $("view").innerHTML = `<div class="panel"><div class="bar"><input id="q" placeholder="Search activity" aria-label="Search audit log"></div><div id="at">${table(["Date", "Who", "Action", "Detail"], list.map(a => `<tr><td>${when(a.created_at)}</td><td>${esc(a.actor_name)}</td><td>${esc(label(a.action))}</td><td>${esc(a.detail)}</td></tr>`).join(""), "No activity recorded yet.")}</div><p class="hint">Showing the latest 300 actions.</p></div>`;
  filterRows($("q"), "#at");
}

/* ───────── settings + account ───────── */
const shopUrl = slug => `${location.origin}${location.pathname}?shop=${slug}`;
async function settings() {
  $("view").innerHTML = `<div class="panel" style="max-width:520px"><form id="f" class="stack"><p id="m" class="msg hidden"></p>
    <label>Business name<input name="name" required maxlength="140" value="${esc(S.co.name)}"></label>
    <label>Currency<select name="currency">${["ZMW", "USD", "GBP", "EUR", "ZAR"].map(c => `<option ${c === S.co.currency ? "selected" : ""}>${c}</option>`).join("")}</select></label>
    <label>Shop code <small>customers use this to order</small><input name="slug" required pattern="[a-z0-9][a-z0-9\\-]{2,59}" value="${esc(S.co.slug)}"></label>
    <p class="hint">Shop link: <b id="shopLink">${esc(shopUrl(S.co.slug))}</b> <button type="button" class="btn light sm" id="copyLink">Copy</button></p>
    <p class="hint">Changing currency changes how amounts are displayed. It does not convert past transactions.</p><button class="btn">Save settings</button></form></div>`;
  $("copyLink").onclick = () => navigator.clipboard.writeText($("shopLink").textContent).then(() => say("m", "Link copied.", "ok"));
  guard($("f"), "m", async v => {
    S.co = await api.update("companies", S.co.id, { name: v.name.trim(), currency: v.currency, slug: v.slug.trim().toLowerCase() });
    $("shopLink").textContent = shopUrl(S.co.slug);
    $("coName").textContent = S.co.name; say("m", "Settings saved.", "ok");
  });
}
async function account() {
  $("view").innerHTML = `<div class="panel" style="max-width:520px"><p><b>${esc(S.me.full_name)}</b><br><small>${esc(S.me.email)} · ${S.me.role}</small></p><br>
    <form id="f" class="stack"><p id="m" class="msg hidden"></p><label>New password<input name="p1" type="password" minlength="10" required autocomplete="new-password"></label>
    <label>Confirm new password<input name="p2" type="password" minlength="10" required autocomplete="new-password"></label><button class="btn">Change password</button></form></div>`;
  guard($("f"), "m", async (v, f) => {
    if (v.p1 !== v.p2) throw new Error("Passwords do not match.");
    await api.setPassword(v.p1); f.reset(); say("m", "Password changed.", "ok");
  });
}

/* ───────── start ───────── */
sb.auth.onAuthStateChange(ev => {
  if (ev === "SIGNED_OUT" && S.me) location.reload();
  if (ev === "PASSWORD_RECOVERY") { S.recovery = true; if (S.me) passwordDialog(); }
});
if (!configured) {
  showAuth("Supabase is not configured yet. Add your project URL and anon key in public/js/config.js.");
} else {
  boot().catch(err => showAuth(err.message));
}
