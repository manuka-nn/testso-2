// Shared UI helpers used by the admin app, portal and public pages.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = n => `Rs. ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
export const pct = n => `${((Number(n) || 0) * 100).toFixed(1)}%`;
export const int = n => Math.round(Number(n) || 0).toLocaleString('en-US');
export const fmtDate = d => (d ? new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = d => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }) : '—');
export const today = () => { const x = new Date(); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };

const TONE = {
  good: ['Paid', 'Delivered', 'Completed', 'Approved', 'Received', 'Ready', 'Active', 'Passed', 'Converted', 'Converted to order', 'Order Confirmed', 'Confirmed'],
  info: ['In Production', 'Quality Control', 'Sent', 'Dispatched', 'Out for Delivery', 'Ordered', 'Contacted', 'Quote Created', 'Quote Sent', 'Requirement Received', 'Order', 'Production Scheduled', 'Partially Received'],
  warn: ['Partially Paid', 'Awaiting Materials', 'Viewed', 'Draft', 'Packed', 'Negotiation', 'New', 'Lead', 'Low stock', 'Overdue soon'],
  bad: ['Unpaid', 'Cancelled', 'Rejected', 'Expired', 'Failed', 'Lost', 'Void', 'Inactive', 'Overdue', 'Declined', 'Archived', 'Out of stock'],
};
export function tone(s) { for (const [t, list] of Object.entries(TONE)) if (list.includes(s)) return t; return 'neutral'; }
export const badge = (s, t) => `<span class="badge b-${t || tone(s)}">${esc(s)}</span>`;

export function toast(message, kind = 'ok') {
  let host = document.getElementById('toasts');
  if (!host) { host = document.createElement('div'); host.id = 'toasts'; host.setAttribute('aria-live', 'polite'); document.body.appendChild(host); }
  const t = document.createElement('div');
  t.className = `toast t-${kind}`;
  t.textContent = message;
  host.appendChild(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3200);
}

export function modal({ title, body, footer = '', wide = false, onMount }) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close aria-label="Close">×</button></header>
    <div class="modal-body">${body}</div>${footer ? `<footer>${footer}</footer>` : ''}</div>`;
  document.body.appendChild(wrap);
  const onKey = e => { if (e.key === 'Escape') close(); };
  function close() { wrap.remove(); document.removeEventListener('keydown', onKey); }
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  wrap.addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  onMount?.(wrap, close);
  setTimeout(() => wrap.querySelector('input:not([type=hidden]),select,textarea')?.focus(), 30);
  return { el: wrap, close };
}

export function fieldHtml(f, value) {
  const id = `f_${f.name}_${Math.random().toString(36).slice(2, 7)}`;
  const v = value ?? f.value ?? '';
  const req = f.required ? 'required' : '';
  const common = `id="${id}" name="${esc(f.name)}" ${req} ${f.placeholder ? `placeholder="${esc(f.placeholder)}"` : ''}`;
  let input;
  if (f.type === 'select') {
    input = `<select ${common}>${f.blank !== undefined ? `<option value="">${esc(f.blank)}</option>` : ''}${(f.options || []).map(o => {
      const ov = typeof o === 'object' ? o.value : o, ol = typeof o === 'object' ? o.label : o;
      return `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`;
    }).join('')}</select>`;
  } else if (f.type === 'textarea') input = `<textarea ${common} rows="${f.rows || 3}">${esc(v)}</textarea>`;
  else if (f.type === 'checkbox') return `<label class="check ${f.full ? 'full' : ''}"><input type="checkbox" name="${esc(f.name)}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
  else if (f.type === 'file') input = `<input type="file" ${common} ${f.accept ? `accept="${esc(f.accept)}"` : ''} ${f.multiple ? 'multiple' : ''}>`;
  else input = `<input type="${f.type || 'text'}" ${common} value="${esc(v)}" ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.step ? `step="${f.step}"` : (f.type === 'number' ? 'step="any"' : '')} ${f.type === 'number' ? 'inputmode="decimal"' : ''}>`;
  return `<div class="field ${f.full ? 'full' : ''}"><label for="${id}">${esc(f.label)}${f.required ? '<span class="req" aria-hidden="true">*</span>' : ''}</label>${input}${f.hint ? `<small>${esc(f.hint)}</small>` : ''}</div>`;
}
export function readForm(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'file') out[el.name] = el.multiple ? [...el.files] : el.files[0] || null;
    else out[el.name] = el.value;
  }
  return out;
}

export function formModal({ title, fields, values = {}, submitLabel = 'Save', onSubmit, wide = false, intro = '', danger = false }) {
  const body = `<form class="form-grid" novalidate>${intro ? `<p class="intro full">${intro}</p>` : ''}${fields.map(f => fieldHtml(f, values[f.name])).join('')}<p class="form-error full" role="alert" hidden></p><button type="submit" hidden></button></form>`;
  const footer = `<button type="button" class="btn ghost" data-close>Cancel</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" data-submit>${esc(submitLabel)}</button>`;
  return modal({
    title, body, footer, wide,
    onMount(el, close) {
      const form = el.querySelector('form');
      const err = el.querySelector('.form-error');
      const btn = el.querySelector('[data-submit]');
      const submit = async e => {
        e?.preventDefault();
        err.hidden = true;
        const missing = fields.filter(f => f.required && f.type !== 'checkbox' && !String(form.elements[f.name]?.value || '').trim());
        if (missing.length) { err.textContent = `Fill in: ${missing.map(f => f.label).join(', ')}.`; err.hidden = false; return; }
        btn.disabled = true;
        try { const r = await onSubmit(readForm(form)); if (r !== false) close(); }
        catch (ex) { err.textContent = ex.message; err.hidden = false; }
        finally { btn.disabled = false; }
      };
      form.addEventListener('submit', submit);
      btn.addEventListener('click', submit);
    },
  });
}

export function confirmBox(message, { title = 'Are you sure?', confirmLabel = 'Confirm', danger = false, input = null } = {}) {
  return new Promise(resolve => {
    let done = false;
    const m = formModal({
      title, submitLabel: confirmLabel, danger, intro: esc(message),
      fields: input ? [{ name: 'value', label: input, type: 'textarea', full: true, rows: 2, required: true }] : [],
      onSubmit: v => { done = true; resolve(input ? v.value : true); },
    });
    const obs = new MutationObserver(() => { if (!document.body.contains(m.el)) { obs.disconnect(); if (!done) resolve(false); } });
    obs.observe(document.body, { childList: true });
  });
}

export function table(cols, rows, { href, empty = 'Nothing here yet.', foot } = {}) {
  if (!rows.length) return `<div class="empty">${empty}</div>`;
  return `<div class="table-wrap"><table>
    <thead><tr>${cols.map(c => `<th class="${c.cls || ''}" scope="col">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => `<tr ${href ? `data-href="${esc(href(r))}" class="clickable" tabindex="0"` : ''}>${cols.map(c => `<td class="${c.cls || ''}">${c.render(r)}</td>`).join('')}</tr>`).join('')}</tbody>
    ${foot ? `<tfoot><tr>${cols.map((c, i) => `<td class="${c.cls || ''}">${foot[i] ?? ''}</td>`).join('')}</tr></tfoot>` : ''}
  </table></div>`;
}

// Lightweight bar chart built from HTML so labels stay crisp at any width.
export function barChart(data, { height = 180, series = [{ key: 'value', label: 'Value', cls: 'bar-a' }], format = money, labelEvery = 1 } = {}) {
  if (!data.length) return '<div class="empty">No data for this period.</div>';
  const max = Math.max(1, ...data.flatMap(d => series.map(s => d[s.key] || 0)));
  const legend = series.length > 1 ? `<div class="legend">${series.map(s => `<span><i class="${s.cls}"></i>${esc(s.label)}</span>`).join('')}</div>` : '';
  const cols = data.map((d, i) => {
    const tip = [d.label, ...series.map(s => `${s.label}: ${format(d[s.key] || 0)}`)].join('\n');
    return `<div class="col" title="${esc(tip)}"><div class="stack">${series.map(s => `<span class="bar ${s.cls}" style="height:${Math.max(0, (d[s.key] || 0) / max * 100)}%"></span>`).join('')}</div><em>${i % labelEvery === 0 ? esc(d.label) : '&nbsp;'}</em></div>`;
  }).join('');
  return `<div class="chart">${legend}<div class="bars" style="height:${height}px" role="img" aria-label="Bar chart">${cols}</div></div>`;
}

export function readImage(file, max = 640) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve(null);
    if (!file.type.startsWith('image/')) return reject(new Error('Choose an image file (JPG, PNG or WebP).'));
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read that file.'));
    r.onload = () => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error('That image could not be opened.'));
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

export function downloadText(name, text, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  }
}

// Opens a clean printable document (invoice, quote) in a new window.
export const initials = s => String(s || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join('').toUpperCase();
export function productThumb(p, size = 44) {
  if (p?.image) return `<img class="thumb" src="${p.image}" alt="" width="${size}" height="${size}">`;
  return `<span class="thumb ph" style="width:${size}px;height:${size}px" aria-hidden="true">${esc(initials(p?.name))}</span>`;
}
