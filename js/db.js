// ------------------------------------------------------------
// Seamline data layer
// The whole app works on an in-memory copy of the data (db()).
// save() persists it: to localStorage in LOCAL mode, or to Supabase
// in CLOUD mode (cloud.js listens to save() and syncs only what changed).
// ------------------------------------------------------------
import { SUPABASE_URL, SUPABASE_ANON_KEY, PUBLIC_BASE_URL } from './config.js';

const KEY = 'seamline.db.v2';
let cache = null;
let clockOverride = null;
const listeners = [];

export const CLOUD = !!(SUPABASE_URL && SUPABASE_ANON_KEY);
export const STORAGE_KEY = KEY;
export const PUBLIC_KEY = 'seamline.public.v2';
export const INBOX_KEY = 'seamline.inbox.v2';
export const baseUrl = () => PUBLIC_BASE_URL ? PUBLIC_BASE_URL.replace(/\/?$/, '/') : new URL('.', location.href).href;

export const now = () => (clockOverride ? new Date(clockOverride) : new Date());
export const iso = () => now().toISOString();
export function setClock(d) { clockOverride = d ? new Date(d).getTime() : null; }

export function uid(prefix = 'id') {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return prefix + '_' + [...a].map(b => (b % 36).toString(36)).join('');
}
export function secureToken(bytes = 20) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export const DEFAULT_CATEGORIES = ['T-shirts', 'Polos', 'Hoodies', 'Sweatshirts', 'Bottoms', 'Sportswear', 'Caps', 'Bags', 'Bottles', 'Promotional Products', 'Packaging', 'Other'];
export const COLLECTIONS = ['users', 'customers', 'products', 'variants', 'warehouses', 'stock', 'movements', 'suppliers', 'supplierPrices',
  'purchaseOrders', 'goodsReceipts', 'leads', 'quotes', 'orders', 'payments', 'invoices', 'expenses', 'qualityChecks', 'tracking',
  'customerProducts', 'reorders', 'notifications', 'outbox', 'audit'];
export const SINGLETONS = ['meta', 'settings', 'categories'];

export function emptyDb() {
  const d = {
    meta: { version: 2, setup: false, seq: {} },
    settings: {
      company: 'Seamline', legalName: 'Seamline (Pvt) Ltd', address: '', email: '', phone: '', whatsapp: '',
      currency: 'Rs.', invoiceDueDays: 14, defaultPaymentTerms: '50% advance, balance before dispatch', quoteValidityDays: 14,
      bankDetails: '', invoiceNote: 'Thank you for your business.',
    },
    categories: [...DEFAULT_CATEGORIES],
  };
  COLLECTIONS.forEach(c => { d[c] = []; });
  return d;
}
function normalize(d) {
  const base = emptyDb();
  for (const k of Object.keys(base)) if (d[k] === undefined) d[k] = base[k];
  d.settings = { ...base.settings, ...d.settings };
  d.meta = { ...base.meta, ...d.meta, seq: { ...(d.meta?.seq || {}) } };
  return d;
}

export function db() {
  if (!cache) {
    let data = null;
    if (!CLOUD) { try { const raw = localStorage.getItem(KEY); data = raw ? JSON.parse(raw) : null; } catch { data = null; } }
    cache = normalize(data || emptyDb());
  }
  return cache;
}
// Used by cloud.js after downloading data from Supabase.
export function setData(data) { cache = normalize(data); }

export function save() {
  if (!CLOUD) {
    try { localStorage.setItem(KEY, JSON.stringify(cache)); }
    catch { throw new Error('Browser storage is full. Remove large images, or connect Supabase (see README).'); }
  }
  listeners.forEach(fn => { try { fn(); } catch (e) { console.error(e); } });
}
export const onSave = fn => listeners.push(fn);

export function reload() { if (!CLOUD) cache = null; return db(); }
export function wipe() { localStorage.removeItem(KEY); localStorage.removeItem(PUBLIC_KEY); localStorage.removeItem(INBOX_KEY); cache = null; }
export function exportJson() { return JSON.stringify(db(), null, 2); }
export function importJson(text) {
  const data = JSON.parse(text);
  if (!data || !data.meta || !Array.isArray(data.orders)) throw new Error('That file is not a Seamline backup.');
  cache = normalize(data); save();
}

export function nextNumber(kind, prefix, pad = 5, yearly = true) {
  const d = db();
  d.meta.seq[kind] = (d.meta.seq[kind] || 0) + 1;
  const n = String(d.meta.seq[kind]).padStart(pad, '0');
  return yearly ? `${prefix}-${now().getFullYear()}-${n}` : `${prefix}-${n}`;
}

// Local calendar date as YYYY-MM-DD (avoids UTC shifting dates in Sri Lanka, UTC+5:30)
export function ymd(d = now()) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
