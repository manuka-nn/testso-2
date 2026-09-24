// Downloadable PDF quotes and invoices (jsPDF + autotable, bundled in /vendor).
// Works from a plain "document" object (S.quoteDoc / S.invoiceDoc), so the
// staff app, the customer portal and the public links all produce the same PDF.

let logoCache = null;
async function logo() {
  if (logoCache !== null) return logoCache;
  try {
    const url = new URL('assets/logo-black.png', document.baseURI).href;
    const blob = await (await fetch(url)).blob();
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = dataUrl; });
    logoCache = { dataUrl, ratio: img.naturalHeight / img.naturalWidth };
  } catch { logoCache = false; }
  return logoCache;
}

// Standard PDF fonts only cover Latin-1; replace typographic characters.
const clean = s => String(s ?? '').replace(/[—–−]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[·•]/g, '-').replace(/×/g, 'x').replace(/…/g, '...').replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
const rs = n => `Rs. ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;
const dt = d => (d ? new Date(String(d).length === 10 ? `${d}T12:00:00` : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '-');

export async function buildPdf(doc) {
  const JsPDF = window.jspdf?.jsPDF;
  if (!JsPDF) throw new Error('The PDF library did not load. Check that the vendor folder is present.');
  const pdf = new JsPDF({ unit: 'mm', format: 'a4' });
  if (typeof pdf.autoTable !== 'function') throw new Error('The PDF table plugin did not load.');
  const W = 210, M = 16;
  const c = doc.company || {};
  const isQuote = doc.type === 'quote';
  const ink = [10, 10, 10], grey = [110, 110, 110], line = [215, 215, 215];

  // header band
  pdf.setFillColor(...ink); pdf.rect(0, 0, W, 4, 'F');
  const lg = await logo();
  let y = 16;
  if (lg) { const w = 58; pdf.addImage(lg.dataUrl, 'PNG', M, y - 4, w, w * lg.ratio); }
  else { pdf.setFont('helvetica', 'bolditalic'); pdf.setFontSize(24); pdf.text(clean(c.company || 'SEAMLINE').toUpperCase(), M, y + 6); }
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(22); pdf.setTextColor(...ink);
  pdf.text(isQuote ? 'QUOTATION' : 'INVOICE', W - M, y + 2, { align: 'right' });
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(...grey);
  const meta = isQuote
    ? [['Quote no.', doc.number], ['Date', dt(doc.date)], ['Valid until', dt(doc.validUntil)]]
    : [['Invoice no.', doc.number], ['Order no.', doc.orderNumber], ['Issued', dt(doc.date)], ['Due', dt(doc.dueAt)]];
  let my = y + 9;
  meta.forEach(([k, v]) => { pdf.setTextColor(...grey); pdf.text(clean(k), W - M - 70, my); pdf.setTextColor(...ink); pdf.text(clean(v || '-'), W - M, my, { align: 'right' }); my += 5; });

  // company block
  y = 16 + (lg ? 58 * lg.ratio : 10) + 4;
  pdf.setFontSize(9); pdf.setTextColor(...grey);
  const companyLines = [c.legalName || c.company, c.address, [c.phone, c.email].filter(Boolean).join('   ')].filter(Boolean).map(clean);
  companyLines.forEach(t => { pdf.text(pdf.splitTextToSize(t, 95), M, y); y += 4.4 * pdf.splitTextToSize(t, 95).length; });
  y = Math.max(y, my) + 6;

  // stitched seam
  pdf.setDrawColor(...ink); pdf.setLineWidth(0.5); pdf.setLineDashPattern([1.6, 1.2], 0); pdf.line(M, y, W - M, y); pdf.setLineDashPattern([], 0);
  y += 8;

  // bill to
  const cu = doc.customer || {};
  pdf.setFontSize(8.5); pdf.setTextColor(...grey); pdf.text(isQuote ? 'PREPARED FOR' : 'BILL TO', M, y);
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11.5); pdf.setTextColor(...ink); pdf.text(clean(cu.name || '-'), M, y + 6);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(60, 60, 60);
  let by = y + 11;
  [cu.contact, cu.address, [cu.phone, cu.email].filter(Boolean).join('   ')].filter(Boolean).forEach(t => { const l = pdf.splitTextToSize(clean(t), 100); pdf.text(l, M, by); by += 4.6 * l.length; });

  if (!isQuote && doc.status) {
    const st = doc.status.toUpperCase();
    const paid = st === 'PAID';
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(10);
    const tw = pdf.getTextWidth(st) + 10;
    pdf.setDrawColor(...ink); pdf.setLineWidth(0.6);
    if (paid) { pdf.setFillColor(...ink); pdf.roundedRect(W - M - tw, y - 1, tw, 9, 1.5, 1.5, 'F'); pdf.setTextColor(255, 255, 255); }
    else { pdf.roundedRect(W - M - tw, y - 1, tw, 9, 1.5, 1.5, 'S'); pdf.setTextColor(...ink); }
    pdf.text(st, W - M - tw / 2, y + 5, { align: 'center' });
  }
  y = by + 6;

  // items
  pdf.autoTable({
    startY: y, margin: { left: M, right: M },
    head: [['Item', 'Qty', 'Unit price', 'Amount']],
    body: (doc.items || []).map(i => [{ content: clean(i.name) + (i.detail ? `\n${clean(i.detail)}` : '') }, Number(i.qty).toLocaleString('en-US'), rs(i.unitPrice), rs(i.amount)]),
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 9.5, cellPadding: { top: 3, bottom: 3, left: 2.5, right: 2.5 }, textColor: ink, lineColor: line, lineWidth: { bottom: 0.2 } },
    headStyles: { fillColor: ink, textColor: [255, 255, 255], fontStyle: 'bold', fontSize: 8.5, lineWidth: 0 },
    columnStyles: { 0: { cellWidth: 'auto' }, 1: { halign: 'right', cellWidth: 20 }, 2: { halign: 'right', cellWidth: 32 }, 3: { halign: 'right', cellWidth: 34 } },
    didParseCell: h => { if (h.section === 'head' && h.column.index > 0) h.cell.styles.halign = 'right'; },
  });
  y = pdf.lastAutoTable.finalY + 6;

  // totals
  const t = doc.totals || {};
  const rows = [['Subtotal', rs(t.subtotal)]];
  if (t.discount) rows.push(['Discount', `- ${rs(t.discount)}`]);
  if (t.deliveryCharge) rows.push(['Delivery', rs(t.deliveryCharge)]);
  if (t.tax) rows.push([`Tax (${t.taxRate}%)`, rs(t.tax)]);
  const tx = W - M - 80;
  if (y > 250) { pdf.addPage(); y = 20; }
  pdf.setFontSize(9.5); pdf.setFont('helvetica', 'normal');
  rows.forEach(([k, v]) => { pdf.setTextColor(...grey); pdf.text(k, tx, y); pdf.setTextColor(...ink); pdf.text(v, W - M, y, { align: 'right' }); y += 5.5; });
  pdf.setFillColor(...ink); pdf.rect(tx - 3, y - 3.5, 80 + 3, 10, 'F');
  pdf.setTextColor(255, 255, 255); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11);
  pdf.text('Total', tx, y + 3); pdf.text(rs(t.total), W - M - 2, y + 3, { align: 'right' });
  y += 12;
  if (!isQuote) {
    pdf.setFontSize(9.5); pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...grey); pdf.text('Paid', tx, y); pdf.setTextColor(...ink); pdf.text(rs(t.paid), W - M, y, { align: 'right' }); y += 5.5;
    pdf.setFont('helvetica', 'bold'); pdf.text('Balance due', tx, y); pdf.text(rs(t.balance), W - M, y, { align: 'right' }); y += 8;
  }

  // terms & notes
  const blocks = [];
  if (isQuote) {
    blocks.push(['Estimated production time', doc.productionDays ? `${doc.productionDays} days after approval` : 'To be confirmed']);
    if (doc.paymentTerms) blocks.push(['Payment terms', doc.paymentTerms]);
    if (doc.notes) blocks.push(['Notes', doc.notes]);
  } else {
    if (doc.paymentTerms) blocks.push(['Payment terms', doc.paymentTerms]);
    if (c.bankDetails) blocks.push(['Bank details', c.bankDetails]);
    if (doc.notes) blocks.push(['Notes', doc.notes]);
  }
  y += 2;
  for (const [k, v] of blocks) {
    const lines = pdf.splitTextToSize(clean(v), W - 2 * M);
    if (y + 6 + lines.length * 4.4 > 280) { pdf.addPage(); y = 20; }
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8.5); pdf.setTextColor(...grey); pdf.text(k.toUpperCase(), M, y);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(...ink); pdf.text(lines, M, y + 5);
    y += 9 + lines.length * 4.4;
  }

  // footer on every page
  const pages = pdf.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    pdf.setPage(p);
    pdf.setDrawColor(...ink); pdf.setLineWidth(0.3); pdf.setLineDashPattern([1.6, 1.2], 0); pdf.line(M, 284, W - M, 284); pdf.setLineDashPattern([], 0);
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...grey);
    pdf.text(clean(isQuote ? `This quotation is valid until ${dt(doc.validUntil)}.` : (c.invoiceNote || 'Thank you for your business.')), M, 289);
    pdf.text(`${clean(doc.number)}  -  Page ${p} of ${pages}`, W - M, 289, { align: 'right' });
  }
  return pdf;
}

export const pdfName = doc => `${doc.type === 'quote' ? 'Quotation' : 'Invoice'}-${doc.number}.pdf`;

export async function downloadPdf(doc) {
  const pdf = await buildPdf(doc);
  pdf.save(pdfName(doc));
}

// Shares the PDF file itself where the device supports it (phones: WhatsApp, Mail…).
export async function sharePdf(doc, text = '') {
  const pdf = await buildPdf(doc);
  const file = new File([pdf.output('blob')], pdfName(doc), { type: 'application/pdf' });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: pdfName(doc), text }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  pdf.save(pdfName(doc));
  return 'downloaded';
}
export const canShareFiles = () => { try { return !!navigator.canShare?.({ files: [new File(['x'], 'x.pdf', { type: 'application/pdf' })] }); } catch { return false; } };
