// Customer side (tracking page, quote page, request form, portal).
// Reads only customer-safe documents; writes only to the inbox.
import { CLOUD, PUBLIC_KEY, INBOX_KEY, uid } from './db.js';
import { getClient, friendly } from './cloud.js';

const localDocs = () => { try { return JSON.parse(localStorage.getItem(PUBLIC_KEY)) || {}; } catch { return {}; } };
export const customerClient = () => getClient('seamline-customer');

export async function getDoc(kind, key) {
  if (!CLOUD) return localDocs()[`${kind}:${key}`] || null;
  const { data, error } = await customerClient().rpc('get_public_doc', { p_kind: kind, p_key: key });
  if (error) throw new Error(friendly(error));
  return data || null;
}
export async function getPortalDoc(email) {
  if (!CLOUD) return localDocs()[`portal:${String(email).toLowerCase()}`] || null;
  const { data, error } = await customerClient().rpc('get_portal_doc');
  if (error) throw new Error(friendly(error));
  return data || null;
}
export async function sendInbox(kind, payload) {
  if (!CLOUD) {
    let list = [];
    try { list = JSON.parse(localStorage.getItem(INBOX_KEY)) || []; } catch { list = []; }
    list.push({ id: uid('in'), kind, payload, created_at: new Date().toISOString() });
    try { localStorage.setItem(INBOX_KEY, JSON.stringify(list)); }
    catch { throw new Error('Could not send — browser storage is full. Try smaller images.'); }
    return true;
  }
  const { error } = await customerClient().rpc('submit_inbox', { p_kind: kind, p_payload: payload });
  if (error) throw new Error(friendly(error));
  return true;
}
// Re-run fn when data changes: storage events (local) or polling (cloud).
export function watch(fn, seconds = 15) {
  if (!CLOUD) window.addEventListener('storage', e => { if (e.key === PUBLIC_KEY) fn(); });
  else setInterval(() => { if (document.visibilityState === 'visible') fn(); }, seconds * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') fn(); });
}
