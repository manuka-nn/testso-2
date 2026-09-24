// ------------------------------------------------------------
// Seamline services: every business rule lives here.
// The UI never edits data directly; it calls these functions.
// ------------------------------------------------------------
import { db, save, uid, nextNumber, now, iso, secureToken, sha256, ymd, baseUrl, DEFAULT_CATEGORIES } from './db.js';

// ---------- constants ----------
export const ROLES = { admin: 'Admin', sales: 'Sales', operations: 'Operations', finance: 'Finance' };
export const PERMISSIONS = {
  admin: ['*'],
  sales: ['dashboard', 'leads', 'quotes', 'customers', 'customers.edit', 'orders', 'orders.create', 'products',
    'catalogue', 'reorders', 'reports', 'reports.sales', 'reports.customers', 'search'],
  operations: ['dashboard', 'orders', 'orders.status', 'orders.costs', 'production', 'products', 'products.edit', 'catalogue',
    'inventory', 'inventory.edit', 'suppliers', 'purchasing', 'reorders', 'search', 'reports',
    'reports.inventory', 'reports.operations'],
  finance: ['dashboard', 'orders', 'orders.costs', 'customers', 'payments', 'invoices', 'expenses', 'profit', 'reports',
    'reports.sales', 'reports.profit', 'reports.customers', 'reports.inventory', 'reports.operations',
    'suppliers', 'search'],
};
export const CUSTOMER_TYPES = ['Corporate', 'Clothing Brand', 'Creator', 'Restaurant', 'Hotel', 'School', 'University',
  'Event', 'Retailer', 'Individual', 'Wholesale Customer'];
export const CUSTOMER_SOURCES = ['Referral', 'Instagram', 'Facebook', 'Website', 'WhatsApp', 'Walk-in', 'Exhibition', 'Existing network', 'Other'];
export const REQUEST_PRODUCT_TYPES = ['T-shirt', 'Polo', 'Hoodie', 'Cap', 'Bottle', 'Bag', 'Uniform', 'Promotional merchandise', 'Custom product', 'Other'];
export const CATEGORIES = DEFAULT_CATEGORIES;
export const PRODUCT_KINDS = ['Ready stock', 'Made to order', 'Both'];
export const BUSINESS_TYPES = ['Manufacturing', 'Wholesale', 'Customization', 'Corporate', 'Other'];
export const PRODUCTION_FLOW = ['Awaiting Materials', 'Production Scheduled', 'In Production', 'Quality Control', 'Ready'];
export const DELIVERY_FLOW = ['Not Dispatched', 'Packed', 'Dispatched', 'Out for Delivery', 'Delivered'];
export const QUOTE_STATUSES = ['Draft', 'Sent', 'Viewed', 'Approved', 'Rejected', 'Expired', 'Converted to order'];
export const LEAD_STAGES = ['Lead', 'Contacted', 'Requirement Received', 'Quote Created', 'Quote Sent', 'Negotiation', 'Approved', 'Order', 'Completed', 'Repeat Customer'];
export const EXPENSE_CATEGORIES = ['Salaries', 'Rent', 'Marketing', 'Software', 'Transport', 'Packaging', 'Utilities', 'Supplier payments', 'Other'];
export const PAYMENT_METHODS = ['Bank transfer', 'Cash', 'Card', 'Cheque', 'Online gateway'];
export const MANUAL_MOVEMENTS = ['Purchase', 'Manufacturing received', 'Manufacturing consumed', 'Customer return',
  'Customer return (damaged)', 'Supplier return', 'Stock adjustment', 'Damaged', 'Lost'];

const PUBLIC_MESSAGES = {
  'Awaiting Materials': 'We are sourcing materials for your order.',
  'Production Scheduled': 'Your order has been scheduled for production.',
  'In Production': 'Your order has entered production.',
  'Quality Control': 'Your products are going through quality checks.',
  'Ready': 'Your order is ready.',
  'Packed': 'Your order has been packed.',
  'Dispatched': 'Your order has been dispatched.',
  'Out for Delivery': 'Your order is out for delivery.',
  'Delivered': 'Your order has been delivered.',
};

// ---------- actor / permissions ----------
let actor = { id: 'system', name: 'System', role: 'admin', kind: 'staff' };
export const setActor = a => { actor = a; };
export const getActor = () => actor;
export function can(user, perm) {
  if (!user) return false;
  const p = PERMISSIONS[user.role] || [];
  return p.includes('*') || p.includes(perm);
}
function need(perm) {
  if (actor.kind === 'staff' && !can(actor, perm)) throw new Error(`Your role (${ROLES[actor.role]}) can't do this.`);
}

// ---------- small helpers ----------
export const get = (col, id) => db()[col].find(x => x.id === id);
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const sum = (arr, f) => arr.reduce((a, x) => a + (typeof f === 'function' ? f(x) : num(x[f])), 0);
export const customerName = c => (c ? (c.company || c.contact || 'Unnamed customer') : 'Unknown customer');
export const money = n => `Rs. ${Math.round(num(n)).toLocaleString('en-US')}`;
export const startOfDay = (d = now()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const endOfDay = (d = now()) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
export const startOfMonth = (d = now()) => new Date(d.getFullYear(), d.getMonth(), 1);
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const dateOnly = d => ymd(d);
const inRange = (d, from, to) => { const t = new Date(d).getTime(); return (!from || t >= from.getTime()) && (!to || t <= to.getTime()); };
function diff(before, after, fields) {
  return fields.filter(f => after[f] !== undefined && String(before[f] ?? '') !== String(after[f] ?? ''))
    .map(f => `${f}: "${before[f] ?? ''}" → "${after[f]}"`).join('; ');
}

export function logAudit(action, entity, ref, detail = '') {
  const a = db().audit;
  a.unshift({ id: uid('log'), at: iso(), userId: actor.id, userName: actor.name, action, entity, ref, detail });
  if (a.length > 3000) a.length = 3000;
}

// Notification infrastructure. Each event goes to channels; email is queued in an
// outbox until a mail service is connected. A WhatsApp channel can be added the same way.
export const NOTIFICATION_CHANNELS = {
  inApp: n => { db().notifications.unshift(n); if (db().notifications.length > 500) db().notifications.length = 500; },
  email: n => { if (n.email) db().outbox.unshift({ id: uid('mail'), at: n.at, to: n.email, subject: n.text, status: 'Queued — no mail service connected', channel: 'Email' }); },
};
export function notify(event, text, { link = '', audience = 'staff', customerId = null, email = null } = {}) {
  const n = { id: uid('ntf'), at: iso(), event, text, link, audience, customerId, email, read: false };
  NOTIFICATION_CHANNELS.inApp(n);
  NOTIFICATION_CHANNELS.email(n);
}
export function markNotificationsRead(audience = 'staff', customerId = null) {
  db().notifications.forEach(n => { if (n.audience === audience && (!customerId || n.customerId === customerId)) n.read = true; });
  save();
}

// ---------- users ----------
export async function login(email, password) {
  const u = db().users.find(x => x.email.toLowerCase() === String(email).trim().toLowerCase());
  if (!u) throw new Error('No team account uses that email.');
  if (u.active === false) throw new Error('This account has been deactivated.');
  if (await sha256(u.salt + password) !== u.hash) throw new Error('That password is incorrect.');
  return u;
}
export async function saveUser(data) {
  need('users');
  const d = db();
  const email = String(data.email || '').trim().toLowerCase();
  if (!data.name || !email) throw new Error('Name and email are required.');
  if (!ROLES[data.role]) throw new Error('Choose a role.');
  if (d.users.some(u => u.email === email && u.id !== data.id)) throw new Error('Another user already uses that email.');
  let u = data.id ? get('users', data.id) : null;
  if (u) {
    const before = u.role;
    Object.assign(u, { name: data.name, email, role: data.role, active: data.active !== false && data.active !== 'false' });
    if (before !== u.role) logAudit('Changed user role', 'user', u.email, `${before} → ${u.role}`);
  } else {
    if (!data.external && (!data.password || data.password.length < 8)) throw new Error('Passwords need at least 8 characters.');
    u = { id: uid('usr'), name: data.name, email, role: data.role, active: true, createdAt: iso() };
    d.users.push(u);
    logAudit('Created user', 'user', email, ROLES[u.role]);
  }
  if (data.password && !data.external) {
    if (data.password.length < 8) throw new Error('Passwords need at least 8 characters.');
    u.salt = secureToken(8);
    u.hash = await sha256(u.salt + data.password);
  }
  save();
  return u;
}

// ---------- customers ----------
const CUSTOMER_FIELDS = ['company', 'contact', 'email', 'phone', 'whatsapp', 'address', 'type', 'industry', 'source', 'status'];
export function saveCustomer(data) {
  need('customers.edit');
  if (!String(data.company || '').trim() && !String(data.contact || '').trim()) throw new Error('Add a company or contact name.');
  const d = db();
  if (data.id) {
    const c = get('customers', data.id);
    const changes = diff(c, data, CUSTOMER_FIELDS);
    CUSTOMER_FIELDS.forEach(f => { if (data[f] !== undefined) c[f] = String(data[f]).trim(); });
    if (changes) logAudit('Updated customer', 'customer', c.code, changes);
    save();
    return c;
  }
  const c = { id: uid('cus'), code: nextNumber('customer', 'SL-C', 5, false), notes: [], portal: null, createdAt: iso() };
  CUSTOMER_FIELDS.forEach(f => { c[f] = String(data[f] ?? '').trim(); });
  c.status = c.status || 'Active';
  c.type = c.type || 'Corporate';
  d.customers.push(c);
  logAudit('Created customer', 'customer', c.code, customerName(c));
  save();
  return c;
}
export function addCustomerNote(id, text) {
  need('customers.edit');
  if (!String(text).trim()) throw new Error('Write a note first.');
  get('customers', id).notes.unshift({ at: iso(), by: actor.name, text: String(text).trim() });
  save();
}
export async function setPortalAccess(customerId, email, password, external = false) {
  need('customers.edit');
  const c = get('customers', customerId);
  const e = String(email || '').trim().toLowerCase();
  if (!e) throw new Error('Add the login email.');
  if (db().customers.some(x => x.id !== customerId && x.portal?.email === e)) throw new Error('Another customer already uses that portal email.');
  if (db().users.some(u => u.email === e)) throw new Error('That email belongs to a team member. Use a different email for the customer.');
  if (external) c.portal = { email: e, enabledAt: iso() };
  else {
    if (!password || password.length < 8) throw new Error('Passwords need at least 8 characters.');
    const salt = secureToken(8);
    c.portal = { email: e, salt, hash: await sha256(salt + password), enabledAt: iso() };
  }
  logAudit('Enabled portal access', 'customer', c.code, e);
  save();
}
export function revokePortalAccess(customerId) {
  need('customers.edit');
  const c = get('customers', customerId);
  c.portal = null;
  logAudit('Removed portal access', 'customer', c.code);
  save();
}
export async function customerLogin(email, password) {
  const e = String(email).trim().toLowerCase();
  const c = db().customers.find(x => x.portal?.email === e);
  if (!c || !c.portal.hash) throw new Error('No customer account uses that email. Ask Seamline to enable portal access.');
  if (await sha256(c.portal.salt + password) !== c.portal.hash) throw new Error('That password is incorrect.');
  return c;
}
export function customerStats(customerId) {
  const orders = db().orders.filter(o => o.customerId === customerId && o.state !== 'Cancelled');
  const live = orders.filter(o => o.state !== 'Draft');
  const revenue = sum(live, o => docTotals(o).total);
  const outstanding = sum(live, o => Math.max(0, orderTotals(o).balance));
  const last = [...orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  return {
    orders: orders.length, revenue, outstanding,
    active: orders.filter(o => o.state === 'Confirmed' || o.state === 'Draft').length,
    lastOrder: last || null,
  };
}

// ---------- products & variants ----------
const PRODUCT_FIELDS = ['name', 'category', 'kind', 'description', 'material', 'supplierId', 'supplierSku', 'method', 'status', 'image'];
const NUM_PRODUCT_FIELDS = ['moq', 'wholesalePrice', 'retailPrice'];
const abbr = s => String(s).replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || 'STD';
export function saveProduct(data, variantRows = []) {
  need('products.edit');
  if (!String(data.name || '').trim()) throw new Error('Give the product a name.');
  const d = db();
  let p = data.id ? get('products', data.id) : null;
  if (p) {
    const changes = diff(p, data, [...PRODUCT_FIELDS.filter(f => f !== 'image'), ...NUM_PRODUCT_FIELDS]);
    PRODUCT_FIELDS.forEach(f => { if (data[f] !== undefined) p[f] = data[f]; });
    NUM_PRODUCT_FIELDS.forEach(f => { if (data[f] !== undefined) p[f] = num(data[f]); });
    if (changes) logAudit('Updated product', 'product', p.sku, changes);
  } else {
    const sku = String(data.sku || '').trim().toUpperCase() || `SL-${abbr(data.category || 'OTH')}-${String((d.meta.seq.product || 0) + 1).padStart(3, '0')}`;
    if (d.products.some(x => x.sku === sku)) throw new Error(`SKU ${sku} is already used.`);
    nextNumber('product', 'P', 3, false);
    p = { id: uid('prd'), sku, createdAt: iso() };
    PRODUCT_FIELDS.forEach(f => { p[f] = data[f] ?? ''; });
    NUM_PRODUCT_FIELDS.forEach(f => { p[f] = num(data[f]); });
    p.status = p.status || 'Active';
    p.kind = p.kind || 'Ready stock';
    d.products.push(p);
    logAudit('Created product', 'product', p.sku, p.name);
  }
  for (const row of variantRows) {
    if (!String(row.color || '').trim() || !String(row.size || '').trim()) continue;
    const existing = row.id ? get('variants', row.id) : d.variants.find(v => v.productId === p.id && v.color === row.color && v.size === row.size);
    if (existing) {
      if (num(row.cost) !== existing.cost) logAudit('Changed cost price', 'variant', existing.sku, `${money(existing.cost)} → ${money(row.cost)}`);
      existing.cost = num(row.cost);
      existing.reorderLevel = num(row.reorderLevel);
      existing.active = row.active !== false;
    } else {
      const v = { id: uid('var'), productId: p.id, color: row.color.trim(), size: row.size.trim(), cost: num(row.cost), reorderLevel: num(row.reorderLevel), active: true };
      v.sku = `${p.sku}-${abbr(v.color)}-${abbr(v.size)}`;
      let n = 2; const base = v.sku;
      while (d.variants.some(x => x.sku === v.sku)) v.sku = `${base}${n++}`;
      d.variants.push(v);
    }
  }
  save();
  return p;
}
export const productVariants = productId => db().variants.filter(v => v.productId === productId && v.active !== false);
export function variantLabel(v) { return v ? `${v.color} / ${v.size}` : ''; }
export function productOf(variantId) { const v = get('variants', variantId); return v ? get('products', v.productId) : null; }
export function saveCategory(name) {
  need('products.edit');
  const n = String(name).trim();
  if (!n) throw new Error('Enter a category name.');
  if (db().categories.includes(n)) throw new Error('That category already exists.');
  db().categories.push(n); logAudit('Created category', 'category', n); save();
}

// ---------- warehouses ----------
export function saveWarehouse(data) {
  need('inventory.edit');
  if (!String(data.name || '').trim()) throw new Error('Name the warehouse.');
  let w = data.id ? get('warehouses', data.id) : null;
  if (w) Object.assign(w, { name: data.name, city: data.city, active: data.active !== false });
  else { w = { id: uid('wh'), name: data.name, city: data.city || '', active: true }; db().warehouses.push(w); }
  logAudit(data.id ? 'Updated warehouse' : 'Created warehouse', 'warehouse', w.name);
  save(); return w;
}
export const activeWarehouses = () => db().warehouses.filter(w => w.active !== false);

// ---------- inventory ledger ----------
export function stockRow(variantId, warehouseId) {
  let r = db().stock.find(s => s.variantId === variantId && s.warehouseId === warehouseId);
  if (!r) { r = { variantId, warehouseId, qty: 0, reserved: 0, damaged: 0 }; db().stock.push(r); }
  return r;
}
export function variantStock(variantId, warehouseId = null) {
  const rows = db().stock.filter(s => s.variantId === variantId && (!warehouseId || s.warehouseId === warehouseId));
  const qty = sum(rows, 'qty'), reserved = sum(rows, 'reserved'), damaged = sum(rows, 'damaged');
  return { qty, reserved, damaged, available: qty - reserved };
}
export function productStock(productId, warehouseId = null) {
  const vs = db().variants.filter(v => v.productId === productId);
  const t = { qty: 0, reserved: 0, damaged: 0, available: 0 };
  vs.forEach(v => { const s = variantStock(v.id, warehouseId); for (const k in t) t[k] += s[k]; });
  return t;
}
// The only function that changes physical/reserved quantities. Every change is a ledger entry.
function move(type, variantId, warehouseId, qtyDelta, reservedDelta, ref = '', note = '') {
  const v = get('variants', variantId);
  if (!v) throw new Error('That product variant no longer exists.');
  if (!get('warehouses', warehouseId)) throw new Error('Choose a warehouse.');
  const r = stockRow(variantId, warehouseId);
  const newQty = r.qty + qtyDelta, newRes = r.reserved + reservedDelta;
  if (newQty < 0) throw new Error(`${v.sku}: only ${r.qty} units on hand.`);
  if (newRes < 0) throw new Error(`${v.sku}: reserved quantity can't go below zero.`);
  if (newRes > newQty) throw new Error(`${v.sku}: ${r.reserved} of ${r.qty} units are reserved for orders — only ${r.qty - r.reserved} available.`);
  r.qty = newQty; r.reserved = newRes;
  db().movements.unshift({
    id: uid('mov'), at: iso(), type, variantId, warehouseId, qty: qtyDelta, reserved: reservedDelta,
    balance: r.qty, reservedBalance: r.reserved, unitCost: v.cost, ref, note, by: actor.name,
  });
  return r;
}
export function adjustStock({ variantId, warehouseId, type, qty, note = '', ref = '' }) {
  need('inventory.edit');
  qty = Math.round(num(qty));
  if (!MANUAL_MOVEMENTS.includes(type)) throw new Error('Choose a movement type.');
  if (type === 'Stock adjustment' ? qty < 0 : qty <= 0) throw new Error('Enter a quantity above zero.');
  const v = get('variants', variantId);
  const r = stockRow(variantId, warehouseId);
  const before = r.qty;
  switch (type) {
    case 'Stock adjustment':
      if (qty === r.qty) throw new Error('The counted quantity matches current stock.');
      move(type, variantId, warehouseId, qty - r.qty, 0, ref || 'Stock count', note); break;
    case 'Purchase': case 'Manufacturing received': case 'Customer return':
      move(type, variantId, warehouseId, qty, 0, ref, note); break;
    case 'Customer return (damaged)':
      move('Customer return', variantId, warehouseId, 0, 0, ref, `${qty} damaged unit(s) held in damaged stock. ${note}`);
      r.damaged += qty; break;
    case 'Damaged':
      move(type, variantId, warehouseId, -qty, 0, ref, note); r.damaged += qty; break;
    default:
      move(type, variantId, warehouseId, -qty, 0, ref, note);
  }
  logAudit('Changed stock', 'inventory', v.sku, `${type}: ${before} → ${r.qty} at ${get('warehouses', warehouseId).name}${note ? ` (${note})` : ''}`);
  save();
}
export function transferStock({ variantId, from, to, qty, note = '' }) {
  need('inventory.edit');
  qty = Math.round(num(qty));
  if (qty <= 0) throw new Error('Enter a quantity above zero.');
  if (from === to) throw new Error('Choose two different warehouses.');
  const ref = `TRF-${Date.now().toString().slice(-6)}`;
  move('Transfer', variantId, from, -qty, 0, ref, `To ${get('warehouses', to).name}. ${note}`);
  move('Transfer', variantId, to, qty, 0, ref, `From ${get('warehouses', from).name}. ${note}`);
  logAudit('Transferred stock', 'inventory', get('variants', variantId).sku, `${qty} units ${get('warehouses', from).name} → ${get('warehouses', to).name}`);
  save();
}
export function lowStockItems() {
  const out = [];
  for (const v of db().variants) {
    const p = get('products', v.productId);
    if (!p || p.status !== 'Active' || v.active === false || !(v.reorderLevel > 0)) continue;
    const s = variantStock(v.id);
    if (s.available <= v.reorderLevel) {
      const suggested = Math.max(p.moq || 0, Math.ceil((v.reorderLevel * 3 - s.available) / 10) * 10);
      out.push({ variant: v, product: p, ...s, reorderLevel: v.reorderLevel, suggested });
    }
  }
  return out.sort((a, b) => (a.available - a.reorderLevel) - (b.available - b.reorderLevel));
}

// ---------- document totals (quotes & orders share one shape) ----------
export function docTotals(doc) {
  const subtotal = sum(doc.items || [], i => num(i.qty) * num(i.unitPrice));
  const discount = num(doc.discount);
  const deliveryCharge = num(doc.deliveryCharge);
  const revenue = subtotal - discount + deliveryCharge; // excludes tax
  const tax = Math.round(revenue * num(doc.taxRate)) / 100;
  const itemCost = sum(doc.items || [], i => num(i.qty) * num(i.unitCost));
  const c = doc.costs || {};
  const extraCost = num(c.delivery) + num(c.packaging) + num(c.other);
  const directCost = itemCost + extraCost;
  const profit = revenue - directCost;
  return { subtotal, discount, deliveryCharge, revenue, tax, total: revenue + tax, itemCost, extraCost, directCost, profit, margin: revenue ? profit / revenue : 0 };
}
export function orderTotals(o) {
  const t = docTotals(o);
  const paid = sum(db().payments.filter(p => p.orderId === o.id && !p.void), 'amount');
  return { ...t, paid, balance: o.state === 'Cancelled' ? 0 : t.total - paid };
}
export function orderType(o) {
  const s = o.items.some(i => i.fulfilment === 'stock'), m = o.items.some(i => i.fulfilment === 'make');
  return s && m ? 'Mixed' : s ? 'Wholesale' : 'Manufacturing';
}
export function lineDescription(it) {
  const p = it.productId ? get('products', it.productId) : null;
  const v = it.variantId ? get('variants', it.variantId) : null;
  return [p?.name || it.description || 'Custom item', v ? variantLabel(v) : ''].filter(Boolean).join(' — ');
}
function normalizeItems(items) {
  const out = (items || []).filter(it => it.productId || String(it.description || '').trim()).map(it => {
    const fulfilment = it.fulfilment === 'stock' ? 'stock' : 'make';
    const p = it.productId ? get('products', it.productId) : null;
    if (fulfilment === 'stock' && !it.variantId) throw new Error(`Choose a colour and size for ${p?.name || 'each ready-stock line'}.`);
    const qty = Math.round(num(it.qty));
    if (qty <= 0) throw new Error(`Enter a quantity for ${p?.name || it.description}.`);
    const v = it.variantId ? get('variants', it.variantId) : null;
    const bt = fulfilment === 'stock' ? 'Wholesale' : (BUSINESS_TYPES.includes(it.businessType) && it.businessType !== 'Wholesale' ? it.businessType : 'Manufacturing');
    return {
      id: it.id || uid('itm'), productId: it.productId || null, variantId: it.variantId || null,
      description: String(it.description || '').trim(), qty, unitPrice: num(it.unitPrice),
      unitCost: it.unitCost === '' || it.unitCost == null ? (v ? v.cost : 0) : num(it.unitCost),
      fulfilment, businessType: bt, returned: num(it.returned),
    };
  });
  if (!out.length) throw new Error('Add at least one product line.');
  return out;
}

// ---------- tracking links ----------
export function createTrackingToken(orderId, silent = false) {
  const d = db();
  d.tracking.filter(t => t.orderId === orderId && t.active).forEach(t => { t.active = false; t.revokedAt = iso(); });
  const t = { id: uid('trk'), orderId, token: secureToken(20), active: true, createdAt: iso() };
  d.tracking.push(t);
  if (!silent) { logAudit('Regenerated tracking link', 'order', get('orders', orderId).number); save(); }
  return t;
}
export function revokeTracking(orderId) {
  need('orders');
  db().tracking.filter(t => t.orderId === orderId && t.active).forEach(t => { t.active = false; t.revokedAt = iso(); });
  logAudit('Revoked tracking link', 'order', get('orders', orderId).number);
  save();
}
export const activeToken = orderId => db().tracking.find(t => t.orderId === orderId && t.active) || null;
export function trackingPath(o) {
  const t = activeToken(o.id);
  return t ? `track.html?t=${t.token}` : null;
}
export const trackingUrl = o => { const p = trackingPath(o); return p ? baseUrl() + p : ''; };
export function findTrackedOrder(number, token) {
  const o = db().orders.find(x => x.number === number);
  if (!o || !token) return null;
  const t = db().tracking.find(x => x.orderId === o.id && x.active && x.token === token);
  return t ? o : null;
}
// Customer-safe projection: no costs, margins, staff names or internal notes.
export function publicOrderView(o) {
  const t = orderTotals(o);
  const hasMake = o.items.some(i => i.fulfilment === 'make');
  const pIdx = PRODUCTION_FLOW.indexOf(o.productionStatus);
  const dIdx = DELIVERY_FLOW.indexOf(o.deliveryStatus);
  const confirmed = o.state === 'Confirmed' || o.state === 'Completed';
  const steps = [{ label: 'Order confirmed', done: confirmed }, { label: 'Payment received', done: t.paid > 0, side: true }];
  if (hasMake) {
    steps.push({ label: 'Production started', done: pIdx >= 2 });
    steps.push({ label: 'Quality check', done: pIdx >= 4 });
    steps.push({ label: 'Ready', done: pIdx >= 4 });
  } else steps.push({ label: 'Packed', done: dIdx >= 1 });
  steps.push({ label: 'Dispatched', done: dIdx >= 2 });
  steps.push({ label: 'Delivered', done: dIdx >= 4 });
  const cur = steps.find(s => !s.done && !s.side);
  if (cur && o.state !== 'Cancelled') cur.current = true;
  const main = steps.filter(s => !s.side);
  let headline = 'Order received';
  if (o.state === 'Cancelled') headline = 'Order cancelled';
  else if (dIdx >= 1) headline = o.deliveryStatus === 'Delivered' ? 'Delivered' : o.deliveryStatus;
  else if (hasMake && confirmed && pIdx >= 1) headline = o.productionStatus;
  else if (confirmed) headline = 'Order confirmed';
  return {
    number: o.number, state: o.state, headline,
    percent: o.state === 'Cancelled' ? 0 : Math.round(main.filter(s => s.done).length / main.length * 100),
    orderDate: o.confirmedAt || o.createdAt, expectedAt: o.expectedAt,
    steps, items: o.items.map(i => ({ name: i.description || lineDescription(i), variant: i.variantId ? variantLabel(get('variants', i.variantId)) : '', qty: i.qty })),
    paymentStatus: o.paymentStatus, deliveryStatus: o.deliveryStatus,
    total: t.total, paid: t.paid, balance: Math.max(0, t.balance),
    updates: o.timeline.filter(e => e.public).slice().reverse().map(e => ({ at: e.at, text: e.text })),
  };
}

// ---------- orders ----------
const ev = (text, isPublic, extra = {}) => ({ at: iso(), text, public: !!isPublic, by: actor.name, ...extra });
export function createOrder(data) {
  need('orders.create');
  const c = get('customers', data.customerId);
  if (!c) throw new Error('Choose a customer.');
  const items = normalizeItems(data.items);
  const o = {
    id: uid('ord'), number: nextNumber('order', 'SL-ORD'), customerId: c.id,
    quoteId: data.quoteId || null, reorderId: data.reorderId || null, items,
    discount: num(data.discount), deliveryCharge: num(data.deliveryCharge), taxRate: num(data.taxRate),
    costs: { delivery: num(data.costs?.delivery), packaging: num(data.costs?.packaging), other: num(data.costs?.other) },
    warehouseId: data.warehouseId || activeWarehouses()[0]?.id,
    state: 'Draft', salesStatus: 'Draft',
    productionStatus: items.some(i => i.fulfilment === 'make') ? 'Awaiting Materials' : 'Not Required',
    deliveryStatus: 'Not Dispatched', paymentStatus: 'Unpaid',
    assignedTo: data.assignedTo || actor.id, createdBy: actor.id,
    expectedAt: data.expectedAt || '', customerNotes: data.customerNotes || '', internalNotes: data.internalNotes || '',
    createdAt: iso(), confirmedAt: null, stockDeducted: false, timeline: [],
  };
  o.timeline.push(ev('Order created', false));
  db().orders.push(o);
  createTrackingToken(o.id, true);
  logAudit('Created order', 'order', o.number, `${customerName(c)}, ${money(docTotals(o).total)}`);
  notify('order.created', `Order ${o.number} created for ${customerName(c)}`, { link: `#/orders/${o.id}` });
  save();
  return o;
}
export function updateOrder(id, data) {
  const o = get('orders', id);
  if (o.state === 'Cancelled' || o.state === 'Completed') throw new Error(`This order is ${o.state.toLowerCase()} and can't be edited.`);
  const before = docTotals(o).total;
  if (o.state === 'Draft') {
    need('orders.create');
    if (data.customerId) o.customerId = data.customerId;
    if (data.items) {
      o.items = normalizeItems(data.items);
      o.productionStatus = o.items.some(i => i.fulfilment === 'make') ? 'Awaiting Materials' : 'Not Required';
    }
    ['discount', 'deliveryCharge', 'taxRate'].forEach(f => { if (data[f] !== undefined) o[f] = num(data[f]); });
    if (data.warehouseId) o.warehouseId = data.warehouseId;
  }
  if (data.costs) {
    if (o.state !== 'Draft') need('orders.costs');
    const old = { ...o.costs };
    o.costs = { delivery: num(data.costs.delivery), packaging: num(data.costs.packaging), other: num(data.costs.other) };
    const ch = diff(old, o.costs, ['delivery', 'packaging', 'other']);
    if (ch && o.state !== 'Draft') logAudit('Changed order costs', 'order', o.number, ch);
  }
  if (data.itemCosts) {
    need('orders.costs');
    for (const [itemId, cost] of Object.entries(data.itemCosts)) {
      const it = o.items.find(i => i.id === itemId);
      if (it && it.fulfilment === 'make' && num(cost) !== it.unitCost) {
        logAudit('Changed item cost', 'order', o.number, `${lineDescription(it)}: ${money(it.unitCost)} → ${money(cost)} per unit`);
        it.unitCost = num(cost);
      }
    }
  }
  ['expectedAt', 'customerNotes', 'internalNotes', 'assignedTo'].forEach(f => { if (data[f] !== undefined) o[f] = data[f]; });
  const after = docTotals(o).total;
  if (before !== after && o.state === 'Draft') logAudit('Changed order pricing', 'order', o.number, `${money(before)} → ${money(after)}`);
  save();
  return o;
}
export function confirmOrder(id) {
  need('orders.create');
  const o = get('orders', id);
  if (o.state !== 'Draft') throw new Error('Only draft orders can be confirmed.');
  const wh = get('warehouses', o.warehouseId);
  if (!wh) throw new Error('Choose a warehouse for this order.');
  const needs = {};
  o.items.filter(i => i.fulfilment === 'stock').forEach(i => { needs[i.variantId] = (needs[i.variantId] || 0) + i.qty; });
  for (const [vid, q] of Object.entries(needs)) {
    const s = variantStock(vid, o.warehouseId);
    if (s.available < q) throw new Error(`${get('variants', vid).sku}: ${q} needed but only ${s.available} available at ${wh.name}.`);
  }
  for (const i of o.items.filter(x => x.fulfilment === 'stock')) {
    i.unitCost = get('variants', i.variantId).cost; // actual inventory cost
    move('Reserved', i.variantId, o.warehouseId, 0, i.qty, o.number, 'Reserved for order');
  }
  o.state = 'Confirmed'; o.salesStatus = 'Order Confirmed'; o.confirmedAt = iso();
  o.timeline.push(ev('Order confirmed', true));
  const s = db().settings;
  db().invoices.push({ id: uid('inv'), number: nextNumber('invoice', 'SL-INV'), orderId: o.id, customerId: o.customerId, issuedAt: iso(), dueAt: addDays(now(), s.invoiceDueDays || 14).toISOString(), void: false });
  if (o.quoteId) { const q = get('quotes', o.quoteId); if (q?.leadId) setLeadStage(q.leadId, 'Order', true); }
  const c = get('customers', o.customerId);
  logAudit('Confirmed order', 'order', o.number);
  notify('order.created', `Order ${o.number} confirmed`, { link: `#/orders/${o.id}` });
  notify('order.created', `Your order ${o.number} is confirmed`, { audience: 'customer', customerId: o.customerId, email: c?.email });
  save();
  return o;
}
export function setProductionStatus(id, status, note = '') {
  need('orders.status');
  const o = get('orders', id);
  if (o.state !== 'Confirmed') throw new Error('Confirm the order before updating production.');
  if (o.productionStatus === 'Not Required') throw new Error('This order has no items to manufacture.');
  if (!PRODUCTION_FLOW.includes(status)) throw new Error('Choose a production status.');
  if (DELIVERY_FLOW.indexOf(o.deliveryStatus) >= 1) throw new Error('This order is already packed or dispatched.');
  if (status === o.productionStatus) return o;
  const before = o.productionStatus;
  o.productionStatus = status;
  if (status === 'In Production' && !o.productionStartedAt) o.productionStartedAt = iso();
  if (status === 'Ready') o.readyAt = iso();
  o.timeline.push(ev(PUBLIC_MESSAGES[status], true, { kind: 'production' }));
  if (note) o.timeline.push(ev(note, false));
  logAudit('Changed production status', 'order', o.number, `${before} → ${status}`);
  const c = get('customers', o.customerId);
  if (status === 'In Production') notify('production.started', `Production started for ${o.number}`, { link: `#/orders/${o.id}` });
  if (status === 'Ready') notify('order.ready', `${o.number} is ready`, { link: `#/orders/${o.id}` });
  notify('order.update', `${o.number}: ${PUBLIC_MESSAGES[status]}`, { audience: 'customer', customerId: o.customerId, email: c?.email });
  save();
  return o;
}
export function recordQC(orderId, { result, inspected, defects, notes }) {
  need('orders.status');
  const o = get('orders', orderId);
  if (o.productionStatus !== 'Quality Control') throw new Error('Move the order to Quality Control first.');
  const qc = { id: uid('qc'), orderId, at: iso(), by: actor.name, result, inspected: num(inspected), defects: num(defects), notes: notes || '' };
  db().qualityChecks.unshift(qc);
  logAudit('Recorded QC', 'order', o.number, `${result}: ${qc.defects} defects in ${qc.inspected} inspected`);
  if (result === 'Passed') {
    o.timeline.push(ev('Quality control completed', true));
    notify('qc.completed', `QC passed for ${o.number}`, { link: `#/orders/${o.id}` });
    setProductionStatus(orderId, 'Ready', `QC passed (${qc.inspected} inspected, ${qc.defects} defects).`);
  } else {
    o.timeline.push(ev(`QC failed: ${qc.defects} defects. ${notes || ''}`, false));
    setProductionStatus(orderId, 'In Production', 'Returned to production after failed QC.');
  }
  save();
}
export function setDeliveryStatus(id, status, note = '') {
  need('orders.status');
  const o = get('orders', id);
  if (o.state !== 'Confirmed') throw new Error('Confirm the order before updating delivery.');
  const idx = DELIVERY_FLOW.indexOf(status), cur = DELIVERY_FLOW.indexOf(o.deliveryStatus);
  if (idx < 0) throw new Error('Choose a delivery status.');
  if (idx === cur) return o;
  if (idx >= 1 && !['Ready', 'Not Required'].includes(o.productionStatus)) throw new Error('Production must be marked Ready before the order is packed.');
  if (o.stockDeducted && idx < 2) throw new Error('Stock has already left the warehouse. Record a return instead of moving the order back.');
  if (idx >= 2 && !o.stockDeducted) {
    for (const i of o.items.filter(x => x.fulfilment === 'stock')) {
      i.unitCost = get('variants', i.variantId).cost;
      move('Sale', i.variantId, o.warehouseId, -i.qty, -i.qty, o.number, 'Dispatched to customer');
    }
    o.stockDeducted = true; o.dispatchedAt = iso();
  }
  const before = o.deliveryStatus;
  // record each skipped step so the customer timeline stays complete
  for (let k = Math.max(cur + 1, 1); k <= idx; k++) o.timeline.push(ev(PUBLIC_MESSAGES[DELIVERY_FLOW[k]], true, { kind: 'delivery' }));
  o.deliveryStatus = status;
  if (note) o.timeline.push(ev(note, false));
  logAudit('Changed delivery status', 'order', o.number, `${before} → ${status}`);
  const c = get('customers', o.customerId);
  if (idx >= 2 && cur < 2) notify('order.dispatched', `${o.number} dispatched`, { link: `#/orders/${o.id}` });
  if (status === 'Delivered') {
    o.deliveredAt = iso();
    addToCustomerLibrary(o);
    notify('order.delivered', `${o.number} delivered`, { link: `#/orders/${o.id}` });
  }
  notify('order.update', `${o.number}: ${PUBLIC_MESSAGES[status]}`, { audience: 'customer', customerId: o.customerId, email: c?.email });
  maybeComplete(o);
  save();
  return o;
}
export function cancelOrder(id, reason = '') {
  need('orders.create');
  const o = get('orders', id);
  if (o.state === 'Cancelled' || o.state === 'Completed') throw new Error(`This order is already ${o.state.toLowerCase()}.`);
  if (o.stockDeducted) throw new Error('This order has been dispatched. Record a return instead of cancelling.');
  if (o.state === 'Confirmed') {
    for (const i of o.items.filter(x => x.fulfilment === 'stock')) move('Released', i.variantId, o.warehouseId, 0, -i.qty, o.number, 'Order cancelled');
    db().invoices.filter(v => v.orderId === o.id).forEach(v => { v.void = true; });
  }
  const paid = orderTotals(o).paid;
  o.state = 'Cancelled'; o.salesStatus = 'Cancelled'; o.cancelledAt = iso();
  o.timeline.push(ev('Order cancelled', true));
  o.timeline.push(ev(`Cancelled${reason ? `: ${reason}` : ''}${paid > 0 ? `. ${money(paid)} was paid — arrange a refund.` : ''}`, false));
  logAudit('Cancelled order', 'order', o.number, reason);
  save();
  return o;
}
function refreshPaymentStatus(o) {
  const t = orderTotals(o);
  o.paymentStatus = t.paid <= 0 ? 'Unpaid' : t.balance <= 0.5 ? 'Paid' : 'Partially Paid';
}
function maybeComplete(o) {
  if (o.state === 'Confirmed' && o.deliveryStatus === 'Delivered' && o.paymentStatus === 'Paid') {
    o.state = 'Completed'; o.salesStatus = 'Completed'; o.completedAt = iso();
    o.timeline.push(ev('Order completed', false));
    const q = o.quoteId ? get('quotes', o.quoteId) : null;
    if (q?.leadId) setLeadStage(q.leadId, 'Completed', true);
  }
}
export function recordPayment(orderId, { amount, method, reference = '', date = '' }) {
  need('payments');
  const o = get('orders', orderId);
  if (o.state === 'Draft') throw new Error('Confirm the order before recording payments.');
  if (o.state === 'Cancelled') throw new Error('This order is cancelled.');
  const amt = num(amount);
  if (amt <= 0) throw new Error('Enter an amount above zero.');
  const bal = orderTotals(o).balance;
  if (amt > bal + 0.5) throw new Error(`That is more than the balance of ${money(bal)}.`);
  if (!PAYMENT_METHODS.includes(method)) throw new Error('Choose a payment method.');
  const at = date ? new Date(`${date}T${now().toTimeString().slice(0, 8)}`).toISOString() : iso();
  const p = { id: uid('pay'), number: nextNumber('payment', 'SL-PAY'), orderId, customerId: o.customerId, amount: amt, method, reference, at, by: actor.name, void: false };
  db().payments.push(p);
  refreshPaymentStatus(o);
  o.timeline.push(ev(`Payment of ${money(amt)} received`, true));
  logAudit('Recorded payment', 'payment', p.number, `${money(amt)} for ${o.number} by ${method}`);
  const c = get('customers', o.customerId);
  notify('payment.received', `${money(amt)} received for ${o.number}`, { link: `#/orders/${o.id}` });
  notify('payment.received', `We received your payment of ${money(amt)} for ${o.number}`, { audience: 'customer', customerId: o.customerId, email: c?.email });
  maybeComplete(o);
  save();
  return p;
}
export function voidPayment(paymentId, reason) {
  need('payments');
  const p = get('payments', paymentId);
  if (p.void) throw new Error('This payment is already void.');
  if (!String(reason || '').trim()) throw new Error('Give a reason for voiding.');
  const o = get('orders', p.orderId);
  if (o.state === 'Completed') { o.state = 'Confirmed'; o.salesStatus = 'Order Confirmed'; }
  p.void = true; p.voidReason = reason; p.voidedAt = iso();
  refreshPaymentStatus(o);
  o.timeline.push(ev(`Payment ${p.number} voided: ${reason}`, false));
  logAudit('Voided payment', 'payment', p.number, reason);
  save();
}
export function returnItems(orderId, itemId, qty, condition, note = '') {
  need('inventory.edit');
  const o = get('orders', orderId);
  const it = o.items.find(i => i.id === itemId);
  qty = Math.round(num(qty));
  if (!o.stockDeducted || it.fulfilment !== 'stock') throw new Error('Only dispatched ready-stock items can be returned.');
  if (qty <= 0 || qty > it.qty - (it.returned || 0)) throw new Error(`You can return up to ${it.qty - (it.returned || 0)} units.`);
  adjustStock({ variantId: it.variantId, warehouseId: o.warehouseId, type: condition === 'damaged' ? 'Customer return (damaged)' : 'Customer return', qty, note, ref: o.number });
  it.returned = (it.returned || 0) + qty;
  o.timeline.push(ev(`${qty} × ${lineDescription(it)} returned (${condition}).`, false));
  save();
}
export function addOrderNote(orderId, text, isPublic) {
  need('orders');
  if (!String(text).trim()) throw new Error('Write an update first.');
  const o = get('orders', orderId);
  o.timeline.push(ev(String(text).trim(), isPublic));
  if (isPublic) notify('order.update', `${o.number}: ${text}`, { audience: 'customer', customerId: o.customerId, email: get('customers', o.customerId)?.email });
  save();
}
export const invoiceFor = orderId => db().invoices.find(i => i.orderId === orderId && !i.void) || null;
export function invoiceStatus(inv) {
  if (inv.void) return 'Void';
  const o = get('orders', inv.orderId);
  if (o.paymentStatus === 'Paid') return 'Paid';
  if (new Date(inv.dueAt) < now()) return 'Overdue';
  return o.paymentStatus;
}

// ---------- customer product library & reorders ----------
function addToCustomerLibrary(o) {
  const lib = db().customerProducts;
  for (const it of o.items) {
    const key = [o.customerId, it.productId || '', it.variantId || '', it.description].join('|');
    let e = lib.find(x => x.key === key);
    if (!e) {
      const p = it.productId ? get('products', it.productId) : null;
      e = { id: uid('cp'), key, customerId: o.customerId, productId: it.productId, variantId: it.variantId, description: it.description,
        name: lineDescription(it), fulfilment: it.fulfilment, businessType: it.businessType, material: p?.material || '',
        printMethod: p?.method || '', specs: it.description || '', design: null, timesOrdered: 0 };
      lib.push(e);
    }
    Object.assign(e, { lastOrderId: o.id, lastOrderNumber: o.number, lastQty: it.qty, lastPrice: it.unitPrice, lastCost: it.unitCost, updatedAt: iso() });
    e.timesOrdered += 1;
  }
}
export function updateLibraryItem(id, data) {
  need('customers.edit');
  const e = get('customerProducts', id);
  ['name', 'specs', 'material', 'printMethod', 'sizeChart', 'design'].forEach(f => { if (data[f] !== undefined) e[f] = data[f]; });
  logAudit('Updated customer product', 'customer', get('customers', e.customerId).code, e.name);
  save();
}
export function createReorder({ customerId, lines, note = '', source = 'Staff' }) {
  const list = (lines || []).filter(l => num(l.qty) > 0).map(l => {
    const e = get('customerProducts', l.customerProductId);
    if (!e || e.customerId !== customerId) throw new Error('That product is not in this customer library.');
    const s = e.fulfilment === 'stock' && e.variantId ? variantStock(e.variantId) : null;
    return { customerProductId: e.id, name: e.name, qty: Math.round(num(l.qty)), previousQty: e.lastQty, previousPrice: e.lastPrice,
      fulfilment: e.fulfilment, availableNow: s ? s.available : null };
  });
  if (!list.length) throw new Error('Enter a quantity for at least one product.');
  const r = { id: uid('ro'), number: nextNumber('reorder', 'SL-RO'), customerId, lines: list, note, source, status: 'New', createdAt: iso() };
  db().reorders.unshift(r);
  const c = get('customers', customerId);
  logAudit('Requested reorder', 'reorder', r.number, `${customerName(c)} via ${source}`);
  notify('reorder.requested', `Reorder ${r.number} from ${customerName(c)}`, { link: '#/reorders' });
  save();
  return r;
}
export function convertReorder(id) {
  need('orders.create');
  const r = get('reorders', id);
  if (r.status !== 'New') throw new Error('This reorder has already been handled.');
  const items = r.lines.map(l => {
    const e = get('customerProducts', l.customerProductId);
    return { productId: e.productId, variantId: e.variantId, description: e.description, qty: l.qty, unitPrice: e.lastPrice,
      unitCost: e.fulfilment === 'stock' ? '' : e.lastCost, fulfilment: e.fulfilment, businessType: e.businessType };
  });
  const o = createOrder({ customerId: r.customerId, items, reorderId: r.id, customerNotes: r.note, internalNotes: `Created from reorder ${r.number}` });
  r.status = 'Converted'; r.orderId = o.id;
  save();
  return o;
}
export function declineReorder(id, reason) {
  need('orders.create');
  const r = get('reorders', id);
  r.status = 'Declined'; r.reason = reason;
  logAudit('Declined reorder', 'reorder', r.number, reason);
  save();
}

// ---------- leads & pipeline ----------
export function createLead(data, source = 'Manual') {
  if (actor.kind === 'staff') need('leads');
  if (!String(data.name || '').trim()) throw new Error('Add your name.');
  if (!String(data.email || '').trim() && !String(data.phone || '').trim()) throw new Error('Add an email or phone number so we can reply.');
  const stage = source === 'Manual' ? 'Lead' : 'Requirement Received';
  const l = {
    id: uid('lead'), number: nextNumber('request', 'SL-RQ'), source, stage, reached: {}, lost: false,
    name: String(data.name).trim(), company: String(data.company || '').trim(), email: String(data.email || '').trim(),
    phone: String(data.phone || '').trim(), productType: data.productType || '', quantity: num(data.quantity),
    requiredDate: data.requiredDate || '', customization: data.customization || '', reference: data.reference || '',
    requirements: data.requirements || '', attachments: data.attachments || [], items: data.items || [],
    customerId: data.customerId || null, assignedTo: data.assignedTo || null, notes: [], createdAt: iso(), clientRef: String(data.clientRef || '').slice(0, 20),
  };
  LEAD_STAGES.slice(0, LEAD_STAGES.indexOf(stage) + 1).forEach(s => { l.reached[s] = iso(); });
  db().leads.unshift(l);
  logAudit('Created lead', 'lead', l.number, `${l.company || l.name} via ${source}`);
  notify('lead.created', `New quote request ${l.number} from ${l.company || l.name}`, { link: `#/leads/${l.id}` });
  save();
  return l;
}
export function setLeadStage(id, stage, auto = false) {
  if (!auto) need('leads');
  const l = get('leads', id);
  if (!l || !LEAD_STAGES.includes(stage)) return;
  if (auto && LEAD_STAGES.indexOf(stage) <= LEAD_STAGES.indexOf(l.stage)) return; // automatic moves only go forward
  const before = l.stage;
  l.stage = stage; l.lost = false;
  LEAD_STAGES.slice(0, LEAD_STAGES.indexOf(stage) + 1).forEach(s => { if (!l.reached[s]) l.reached[s] = iso(); });
  if (!auto) logAudit('Moved lead', 'lead', l.number, `${before} → ${stage}`);
  if (!auto) save();
}
export function markLeadLost(id, reason) {
  need('leads');
  const l = get('leads', id);
  l.lost = true; l.lostReason = reason;
  logAudit('Marked lead lost', 'lead', l.number, reason);
  save();
}
export function addLeadNote(id, text) {
  need('leads');
  if (!String(text).trim()) throw new Error('Write a note first.');
  get('leads', id).notes.unshift({ at: iso(), by: actor.name, text: String(text).trim() });
  save();
}
export function leadToCustomer(id) {
  need('customers.edit');
  const l = get('leads', id);
  if (l.customerId) return get('customers', l.customerId);
  const match = l.email && db().customers.find(c => c.email && c.email.toLowerCase() === l.email.toLowerCase());
  const c = match || saveCustomer({ company: l.company, contact: l.name, email: l.email, phone: l.phone, whatsapp: l.phone, source: l.source === 'Manual' ? 'Other' : 'Website', type: 'Corporate' });
  l.customerId = c.id;
  logAudit('Linked lead to customer', 'lead', l.number, c.code);
  save();
  return c;
}
export function pipelineStats() {
  const leads = db().leads;
  const counts = LEAD_STAGES.map(s => ({ stage: s, current: leads.filter(l => l.stage === s && !l.lost).length, reached: leads.filter(l => l.reached[s]).length }));
  counts.forEach((c, i) => { c.conversion = i === 0 ? null : (counts[i - 1].reached ? c.reached / counts[i - 1].reached : 0); });
  return counts;
}

// ---------- quotes ----------
export function createQuote(data) {
  need('quotes');
  let customerId = data.customerId;
  if (!customerId && data.leadId) customerId = leadToCustomer(data.leadId).id;
  if (!get('customers', customerId)) throw new Error('Choose a customer.');
  const s = db().settings;
  const q = {
    id: uid('quo'), number: nextNumber('quote', 'SL-Q'), customerId, leadId: data.leadId || null,
    items: normalizeItems(data.items), discount: num(data.discount), deliveryCharge: num(data.deliveryCharge), taxRate: num(data.taxRate),
    costs: { delivery: num(data.costs?.delivery), packaging: num(data.costs?.packaging), other: num(data.costs?.other) },
    validUntil: data.validUntil || dateOnly(addDays(now(), s.quoteValidityDays || 14)),
    productionDays: num(data.productionDays), paymentTerms: data.paymentTerms || s.defaultPaymentTerms, notes: data.notes || '',
    status: 'Draft', createdAt: iso(), createdBy: actor.id, token: secureToken(16), changeRequests: [], history: [{ at: iso(), text: 'Quote created', by: actor.name }],
  };
  db().quotes.unshift(q);
  if (q.leadId) setLeadStage(q.leadId, 'Quote Created', true);
  logAudit('Created quote', 'quote', q.number, money(docTotals(q).total));
  notify('quote.created', `Quote ${q.number} created`, { link: `#/quotes/${q.id}` });
  save();
  return q;
}
export function updateQuote(id, data) {
  need('quotes');
  const q = get('quotes', id);
  if (['Approved', 'Converted to order'].includes(q.status)) throw new Error(`An ${q.status.toLowerCase()} quote can't be edited. Create a new quote instead.`);
  const before = docTotals(q).total;
  q.items = normalizeItems(data.items);
  ['discount', 'deliveryCharge', 'taxRate', 'productionDays'].forEach(f => { q[f] = num(data[f]); });
  q.costs = { delivery: num(data.costs?.delivery), packaging: num(data.costs?.packaging), other: num(data.costs?.other) };
  ['validUntil', 'paymentTerms', 'notes'].forEach(f => { if (data[f] !== undefined) q[f] = data[f]; });
  if (data.customerId) q.customerId = data.customerId;
  if (q.status !== 'Draft') { q.history.push({ at: iso(), text: `Edited after being ${q.status.toLowerCase()} — back to draft`, by: actor.name }); q.status = 'Draft'; }
  const after = docTotals(q).total;
  if (before !== after) logAudit('Changed quote pricing', 'quote', q.number, `${money(before)} → ${money(after)}`);
  save();
  return q;
}
export function sendQuote(id) {
  need('quotes');
  const q = get('quotes', id);
  if (!['Draft', 'Sent', 'Viewed'].includes(q.status)) throw new Error(`A ${q.status.toLowerCase()} quote can't be sent.`);
  q.status = 'Sent'; q.sentAt = iso();
  q.history.push({ at: iso(), text: 'Sent to customer', by: actor.name });
  if (q.leadId) setLeadStage(q.leadId, 'Quote Sent', true);
  const c = get('customers', q.customerId);
  logAudit('Sent quote', 'quote', q.number);
  notify('quote.sent', `New quote ${q.number} is ready for your review`, { audience: 'customer', customerId: q.customerId, email: c?.email });
  save();
}
export const quotePath = q => `track.html?q=${q.token}`;
export const quoteUrl = q => baseUrl() + quotePath(q);
export const findQuoteByTokenOnly = token => db().quotes.find(x => x.token && x.token === token) || null;
export function findQuoteByToken(number, token) {
  const q = db().quotes.find(x => x.number === number);
  return q && token && q.token === token ? q : null;
}
export function markQuoteViewed(id) {
  const q = get('quotes', id);
  if (q.status === 'Sent') { q.status = 'Viewed'; q.viewedAt = iso(); q.history.push({ at: iso(), text: 'Viewed by customer', by: 'Customer' }); save(); }
}
export function respondToQuote(id, action, message = '', byStaff = false) {
  if (byStaff) need('quotes');
  const q = get('quotes', id);
  expireQuotes();
  if (!['Sent', 'Viewed'].includes(q.status)) throw new Error(q.status === 'Expired' ? 'This quote has expired. Ask Seamline for an updated quote.' : `This quote is ${q.status.toLowerCase()}.`);
  const who = byStaff ? `${actor.name} (on behalf of customer)` : 'Customer';
  const c = get('customers', q.customerId);
  if (action === 'approve') {
    q.status = 'Approved'; q.respondedAt = iso();
    q.history.push({ at: iso(), text: `Approved${message ? `: ${message}` : ''}`, by: who });
    if (q.leadId) setLeadStage(q.leadId, 'Approved', true);
    notify('quote.approved', `${customerName(c)} approved quote ${q.number}`, { link: `#/quotes/${q.id}` });
  } else if (action === 'reject') {
    q.status = 'Rejected'; q.respondedAt = iso();
    q.history.push({ at: iso(), text: `Rejected${message ? `: ${message}` : ''}`, by: who });
    notify('quote.rejected', `${customerName(c)} rejected quote ${q.number}`, { link: `#/quotes/${q.id}` });
  } else if (action === 'changes') {
    if (!String(message).trim()) throw new Error('Tell us what you would like changed.');
    q.changeRequests.push({ at: iso(), text: message });
    q.history.push({ at: iso(), text: `Changes requested: ${message}`, by: who });
    if (q.leadId) setLeadStage(q.leadId, 'Negotiation', true);
    notify('quote.changes', `${customerName(c)} requested changes to ${q.number}`, { link: `#/quotes/${q.id}` });
  } else throw new Error('Unknown response.');
  logAudit(`Quote ${action === 'changes' ? 'changes requested' : action + 'd'}`, 'quote', q.number, who);
  save();
}
export function convertQuote(id) {
  need('quotes');
  const q = get('quotes', id);
  if (q.status !== 'Approved') throw new Error('Only approved quotes can become orders.');
  const o = createOrder({
    customerId: q.customerId, quoteId: q.id, items: q.items.map(i => ({ ...i, id: undefined })),
    discount: q.discount, deliveryCharge: q.deliveryCharge, taxRate: q.taxRate, costs: q.costs,
    expectedAt: q.productionDays ? dateOnly(addDays(now(), q.productionDays)) : '', internalNotes: `Converted from quote ${q.number}`,
  });
  q.status = 'Converted to order'; q.orderId = o.id;
  q.history.push({ at: iso(), text: `Converted to order ${o.number}`, by: actor.name });
  logAudit('Converted quote to order', 'quote', q.number, o.number);
  save();
  return o;
}
export function expireQuotes() {
  const today = dateOnly(now());
  let changed = false;
  for (const q of db().quotes) {
    if (['Sent', 'Viewed'].includes(q.status) && q.validUntil && q.validUntil < today) {
      q.status = 'Expired'; q.history.push({ at: iso(), text: 'Expired', by: 'System' }); changed = true;
    }
  }
  if (changed) save();
}

// ---------- suppliers & purchasing ----------
const SUPPLIER_FIELDS = ['company', 'contact', 'phone', 'email', 'address', 'categories', 'paymentTerms', 'notes'];
export function saveSupplier(data) {
  need('suppliers');
  if (actor.role === 'finance') throw new Error('Finance can view suppliers but not edit them.');
  if (!String(data.company || '').trim()) throw new Error('Add the supplier company name.');
  let s = data.id ? get('suppliers', data.id) : null;
  if (s) {
    const ch = diff(s, data, [...SUPPLIER_FIELDS, 'leadTimeDays', 'moq', 'rating']);
    SUPPLIER_FIELDS.forEach(f => { if (data[f] !== undefined) s[f] = data[f]; });
    ['leadTimeDays', 'moq', 'rating'].forEach(f => { if (data[f] !== undefined) s[f] = num(data[f]); });
    if (data.active !== undefined) s.active = data.active === true || data.active === 'true';
    if (ch) logAudit('Modified supplier', 'supplier', s.code, ch);
  } else {
    s = { id: uid('sup'), code: nextNumber('supplier', 'SL-S', 4, false), active: true, createdAt: iso() };
    SUPPLIER_FIELDS.forEach(f => { s[f] = data[f] || ''; });
    ['leadTimeDays', 'moq', 'rating'].forEach(f => { s[f] = num(data[f]); });
    db().suppliers.push(s);
    logAudit('Created supplier', 'supplier', s.code, s.company);
  }
  save();
  return s;
}
export function addSupplierPrice({ supplierId, productId, price, note = '' }) {
  need('purchasing');
  if (num(price) <= 0) throw new Error('Enter a price above zero.');
  const r = { id: uid('sp'), supplierId, productId, price: num(price), note, at: iso(), by: actor.name };
  db().supplierPrices.unshift(r);
  logAudit('Recorded supplier price', 'supplier', get('suppliers', supplierId).code, `${get('products', productId).name}: ${money(price)}`);
  save();
}
export function supplierPriceHistory(productId) {
  return db().supplierPrices.filter(p => p.productId === productId).sort((a, b) => b.at.localeCompare(a.at));
}
export const poTotal = po => sum(po.items, i => num(i.qty) * num(i.unitCost));
export function createPO(data) {
  need('purchasing');
  if (!get('suppliers', data.supplierId)) throw new Error('Choose a supplier.');
  const items = (data.items || []).filter(i => i.variantId && num(i.qty) > 0)
    .map(i => ({ id: uid('poi'), variantId: i.variantId, qty: Math.round(num(i.qty)), unitCost: num(i.unitCost), received: 0 }));
  if (!items.length) throw new Error('Add at least one product with a quantity.');
  if (items.some(i => i.unitCost <= 0)) throw new Error('Enter a unit cost for every line.');
  const po = { id: uid('po'), number: nextNumber('po', 'SL-PO'), supplierId: data.supplierId, warehouseId: data.warehouseId || activeWarehouses()[0]?.id,
    expectedAt: data.expectedAt || '', notes: data.notes || '', items, status: 'Draft', createdAt: iso(), createdBy: actor.name };
  db().purchaseOrders.unshift(po);
  logAudit('Created purchase order', 'purchase order', po.number, money(poTotal(po)));
  save();
  return po;
}
export function markPOOrdered(id) {
  need('purchasing');
  const po = get('purchaseOrders', id);
  if (po.status !== 'Draft') throw new Error('Only draft purchase orders can be placed.');
  po.status = 'Ordered'; po.orderedAt = iso();
  logAudit('Placed purchase order', 'purchase order', po.number);
  save();
}
export function cancelPO(id, reason) {
  need('purchasing');
  const po = get('purchaseOrders', id);
  if (po.items.some(i => i.received > 0)) throw new Error('Goods have already been received on this PO.');
  po.status = 'Cancelled'; po.cancelReason = reason;
  logAudit('Cancelled purchase order', 'purchase order', po.number, reason);
  save();
}
export function receivePO(id, lines, note = '') {
  need('purchasing');
  const po = get('purchaseOrders', id);
  if (!['Ordered', 'Partially Received'].includes(po.status)) throw new Error('Place the purchase order before receiving goods.');
  const got = [];
  for (const l of lines) {
    const it = po.items.find(i => i.id === l.itemId);
    const q = Math.round(num(l.qty));
    if (!it || q <= 0) continue;
    if (q > it.qty - it.received) throw new Error(`Only ${it.qty - it.received} units are still due for ${get('variants', it.variantId).sku}.`);
    const v = get('variants', it.variantId);
    const s = variantStock(v.id);
    // weighted average cost: keeps profit based on what the stock actually cost
    const onHand = Math.max(0, s.qty);
    v.cost = Math.round(((onHand * v.cost) + (q * it.unitCost)) / (onHand + q) * 100) / 100;
    move('Purchase', v.id, po.warehouseId, q, 0, po.number, `Received from ${get('suppliers', po.supplierId).company}`);
    it.received += q;
    got.push({ itemId: it.id, variantId: v.id, qty: q, unitCost: it.unitCost });
    db().supplierPrices.unshift({ id: uid('sp'), supplierId: po.supplierId, productId: v.productId, price: it.unitCost, note: `Paid on ${po.number}`, at: iso(), by: actor.name });
  }
  if (!got.length) throw new Error('Enter the quantity received for at least one line.');
  const gr = { id: uid('grn'), number: nextNumber('grn', 'SL-GRN'), poId: po.id, at: iso(), by: actor.name, lines: got, note };
  db().goodsReceipts.unshift(gr);
  po.status = po.items.every(i => i.received >= i.qty) ? 'Received' : 'Partially Received';
  if (po.status === 'Received') po.receivedAt = iso();
  logAudit('Received goods', 'purchase order', po.number, `${gr.number}: ${got.reduce((a, g) => a + g.qty, 0)} units`);
  notify('po.received', `Goods received on ${po.number}`, { link: `#/purchase-orders/${po.id}` });
  save();
  return gr;
}
export function supplierStats(supplierId) {
  const pos = db().purchaseOrders.filter(p => p.supplierId === supplierId && p.status !== 'Cancelled');
  const receipts = db().goodsReceipts.filter(g => pos.some(p => p.id === g.poId));
  const purchased = sum(receipts, g => sum(g.lines, l => l.qty * l.unitCost));
  const paid = sum(db().expenses.filter(e => e.supplierId === supplierId && !e.void), 'amount');
  const leadTimes = pos.filter(p => p.orderedAt && p.receivedAt).map(p => (new Date(p.receivedAt) - new Date(p.orderedAt)) / 864e5);
  return { pos, purchased, paid, outstanding: purchased - paid, avgLeadTime: leadTimes.length ? sum(leadTimes, x => x) / leadTimes.length : null };
}

// ---------- expenses ----------
export function addExpense(data) {
  need('expenses');
  if (!EXPENSE_CATEGORIES.includes(data.category)) throw new Error('Choose a category.');
  if (num(data.amount) <= 0) throw new Error('Enter an amount above zero.');
  if (data.category === 'Supplier payments' && !data.supplierId) throw new Error('Choose which supplier was paid.');
  const e = { id: uid('exp'), number: nextNumber('expense', 'SL-EXP'), date: data.date || dateOnly(now()), category: data.category,
    amount: num(data.amount), description: data.description || '', method: data.method || 'Bank transfer',
    supplierId: data.category === 'Supplier payments' ? data.supplierId : null, attachment: data.attachment || null, void: false, createdAt: iso(), by: actor.name };
  db().expenses.unshift(e);
  logAudit('Recorded expense', 'expense', e.number, `${e.category}: ${money(e.amount)}`);
  save();
  return e;
}
export function voidExpense(id, reason) {
  need('expenses');
  if (!String(reason || '').trim()) throw new Error('Give a reason for voiding.');
  const e = get('expenses', id);
  e.void = true; e.voidReason = reason;
  logAudit('Voided expense', 'expense', e.number, reason);
  save();
}
// Supplier payments settle stock purchases that are already counted in COGS,
// so they are excluded from operating expenses to avoid counting cost twice.
export function operatingExpenses(from, to) {
  return sum(db().expenses.filter(e => !e.void && e.category !== 'Supplier payments' && inRange(`${e.date}T12:00:00`, from, to)), 'amount');
}

// ---------- sales, profit & reports ----------
export function salesLines(from, to) {
  const lines = [];
  for (const o of db().orders) {
    if (!['Confirmed', 'Completed'].includes(o.state) || !inRange(o.confirmedAt, from, to)) continue;
    const t = docTotals(o);
    for (const it of o.items) {
      const share = t.subtotal ? (it.qty * it.unitPrice) / t.subtotal : 1 / o.items.length;
      const revenue = share * t.revenue;
      const cost = it.qty * it.unitCost + share * t.extraCost;
      lines.push({ order: o, item: it, date: o.confirmedAt, customerId: o.customerId, productId: it.productId,
        businessType: it.businessType || (it.fulfilment === 'stock' ? 'Wholesale' : 'Manufacturing'),
        qty: it.qty, revenue, cost, profit: revenue - cost, salesperson: o.createdBy });
    }
  }
  return lines;
}
export function summary(from, to) {
  const L = salesLines(from, to);
  const orders = new Set(L.map(l => l.order.id)).size;
  const revenue = sum(L, 'revenue'), cost = sum(L, 'cost');
  const gross = revenue - cost;
  const expenses = operatingExpenses(from, to);
  const byType = Object.fromEntries(BUSINESS_TYPES.map(b => [b, { revenue: 0, cost: 0, profit: 0 }]));
  L.forEach(l => { const x = byType[l.businessType] || byType.Other; x.revenue += l.revenue; x.cost += l.cost; x.profit += l.profit; });
  return { revenue, cost, grossProfit: gross, margin: revenue ? gross / revenue : 0, orders, aov: orders ? revenue / orders : 0, expenses, netProfit: gross - expenses, byType, lines: L };
}
export function groupLines(lines, keyFn, labelFn = k => k) {
  const m = new Map();
  for (const l of lines) {
    const k = keyFn(l);
    if (!m.has(k)) m.set(k, { key: k, label: labelFn(k, l), qty: 0, revenue: 0, cost: 0, profit: 0, orders: new Set() });
    const g = m.get(k); g.qty += l.qty; g.revenue += l.revenue; g.cost += l.cost; g.profit += l.profit; g.orders.add(l.order.id);
  }
  return [...m.values()].map(g => ({ ...g, orders: g.orders.size, margin: g.revenue ? g.profit / g.revenue : 0 })).sort((a, b) => b.revenue - a.revenue);
}
export function dailySeries(days = 30) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(startOfDay(), -i);
    const s = summary(d, endOfDay(d));
    out.push({ date: d, revenue: s.revenue, profit: s.grossProfit });
  }
  return out;
}
export function pendingPayments() {
  return sum(db().orders.filter(o => o.state === 'Confirmed'), o => Math.max(0, orderTotals(o).balance));
}
export function flowCounts() {
  const d = db();
  const active = d.orders.filter(o => o.state === 'Confirmed');
  return [
    { label: 'Lead', count: d.leads.filter(l => !l.lost && ['Lead', 'Contacted', 'Requirement Received'].includes(l.stage)).length, href: 'leads' },
    { label: 'Quote', count: d.quotes.filter(q => ['Draft', 'Sent', 'Viewed'].includes(q.status)).length, href: 'quotes' },
    { label: 'Approved', count: d.quotes.filter(q => q.status === 'Approved').length, href: 'quotes?status=Approved' },
    { label: 'Order', count: d.orders.filter(o => o.state === 'Draft').length + active.filter(o => ['Awaiting Materials', 'Not Required'].includes(o.productionStatus) && o.deliveryStatus === 'Not Dispatched').length, href: 'orders' },
    { label: 'Production', count: active.filter(o => ['Production Scheduled', 'In Production', 'Quality Control'].includes(o.productionStatus)).length, href: 'production' },
    { label: 'Delivered', count: active.filter(o => o.deliveryStatus === 'Delivered').length, href: 'orders?delivery=Delivered' },
    { label: 'Paid', count: d.orders.filter(o => o.state === 'Completed' && inRange(o.completedAt, startOfMonth(), null)).length, href: 'orders?state=Completed' },
  ];
}
export function inventoryReport() {
  const rows = db().variants.map(v => {
    const p = get('products', v.productId);
    const s = variantStock(v.id);
    const sold30 = -sum(db().movements.filter(m => m.variantId === v.id && m.type === 'Sale' && inRange(m.at, addDays(now(), -30), null)), 'qty');
    const lastSale = db().movements.find(m => m.variantId === v.id && m.type === 'Sale');
    return { variant: v, product: p, ...s, value: s.qty * v.cost, sold30, lastSale: lastSale?.at || null };
  }).filter(r => r.product);
  const withStock = rows.filter(r => r.qty > 0);
  return {
    rows, value: sum(rows, 'value'), units: sum(rows, 'qty'),
    dead: withStock.filter(r => !r.lastSale || new Date(r.lastSale) < addDays(now(), -60)),
    fast: [...rows].filter(r => r.sold30 > 0).sort((a, b) => b.sold30 - a.sold30).slice(0, 10),
    slow: withStock.filter(r => r.sold30 > 0).sort((a, b) => a.sold30 - b.sold30).slice(0, 10),
  };
}
export function operationsReport() {
  const orders = db().orders;
  const made = orders.filter(o => o.readyAt && o.confirmedAt);
  const today = dateOnly(now());
  return {
    inProduction: orders.filter(o => o.state === 'Confirmed' && ['Production Scheduled', 'In Production', 'Quality Control'].includes(o.productionStatus)),
    avgProductionDays: made.length ? sum(made, o => (new Date(o.readyAt) - new Date(o.confirmedAt)) / 864e5) / made.length : null,
    delayed: orders.filter(o => o.state === 'Confirmed' && o.expectedAt && o.expectedAt < today && o.deliveryStatus !== 'Delivered'),
    completed: orders.filter(o => o.state === 'Completed'),
  };
}
export function customersReport(from, to) {
  const d = db();
  const rows = d.customers.map(c => ({ customer: c, ...customerStats(c.id) }));
  return {
    newCustomers: d.customers.filter(c => inRange(c.createdAt, from, to)),
    repeat: rows.filter(r => r.orders >= 2),
    top: [...rows].sort((a, b) => b.revenue - a.revenue).slice(0, 10),
    rows,
  };
}

// ---------- search ----------
export function search(q) {
  const s = String(q || '').trim().toLowerCase();
  if (s.length < 2) return [];
  const d = db(), out = [];
  // "SL-ORD-00125" should also find "SL-ORD-2026-00125"
  const m = s.match(/^(sl-[a-z]+)-(?:\d{4}-)?(\d+)$/);
  const has = (...f) => f.some(x => {
    const v = String(x || '').toLowerCase();
    return v.includes(s) || (m && v.startsWith(m[1] + '-') && v.endsWith(m[2]));
  });
  d.orders.forEach(o => { if (has(o.number, customerName(get('customers', o.customerId)))) out.push({ kind: 'Order', label: o.number, sub: customerName(get('customers', o.customerId)), href: `orders/${o.id}` }); });
  d.quotes.forEach(x => { if (has(x.number)) out.push({ kind: 'Quote', label: x.number, sub: customerName(get('customers', x.customerId)), href: `quotes/${x.id}` }); });
  d.customers.forEach(c => { if (has(c.code, c.company, c.contact, c.email, c.phone)) out.push({ kind: 'Customer', label: customerName(c), sub: c.code, href: `customers/${c.id}` }); });
  d.products.forEach(p => { if (has(p.sku, p.name, p.category)) out.push({ kind: 'Product', label: p.name, sub: p.sku, href: `products/${p.id}` }); });
  d.variants.forEach(v => { if (has(v.sku)) out.push({ kind: 'SKU', label: v.sku, sub: `${get('products', v.productId)?.name} — ${variantLabel(v)}`, href: `products/${v.productId}` }); });
  d.suppliers.forEach(x => { if (has(x.code, x.company, x.contact)) out.push({ kind: 'Supplier', label: x.company, sub: x.code, href: `suppliers/${x.id}` }); });
  d.invoices.forEach(i => { if (has(i.number)) out.push({ kind: 'Invoice', label: i.number, sub: get('orders', i.orderId)?.number, href: `orders/${i.orderId}` }); });
  d.purchaseOrders.forEach(p => { if (has(p.number)) out.push({ kind: 'Purchase order', label: p.number, sub: get('suppliers', p.supplierId)?.company, href: `purchase-orders/${p.id}` }); });
  d.leads.forEach(l => { if (has(l.number, l.name, l.company, l.clientRef)) out.push({ kind: 'Lead', label: l.number, sub: l.company || l.name, href: `leads/${l.id}` }); });
  // exact number matches first, e.g. "SL-ORD-00125" or "00125"
  const exact = x => x.label.toLowerCase() === s || !!(m && x.label.toLowerCase().endsWith(m[2]));
  return out.sort((a, b) => exact(b) - exact(a)).slice(0, 60);
}

// ---------- settings ----------
const SETTING_FIELDS = ['company', 'legalName', 'address', 'email', 'phone', 'whatsapp', 'defaultPaymentTerms', 'bankDetails', 'invoiceNote'];
export function saveSettings(data) {
  need('settings');
  const s = db().settings;
  const ch = diff(s, data, [...SETTING_FIELDS, 'invoiceDueDays', 'quoteValidityDays']);
  SETTING_FIELDS.forEach(f => { if (data[f] !== undefined) s[f] = String(data[f]).trim(); });
  ['invoiceDueDays', 'quoteValidityDays'].forEach(f => { if (data[f] !== undefined) s[f] = Math.max(1, Math.round(num(data[f]))); });
  if (ch) logAudit('Changed settings', 'settings', 'Company', ch);
  save();
}
export function setProductStatus(id, status) {
  need('products.edit');
  const p = get('products', id);
  const before = p.status;
  p.status = status;
  logAudit(status === 'Archived' ? 'Archived product' : 'Changed product status', 'product', p.sku, `${before} → ${status}`);
  save();
}

// ---------- first-run setup ----------
export async function setupCompany({ company, adminName, email, password, warehouse, external = false }) {
  const d = db();
  if (d.meta.setup) throw new Error('Seamline is already set up.');
  if (!String(adminName || '').trim()) throw new Error('Enter your name.');
  if (String(company || '').trim()) d.settings.company = String(company).trim();
  const u = await saveUser({ name: String(adminName).trim(), email, role: 'admin', password, external });
  actor = { id: u.id, name: u.name, role: 'admin', kind: 'staff' };
  if (!d.warehouses.length) saveWarehouse({ name: String(warehouse || '').trim() || 'Main warehouse', city: '' });
  d.meta.setup = true; d.meta.createdAt = iso();
  logAudit('Set up Seamline', 'settings', d.settings.company);
  save();
  return u;
}

// ---------- customer-facing documents (quotes & invoices) ----------
export function companyInfo() {
  const s = db().settings;
  return { company: s.company, legalName: s.legalName, address: s.address, email: s.email, phone: s.phone, whatsapp: s.whatsapp, bankDetails: s.bankDetails, invoiceNote: s.invoiceNote };
}
const docLines = items => items.map(i => {
  const p = i.productId ? get('products', i.productId) : null;
  const v = i.variantId ? get('variants', i.variantId) : null;
  const name = p?.name || i.description || 'Custom item';
  const detail = [v ? variantLabel(v) : '', p && i.description ? i.description : ''].filter(Boolean).join(' · ');
  return { name, detail, qty: i.qty, unitPrice: i.unitPrice, amount: i.qty * i.unitPrice };
});
const docCustomer = c => ({ name: customerName(c), contact: c?.contact || '', email: c?.email || '', phone: c?.phone || '', address: c?.address || '' });
export function quoteDoc(q) {
  const t = docTotals(q);
  return { type: 'quote', number: q.number, date: q.sentAt || q.createdAt, validUntil: q.validUntil, status: q.status,
    customer: docCustomer(get('customers', q.customerId)), items: docLines(q.items),
    totals: { subtotal: t.subtotal, discount: t.discount, deliveryCharge: t.deliveryCharge, taxRate: q.taxRate, tax: t.tax, total: t.total },
    productionDays: q.productionDays, paymentTerms: q.paymentTerms, notes: q.notes, company: companyInfo() };
}
export function invoiceDoc(o) {
  const inv = invoiceFor(o.id);
  if (!inv) return null;
  const t = orderTotals(o);
  return { type: 'invoice', number: inv.number, orderNumber: o.number, date: inv.issuedAt, dueAt: inv.dueAt, status: invoiceStatus(inv),
    customer: docCustomer(get('customers', o.customerId)), items: docLines(o.items),
    totals: { subtotal: t.subtotal, discount: t.discount, deliveryCharge: t.deliveryCharge, taxRate: o.taxRate, tax: t.tax, total: t.total, paid: t.paid, balance: Math.max(0, t.balance) },
    paymentTerms: db().settings.defaultPaymentTerms, notes: o.customerNotes, company: companyInfo() };
}
