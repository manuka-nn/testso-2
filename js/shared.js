// Renderers shared by the staff app, the customer portal and the public pages.
// They only use published, customer-safe documents (see publisher.js).
import { esc, money, int, fmtDate, fmtDateTime, badge, formModal, toast } from './ui.js';

const SWATCHES = { black: '#111', white: '#fff', navy: '#1f2d55', grey: '#8d9096', gray: '#8d9096', beige: '#d8c7a6', natural: '#eadfc8', silver: '#c4c7cc', red: '#b83232', blue: '#2d5fb9', green: '#2f7a4d', maroon: '#6b1f2a', yellow: '#e0b526' };
export const swatch = c => SWATCHES[String(c).toLowerCase()] || '#b9bcc4';
const initials = s => String(s || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();

// Colour × size availability grid.
export function stockMatrix(variants) {
  if (!variants?.length) return '<p class="muted small">Made to order — no ready stock.</p>';
  const colors = [...new Set(variants.map(v => v.color))];
  const sizes = [...new Set(variants.map(v => v.size))];
  const cell = (c, s) => {
    const v = variants.find(x => x.color === c && x.size === s);
    if (!v) return '<td class="na">—</td>';
    return `<td class="${v.available === 0 ? 'zero' : v.low ? 'low' : ''}">${int(v.available)}</td>`;
  };
  return `<div class="table-wrap"><table class="matrix"><thead><tr><th scope="col">Colour</th>${sizes.map(s => `<th scope="col">${esc(s)}</th>`).join('')}<th scope="col">Total</th></tr></thead>
    <tbody>${colors.map(c => `<tr><th scope="row"><span class="swatch" style="--sw:${swatch(c)}"></span>${esc(c)}</th>${sizes.map(s => cell(c, s)).join('')}<td><strong>${int(variants.filter(v => v.color === c).reduce((t, v) => t + v.available, 0))}</strong></td></tr>`).join('')}</tbody></table></div>`;
}
export function catalogueCard(p, actions = '') {
  const avail = p.variants.reduce((t, v) => t + v.available, 0);
  return `<article class="cat-card">
    <div class="cat-media">${p.image ? `<img class="thumb" src="${p.image}" alt="">` : `<span class="thumb ph">${esc(initials(p.name))}</span>`}</div>
    <div class="cat-body">
      <header><h3>${esc(p.name)}</h3><span class="muted small">${esc(p.sku)} · ${esc(p.category)}</span></header>
      <div class="cat-price"><strong>${money(p.price)}</strong><span>per unit</span><span class="dot">·</span><span>MOQ ${int(p.moq || 1)}</span><span class="dot">·</span><span>${int(avail)} available</span></div>
      ${p.description ? `<p class="small">${esc(p.description)}</p>` : ''}
      ${p.material ? `<p class="small muted">Material: ${esc(p.material)}</p>` : ''}
      ${stockMatrix(p.variants)}
      ${actions ? `<div class="btn-row">${actions}</div>` : ''}
    </div>
  </article>`;
}

// Live order tracking (public link and portal). `doc` is a published order document.
export function trackingHtml(doc, { compact = false, live = false } = {}) {
  const v = doc.view, s = doc.company || {};
  const cancelled = v.state === 'Cancelled';
  const wa = String(s.whatsapp || '').replace(/\D/g, '');
  return `<article class="track ${compact ? 'compact' : ''}">
    <div class="track-top"><p class="track-no">Order ${esc(v.number)}</p>${live ? '<span class="live-dot" title="This page updates automatically">Live</span>' : ''}</div>
    <h2 class="track-headline ${cancelled ? 'bad-text' : ''}">${esc(v.headline)}</h2>
    ${!cancelled ? `<div class="progress" role="progressbar" aria-valuenow="${v.percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Order progress"><span style="--w:${v.percent}%"></span></div><p class="progress-label">${v.percent}% complete</p>` : ''}
    <dl class="track-facts">
      <div><dt>Order date</dt><dd>${fmtDate(v.orderDate)}</dd></div>
      <div><dt>Estimated completion</dt><dd>${v.expectedAt ? fmtDate(v.expectedAt) : 'To be confirmed'}</dd></div>
      <div><dt>Payment</dt><dd>${badge(v.paymentStatus)}</dd></div>
      <div><dt>Delivery</dt><dd>${badge(v.deliveryStatus)}</dd></div>
    </dl>
    ${!cancelled ? `<ol class="steps">${v.steps.map((st, i) => `<li class="${st.done ? 'done' : st.current ? 'current' : ''}" style="--i:${i}"><span class="step-dot" aria-hidden="true">${st.done ? '✓' : ''}</span><span>${esc(st.label)}</span><span class="sr-only">${st.done ? '(done)' : st.current ? '(current step)' : '(upcoming)'}</span></li>`).join('')}</ol>` : ''}
    ${v.updates.length ? `<section class="track-section"><h3>Latest updates</h3><ol class="updates">${v.updates.map((u, i) => `<li class="${i === 0 ? 'latest' : ''}"><p>${esc(u.text)}</p><time datetime="${esc(u.at)}">${fmtDateTime(u.at)}</time></li>`).join('')}</ol></section>` : ''}
    <section class="track-section"><h3>Products</h3><ul class="track-items">${v.items.map(i => `<li><div><strong>${esc(i.name)}</strong>${i.variant && !String(i.name).includes(i.variant) ? `<span>${esc(i.variant)}</span>` : ''}</div><b>${int(i.qty)} units</b></li>`).join('')}</ul></section>
    <section class="track-section"><h3>Payment</h3><dl class="track-money"><div><dt>Order total</dt><dd>${money(v.total)}</dd></div><div><dt>Paid</dt><dd>${money(v.paid)}</dd></div><div class="grand"><dt>Balance</dt><dd>${money(v.balance)}</dd></div></dl>
      ${doc.invoice ? '<div class="btn-row"><button type="button" class="btn ghost sm" data-pdf="invoice">Download invoice PDF</button></div>' : ''}</section>
    ${compact ? '' : `<section class="track-help"><h3>Need help?</h3><p>Questions about this order? Message us and mention ${esc(v.number)}.</p>
      <div class="btn-row">${wa ? `<a class="btn light" href="https://wa.me/${esc(wa)}?text=${encodeURIComponent(`Hi Seamline, I have a question about order ${v.number}.`)}" target="_blank" rel="noopener">WhatsApp us</a>` : ''}${s.email ? `<a class="btn outline-light" href="mailto:${esc(s.email)}?subject=${encodeURIComponent(`Order ${v.number}`)}">Email</a>` : ''}${s.phone ? `<a class="btn outline-light" href="tel:${esc(String(s.phone).replace(/\s/g, ''))}">Call</a>` : ''}</div></section>`}
  </article>`;
}

// Customer view of a quote. `q` is a published quote document.
export function quoteCustomerHtml(q) {
  const d = q.doc, t = d.totals;
  const open = ['Sent', 'Viewed'].includes(q.status) && !q.pending;
  const msg = { Approved: 'You approved this quote. Our team will confirm your order shortly.', 'Converted to order': `This quote is now order ${esc(q.orderNumber || '')}. Thank you!`, Rejected: 'This quote was declined.', Expired: 'This quote has expired. Contact us for an updated price.' }[q.status] || '';
  return `<article class="quote-view">
    <header class="quote-head"><div><p class="track-no">Quotation</p><h2>${esc(d.number)}</h2><p class="muted small">Prepared for ${esc(d.customer.name)} · ${fmtDate(d.date)}</p></div>${badge(q.status === 'Converted to order' ? 'Approved' : q.status)}</header>
    <ul class="track-items">${d.items.map(i => `<li><div><strong>${esc(i.name)}</strong>${i.detail ? `<span>${esc(i.detail)}</span>` : ''}<span>${int(i.qty)} × ${money(i.unitPrice)}</span></div><b>${money(i.amount)}</b></li>`).join('')}</ul>
    <dl class="track-money">
      <div><dt>Subtotal</dt><dd>${money(t.subtotal)}</dd></div>
      ${t.discount ? `<div><dt>Discount</dt><dd>− ${money(t.discount)}</dd></div>` : ''}
      ${t.deliveryCharge ? `<div><dt>Delivery</dt><dd>${money(t.deliveryCharge)}</dd></div>` : ''}
      ${t.tax ? `<div><dt>Tax (${t.taxRate}%)</dt><dd>${money(t.tax)}</dd></div>` : ''}
      <div class="grand"><dt>Total</dt><dd>${money(t.total)}</dd></div>
    </dl>
    <dl class="track-facts">
      <div><dt>Valid until</dt><dd>${fmtDate(d.validUntil)}</dd></div>
      <div><dt>Production time</dt><dd>${d.productionDays ? `${d.productionDays} days after approval` : 'To be confirmed'}</dd></div>
      ${d.paymentTerms ? `<div class="wide"><dt>Payment terms</dt><dd>${esc(d.paymentTerms)}</dd></div>` : ''}
    </dl>
    ${d.notes ? `<p class="small">${esc(d.notes)}</p>` : ''}
    <div class="btn-row"><button type="button" class="btn ghost sm" data-pdf="quote">Download quote PDF</button></div>
    ${open ? `<div class="quote-actions"><button type="button" class="btn primary" data-quote="approve">Approve quote</button><button type="button" class="btn ghost" data-quote="changes">Request changes</button><button type="button" class="btn ghost danger-text" data-quote="reject">Decline</button></div>`
      : q.pending ? '<p class="callout info">Thanks — your response has been sent. This page updates as soon as Seamline receives it.</p>'
        : msg ? `<p class="callout ${['Rejected', 'Expired'].includes(q.status) ? 'warn' : 'info'}">${msg}</p>` : ''}
    ${q.changeRequests?.length ? `<section class="track-section"><h3>Your change requests</h3><ol class="updates">${q.changeRequests.slice().reverse().map(c => `<li><p>${esc(c.text)}</p><time>${fmtDateTime(c.at)}</time></li>`).join('')}</ol></section>` : ''}
  </article>`;
}

// Approve / request changes / decline. `send(action, message)` delivers it.
export function quoteRespond(action, send, after) {
  const cfg = {
    approve: { title: 'Approve this quote?', label: 'Approve quote', intro: 'We’ll confirm your order and share next steps, including any advance payment.', field: 'Comment (optional)', required: false },
    changes: { title: 'Request changes', label: 'Send request', intro: 'Tell us what to change — quantities, colours, sizes, print, delivery date.', field: 'What would you like changed?', required: true },
    reject: { title: 'Decline this quote?', label: 'Decline quote', intro: 'A short reason helps us improve future quotes.', field: 'Reason (optional)', required: false, danger: true },
  }[action];
  formModal({
    title: cfg.title, submitLabel: cfg.label, intro: cfg.intro, danger: cfg.danger,
    fields: [{ name: 'msg', label: cfg.field, type: 'textarea', full: true, rows: 3, required: cfg.required }],
    onSubmit: async v => {
      await send(action, v.msg);
      toast(action === 'approve' ? 'Thank you — approval sent' : action === 'changes' ? 'Your request was sent' : 'Response sent');
      after?.();
    },
  });
}

// QR code as SVG (vendor/qrcode.js).
export function qrSvg(text, cell = 6) {
  if (!window.qrcode) return '<p class="small muted">QR library missing.</p>';
  const q = window.qrcode(0, 'M'); q.addData(text); q.make();
  return q.createSvgTag({ cellSize: cell, margin: 2, scalable: true });
}
