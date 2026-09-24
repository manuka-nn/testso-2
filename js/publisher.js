// ------------------------------------------------------------
// Customer-facing data.
// Customers never read the internal database. After every save, the staff
// app publishes small, customer-safe documents (tracking pages, quotes,
// portal accounts, catalogue). Customers send things back through an
// "inbox" (quote requests, approvals, reorders, messages) which the staff
// app picks up and applies through the normal business rules.
// ------------------------------------------------------------
import * as S from './services.js';
import { db, CLOUD, PUBLIC_KEY, INBOX_KEY } from './db.js';

let last = null;          // key -> JSON string of what is currently published
let writer = null;        // cloud writer (set by cloud.js)
export function setPublicWriter(w, existing) { writer = w; last = existing; }

function orderDoc(o) {
  const c = S.get('customers', o.customerId);
  return { kind: 'order', view: S.publicOrderView(o), invoice: S.invoiceDoc(o), customerName: S.customerName(c), company: S.companyInfo() };
}
function quotePublic(q) {
  return { kind: 'quote', token: q.token, status: q.status, doc: S.quoteDoc(q), changeRequests: q.changeRequests || [], orderNumber: q.orderId ? S.get('orders', q.orderId)?.number : null, company: S.companyInfo() };
}
export function catalogueProducts() {
  return db().products.filter(p => p.status === 'Active' && p.kind !== 'Made to order' && S.productVariants(p.id).length).map(p => ({
      id: p.id, name: p.name, sku: p.sku, category: p.category, description: p.description, material: p.material, moq: p.moq, price: p.wholesalePrice, image: p.image || '',
      variants: S.productVariants(p.id).map(v => ({ id: v.id, color: v.color, size: v.size, available: Math.max(0, S.variantStock(v.id).available), low: S.variantStock(v.id).available <= v.reorderLevel })),
    }));
}
const catalogue = () => ({ kind: 'catalogue', products: catalogueProducts() });
function portalDoc(c) {
  const d = db();
  const orders = d.orders.filter(o => o.customerId === c.id && o.state !== 'Draft').sort((a, b) => (b.confirmedAt || b.createdAt).localeCompare(a.confirmedAt || a.createdAt));
  return {
    kind: 'portal',
    customer: { id: c.id, code: c.code, company: c.company, contact: c.contact, email: c.email, phone: c.phone, whatsapp: c.whatsapp, address: c.address, portalEmail: c.portal.email, name: S.customerName(c) },
    orders: orders.map(o => ({ id: o.id, number: o.number, view: S.publicOrderView(o), invoice: S.invoiceDoc(o), trackingToken: S.activeToken(o.id)?.token || null })),
    quotes: d.quotes.filter(q => q.customerId === c.id && q.status !== 'Draft').map(q => ({ id: q.id, number: q.number, token: q.token, status: q.status, validUntil: q.validUntil, createdAt: q.sentAt || q.createdAt, total: S.docTotals(q).total, doc: S.quoteDoc(q), changeRequests: q.changeRequests || [] })),
    library: d.customerProducts.filter(p => p.customerId === c.id).map(p => {
      const st = p.fulfilment === 'stock' && p.variantId ? S.variantStock(p.variantId) : null;
      return { id: p.id, name: p.name, specs: p.specs, material: p.material, printMethod: p.printMethod, sizeChart: p.sizeChart || '', design: p.design || '', lastOrderNumber: p.lastOrderNumber, lastQty: p.lastQty, lastPrice: p.lastPrice, timesOrdered: p.timesOrdered, fulfilment: p.fulfilment, availableNow: st ? Math.max(0, st.available) : null };
    }),
    reorders: d.reorders.filter(r => r.customerId === c.id).map(r => ({ number: r.number, status: r.status, createdAt: r.createdAt, lines: r.lines.map(l => ({ name: l.name, qty: l.qty })), orderNumber: r.orderId ? S.get('orders', r.orderId)?.number : null })),
    payments: d.payments.filter(p => p.customerId === c.id && !p.void).map(p => ({ number: p.number, at: p.at, orderNumber: S.get('orders', p.orderId)?.number, method: p.method, amount: p.amount })),
    notifications: d.notifications.filter(n => n.audience === 'customer' && n.customerId === c.id).slice(0, 30).map(n => ({ at: n.at, text: n.text })),
    company: S.companyInfo(),
  };
}

export function computeDocs() {
  const d = db();
  const docs = {};
  docs['settings:main'] = { kind: 'settings', owner: null, data: { kind: 'settings', company: S.companyInfo(), ready: !!d.meta.setup } };
  docs['catalogue:main'] = { kind: 'catalogue', owner: null, data: catalogue() };
  for (const t of d.tracking.filter(x => x.active)) {
    const o = S.get('orders', t.orderId);
    if (o && o.state !== 'Draft') docs[`order:${t.token}`] = { kind: 'order', owner: null, data: orderDoc(o) };
  }
  for (const q of d.quotes.filter(x => x.status !== 'Draft' && x.token)) docs[`quote:${q.token}`] = { kind: 'quote', owner: null, data: quotePublic(q) };
  for (const c of d.customers.filter(x => x.portal?.email && x.status !== 'Inactive')) docs[`portal:${c.portal.email}`] = { kind: 'portal', owner: c.portal.email, data: portalDoc(c) };
  return docs;
}

// Publish only what changed since last time.
export async function publish() {
  const docs = computeDocs();
  const next = Object.fromEntries(Object.entries(docs).map(([k, v]) => [k, JSON.stringify(v.data)]));
  if (!CLOUD) {
    const map = Object.fromEntries(Object.entries(docs).map(([k, v]) => [k, v.data]));
    const str = JSON.stringify(map);
    if (localStorage.getItem(PUBLIC_KEY) !== str) { try { localStorage.setItem(PUBLIC_KEY, str); } catch (e) { console.warn('Public docs not saved', e); } }
    last = next;
    return;
  }
  if (!writer || !last) return;
  const upserts = Object.entries(docs).filter(([k]) => last[k] !== next[k]).map(([k, v]) => ({ key: k, kind: v.kind, owner_email: v.owner, data: v.data }));
  const removals = Object.keys(last).filter(k => !(k in next));
  if (!upserts.length && !removals.length) return;
  const prev = last;
  last = next;
  try { await writer(upserts, removals); }
  catch (e) { last = prev; throw e; }
}

// ---------- inbox: things customers send to Seamline ----------
const INBOX_KINDS = ['quote_request', 'quote_response', 'reorder', 'bulk_request', 'support', 'profile'];
function customerFor(item) {
  const d = db();
  if (item.sender_email) return d.customers.find(c => c.portal?.email === String(item.sender_email).toLowerCase()) || null;
  if (!CLOUD && item.payload?.customerId) return S.get('customers', item.payload.customerId) || null;
  return null;
}
// Applies one inbox item. Returns a short description for the activity log.
export function applyInboxItem(item) {
  const p = item.payload || {};
  if (!INBOX_KINDS.includes(item.kind)) throw new Error(`Unknown request type ${item.kind}`);
  if (item.kind === 'quote_request') {
    const l = S.createLead({ ...p, customerId: null, items: [] }, 'Website form');
    return `Quote request ${l.number}`;
  }
  if (item.kind === 'quote_response') {
    const q = S.findQuoteByTokenOnly(p.token);
    if (!q) throw new Error('A customer responded to a quote that no longer exists.');
    if (p.action === 'viewed') { S.markQuoteViewed(q.id); return `Quote ${q.number} viewed`; }
    if (!['approve', 'reject', 'changes'].includes(p.action)) throw new Error('Unknown quote response');
    try { S.respondToQuote(q.id, p.action, p.message || ''); }
    catch (e) { S.notify('quote.error', `Customer response to ${q.number} could not be applied: ${e.message}`, { link: `#/quotes/${q.id}` }); throw e; }
    return `Quote ${q.number}: ${p.action}`;
  }
  const c = customerFor(item);
  if (!c) throw new Error('A portal request came from an account that is no longer linked to a customer.');
  if (item.kind === 'reorder') {
    const r = S.createReorder({ customerId: c.id, lines: p.lines || [], note: p.note || '', source: 'Portal' });
    return `Reorder ${r.number}`;
  }
  if (item.kind === 'bulk_request') {
    const l = S.createLead({ name: c.contact || S.customerName(c), company: c.company, email: c.email || c.portal?.email, phone: c.phone || c.whatsapp,
      productType: 'Wholesale ready stock', quantity: (p.items || []).reduce((t, x) => t + (+x.qty || 0), 0), requirements: p.note || '',
      items: (p.items || []).map(x => ({ name: x.name, qty: +x.qty || 0, variantId: x.variantId })), customerId: c.id }, 'Portal');
    return `Bulk order request ${l.number}`;
  }
  if (item.kind === 'support') {
    const msg = String(p.message || '').trim().slice(0, 4000);
    if (!msg) return 'Empty message ignored';
    S.notify('support.message', `Message from ${S.customerName(c)}${p.about ? ` about ${p.about}` : ''}: ${msg.slice(0, 120)}`, { link: `#/customers/${c.id}` });
    S.addCustomerNote(c.id, `Portal message${p.about ? ` (${p.about})` : ''}: ${msg}`);
    return 'Support message';
  }
  if (item.kind === 'profile') {
    const allowed = ['contact', 'email', 'phone', 'whatsapp', 'address'];
    S.saveCustomer({ id: c.id, ...Object.fromEntries(allowed.filter(k => p[k] !== undefined).map(k => [k, String(p[k]).slice(0, 300)])) });
    S.notify('customer.profile', `${S.customerName(c)} updated their contact details`, { link: `#/customers/${c.id}` });
    return 'Profile update';
  }
  return '';
}

// Runs all pending items with a neutral actor, then restores the staff actor.
export async function processInbox(items, removeFn) {
  if (!items.length) return 0;
  const staff = S.getActor();
  let done = 0;
  const handled = [];
  for (const it of items) {
    S.setActor({ id: 'portal', name: it.kind === 'quote_request' ? 'Website form' : 'Customer', role: 'customer', kind: 'customer' });
    try { applyInboxItem(it); done++; }
    catch (e) { console.warn('Inbox item failed', it, e); }
    finally { handled.push(it.id); }
  }
  S.setActor(staff);
  await removeFn(handled);
  return done;
}

// Local mode inbox (same browser).
export function localInboxItems() {
  try { return JSON.parse(localStorage.getItem(INBOX_KEY)) || []; } catch { return []; }
}
export function localInboxRemove(ids) {
  const rest = localInboxItems().filter(x => !ids.includes(x.id));
  localStorage.setItem(INBOX_KEY, JSON.stringify(rest));
}
