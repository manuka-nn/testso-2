// Staff app entry point: login, app shell, hash router, delegated events.
import * as S from './services.js';
import { db, reload, save, onSave, STORAGE_KEY, INBOX_KEY, CLOUD } from './db.js';
import { esc, toast, initials, formModal } from './ui.js';
import { app, $, $$, run, setRerender, can, go } from './core.js';
import * as Cloud from './cloud.js';
import { publish, processInbox, localInboxItems, localInboxRemove } from './publisher.js';
import { viewGuide } from './views-guide.js';
import * as VS from './views-sales.js';
import * as VO from './views-ops.js';
import * as VA from './views-admin.js';

const SESSION_KEY = 'seamline.staff';

// ---------- routes (specific paths before :id) ----------
const ROUTES = [
  ['dashboard', VS.viewDashboard, 'dashboard'],
  ['search', VS.viewSearch, 'search'],
  ['notifications', VA.viewNotifications, 'dashboard'],
  ['guide', viewGuide, 'dashboard'],
  ['leads', VS.viewLeads, 'leads'], ['leads/:id', VS.viewLead, 'leads'],
  ['quotes', VS.viewQuotes, 'quotes'], ['quotes/new', VS.viewQuoteEditor, 'quotes'], ['quotes/:id/edit', VS.viewQuoteEditor, 'quotes'], ['quotes/:id', VS.viewQuote, 'quotes'],
  ['customers', VS.viewCustomers, 'customers'], ['customers/:id', VS.viewCustomer, 'customers'],
  ['orders', VS.viewOrders, 'orders'], ['orders/new', VS.viewOrderEditor, 'orders.create'], ['orders/:id/edit', VS.viewOrderEditor, 'orders.create'], ['orders/:id', VS.viewOrder, 'orders'],
  ['reorders', VS.viewReorders, 'reorders'],
  ['products', VO.viewProducts, 'products'], ['products/new', VO.viewProductEditor, 'products.edit'], ['products/:id/edit', VO.viewProductEditor, 'products.edit'], ['products/:id', VO.viewProduct, 'products'],
  ['catalogue', VO.viewCatalogue, 'catalogue'], ['categories', VO.viewCategories, 'products'],
  ['stock', VO.viewStock, 'inventory'], ['movements', VO.viewMovements, 'inventory'], ['low-stock', VO.viewLowStock, 'inventory'], ['warehouses', VO.viewWarehouses, 'inventory'],
  ['production', VO.viewProduction, 'production'], ['qc', VO.viewQC, 'production'], ['production-tracking', VO.viewProductionTracking, 'production'],
  ['suppliers', VO.viewSuppliers, 'suppliers'], ['suppliers/:id', VO.viewSupplier, 'suppliers'],
  ['purchase-orders', VO.viewPurchaseOrders, 'purchasing'], ['purchase-orders/new', VO.viewPOEditor, 'purchasing'], ['purchase-orders/:id', VO.viewPO, 'purchasing'],
  ['receiving', VO.viewReceiving, 'purchasing'],
  ['sales', VA.viewSales, 'invoices'], ['invoices', VA.viewInvoices, 'invoices'], ['payments', VA.viewPayments, 'payments'], ['expenses', VA.viewExpenses, 'expenses'], ['profit', VA.viewProfit, 'profit'],
  ['reports', VA.viewReports, 'reports'],
  ['portal', VA.viewPortalAdmin, 'customers'],
  ['settings', VA.viewSettings, 'settings'], ['audit', VA.viewAudit, 'audit'],
].map(([pattern, view, perm]) => ({ parts: pattern.split('/'), view, perm, key: pattern.split('/')[0] }));

// ---------- navigation (spec section 40) ----------
const NAV = [
  { items: [['dashboard', 'Dashboard', 'dashboard']] },
  { label: 'Sales', items: [['leads', 'Leads', 'leads'], ['quotes', 'Quotes', 'quotes'], ['customers', 'Customers', 'customers'], ['orders', 'Orders', 'orders'], ['reorders', 'Reorders', 'reorders']] },
  { label: 'Products', items: [['products', 'Product library', 'products'], ['catalogue', 'Wholesale catalogue', 'catalogue'], ['categories', 'Categories', 'products']] },
  { label: 'Inventory', items: [['stock', 'Stock', 'inventory'], ['movements', 'Stock movements', 'inventory'], ['low-stock', 'Low stock', 'inventory'], ['warehouses', 'Warehouses', 'inventory']] },
  { label: 'Manufacturing', items: [['production', 'Production orders', 'production'], ['qc', 'QC', 'production'], ['production-tracking', 'Production tracking', 'production']] },
  { label: 'Purchasing', items: [['suppliers', 'Suppliers', 'suppliers'], ['purchase-orders', 'Purchase orders', 'purchasing'], ['receiving', 'Receiving', 'purchasing']] },
  { label: 'Finance', items: [['sales', 'Sales', 'invoices'], ['invoices', 'Invoices', 'invoices'], ['payments', 'Payments', 'payments'], ['expenses', 'Expenses', 'expenses'], ['profit', 'Profit', 'profit']] },
  { items: [['reports', 'Reports', 'reports'], ['portal', 'Customer portal', 'customers'], ['settings', 'Settings', 'settings']] },
];

function match(path) {
  const segs = path.split('/').filter(Boolean);
  for (const r of ROUTES) {
    if (r.parts.length !== segs.length) continue;
    const params = {};
    if (r.parts.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = decodeURIComponent(segs[i])), true) : p === segs[i]))) return { route: r, params };
  }
  return null;
}

// ---------- loader ----------
const started = Date.now();
function hideLoader() {
  const l = document.getElementById('loader');
  if (!l || l.classList.contains('done')) return;
  const wait = Math.max(0, 1100 - (Date.now() - started));
  setTimeout(() => { l.classList.add('done'); setTimeout(() => l.remove(), 700); }, wait);
}
function authShell(inner) {
  document.body.className = 'auth-body';
  $('#app').innerHTML = `<main class="auth"><section class="auth-card">
    <img class="auth-logo" src="assets/logo-black.png" alt="Seamline">${inner}
    <p class="small muted auth-links"><a href="portal.html">Customer portal</a> · <a href="quote-request.html">Request a quote</a></p></section></main>`;
  hideLoader();
}
const fieldRow = (id, label, type = 'text', attrs = '') => `<div class="field full"><label for="${id}">${label}</label><input id="${id}" name="${id}" type="${type}" ${attrs} required></div>`;
function bindForm(onSubmit) {
  const form = $('#authform'), err = $('.form-error');
  form.addEventListener('submit', async e => {
    e.preventDefault(); err.hidden = true;
    const b = form.querySelector('button[type=submit]'); b.disabled = true;
    try { await onSubmit(Object.fromEntries(new FormData(form))); }
    catch (ex) { err.textContent = Cloud.friendly(ex); err.hidden = false; b.disabled = false; }
  });
  form.querySelector('input')?.focus();
}

// Local mode: first run creates the company and the admin account.
function localSetupScreen() {
  authShell(`<h1>Welcome to Seamline</h1><p class="muted">Set up your workspace. You can change everything later in Settings.</p>
    <form id="authform" class="form-grid one" novalidate>
      ${fieldRow('company', 'Company name', 'text', 'value="Seamline"')}${fieldRow('name', 'Your name', 'text', 'autocomplete="name"')}
      ${fieldRow('email', 'Your email', 'email', 'autocomplete="username"')}${fieldRow('password', 'Choose a password (min 8 characters)', 'password', 'autocomplete="new-password"')}
      <p class="form-error full" role="alert" hidden></p><button class="btn primary full" type="submit">Create workspace</button></form>
    <p class="callout warn small">Local mode — data is saved in this browser only. To work on several devices and send customer links anywhere, connect Supabase (see README).</p>`);
  bindForm(async v => {
    S.setActor({ id: 'system', name: 'Setup', role: 'admin', kind: 'system' });
    const u = await S.setupCompany({ company: v.company, adminName: v.name, email: v.email, password: v.password });
    sessionStorage.setItem(SESSION_KEY, u.id);
    start(u);
  });
}
function localLoginScreen() {
  authShell(`<h1>Sign in</h1><p class="muted">Operations: sales, production, inventory and finance.</p>
    <form id="authform" class="form-grid one" novalidate>${fieldRow('email', 'Work email', 'email', 'autocomplete="username"')}${fieldRow('password', 'Password', 'password', 'autocomplete="current-password"')}
    <p class="form-error full" role="alert" hidden></p><button class="btn primary full" type="submit">Sign in</button></form>`);
  bindForm(async v => { const u = await S.login(v.email, v.password); sessionStorage.setItem(SESSION_KEY, u.id); start(u); });
}

// Cloud mode (Supabase Auth).
async function cloudAuthScreen(message = '') {
  let first = false;
  try { first = (await Cloud.staffCount()) === 0; } catch (e) { return fatal(Cloud.friendly(e)); }
  if (first) {
    authShell(`<h1>Create your workspace</h1><p class="muted">You are the first person here, so you will be the admin.</p>
      ${message ? `<p class="callout info small">${esc(message)}</p>` : ''}
      <form id="authform" class="form-grid one" novalidate>${fieldRow('company', 'Company name', 'text', 'value="Seamline"')}${fieldRow('name', 'Your name', 'text', 'autocomplete="name"')}
      ${fieldRow('email', 'Your email', 'email', 'autocomplete="username"')}${fieldRow('password', 'Choose a password (min 8 characters)', 'password', 'autocomplete="new-password"')}
      <p class="form-error full" role="alert" hidden></p><button class="btn primary full" type="submit">Create admin account</button></form>
      <p class="small muted">Already created it? <a href="#" id="toLogin">Sign in</a></p>`);
    $('#toLogin').addEventListener('click', e => { e.preventDefault(); cloudLogin(); });
    bindForm(async v => {
      if ((v.password || '').length < 8) throw new Error('Passwords need at least 8 characters.');
      localStorage.setItem('seamline.pendingSetup', JSON.stringify({ company: v.company, name: v.name }));
      const r = await Cloud.signUp(v.email, v.password);
      if (r.needsConfirm) return cloudLogin('We sent a confirmation email. Click the link in it, then sign in here.');
      await enterCloud(r.session);
    });
  } else cloudLogin(message);
}
function cloudLogin(message = '') {
  authShell(`<h1>Sign in</h1><p class="muted">Operations: sales, production, inventory and finance.</p>
    ${message ? `<p class="callout info small">${esc(message)}</p>` : ''}
    <form id="authform" class="form-grid one" novalidate>${fieldRow('email', 'Work email', 'email', 'autocomplete="username"')}${fieldRow('password', 'Password', 'password', 'autocomplete="current-password"')}
    <p class="form-error full" role="alert" hidden></p><button class="btn primary full" type="submit">Sign in</button></form>
    <p class="small"><a href="#" id="forgot">Forgot password?</a></p>`);
  $('#forgot').addEventListener('click', e => {
    e.preventDefault();
    formModal({ title: 'Reset password', intro: 'We will email you a link to choose a new password.', fields: [{ name: 'email', label: 'Work email', type: 'email', required: true }], submitLabel: 'Send link', onSubmit: async v => { await Cloud.resetPassword(v.email); toast('Check your email for the reset link'); } });
  });
  bindForm(async v => { const r = await Cloud.signIn(v.email, v.password); await enterCloud(r.session); });
}
function recoveryScreen() {
  authShell(`<h1>Choose a new password</h1><form id="authform" class="form-grid one" novalidate>${fieldRow('password', 'New password (min 8 characters)', 'password', 'autocomplete="new-password"')}
    <p class="form-error full" role="alert" hidden></p><button class="btn primary full" type="submit">Save password</button></form>`);
  bindForm(async v => {
    if ((v.password || '').length < 8) throw new Error('Passwords need at least 8 characters.');
    await Cloud.updatePassword(v.password);
    toast('Password saved');
    await enterCloud(await Cloud.currentSession());
  });
}
async function enterCloud(session) {
  if (!session) return cloudLogin();
  const email = String(session.user.email).toLowerCase();
  let role = await Cloud.staffRole();
  if (!role) {
    if ((await Cloud.staffCount()) === 0) role = await Cloud.claimAdmin();
    else { await Cloud.signOut(); return cloudLogin('That account is not a Seamline team account. If you are a customer, use the customer portal.'); }
  }
  showLoader('Loading your data…');
  await Cloud.loadAll();
  S.setActor({ id: 'system', name: 'System', role: 'admin', kind: 'system' });
  let u = db().users.find(x => x.email === email);
  if (!db().meta.setup) {
    let pending = {}; try { pending = JSON.parse(localStorage.getItem('seamline.pendingSetup')) || {}; } catch { /* ignore */ }
    if (!pending.name) {
      hideLoaderNow();
      authShell(`<h1>Almost there</h1><p class="muted">Tell us your name and company.</p><form id="authform" class="form-grid one" novalidate>${fieldRow('company', 'Company name', 'text', 'value="Seamline"')}${fieldRow('name', 'Your name')}<p class="form-error full" role="alert" hidden></p><button class="btn primary full" type="submit">Continue</button></form>`);
      return bindForm(async v => { localStorage.setItem('seamline.pendingSetup', JSON.stringify(v)); await enterCloud(session); });
    }
    u = await S.setupCompany({ company: pending.company, adminName: pending.name, email, external: true });
    localStorage.removeItem('seamline.pendingSetup');
  } else if (!u) {
    u = await S.saveUser({ name: email.split('@')[0], email, role, external: true });
  } else if (u.role !== role || u.active === false) { u.role = role; u.active = true; save(); }
  Cloud.setWho(email);
  Cloud.startSync({ onRemote: remoteRefresh, onInbox: () => ingest() });
  start(u);
  S.expireQuotes();
  ingest();
}
function showLoader(text) {
  if (document.getElementById('loader')) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="loader" class="loader"><div class="loader-inner"><img src="assets/logo-white.png" alt="Seamline"><span class="stitch"></span><p>${esc(text)}</p></div></div>`);
}
function hideLoaderNow() { document.getElementById('loader')?.remove(); }
function fatal(msg) {
  hideLoader();
  $('#app').innerHTML = `<main class="auth"><section class="auth-card"><img class="auth-logo" src="assets/logo-black.png" alt="Seamline"><h1>Can’t start Seamline</h1><p>${esc(msg)}</p><button class="btn primary" onclick="location.reload()">Try again</button></section></main>`;
}
async function signOut() {
  sessionStorage.removeItem(SESSION_KEY); app.user = null; location.hash = '';
  if (CLOUD) { await Cloud.signOut(); location.reload(); } else localLoginScreen();
}

// Customer requests (website form, quote approvals, portal) waiting in the inbox.
let ingesting = false;
async function ingest() {
  if (ingesting || !app.user) return;
  ingesting = true;
  try {
    const n = CLOUD ? await Cloud.ingestInbox() : await processInbox(localInboxItems(), async ids => localInboxRemove(ids));
    if (n) { toast(`${n} new customer request${n === 1 ? '' : 's'} received`); remoteRefresh(); }
  } catch (e) { console.error(e); }
  finally { ingesting = false; }
}
function remoteRefresh() {
  if (!app.user) return;
  const editing = document.querySelector('.modal-backdrop') || /(^|\/)(new|edit)$/.test(app.path) || document.activeElement?.closest?.('#main input, #main textarea, #main select');
  if (editing) { pendingRefresh = true; return; }
  route(true);
}
let pendingRefresh = false;

// ---------- shell ----------
function shell() {
  document.body.className = '';
  const u = app.user;
  const nav = NAV.map(g => {
    const items = g.items.filter(([, , perm]) => can(perm));
    if (!items.length) return '';
    return `<div class="nav-group">${g.label ? `<p class="nav-label">${g.label}</p>` : ''}${items.map(([href, label]) => `<a href="#/${href}" data-nav="${href}">${label}</a>`).join('')}</div>`;
  }).join('');
  $('#app').innerHTML = `
  <a class="skip" href="#main">Skip to content</a>
  <aside class="sidebar" id="sidebar">
    <a class="brand" href="#/dashboard"><img src="assets/logo-white.png" alt="${esc(db().settings.company || 'Seamline')}"></a>
    <nav aria-label="Main">${nav}<div class="nav-group"><a href="#/guide" data-nav="guide">How it works</a></div></nav>
    <div class="me"><span class="avatar" aria-hidden="true">${esc(initials(u.name))}</span><div><strong>${esc(u.name)}</strong><small>${esc(S.ROLES[u.role])}</small></div><button type="button" class="icon-btn" id="signout" title="Sign out" aria-label="Sign out"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M10 17l1.4-1.4L8.8 13H20v-2H8.8l2.6-2.6L10 7l-5 5 5 5ZM4 5h8V3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h8v-2H4V5Z" fill="currentColor"/></svg></button></div>
  </aside>
  <div class="scrim" id="scrim"></div>
  <div class="workspace">
    <header class="topbar">
      <button type="button" class="icon-btn menu-btn" id="menuBtn" aria-label="Open menu" aria-controls="sidebar" aria-expanded="false"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z" fill="currentColor"/></svg></button>
      ${can('search') ? `<form class="global-search" id="gsearch" role="search"><input type="search" name="q" placeholder="Search orders, customers, SKUs, invoices…" aria-label="Global search" autocomplete="off"><kbd>/</kbd></form>` : '<div class="grow"></div>'}
      <span class="sync" id="sync" role="status" aria-live="polite">${CLOUD ? '' : '<i></i>Local mode'}</span>
      <a class="bell" href="#/notifications" aria-label="Notifications"><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 22a2.5 2.5 0 0 0 2.4-2h-4.8a2.5 2.5 0 0 0 2.4 2Zm7-6V11a7 7 0 0 0-5-6.7V3.5a2 2 0 1 0-4 0v.8A7 7 0 0 0 5 11v5l-2 2v1h18v-1Z" fill="currentColor"/></svg><b id="bellCount" hidden></b></a>
    </header>
    <main id="main" tabindex="-1"></main>
  </div>`;
  $('#signout').addEventListener('click', signOut);
  if (CLOUD) Cloud.onStatus(st => {
    const el = $('#sync'); if (!el) return;
    el.className = `sync s-${st.state}`;
    el.innerHTML = `<i></i>${{ saving: 'Saving…', saved: 'All changes saved', error: 'Not saved — retrying', loading: 'Loading…', idle: '' }[st.state] || ''}`;
    el.title = st.message || '';
    if (st.state === 'error' && st.message) toast(st.message, 'error');
  });
  const toggle = open => { document.body.classList.toggle('nav-open', open); $('#menuBtn').setAttribute('aria-expanded', open); };
  $('#menuBtn').addEventListener('click', () => toggle(!document.body.classList.contains('nav-open')));
  $('#scrim').addEventListener('click', () => toggle(false));
  $('#gsearch')?.addEventListener('submit', e => {
    e.preventDefault();
    const q = e.target.elements.q.value.trim();
    if (!q) return;
    const res = S.search(q);
    const exact = res.find(r => r.label.toLowerCase() === q.toLowerCase()) || (res.length === 1 ? res[0] : null) || (/^sl-/i.test(q) && res[0] && ['Order', 'Quote', 'Invoice', 'Purchase order', 'Lead'].includes(res[0].kind) ? res[0] : null);
    e.target.elements.q.value = '';
    e.target.elements.q.blur();
    go(exact ? exact.href : `search?q=${encodeURIComponent(q)}`);
  });
}
function updateChrome() {
  const key = app.path.split('/')[0];
  const alias = { 'purchase-orders': 'purchase-orders', search: '', notifications: '', audit: 'settings' };
  pendingRefresh = false;
  const active = alias[key] ?? key;
  $$('[data-nav]').forEach(a => { const on = a.dataset.nav === active; a.classList.toggle('on', on); on ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'); });
  const n = db().notifications.filter(x => x.audience === 'staff' && !x.read).length;
  const b = $('#bellCount'); if (b) { b.hidden = !n; b.textContent = n > 99 ? '99+' : n; }
  document.body.classList.remove('nav-open');
  const h1 = $('#main h1');
  document.title = `${h1 ? h1.textContent + ' · ' : ''}Seamline`;
}

// ---------- router ----------
function route(keepScroll = false) {
  if (!app.user) return;
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  app.path = path || 'dashboard';
  app.query = Object.fromEntries(new URLSearchParams(qs || ''));
  const m = match(app.path);
  const y = window.scrollY;
  app.actions = {};
  if (!m) { $('#main').innerHTML = '<div class="empty big">This page does not exist. <a href="#/dashboard">Back to dashboard</a></div>'; }
  else if (!can(m.route.perm)) { $('#main').innerHTML = `<div class="empty big">Your role (${esc(S.ROLES[app.user.role])}) doesn't have access to this page. <a href="#/dashboard">Back to dashboard</a></div>`; }
  else {
    app.params = m.params;
    try { m.route.view(m.params); }
    catch (e) { console.error(e); $('#main').innerHTML = `<div class="empty big">Something went wrong loading this page: ${esc(e.message)}</div>`; }
  }
  updateChrome();
  if (keepScroll) window.scrollTo(0, y);
  else { window.scrollTo(0, 0); const m = $('#main'); m.classList.remove('enter'); void m.offsetWidth; m.classList.add('enter'); }
}

function setQueries(obj) {
  const q = new URLSearchParams(app.query);
  for (const [k, v] of Object.entries(obj)) { if (v) q.set(k, v); else q.delete(k); }
  const s = q.toString();
  location.hash = `#/${app.path}${s ? `?${s}` : ''}`;
}

// ---------- delegated events ----------
function bindEvents() {
  const root = $('#app');
  root.addEventListener('click', e => {
    const act = e.target.closest('[data-action]');
    if (act && root.contains(act) && $('#main')?.contains(act)) {
      const fn = app.actions[act.dataset.action];
      if (fn) { e.preventDefault(); e.stopPropagation(); run(fn)(act, e); }
      return;
    }
    const chip = e.target.closest('[data-range]');
    if (chip) { const [from, to] = chip.dataset.range.split('|'); setQueries({ from, to }); return; }
    const row = e.target.closest('tr[data-href]');
    if (row && !e.target.closest('a, button, input, select, textarea, label')) go(row.dataset.href);
  });
  root.addEventListener('keydown', e => {
    const row = e.target.closest?.('tr[data-href]');
    if (row && e.key === 'Enter' && e.target === row) go(row.dataset.href);
  });
  root.addEventListener('change', e => {
    const t = e.target;
    if (t.matches('[data-change]')) { const fn = app.actions[t.dataset.change]; if (fn) run(fn)(t, e); return; }
    if (t.matches('[data-query]')) { setQueries({ [t.dataset.query]: t.value }); return; }
    if (t.matches('[data-range-from], [data-range-to]')) {
      const from = $('[data-range-from]').value, to = $('[data-range-to]').value;
      if (from && to && from > to) return toast('The start date is after the end date.', 'error');
      setQueries({ from, to });
    }
  });
  root.addEventListener('input', e => {
    if (!e.target.matches('[data-filter]')) return;
    const q = e.target.value.trim().toLowerCase();
    const scope = e.target.closest('.panel, #main');
    $$('tbody tr', scope).forEach(tr => { tr.hidden = q && !tr.textContent.toLowerCase().includes(q); });
  });
  document.addEventListener('keydown', e => {
    if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]') && !document.querySelector('.modal-backdrop')) {
      const s = $('#gsearch input'); if (s) { e.preventDefault(); s.focus(); }
    }
  });
  window.addEventListener('hashchange', () => route());
  // other tabs (portal, tracking, quote form) write to the same storage
  window.addEventListener('storage', e => {
    if (CLOUD) return;
    if (e.key === STORAGE_KEY) { reload(); remoteRefresh(); }
    if (e.key === INBOX_KEY) ingest();
  });
  window.addEventListener('hashchange', () => { if (pendingRefresh) pendingRefresh = false; });
}

function start(user) {
  app.user = user;
  S.setActor({ id: user.id, name: user.name, role: user.role, kind: 'staff' });
  shell();
  hideLoader();
  if (!CLOUD) { publish().catch(console.error); ingest(); }
  if (!location.hash || location.hash === '#' || location.hash === '#/' || /access_token|type=recovery/.test(location.hash)) location.hash = '#/dashboard';
  else route();
}

// ---------- boot ----------
(async function boot() {
  setRerender(() => route(true));
  bindEvents();
  try {
    if (CLOUD) {
      Cloud.onAuthEvent(event => { if (event === 'PASSWORD_RECOVERY') recoveryScreen(); });
      const session = await Cloud.currentSession();
      if (/type=recovery/.test(location.hash)) return;
      if (session) await enterCloud(session); else await cloudAuthScreen();
    } else {
      onSave(() => { publish().catch(console.error); });
      S.setActor({ id: 'system', name: 'System', role: 'admin', kind: 'system' });
      S.expireQuotes();
      if (!db().meta.setup) return localSetupScreen();
      const id = sessionStorage.getItem(SESSION_KEY);
      const u = id && db().users.find(x => x.id === id && x.active !== false);
      if (u) start(u); else localLoginScreen();
      setInterval(() => ingest(), 8000);
    }
  } catch (e) {
    console.error(e);
    fatal(Cloud.friendly(e));
  }
})();
