// Public quote request form. Submissions arrive in the staff app as leads.
import { getDoc, sendInbox } from './publicstore.js';
import { esc, fieldHtml, readForm, readImage, int } from './ui.js';

const host = document.getElementById('page');
const TYPES = ['T-shirt', 'Polo', 'Hoodie', 'Cap', 'Bottle', 'Bag', 'Uniform', 'Promotional merchandise', 'Custom product', 'Other'];
const METHODS = ['Screen printing', 'Embroidery', 'DTF print', 'Sublimation', 'Woven label / tags', 'Not sure yet', 'No customization'];
let company = {};
const hideLoader = () => { const l = document.getElementById('loader'); if (l) { l.classList.add('done'); setTimeout(() => l.remove(), 700); } };
const ref = () => `RQ-${Date.now().toString(36).toUpperCase().slice(-4)}${Math.random().toString(36).slice(2, 4).toUpperCase()}`;
const wa = () => String(company.whatsapp || '').replace(/\D/g, '');

function form() {
  host.innerHTML = `
  <article class="req-card enter">
    <header class="req-head">
      <p class="track-no">Custom merchandise & bulk orders</p>
      <h1>Request a quote</h1>
      <p class="muted">Tell us what you need. We usually reply within one working day with pricing, options and timelines.</p>
    </header>
    <form id="rq" class="form-grid" novalidate>
      <h2 class="full sub-h">About you</h2>
      ${fieldHtml({ name: 'name', label: 'Your name', required: true })}
      ${fieldHtml({ name: 'company', label: 'Company / brand', placeholder: 'Optional' })}
      ${fieldHtml({ name: 'email', label: 'Email', type: 'email' })}
      ${fieldHtml({ name: 'phone', label: 'Phone / WhatsApp', type: 'tel', hint: 'Email or phone — we need at least one' })}
      <span class="seam-line full"></span>
      <h2 class="full sub-h">What you need</h2>
      ${fieldHtml({ name: 'productType', label: 'Product type', type: 'select', options: TYPES, required: true, blank: 'Choose' })}
      ${fieldHtml({ name: 'quantity', label: 'Quantity', type: 'number', min: 1, placeholder: 'e.g. 150' })}
      ${fieldHtml({ name: 'requiredDate', label: 'Needed by', type: 'date' })}
      ${fieldHtml({ name: 'customization', label: 'Customization', type: 'select', options: METHODS, blank: 'Choose' })}
      ${fieldHtml({ name: 'reference', label: 'Product reference or link', full: true, placeholder: 'A link, a product you liked, or a previous order number' })}
      ${fieldHtml({ name: 'requirements', label: 'Requirements', type: 'textarea', full: true, rows: 5, placeholder: 'Fabric, colours, sizes and size breakdown, logo placement, packaging, delivery location…' })}
      ${fieldHtml({ name: 'files', label: 'Logos, designs or reference images', type: 'file', accept: 'image/*', multiple: true, full: true, hint: 'Up to 5 images. For AI / PDF artwork, we will ask you to email the originals.' })}
      <p class="form-error full" role="alert" hidden></p>
      <div class="full"><button class="btn primary big" type="submit">Send request</button></div>
    </form>
    ${wa() || company.email ? `<p class="small muted">Prefer to talk? ${wa() ? `<a href="https://wa.me/${esc(wa())}" target="_blank" rel="noopener">WhatsApp us</a>` : ''}${wa() && company.email ? ' or email ' : company.email ? 'Email ' : ''}${company.email ? `<a href="mailto:${esc(company.email)}">${esc(company.email)}</a>` : ''}.</p>` : ''}
  </article>`;
  const f = document.getElementById('rq'), err = f.querySelector('.form-error');
  f.addEventListener('submit', async e => {
    e.preventDefault();
    err.hidden = true;
    const btn = f.querySelector('button[type=submit]');
    try {
      const v = readForm(f);
      if (!String(v.name || '').trim()) throw new Error('Add your name.');
      if (!String(v.email || '').trim() && !String(v.phone || '').trim()) throw new Error('Add an email or phone number so we can reply.');
      if (!v.productType) throw new Error('Choose a product type.');
      btn.disabled = true; btn.textContent = 'Sending…';
      const attachments = [];
      for (const file of (v.files || []).slice(0, 5)) {
        if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') attachments.push({ name: file.name, dataUrl: await readImage(file, 900) });
        else attachments.push({ name: file.name });
      }
      delete v.files;
      const clientRef = ref();
      await sendInbox('quote_request', { ...v, attachments, clientRef });
      done(v, clientRef);
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false;
      btn.disabled = false; btn.textContent = 'Send request';
    }
  });
}

function done(v, clientRef) {
  window.scrollTo(0, 0);
  host.innerHTML = `<article class="req-card done enter">
    <div class="done-mark" aria-hidden="true"><svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l7 7 15-16"/></svg></div>
    <p class="track-no">Request received</p>
    <h1>Thank you, ${esc(String(v.name).split(' ')[0])}</h1>
    <p>Your reference is</p>
    <p class="big-number">${esc(clientRef)}</p>
    <p>We’ll review your ${esc(v.productType.toLowerCase())} request${v.quantity ? ` for ${int(v.quantity)} units` : ''} and reply with a quote. Mention this reference if you contact us.</p>
    <div class="btn-row center-row">${wa() ? `<a class="btn primary" href="https://wa.me/${esc(wa())}?text=${encodeURIComponent(`Hi Seamline, I just sent quote request ${clientRef}.`)}" target="_blank" rel="noopener">Message us on WhatsApp</a>` : ''}<a class="btn ghost" href="quote-request.html">Send another request</a></div>
  </article>`;
}

(async () => {
  try { company = (await getDoc('settings', 'main'))?.company || {}; } catch { company = {}; }
  form();
  hideLoader();
})();
