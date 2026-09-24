// ------------------------------------------------------------
// Supabase (CLOUD mode) for the staff app.
// - records table: one row per record, only changed rows are uploaded
// - realtime: changes made by colleagues appear without refreshing
// - public_docs: customer-safe documents (see publisher.js)
// - inbox: requests from customers, applied by the staff app
// ------------------------------------------------------------
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import { db, setData, onSave, COLLECTIONS, SINGLETONS, emptyDb } from './db.js';
import { setPublicWriter, publish, processInbox } from './publisher.js';

const NEWEST_FIRST = ['expenses', 'goodsReceipts', 'leads', 'movements', 'notifications', 'outbox', 'purchaseOrders', 'qualityChecks', 'quotes', 'reorders', 'supplierPrices', 'audit'];
const clients = {};
export function getClient(storageKey = 'seamline-staff') {
  if (!clients[storageKey]) {
    if (!window.supabase?.createClient) throw new Error('The Supabase library did not load. Check vendor/supabase.js.');
    clients[storageKey] = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey, detectSessionInUrl: true } });
  }
  return clients[storageKey];
}
const sb = () => getClient();
const check = ({ data, error }) => { if (error) throw new Error(friendly(error)); return data; };
export function friendly(error) {
  const m = error?.message || String(error);
  if (/relation .* does not exist|Could not find the (table|function)/i.test(m)) return 'Supabase is connected but the database tables are missing. Run supabase/schema.sql in the Supabase SQL editor.';
  if (/Invalid login credentials/i.test(m)) return 'That email or password is incorrect.';
  if (/Email not confirmed/i.test(m)) return 'Confirm your email first — check your inbox for the Supabase confirmation link.';
  if (/row-level security|permission denied/i.test(m)) return 'Your account does not have permission for this. Ask an admin.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Cannot reach Supabase. Check your internet connection.';
  return m;
}

// Stable JSON (sorted keys) so jsonb key re-ordering never looks like a change.
export function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}
const recId = (c, r) => r.id || (c === 'stock' ? `${r.variantId}|${r.warehouseId}` : null);
const K = (c, id) => `${c}\u0001${id}`;
const synced = new Map();

// ---------- status ----------
let status = { state: 'idle', message: '' };
const statusFns = [];
export const onStatus = fn => { statusFns.push(fn); fn(status); };
function setStatus(state, message = '') { status = { state, message }; statusFns.forEach(f => f(status)); }

// ---------- auth ----------
export async function currentSession() { return check(await sb().auth.getSession()).session; }
export async function signIn(email, password) { return check(await sb().auth.signInWithPassword({ email: String(email).trim(), password })); }
export async function signUp(email, password) {
  const r = check(await sb().auth.signUp({ email: String(email).trim(), password, options: { emailRedirectTo: location.href.split('#')[0] } }));
  return { session: r.session, needsConfirm: !r.session };
}
export async function signOut() { try { await sb().auth.signOut(); } catch { /* ignore */ } }
export async function resetPassword(email) { check(await sb().auth.resetPasswordForEmail(String(email).trim(), { redirectTo: location.href.split('#')[0] })); }
export async function updatePassword(password) { check(await sb().auth.updateUser({ password })); }
export const onAuthEvent = fn => sb().auth.onAuthStateChange((event, session) => fn(event, session));
export async function staffRole() { return check(await sb().rpc('my_staff_role')); }
export async function staffCount() { return check(await sb().rpc('staff_count')); }
export async function claimAdmin() { return check(await sb().rpc('claim_admin')); }
export async function setStaff(email, role, active = true) { check(await sb().from('staff').upsert({ email: String(email).toLowerCase(), role, active })); }
// Creates a login for a colleague or customer without signing the admin out.
export async function createLogin(email, password) {
  const tmp = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, storageKey: `seamline-tmp-${Date.now()}` } });
  const { data, error } = await tmp.auth.signUp({ email: String(email).trim(), password });
  if (error && !/already registered|already been registered/i.test(error.message)) throw new Error(friendly(error));
  return { existed: !!error || (data?.user && data.user.identities && data.user.identities.length === 0), needsConfirm: !error && !data?.session };
}

// ---------- load ----------
async function selectAll(table, cols) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const rows = check(await sb().from(table).select(cols).range(from, from + 999));
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
export async function loadAll() {
  setStatus('loading');
  const rows = await selectAll('records', 'collection,id,data');
  const d = emptyDb();
  const hasSingleton = {};
  for (const r of rows) {
    if (SINGLETONS.includes(r.collection)) { d[r.collection] = r.data; hasSingleton[r.collection] = true; }
    else if (COLLECTIONS.includes(r.collection)) d[r.collection].push(r.data);
  }
  const when = x => x.at || x.createdAt || x.issuedAt || '';
  for (const c of COLLECTIONS) d[c].sort((a, b) => (NEWEST_FIRST.includes(c) ? when(b).localeCompare(when(a)) : when(a).localeCompare(when(b))));
  setData(d);
  synced.clear();
  const cur = db();
  for (const r of rows) if (SINGLETONS.includes(r.collection) || COLLECTIONS.includes(r.collection)) {
    const obj = SINGLETONS.includes(r.collection) ? cur[r.collection] : cur[r.collection].find(x => recId(r.collection, x) === r.id);
    if (obj) synced.set(K(r.collection, r.id), stable(obj));
  }
  const pub = await selectAll('public_docs', 'key,data');
  setPublicWriter(writePublic, Object.fromEntries(pub.map(p => [p.key, stable(p.data)])));
  setStatus('saved');
  return rows.length;
}

// ---------- save (diff + upload) ----------
let timer = null, flushing = false, again = false, retry = 0, who = '';
export const setWho = email => { who = email; };
function currentRows() {
  const d = db(), rows = new Map();
  for (const c of COLLECTIONS) for (const r of d[c]) { const id = recId(c, r); if (id) rows.set(K(c, id), { collection: c, id, data: r }); }
  for (const s of SINGLETONS) rows.set(K(s, 'main'), { collection: s, id: 'main', data: d[s] });
  return rows;
}
export function pendingChanges() {
  const rows = currentRows();
  let n = 0;
  for (const [k, r] of rows) if (synced.get(k) !== stable(r.data)) n++;
  for (const k of synced.keys()) if (!rows.has(k)) n++;
  return n;
}
function schedule() { clearTimeout(timer); setStatus('saving'); timer = setTimeout(flush, 300); }
export async function flush() {
  if (flushing) { again = true; return; }
  flushing = true;
  try {
    const rows = currentRows();
    const ups = [];
    for (const [k, r] of rows) { const j = stable(r.data); if (synced.get(k) !== j) ups.push({ k, j, row: { collection: r.collection, id: r.id, data: r.data, updated_by: who, updated_at: new Date().toISOString() } }); }
    const dels = [...synced.keys()].filter(k => !rows.has(k));
    for (let i = 0; i < ups.length; i += 300) {
      const chunk = ups.slice(i, i + 300);
      check(await sb().from('records').upsert(chunk.map(u => u.row), { onConflict: 'collection,id' }));
      chunk.forEach(u => synced.set(u.k, u.j));
    }
    const byCol = {};
    dels.forEach(k => { const [c, id] = k.split('\u0001'); (byCol[c] = byCol[c] || []).push(id); });
    for (const [c, ids] of Object.entries(byCol)) {
      for (let i = 0; i < ids.length; i += 200) check(await sb().from('records').delete().eq('collection', c).in('id', ids.slice(i, i + 200)));
      ids.forEach(id => synced.delete(K(c, id)));
    }
    await publish();
    retry = 0;
    setStatus('saved');
  } catch (e) {
    console.error(e);
    setStatus('error', friendly(e));
    retry = Math.min(retry + 1, 6);
    clearTimeout(timer); timer = setTimeout(flush, 2000 * retry);
  } finally {
    flushing = false;
    if (again) { again = false; schedule(); }
  }
}
async function writePublic(upserts, removals) {
  for (let i = 0; i < upserts.length; i += 100) check(await sb().from('public_docs').upsert(upserts.slice(i, i + 100).map(u => ({ ...u, updated_at: new Date().toISOString() })), { onConflict: 'key' }));
  for (let i = 0; i < removals.length; i += 200) check(await sb().from('public_docs').delete().in('key', removals.slice(i, i + 200)));
}

// ---------- realtime (colleagues' changes) ----------
let onRemoteFn = () => {}, remoteTimer = null;
function applyRemote(p) {
  const d = db();
  const row = p.eventType === 'DELETE' ? p.old : p.new;
  if (!row?.collection || !row.id) return;
  const c = row.collection, k = K(c, row.id);
  if (p.eventType === 'DELETE') {
    if (!synced.has(k)) return;
    if (COLLECTIONS.includes(c)) { const i = d[c].findIndex(x => recId(c, x) === row.id); if (i >= 0) d[c].splice(i, 1); }
    synced.delete(k);
  } else {
    const j = stable(row.data);
    if (synced.get(k) === j) return;
    if (SINGLETONS.includes(c)) {
      if (c === 'meta') { const seq = { ...d.meta.seq }; for (const [n, v] of Object.entries(row.data.seq || {})) seq[n] = Math.max(seq[n] || 0, v); d.meta = { ...row.data, seq }; }
      else d[c] = row.data;
    } else if (COLLECTIONS.includes(c)) {
      const i = d[c].findIndex(x => recId(c, x) === row.id);
      if (i >= 0) d[c][i] = row.data;
      else if (NEWEST_FIRST.includes(c)) d[c].unshift(row.data); else d[c].push(row.data);
    } else return;
    synced.set(k, SINGLETONS.includes(c) ? stable(d[c]) : j);
  }
  clearTimeout(remoteTimer); remoteTimer = setTimeout(() => onRemoteFn(), 250);
}
let inboxFn = () => {};
export function startSync({ onRemote, onInbox }) {
  onRemoteFn = onRemote; inboxFn = onInbox;
  onSave(schedule);
  sb().channel('seamline-records').on('postgres_changes', { event: '*', schema: 'public', table: 'records' }, applyRemote).subscribe();
  sb().channel('seamline-inbox').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'inbox' }, () => inboxFn()).subscribe();
  setInterval(() => inboxFn(), 30000);
  window.addEventListener('beforeunload', e => { if (status.state === 'saving' || status.state === 'error') { e.preventDefault(); e.returnValue = ''; } });
  schedule(); // upload anything created before sync started (first-run setup) and publish customer documents
}
export async function ingestInbox() {
  // claim_inbox deletes and returns items in one step, so two open tabs never apply the same request twice
  const items = check(await sb().rpc('claim_inbox')) || [];
  return processInbox(items, async () => {});
}
export async function publishNow() { await publish(); }
