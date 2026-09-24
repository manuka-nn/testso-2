import * as S from './services.js';
import { db } from './db.js';
import { esc, money, pct, int, fmtDate, fmtDateTime, badge, table, formModal, confirmBox, modal, fieldHtml, readForm, barChart, copyText, toast, readImage, today, productThumb } from './ui.js';
import { app, $, $$, render, rerender, can, go, pageHead, btn, linkBtn, a, panel, kv, stat, filters, tabs, custName, userName, staffOptions, customerOptions, warehouseOptions, notFound, waLink } from './core.js';
import { CLOUD } from './db.js';
import { downloadPdf, sharePdf, canShareFiles } from './pdf.js';
import { qrSvg } from './shared.js';
import * as Cloud from './cloud.js';

export async function pdfAction(doc, mode = 'download', text = '') {
  if (!doc) throw new Error('Nothing to export yet.');
  toast('Preparing PDF…');
  if (mode === 'share') { const r = await sharePdf(doc, text); if (r === 'downloaded') toast('PDF downloaded — attach it to your message'); }
  else { await downloadPdf(doc); toast('PDF downloaded'); }
}

// ============ DASHBOARD ============
function gettingStarted() {
  const d = db(), st = d.settings;
  const steps = [
    ['Add your company contact and bank details', 'settings', !!(st.phone && st.email)],
    ['Add your team (sales, operations, finance)', 'settings?tab=users', d.users.length > 1],
    ['Add suppliers', 'suppliers', d.suppliers.length > 0],
    ['Add products with colours and sizes', 'products/new', d.products.length > 0],
    ['Receive opening stock with a purchase order', 'purchase-orders/new', d.movements.length > 0],
    ['Add your first customer', 'customers', d.customers.length > 0],
    ['Send your first quote', 'quotes/new', d.quotes.length > 0],
  ];
  const done = steps.filter(x => x[2]).length;
  if (done === steps.length || d.orders.length > 5 || !can('settings')) return '';
  return `<section class="panel onboarding"><header><h2>Getting started</h2><div class="panel-actions"><span class="muted small">${done} of ${steps.length} done</span>${a('How it works', 'guide')}</div></header>
    <div class="meter"><span style="--w:${Math.round(done / steps.length * 100)}%"></span></div>
    <ol class="checklist">${steps.map(([l, h, ok]) => `<li class="${ok ? 'ok' : ''}"><a href="#/${h}"><span class="tick" aria-hidden="true">${ok ? '✓' : ''}</span>${esc(l)}</a></li>`).join('')}</ol></section>`;
}
export function viewDashboard() {
  const d = db(), nowD = new Date();
  const t = S.summary(S.startOfDay(), nowD), m = S.summary(S.startOfMonth(), nowD);
  const seeProfit = can('profit');
  const todayOrders = d.orders.filter(o => o.createdAt >= S.startOfDay().toISOString() && o.state !== 'Cancelled').length;
  const inProd = d.orders.filter(o => o.state === 'Confirmed' && ['Production Scheduled', 'In Production', 'Quality Control'].includes(o.productionStatus)).length;
  const awaiting = d.quotes.filter(q => ['Sent', 'Viewed'].includes(q.status)).length;
  const wholesale = d.orders.filter(o => o.state === 'Confirmed' && S.orderType(o) !== 'Manufacturing').length;
  const low = S.lowStockItems();
  const flow = S.flowCounts();
  const series = S.dailySeries(30).map(x => ({ label: x.date.getDate(), revenue: x.revenue, profit: x.profit }));
  const recent = [...d.orders].sort((x, y) => y.createdAt.localeCompare(x.createdAt)).slice(0, 6);
  const greeting = nowD.getHours() < 12 ? 'Good morning' : nowD.getHours() < 17 ? 'Good afternoon' : 'Good evening';

  render(`
    ${pageHead(`${greeting}, ${esc(app.user.name.split(' ')[0])}`, nowD.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), can('orders.create') ? linkBtn('New order', 'orders/new', 'primary') : '')}
    <section class="flow" aria-label="Pipeline from lead to payment">
      ${flow.map(f => `<a class="flow-step" href="#/${f.href}"><strong>${f.count}</strong><span>${f.label}</span></a>`).join('')}
    </section>
    ${gettingStarted()}
    <div class="stat-row">
      ${stat('Sales today', money(t.revenue), `${todayOrders} order${todayOrders === 1 ? '' : 's'} created`)}
      ${seeProfit ? stat('Gross profit today', money(t.grossProfit), t.revenue ? `${pct(t.margin)} margin` : '') : ''}
      ${stat('Pending payments', money(S.pendingPayments()), 'Across confirmed orders', can('payments') ? 'payments' : 'orders?payment=Unpaid')}
      ${stat('In production', int(inProd), 'Manufacturing orders', 'production')}
      ${stat('Awaiting approval', int(awaiting), 'Quotes with customers', 'quotes')}
      ${stat('Wholesale orders', int(wholesale), 'Open ready-stock orders', 'orders?type=Wholesale')}
      ${stat('Low stock', int(low.length), low.length ? 'Needs reordering' : 'All above reorder level', 'low-stock')}
    </div>
    <div class="grid-2-1">
      ${panel('Last 30 days', barChart(series, { height: 190, labelEvery: 3, series: seeProfit ? [{ key: 'revenue', label: 'Revenue', cls: 'bar-a' }, { key: 'profit', label: 'Gross profit', cls: 'bar-b' }] : [{ key: 'revenue', label: 'Revenue', cls: 'bar-a' }] }))}
      ${panel('This month', `<div class="month-list">
        ${[['Revenue', m.revenue], ...(seeProfit ? [['Gross profit', m.grossProfit], ['Net profit', m.netProfit]] : []), ['Orders', null, m.orders], ['Average order value', m.aov]]
          .map(([l, v, n]) => `<div><span>${l}</span><strong>${n != null ? int(n) : money(v)}</strong></div>`).join('')}
        <hr class="seam">
        ${['Manufacturing', 'Wholesale', 'Customization', 'Corporate'].map(k => `<div><span>${k} revenue</span><strong>${money(m.byType[k].revenue)}</strong></div>`).join('')}
      </div>`, seeProfit ? a('Profit details', 'profit') : '')}
    </div>
    <div class="grid-2">
      ${panel('Recent orders', table([
        { label: 'Order', render: o => `<strong>${esc(o.number)}</strong><br><small>${esc(custName(o.customerId))}</small>` },
        { label: 'Type', render: o => esc(S.orderType(o)) },
        { label: 'Status', render: o => o.state === 'Draft' || o.state === 'Cancelled' || o.state === 'Completed' ? badge(o.state) : (o.deliveryStatus !== 'Not Dispatched' ? badge(o.deliveryStatus) : badge(o.productionStatus === 'Not Required' ? 'Confirmed' : o.productionStatus)) },
        { label: 'Total', cls: 'num', render: o => money(S.orderTotals(o).total) },
      ], recent, { href: o => `orders/${o.id}` }), a('All orders', 'orders'))}
      ${panel('Low stock', table([
        { label: 'Product', render: r => `${esc(r.product.name)}<br><small>${esc(S.variantLabel(r.variant))} · ${esc(r.variant.sku)}</small>` },
        { label: 'Available', cls: 'num', render: r => `<strong class="bad-text">${int(r.available)}</strong>` },
        { label: 'Reorder at', cls: 'num', render: r => int(r.reorderLevel) },
        { label: 'Suggested', cls: 'num', render: r => int(r.suggested) },
      ], low.slice(0, 6), { href: r => `products/${r.product.id}`, empty: 'Every product is above its reorder level.' }), can('purchasing') ? a('Create purchase orders', 'low-stock') : '')}
    </div>`);
}

// ============ LEADS ============
export function viewLeads() {
  const stats = S.pipelineStats();
  const leads = db().leads.filter(l => app.query.show === 'lost' ? l.lost : !l.lost);
  const stages = S.LEAD_STAGES;
  render(`
    ${pageHead('Leads', 'Every enquiry from first contact to repeat customer.', `${linkBtn('Open public quote form', '', 'ghost').replace('href="#/"', 'href="quote-request.html" target="_blank" rel="noopener"')}${btn('Add lead', 'add', 'primary')}`)}
    <div class="conversion">${stats.slice(1).map(s => `<div><span>${esc(s.stage)}</span><strong>${s.conversion == null ? '—' : pct(s.conversion)}</strong></div>`).join('')}</div>
    <p class="muted small">Conversion shows the share of leads that reached each stage from the one before it.</p>
    <div class="board">${stages.map(st => {
      const list = leads.filter(l => l.stage === st);
      return `<div class="board-col"><h3>${esc(st)} <span>${list.length}</span></h3>${list.map(l => `
        <a class="card-lead" href="#/leads/${l.id}"><strong>${esc(l.company || l.name)}</strong>
        <span>${esc(l.productType || 'General enquiry')}${l.quantity ? ` · ${int(l.quantity)} units` : ''}</span>
        <small>${esc(l.number)} · ${fmtDate(l.createdAt)}</small></a>`).join('') || '<p class="board-empty">None</p>'}</div>`;
    }).join('')}</div>
    <p><a href="#/leads${app.query.show === 'lost' ? '' : '?show=lost'}">${app.query.show === 'lost' ? 'Show active leads' : `Show lost leads (${db().leads.filter(l => l.lost).length})`}</a></p>`,
  {
    add: () => formModal({
      title: 'Add lead', wide: true, fields: leadFields(),
      onSubmit: v => { const l = S.createLead(v, 'Manual'); toast(`Lead ${l.number} added`); go(`leads/${l.id}`); },
    }),
  });
}
const leadFields = () => [
  { name: 'name', label: 'Contact name', required: true }, { name: 'company', label: 'Company' },
  { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone / WhatsApp' },
  { name: 'productType', label: 'Product type', type: 'select', options: S.REQUEST_PRODUCT_TYPES, blank: 'Choose' },
  { name: 'quantity', label: 'Quantity', type: 'number', min: 1 },
  { name: 'requiredDate', label: 'Required by', type: 'date' }, { name: 'customization', label: 'Customization' },
  { name: 'requirements', label: 'Requirements', type: 'textarea', full: true },
];

export function viewLead({ id }) {
  const l = S.get('leads', id);
  if (!l) return notFound('lead');
  const quotes = db().quotes.filter(q => q.leadId === l.id);
  render(`
    ${pageHead(l.company || l.name, `${esc(l.number)}${l.clientRef ? ` · customer ref ${esc(l.clientRef)}` : ''} · ${esc(l.source)} · received ${fmtDateTime(l.createdAt)}`,
      `${l.lost ? badge('Lost') : ''}<label class="inline-select">Stage <select data-change="stage">${S.LEAD_STAGES.map(s => `<option ${s === l.stage ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
       ${btn('Create quote', 'quote', 'primary')}`)}
    <div class="grid-2-1">
      <div>
        ${panel('Request', kv([
          ['Contact', esc(l.name)], ['Company', esc(l.company)],
          ['Email', l.email ? `<a href="mailto:${esc(l.email)}">${esc(l.email)}</a>` : ''],
          ['Phone / WhatsApp', l.phone ? `${esc(l.phone)} · <a href="${waLink(l.phone, `Hi ${l.name}, this is Seamline about your request ${l.number}.`)}" target="_blank" rel="noopener">WhatsApp</a>` : ''],
          ['Product type', esc(l.productType)], ['Quantity', l.quantity ? int(l.quantity) : ''],
          ['Required by', l.requiredDate ? fmtDate(l.requiredDate) : ''], ['Customization', esc(l.customization)],
          ['Product reference', esc(l.reference)], ['Requirements', esc(l.requirements).replace(/\n/g, '<br>')],
        ]) + (l.items?.length ? `<h3 class="sub-h">Items from the wholesale catalogue</h3>${table([
          { label: 'Product', render: i => esc(i.name) }, { label: 'Qty', cls: 'num', render: i => int(i.qty) },
        ], l.items)}` : '') + (l.attachments?.length ? `<h3 class="sub-h">Attachments</h3><div class="attachments">${l.attachments.map(f => f.dataUrl
          ? `<a href="${f.dataUrl}" download="${esc(f.name)}"><img src="${f.dataUrl}" alt="${esc(f.name)}"></a>` : `<span class="file-chip">${esc(f.name)}</span>`).join('')}</div>` : ''))}
        ${panel('Quotes', table([
          { label: 'Quote', render: q => esc(q.number) }, { label: 'Status', render: q => badge(q.status) },
          { label: 'Total', cls: 'num', render: q => money(S.docTotals(q).total) }, { label: 'Created', render: q => fmtDate(q.createdAt) },
        ], quotes, { href: q => `quotes/${q.id}`, empty: 'No quotes yet. Create one when the requirement is clear.' }))}
      </div>
      <div>
        ${panel('Customer', l.customerId ? `<p>${a(custName(l.customerId), `customers/${l.customerId}`)}</p>` : `<p class="muted">Not linked to a customer yet. Creating a quote links or creates one automatically.</p>${btn('Create customer now', 'customer', 'ghost sm')}`)}
        ${panel('Notes', `<form class="note-form" data-note><textarea rows="2" placeholder="Call summary, sizes discussed, budget…" aria-label="Note"></textarea>${btn('Add note', 'note', 'sm')}</form>
          <ul class="notes">${l.notes.map(n => `<li><p>${esc(n.text)}</p><small>${esc(n.by)} · ${fmtDateTime(n.at)}</small></li>`).join('')}</ul>`)}
        ${!l.lost ? `<p>${btn('Mark as lost', 'lost', 'ghost danger-text sm')}</p>` : ''}
      </div>
    </div>`,
  {
    stage: el => { S.setLeadStage(l.id, el.value); toast(`Moved to ${el.value}`); rerender(); },
    quote: () => go(`quotes/new?lead=${l.id}`),
    customer: () => { const c = S.leadToCustomer(l.id); toast(`Linked to ${S.customerName(c)}`); rerender(); },
    note: () => { S.addLeadNote(l.id, $('[data-note] textarea').value); rerender(); },
    lost: async () => { const r = await confirmBox('The lead moves to the lost list. You can still reopen it by changing its stage.', { title: 'Mark as lost', input: 'Reason', confirmLabel: 'Mark as lost', danger: true }); if (r) { S.markLeadLost(l.id, r); rerender(); } },
  });
}

// ============ LINE ITEM EDITOR (quotes & orders) ============
function itemEditor(host, initial, onChange) {
  const blank = () => ({ productId: '', variantId: '', description: '', qty: '', unitPrice: '', unitCost: '', fulfilment: 'stock', businessType: 'Manufacturing' });
  const items = (initial?.length ? initial : [blank()]).map(i => ({ ...i }));
  const products = db().products.filter(p => p.status === 'Active' || items.some(i => i.productId === p.id));
  const cats = [...new Set(products.map(p => p.category))];
  const prodOptions = sel => `<option value="">Custom item (no product)</option>${cats.map(c => `<optgroup label="${esc(c)}">${products.filter(p => p.category === c).map(p => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)} (${esc(p.kind)})</option>`).join('')}</optgroup>`).join('')}`;
  function normalize(it) {
    const p = it.productId && S.get('products', it.productId);
    const canStock = p && p.kind !== 'Made to order' && S.productVariants(p.id).length > 0;
    const canMake = !p || p.kind !== 'Ready stock';
    if (it.fulfilment === 'stock' && !canStock) it.fulfilment = 'make';
    if (it.fulfilment === 'make' && !canMake) it.fulfilment = 'stock';
    if (it.fulfilment === 'stock' && it.variantId) it.unitCost = S.get('variants', it.variantId).cost;
    return { p, canStock, canMake };
  }
  function row(it, i) {
    const { p, canStock, canMake } = normalize(it);
    const vs = p ? S.productVariants(p.id) : [];
    const v = it.variantId && S.get('variants', it.variantId);
    const st = v ? S.variantStock(v.id) : null;
    const short = it.fulfilment === 'stock' && st && Number(it.qty) > st.available;
    return `<div class="line" data-i="${i}">
      <div class="field grow"><label>Product</label><select data-f="productId">${prodOptions(it.productId)}</select></div>
      <div class="field"><label>Fulfilment</label><select data-f="fulfilment">${canStock ? `<option value="stock" ${it.fulfilment === 'stock' ? 'selected' : ''}>Ready stock</option>` : ''}${canMake ? `<option value="make" ${it.fulfilment === 'make' ? 'selected' : ''}>Make to order</option>` : ''}</select></div>
      <div class="field"><label>Colour / size</label><select data-f="variantId" ${!vs.length ? 'disabled' : ''}><option value="">${vs.length ? (it.fulfilment === 'stock' ? 'Choose' : 'Not needed') : '—'}</option>${vs.map(x => { const s = S.variantStock(x.id); return `<option value="${x.id}" ${x.id === it.variantId ? 'selected' : ''}>${esc(S.variantLabel(x))}${it.fulfilment === 'stock' ? ` · ${s.available} free` : ''}</option>`; }).join('')}</select></div>
      ${it.fulfilment === 'make' ? `<div class="field"><label>Business type</label><select data-f="businessType">${S.BUSINESS_TYPES.filter(b => b !== 'Wholesale').map(b => `<option ${b === it.businessType ? 'selected' : ''}>${b}</option>`).join('')}</select></div>` : ''}
      <div class="field spec"><label>Specification</label><input data-f="description" value="${esc(it.description)}" placeholder="${it.fulfilment === 'make' ? 'Fabric, colours, print method, size breakdown' : 'Optional note'}"></div>
      <div class="field n"><label>Qty</label><input type="number" min="1" inputmode="numeric" data-f="qty" value="${esc(it.qty)}"></div>
      <div class="field n"><label>Unit price</label><input type="number" min="0" step="any" data-f="unitPrice" value="${esc(it.unitPrice)}"></div>
      <div class="field n"><label>Unit cost</label><input type="number" min="0" step="any" data-f="unitCost" value="${esc(it.unitCost)}" ${it.fulfilment === 'stock' ? 'readonly title="Uses the current inventory cost"' : 'placeholder="Estimated"'}></div>
      <div class="line-total"><span data-total>${money((+it.qty || 0) * (+it.unitPrice || 0))}</span>${short ? `<small class="bad-text">Only ${st.available} available</small>` : ''}</div>
      <button type="button" class="icon-btn" data-remove="${i}" aria-label="Remove line">×</button>
    </div>`;
  }
  function draw() {
    host.innerHTML = `${items.map(row).join('')}<button type="button" class="btn ghost sm" data-add>Add line</button>`;
    onChange?.();
  }
  host.addEventListener('change', e => {
    const f = e.target.dataset.f, lineEl = e.target.closest('.line');
    if (!f || !lineEl) return;
    const it = items[+lineEl.dataset.i];
    it[f] = e.target.value;
    if (f === 'productId') {
      const p = S.get('products', it.productId);
      Object.assign(it, { variantId: '', unitCost: '', unitPrice: p?.wholesalePrice || it.unitPrice, fulfilment: p?.kind === 'Made to order' ? 'make' : 'stock' });
      if (p && !it.qty) it.qty = p.moq || '';
    }
    if (['productId', 'fulfilment', 'variantId', 'qty'].includes(f)) draw(); else onChange?.();
  });
  host.addEventListener('input', e => {
    const f = e.target.dataset.f, lineEl = e.target.closest('.line');
    if (!f || !lineEl || e.target.tagName === 'SELECT') return;
    const it = items[+lineEl.dataset.i];
    it[f] = e.target.value;
    lineEl.querySelector('[data-total]').textContent = money((+it.qty || 0) * (+it.unitPrice || 0));
    onChange?.();
  });
  host.addEventListener('click', e => {
    if (e.target.closest('[data-add]')) { items.push(blank()); draw(); }
    const rm = e.target.closest('[data-remove]');
    if (rm) { items.splice(+rm.dataset.remove, 1); if (!items.length) items.push(blank()); draw(); }
  });
  draw();
  return { get items() { return items; }, applyMarkup(pctV) { items.forEach(i => { if (+i.unitCost > 0) i.unitPrice = Math.round(+i.unitCost * (1 + pctV / 100)); }); draw(); } };
}

function docEditor({ kind, title, sub, doc, lead, onSave, buttons }) {
  const isOrder = kind === 'order';
  const s = db().settings;
  const customerField = lead && !lead.customerId
    ? `<div class="field full"><label>Customer</label><p class="muted">A customer record will be created from <strong>${esc(lead.company || lead.name)}</strong> when you save.</p></div>`
    : fieldHtml({ name: 'customerId', label: 'Customer', type: 'select', required: true, blank: 'Choose a customer', options: customerOptions() }, doc.customerId);
  render(`
    ${pageHead(title, sub)}
    <form id="docform" class="doc-form" novalidate>
      ${panel('', `<div class="form-grid">${customerField}
        ${isOrder
          ? fieldHtml({ name: 'warehouseId', label: 'Ship ready stock from', type: 'select', options: warehouseOptions() }, doc.warehouseId)
            + fieldHtml({ name: 'expectedAt', label: 'Expected completion', type: 'date' }, doc.expectedAt)
            + fieldHtml({ name: 'assignedTo', label: 'Assigned to', type: 'select', options: staffOptions() }, doc.assignedTo || app.user.id)
          : fieldHtml({ name: 'validUntil', label: 'Valid until', type: 'date' }, doc.validUntil || (() => { const x = new Date(); x.setDate(x.getDate() + (s.quoteValidityDays || 14)); return x.toISOString().slice(0, 10); })())
            + fieldHtml({ name: 'productionDays', label: 'Estimated production time (days)', type: 'number', min: 0 }, doc.productionDays)
            + fieldHtml({ name: 'paymentTerms', label: 'Payment terms' }, doc.paymentTerms || s.defaultPaymentTerms)}
      </div>`)}
      ${panel('Products', '<div id="items" class="lines"></div>', !isOrder ? `<div class="markup"><input type="number" id="markup" placeholder="Markup %" aria-label="Markup percent" min="0"><button type="button" class="btn ghost sm" id="applyMarkup">Apply to all lines</button></div>` : '')}
      <div class="grid-2">
        ${panel('Charges to customer', `<div class="form-grid">
          ${fieldHtml({ name: 'discount', label: 'Discount (Rs.)', type: 'number', min: 0 }, doc.discount || '')}
          ${fieldHtml({ name: 'deliveryCharge', label: 'Delivery charge (Rs.)', type: 'number', min: 0 }, doc.deliveryCharge || '')}
          ${fieldHtml({ name: 'taxRate', label: 'Tax (%)', type: 'number', min: 0, hint: 'Leave empty if not applicable' }, doc.taxRate || '')}</div>`)}
        ${panel('Internal direct costs', `<div class="form-grid">
          ${fieldHtml({ name: 'costs_delivery', label: 'Delivery cost', type: 'number', min: 0 }, doc.costs?.delivery || '')}
          ${fieldHtml({ name: 'costs_packaging', label: 'Packaging cost', type: 'number', min: 0 }, doc.costs?.packaging || '')}
          ${fieldHtml({ name: 'costs_other', label: 'Other direct cost', type: 'number', min: 0 }, doc.costs?.other || '')}
          <p class="muted small full">Never shown to the customer. Used for profit.</p></div>`)}
      </div>
      ${panel('Notes', `<div class="form-grid">${isOrder
        ? fieldHtml({ name: 'customerNotes', label: 'Customer notes', type: 'textarea', full: true }, doc.customerNotes) + fieldHtml({ name: 'internalNotes', label: 'Internal notes', type: 'textarea', full: true }, doc.internalNotes)
        : fieldHtml({ name: 'notes', label: 'Notes shown on the quote', type: 'textarea', full: true }, doc.notes)}</div>`)}
      <div class="sticky-bar"><div id="docTotals" aria-live="polite"></div><div class="bar-actions"><a class="btn ghost" href="javascript:history.back()">Cancel</a>${buttons.map(b => `<button type="button" class="btn ${b.cls || ''}" data-save="${b.key}">${esc(b.label)}</button>`).join('')}</div></div>
    </form>`);
  const form = $('#docform');
  let ed = null;
  const values = () => { const v = readForm(form); return { ...v, customerId: v.customerId || doc.customerId, items: ed ? ed.items : doc.items || [], costs: { delivery: v.costs_delivery, packaging: v.costs_packaging, other: v.costs_other } }; };
  const update = () => {
    const t = S.docTotals(values());
    $('#docTotals').innerHTML = `<span>Subtotal <b>${money(t.subtotal)}</b></span><span>Total <b>${money(t.total)}</b></span><span class="${t.profit < 0 ? 'bad-text' : ''}">Gross profit <b>${money(t.profit)}</b> (${pct(t.margin)})</span>`;
  };
  ed = itemEditor($('#items'), doc.items, update);
  form.addEventListener('input', update);
  $('#applyMarkup')?.addEventListener('click', () => { const m = +$('#markup').value; if (!(m >= 0)) return toast('Enter a markup percentage.', 'error'); ed.applyMarkup(m); toast(`Prices set to cost + ${m}%`); });
  form.addEventListener('click', async e => {
    const b = e.target.closest('[data-save]');
    if (!b) return;
    b.disabled = true;
    try { await onSave(b.dataset.save, values()); } catch (ex) { toast(ex.message, 'error'); } finally { b.disabled = false; }
  });
  update();
}

// ============ QUOTES ============
export function viewQuotes() {
  let list = db().quotes;
  if (app.query.status) list = list.filter(q => q.status === app.query.status);
  render(`
    ${pageHead('Quotes', 'Build, send and track quotations.', can('quotes') ? linkBtn('New quote', 'quotes/new', 'primary') : '')}
    ${filters([{ key: 'status', label: 'Status', options: S.QUOTE_STATUSES }], 'Search quotes')}
    ${table([
      { label: 'Quote', render: q => `<strong>${esc(q.number)}</strong>` },
      { label: 'Customer', render: q => esc(custName(q.customerId)) },
      { label: 'Status', render: q => badge(q.status) + (q.changeRequests.length && ['Sent', 'Viewed'].includes(q.status) ? ' ' + badge('Changes requested', 'warn') : '') },
      { label: 'Valid until', render: q => fmtDate(q.validUntil) },
      { label: 'Total', cls: 'num', render: q => money(S.docTotals(q).total) },
      { label: 'Margin', cls: 'num', render: q => pct(S.docTotals(q).margin) },
      { label: 'Created', render: q => fmtDate(q.createdAt) },
    ], list, { href: q => `quotes/${q.id}`, empty: 'No quotes match. Create one from a lead or customer.' })}`);
}

export function viewQuoteEditor({ id }) {
  const q = id ? S.get('quotes', id) : null;
  if (id && !q) return notFound('quote');
  const lead = q?.leadId ? S.get('leads', q.leadId) : (app.query.lead ? S.get('leads', app.query.lead) : null);
  let doc = q || { customerId: lead?.customerId || app.query.customer || '', items: [] };
  if (!q && lead) {
    doc.items = lead.items?.length
      ? lead.items.map(i => ({ productId: i.productId, variantId: i.variantId, qty: i.qty, unitPrice: S.get('products', i.productId)?.wholesalePrice || '', fulfilment: i.variantId ? 'stock' : 'make', description: '' }))
      : [{ productId: '', description: [lead.productType, lead.customization].filter(Boolean).join(' — '), qty: lead.quantity || '', unitPrice: '', unitCost: '', fulfilment: 'make', businessType: 'Manufacturing' }];
  }
  if (!q && app.query.product) { const p = S.get('products', app.query.product); if (p) doc.items = [{ productId: p.id, qty: p.moq, unitPrice: p.wholesalePrice, fulfilment: p.kind === 'Made to order' ? 'make' : 'stock' }]; }
  docEditor({
    kind: 'quote', doc, lead,
    title: q ? `Edit ${q.number}` : 'New quote',
    sub: lead ? `For request ${esc(lead.number)} from ${esc(lead.company || lead.name)}` : 'Add products, costs and markup, then send it to the customer.',
    buttons: [{ key: 'save', label: 'Save draft' }, { key: 'send', label: 'Save and send', cls: 'primary' }],
    onSave: (mode, v) => {
      const data = { ...v, leadId: lead?.id };
      const saved = q ? S.updateQuote(q.id, data) : S.createQuote(data);
      if (mode === 'send') S.sendQuote(saved.id);
      toast(mode === 'send' ? `Quote ${saved.number} sent` : `Quote ${saved.number} saved`);
      go(`quotes/${saved.id}`);
    },
  });
}

export function viewQuote({ id }) {
  const q = S.get('quotes', id);
  if (!q) return notFound('quote');
  const c = S.get('customers', q.customerId), t = S.docTotals(q);
  const url = S.quoteUrl(q);
  const open = ['Sent', 'Viewed'].includes(q.status);
  render(`
    ${pageHead(q.number, `${a(custName(q.customerId), `customers/${q.customerId}`)} · created ${fmtDate(q.createdAt)} by ${esc(userName(q.createdBy))}`,
      `${badge(q.status)}
       ${!['Approved', 'Converted to order'].includes(q.status) ? linkBtn('Edit', `quotes/${q.id}/edit`, 'ghost') : ''}
       ${btn('Download PDF', 'pdf', 'ghost')}${canShareFiles() ? btn('Share PDF', 'sharepdf', 'ghost') : ''}
       ${['Draft', 'Sent', 'Viewed'].includes(q.status) ? btn(q.status === 'Draft' ? 'Send quote' : 'Resend', 'send', q.status === 'Draft' ? 'primary' : 'ghost') : ''}
       ${q.status === 'Approved' ? btn('Convert to order', 'convert', 'primary') : ''}
       ${q.orderId ? linkBtn('View order', `orders/${q.orderId}`, 'primary') : ''}`)}
    ${q.changeRequests.length && open ? `<div class="callout warn"><strong>Customer asked for changes</strong><p>${esc(q.changeRequests[q.changeRequests.length - 1].text)}</p><small>${fmtDateTime(q.changeRequests[q.changeRequests.length - 1].at)}</small></div>` : ''}
    <div class="grid-2-1">
      <div>
        ${panel('Items', table([
          { label: 'Product', render: i => `${esc(S.lineDescription(i))}${i.description && i.productId ? `<br><small>${esc(i.description)}</small>` : ''}` },
          { label: 'Fulfilment', render: i => i.fulfilment === 'stock' ? 'Ready stock' : `Make to order · ${esc(i.businessType)}` },
          { label: 'Qty', cls: 'num', render: i => int(i.qty) },
          { label: 'Unit price', cls: 'num', render: i => money(i.unitPrice) },
          { label: 'Unit cost', cls: 'num', render: i => money(i.unitCost) },
          { label: 'Amount', cls: 'num', render: i => money(i.qty * i.unitPrice) },
        ], q.items))}
        ${panel('History', `<ol class="timeline">${q.history.slice().reverse().map(h => `<li><strong>${esc(h.text)}</strong><small>${fmtDateTime(h.at)} · ${esc(h.by)}</small></li>`).join('')}</ol>`)}
      </div>
      <div>
        ${panel('Summary', kv([['Subtotal', money(t.subtotal)], ['Discount', t.discount ? `− ${money(t.discount)}` : ''], ['Delivery', t.deliveryCharge ? money(t.deliveryCharge) : ''], ['Tax', t.tax ? money(t.tax) : ''], ['Total', `<strong>${money(t.total)}</strong>`], ['Direct cost', money(t.directCost)], ['Gross profit', `${money(t.profit)} (${pct(t.margin)})`], ['Valid until', fmtDate(q.validUntil)], ['Production time', q.productionDays ? `${q.productionDays} days` : ''], ['Payment terms', esc(q.paymentTerms)]]))}
        ${q.status !== 'Draft' ? panel('Customer link', `<p class="muted small">The customer can view the quote, download the PDF, and approve, decline or request changes — no login needed.</p>
          <input class="copy-field" readonly value="${esc(url)}" aria-label="Quote link">
          <div class="btn-row">${btn('Copy link', 'copy', 'sm')}<a class="btn sm ghost" target="_blank" rel="noopener" href="${waLink(c.whatsapp || c.phone, `Hi ${c.contact || ''}, here is your Seamline quote ${q.number}. You can view it, download the PDF and approve it here: ${url}`)}">WhatsApp</a><a class="btn sm ghost" href="mailto:${esc(c.email)}?subject=${encodeURIComponent(`Seamline quote ${q.number}`)}&body=${encodeURIComponent(`Hi ${c.contact || ''},\n\nYour quote is ready: ${url}\n\nSeamline`)}">Email</a></div>
          ${open ? `<hr class="seam"><p class="muted small">Customer replied by phone or WhatsApp?</p><div class="btn-row">${btn('Mark approved', 'approve', 'sm')}${btn('Mark rejected', 'reject', 'sm ghost')}</div>` : ''}`) : ''}
      </div>
    </div>`,
  {
    pdf: () => pdfAction(S.quoteDoc(q)),
    sharepdf: () => pdfAction(S.quoteDoc(q), 'share', `Seamline quote ${q.number}`),
    send: () => { S.sendQuote(q.id); toast('Quote sent. Share the link with the customer.'); rerender(); },
    convert: () => { const o = S.convertQuote(q.id); toast(`Order ${o.number} created as a draft`); go(`orders/${o.id}`); },
    copy: async () => { await copyText(url); toast('Link copied'); },
    approve: async () => { if (await confirmBox('Record that the customer approved this quote.', { confirmLabel: 'Mark approved' })) { S.respondToQuote(q.id, 'approve', '', true); rerender(); } },
    reject: async () => { const r = await confirmBox('Record that the customer rejected this quote.', { input: 'Reason', confirmLabel: 'Mark rejected', danger: true }); if (r) { S.respondToQuote(q.id, 'reject', r, true); rerender(); } },
  });
}

// ============ CUSTOMERS ============
export const customerFields = () => [
  { name: 'company', label: 'Company name' }, { name: 'contact', label: 'Contact person' },
  { name: 'email', label: 'Email', type: 'email' }, { name: 'phone', label: 'Phone' },
  { name: 'whatsapp', label: 'WhatsApp number', placeholder: '94771234567' },
  { name: 'type', label: 'Customer type', type: 'select', options: S.CUSTOMER_TYPES },
  { name: 'industry', label: 'Industry' }, { name: 'source', label: 'Customer source', type: 'select', options: S.CUSTOMER_SOURCES, blank: 'Choose' },
  { name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive'] },
  { name: 'address', label: 'Address', type: 'textarea', full: true, rows: 2 },
];
export function viewCustomers() {
  let list = db().customers;
  if (app.query.type) list = list.filter(c => c.type === app.query.type);
  if (app.query.status) list = list.filter(c => c.status === app.query.status);
  const rows = list.map(c => ({ c, s: S.customerStats(c.id) })).sort((x, y) => y.s.revenue - x.s.revenue);
  render(`
    ${pageHead('Customers', `${rows.length} customer${rows.length === 1 ? '' : 's'}`, can('customers.edit') ? btn('Add customer', 'add', 'primary') : '')}
    ${filters([{ key: 'type', label: 'Type', options: S.CUSTOMER_TYPES }, { key: 'status', label: 'Status', options: ['Active', 'Inactive'] }], 'Search name, email, phone')}
    ${table([
      { label: 'Customer', render: r => `<strong>${esc(S.customerName(r.c))}</strong><br><small>${esc(r.c.code)}${r.c.company && r.c.contact ? ` · ${esc(r.c.contact)}` : ''}</small><span hidden>${esc(r.c.email)} ${esc(r.c.phone)}</span>` },
      { label: 'Type', render: r => esc(r.c.type) },
      { label: 'Orders', cls: 'num', render: r => int(r.s.orders) },
      { label: 'Revenue', cls: 'num', render: r => money(r.s.revenue) },
      { label: 'Outstanding', cls: 'num', render: r => r.s.outstanding > 0 ? `<span class="bad-text">${money(r.s.outstanding)}</span>` : money(0) },
      { label: 'Last order', render: r => r.s.lastOrder ? fmtDate(r.s.lastOrder.createdAt) : '—' },
      { label: 'Status', render: r => badge(r.c.status) },
    ], rows, { href: r => `customers/${r.c.id}`, empty: 'No customers match these filters.' })}`,
  {
    add: () => formModal({ title: 'Add customer', wide: true, fields: customerFields(), values: { type: 'Corporate', status: 'Active' }, onSubmit: v => { const c = S.saveCustomer(v); toast(`${S.customerName(c)} added`); go(`customers/${c.id}`); } }),
  });
}

export function viewCustomer({ id }) {
  const c = S.get('customers', id);
  if (!c) return notFound('customer');
  const st = S.customerStats(c.id);
  const tab = app.query.tab || 'orders';
  const orders = db().orders.filter(o => o.customerId === c.id).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const quotes = db().quotes.filter(q => q.customerId === c.id);
  const lib = db().customerProducts.filter(p => p.customerId === c.id);
  const pays = db().payments.filter(p => p.customerId === c.id).sort((x, y) => y.at.localeCompare(x.at));
  const content = {
    orders: () => orderTable(orders),
    quotes: () => table([
      { label: 'Quote', render: q => esc(q.number) }, { label: 'Status', render: q => badge(q.status) },
      { label: 'Total', cls: 'num', render: q => money(S.docTotals(q).total) }, { label: 'Created', render: q => fmtDate(q.createdAt) },
    ], quotes, { href: q => `quotes/${q.id}`, empty: 'No quotes yet.' }),
    products: () => lib.length ? `<div class="lib-grid">${lib.map(p => `<article class="lib-card">
        ${p.design ? `<img src="${p.design}" alt="Approved design for ${esc(p.name)}">` : `<div class="lib-ph">${productThumb(S.get('products', p.productId) || { name: p.name }, 56)}</div>`}
        <h3>${esc(p.name)}</h3><p>${esc(p.specs || '')}</p>
        <small>Last: ${int(p.lastQty)} units at ${money(p.lastPrice)} · ${esc(p.lastOrderNumber)} · ordered ${p.timesOrdered}×</small>
        <div class="btn-row">${btn('Edit details', 'libedit', 'sm ghost', `data-id="${p.id}"`)}</div></article>`).join('')}</div>
        <p>${btn('Reorder products', 'reorder', 'primary')}</p>` : '<div class="empty">Products appear here once an order is delivered. They can then be reordered in one step.</div>',
    payments: () => table([
      { label: 'Payment', render: p => esc(p.number) }, { label: 'Order', render: p => esc(S.get('orders', p.orderId)?.number) },
      { label: 'Date', render: p => fmtDate(p.at) }, { label: 'Method', render: p => esc(p.method) },
      { label: 'Amount', cls: 'num', render: p => p.void ? `<s>${money(p.amount)}</s> ${badge('Void')}` : money(p.amount) },
    ], pays, { empty: 'No payments recorded.' }),
    notes: () => `<form class="note-form" data-note><textarea rows="2" placeholder="Preferences, sizing, delivery instructions…" aria-label="Note"></textarea>${can('customers.edit') ? btn('Add note', 'note', 'sm') : ''}</form>
      <ul class="notes">${c.notes.map(n => `<li><p>${esc(n.text)}</p><small>${esc(n.by)} · ${fmtDateTime(n.at)}</small></li>`).join('') || '<li class="muted">No notes yet.</li>'}</ul>`,
  };
  render(`
    ${pageHead(S.customerName(c), `${esc(c.code)} · ${esc(c.type)}${c.industry ? ` · ${esc(c.industry)}` : ''}`,
      `${badge(c.status)} ${can('customers.edit') ? btn('Edit', 'edit', 'ghost') : ''} ${can('quotes') ? linkBtn('New quote', `quotes/new?customer=${c.id}`, 'ghost') : ''} ${can('orders.create') ? linkBtn('New order', `orders/new?customer=${c.id}`, 'primary') : ''}`)}
    <div class="stat-row">
      ${stat('Total revenue', money(st.revenue))}${stat('Orders', int(st.orders))}${stat('Active orders', int(st.active))}
      ${stat('Outstanding', money(st.outstanding))}${stat('Last order', st.lastOrder ? fmtDate(st.lastOrder.createdAt) : '—', st.lastOrder ? esc(st.lastOrder.number) : '')}
    </div>
    <div class="grid-2-1 reverse-mobile">
      <div>${tabs([['orders', `Orders (${orders.length})`], ['quotes', `Quotes (${quotes.length})`], ['products', `Products (${lib.length})`], ['payments', 'Payments'], ['notes', 'Notes']], tab)}
        <div class="tab-body">${content[tab] ? content[tab]() : ''}</div></div>
      <div>${panel('Contact', kv([['Contact', esc(c.contact)], ['Email', c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : ''], ['Phone', esc(c.phone)],
        ['WhatsApp', c.whatsapp ? `<a href="${waLink(c.whatsapp, `Hi ${c.contact}, `)}" target="_blank" rel="noopener">${esc(c.whatsapp)}</a>` : ''], ['Address', esc(c.address)], ['Source', esc(c.source)], ['Customer since', fmtDate(c.createdAt)]]))}
        ${panel('Portal access', c.portal ? `<p>Can log in as <strong>${esc(c.portal.email)}</strong></p>${can('customers.edit') ? (CLOUD ? btn('Send password reset', 'portalreset', 'sm ghost') : btn('Change password', 'portal', 'sm ghost')) + ' ' + btn('Remove access', 'noportal', 'sm ghost danger-text') : ''}` : `<p class="muted">No portal login yet. Guest tracking links still work.</p>${can('customers.edit') ? btn('Give portal access', 'portal', 'sm') : ''}`)}
      </div>
    </div>`,
  {
    edit: () => formModal({ title: 'Edit customer', wide: true, fields: customerFields(), values: c, onSubmit: v => { S.saveCustomer({ ...v, id: c.id }); toast('Customer updated'); rerender(); } }),
    note: () => { S.addCustomerNote(c.id, $('[data-note] textarea').value); rerender(); },
    portal: () => CLOUD
      ? formModal({ title: 'Portal access', intro: 'Creates a customer login in Supabase. Share the email and password with the customer — they can change it later with “Forgot password”.', fields: [{ name: 'email', label: 'Login email', type: 'email', required: true }, { name: 'password', label: 'Temporary password (min 8 characters)', type: 'text', required: true }], values: { email: c.portal?.email || c.email },
          onSubmit: async v => { if ((v.password || '').length < 8) throw new Error('Passwords need at least 8 characters.'); const r = await Cloud.createLogin(v.email, v.password); await S.setPortalAccess(c.id, v.email, '', true); toast(r.existed ? 'Portal enabled — this email already had a login, so its existing password still applies' : r.needsConfirm ? 'Portal enabled — the customer must confirm their email first' : 'Portal access enabled'); rerender(); } })
      : formModal({ title: 'Portal access', intro: 'Share these details with the customer. They can then view orders, approve quotes and reorder.', fields: [{ name: 'email', label: 'Login email', type: 'email', required: true }, { name: 'password', label: 'Password (min 8 characters)', type: 'text', required: true }], values: { email: c.portal?.email || c.email }, onSubmit: async v => { await S.setPortalAccess(c.id, v.email, v.password); toast('Portal access saved'); rerender(); } }),
    portalreset: async () => { await Cloud.resetPassword(c.portal.email); toast(`Password reset email sent to ${c.portal.email}`); },
    noportal: async () => { if (await confirmBox('The customer will no longer be able to log in. Tracking links keep working.', { confirmLabel: 'Remove access', danger: true })) { S.revokePortalAccess(c.id); rerender(); } },
    libedit: el => {
      const p = S.get('customerProducts', el.dataset.id);
      formModal({ title: 'Customer product', wide: true, fields: [{ name: 'name', label: 'Product name', full: true }, { name: 'specs', label: 'Specifications', type: 'textarea', full: true }, { name: 'material', label: 'Material' }, { name: 'printMethod', label: 'Print method' }, { name: 'sizeChart', label: 'Size chart / breakdown', type: 'textarea', full: true, rows: 2 }, { name: 'designFile', label: 'Approved design (image)', type: 'file', accept: 'image/*', full: true }], values: p,
        onSubmit: async v => { const design = v.designFile ? await readImage(v.designFile, 800) : undefined; S.updateLibraryItem(p.id, { ...v, design }); toast('Saved'); rerender(); } });
    },
    reorder: () => reorderModal(c.id),
  });
  bindTabs();
}
export function bindTabs() {
  $$('[data-tab]').forEach(b => b.addEventListener('click', () => { const q = new URLSearchParams(app.query); q.set('tab', b.dataset.tab); location.hash = `#/${app.path}?${q}`; }));
}
export function reorderModal(customerId) {
  const lib = db().customerProducts.filter(p => p.customerId === customerId);
  formModal({
    title: 'Reorder', wide: true, submitLabel: 'Create reorder request',
    intro: 'Previous quantities and prices are loaded. Change quantities as needed; leave empty to skip a product.',
    fields: [...lib.map(p => { const s = p.fulfilment === 'stock' && p.variantId ? S.variantStock(p.variantId) : null; return { name: `q_${p.id}`, label: p.name, type: 'number', min: 0, hint: `Previously ${p.lastQty} at ${money(p.lastPrice)}${s ? ` · ${s.available} in stock now` : ' · made to order'}` }; }), { name: 'note', label: 'Note', type: 'textarea', full: true, rows: 2 }],
    values: Object.fromEntries(lib.map(p => [`q_${p.id}`, p.lastQty])),
    onSubmit: v => { const r = S.createReorder({ customerId, lines: lib.map(p => ({ customerProductId: p.id, qty: v[`q_${p.id}`] })), note: v.note, source: `Staff (${app.user.name})` }); toast(`Reorder ${r.number} created`); go('reorders'); },
  });
}

// ============ ORDERS ============
function orderTable(list) {
  return table([
    { label: 'Order', render: o => `<strong>${esc(o.number)}</strong><br><small>${fmtDate(o.createdAt)}</small>` },
    { label: 'Customer', render: o => esc(custName(o.customerId)) },
    { label: 'Type', render: o => esc(S.orderType(o)) },
    { label: 'Order', render: o => badge(o.state) },
    { label: 'Production', render: o => o.productionStatus === 'Not Required' ? '<span class="muted">—</span>' : badge(o.productionStatus) },
    { label: 'Delivery', render: o => badge(o.deliveryStatus) },
    { label: 'Payment', render: o => badge(o.paymentStatus) },
    { label: 'Total', cls: 'num', render: o => money(S.orderTotals(o).total) },
    { label: 'Due', render: o => { const late = o.expectedAt && o.expectedAt < today() && o.state === 'Confirmed' && o.deliveryStatus !== 'Delivered'; return o.expectedAt ? `<span class="${late ? 'bad-text' : ''}">${fmtDate(o.expectedAt)}${late ? ' · late' : ''}</span>` : '—'; } },
  ], list, { href: o => `orders/${o.id}`, empty: 'No orders match these filters.' });
}
export function viewOrders() {
  const q = app.query;
  let list = [...db().orders].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  if (q.type) list = list.filter(o => S.orderType(o) === q.type || (q.type === 'Wholesale' && S.orderType(o) === 'Mixed' && false));
  if (q.state) list = list.filter(o => o.state === q.state);
  if (q.production) list = list.filter(o => o.productionStatus === q.production);
  if (q.delivery) list = list.filter(o => o.deliveryStatus === q.delivery);
  if (q.payment) list = list.filter(o => o.paymentStatus === q.payment);
  render(`
    ${pageHead('Orders', 'Manufacturing, wholesale and mixed orders. Each status is tracked separately.', can('orders.create') ? linkBtn('New order', 'orders/new', 'primary') : '')}
    ${filters([
      { key: 'type', label: 'Type', options: ['Manufacturing', 'Wholesale', 'Mixed'] },
      { key: 'state', label: 'Order', options: ['Draft', 'Confirmed', 'Completed', 'Cancelled'] },
      { key: 'production', label: 'Production', options: ['Not Required', ...S.PRODUCTION_FLOW] },
      { key: 'delivery', label: 'Delivery', options: S.DELIVERY_FLOW },
      { key: 'payment', label: 'Payment', options: ['Unpaid', 'Partially Paid', 'Paid'] },
    ], 'Search orders')}
    ${orderTable(list)}`);
}

export function viewOrderEditor({ id }) {
  const o = id ? S.get('orders', id) : null;
  if (id && !o) return notFound('order');
  if (o && o.state !== 'Draft') { toast('Only draft orders can be fully edited.', 'error'); return go(`orders/${o.id}`); }
  const doc = o || { customerId: app.query.customer || '', items: [], warehouseId: S.activeWarehouses()[0]?.id };
  if (!o && app.query.product) {
    const p = S.get('products', app.query.product);
    const v = app.query.variant && S.get('variants', app.query.variant);
    if (p) doc.items = [{ productId: p.id, variantId: v?.id || '', qty: p.moq || '', unitPrice: p.wholesalePrice, fulfilment: p.kind === 'Made to order' ? 'make' : 'stock' }];
  }
  docEditor({
    kind: 'order', doc,
    title: o ? `Edit ${o.number}` : 'New order',
    sub: 'Ready-stock lines reserve inventory when you confirm. Make-to-order lines start production tracking.',
    buttons: [{ key: 'draft', label: 'Save draft' }, { key: 'confirm', label: 'Save and confirm', cls: 'primary' }],
    onSave: (mode, v) => {
      const saved = o ? S.updateOrder(o.id, v) : S.createOrder(v);
      if (mode === 'confirm') {
        try { S.confirmOrder(saved.id); toast(`Order ${saved.number} confirmed`); }
        catch (e) { toast(`Saved as draft. ${e.message}`, 'error'); }
      } else toast(`Draft ${saved.number} saved`);
      go(`orders/${saved.id}`);
    },
  });
}

export function viewOrder({ id }) {
  const o = S.get('orders', id);
  if (!o) return notFound('order');
  const c = S.get('customers', o.customerId), t = S.orderTotals(o), type = S.orderType(o);
  const pays = db().payments.filter(p => p.orderId === o.id);
  const qcs = db().qualityChecks.filter(q => q.orderId === o.id);
  const url = S.trackingUrl(o);
  const live = o.state === 'Confirmed';
  const canStatus = can('orders.status') && live;
  const statusCard = (label, value, control) => `<div class="status-card"><span>${label}</span>${control || badge(value)}</div>`;
  const select = (action, flow, value, disabled) => `<select data-change="${action}" aria-label="${action}" ${disabled ? 'disabled' : ''}>${flow.map(s => `<option ${s === value ? 'selected' : ''}>${s}</option>`).join('')}</select>`;
  const prodReady = ['Ready', 'Not Required'].includes(o.productionStatus);

  render(`
    ${pageHead(o.number, `${a(S.customerName(c), `customers/${c.id}`)} · ${type} order · created ${fmtDateTime(o.createdAt)}`,
      `${o.state === 'Draft' && can('orders.create') ? linkBtn('Edit', `orders/${o.id}/edit`, 'ghost') + btn('Confirm order', 'confirm', 'primary') : ''}
       ${live || o.state === 'Completed' ? btn('Invoice PDF', 'invoice', 'ghost') + (canShareFiles() ? btn('Share invoice', 'shareinv', 'ghost') : '') : ''}
       ${live && can('payments') && t.balance > 0 ? btn('Record payment', 'pay', 'primary') : ''}
       ${(o.state === 'Draft' || live) && !o.stockDeducted && can('orders.create') ? btn('Cancel order', 'cancel', 'ghost danger-text') : ''}`)}
    <div class="status-row">
      ${statusCard('Order', o.state)}
      ${statusCard('Production', o.productionStatus, o.productionStatus === 'Not Required' ? '<span class="muted">Not required</span>' : (canStatus ? select('production', S.PRODUCTION_FLOW, o.productionStatus, S.DELIVERY_FLOW.indexOf(o.deliveryStatus) >= 1) : null))}
      ${statusCard('Delivery', o.deliveryStatus, canStatus ? select('delivery', S.DELIVERY_FLOW, o.deliveryStatus, !prodReady) : null)}
      ${statusCard('Payment', o.paymentStatus)}
    </div>
    ${live && !prodReady ? '<p class="muted small">Delivery can be updated once production is marked Ready.</p>' : ''}
    ${o.productionStatus === 'Quality Control' && canStatus ? `<div class="callout info"><strong>Quality control</strong><p>Record the inspection result to move this order to Ready, or back into production.</p>${btn('Record QC result', 'qc', 'sm primary')}</div>` : ''}
    <div class="grid-2-1">
      <div>
        ${panel('Items', table([
          { label: 'Product', render: i => `${esc(S.lineDescription(i))}${i.description && i.productId ? `<br><small>${esc(i.description)}</small>` : ''}` },
          { label: 'Fulfilment', render: i => i.fulfilment === 'stock' ? `Ready stock<br><small>${o.stockDeducted ? 'Deducted from stock' : live ? 'Reserved' : 'Reserves on confirm'}</small>` : `Make to order<br><small>${esc(i.businessType)}</small>` },
          { label: 'Qty', cls: 'num', render: i => int(i.qty) + (i.returned ? `<br><small>${i.returned} returned</small>` : '') },
          { label: 'Price', cls: 'num', render: i => money(i.unitPrice) },
          { label: 'Cost', cls: 'num', render: i => money(i.unitCost) },
          { label: 'Amount', cls: 'num', render: i => money(i.qty * i.unitPrice) },
          ...(o.stockDeducted && can('inventory.edit') ? [{ label: '', render: i => i.fulfilment === 'stock' ? btn('Return', 'return', 'sm ghost', `data-item="${i.id}"`) : '' }] : []),
        ], o.items))}
        ${panel('Timeline', `${o.state !== 'Cancelled' && o.state !== 'Completed' ? `<form class="note-form" data-note><textarea rows="2" placeholder="e.g. Fabric arrived, cutting starts tomorrow" aria-label="Update"></textarea><label class="check"><input type="checkbox" data-public checked> Show on the customer’s live tracking link</label>${btn('Post update', 'note', 'sm primary')}</form>` : ''}
          <ol class="timeline">${o.timeline.slice().reverse().map(e => `<li class="${e.public ? 'pub' : ''}"><strong>${esc(e.text)}</strong><small>${fmtDateTime(e.at)} · ${esc(e.by)}${e.public ? ' · visible to customer' : ''}</small></li>`).join('')}</ol>`)}
        ${pays.length ? panel('Payments', table([
          { label: 'Payment', render: p => esc(p.number) }, { label: 'Date', render: p => fmtDateTime(p.at) },
          { label: 'Method', render: p => `${esc(p.method)}${p.reference ? `<br><small>${esc(p.reference)}</small>` : ''}` },
          { label: 'Amount', cls: 'num', render: p => p.void ? `<s>${money(p.amount)}</s> ${badge('Void')}` : money(p.amount) },
          { label: '', render: p => !p.void && can('payments') ? btn('Void', 'voidpay', 'sm ghost', `data-id="${p.id}"`) : '' },
        ], pays)) : ''}
        ${qcs.length ? panel('Quality checks', table([
          { label: 'Date', render: q => fmtDateTime(q.at) }, { label: 'Result', render: q => badge(q.result) },
          { label: 'Inspected', cls: 'num', render: q => int(q.inspected) }, { label: 'Defects', cls: 'num', render: q => int(q.defects) },
          { label: 'Notes', render: q => esc(q.notes) }, { label: 'By', render: q => esc(q.by) },
        ], qcs)) : ''}
      </div>
      <div>
        ${panel('Money', kv([['Subtotal', money(t.subtotal)], ['Discount', t.discount ? `− ${money(t.discount)}` : ''], ['Delivery charge', t.deliveryCharge ? money(t.deliveryCharge) : ''], ['Tax', t.tax ? money(t.tax) : ''],
          ['Total', `<strong>${money(t.total)}</strong>`], ['Paid', money(t.paid)], ['Balance', t.balance > 0 ? `<strong class="bad-text">${money(t.balance)}</strong>` : money(0)]])
          + `<hr class="seam">` + kv([['Product cost', money(t.itemCost)], ['Delivery, packaging, other', money(t.extraCost)], ['Gross profit', `<strong class="${t.profit < 0 ? 'bad-text' : ''}">${money(t.profit)}</strong>`], ['Gross margin', pct(t.margin)]])
          + (can('orders.costs') && o.state !== 'Cancelled' ? `<p>${btn('Edit costs', 'costs', 'sm ghost')}</p>` : ''))}
        ${o.state !== 'Cancelled' ? panel('Live tracking link', url ? `<p class="muted small">${o.state === 'Draft' ? 'The link goes live when you confirm the order.' : 'Send this once. Every status change and every update you post below appears on it automatically — the customer just refreshes or keeps it open.'}</p>
          <input class="copy-field" readonly value="${esc(url)}" aria-label="Tracking link">
          <div class="btn-row">${btn('Copy link', 'copy', 'sm primary')}<a class="btn sm ghost" target="_blank" rel="noopener" href="${waLink(c.whatsapp || c.phone, `Hi ${c.contact || ''}, you can follow your Seamline order ${o.number} live here: ${url}`)}">WhatsApp</a>
          <a class="btn sm ghost" href="mailto:${esc(c.email)}?subject=${encodeURIComponent(`Track your Seamline order ${o.number}`)}&body=${encodeURIComponent(`Hi ${c.contact || ''},\n\nFollow your order live here: ${url}\n\nSeamline`)}">Email</a>
          ${btn('QR code', 'qr', 'sm ghost')}<a class="btn sm ghost" href="${esc(url)}" target="_blank" rel="noopener">Preview</a></div>
          <p class="small link-row">${btn('New link', 'regen', 'link-btn')} · ${btn('Revoke link', 'revoke', 'link-btn danger-text')}</p>` : `<p class="muted">The tracking link has been revoked.</p>${btn('Create a new link', 'regen', 'sm')}`) : ''}
        ${panel('Details', kv([['Assigned to', esc(userName(o.assignedTo))], ['Expected completion', o.expectedAt ? fmtDate(o.expectedAt) : ''], ['Warehouse', esc(S.get('warehouses', o.warehouseId)?.name)],
          ['Quote', o.quoteId ? a(S.get('quotes', o.quoteId)?.number, `quotes/${o.quoteId}`) : ''], ['Invoice', esc(S.invoiceFor(o.id)?.number)], ['Customer notes', esc(o.customerNotes)], ['Internal notes', esc(o.internalNotes)]])
          + (o.state !== 'Cancelled' && o.state !== 'Completed' ? `<p>${btn('Edit details', 'details', 'sm ghost')}</p>` : ''))}
      </div>
    </div>`,
  {
    confirm: () => { S.confirmOrder(o.id); toast(`${o.number} confirmed${type !== 'Manufacturing' ? ' and stock reserved' : ''}`); rerender(); },
    production: el => { S.setProductionStatus(o.id, el.value); toast(`Production: ${el.value}`); rerender(); },
    delivery: async el => {
      const idx = S.DELIVERY_FLOW.indexOf(el.value);
      if (idx >= 2 && !o.stockDeducted && o.items.some(i => i.fulfilment === 'stock')) {
        if (!await confirmBox('Dispatching deducts the reserved ready-stock items from inventory. This can only be reversed by recording a return.', { confirmLabel: `Mark ${el.value.toLowerCase()}` })) { el.value = o.deliveryStatus; return; }
      }
      try { S.setDeliveryStatus(o.id, el.value); toast(`Delivery: ${el.value}`); } finally { rerender(); }
    },
    qc: () => formModal({ title: 'Record QC result', fields: [{ name: 'result', label: 'Result', type: 'select', options: ['Passed', 'Failed'] }, { name: 'inspected', label: 'Units inspected', type: 'number', min: 1 }, { name: 'defects', label: 'Defects found', type: 'number', min: 0 }, { name: 'notes', label: 'Notes', type: 'textarea', full: true }], values: { inspected: Math.min(50, o.items.reduce((s, i) => s + i.qty, 0)), defects: 0 },
      onSubmit: v => { S.recordQC(o.id, v); toast(v.result === 'Passed' ? 'QC passed — order is Ready' : 'QC failed — back in production'); rerender(); } }),
    pay: () => payModal(o),
    voidpay: async el => { const r = await confirmBox('Voided payments stay on record but no longer count toward the balance.', { title: 'Void payment', input: 'Reason', confirmLabel: 'Void payment', danger: true }); if (r) { S.voidPayment(el.dataset.id, r); rerender(); } },
    invoice: () => pdfAction(S.invoiceDoc(o)),
    shareinv: () => pdfAction(S.invoiceDoc(o), 'share', `Invoice for Seamline order ${o.number}`),
    cancel: async () => { const r = await confirmBox(`Reserved stock is released and the invoice is voided.${t.paid ? ` ${money(t.paid)} has been paid and will need a refund.` : ''}`, { title: `Cancel ${o.number}?`, input: 'Reason', confirmLabel: 'Cancel order', danger: true }); if (r) { S.cancelOrder(o.id, r); toast('Order cancelled'); rerender(); } },
    note: () => { const pub = $('[data-public]').checked; S.addOrderNote(o.id, $('[data-note] textarea').value, pub); toast(pub ? 'Update posted — it is on the tracking link now' : 'Internal note added'); rerender(); },
    costs: () => formModal({ title: 'Direct costs', wide: true, intro: 'Record actual costs as they are known. Ready-stock costs come from inventory automatically.',
      fields: [...o.items.filter(i => i.fulfilment === 'make').map(i => ({ name: `c_${i.id}`, label: `Unit cost: ${S.lineDescription(i)}`, type: 'number', min: 0, full: true })), { name: 'delivery', label: 'Delivery cost', type: 'number', min: 0 }, { name: 'packaging', label: 'Packaging cost', type: 'number', min: 0 }, { name: 'other', label: 'Other direct cost', type: 'number', min: 0 }],
      values: { ...o.costs, ...Object.fromEntries(o.items.map(i => [`c_${i.id}`, i.unitCost])) },
      onSubmit: v => { S.updateOrder(o.id, { costs: v, itemCosts: Object.fromEntries(o.items.filter(i => i.fulfilment === 'make').map(i => [i.id, v[`c_${i.id}`]])) }); toast('Costs updated'); rerender(); } }),
    details: () => formModal({ title: 'Order details', fields: [{ name: 'expectedAt', label: 'Expected completion', type: 'date' }, { name: 'assignedTo', label: 'Assigned to', type: 'select', options: staffOptions() }, { name: 'customerNotes', label: 'Customer notes', type: 'textarea', full: true }, { name: 'internalNotes', label: 'Internal notes', type: 'textarea', full: true }], values: o,
      onSubmit: v => { S.updateOrder(o.id, v); toast('Details saved'); rerender(); } }),
    return: el => { const it = o.items.find(i => i.id === el.dataset.item); formModal({ title: `Return ${S.lineDescription(it)}`, fields: [{ name: 'qty', label: 'Quantity returned', type: 'number', min: 1, required: true }, { name: 'condition', label: 'Condition', type: 'select', options: [{ value: 'usable', label: 'Usable — back into stock' }, { value: 'damaged', label: 'Damaged — into damaged stock' }] }, { name: 'note', label: 'Note', type: 'textarea', full: true }], onSubmit: v => { S.returnItems(o.id, it.id, v.qty, v.condition, v.note); toast('Return recorded'); rerender(); } }); },
    copy: async () => { await copyText(url); toast('Tracking link copied'); },
    qr: () => modal({ title: `QR code for ${o.number}`, body: `<div class="qr-box">${qrSvg(url)}</div><p class="muted small center">Scan to open the live tracking page. Print it on packing slips or invoices.</p>` }),
    regen: async () => { if (await confirmBox('The old link stops working immediately.', { title: 'Create a new tracking link?', confirmLabel: 'Create new link' })) { S.createTrackingToken(o.id); toast('New link created'); rerender(); } },
    revoke: async () => { if (await confirmBox('The customer will see a "link not valid" page until you create a new link.', { title: 'Revoke tracking link?', confirmLabel: 'Revoke', danger: true })) { S.revokeTracking(o.id); rerender(); } },
  });
}
export function payModal(o) {
  const t = S.orderTotals(o);
  formModal({
    title: `Record payment for ${o.number}`, intro: `Balance due: <strong>${money(t.balance)}</strong>`,
    fields: [{ name: 'amount', label: 'Amount (Rs.)', type: 'number', min: 1, required: true }, { name: 'method', label: 'Method', type: 'select', options: S.PAYMENT_METHODS }, { name: 'date', label: 'Date received', type: 'date' }, { name: 'reference', label: 'Reference', placeholder: 'Bank ref, cheque no.' }],
    values: { amount: Math.round(t.balance), date: today() },
    onSubmit: v => { S.recordPayment(o.id, v); toast('Payment recorded'); rerender(); },
  });
}

// ============ REORDERS ============
export function viewReorders() {
  const list = db().reorders;
  render(`
    ${pageHead('Reorder requests', 'Requests from customers and staff, based on previously delivered products.')}
    ${list.length ? list.map(r => `<article class="panel reorder">
      <header><h2>${esc(r.number)} · ${a(custName(r.customerId), `customers/${r.customerId}`)}</h2><div class="panel-actions">${badge(r.status)}</div></header>
      <p class="muted small">${fmtDateTime(r.createdAt)} · via ${esc(r.source)}${r.note ? ` · “${esc(r.note)}”` : ''}</p>
      ${table([
        { label: 'Product', render: l => esc(l.name) },
        { label: 'Previous', cls: 'num', render: l => `${int(l.previousQty)} at ${money(l.previousPrice)}` },
        { label: 'Requested', cls: 'num', render: l => `<strong>${int(l.qty)}</strong>` },
        { label: 'Fulfilment', render: l => l.fulfilment === 'stock' ? (l.availableNow >= l.qty ? `Ready stock · ${badge('In stock', 'good')}` : `Ready stock · ${badge(`${l.availableNow ?? 0} available`, 'bad')}`) : 'Manufacturing request' },
      ], r.lines)}
      ${r.status === 'New' && can('orders.create') ? `<div class="btn-row">${btn('Create draft order', 'convert', 'primary sm', `data-id="${r.id}"`)}${btn('Decline', 'decline', 'ghost sm', `data-id="${r.id}"`)}</div>` : r.orderId ? `<p>${a(`Order ${S.get('orders', r.orderId)?.number}`, `orders/${r.orderId}`)}</p>` : ''}
    </article>`).join('') : '<div class="empty">No reorder requests yet. Customers can reorder from their portal, or staff can start one from a customer’s Products tab.</div>'}`,
  {
    convert: el => { const o = S.convertReorder(el.dataset.id); toast(`Draft ${o.number} created`); go(`orders/${o.id}`); },
    decline: async el => { const r = await confirmBox('The customer request will be marked declined.', { input: 'Reason', confirmLabel: 'Decline', danger: true }); if (r) { S.declineReorder(el.dataset.id, r); rerender(); } },
  });
}

// ============ SEARCH ============
export function viewSearch() {
  const q = app.query.q || '';
  const res = S.search(q);
  render(`${pageHead(`Results for “${esc(q)}”`, `${res.length} match${res.length === 1 ? '' : 'es'}`)}
    ${table([{ label: 'Type', render: r => badge(r.kind, 'neutral') }, { label: 'Match', render: r => `<strong>${esc(r.label)}</strong>` }, { label: '', render: r => esc(r.sub || '') }], res, { href: r => r.href, empty: 'Nothing matched. Try an order number, customer, SKU, supplier or invoice number.' })}`);
}
