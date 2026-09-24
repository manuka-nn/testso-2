import * as S from './services.js';
import { db } from './db.js';
import { esc, money, pct, int, fmtDate, fmtDateTime, badge, table, formModal, confirmBox, fieldHtml, readForm, toast, readImage, today, productThumb } from './ui.js';
import { app, $, $$, render, rerender, can, go, pageHead, btn, linkBtn, a, panel, kv, stat, filters, tabs, custName, warehouseOptions, notFound } from './core.js';
import { bindTabs } from './views-sales.js';
import { catalogueCard } from './shared.js';
import { catalogueProducts } from './publisher.js';

const variantOptions = (filter = () => true) => db().variants.filter(v => v.active !== false && filter(v)).map(v => { const p = S.get('products', v.productId); return p ? { value: v.id, label: `${v.sku} — ${p.name}, ${S.variantLabel(v)}` } : null; }).filter(Boolean).sort((x, y) => x.label.localeCompare(y.label));
const supplierOptions = () => db().suppliers.filter(s => s.active !== false).map(s => ({ value: s.id, label: s.company }));
const stockBadge = (available, level) => available <= 0 ? badge('Out of stock') : available <= level ? badge('Low stock') : badge('In stock', 'good');
const lateOrder = o => o.expectedAt && o.expectedAt < today() && o.state === 'Confirmed' && o.deliveryStatus !== 'Delivered';

// ============ PRODUCTS ============
export function viewProducts() {
  const q = app.query;
  let list = [...db().products].sort((x, y) => x.name.localeCompare(y.name));
  if (q.category) list = list.filter(p => p.category === q.category);
  if (q.kind) list = list.filter(p => p.kind === q.kind);
  list = list.filter(p => (q.status || 'Active') === 'all' || p.status === (q.status || 'Active'));
  render(`
    ${pageHead('Product library', 'Every product Seamline sells — ready stock, made to order, or both.', can('products.edit') ? linkBtn('New product', 'products/new', 'primary') : '')}
    ${filters([
      { key: 'category', label: 'Category', options: db().categories },
      { key: 'kind', label: 'Product type', options: S.PRODUCT_KINDS },
      { key: 'status', label: 'Status', options: [{ value: 'Inactive', label: 'Inactive' }, { value: 'Archived', label: 'Archived' }, { value: 'all', label: 'Any status' }] },
    ], 'Search products or SKUs')}
    ${table([
      { label: '', render: p => productThumb(p, 40) },
      { label: 'Product', render: p => `<strong>${esc(p.name)}</strong><br><small class="muted">${esc(p.sku)}</small>` },
      { label: 'Category', render: p => esc(p.category) },
      { label: 'Type', render: p => esc(p.kind) },
      { label: 'Wholesale', cls: 'num', render: p => money(p.wholesalePrice) },
      { label: 'MOQ', cls: 'num', render: p => int(p.moq) },
      { label: 'Physical', cls: 'num', render: p => p.kind === 'Made to order' ? '—' : int(S.productStock(p.id).qty) },
      { label: 'Reserved', cls: 'num', render: p => p.kind === 'Made to order' ? '—' : int(S.productStock(p.id).reserved) },
      { label: 'Available', cls: 'num', render: p => p.kind === 'Made to order' ? '—' : `<strong>${int(S.productStock(p.id).available)}</strong>` },
      { label: 'Status', render: p => badge(p.status) },
    ], list, { href: p => `products/${p.id}`, empty: 'No products match these filters.' })}`);
}

export function viewProduct({ id }) {
  const p = S.get('products', id);
  if (!p) return notFound('product');
  const vs = db().variants.filter(v => v.productId === p.id);
  const whs = S.activeWarehouses();
  const st = S.productStock(p.id);
  const prices = S.supplierPriceHistory(p.id);
  const moves = db().movements.filter(m => vs.some(v => v.id === m.variantId)).slice(0, 15);
  const sold = S.groupLines(S.salesLines(null, null).filter(l => l.productId === p.id), () => p.id)[0];
  const seeCost = can('orders.costs') || can('profit') || can('inventory');
  render(`
    ${pageHead(p.name, `${esc(p.sku)} · ${esc(p.category)} · ${esc(p.kind)} ${badge(p.status)}`, [
      can('orders.create') ? linkBtn('Create order', `orders/new?product=${p.id}`, 'ghost') : '',
      can('purchasing') ? btn('Record supplier price', 'price', 'ghost') : '',
      can('products.edit') ? linkBtn('Edit', `products/${p.id}/edit`, 'primary') : '',
    ].join(''))}
    <div class="stat-row">
      ${p.kind !== 'Made to order' ? stat('Physical stock', int(st.qty)) + stat('Reserved', int(st.reserved), 'For confirmed orders') + stat('Available', int(st.available), 'Physical − reserved') + (st.damaged ? stat('Damaged', int(st.damaged), 'Held separately') : '') : ''}
      ${stat('Units sold', int(sold?.qty || 0), sold ? `${sold.orders} orders` : 'No sales yet')}
      ${can('profit') && sold ? stat('Gross profit', money(sold.profit), `${pct(sold.margin)} margin`) : ''}
    </div>
    <div class="grid-2-1">
      <div>
        ${vs.length ? panel('Variants & stock', table([
          { label: 'Variant', render: v => `<strong>${esc(S.variantLabel(v))}</strong>${v.active === false ? ' ' + badge('Inactive') : ''}<br><small class="muted">${esc(v.sku)}</small>` },
          ...(seeCost ? [{ label: 'Cost', cls: 'num', render: v => money(v.cost) }] : []),
          ...whs.map(w => ({ label: w.name, cls: 'num', render: v => { const s = S.variantStock(v.id, w.id); return `${int(s.available)}${s.reserved ? `<br><small class="muted">${int(s.reserved)} reserved</small>` : ''}`; } })),
          { label: 'Reorder at', cls: 'num', render: v => int(v.reorderLevel) },
          { label: 'Status', render: v => { const s = S.variantStock(v.id); return stockBadge(s.available, v.reorderLevel); } },
          { label: '', render: v => `<a class="link-btn" href="#/movements?variant=${v.id}">Ledger</a>${can('inventory.edit') ? ` · <button type="button" class="link-btn" data-action="adjust" data-id="${v.id}">Adjust</button>` : ''}` },
        ], vs)) : panel('Made to order', '<p class="muted">This product is manufactured for each order, so finished goods are not stocked. Production is tracked on each order.</p>')}
        ${panel('Recent stock movements', table([
          { label: 'When', render: m => fmtDateTime(m.at) },
          { label: 'SKU', render: m => esc(S.get('variants', m.variantId)?.sku) },
          { label: 'Type', render: m => esc(m.type) },
          { label: 'Qty', cls: 'num', render: m => qtyDelta(m) },
          { label: 'Balance', cls: 'num', render: m => int(m.balance) },
          { label: 'Ref', render: m => esc(m.ref) },
        ], moves, { empty: 'No stock movements yet.' }), vs.length ? a('Full ledger', `movements?product=${p.id}`) : '')}
      </div>
      <div>
        ${panel('Details', `${p.image ? `<img class="product-hero" src="${p.image}" alt="${esc(p.name)}">` : ''}${kv([
          ['Description', esc(p.description)], ['Material', esc(p.material)], ['Manufacturing method', esc(p.method)],
          ['Supplier', p.supplierId ? a(S.get('suppliers', p.supplierId)?.company || '—', `suppliers/${p.supplierId}`) : ''], ['Supplier SKU', esc(p.supplierSku)],
          ['MOQ', `${int(p.moq)} units`], ['Wholesale price', money(p.wholesalePrice)], ['Retail / reference price', p.retailPrice ? money(p.retailPrice) : ''],
          ['Sizes', esc([...new Set(vs.map(v => v.size))].join(', '))], ['Colours', esc([...new Set(vs.map(v => v.color))].join(', '))],
        ])}`)}
        ${seeCost ? panel('Supplier price history', table([
          { label: 'Supplier', render: r => esc(S.get('suppliers', r.supplierId)?.company) },
          { label: 'Price', cls: 'num', render: r => money(r.price) },
          { label: 'Date', render: r => `${fmtDate(r.at)}<br><small class="muted">${esc(r.note)}</small>` },
        ], prices, { empty: 'No supplier prices recorded.' })) : ''}
        ${can('products.edit') ? `<p>${p.status !== 'Archived' ? btn('Archive product', 'archive', 'ghost sm danger-text') : btn('Restore product', 'restore', 'ghost sm')}</p>` : ''}
      </div>
    </div>`,
  {
    adjust: el => adjustModal(el.dataset.id),
    price: () => formModal({ title: 'Record supplier price', intro: 'Prices are kept as history — nothing is overwritten.', fields: [
      { name: 'supplierId', label: 'Supplier', type: 'select', options: supplierOptions(), required: true },
      { name: 'price', label: 'Unit price (Rs.)', type: 'number', min: 0, required: true },
      { name: 'note', label: 'Note', placeholder: 'Quote, MOQ 500' }], values: { supplierId: p.supplierId },
      onSubmit: v => { S.addSupplierPrice({ ...v, productId: p.id }); toast('Price recorded'); rerender(); } }),
    archive: async () => { if (await confirmBox('Archived products are hidden from new orders and the catalogue. History is kept.', { title: 'Archive product?', confirmLabel: 'Archive', danger: true })) { S.setProductStatus(p.id, 'Archived'); rerender(); } },
    restore: () => { S.setProductStatus(p.id, 'Active'); rerender(); },
  });
}
const qtyDelta = m => {
  const parts = [];
  if (m.qty) parts.push(`<span class="${m.qty < 0 ? 'bad-text' : 'good-text'}">${m.qty > 0 ? '+' : ''}${int(m.qty)}</span>`);
  if (m.reserved) parts.push(`<small class="muted">${m.reserved > 0 ? '+' : ''}${int(m.reserved)} reserved</small>`);
  return parts.join('<br>') || '<span class="muted">0</span>';
};

export function viewProductEditor({ id }) {
  const p = id ? S.get('products', id) : null;
  if (id && !p) return notFound('product');
  if (!can('products.edit')) { toast('Your role cannot edit products.', 'error'); return go('products'); }
  const vs = p ? db().variants.filter(v => v.productId === p.id) : [];
  const val = p || { kind: 'Ready stock', status: 'Active', category: db().categories[0], moq: 20 };
  render(`
    ${pageHead(p ? `Edit ${p.name}` : 'New product', p ? esc(p.sku) : 'Add the product once — quotes, orders, inventory and the catalogue all use it.')}
    <form id="pform" class="doc-form" novalidate>
      ${panel('Product', `<div class="form-grid">
        ${!p ? fieldHtml({ name: 'sku', label: 'SKU', placeholder: 'Leave empty to generate', hint: 'Variant SKUs are built from this' }) : ''}
        ${fieldHtml({ name: 'name', label: 'Product name', required: true }, val.name)}
        ${fieldHtml({ name: 'category', label: 'Category', type: 'select', options: db().categories }, val.category)}
        ${fieldHtml({ name: 'kind', label: 'Product type', type: 'select', options: S.PRODUCT_KINDS, hint: 'Ready stock is sold from inventory. Made to order is produced per order.' }, val.kind)}
        ${fieldHtml({ name: 'status', label: 'Status', type: 'select', options: ['Active', 'Inactive', 'Archived'] }, val.status)}
        ${fieldHtml({ name: 'description', label: 'Description', type: 'textarea', full: true }, val.description)}
        ${fieldHtml({ name: 'material', label: 'Material' }, val.material)}
        ${fieldHtml({ name: 'method', label: 'Manufacturing method' }, val.method)}
        ${fieldHtml({ name: 'supplierId', label: 'Main supplier', type: 'select', blank: 'None', options: supplierOptions() }, val.supplierId)}
        ${fieldHtml({ name: 'supplierSku', label: 'Supplier SKU' }, val.supplierSku)}
        ${fieldHtml({ name: 'moq', label: 'MOQ (units)', type: 'number', min: 0 }, val.moq)}
        ${fieldHtml({ name: 'wholesalePrice', label: 'Wholesale price (Rs.)', type: 'number', min: 0 }, val.wholesalePrice)}
        ${fieldHtml({ name: 'retailPrice', label: 'Retail / reference price (Rs.)', type: 'number', min: 0 }, val.retailPrice)}
        ${fieldHtml({ name: 'imageFile', label: 'Product image', type: 'file', accept: 'image/*', hint: 'Resized in the browser before saving' })}
        ${p?.image ? `<label class="check"><input type="checkbox" name="removeImage"> Remove current image</label>` : ''}
      </div>`)}
      ${vs.length ? panel('Existing variants', `<div class="table-wrap"><table><thead><tr><th>SKU</th><th>Colour / size</th><th>Cost per unit</th><th>Reorder level</th><th>Active</th></tr></thead><tbody>
        ${vs.map(v => `<tr><td>${esc(v.sku)}</td><td>${esc(S.variantLabel(v))}</td>
          <td><input type="number" min="0" step="any" name="cost_${v.id}" value="${v.cost}" aria-label="Cost for ${esc(v.sku)}" class="cell-input"></td>
          <td><input type="number" min="0" name="reorder_${v.id}" value="${v.reorderLevel}" aria-label="Reorder level for ${esc(v.sku)}" class="cell-input"></td>
          <td><input type="checkbox" name="active_${v.id}" ${v.active !== false ? 'checked' : ''} aria-label="Active"></td></tr>`).join('')}
        </tbody></table></div><p class="muted small">Costs update automatically (weighted average) when purchase orders are received. Manual changes are logged.</p>`) : ''}
      ${panel(vs.length ? 'Add variants' : 'Colours & sizes', `<p class="muted small">Every colour × size combination becomes a stock-keeping variant. Leave empty for made-to-order products.</p><div class="form-grid">
        ${fieldHtml({ name: 'colors', label: 'Colours', placeholder: 'Black, White, Navy' })}
        ${fieldHtml({ name: 'sizes', label: 'Sizes', placeholder: 'S, M, L, XL' })}
        ${fieldHtml({ name: 'newCost', label: 'Cost per unit (Rs.)', type: 'number', min: 0 })}
        ${fieldHtml({ name: 'newReorder', label: 'Reorder level', type: 'number', min: 0 })}
        <p class="full small" id="variantPreview"></p></div>`)}
      <div class="sticky-bar"><div></div><div class="bar-actions"><a class="btn ghost" href="#/${p ? `products/${p.id}` : 'products'}">Cancel</a><button type="button" class="btn primary" data-action="save">Save product</button></div></div>
    </form>`,
  {
    save: async () => {
      const v = readForm($('#pform'));
      const data = { ...v, id: p?.id, supplierId: v.supplierId || '' };
      if (v.imageFile) data.image = await readImage(v.imageFile, 700);
      else if (v.removeImage) data.image = '';
      else delete data.image;
      const rows = vs.map(x => ({ id: x.id, color: x.color, size: x.size, cost: v[`cost_${x.id}`], reorderLevel: v[`reorder_${x.id}`], active: !!v[`active_${x.id}`] }));
      rows.push(...newCombos(v, vs));
      const saved = S.saveProduct(data, rows);
      toast(p ? 'Product updated' : `Product ${saved.sku} created`);
      go(`products/${saved.id}`);
    },
  });
  const preview = () => {
    const n = newCombos(readForm($('#pform')), vs);
    $('#variantPreview').innerHTML = n.length ? `${n.length} new variant${n.length === 1 ? '' : 's'}: ${n.map(x => esc(`${x.color} / ${x.size}`)).join(', ')}` : '';
  };
  $('#pform').addEventListener('input', preview);
}
function newCombos(v, existing) {
  const split = s => String(s || '').split(',').map(x => x.trim()).filter(Boolean);
  const colors = split(v.colors), sizes = split(v.sizes);
  if (!colors.length || !sizes.length) return [];
  return colors.flatMap(c => sizes.map(s => ({ color: c, size: s, cost: v.newCost, reorderLevel: v.newReorder })))
    .filter(r => !existing.some(x => x.color.toLowerCase() === r.color.toLowerCase() && x.size.toLowerCase() === r.size.toLowerCase()));
}

// ============ WHOLESALE CATALOGUE ============
export function viewCatalogue() {
  const q = app.query;
  let list = catalogueProducts();
  if (q.category) list = list.filter(p => p.category === q.category);
  render(`
    ${pageHead('Wholesale catalogue', 'Ready-stock merchandise customers can buy directly. Customers see the same catalogue in their portal.', `<a class="btn ghost" href="portal.html" target="_blank" rel="noopener">Open customer portal</a>`)}
    ${filters([{ key: 'category', label: 'Category', options: [...new Set(db().products.filter(p => p.kind !== 'Made to order').map(p => p.category))] }])}
    <div class="cat-list">${list.map(p => catalogueCard(p, [
      can('orders.create') ? linkBtn('Create wholesale order', `orders/new?product=${p.id}`, 'primary sm') : '',
      can('quotes') ? linkBtn('Add to quote', `quotes/new?product=${p.id}`, 'ghost sm') : '',
      linkBtn('Product details', `products/${p.id}`, 'ghost sm'),
    ].join(''))).join('') || `<div class="empty big">No ready-stock products yet.${can('products.edit') ? ` <a href="#/products/new">Add a product</a> with colours and sizes, then receive stock with a purchase order.` : ''}</div>`}</div>`);
}

// ============ CATEGORIES ============
export function viewCategories() {
  const rows = db().categories.map(c => ({ name: c, products: db().products.filter(p => p.category === c && p.status !== 'Archived').length }));
  render(`
    ${pageHead('Categories', 'Used to group products in the library, catalogue and reports.', can('products.edit') ? btn('New category', 'add', 'primary') : '')}
    ${table([{ label: 'Category', render: r => `<strong>${esc(r.name)}</strong>` }, { label: 'Products', cls: 'num', render: r => int(r.products) }], rows, { href: r => `products?category=${encodeURIComponent(r.name)}` })}`,
  { add: () => formModal({ title: 'New category', fields: [{ name: 'name', label: 'Name', required: true }], onSubmit: v => { S.saveCategory(v.name); toast('Category added'); rerender(); } }) });
}

// ============ INVENTORY ============
export function adjustModal(variantId = '') {
  formModal({
    title: 'Record stock movement', intro: 'Every change is written to the inventory ledger with your name.',
    fields: [
      { name: 'variantId', label: 'Product variant', type: 'select', options: variantOptions(), required: true, full: true },
      { name: 'warehouseId', label: 'Warehouse', type: 'select', options: warehouseOptions() },
      { name: 'type', label: 'Movement type', type: 'select', options: S.MANUAL_MOVEMENTS },
      { name: 'qty', label: 'Quantity', type: 'number', min: 0, required: true, hint: 'For a stock adjustment, enter the counted quantity on hand.' },
      { name: 'ref', label: 'Reference', placeholder: 'Count sheet, RMA no.' },
      { name: 'note', label: 'Reason / note', type: 'textarea', full: true, rows: 2, required: true },
    ],
    values: { variantId, type: 'Stock adjustment' },
    onSubmit: v => { S.adjustStock(v); toast('Stock updated'); rerender(); },
  });
}
function transferModal() {
  formModal({
    title: 'Transfer stock', fields: [
      { name: 'variantId', label: 'Product variant', type: 'select', options: variantOptions(), required: true, full: true },
      { name: 'from', label: 'From', type: 'select', options: warehouseOptions() },
      { name: 'to', label: 'To', type: 'select', options: warehouseOptions() },
      { name: 'qty', label: 'Quantity', type: 'number', min: 1, required: true },
      { name: 'note', label: 'Note' },
    ], values: { to: S.activeWarehouses()[1]?.id },
    onSubmit: v => { S.transferStock(v); toast('Stock transferred'); rerender(); },
  });
}
export function viewStock() {
  const q = app.query;
  const wh = q.warehouse || '';
  let rows = db().variants.filter(v => v.active !== false).map(v => ({ v, p: S.get('products', v.productId), s: S.variantStock(v.id, wh || null) })).filter(r => r.p && r.p.status !== 'Archived');
  if (q.category) rows = rows.filter(r => r.p.category === q.category);
  if (q.level === 'low') rows = rows.filter(r => r.s.available <= r.v.reorderLevel);
  rows.sort((x, y) => x.v.sku.localeCompare(y.v.sku));
  const value = rows.reduce((t, r) => t + r.s.qty * r.v.cost, 0);
  const units = rows.reduce((t, r) => t + r.s.qty, 0);
  const seeCost = can('inventory') || can('profit');
  render(`
    ${pageHead('Stock', 'Available = physical − reserved. Quantities only change through ledger movements.', can('inventory.edit') ? btn('Transfer', 'transfer', 'ghost') + btn('Record movement', 'adjust', 'primary') : '')}
    <div class="stat-row">${stat('Units on hand', int(units))}${seeCost ? stat('Stock value', money(value), 'At current cost') : ''}${stat('Reserved', int(rows.reduce((t, r) => t + r.s.reserved, 0)), 'For confirmed orders')}${stat('Low or out', int(rows.filter(r => r.s.available <= r.v.reorderLevel).length), '', 'low-stock')}</div>
    ${filters([
      { key: 'warehouse', label: 'Warehouse', options: warehouseOptions() },
      { key: 'category', label: 'Category', options: db().categories },
      { key: 'level', label: 'Level', options: [{ value: 'low', label: 'Low or out of stock' }] },
    ], 'Search SKU, product, colour')}
    ${table([
      { label: 'SKU', render: r => `<strong>${esc(r.v.sku)}</strong>` },
      { label: 'Product', render: r => `${esc(r.p.name)}<br><small class="muted">${esc(r.v.color)} · ${esc(r.v.size)}</small>` },
      { label: 'Physical', cls: 'num', render: r => int(r.s.qty) },
      { label: 'Reserved', cls: 'num', render: r => int(r.s.reserved) },
      { label: 'Available', cls: 'num', render: r => `<strong>${int(r.s.available)}</strong>` },
      { label: 'Damaged', cls: 'num', render: r => r.s.damaged ? int(r.s.damaged) : '—' },
      { label: 'Reorder at', cls: 'num', render: r => int(r.v.reorderLevel) },
      ...(seeCost ? [{ label: 'Cost', cls: 'num', render: r => money(r.v.cost) }, { label: 'Value', cls: 'num', render: r => money(r.s.qty * r.v.cost) }] : []),
      { label: '', render: r => stockBadge(r.s.available, r.v.reorderLevel) },
    ], rows, { href: r => `movements?variant=${r.v.id}`, empty: 'No stock rows match.', foot: seeCost ? ['Total', '', int(units), '', '', '', '', '', money(value), ''] : null })}`,
  { adjust: () => adjustModal(), transfer: transferModal });
}

export function viewMovements() {
  const q = app.query;
  let list = db().movements;
  const v = q.variant && S.get('variants', q.variant);
  if (v) list = list.filter(m => m.variantId === v.id);
  if (q.product) list = list.filter(m => S.get('variants', m.variantId)?.productId === q.product);
  if (q.type) list = list.filter(m => m.type === q.type);
  if (q.warehouse) list = list.filter(m => m.warehouseId === q.warehouse);
  const types = [...new Set(db().movements.map(m => m.type))].sort();
  let ledger = '';
  if (v) {
    const chron = list.slice().reverse().filter(m => m.qty);
    const byType = {};
    chron.forEach(m => { byType[m.type] = (byType[m.type] || 0) + m.qty; });
    const s = S.variantStock(v.id);
    ledger = panel(`Ledger summary · ${v.sku}`, `<div class="ledger">${Object.entries(byType).map(([t, n]) => `<div><span>${esc(t)}</span><b class="${n < 0 ? 'bad-text' : ''}">${n > 0 ? '+' : ''}${int(n)}</b></div>`).join('')}<hr class="seam"><div class="total"><span>Current physical stock</span><b>${int(s.qty)}</b></div><div><span>Reserved for orders</span><b>${int(s.reserved)}</b></div><div class="total"><span>Available</span><b>${int(s.available)}</b></div></div>`);
  }
  render(`
    ${pageHead('Stock movements', v ? `${esc(v.sku)} — ${esc(S.get('products', v.productId)?.name)}, ${esc(S.variantLabel(v))}` : 'The inventory ledger. Every purchase, sale, reservation, return, adjustment and transfer.', v ? linkBtn('All movements', 'movements', 'ghost') : '')}
    ${ledger}
    ${filters([{ key: 'type', label: 'Type', options: types }, { key: 'warehouse', label: 'Warehouse', options: warehouseOptions() }], 'Search SKU, reference, note')}
    ${table([
      { label: 'When', render: m => fmtDateTime(m.at) },
      { label: 'SKU', render: m => `<strong>${esc(S.get('variants', m.variantId)?.sku)}</strong>` },
      { label: 'Type', render: m => esc(m.type) },
      { label: 'Change', cls: 'num', render: qtyDelta },
      { label: 'Balance', cls: 'num', render: m => `${int(m.balance)}${m.reservedBalance ? `<br><small class="muted">${int(m.reservedBalance)} reserved</small>` : ''}` },
      { label: 'Warehouse', render: m => esc(S.get('warehouses', m.warehouseId)?.name) },
      { label: 'Reference', render: m => esc(m.ref) },
      { label: 'By', render: m => esc(m.by) },
      { label: 'Note', render: m => `<small>${esc(m.note)}</small>` },
    ], list.slice(0, 400), { empty: 'No movements match.' })}
    ${list.length > 400 ? `<p class="muted small">Showing the latest 400 of ${int(list.length)} movements. Filter to narrow down.</p>` : ''}`);
}

export function viewLowStock() {
  const items = S.lowStockItems();
  render(`
    ${pageHead('Low stock', 'Variants at or below their reorder level. Suggested quantity brings stock back to about three times the reorder level, rounded up to MOQ.', can('purchasing') && items.length ? btn('Create purchase order for selected', 'po', 'primary') : '')}
    ${items.length ? `<div class="table-wrap"><table><thead><tr>${can('purchasing') ? '<th><input type="checkbox" id="allLow" aria-label="Select all" checked></th>' : ''}<th>Product</th><th>SKU</th><th class="num">Current stock</th><th class="num">Reserved</th><th class="num">Available</th><th class="num">Reorder level</th><th class="num">Suggested qty</th><th>Supplier</th></tr></thead><tbody>
      ${items.map(r => `<tr>${can('purchasing') ? `<td><input type="checkbox" class="pick" value="${r.variant.id}" data-qty="${r.suggested}" data-supplier="${r.product.supplierId || ''}" checked aria-label="Select ${esc(r.variant.sku)}"></td>` : ''}
        <td><a href="#/products/${r.product.id}">${esc(r.product.name)}</a><br><small class="muted">${esc(S.variantLabel(r.variant))}</small></td><td>${esc(r.variant.sku)}</td>
        <td class="num">${int(r.qty)}</td><td class="num">${int(r.reserved)}</td><td class="num"><strong class="bad-text">${int(r.available)}</strong></td><td class="num">${int(r.reorderLevel)}</td><td class="num"><strong>${int(r.suggested)}</strong></td>
        <td>${esc(S.get('suppliers', r.product.supplierId)?.company || '—')}</td></tr>`).join('')}
    </tbody></table></div>` : '<div class="empty big">Every active variant is above its reorder level.</div>'}`,
  {
    po: () => {
      const picks = $$('.pick:checked');
      if (!picks.length) return toast('Select at least one item.', 'error');
      const suppliers = [...new Set(picks.map(x => x.dataset.supplier))];
      if (suppliers.length > 1) toast('Items come from different suppliers — the PO uses the first supplier. Change it or split the PO.', 'error');
      go(`purchase-orders/new?supplier=${suppliers[0]}&lines=${picks.map(x => `${x.value}:${x.dataset.qty}`).join(',')}`);
    },
  });
  $('#allLow')?.addEventListener('change', e => $$('.pick').forEach(x => { x.checked = e.target.checked; }));
}

export function viewWarehouses() {
  const rows = db().warehouses.map(w => {
    const st = db().stock.filter(s => s.warehouseId === w.id);
    return { w, units: st.reduce((t, s) => t + s.qty, 0), value: st.reduce((t, s) => t + s.qty * (S.get('variants', s.variantId)?.cost || 0), 0) };
  });
  const edit = w => formModal({ title: w ? `Edit ${w.name}` : 'New warehouse', fields: [{ name: 'name', label: 'Name', required: true }, { name: 'city', label: 'City' }, ...(w ? [{ name: 'active', label: 'Active', type: 'checkbox' }] : [])], values: w || {},
    onSubmit: v => { S.saveWarehouse({ ...v, id: w?.id, active: w ? v.active : true }); toast('Warehouse saved'); rerender(); } });
  render(`
    ${pageHead('Warehouses', 'Stock is held per warehouse. Orders ship from one warehouse; transfers move stock between them.', can('inventory.edit') ? btn('New warehouse', 'add', 'primary') : '')}
    ${table([
      { label: 'Warehouse', render: r => `<strong>${esc(r.w.name)}</strong>` }, { label: 'City', render: r => esc(r.w.city) },
      { label: 'Units', cls: 'num', render: r => int(r.units) }, { label: 'Stock value', cls: 'num', render: r => money(r.value) },
      { label: 'Status', render: r => badge(r.w.active !== false ? 'Active' : 'Inactive') },
      { label: '', render: r => can('inventory.edit') ? `<button type="button" class="link-btn" data-action="edit" data-id="${r.w.id}">Edit</button>` : '' },
    ], rows)}`,
  { add: () => edit(null), edit: el => edit(S.get('warehouses', el.dataset.id)) });
}

// ============ MANUFACTURING ============
const makeOrders = () => db().orders.filter(o => o.state === 'Confirmed' && o.productionStatus !== 'Not Required');
const makeSummary = o => o.items.filter(i => i.fulfilment === 'make').map(i => `${int(i.qty)} × ${esc(S.lineDescription(i))}`).join('<br>');
function qcModal(o) {
  formModal({ title: `QC for ${o.number}`, fields: [
    { name: 'result', label: 'Result', type: 'select', options: ['Passed', 'Failed'] },
    { name: 'inspected', label: 'Units inspected', type: 'number', min: 1, required: true },
    { name: 'defects', label: 'Defects found', type: 'number', min: 0 },
    { name: 'notes', label: 'Notes', type: 'textarea', full: true }],
  values: { inspected: Math.min(50, o.items.reduce((t, i) => t + i.qty, 0)), defects: 0 },
  onSubmit: v => { S.recordQC(o.id, v); toast(v.result === 'Passed' ? 'QC passed — order is Ready' : 'QC failed — back in production'); rerender(); } });
}
export function viewProduction() {
  const list = makeOrders().filter(o => o.deliveryStatus === 'Not Dispatched');
  const canStatus = can('orders.status');
  render(`
    ${pageHead('Production orders', 'Made-to-order work for confirmed orders. Move cards forward as work progresses; customers see each step on their tracking page.')}
    <div class="board production">${S.PRODUCTION_FLOW.map((st, i) => {
      const col = list.filter(o => o.productionStatus === st).sort((x, y) => (x.expectedAt || '9').localeCompare(y.expectedAt || '9'));
      const next = S.PRODUCTION_FLOW[i + 1];
      return `<section class="board-col"><header><h2>${esc(st)}</h2><span class="count">${col.length}</span></header>
        ${col.map(o => `<article class="card-lead ${lateOrder(o) ? 'late' : ''}">
          <a href="#/orders/${o.id}"><strong>${esc(o.number)}</strong></a>
          <span class="small">${esc(custName(o.customerId))}</span>
          <p class="small muted">${makeSummary(o)}</p>
          <span class="small ${lateOrder(o) ? 'bad-text' : 'muted'}">${o.expectedAt ? `Due ${fmtDate(o.expectedAt)}${lateOrder(o) ? ' · late' : ''}` : 'No due date'}</span>
          ${canStatus ? (st === 'Quality Control' ? btn('Record QC', 'qc', 'sm primary', `data-id="${o.id}"`) : next && st !== 'Ready' ? btn(`Move to ${next}`, 'next', 'sm ghost', `data-id="${o.id}" data-next="${next}"`) : `<a class="btn sm ghost" href="#/orders/${o.id}">Pack & dispatch</a>`) : ''}
        </article>`).join('') || '<p class="board-empty">Nothing here</p>'}
      </section>`;
    }).join('')}</div>`,
  {
    next: el => { S.setProductionStatus(el.dataset.id, el.dataset.next); toast(`Moved to ${el.dataset.next}`); rerender(); },
    qc: el => qcModal(S.get('orders', el.dataset.id)),
  });
}
export function viewQC() {
  const pending = makeOrders().filter(o => o.productionStatus === 'Quality Control');
  const hist = db().qualityChecks;
  const passRate = hist.length ? hist.filter(h => h.result === 'Passed').length / hist.length : 0;
  render(`
    ${pageHead('Quality control', 'Passing QC marks an order Ready. A failed check sends it back into production.')}
    <div class="stat-row">${stat('Awaiting QC', int(pending.length))}${stat('Checks recorded', int(hist.length))}${stat('First-time pass rate', hist.length ? pct(passRate) : '—')}</div>
    ${panel('Awaiting inspection', table([
      { label: 'Order', render: o => `<strong>${esc(o.number)}</strong><br><small>${esc(custName(o.customerId))}</small>` },
      { label: 'Items', render: o => `<small>${makeSummary(o)}</small>` },
      { label: 'Due', render: o => fmtDate(o.expectedAt) },
      { label: '', render: o => can('orders.status') ? btn('Record QC', 'qc', 'sm primary', `data-id="${o.id}"`) : '' },
    ], pending, { empty: 'No orders are waiting for quality control.' }))}
    ${panel('Inspection history', table([
      { label: 'When', render: h => fmtDateTime(h.at) },
      { label: 'Order', render: h => esc(S.get('orders', h.orderId)?.number) },
      { label: 'Result', render: h => badge(h.result) },
      { label: 'Inspected', cls: 'num', render: h => int(h.inspected) },
      { label: 'Defects', cls: 'num', render: h => int(h.defects) },
      { label: 'By', render: h => esc(h.by) },
      { label: 'Notes', render: h => `<small>${esc(h.notes)}</small>` },
    ], hist, { href: h => `orders/${h.orderId}`, empty: 'No inspections recorded yet.' }))}`,
  { qc: el => qcModal(S.get('orders', el.dataset.id)) });
}
export function viewProductionTracking() {
  const r = S.operationsReport();
  const list = db().orders.filter(o => ['Confirmed', 'Completed'].includes(o.state) && o.productionStatus !== 'Not Required').sort((x, y) => (y.confirmedAt || '').localeCompare(x.confirmedAt || ''));
  const days = (a, b) => (a && b ? Math.max(0, Math.round((new Date(b) - new Date(a)) / 864e5)) : null);
  render(`
    ${pageHead('Production tracking', 'Timing for every manufacturing order, from confirmation to ready.')}
    <div class="stat-row">${stat('In production', int(r.inProduction.length), '', 'production')}${stat('Average production time', r.avgProductionDays != null ? `${r.avgProductionDays.toFixed(1)} days` : '—', 'Confirmed → ready')}${stat('Delayed', int(r.delayed.length), 'Past expected date')}${stat('Completed', int(r.completed.length), 'Delivered and paid')}</div>
    ${table([
      { label: 'Order', render: o => `<strong>${esc(o.number)}</strong><br><small>${esc(custName(o.customerId))}</small>` },
      { label: 'Status', render: o => badge(o.productionStatus) },
      { label: 'Confirmed', render: o => fmtDate(o.confirmedAt) },
      { label: 'Started', render: o => fmtDate(o.productionStartedAt) },
      { label: 'Ready', render: o => fmtDate(o.readyAt) },
      { label: 'Expected', render: o => `<span class="${lateOrder(o) ? 'bad-text' : ''}">${fmtDate(o.expectedAt)}${lateOrder(o) ? ' · late' : ''}</span>` },
      { label: 'Days', cls: 'num', render: o => { const d = days(o.confirmedAt, o.readyAt || new Date().toISOString()); return d == null ? '—' : `${d}${o.readyAt ? '' : '<small class="muted"> so far</small>'}`; } },
      { label: 'Delivery', render: o => badge(o.deliveryStatus) },
    ], list, { href: o => `orders/${o.id}`, empty: 'No manufacturing orders yet.' })}`);
}

// ============ SUPPLIERS ============
const supplierFields = () => [
  { name: 'company', label: 'Company', required: true }, { name: 'contact', label: 'Contact person' },
  { name: 'phone', label: 'Phone' }, { name: 'email', label: 'Email', type: 'email' },
  { name: 'address', label: 'Address', full: true }, { name: 'categories', label: 'Product categories', full: true, placeholder: 'T-shirts, Polos' },
  { name: 'paymentTerms', label: 'Payment terms' }, { name: 'leadTimeDays', label: 'Lead time (days)', type: 'number', min: 0 },
  { name: 'moq', label: 'Minimum order quantity', type: 'number', min: 0 }, { name: 'rating', label: 'Rating (1–5)', type: 'select', options: ['1', '2', '3', '4', '5'] },
  { name: 'notes', label: 'Performance notes', type: 'textarea', full: true },
];
const canEditSuppliers = () => can('suppliers') && app.user.role !== 'finance';
export function viewSuppliers() {
  const q = app.query;
  let list = [...db().suppliers].sort((x, y) => x.company.localeCompare(y.company));
  if (q.status === 'Inactive') list = list.filter(s => s.active === false); else if (q.status !== 'all') list = list.filter(s => s.active !== false);
  render(`
    ${pageHead('Suppliers', 'Who Seamline buys from, what they cost, and how reliably they deliver.', canEditSuppliers() ? btn('New supplier', 'add', 'primary') : '')}
    ${filters([{ key: 'status', label: 'Status', options: [{ value: 'Inactive', label: 'Inactive' }, { value: 'all', label: 'All' }] }], 'Search suppliers')}
    ${table([
      { label: 'Supplier', render: s => `<strong>${esc(s.company)}</strong><br><small class="muted">${esc(s.code)}</small>` },
      { label: 'Contact', render: s => `${esc(s.contact)}<br><small class="muted">${esc(s.phone)}</small>` },
      { label: 'Categories', render: s => `<small>${esc(s.categories)}</small>` },
      { label: 'Lead time', cls: 'num', render: s => s.leadTimeDays ? `${s.leadTimeDays} days` : '—' },
      { label: 'Rating', render: s => s.rating ? `<span class="rating" aria-label="${s.rating} of 5">${'★'.repeat(s.rating)}<span class="muted">${'★'.repeat(5 - s.rating)}</span></span>` : '—' },
      { label: 'Purchased', cls: 'num', render: s => money(S.supplierStats(s.id).purchased) },
      { label: 'Outstanding', cls: 'num', render: s => { const o = S.supplierStats(s.id).outstanding; return o > 0 ? `<span class="warn-text">${money(o)}</span>` : money(0); } },
      { label: 'Status', render: s => badge(s.active !== false ? 'Active' : 'Inactive') },
    ], list, { href: s => `suppliers/${s.id}`, empty: 'No suppliers yet.' })}`,
  { add: () => formModal({ title: 'New supplier', wide: true, fields: supplierFields(), onSubmit: v => { const s = S.saveSupplier(v); toast('Supplier added'); go(`suppliers/${s.id}`); } }) });
}
export function viewSupplier({ id }) {
  const s = S.get('suppliers', id);
  if (!s) return notFound('supplier');
  const st = S.supplierStats(s.id);
  const prices = db().supplierPrices.filter(p => p.supplierId === s.id);
  const productIds = [...new Set([...db().products.filter(p => p.supplierId === s.id).map(p => p.id), ...prices.map(p => p.productId)])];
  const pays = db().expenses.filter(e => e.supplierId === s.id);
  render(`
    ${pageHead(s.company, `${esc(s.code)} ${badge(s.active !== false ? 'Active' : 'Inactive')}`, [
      can('expenses') ? btn('Record payment', 'pay', 'ghost') : '',
      can('purchasing') ? linkBtn('New purchase order', `purchase-orders/new?supplier=${s.id}`, 'ghost') : '',
      canEditSuppliers() ? btn('Edit', 'edit', 'primary') : '',
    ].join(''))}
    <div class="stat-row">${stat('Total purchased', money(st.purchased), 'Goods received')}${stat('Paid', money(st.paid))}${stat('Outstanding', money(st.outstanding))}${stat('Average lead time', st.avgLeadTime != null ? `${st.avgLeadTime.toFixed(1)} days` : '—', `Quoted ${s.leadTimeDays || '—'} days`)}${stat('Purchase orders', int(st.pos.length))}</div>
    <div class="grid-2-1">
      <div>
        ${panel('Purchase orders', table([
          { label: 'PO', render: p => `<strong>${esc(p.number)}</strong>` }, { label: 'Status', render: p => badge(p.status) },
          { label: 'Total', cls: 'num', render: p => money(S.poTotal(p)) }, { label: 'Expected', render: p => fmtDate(p.expectedAt) }, { label: 'Created', render: p => fmtDate(p.createdAt) },
        ], db().purchaseOrders.filter(p => p.supplierId === s.id), { href: p => `purchase-orders/${p.id}`, empty: 'No purchase orders yet.' }))}
        ${panel('Products supplied & price history', table([
          { label: 'Product', render: pid => a(S.get('products', pid)?.name || '—', `products/${pid}`) },
          { label: 'Latest price', cls: 'num', render: pid => { const r = prices.find(x => x.productId === pid); return r ? money(r.price) : '—'; } },
          { label: 'History', render: pid => `<small>${prices.filter(x => x.productId === pid).slice(0, 5).map(r => `${money(r.price)} (${fmtDate(r.at)})`).join(' · ') || '—'}</small>` },
        ], productIds, { empty: 'No products linked yet.' }))}
        ${panel('Payments to supplier', table([
          { label: 'Date', render: e => fmtDate(e.date) }, { label: 'Ref', render: e => esc(e.number) }, { label: 'Method', render: e => esc(e.method) },
          { label: 'Amount', cls: 'num', render: e => e.void ? `<s>${money(e.amount)}</s> ${badge('Void')}` : money(e.amount) }, { label: 'Note', render: e => `<small>${esc(e.description)}</small>` },
        ], pays, { empty: 'No payments recorded.' }))}
      </div>
      ${panel('Details', kv([
        ['Contact', esc(s.contact)], ['Phone', esc(s.phone)], ['Email', s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : ''],
        ['Address', esc(s.address)], ['Categories', esc(s.categories)], ['Payment terms', esc(s.paymentTerms)],
        ['Lead time', s.leadTimeDays ? `${s.leadTimeDays} days` : ''], ['MOQ', s.moq ? int(s.moq) : ''], ['Rating', s.rating ? `${s.rating} / 5` : ''], ['Notes', esc(s.notes)],
      ]) + (canEditSuppliers() ? `<p>${btn(s.active !== false ? 'Mark inactive' : 'Reactivate', 'toggle', 'ghost sm')}</p>` : ''))}
    </div>`,
  {
    edit: () => formModal({ title: `Edit ${s.company}`, wide: true, fields: supplierFields(), values: { ...s, rating: String(s.rating || '') }, onSubmit: v => { S.saveSupplier({ ...v, id: s.id }); toast('Supplier updated'); rerender(); } }),
    toggle: () => { S.saveSupplier({ id: s.id, active: s.active === false }); rerender(); },
    pay: () => formModal({ title: `Payment to ${s.company}`, intro: 'Recorded under expenses as a supplier payment. It reduces the outstanding balance; it is not counted again in net profit because the goods are already in cost of sales.', fields: [
      { name: 'amount', label: 'Amount (Rs.)', type: 'number', min: 1, required: true }, { name: 'date', label: 'Date', type: 'date' },
      { name: 'method', label: 'Method', type: 'select', options: S.PAYMENT_METHODS }, { name: 'description', label: 'Reference / note' }],
      values: { amount: Math.max(0, Math.round(st.outstanding)) || '', date: today() },
      onSubmit: v => { S.addExpense({ ...v, category: 'Supplier payments', supplierId: s.id }); toast('Payment recorded'); rerender(); } }),
  });
}

// ============ PURCHASE ORDERS ============
export function viewPurchaseOrders() {
  const q = app.query;
  let list = db().purchaseOrders;
  if (q.status) list = list.filter(p => p.status === q.status);
  render(`
    ${pageHead('Purchase orders', 'Buy stock from suppliers. Receiving a PO adds stock to the ledger and updates cost.', can('purchasing') ? linkBtn('New purchase order', 'purchase-orders/new', 'primary') : '')}
    ${filters([{ key: 'status', label: 'Status', options: ['Draft', 'Ordered', 'Partially Received', 'Received', 'Cancelled'] }], 'Search PO or supplier')}
    ${table([
      { label: 'PO', render: p => `<strong>${esc(p.number)}</strong>` },
      { label: 'Supplier', render: p => esc(S.get('suppliers', p.supplierId)?.company) },
      { label: 'Status', render: p => badge(p.status) },
      { label: 'Units', cls: 'num', render: p => `${int(p.items.reduce((t, i) => t + i.received, 0))} / ${int(p.items.reduce((t, i) => t + i.qty, 0))}` },
      { label: 'Total', cls: 'num', render: p => money(S.poTotal(p)) },
      { label: 'Expected', render: p => fmtDate(p.expectedAt) },
      { label: 'Warehouse', render: p => esc(S.get('warehouses', p.warehouseId)?.name) },
      { label: 'Created', render: p => fmtDate(p.createdAt) },
    ], list, { href: p => `purchase-orders/${p.id}`, empty: 'No purchase orders match.' })}`);
}
export function viewPOEditor() {
  if (!can('purchasing')) { toast('Your role cannot create purchase orders.', 'error'); return go('purchase-orders'); }
  const q = app.query;
  let lines = (q.lines || '').split(',').filter(Boolean).map(x => { const [variantId, qty] = x.split(':'); const v = S.get('variants', variantId); return v ? { variantId, qty, unitCost: v.cost } : null; }).filter(Boolean);
  if (!lines.length) lines = [{ variantId: '', qty: '', unitCost: '' }];
  const opts = variantOptions();
  const lineHtml = (l, i) => `<div class="line po-line" data-i="${i}">
    <div class="field grow"><label>Product variant</label><select data-f="variantId"><option value="">Choose</option>${opts.map(o => `<option value="${o.value}" ${o.value === l.variantId ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select></div>
    <div class="field n"><label>Qty</label><input type="number" min="1" data-f="qty" value="${esc(l.qty)}"></div>
    <div class="field n"><label>Unit cost</label><input type="number" min="0" step="any" data-f="unitCost" value="${esc(l.unitCost)}"></div>
    <div class="line-total"><span>${money((+l.qty || 0) * (+l.unitCost || 0))}</span></div>
    <button type="button" class="icon-btn" data-remove="${i}" aria-label="Remove line">×</button></div>`;
  render(`
    ${pageHead('New purchase order', 'Stock is added when you receive the goods, not when the PO is placed.')}
    <form id="poform" class="doc-form" novalidate>
      ${panel('', `<div class="form-grid">
        ${fieldHtml({ name: 'supplierId', label: 'Supplier', type: 'select', required: true, blank: 'Choose a supplier', options: supplierOptions() }, q.supplier)}
        ${fieldHtml({ name: 'warehouseId', label: 'Deliver to', type: 'select', options: warehouseOptions() })}
        ${fieldHtml({ name: 'expectedAt', label: 'Expected arrival', type: 'date' })}
        ${fieldHtml({ name: 'notes', label: 'Notes', type: 'textarea', full: true, rows: 2 })}</div>`)}
      ${panel('Items', '<div id="polines" class="lines"></div>')}
      <div class="sticky-bar"><div id="poTotal"></div><div class="bar-actions"><a class="btn ghost" href="#/purchase-orders">Cancel</a><button type="button" class="btn" data-action="save" data-mode="draft">Save draft</button><button type="button" class="btn primary" data-action="save" data-mode="place">Save and place order</button></div></div>
    </form>`,
  {
    save: el => {
      const v = readForm($('#poform'));
      const po = S.createPO({ ...v, items: lines });
      if (el.dataset.mode === 'place') S.markPOOrdered(po.id);
      toast(`${po.number} ${el.dataset.mode === 'place' ? 'placed' : 'saved'}`);
      go(`purchase-orders/${po.id}`);
    },
  });
  const host = $('#polines');
  const draw = () => { host.innerHTML = lines.map(lineHtml).join('') + '<button type="button" class="btn ghost sm" data-add>Add line</button>'; total(); };
  const total = () => { $('#poTotal').innerHTML = `<span>Total <b>${money(lines.reduce((t, l) => t + (+l.qty || 0) * (+l.unitCost || 0), 0))}</b></span>`; };
  host.addEventListener('input', e => {
    const f = e.target.dataset.f; const row = e.target.closest('.line'); if (!f || !row) return;
    const l = lines[+row.dataset.i]; l[f] = e.target.value;
    if (f === 'variantId') { const v = S.get('variants', l.variantId); if (v && !l.unitCost) l.unitCost = v.cost; draw(); return; }
    row.querySelector('.line-total span').textContent = money((+l.qty || 0) * (+l.unitCost || 0)); total();
  });
  host.addEventListener('click', e => {
    if (e.target.closest('[data-add]')) { lines.push({ variantId: '', qty: '', unitCost: '' }); draw(); }
    const rm = e.target.closest('[data-remove]');
    if (rm) { lines.splice(+rm.dataset.remove, 1); if (!lines.length) lines.push({ variantId: '', qty: '', unitCost: '' }); draw(); }
  });
  draw();
}
function receiveModal(po) {
  const due = po.items.filter(i => i.received < i.qty);
  formModal({
    title: `Receive goods · ${po.number}`, wide: true, submitLabel: 'Receive into stock',
    intro: `Received quantities are added to <strong>${esc(S.get('warehouses', po.warehouseId)?.name)}</strong> as Purchase movements, and product cost is updated to a weighted average.`,
    fields: [...due.map(i => { const v = S.get('variants', i.variantId); return { name: `q_${i.id}`, label: `${v.sku} — ${S.productOf(v.id)?.name}, ${S.variantLabel(v)}`, type: 'number', min: 0, hint: `${i.qty - i.received} still due at ${money(i.unitCost)}` }; }), { name: 'note', label: 'Delivery note / GRN reference', full: true }],
    values: Object.fromEntries(due.map(i => [`q_${i.id}`, i.qty - i.received])),
    onSubmit: v => { const gr = S.receivePO(po.id, due.map(i => ({ itemId: i.id, qty: v[`q_${i.id}`] })), v.note); toast(`${gr.number} recorded — stock updated`); rerender(); },
  });
}
export function viewPO({ id }) {
  const po = S.get('purchaseOrders', id);
  if (!po) return notFound('purchase order');
  const sup = S.get('suppliers', po.supplierId);
  const grs = db().goodsReceipts.filter(g => g.poId === po.id);
  const cp = can('purchasing');
  render(`
    ${pageHead(po.number, `${a(sup?.company || '—', `suppliers/${po.supplierId}`)} ${badge(po.status)}`, [
      cp && po.status === 'Draft' ? btn('Place order', 'place', 'primary') : '',
      cp && ['Ordered', 'Partially Received'].includes(po.status) ? btn('Receive goods', 'receive', 'primary') : '',
      cp && ['Draft', 'Ordered'].includes(po.status) ? btn('Cancel PO', 'cancel', 'ghost danger-text') : '',
    ].join(''))}
    <div class="grid-2-1">
      <div>
        ${panel('Items', table([
          { label: 'SKU', render: i => `<strong>${esc(S.get('variants', i.variantId)?.sku)}</strong>` },
          { label: 'Product', render: i => `${esc(S.productOf(i.variantId)?.name)}<br><small class="muted">${esc(S.variantLabel(S.get('variants', i.variantId)))}</small>` },
          { label: 'Ordered', cls: 'num', render: i => int(i.qty) },
          { label: 'Received', cls: 'num', render: i => `<span class="${i.received >= i.qty ? 'good-text' : ''}">${int(i.received)}</span>` },
          { label: 'Unit cost', cls: 'num', render: i => money(i.unitCost) },
          { label: 'Amount', cls: 'num', render: i => money(i.qty * i.unitCost) },
        ], po.items, { foot: ['Total', '', int(po.items.reduce((t, i) => t + i.qty, 0)), int(po.items.reduce((t, i) => t + i.received, 0)), '', money(S.poTotal(po))] }))}
        ${panel('Goods received', table([
          { label: 'GRN', render: g => `<strong>${esc(g.number)}</strong>` }, { label: 'When', render: g => fmtDateTime(g.at) },
          { label: 'Units', cls: 'num', render: g => int(g.lines.reduce((t, l) => t + l.qty, 0)) }, { label: 'By', render: g => esc(g.by) }, { label: 'Note', render: g => `<small>${esc(g.note)}</small>` },
        ], grs, { empty: 'Nothing received yet.' }))}
      </div>
      ${panel('Details', kv([
        ['Supplier', esc(sup?.company)], ['Deliver to', esc(S.get('warehouses', po.warehouseId)?.name)], ['Expected arrival', fmtDate(po.expectedAt)],
        ['Created', `${fmtDateTime(po.createdAt)}<br><small class="muted">${esc(po.createdBy)}</small>`], ['Placed', fmtDateTime(po.orderedAt)], ['Fully received', fmtDateTime(po.receivedAt)],
        ['Supplier payment terms', esc(sup?.paymentTerms)], ['Notes', esc(po.notes)], po.cancelReason ? ['Cancelled because', esc(po.cancelReason)] : null,
      ]))}
    </div>`,
  {
    place: () => { S.markPOOrdered(po.id); toast('Purchase order placed'); rerender(); },
    receive: () => receiveModal(po),
    cancel: async () => { const r = await confirmBox('The PO is kept for history but marked cancelled.', { title: 'Cancel purchase order?', input: 'Reason', confirmLabel: 'Cancel PO', danger: true }); if (r) { S.cancelPO(po.id, r); rerender(); } },
  });
}
export function viewReceiving() {
  const open = db().purchaseOrders.filter(p => ['Ordered', 'Partially Received'].includes(p.status)).sort((x, y) => (x.expectedAt || '9').localeCompare(y.expectedAt || '9'));
  render(`
    ${pageHead('Receiving', 'Purchase orders waiting for goods. Receiving adds stock and records a goods receipt.')}
    ${panel('Awaiting delivery', table([
      { label: 'PO', render: p => `<strong>${esc(p.number)}</strong>` },
      { label: 'Supplier', render: p => esc(S.get('suppliers', p.supplierId)?.company) },
      { label: 'Due units', cls: 'num', render: p => int(p.items.reduce((t, i) => t + i.qty - i.received, 0)) },
      { label: 'Expected', render: p => { const late = p.expectedAt && p.expectedAt < today(); return `<span class="${late ? 'bad-text' : ''}">${fmtDate(p.expectedAt)}${late ? ' · overdue' : ''}</span>`; } },
      { label: 'Status', render: p => badge(p.status) },
      { label: '', render: p => can('purchasing') ? btn('Receive', 'receive', 'sm primary', `data-id="${p.id}"`) : '' },
    ], open, { href: p => `purchase-orders/${p.id}`, empty: 'No purchase orders are waiting for delivery.' }))}
    ${panel('Recent goods receipts', table([
      { label: 'GRN', render: g => `<strong>${esc(g.number)}</strong>` },
      { label: 'PO', render: g => esc(S.get('purchaseOrders', g.poId)?.number) },
      { label: 'Supplier', render: g => esc(S.get('suppliers', S.get('purchaseOrders', g.poId)?.supplierId)?.company) },
      { label: 'Units', cls: 'num', render: g => int(g.lines.reduce((t, l) => t + l.qty, 0)) },
      { label: 'Value', cls: 'num', render: g => money(g.lines.reduce((t, l) => t + l.qty * l.unitCost, 0)) },
      { label: 'When', render: g => fmtDateTime(g.at) }, { label: 'By', render: g => esc(g.by) },
    ], db().goodsReceipts.slice(0, 30), { href: g => `purchase-orders/${g.poId}`, empty: 'No goods received yet.' }))}`,
  {
    receive: el => receiveModal(S.get('purchaseOrders', el.dataset.id)),
  });
}
