// Public, no-login page: live order tracking (?t=token) and quotes (?q=token).
import { getDoc, sendInbox, watch } from './publicstore.js';
import { esc, toast, fmtDateTime } from './ui.js';
import { trackingHtml, quoteCustomerHtml, quoteRespond } from './shared.js';
import { downloadPdf } from './pdf.js';

const P = new URLSearchParams(location.search);
const orderToken = P.get('t');
const quoteToken = P.get('q');
const host = document.getElementById('page');
let lastJson = '', lastCheck = null, current = null;

function hideLoader() { const l = document.getElementById('loader'); if (l && !l.classList.contains('done')) { l.classList.add('done'); setTimeout(() => l.remove(), 700); } }

async function company() { try { return (await getDoc('settings', 'main'))?.company || {}; } catch { return {}; } }
async function invalid(kind, error = '') {
  const s = await company();
  const wa = String(s.whatsapp || '').replace(/\D/g, '');
  document.title = `Link not valid · ${s.company || 'Seamline'}`;
  host.innerHTML = `<article class="track invalid enter">
    <h1>This ${kind} link isn’t available</h1>
    <p>${error ? esc(error) : 'It may have been replaced with a new link, or copied incompletely. Ask us to send you the latest link.'}</p>
    <div class="btn-row">${wa ? `<a class="btn primary" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">WhatsApp us</a>` : ''}${s.email ? `<a class="btn ghost" href="mailto:${esc(s.email)}">Email</a>` : ''}</div>
  </article>`;
}
function stamp() {
  const el = document.getElementById('stamp');
  if (el && lastCheck) el.textContent = `Checked for updates ${fmtDateTime(lastCheck)}`;
}

async function renderOrder(first) {
  const doc = await getDoc('order', orderToken);
  lastCheck = new Date();
  if (!doc) { current = null; return invalid('tracking'); }
  const json = JSON.stringify(doc);
  if (json !== lastJson) {
    const changed = !!lastJson;
    lastJson = json; current = doc;
    document.title = `Order ${doc.view.number} · ${doc.company?.company || 'Seamline'}`;
    host.innerHTML = trackingHtml(doc, { live: true }) + '<p class="share-line"><span id="stamp" class="muted small"></span></p>';
    host.firstElementChild.classList.add(first ? 'enter' : 'updated');
    if (changed) toast('Your order has been updated');
  }
  stamp();
}

async function renderQuote(first) {
  const doc = await getDoc('quote', quoteToken);
  lastCheck = new Date();
  if (!doc || !doc.doc) { current = null; return invalid('quote'); }
  const sent = sessionStorage.getItem(`sl.responded.${quoteToken}`);
  doc.pending = !!sent && ['Sent', 'Viewed'].includes(doc.status) && sent === doc.status;
  if (sent && !doc.pending) sessionStorage.removeItem(`sl.responded.${quoteToken}`);
  const json = JSON.stringify(doc);
  if (json !== lastJson) {
    lastJson = json; current = doc;
    document.title = `Quote ${doc.doc.number} · ${doc.company?.company || 'Seamline'}`;
    host.innerHTML = quoteCustomerHtml(doc) + '<p class="share-line"><span id="stamp" class="muted small"></span></p>';
    host.firstElementChild.classList.add(first ? 'enter' : 'updated');
  }
  if (first && doc.status === 'Sent' && !sessionStorage.getItem(`sl.viewed.${quoteToken}`)) {
    sessionStorage.setItem(`sl.viewed.${quoteToken}`, '1');
    sendInbox('quote_response', { token: quoteToken, action: 'viewed' }).catch(() => {});
  }
  stamp();
}

host.addEventListener('click', async e => {
  const pdfBtn = e.target.closest('[data-pdf]');
  if (pdfBtn && current) {
    pdfBtn.disabled = true;
    try { await downloadPdf(pdfBtn.dataset.pdf === 'invoice' ? current.invoice : current.doc); toast('PDF downloaded'); }
    catch (ex) { toast(ex.message, 'error'); }
    finally { pdfBtn.disabled = false; }
    return;
  }
  const qb = e.target.closest('[data-quote]');
  if (qb && current) {
    const status = current.status;
    quoteRespond(qb.dataset.quote, async (action, message) => {
      await sendInbox('quote_response', { token: quoteToken, action, message: message || '' });
      sessionStorage.setItem(`sl.responded.${quoteToken}`, status);
    }, () => { lastJson = ''; refresh(); });
  }
});

async function refresh(first = false) {
  try {
    if (orderToken) await renderOrder(first);
    else if (quoteToken) await renderQuote(first);
    else await invalid('tracking');
  } catch (e) {
    console.error(e);
    if (first) await invalid(orderToken ? 'tracking' : 'quote', e.message);
  } finally { hideLoader(); }
}

refresh(true);
watch(() => refresh(), 15);
