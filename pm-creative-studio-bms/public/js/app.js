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
const tabs = { Login: "formLogin", Create: "formCreate", Join: "formJoin" };
Object.keys(tabs).forEach(k => $(`tab${k}`).addEventListener("click", () => {
  Object.entries(tabs).forEach(([t, f]) => { $(f).classList.toggle("hidden", t !== k); $(`tab${t}`).classList.toggle("on", t === k); });
  hide("authMsg");
}));

guard($("formLogin"), "authMsg", async v => { await api.signIn(v.email.trim(), v.password); await boot(); });
const signUpFlow = (intent) => async v => {
  const res = await api.signUp(v.email.trim(), v.password, { intent, company: v.company, name: v.name });
  if (!res.session) return say("authMsg", "Account created. Confirm your email, then sign in.", "ok");
  await boot();
};
guard($("formCreate"), "authMsg", signUpFlow("create"));
guard($("formJoin"), "authMsg", signUpFlow("join"));

$("logout").addEventListener("click", async () => { await api.signOut(); location.reload(); });

async function boot() {
  const session = await api.session();
  if (!session) return showAuth();
  S.user = session.user;
  let p = await api.profile(S.user.id);
  if (!p) {
    const m = S.user.user_metadata || {};
    if (m.intent === "create") await api.rpc("create_workspace", { p_company: m.company, p_name: m.name });
    else if (m.intent === "join") await api.rpc("join_workspace", { p_name: m.name });
    p = await api.profile(S.user.id);
  }
  if (!p || !p.active) {
    await api.signOut();
    return showAuth(p ? "This account has been deactivated. Contact your owner." : "No workspace found for this account. Create one or ask to be invited.");
  }
  S.me = p; S.co = p.company;
  $("auth").classList.add("hidden"); $("shell").classList.remove("hidden");
  $("coName").textContent = S.co.name;
  $("who").textContent = `${p.full_name} · ${p.role}`;
  buildNav(); go(location.hash.slice(1));
}
function showAuth(msg) {
  $("shell").classList.add("hidden"); $("auth").classList.remove("hidden");
  msg && say("authMsg", msg);
}

/* ───────── navigation ───────── */
const PAGES = {
  overview: ["Overview", overview, "all"], products: ["Inventory", products, "all"], sales: ["Sales", sales, "all"],
  expenses: ["Expenses", expenses, "all"], suppliers: ["Suppliers", suppliers, "all"], reports: ["Reports", reports, "mgr"],
  staff: ["Staff", staff, "mgr"], settings: ["Company settings", settings, "mgr"], account: ["My account", account, "all"],
};
const allowed = () => Object.entries(PAGES).filter(([, [, , r]]) => r === "all" || isMgr());
function buildNav() {
  $("nav").innerHTML = allowed().map(([k, [t]]) => `<button data-page="${k}">${t}</button>`).join("");
}
$("nav").addEventListener("click", e => { const b = e.target.closest("[data-page]"); b && go(b.dataset.page); });
const drawer = open => { $("side").classList.toggle("open", open); $("scrim").classList.toggle("show", open); };
$("menuBtn").addEventListener("click", () => drawer(true));
$("scrim").addEventListener("click", () => drawer(false));
window.addEventListener("hashchange", () => S.me && go(location.hash.slice(1)));

async function go(page) {
  if (!allowed().some(([k]) => k === page)) page = "overview";
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
  const [items, sum, recent] = await Promise.all([
    api.list("products", { eq: { archived: false } }),
    api.rpc("report_summary", { p_from: periodStart("month") }),
    api.list("sales", { order: "created_at", limit: 6 }),
  ]);
  const low = items.filter(p => p.stock <= p.reorder_level);
  $("view").innerHTML = `
    <div class="cards">
      ${card("Revenue this month", money(sum.revenue), `${sum.transactions} sales`)}
      ${card("Expenses this month", money(sum.expenses))}
      ${card("Products", items.length, `${items.reduce((a, p) => a + p.stock, 0)} units in stock`)}
      ${card("Low stock", low.length, "At or below reorder level")}
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
    if (t.dataset.add) addToCart(t.dataset.add);
    if (t.dataset.dec) changeQty(t.dataset.dec, -1);
    if (t.dataset.inc) changeQty(t.dataset.inc, 1);
    if (t.dataset.receipt) showReceipt(list.find(s => s.id === t.dataset.receipt));
    if (t.id === "clear") { S.cart = []; renderCart(); }
    if (t.id === "checkout") checkout();
  };
}
function renderPos() {
  const q = ($("pq")?.value || "").toLowerCase();
  const list = S.products.filter(p => `${p.name} ${p.sku || ""}`.toLowerCase().includes(q));
  $("pos").innerHTML = list.map(p => `<div class="line"><span><b>${esc(p.name)}</b><br><small>${money(p.unit_price)} · ${p.stock} available</small></span><button class="btn sm" data-add="${p.id}" ${p.stock < 1 ? "disabled" : ""}>${p.stock < 1 ? "Sold out" : "Add"}</button></div>`).join("") || `<p class="muted">No products found. Add products in Inventory first.</p>`;
}
function renderCart() {
  if (!S.cart.length) return ($("cart").innerHTML = `<p class="muted">Cart is empty.</p>`);
  $("cart").innerHTML = S.cart.map(c => `<div class="line"><span><b>${esc(c.name)}</b><br><small>${money(c.price)} × ${c.qty}</small></span><span class="qty"><button class="btn light sm" data-dec="${c.id}" aria-label="Decrease">−</button><button class="btn light sm" data-inc="${c.id}" aria-label="Increase">+</button></span></div>`).join("")
    + `<div class="line"><b>Total</b><b>${money(cartTotal())}</b></div><div class="actions"><button class="btn light" id="clear">Clear</button><button class="btn" id="checkout">Checkout</button></div>`;
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
    <div class="panel"><h3>Pending invitations</h3>${table(["Email", "Role", ""], invites.map(i => `<tr><td>${esc(i.email)}</td><td>${i.role}</td><td><button class="btn red sm" data-cancel="${i.id}">Cancel</button></td></tr>`).join(""), "No pending invitations.")}
    <p class="hint">Invited people open the app, choose “Join team”, and create their own password using the invited email.</p></div>`;
  $("invite").onclick = () => dialogForm("Invite staff", `
    <label class="full">Email<input name="email" type="email" required></label>
    <label class="full">Role<select name="role"><option value="EMPLOYEE">Employee (sales, expenses)</option>${S.me.role === "OWNER" ? `<option value="ADMIN">Administrator (stock, staff, reports)</option>` : ""}</select></label>`, "Send invitation", async v => {
    await api.rpc("invite_staff", { p_email: v.email, p_role: v.role }); say("flash", "Invitation saved. Ask them to use “Join team”.", "ok"); staff();
  });
  $("view").onclick = async e => {
    const t = e.target.closest("button"); if (!t) return;
    try {
      if (t.dataset.toggle) await api.rpc("set_staff_active", { p_user: t.dataset.toggle, p_active: t.dataset.to === "true" });
      if (t.dataset.cancel) await api.rpc("cancel_invite", { p_id: t.dataset.cancel });
      if (t.dataset.toggle || t.dataset.cancel) staff();
    } catch (err) { say("flash", err.message); }
  };
}

/* ───────── settings + account ───────── */
async function settings() {
  $("view").innerHTML = `<div class="panel" style="max-width:520px"><form id="f" class="stack"><p id="m" class="msg hidden"></p>
    <label>Business name<input name="name" required maxlength="140" value="${esc(S.co.name)}"></label>
    <label>Currency<select name="currency">${["ZMW", "USD", "GBP", "EUR", "ZAR"].map(c => `<option ${c === S.co.currency ? "selected" : ""}>${c}</option>`).join("")}</select></label>
    <p class="hint">Changing currency changes how amounts are displayed. It does not convert past transactions.</p><button class="btn">Save settings</button></form></div>`;
  guard($("f"), "m", async v => {
    S.co = await api.update("companies", S.co.id, { name: v.name.trim(), currency: v.currency });
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
sb.auth.onAuthStateChange(ev => { if (ev === "SIGNED_OUT" && S.me) location.reload(); });
if (!configured) {
  showAuth("Supabase is not configured yet. Add your project URL and anon key in public/js/config.js.");
} else {
  boot().catch(err => showAuth(err.message));
}
