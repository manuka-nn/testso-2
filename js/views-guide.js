import { render, pageHead, can } from './core.js';
import { CLOUD, baseUrl } from './db.js';
import { esc } from './ui.js';

const S = [
  ['1', 'Set up once', [
    ['Company details', 'Settings → Company: phone, email, WhatsApp, address and bank details. These print on every quote and invoice PDF.', 'settings'],
    ['Team', 'Settings → Users & roles. Sales sees leads, quotes, customers and orders. Operations sees production, inventory and purchasing. Finance sees payments, expenses and profit.', 'settings?tab=users'],
    ['Suppliers', 'Purchasing → Suppliers. Add who you buy blanks and materials from, with lead times and terms.', 'suppliers'],
    ['Products', 'Products → Product library → New product. Type colours (Black, White) and sizes (S, M, L, XL) and every combination becomes a stock item with its own SKU.', 'products/new'],
    ['Opening stock', 'Purchasing → Purchase orders → New. Place the PO, then “Receive goods”. Stock goes up and the cost of each item is recorded.', 'purchase-orders/new'],
  ]],
  ['2', 'Win the work', [
    ['Leads', 'Requests from the website form arrive in Sales → Leads automatically. Add phone or walk-in enquiries with “New lead”.', 'leads'],
    ['Quote', 'Open a lead → Create quote. Add products, prices and your internal costs (never shown to the customer). The bar at the bottom shows your profit as you type.', 'quotes/new'],
    ['Send it', '“Send quote”, then WhatsApp or email the link. The customer can open it on their phone, download the PDF, and approve, decline or ask for changes. You get a notification either way.', 'quotes'],
    ['Convert', 'When a quote is approved, click “Convert to order”. Nothing is typed twice.', 'quotes?status=Approved'],
  ]],
  ['3', 'Deliver the order', [
    ['Confirm', 'Confirming an order reserves ready stock and issues the invoice. Download the invoice PDF from the order page.', 'orders'],
    ['Live tracking link', 'Every order has one secure link. Send it once — every status change and every update you post appears on it automatically. No login for the customer.', 'orders'],
    ['Production', 'Manufacturing → Production orders. Move each order along: awaiting materials → scheduled → in production → QC → ready.', 'production'],
    ['Dispatch', 'Set delivery to Packed, Dispatched, Delivered. Stock is deducted when it leaves.', 'orders'],
    ['Payments', 'Record each payment (advance, balance). The order completes when it is delivered and fully paid.', 'payments'],
  ]],
  ['4', 'Know your numbers', [
    ['Profit', 'Finance → Profit shows revenue, cost and profit for today or any period, split by manufacturing, wholesale and customization.', 'profit'],
    ['Expenses', 'Record rent, salaries, marketing and other costs so net profit is real.', 'expenses'],
    ['Reports', 'Sales, profit, inventory (dead and fast-moving stock), customers and operations.', 'reports'],
    ['Reorders', 'Delivered products are saved to the customer’s library, so repeat orders take one click — by you or by the customer in their portal.', 'reorders'],
  ]],
];

export function viewGuide() {
  render(`
    ${pageHead('How Seamline works', 'The whole flow, from first enquiry to profit. Click any step to go straight there.')}
    <div class="guide-flow">${['Lead', 'Quote', 'Approved', 'Order', 'Production', 'Delivered', 'Paid'].map(x => `<span>${x}</span>`).join('')}</div>
    ${S.map(([n, title, steps]) => `<section class="panel guide-section"><header><h2><span class="guide-n">${n}</span>${esc(title)}</h2></header>
      <ol class="guide-steps">${steps.map(([h, p, link]) => `<li><a href="#/${link}"><strong>${esc(h)}</strong><span>${esc(p)}</span></a></li>`).join('')}</ol></section>`).join('')}
    <section class="panel"><header><h2>Customer pages</h2></header>
      <ul class="link-list">
        <li><div><strong>Quote request form</strong><p class="muted small">Put this link on your website, Instagram bio and WhatsApp Business profile.</p></div><a class="btn sm ghost" href="quote-request.html" target="_blank" rel="noopener">Open</a></li>
        <li><div><strong>Customer portal</strong><p class="muted small">For regular customers: orders, quotes, invoices, reorders and the wholesale catalogue. Enable it from a customer’s profile.</p></div><a class="btn sm ghost" href="portal.html" target="_blank" rel="noopener">Open</a></li>
      </ul>
      ${CLOUD ? '' : `<p class="callout warn small">You are in local mode — customer links only open in this browser. ${can('settings') ? 'See Settings → Cloud to connect Supabase.' : ''}</p>`}
      <p class="muted small">Public address: ${esc(baseUrl())}</p>
    </section>`);
}
