import * as S from './services.js';
import { db, exportJson, importJson, wipe, ymd, CLOUD, baseUrl } from './db.js';
import * as Cloud from './cloud.js';
import { SUPABASE_URL } from './config.js';
import { esc, money, pct, int, fmtDate, fmtDateTime, badge, table, formModal, confirmBox, toast, barChart, downloadText, readImage, today, copyText } from './ui.js';
import { app, $, render, rerender, can, go, pageHead, btn, linkBtn, a, panel, kv, stat, filters, tabs, custName, userName, notFound, range, rangePicker } from './core.js';
import { bindTabs, payModal, pdfAction } from './views-sales.js';

const inRange = (d, r) => { const t = new Date(d).getTime(); return t >= r.from.getTime() && t <= r.to.getTime(); };
const productLabel = k => S.get('products', k)?.name || 'Custom items';
const moneyCols = (showCost = true) => [
  { label: 'Revenue', cls: 'num', render: g => money(g.revenue) },
  ...(showCost ? [
    { label: 'Cost', cls: 'num', render: g => money(g.cost) },
    { label: 'Gross profit', cls: 'num', render: g => `<span class="${g.profit < 0 ? 'bad-text' : ''}">${money(g.profit)}</span>` },
    { label: 'Margin', cls: 'num', render: g => pct(g.margin) },
  ] : []),
];
function csv(name, headers, rows) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  downloadText(name, [headers.map(q).join(','), ...rows.map(r => r.map(q).join(','))].join('\n'), 'text/csv');
}

// ============ FINANCE: SALES ============
export function viewSales() {
  const r = range();
  const sm = S.summary(r.from, r.to);
  const seeCost = can('profit') || can('orders.costs');
  const lines = [...sm.lines].sort((x, y) => y.date.localeCompare(x.date));
  render(`
    ${pageHead('Sales', 'Every confirmed sale, split into lines by business type. Revenue excludes tax.', btn('Export CSV', 'csv', 'ghost'))}
    ${rangePicker()}
    <div class="stat-row">${stat('Revenue', money(sm.revenue))}${seeCost ? stat('Cost of sales', money(sm.cost)) + stat('Gross profit', money(sm.grossProfit), `${pct(sm.margin)} margin`) : ''}${stat('Orders', int(sm.orders))}${stat('Average order value', money(sm.aov))}${stat('Outstanding balance', money(S.pendingPayments()), 'All confirmed orders', can('payments') ? 'payments' : '')}</div>
    ${panel('By business type', table([{ label: 'Business type', render: g => `<strong>${esc(g.key)}</strong>` }, ...moneyCols(seeCost)], S.BUSINESS_TYPES.map(k => ({ key: k, ...sm.byType[k], margin: sm.byType[k].revenue ? sm.byType[k].profit / sm.byType[k].revenue : 0 }))))}
    ${panel('Sales lines', table([
      { label: 'Date', render: l => fmtDate(l.date) },
      { label: 'Order', render: l => `<strong>${esc(l.order.number)}</strong>` },
      { label: 'Customer', render: l => esc(custName(l.customerId)) },
      { label: 'Product', render: l => esc(S.lineDescription(l.item)) },
      { label: 'Type', render: l => esc(l.businessType) },
      { label: 'Qty', cls: 'num', render: l => int(l.qty) },
      ...moneyCols(seeCost).map(c => ({ ...c, render: l => c.render({ ...l, margin: l.revenue ? l.profit / l.revenue : 0 }) })),
      { label: 'Payment', render: l => badge(l.order.paymentStatus) },
    ], lines, { href: l => `orders/${l.order.id}`, empty: 'No sales in this period.' }))}`,
  {
    csv: () => csv(`seamline-sales-${r.fromStr}-to-${r.toStr}.csv`, ['Date', 'Order', 'Customer', 'Product', 'Business type', 'Qty', 'Revenue', ...(seeCost ? ['Cost', 'Gross profit'] : [])],
      lines.map(l => [l.date.slice(0, 10), l.order.number, custName(l.customerId), S.lineDescription(l.item), l.businessType, l.qty, Math.round(l.revenue), ...(seeCost ? [Math.round(l.cost), Math.round(l.profit)] : [])])),
  });
}

// ============ INVOICES ============
export function viewInvoices() {
  const q = app.query;
  let list = db().invoices.map(i => ({ inv: i, o: S.get('orders', i.orderId), status: S.invoiceStatus(i) })).filter(x => x.o);
  if (q.status) list = list.filter(x => x.status === q.status);
  list.sort((x, y) => y.inv.issuedAt.localeCompare(x.inv.issuedAt));
  render(`
    ${pageHead('Invoices', 'Issued automatically when an order is confirmed. Cancelled orders void their invoice.')}
    ${filters([{ key: 'status', label: 'Status', options: ['Unpaid', 'Partially Paid', 'Paid', 'Overdue', 'Void'] }], 'Search invoice, order or customer')}
    ${table([
      { label: 'Invoice', render: x => `<strong>${esc(x.inv.number)}</strong>` },
      { label: 'Order', render: x => esc(x.o.number) },
      { label: 'Customer', render: x => esc(custName(x.o.customerId)) },
      { label: 'Issued', render: x => fmtDate(x.inv.issuedAt) },
      { label: 'Due', render: x => fmtDate(x.inv.dueAt) },
      { label: 'Total', cls: 'num', render: x => money(S.orderTotals(x.o).total) },
      { label: 'Balance', cls: 'num', render: x => money(Math.max(0, S.orderTotals(x.o).balance)) },
      { label: 'Status', render: x => badge(x.status) },
      { label: '', render: x => x.inv.void ? '' : `<button type="button" class="link-btn" data-action="pdf" data-id="${x.o.id}">PDF</button>` },
    ], list, { href: x => `orders/${x.o.id}`, empty: 'No invoices match.' })}`,
  { pdf: el => pdfAction(S.invoiceDoc(S.get('orders', el.dataset.id))) });
}

// ============ PAYMENTS ============
export function viewPayments() {
  const r = range();
  const list = db().payments.filter(p => inRange(p.at, r)).sort((x, y) => y.at.localeCompare(x.at));
  const owing = db().orders.filter(o => o.state === 'Confirmed' && S.orderTotals(o).balance > 0.5).sort((x, y) => S.orderTotals(y).balance - S.orderTotals(x).balance);
  const received = list.filter(p => !p.void).reduce((t, p) => t + p.amount, 0);
  const canPay = can('payments');
  render(`
    ${pageHead('Payments', 'Customer payments against orders. Payments are voided, never deleted.', canPay && owing.length ? btn('Record payment', 'record', 'primary') : '')}
    <div class="stat-row">${stat('Received in period', money(received), `${list.filter(p => !p.void).length} payments`)}${stat('Outstanding', money(S.pendingPayments()), `${owing.length} orders with a balance`)}</div>
    ${panel('Orders with a balance', table([
      { label: 'Order', render: o => `<strong>${esc(o.number)}</strong>` },
      { label: 'Customer', render: o => esc(custName(o.customerId)) },
      { label: 'Total', cls: 'num', render: o => money(S.orderTotals(o).total) },
      { label: 'Paid', cls: 'num', render: o => money(S.orderTotals(o).paid) },
      { label: 'Balance', cls: 'num', render: o => `<strong>${money(S.orderTotals(o).balance)}</strong>` },
      { label: 'Invoice due', render: o => { const inv = S.invoiceFor(o.id); const late = inv && new Date(inv.dueAt) < new Date(); return inv ? `<span class="${late ? 'bad-text' : ''}">${fmtDate(inv.dueAt)}${late ? ' · overdue' : ''}</span>` : '—'; } },
      { label: '', render: o => canPay ? btn('Record', 'pay', 'sm', `data-id="${o.id}"`) : '' },
    ], owing, { href: o => `orders/${o.id}`, empty: 'Every confirmed order is fully paid.' }))}
    ${panel('Payment history', rangePicker() + table([
      { label: 'Date', render: p => fmtDateTime(p.at) },
      { label: 'Receipt', render: p => `<strong>${esc(p.number)}</strong>` },
      { label: 'Order', render: p => esc(S.get('orders', p.orderId)?.number) },
      { label: 'Customer', render: p => esc(custName(p.customerId)) },
      { label: 'Method', render: p => `${esc(p.method)}${p.reference ? `<br><small class="muted">${esc(p.reference)}</small>` : ''}` },
      { label: 'Amount', cls: 'num', render: p => p.void ? `<s>${money(p.amount)}</s>` : `<strong>${money(p.amount)}</strong>` },
      { label: 'Recorded by', render: p => esc(p.by) },
      { label: '', render: p => p.void ? `${badge('Void')}<br><small class="muted">${esc(p.voidReason)}</small>` : canPay ? `<button type="button" class="link-btn danger-text" data-action="void" data-id="${p.id}">Void</button>` : '' },
    ], list, { empty: 'No payments in this period.' }))}`,
  {
    pay: el => payModal(S.get('orders', el.dataset.id)),
    record: () => formModal({ title: 'Record payment', fields: [{ name: 'orderId', label: 'Order', type: 'select', full: true, options: owing.map(o => ({ value: o.id, label: `${o.number} · ${custName(o.customerId)} · ${money(S.orderTotals(o).balance)} due` })) }], submitLabel: 'Next',
      onSubmit: v => { setTimeout(() => payModal(S.get('orders', v.orderId)), 50); } }),
    void: async el => { const reason = await confirmBox('The payment stays in the history, marked void, and the order balance goes back up.', { title: 'Void payment?', input: 'Reason', confirmLabel: 'Void payment', danger: true }); if (reason) { S.voidPayment(el.dataset.id, reason); toast('Payment voided'); rerender(); } },
  });
}

// ============ EXPENSES ============
export function viewExpenses() {
  const r = range(), q = app.query;
  let list = db().expenses.filter(e => inRange(`${e.date}T12:00:00`, r));
  if (q.category) list = list.filter(e => e.category === q.category);
  const live = list.filter(e => !e.void);
  const byCat = S.EXPENSE_CATEGORIES.map(c => ({ key: c, amount: live.filter(e => e.category === c).reduce((t, e) => t + e.amount, 0) })).filter(x => x.amount);
  const canEdit = can('expenses');
  render(`
    ${pageHead('Expenses', 'Operating costs used for net profit. Supplier payments are listed but excluded from net profit — that stock is already counted in cost of sales.', canEdit ? btn('Add expense', 'add', 'primary') : '')}
    ${rangePicker()}
    <div class="stat-row">${stat('Operating expenses', money(S.operatingExpenses(r.from, r.to)), 'Counted in net profit')}${stat('Supplier payments', money(live.filter(e => e.category === 'Supplier payments').reduce((t, e) => t + e.amount, 0)), 'Not counted again')}</div>
    <div class="grid-2-1">
      ${panel('Expenses', filters([{ key: 'category', label: 'Category', options: S.EXPENSE_CATEGORIES }], 'Search expenses') + table([
        { label: 'Date', render: e => fmtDate(e.date) },
        { label: 'Category', render: e => `${esc(e.category)}${e.supplierId ? `<br><small class="muted">${esc(S.get('suppliers', e.supplierId)?.company)}</small>` : ''}` },
        { label: 'Description', render: e => `${esc(e.description)}${e.attachment ? `<br>${e.attachment.dataUrl ? `<a href="${e.attachment.dataUrl}" download="${esc(e.attachment.name)}" class="small">📎 ${esc(e.attachment.name)}</a>` : `<small class="muted">📎 ${esc(e.attachment.name)}</small>`}` : ''}` },
        { label: 'Method', render: e => esc(e.method) },
        { label: 'Amount', cls: 'num', render: e => e.void ? `<s>${money(e.amount)}</s>` : `<strong>${money(e.amount)}</strong>` },
        { label: '', render: e => e.void ? `${badge('Void')}<br><small class="muted">${esc(e.voidReason)}</small>` : canEdit ? `<button type="button" class="link-btn danger-text" data-action="void" data-id="${e.id}">Void</button>` : '' },
      ], list.sort((x, y) => y.date.localeCompare(x.date)), { empty: 'No expenses in this period.' }))}
      ${panel('By category', table([{ label: 'Category', render: x => esc(x.key) }, { label: 'Amount', cls: 'num', render: x => money(x.amount) }], byCat, { empty: 'Nothing yet.' }))}
    </div>`,
  {
    add: () => formModal({ title: 'Add expense', fields: [
      { name: 'date', label: 'Date', type: 'date', required: true }, { name: 'category', label: 'Category', type: 'select', options: S.EXPENSE_CATEGORIES },
      { name: 'amount', label: 'Amount (Rs.)', type: 'number', min: 1, required: true }, { name: 'method', label: 'Payment method', type: 'select', options: S.PAYMENT_METHODS },
      { name: 'supplierId', label: 'Supplier (for supplier payments)', type: 'select', blank: '—', options: db().suppliers.map(s => ({ value: s.id, label: s.company })), full: true },
      { name: 'description', label: 'Description', type: 'textarea', full: true, rows: 2 },
      { name: 'file', label: 'Attachment (receipt photo or PDF)', type: 'file', accept: 'image/*,application/pdf', full: true }],
      values: { date: today() },
      onSubmit: async v => {
        let attachment = null;
        if (v.file) attachment = v.file.type.startsWith('image/') ? { name: v.file.name, dataUrl: await readImage(v.file, 1000) } : v.file.size < 400000 ? { name: v.file.name, dataUrl: await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(v.file); }) } : { name: v.file.name };
        S.addExpense({ ...v, attachment }); toast('Expense recorded'); rerender();
      } }),
    void: async el => { const reason = await confirmBox('The expense stays in the history, marked void.', { title: 'Void expense?', input: 'Reason', confirmLabel: 'Void', danger: true }); if (reason) { S.voidExpense(el.dataset.id, reason); rerender(); } },
  });
}

// ============ PROFIT ============
export function viewProfit() {
  const r = range();
  const t = S.summary(S.startOfDay(), S.endOfDay());
  const m = S.summary(r.from, r.to);
  const byProduct = S.groupLines(m.lines, l => l.productId || 'custom', productLabel);
  const byCustomer = S.groupLines(m.lines, l => l.customerId, k => custName(k)).slice(0, 10);
  const series = S.dailySeries(30).map(x => ({ label: x.date.getDate(), revenue: x.revenue, profit: x.profit }));
  render(`
    ${pageHead('Profit', 'Based on actual recorded costs: inventory cost for ready stock, recorded production costs for made-to-order, plus delivery, packaging and other direct costs.')}
    <h2 class="section-h">Today</h2>
    <div class="stat-row">${stat('Revenue', money(t.revenue))}${stat('Cost', money(t.cost))}${stat('Gross profit', money(t.grossProfit), t.revenue ? `${pct(t.margin)} margin` : '')}</div>
    <h2 class="section-h">Selected period</h2>
    ${rangePicker()}
    <div class="stat-row">${stat('Revenue', money(m.revenue))}${stat('COGS', money(m.cost))}${stat('Gross profit', money(m.grossProfit))}${stat('Gross margin', pct(m.margin))}${stat('Expenses', money(m.expenses), '', 'expenses')}${stat('Net profit', `<span class="${m.netProfit < 0 ? 'bad-text' : ''}">${money(m.netProfit)}</span>`)}</div>
    <div class="grid-2-1">
      ${panel('By business type', `<div class="biz-split">${S.BUSINESS_TYPES.map(k => { const x = m.byType[k]; return `<div class="biz"><h3>${esc(k)}</h3><dl><div><dt>Revenue</dt><dd>${money(x.revenue)}</dd></div><div><dt>${k === 'Wholesale' ? 'COGS' : 'Cost'}</dt><dd>${money(x.cost)}</dd></div><div><dt>Profit</dt><dd><strong class="${x.profit < 0 ? 'bad-text' : ''}">${money(x.profit)}</strong></dd></div><div><dt>Margin</dt><dd>${x.revenue ? pct(x.profit / x.revenue) : '—'}</dd></div></dl></div>`; }).join('')}</div>`)}
      ${panel('Last 30 days', barChart(series, { height: 170, labelEvery: 5, series: [{ key: 'revenue', label: 'Revenue', cls: 'bar-a' }, { key: 'profit', label: 'Gross profit', cls: 'bar-b' }] }))}
    </div>
    ${panel('By product', table([{ label: 'Product', render: g => `<strong>${esc(g.label)}</strong>` }, { label: 'Units sold', cls: 'num', render: g => int(g.qty) }, ...moneyCols()], byProduct, { empty: 'No sales in this period.' }))}
    ${panel('By customer (top 10)', table([{ label: 'Customer', render: g => `<strong>${esc(g.label)}</strong>` }, { label: 'Orders', cls: 'num', render: g => int(g.orders) }, ...moneyCols()], byCustomer, { href: g => `customers/${g.key}`, empty: 'No sales in this period.' }))}`);
}

// ============ REPORTS ============
export function viewReports() {
  const all = [['sales', 'Sales'], ['profit', 'Profit'], ['inventory', 'Inventory'], ['customers', 'Customers'], ['operations', 'Operations']].filter(([k]) => can(`reports.${k}`));
  if (!all.length) return render('<div class="empty big">Your role has no reports.</div>');
  const tab = all.some(([k]) => k === app.query.tab) ? app.query.tab : all[0][0];
  const r = range();
  const body = { sales: reportSales, profit: reportProfit, inventory: reportInventory, customers: reportCustomers, operations: reportOperations }[tab](r);
  render(`${pageHead('Reports', 'Every report reads the same live data as orders, inventory and finance.')}${tabs(all, tab)}<div class="tab-body">${['sales', 'profit', 'customers'].includes(tab) ? rangePicker() : ''}${body}</div>`);
  bindTabs();
}
function bucket(lines, keyFn, labelFn) {
  const g = S.groupLines(lines, keyFn, labelFn);
  return g.sort((x, y) => String(x.key).localeCompare(String(y.key)));
}
const weekKey = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x); };
function reportSales(r) {
  const L = S.salesLines(r.from, r.to);
  const localDay = d => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const daily = bucket(L, l => localDay(l.date), k => fmtDate(k));
  const weekly = bucket(L, l => weekKey(l.date), k => `Week of ${fmtDate(k)}`);
  const monthly = bucket(L, l => localDay(l.date).slice(0, 7), k => new Date(`${k}-01T12:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }));
  const simple = [{ label: 'Period', render: g => esc(g.label) }, { label: 'Orders', cls: 'num', render: g => int(g.orders) }, { label: 'Units', cls: 'num', render: g => int(g.qty) }, { label: 'Revenue', cls: 'num', render: g => money(g.revenue) }];
  const grp = (title, rows, label = 'Name', href) => panel(title, table([{ label, render: g => `<strong>${esc(g.label)}</strong>` }, ...simple.slice(1)], rows, { href, empty: 'No sales in this period.' }));
  return `
    ${panel('Daily sales', barChart(daily.map(g => ({ label: g.label.split(' ').slice(0, 2).join(' '), value: g.revenue })), { height: 150, labelEvery: Math.max(1, Math.ceil(daily.length / 12)) }))}
    <div class="grid-2">${panel('Weekly', table(simple, weekly.slice().reverse()))}${panel('Monthly', table(simple, monthly.slice().reverse()))}</div>
    <div class="grid-2">
      ${grp('By customer', S.groupLines(L, l => l.customerId, k => custName(k)), 'Customer', g => `customers/${g.key}`)}
      ${grp('By product', S.groupLines(L, l => l.productId || 'custom', productLabel), 'Product')}
      ${grp('By category', S.groupLines(L, l => S.get('products', l.productId)?.category || 'Custom', k => k), 'Category')}
      ${grp('By salesperson', S.groupLines(L, l => l.salesperson, k => userName(k)), 'Salesperson')}
    </div>`;
}
function reportProfit(r) {
  const m = S.summary(r.from, r.to);
  const cols = label => [{ label, render: g => `<strong>${esc(g.label)}</strong>` }, ...moneyCols()];
  return `
    <div class="stat-row">${stat('Gross profit', money(m.grossProfit))}${stat('Gross margin', pct(m.margin))}${stat('Operating expenses', money(m.expenses))}${stat('Net profit', money(m.netProfit))}</div>
    ${panel('Profit by business type', table(cols('Business type'), S.BUSINESS_TYPES.map(k => ({ label: k, ...m.byType[k], margin: m.byType[k].revenue ? m.byType[k].profit / m.byType[k].revenue : 0 }))))}
    <div class="grid-2">
      ${panel('Profit by product', table(cols('Product'), S.groupLines(m.lines, l => l.productId || 'custom', productLabel), { empty: 'No sales in this period.' }))}
      ${panel('Profit by customer', table(cols('Customer'), S.groupLines(m.lines, l => l.customerId, k => custName(k)), { href: g => `customers/${g.key}`, empty: 'No sales in this period.' }))}
    </div>`;
}
function reportInventory() {
  const rep = S.inventoryReport();
  const low = S.lowStockItems();
  const row = [{ label: 'SKU', render: x => `<strong>${esc(x.variant.sku)}</strong>` }, { label: 'Product', render: x => `${esc(x.product.name)}<br><small class="muted">${esc(S.variantLabel(x.variant))}</small>` }];
  return `
    <div class="stat-row">${stat('Units on hand', int(rep.units))}${stat('Stock value', money(rep.value), 'At current cost')}${stat('Low stock', int(low.length), '', 'low-stock')}${stat('Dead stock', int(rep.dead.length), 'No sale in 60 days')}</div>
    <div class="grid-2">
      ${panel('Fast-moving (last 30 days)', table([...row, { label: 'Sold', cls: 'num', render: x => int(x.sold30) }, { label: 'Available', cls: 'num', render: x => int(x.available) }], rep.fast, { empty: 'No sales in the last 30 days.' }))}
      ${panel('Slow-moving (last 30 days)', table([...row, { label: 'Sold', cls: 'num', render: x => int(x.sold30) }, { label: 'On hand', cls: 'num', render: x => int(x.qty) }], rep.slow, { empty: 'Nothing to show.' }))}
    </div>
    ${panel('Dead stock', table([...row, { label: 'On hand', cls: 'num', render: x => int(x.qty) }, { label: 'Value', cls: 'num', render: x => money(x.value) }, { label: 'Last sale', render: x => x.lastSale ? fmtDate(x.lastSale) : 'Never' }], rep.dead.sort((x, y) => y.value - x.value), { empty: 'No dead stock.' }))}
    ${panel('Current stock', table([...row, { label: 'Physical', cls: 'num', render: x => int(x.qty) }, { label: 'Reserved', cls: 'num', render: x => int(x.reserved) }, { label: 'Available', cls: 'num', render: x => int(x.available) }, { label: 'Value', cls: 'num', render: x => money(x.value) }], rep.rows.filter(x => x.qty || x.reserved), { foot: ['Total', '', int(rep.units), '', '', money(rep.value)] }), linkBtn('Open stock', 'stock', 'ghost sm'))}`;
}
function reportCustomers(r) {
  const rep = S.customersReport(r.from, r.to);
  const cols = [{ label: 'Customer', render: x => `<strong>${esc(S.customerName(x.customer))}</strong><br><small class="muted">${esc(x.customer.type)}</small>` }, { label: 'Orders', cls: 'num', render: x => int(x.orders) }, { label: 'Lifetime revenue', cls: 'num', render: x => money(x.revenue) }, { label: 'Outstanding', cls: 'num', render: x => money(x.outstanding) }];
  return `
    <div class="stat-row">${stat('Customers', int(rep.rows.length))}${stat('New in period', int(rep.newCustomers.length))}${stat('Repeat customers', int(rep.repeat.length), rep.rows.length ? `${pct(rep.repeat.length / rep.rows.length)} of all` : '')}</div>
    <div class="grid-2">
      ${panel('Top customers', table(cols, rep.top, { href: x => `customers/${x.customer.id}` }))}
      ${panel('New customers in period', table([{ label: 'Customer', render: c => `<strong>${esc(S.customerName(c))}</strong>` }, { label: 'Type', render: c => esc(c.type) }, { label: 'Source', render: c => esc(c.source) }, { label: 'Added', render: c => fmtDate(c.createdAt) }], rep.newCustomers, { href: c => `customers/${c.id}`, empty: 'No new customers in this period.' }))}
    </div>
    ${panel('Customer lifetime revenue', table(cols, [...rep.rows].sort((x, y) => y.revenue - x.revenue), { href: x => `customers/${x.customer.id}` }))}`;
}
function reportOperations() {
  const rep = S.operationsReport();
  const oc = [{ label: 'Order', render: o => `<strong>${esc(o.number)}</strong><br><small class="muted">${esc(custName(o.customerId))}</small>` }, { label: 'Production', render: o => badge(o.productionStatus) }, { label: 'Delivery', render: o => badge(o.deliveryStatus) }, { label: 'Expected', render: o => fmtDate(o.expectedAt) }];
  return `
    <div class="stat-row">${stat('In production', int(rep.inProduction.length))}${stat('Average production time', rep.avgProductionDays != null ? `${rep.avgProductionDays.toFixed(1)} days` : '—')}${stat('Delayed', int(rep.delayed.length))}${stat('Completed', int(rep.completed.length))}</div>
    <div class="grid-2">
      ${panel('Delayed orders', table(oc, rep.delayed, { href: o => `orders/${o.id}`, empty: 'No delayed orders.' }))}
      ${panel('In production', table(oc, rep.inProduction, { href: o => `orders/${o.id}`, empty: 'Nothing in production.' }))}
    </div>
    ${panel('Completed orders', table([...oc.slice(0, 1), { label: 'Completed', render: o => fmtDate(o.completedAt) }, { label: 'Total', cls: 'num', render: o => money(S.orderTotals(o).total) }], [...rep.completed].sort((x, y) => (y.completedAt || '').localeCompare(x.completedAt || '')), { href: o => `orders/${o.id}` }))}`;
}

// ============ CUSTOMER PORTAL (admin view) ============
export function viewPortalAdmin() {
  const base = baseUrl();
  const withAccess = db().customers.filter(c => c.portal);
  const requests = db().leads.filter(l => ['Website form', 'Portal'].includes(l.source)).slice(-8).reverse();
  render(`
    ${pageHead('Customer portal', 'What customers see: their own orders, quotes, invoices, payments, product library and the wholesale catalogue.')}
    <div class="grid-2">
      ${panel('Customer-facing pages', `<ul class="link-list">
        <li><div><strong>Customer portal</strong><p class="muted small">Login for customers with portal access.</p></div><div class="btn-row"><a class="btn sm" href="portal.html" target="_blank" rel="noopener">Open</a>${btn('Copy link', 'copy', 'sm ghost', `data-url="${esc(base)}portal.html"`)}</div></li>
        <li><div><strong>Quote request form</strong><p class="muted small">Public — no login. Submissions arrive as leads.</p></div><div class="btn-row"><a class="btn sm" href="quote-request.html" target="_blank" rel="noopener">Open</a>${btn('Copy link', 'copy', 'sm ghost', `data-url="${esc(base)}quote-request.html"`)}</div></li>
        <li><div><strong>Order tracking</strong><p class="muted small">Each order has its own secure link. Open an order to copy, send or regenerate it.</p></div>${linkBtn('Orders', 'orders', 'sm ghost')}</li>
      </ul>
      ${CLOUD ? '<p class="callout info small">Connected to Supabase — customer links work on any phone or computer.</p>' : '<p class="callout warn small">Local mode: data is stored in this browser, so customer links only open here. Connect Supabase (Settings → Cloud) to send links to customers.</p>'}`)}
      ${panel('Customers with portal access', table([
        { label: 'Customer', render: c => `<strong>${esc(S.customerName(c))}</strong>` }, { label: 'Login', render: c => esc(c.portal.email) }, { label: 'Since', render: c => fmtDate(c.portal.enabledAt) },
      ], withAccess, { href: c => `customers/${c.id}`, empty: 'No customer has portal access yet. Enable it from a customer profile.' }))}
    </div>
    <div class="grid-2">
      ${panel('Recent online requests', table([
        { label: 'Request', render: l => `<strong>${esc(l.number)}</strong><br><small class="muted">${esc(l.source)}</small>` }, { label: 'From', render: l => esc(l.company || l.name) }, { label: 'Stage', render: l => badge(l.lost ? 'Lost' : l.stage) }, { label: 'Received', render: l => fmtDate(l.createdAt) },
      ], requests, { href: l => `leads/${l.id}`, empty: 'No online requests yet.' }))}
      ${panel('Recent reorder requests', table([
        { label: 'Reorder', render: x => `<strong>${esc(x.number)}</strong><br><small class="muted">${esc(x.source)}</small>` }, { label: 'Customer', render: x => esc(custName(x.customerId)) }, { label: 'Status', render: x => badge(x.status) },
      ], db().reorders.slice(0, 8), { href: () => 'reorders', empty: 'No reorders yet.' }))}
    </div>`,
  { copy: async el => { await copyText(el.dataset.url); toast('Link copied'); } });
}

// ============ NOTIFICATIONS ============
export function viewNotifications() {
  const list = db().notifications.filter(n => n.audience === 'staff');
  render(`
    ${pageHead('Notifications', 'In-app alerts for the team. Customer emails are queued in Settings → Notifications until a mail service is connected.', list.some(n => !n.read) ? btn('Mark all as read', 'read', 'ghost') : '')}
    ${list.length ? `<ul class="notif-list">${list.slice(0, 200).map(n => `<li class="${n.read ? '' : 'unread'}">${n.link ? `<a href="${esc(n.link)}">${esc(n.text)}</a>` : `<span>${esc(n.text)}</span>`}<small>${esc(n.event)} · ${fmtDateTime(n.at)}</small></li>`).join('')}</ul>` : '<div class="empty">No notifications yet.</div>'}`,
  { read: () => { S.markNotificationsRead('staff'); rerender(); } });
}

// ============ AUDIT LOG ============
export function viewAudit() {
  const q = app.query;
  let list = db().audit;
  if (q.entity) list = list.filter(x => x.entity === q.entity);
  if (q.user) list = list.filter(x => x.userId === q.user);
  render(`
    ${pageHead('Audit log', 'Who changed what, and when. Entries cannot be edited or deleted from the app.')}
    ${filters([{ key: 'entity', label: 'Record', options: [...new Set(db().audit.map(x => x.entity))].sort() }, { key: 'user', label: 'User', options: db().users.map(u => ({ value: u.id, label: u.name })) }], 'Search actions, references, details')}
    ${table([
      { label: 'When', render: x => fmtDateTime(x.at) },
      { label: 'Who', render: x => `<strong>${esc(x.userName)}</strong>` },
      { label: 'Action', render: x => esc(x.action) },
      { label: 'Record', render: x => `${esc(x.entity)}<br><small class="muted">${esc(x.ref)}</small>` },
      { label: 'Detail', render: x => `<small>${esc(x.detail)}</small>` },
    ], list.slice(0, 500), { empty: 'Nothing logged yet.' })}`);
}

// ============ SETTINGS & USERS ============
const userFields = isNew => [
  { name: 'name', label: 'Full name', required: true }, { name: 'email', label: 'Email', type: 'email', required: true },
  { name: 'role', label: 'Role', type: 'select', options: Object.entries(S.ROLES).map(([value, label]) => ({ value, label })) },
  ...(isNew || !CLOUD ? [{ name: 'password', label: isNew ? (CLOUD ? 'Temporary password (min 8 characters)' : 'Password (min 8 characters)') : 'New password (leave empty to keep)', type: 'text', required: isNew }] : []),
  ...(isNew ? [] : [{ name: 'active', label: 'Account active', type: 'checkbox' }]),
];
export function viewSettings() {
  const t = ['company', 'users', 'notifications', 'cloud', 'data'].includes(app.query.tab) ? app.query.tab : 'company';
  const s = db().settings;
  const perms = Object.entries(S.PERMISSIONS);
  const bodies = {
    company: () => panel('Company details', `<form id="setform" class="form-grid">
      ${[['company', 'Trading name'], ['legalName', 'Legal name'], ['address', 'Address'], ['email', 'Email'], ['phone', 'Phone'], ['whatsapp', 'WhatsApp number (digits, with country code, e.g. 94771234567)'], ['defaultPaymentTerms', 'Default payment terms'], ['invoiceDueDays', 'Invoice due after (days)'], ['quoteValidityDays', 'Quotes valid for (days)'], ['bankDetails', 'Bank details (printed on invoices)'], ['invoiceNote', 'Invoice footer note']]
        .map(([k, l]) => `<div class="field ${['address', 'defaultPaymentTerms', 'bankDetails', 'invoiceNote'].includes(k) ? 'full' : ''}"><label for="s_${k}">${l}</label>${k === 'bankDetails' ? `<textarea id="s_${k}" name="${k}" rows="3" placeholder="Bank, branch, account name, account number">${esc(s[k])}</textarea>` : `<input id="s_${k}" name="${k}" value="${esc(s[k])}" ${k.endsWith('Days') ? 'type="number" min="1"' : ''}>`}</div>`).join('')}
      <div class="full">${btn('Save settings', 'saveSettings', 'primary')}</div></form>`),
    users: () => panel('Team members', table([
      { label: 'Name', render: u => `<strong>${esc(u.name)}</strong>` }, { label: 'Email', render: u => esc(u.email) }, { label: 'Role', render: u => esc(S.ROLES[u.role]) },
      { label: 'Status', render: u => badge(u.active !== false ? 'Active' : 'Inactive') }, { label: '', render: u => `<button type="button" class="link-btn" data-action="editUser" data-id="${u.id}">Edit</button>` },
    ], db().users), btn('Add user', 'addUser', 'primary sm')) + panel('What each role can do', `<div class="table-wrap"><table><thead><tr><th>Role</th><th>Permissions</th></tr></thead><tbody>${perms.map(([r, p]) => `<tr><td><strong>${esc(S.ROLES[r])}</strong></td><td><small>${p.includes('*') ? 'Everything, including users, settings and the audit log' : esc(p.join(', '))}</small></td></tr>`).join('')}</tbody></table></div><p class="muted small">Users are deactivated rather than deleted, so their history stays in the audit log.</p>`),
    notifications: () => panel('Channels', `<ul class="link-list">
        <li><div><strong>In-app</strong><p class="muted small">Staff alerts in the bell menu; customer alerts in the portal.</p></div>${badge('Active')}</li>
        <li><div><strong>Email</strong><p class="muted small">Messages are queued in the outbox below. Connect a mail service in the backend to send them.</p></div>${badge('Queued', 'warn')}</li>
        <li><div><strong>WhatsApp</strong><p class="muted small">Add a channel in <code>NOTIFICATION_CHANNELS</code> (services.js) once the WhatsApp Business API is connected. Staff can already send tracking links with one click.</p></div>${badge('Not connected', 'neutral')}</li></ul>`)
      + panel('Email outbox', table([{ label: 'Queued', render: m => fmtDateTime(m.at) }, { label: 'To', render: m => esc(m.to) }, { label: 'Subject', render: m => esc(m.subject) }, { label: 'Status', render: m => `<small class="muted">${esc(m.status)}</small>` }], db().outbox.slice(0, 100), { empty: 'Outbox is empty.' })),
    cloud: () => panel('Cloud (Supabase)', CLOUD
      ? `<p>${badge('Connected', 'good')} <span class="muted small">${esc(SUPABASE_URL)}</span></p><p>Data is saved to Supabase as you work and changes from colleagues appear live. Customer links, the quote request form and the customer portal work from any device.</p><p class="muted small">Signed in as ${esc(app.user.email)}.</p><div class="btn-row">${btn('Change my password', 'mypw', 'ghost')}</div>`
      : `<p>${badge('Local mode', 'warn')}</p><p>Data is stored in this browser only. To use Seamline on several computers and send links customers can open anywhere, connect Supabase:</p>
        <ol class="howto"><li>Create a free project at <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>.</li><li>In the SQL editor, run the file <code>supabase/schema.sql</code> from this folder.</li><li>Copy the project URL and the anon public key (Project settings → API) into <code>js/config.js</code>.</li><li>Reload. The first person to sign up becomes the admin.</li></ol>
        <p class="muted small">Want to keep what you entered locally? Export a backup below first, then import it after connecting.</p>`),
    data: () => panel('Backup & data', `<p>${CLOUD ? 'Your data lives in Supabase. Export a JSON backup regularly for your own records.' : `All data lives in this browser (about ${int(new Blob([localStorage.getItem('seamline.db.v2') || '']).size / 1024)} KB). Export regularly.`}</p>
      <div class="btn-row">${btn('Export backup (JSON)', 'export')}<label class="btn ghost">Import backup<input type="file" accept="application/json" id="importFile" hidden></label>${CLOUD ? '' : btn('Erase everything', 'reset', 'ghost danger-text')}</div>
      ${CLOUD ? '<p class="muted small">Importing replaces the data in Supabase for everyone.</p>' : ''}`),
  };
  render(`${pageHead('Settings', 'Company details, team access, notifications and data.', a('Audit log', 'audit'))}${tabs([['company', 'Company'], ['users', 'Users & roles'], ['notifications', 'Notifications'], ['cloud', 'Cloud'], ['data', 'Data']], t)}<div class="tab-body">${bodies[t]()}</div>`,
  {
    saveSettings: () => { const f = Object.fromEntries(new FormData($('#setform'))); S.saveSettings(f); toast('Settings saved'); rerender(); },
    addUser: () => formModal({ title: 'Add user', intro: CLOUD ? 'Creates their Seamline login. Share the email and temporary password with them.' : '', fields: userFields(true), values: { role: 'sales' }, onSubmit: async v => {
      if (CLOUD) {
        if ((v.password || '').length < 8) throw new Error('Passwords need at least 8 characters.');
        if (db().users.some(u => u.email === String(v.email).trim().toLowerCase())) throw new Error('Another user already uses that email.');
        const r = await Cloud.createLogin(v.email, v.password);
        await Cloud.setStaff(v.email, v.role, true);
        await S.saveUser({ ...v, external: true });
        toast(r.existed ? 'User added — this email already had a login, so their existing password applies' : r.needsConfirm ? 'User added — they must confirm their email before signing in' : 'User added');
      } else { await S.saveUser(v); toast('User added'); }
      rerender();
    } }),
    editUser: el => { const u = S.get('users', el.dataset.id); formModal({ title: `Edit ${u.name}`, fields: userFields(false), values: { ...u, active: u.active !== false, password: '' }, onSubmit: async v => { if (u.id === app.user.id && (!v.active || v.role !== 'admin')) throw new Error('You cannot remove your own admin access.'); if (CLOUD) { if (String(v.email).trim().toLowerCase() !== u.email) throw new Error('To change a login email, add a new user and deactivate this one.'); await Cloud.setStaff(u.email, v.role, !!v.active); await S.saveUser({ ...v, id: u.id, password: '', external: true }); } else await S.saveUser({ ...v, id: u.id }); toast('User updated'); rerender(); } }); },
    mypw: () => formModal({ title: 'Change my password', fields: [{ name: 'password', label: 'New password (min 8 characters)', type: 'password', required: true }], onSubmit: async v => { if (v.password.length < 8) throw new Error('Passwords need at least 8 characters.'); await Cloud.updatePassword(v.password); toast('Password changed'); } }),
    export: () => downloadText(`seamline-backup-${today()}.json`, exportJson()),
    reset: async () => { if (await confirmBox('Every order, customer, product and setting in this browser is deleted and Seamline starts fresh. Export a backup first if you need it.', { title: 'Erase everything?', input: 'Type ERASE to confirm', confirmLabel: 'Erase', danger: true }) === 'ERASE') { wipe(); sessionStorage.clear(); location.reload(); } },
  });
  bindTabs();
  $('#importFile')?.addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { importJson(await f.text()); toast('Backup imported'); setTimeout(() => location.reload(), CLOUD ? 2500 : 600); }
    catch (ex) { toast(ex.message, 'error'); }
  });
}
