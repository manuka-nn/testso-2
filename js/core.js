// Core helpers for the staff app: rendering, actions, routing helpers.
import * as S from './services.js';
import { db, ymd } from './db.js';
import { esc, toast, money } from './ui.js';

export const app = { user: null, actions: {}, params: {}, query: {}, path: '' };
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function render(html, actions = {}) {
  $('#main').innerHTML = html;
  app.actions = actions;
}
export function run(fn) {
  return async (...args) => {
    try { await fn(...args); }
    catch (e) { console.error(e); toast(e.message || String(e), 'error'); }
  };
}
let rerenderFn = () => {};
export const setRerender = f => { rerenderFn = f; };
export const rerender = () => rerenderFn();
export const can = p => S.can(app.user, p);
export const go = path => { location.hash = `#/${path}`; };
export function setQuery(key, value) {
  const q = new URLSearchParams(app.query);
  if (value) q.set(key, value); else q.delete(key);
  const s = q.toString();
  location.hash = `#/${app.path}${s ? `?${s}` : ''}`;
}

export function pageHead(title, sub = '', actions = '') {
  return `<div class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>${actions ? `<div class="head-actions">${actions}</div>` : ''}</div>`;
}
export const btn = (label, action, cls = '', attrs = '') => `<button type="button" class="btn ${cls}" data-action="${action}" ${attrs}>${esc(label)}</button>`;
export const linkBtn = (label, href, cls = '') => `<a class="btn ${cls}" href="#/${href}">${esc(label)}</a>`;
export const a = (label, href) => `<a href="#/${href}">${esc(label)}</a>`;
export function panel(title, body, actions = '', cls = '') {
  return `<section class="panel ${cls}">${title || actions ? `<header><h2>${esc(title)}</h2>${actions ? `<div class="panel-actions">${actions}</div>` : ''}</header>` : ''}${body}</section>`;
}
export function kv(pairs) {
  return `<dl class="kv">${pairs.filter(Boolean).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v === '' || v == null ? '—' : v}</dd></div>`).join('')}</dl>`;
}
export function stat(label, value, note = '', href = '') {
  const inner = `<span class="stat-label">${esc(label)}</span><strong class="stat-value">${value}</strong>${note ? `<span class="stat-note">${note}</span>` : ''}`;
  return href ? `<a class="stat" href="#/${href}">${inner}</a>` : `<div class="stat">${inner}</div>`;
}
export function filters(list, searchPlaceholder = '') {
  return `<div class="filters">${searchPlaceholder ? `<input type="search" class="search-rows" data-filter placeholder="${esc(searchPlaceholder)}" aria-label="${esc(searchPlaceholder)}">` : ''}${list.map(f => `<label class="filter"><span>${esc(f.label)}</span><select data-query="${f.key}"><option value="">All</option>${f.options.map(o => { const v = typeof o === 'object' ? o.value : o, l = typeof o === 'object' ? o.label : o; return `<option value="${esc(v)}" ${String(app.query[f.key] || '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`; }).join('')}</select></label>`).join('')}</div>`;
}
export function tabs(list, current) {
  return `<nav class="tabs" aria-label="Sections">${list.map(([key, label]) => `<button type="button" class="${key === current ? 'on' : ''}" data-tab="${key}" aria-current="${key === current ? 'true' : 'false'}">${esc(label)}</button>`).join('')}</nav>`;
}
export const custName = id => S.customerName(S.get('customers', id));
export const userName = id => S.get('users', id)?.name || '—';
export const staffOptions = () => db().users.filter(u => u.active !== false).map(u => ({ value: u.id, label: `${u.name} (${S.ROLES[u.role]})` }));
export const customerOptions = () => db().customers.filter(c => c.status !== 'Inactive').sort((x, y) => S.customerName(x).localeCompare(S.customerName(y))).map(c => ({ value: c.id, label: `${S.customerName(c)} · ${c.code}` }));
export const warehouseOptions = () => S.activeWarehouses().map(w => ({ value: w.id, label: w.name }));
export const notFound = what => render(`<div class="empty big">That ${esc(what)} could not be found. <a href="#/dashboard">Back to dashboard</a></div>`);
export const moneyCell = n => `<span class="num">${money(n)}</span>`;
export const waLink = (phone, text) => `https://wa.me/${String(phone || '').replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
export function range() {
  const q = app.query;
  const from = q.from ? new Date(`${q.from}T00:00:00`) : S.startOfMonth();
  const to = q.to ? new Date(`${q.to}T23:59:59`) : S.endOfDay();
  return { from, to, fromStr: ymd(from), toStr: ymd(to) };
}
export function rangePicker() {
  const r = range();
  const d = n => { const x = new Date(); x.setDate(x.getDate() - n); return ymd(x); };
  const m0 = ymd(S.startOfMonth());
  const today = ymd(new Date());
  const presets = [['Today', today, today], ['7 days', d(6), today], ['30 days', d(29), today], ['This month', m0, today], ['90 days', d(89), today], ['This year', `${new Date().getFullYear()}-01-01`, today]];
  return `<div class="range"><div class="presets">${presets.map(([l, f, t]) => `<button type="button" class="chip ${r.fromStr === f && r.toStr === t ? 'on' : ''}" data-range="${f}|${t}">${l}</button>`).join('')}</div>
    <label>From <input type="date" data-range-from value="${r.fromStr}"></label><label>To <input type="date" data-range-to value="${r.toStr}"></label></div>`;
}
