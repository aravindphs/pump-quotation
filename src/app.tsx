import React, { useState, useEffect, useMemo, useRef, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { createPortal } from 'react-dom';
import LOGO from './logo';

/* =========================================================
   TYPES
   ========================================================= */
type Status = 'Draft' | 'Sent' | 'Accepted' | 'Rejected';
type Mode = 'Included' | 'Extra';
const STATUSES: Status[] = ['Draft', 'Sent', 'Accepted', 'Rejected'];

interface Settings {
  companyName: string;
  unitLine: string;
  address: string;
  phone: string;
  email: string;
  gstin: string;
  logo: string;
  prefix: string;
  startNumber: number;
  validityDays: number;
  numFormat: 'en-IN' | 'en-US';
  warrantyPump: string;
  warrantyPanel: string;
  warrantyDrive: string;
  terms: string;
  goodsPct: number;
  goodsGst: number;
  serviceGst: number;
}

interface Quotation {
  id: string;
  number: string;
  date: string; // ISO yyyy-mm-dd
  validity: number;
  validUntil: string;
  status: Status;
  createdAt: number;
  updatedAt: number;
  total: number;
  customer: { name: string; mobile: string; address: string; district: string; pincode: string };
  pump: { company: string; hp: string };
  panel: { company: string; wattage: string; qty: string; kw: string; kwManual: boolean };
  drive: { company: string; hp: string; kw: string };
  structure: { type: string; mode: Mode };
  installation: Mode;
  transportation: Mode;
  price: string;
  warranty: { pump: string; panel: string; drive: string };
  terms: string;
}

interface Calc {
  price: number;
  gst: number;
  total: number;
  advance: number;
  balance: number;
}

type View =
  | { name: 'dashboard' }
  | { name: 'list'; query: string }
  | { name: 'settings' }
  | { name: 'editor'; key: string; initial: Quotation; exists: boolean };

type ToastFn = (msg: string, kind?: 'ok' | 'err') => void;

/* =========================================================
   DEFAULTS
   ========================================================= */
const DEFAULT_TERMS = [
  'Quotation validity is {validity} days from the quotation date.',
  'Prices are subject to applicable taxes.',
  '80% advance payment is required before material procurement / commencement of work.',
  'Remaining 20% is payable after installation and commissioning.',
  'Final pump and solar PV sizing is subject to site conditions and technical feasibility.',
  'Civil work or additional work outside the quotation will be charged separately.',
  "Warranty is subject to respective manufacturer's terms and conditions.",
  'Delivery and installation timelines will be confirmed after order confirmation.',
].join('\n');

const DEFAULT_SETTINGS: Settings = {
  companyName: 'N SQUARE ENERGIES',
  unitLine: 'A Unit of ZetaCorp Solutions Private Limited',
  address: 'Coimbatore, Tamil Nadu, India',
  phone: '8838098525',
  email: '',
  gstin: '',
  logo: LOGO,
  prefix: 'NSE/SP',
  startNumber: 1,
  validityDays: 15,
  numFormat: 'en-IN',
  warrantyPump: '2 Years',
  warrantyPanel: '30 Years',
  warrantyDrive: '2 Years',
  terms: DEFAULT_TERMS,
  goodsPct: 70,
  goodsGst: 5,
  serviceGst: 18,
};

const KEYS = { quotes: 'nse_sp_quotations_v1', settings: 'nse_sp_settings_v1' };

/* =========================================================
   HELPERS
   ========================================================= */
function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch (e) {
    return fallback;
  }
}
function saveJSON(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}
function storageWorks(): boolean {
  try {
    localStorage.setItem('nse_test', '1');
    localStorage.removeItem('nse_test');
    return true;
  } catch (e) {
    return false;
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad2 = (n: number) => String(n).padStart(2, '0');
function todayISO(): string {
  const d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return dt.getFullYear() + '-' + pad2(dt.getMonth() + 1) + '-' + pad2(dt.getDate());
}
function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return d + '/' + m + '/' + y;
}
function num(s: string | number): number {
  if (typeof s === 'number') return s;
  const t = String(s).replace(/,/g, '').trim();
  if (t === '') return NaN;
  return Number(t);
}
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;

function autoKw(wattage: string, qty: string): string {
  const w = num(wattage);
  const n = num(qty);
  if (!(w > 0 && n > 0)) return '';
  return String(round3((w * n) / 1000));
}

function normMobile(raw: string): string {
  let d = raw.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : '';
}
function showMobile(raw: string): string {
  const m = normMobile(raw);
  return m ? '+91 ' + m.slice(0, 5) + ' ' + m.slice(5) : raw;
}

/** GST is calculated internally with a goods/service split. Never shown to the customer. */
function calc(priceStr: string, s: Settings): Calc {
  const price = num(priceStr);
  if (!(price > 0)) return { price: 0, gst: 0, total: 0, advance: 0, balance: 0 };
  const goodsValue = (price * s.goodsPct) / 100;
  const goodsGst = (goodsValue * s.goodsGst) / 100;
  const serviceValue = (price * (100 - s.goodsPct)) / 100;
  const serviceGst = (serviceValue * s.serviceGst) / 100;
  const gst = round2(goodsGst + serviceGst);
  const total = round2(price + gst);
  const advance = round2((total * 80) / 100);
  const balance = round2(total - advance);
  return { price: round2(price), gst, total, advance, balance };
}

function money(n: number, dec: number, locale: string): string {
  return '\u20B9' + n.toLocaleString(locale, { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function decFor(values: number[]): number {
  return values.some((v) => !Number.isInteger(v)) ? 2 : 0;
}

function nextNumber(quotes: Quotation[], s: Settings, dateISO: string): string {
  const base = s.prefix + '/' + dateISO.slice(0, 4) + '/';
  let max = 0;
  for (const q of quotes) {
    if (q.number.startsWith(base)) {
      const n = parseInt(q.number.slice(base.length), 10);
      if (!isNaN(n) && n > max) max = n;
    }
  }
  const seq = Math.max(s.startNumber, max + 1);
  return base + String(seq).padStart(4, '0');
}

function hpText(v: string): string {
  return v.trim() ? v.trim() + ' HP' : '\u2014';
}
function orDash(v: string): string {
  return v.trim() ? v.trim() : '\u2014';
}
function termsList(q: Quotation): string[] {
  return q.terms
    .split('\n')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.split('{validity}').join(String(q.validity)));
}

function blankQuotation(s: Settings, quotes: Quotation[], sample: boolean): Quotation {
  const date = todayISO();
  const q: Quotation = {
    id: uid(),
    number: nextNumber(quotes, s, date),
    date,
    validity: s.validityDays,
    validUntil: addDays(date, s.validityDays),
    status: 'Draft',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    total: 0,
    customer: { name: '', mobile: '', address: '', district: '', pincode: '' },
    pump: { company: '', hp: '' },
    panel: { company: '', wattage: '', qty: '', kw: '', kwManual: false },
    drive: { company: '', hp: '', kw: '' },
    structure: { type: 'GI Structure', mode: 'Included' },
    installation: 'Included',
    transportation: 'Included',
    price: '',
    warranty: { pump: s.warrantyPump, panel: s.warrantyPanel, drive: s.warrantyDrive },
    terms: s.terms,
  };
  if (sample) {
    q.customer = { name: 'Sample Farmer', mobile: '9876543210', address: '', district: 'Coimbatore', pincode: '' };
    q.pump = { company: 'CRI', hp: '5' };
    q.panel = { company: 'Adani', wattage: '620', qty: '9', kw: autoKw('620', '9'), kwManual: false };
    q.drive = { company: 'INVT', hp: '5', kw: '4' };
    q.price = '100000';
  }
  return q;
}

function validate(q: Quotation, s: Settings): Record<string, string> {
  const e: Record<string, string> = {};
  if (!q.customer.name.trim()) e['customer.name'] = 'Enter the customer name';
  if (!q.customer.mobile.trim()) e['customer.mobile'] = 'Enter the mobile number';
  else if (!normMobile(q.customer.mobile)) e['customer.mobile'] = 'Enter a valid 10-digit mobile number';
  if (q.customer.pincode.trim() && !/^\d{6}$/.test(q.customer.pincode.trim())) e['customer.pincode'] = 'Pincode must be 6 digits';

  if (!q.pump.company.trim()) e['pump.company'] = 'Enter the pump company';
  if (!q.pump.hp.trim()) e['pump.hp'] = 'Enter the pump capacity';
  else if (!(num(q.pump.hp) > 0)) e['pump.hp'] = 'Must be greater than 0';

  if (!q.panel.company.trim()) e['panel.company'] = 'Enter the panel company';
  if (!q.panel.wattage.trim()) e['panel.wattage'] = 'Enter the panel wattage';
  else if (!(num(q.panel.wattage) > 0)) e['panel.wattage'] = 'Must be greater than 0';
  if (!q.panel.qty.trim()) e['panel.qty'] = 'Enter the number of panels';
  else if (!(num(q.panel.qty) > 0) || !Number.isInteger(num(q.panel.qty))) e['panel.qty'] = 'Must be a whole number above 0';
  if (q.panel.kw.trim() && !(num(q.panel.kw) > 0)) e['panel.kw'] = 'Must be greater than 0';

  if (!q.drive.company.trim()) e['drive.company'] = 'Enter the drive company';

  if (!q.price.trim()) e['price'] = 'Enter the project price';
  else if (!(num(q.price) > 0)) e['price'] = 'Price must be greater than 0';
  else {
    const c = calc(q.price, s);
    if (c.gst < 0 || c.total < 0 || !isFinite(c.total)) e['price'] = 'GST calculation is invalid \u2013 check GST settings';
  }
  return e;
}

function waMessage(q: Quotation, s: Settings, c: Calc): string {
  const dec = decFor([c.total]);
  const kw = q.panel.kw.trim() ? q.panel.kw.trim() + ' kW' : '-';
  return (
    'Dear ' + q.customer.name.trim() + ',\n\n' +
    'Thank you for considering ' + s.companyName + ' for your Solar Agriculture Pump project.\n\n' +
    'Pump Capacity: ' + q.pump.hp.trim() + ' HP\n' +
    'Solar Capacity: ' + kw + '\n\n' +
    'Quotation Total: ' + money(c.total, dec, s.numFormat) + '\n\n' +
    'Payment Terms:\n80% Advance\n20% Balance after Installation\n\n' +
    'For more details:\n' + s.companyName + '\n' + s.phone
  );
}

/* =========================================================
   PDF / PRINT
   ========================================================= */
// Wait until web fonts and every image inside the node have loaded, so the
// capture never races ahead of content that is still painting.
async function waitForAssets(node: HTMLElement): Promise<void> {
  try {
    const fonts = (document as any).fonts;
    if (fonts && fonts.ready) await Promise.race([fonts.ready, new Promise((r) => setTimeout(r, 3000))]);
  } catch {}
  const imgs = Array.from(node.querySelectorAll('img'));
  await Promise.all(
    imgs.map(
      (im) =>
        (im as HTMLImageElement).complete
          ? Promise.resolve()
          : new Promise<void>((res) => {
              const done = () => res();
              im.addEventListener('load', done, { once: true });
              im.addEventListener('error', done, { once: true });
              setTimeout(done, 3000);
            })
    )
  );
}

// Mobile browsers (notably iOS Safari) cap how large a canvas can be before it
// silently renders blank and toDataURL() returns an empty image. Probe the
// device with a throwaway canvas of the target size and back off until the
// device can actually produce a real image at that size.
function canvasWorksAt(width: number, height: number): boolean {
  try {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const ctx = c.getContext('2d');
    if (!ctx) return false;
    ctx.fillStyle = '#ff0000';
    ctx.fillRect(width - 2, height - 2, 2, 2);
    // A blank/failed canvas reads back transparent-black at the far corner.
    const px = ctx.getImageData(width - 1, height - 1, 1, 1).data;
    if (px[0] < 200) return false;
    const url = c.toDataURL('image/jpeg', 0.5);
    return typeof url === 'string' && url.length > 1000;
  } catch {
    return false;
  }
}

function pickScale(node: HTMLElement): number {
  const w = node.offsetWidth || 794;
  const h = node.offsetHeight || 1123;
  for (const s of [3, 2.5, 2, 1.5, 1]) {
    if (canvasWorksAt(Math.round(w * s), Math.round(h * s))) return s;
  }
  return 1;
}

async function buildPdf(node: HTMLElement, title: string): Promise<ArrayBuffer> {
  const w = window as any;
  if (!w.html2canvas || !w.jspdf) throw new Error('PDF libraries did not load. Check your internet connection.');

  await waitForAssets(node);

  // Try progressively smaller scales; if a device produces a blank capture at
  // one scale, drop down and retry rather than handing back an empty PDF.
  let scale = pickScale(node);
  let img = '';
  for (; scale >= 1; scale -= scale > 2 ? 1 : 0.5) {
    const canvas = await w.html2canvas(node, {
      scale,
      backgroundColor: '#ffffff',
      useCORS: true,
      imageTimeout: 15000,
      logging: false,
      onclone: (doc: Document) => {
        const el = doc.getElementById('print-root');
        if (el) {
          el.style.position = 'static';
          el.style.left = '0';
        }
      },
    });
    const candidate = canvas.toDataURL('image/jpeg', 0.95);
    // 'data:,' or a suspiciously tiny string means the device failed to render.
    if (candidate && candidate.length > 5000) {
      img = candidate;
      break;
    }
  }
  if (!img) throw new Error('The device could not render the quotation image. Try Print instead, or use a different browser.');

  const pdf = new w.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  pdf.addImage(img, 'JPEG', 0, 0, 210, 297);
  pdf.setProperties({ title });
  return pdf.output('arraybuffer');
}

async function deliverFile(filename: string, data: ArrayBuffer, mime: string): Promise<'saved' | 'declined'> {
  const w = window as any;
  try {
    const dl = w.claude && w.claude.use ? await w.claude.use('downloads') : null;
    if (dl) {
      await dl.save({ filename, data });
      return 'saved';
    }
  } catch (err: any) {
    if (err && err.code === 'declined') return 'declined';
    // otherwise fall through to a normal browser download
  }
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return 'saved';
}

function pdfFileName(q: Quotation): string {
  const n = q.number.split('/').join('-');
  const c = q.customer.name.trim().replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
  return n + (c ? '_' + c : '') + '.pdf';
}

/* =========================================================
   SMALL UI PIECES
   ========================================================= */
const ICONS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  search: 'M20 20l-3.5-3.5M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  chat: 'M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 20.5l1.6-5.4A8.4 8.4 0 1 1 21 11.5z',
  copy: 'M9 9h11v11H9zM5 15V4h11',
  trash: 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  save: 'M5 3h11l3 3v15H5zM8 3v6h8V3M8 21v-7h8v7',
  back: 'M19 12H5M12 19l-7-7 7-7',
  home: 'M3 11l9-8 9 8M5 10v10h14V10',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  form: 'M5 3h14v18H5zM9 8h6M9 12h6M9 16h4',
  warn: 'M12 3l10 18H2zM12 10v5M12 18h.01',
};
function Ic({ n, size = 18 }: { n: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path d={ICONS[n]} />
    </svg>
  );
}

function Card({ title, children, right }: { title: string; children: any; right?: any }) {
  return (
    <section className="card p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="sec-title">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

interface TFProps {
  label: string;
  value: string;
  onChange: (v: string) => void;
  req?: boolean;
  err?: string;
  onBlur?: () => void;
  placeholder?: string;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel';
  suffix?: string;
  prefix?: string;
  maxLength?: number;
  className?: string;
  hint?: string;
}
function TF(p: TFProps) {
  return (
    <label className={'block ' + (p.className || '')}>
      <span className="lbl">
        {p.label}
        {p.req && <span className="req"> *</span>}
      </span>
      <span className="relative block">
        {p.prefix && <span className="fix left-3">{p.prefix}</span>}
        <input
          className={'inp' + (p.err ? ' inp-err' : '')}
          style={{ paddingLeft: p.prefix ? 30 : undefined, paddingRight: p.suffix ? 44 : undefined }}
          value={p.value}
          onChange={(e) => p.onChange(e.target.value)}
          onBlur={p.onBlur}
          placeholder={p.placeholder}
          inputMode={p.inputMode}
          maxLength={p.maxLength}
          autoComplete="off"
        />
        {p.suffix && <span className="fix right-3">{p.suffix}</span>}
      </span>
      {p.hint && !p.err && <span className="hint">{p.hint}</span>}
      {p.err && (
        <span data-err="1" className="err">
          {p.err}
        </span>
      )}
    </label>
  );
}

function SelectField({ label, value, onChange, options, className }: { label: string; value: string; onChange: (v: string) => void; options: string[]; className?: string }) {
  return (
    <label className={'block ' + (className || '')}>
      <span className="lbl">{label}</span>
      <select className="inp" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/* =========================================================
   QUOTATION SHEET (customer-facing A4 layout)
   ========================================================= */
function Sheet({ q, s, c }: { q: Quotation; s: Settings; c: Calc }) {
  const dec = decFor([c.price, c.gst, c.total, c.advance, c.balance]);
  const m = (n: number) => money(n, dec, s.numFormat);
  const kw = q.panel.kw.trim() ? q.panel.kw.trim() + ' kW' : '\u2014';
  const driveCap = (q.drive.hp.trim() ? q.drive.hp.trim() + ' HP' : '\u2014') + (q.drive.kw.trim() ? ' / ' + q.drive.kw.trim() + ' kW' : '');
  const left: [string, string][] = [
    ['Pump Company', orDash(q.pump.company)],
    ['Pump Capacity', hpText(q.pump.hp)],
    ['Panel Company', orDash(q.panel.company)],
    ['Panel Wattage', q.panel.wattage.trim() ? q.panel.wattage.trim() + ' W' : '\u2014'],
    ['Number of Panels', orDash(q.panel.qty)],
    ['Solar Capacity', kw],
  ];
  const right: [string, string][] = [
    ['Drive Company', orDash(q.drive.company)],
    ['Drive Capacity', driveCap],
    ['Structure', orDash(q.structure.type) + ' (' + q.structure.mode + ')'],
    ['Installation', q.installation],
    ['Transportation', q.transportation],
  ];
  const cu = q.customer;
  const terms = termsList(q);
  const contact: string[] = [];
  if (s.address.trim()) contact.push(s.address.trim());
  if (s.phone.trim()) contact.push('Phone: ' + s.phone.trim());
  if (s.email.trim()) contact.push('Email: ' + s.email.trim());
  if (s.gstin.trim()) contact.push('GSTIN: ' + s.gstin.trim());

  return (
    <div className="sheet">
      <div className="sh-top">
        <div className="sh-brand">
          {s.logo && <img className="sh-logo" src={s.logo} alt="" />}
          <div>
            <div className="sh-name">{s.companyName}</div>
            {s.unitLine.trim() && <div className="sh-unit">{s.unitLine}</div>}
          </div>
        </div>
        <div className="sh-contact">
          {contact.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      </div>
      <div className="sh-title">SOLAR AGRICULTURE PUMP QUOTATION</div>
      <div className="sh-meta">
        <div>
          <span className="k">Quotation No.</span>
          <span className="v">{q.number}</span>
        </div>
        <div>
          <span className="k">Date</span>
          <span className="v">{fmtDate(q.date)}</span>
        </div>
        <div>
          <span className="k">Valid Until</span>
          <span className="v">{fmtDate(q.validUntil)}</span>
        </div>
      </div>

      <div className="sh-body">
        <div>
          <div className="sec-h">Customer</div>
          <div className="cust">
            <div>
              <span className="k">Customer Name</span>
              <span className="v">{orDash(cu.name)}</span>
            </div>
            <div>
              <span className="k">Mobile</span>
              <span className="v">{cu.mobile.trim() ? showMobile(cu.mobile) : '\u2014'}</span>
            </div>
            <div className="span2">
              <span className="k">Address</span>
              <span className="v">{orDash(cu.address)}</span>
            </div>
            <div>
              <span className="k">District</span>
              <span className="v">{orDash(cu.district)}</span>
            </div>
            <div>
              <span className="k">Pincode</span>
              <span className="v">{orDash(cu.pincode)}</span>
            </div>
          </div>
        </div>

        <div>
          <div className="sec-h">System Details</div>
          <div className="two">
            <table className="tb">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {left.map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="b">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table className="tb">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {right.map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="b">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="two">
          <div>
            <div className="sec-h">Price Summary</div>
            <table className="tb">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="r">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Price</td>
                  <td className="r b">{m(c.price)}</td>
                </tr>
                <tr>
                  <td>GST</td>
                  <td className="r b">{m(c.gst)}</td>
                </tr>
                <tr className="tot">
                  <td>TOTAL</td>
                  <td className="r">{m(c.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <div className="sec-h">Payment Terms</div>
            <table className="tb">
              <thead>
                <tr>
                  <th>Payment</th>
                  <th className="r">%</th>
                  <th className="r">Amount</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    Advance
                    <span className="cap">Before material procurement / commencement of work</span>
                  </td>
                  <td className="r">80%</td>
                  <td className="r b">{m(c.advance)}</td>
                </tr>
                <tr>
                  <td>
                    Balance after Installation
                    <span className="cap">After installation and commissioning</span>
                  </td>
                  <td className="r">20%</td>
                  <td className="r b">{m(c.balance)}</td>
                </tr>
                <tr className="sum">
                  <td>Total</td>
                  <td className="r">100%</td>
                  <td className="r">{m(c.total)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="sec-h">Warranty</div>
          <table className="tb">
            <thead>
              <tr>
                <th>Product</th>
                <th>Warranty</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Solar Pump</td>
                <td className="b">{orDash(q.warranty.pump)}</td>
              </tr>
              <tr>
                <td>Solar Panels</td>
                <td className="b">{orDash(q.warranty.panel)}</td>
              </tr>
              <tr>
                <td>Solar Drive</td>
                <td className="b">{orDash(q.warranty.drive)}</td>
              </tr>
            </tbody>
          </table>
          <div className="note">Warranty is subject to respective manufacturer's terms and conditions.</div>
        </div>

        <div>
          <div className="sec-h">Terms &amp; Conditions</div>
          <div className="terms">
            {terms.map((t, i) => (
              <div className="t" key={i}>
                <b>{i + 1}.</b>
                <span>{t}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="sign">
          <div>
            <div className="fo">For {s.companyName}</div>
            <div className="line">Authorized Signatory</div>
          </div>
        </div>
      </div>

      <div className="sh-foot">
        <div>
          <b>{s.companyName} | Solar Agriculture Pump Solutions</b>
          <div>
            {s.address.trim() ? s.address.trim() : ''}
            {s.phone.trim() ? '  |  Phone: ' + s.phone.trim() : ''}
          </div>
        </div>
        <div>Page 1</div>
      </div>
    </div>
  );
}

/** Shrinks the A4 sheet to fit the available width for on-screen preview */
function Scaled({ children }: { children: any }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = w ? Math.min(1, w / 794) : 0.5;
  return (
    <div ref={ref} className="w-full">
      <div className="paper-frame" style={{ width: 794 * scale, height: 1123 * scale, margin: '0 auto' }}>
        <div style={{ width: 794, height: 1123, transform: 'scale(' + scale + ')', transformOrigin: 'top left' }}>{children}</div>
      </div>
    </div>
  );
}

/* =========================================================
   EDITOR
   ========================================================= */
function Editor(props: {
  initial: Quotation;
  exists: boolean;
  settings: Settings;
  onSave: (q: Quotation) => Quotation;
  onDuplicate: (q: Quotation) => void;
  onBack: () => void;
  toast: ToastFn;
}) {
  const { settings, toast } = props;
  const [q, setQRaw] = useState<Quotation>(props.initial);
  const [saved, setSaved] = useState(props.exists);
  const [dirty, setDirty] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [attempted, setAttempted] = useState(false);
  const [tab, setTab] = useState<'form' | 'preview'>('form');
  const [busy, setBusy] = useState(false);
  const [wa, setWa] = useState<{ msg: string; url: string } | null>(null);
  const [overflow, setOverflow] = useState(false);
  const [confirmBack, setConfirmBack] = useState(false);
  const [sampleOn, setSampleOn] = useState(false);

  const setQ = (fn: (p: Quotation) => Quotation) => {
    setQRaw(fn);
    setDirty(true);
  };
  const errors = useMemo(() => validate(q, settings), [q, settings]);
  const c = useMemo(() => calc(q.price, settings), [q.price, settings]);
  const shown = (k: string) => (attempted || touched[k] ? errors[k] : undefined);
  const blur = (k: string) => () => setTouched((t) => ({ ...t, [k]: true }));

  const upd = (sec: 'customer' | 'pump' | 'drive' | 'structure' | 'warranty', key: string, v: string) =>
    setQ((p) => ({ ...p, [sec]: { ...(p as any)[sec], [key]: v } }));
  const updPanel = (key: 'company' | 'wattage' | 'qty' | 'kw', v: string) =>
    setQ((p) => {
      const panel = { ...p.panel, [key]: v };
      if (key === 'kw') {
        panel.kwManual = v.trim() !== '';
        if (!panel.kwManual) panel.kw = autoKw(panel.wattage, panel.qty);
      } else if ((key === 'wattage' || key === 'qty') && !panel.kwManual) {
        panel.kw = autoKw(panel.wattage, panel.qty);
      }
      return { ...p, panel };
    });
  const resetKw = () => setQ((p) => ({ ...p, panel: { ...p.panel, kwManual: false, kw: autoKw(p.panel.wattage, p.panel.qty) } }));

  // Detect content that would spill past one A4 page
  useEffect(() => {
    const t = setTimeout(() => {
      const b = document.querySelector('#print-root .sh-body') as HTMLElement | null;
      if (b) setOverflow(b.scrollHeight > b.clientHeight + 1);
    }, 60);
    return () => clearTimeout(t);
  }, [q, settings]);

  const ensureValid = (): boolean => {
    setAttempted(true);
    if (Object.keys(errors).length) {
      setTab('form');
      toast('Please fix the highlighted fields', 'err');
      setTimeout(() => {
        const el = document.querySelector('[data-err="1"]');
        if (el && (el as any).scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 120);
      return false;
    }
    return true;
  };

  const persist = (): Quotation => {
    const s = props.onSave({ ...q, total: c.total, updatedAt: Date.now() });
    setQRaw(s);
    setSaved(true);
    setDirty(false);
    return s;
  };
  const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => setTimeout(r, 40)));

  const doSave = () => {
    if (!ensureValid()) return;
    const s = persist();
    toast('Saved ' + s.number);
  };

  const doPrint = async () => {
    if (!ensureValid()) return;
    persist();
    await nextFrame();
    try {
      window.print();
    } catch (e) {
      toast('Printing is not available here \u2013 use Download PDF instead', 'err');
    }
  };

  const doPdf = async () => {
    if (!ensureValid()) return;
    const s = persist();
    setBusy(true);
    try {
      await nextFrame();
      const node = document.querySelector('#print-root .sheet') as HTMLElement | null;
      if (!node) throw new Error('Quotation sheet not found');
      const buf = await buildPdf(node, s.number + ' - ' + s.customer.name);
      const r = await deliverFile(pdfFileName(s), buf, 'application/pdf');
      if (r === 'saved') toast('PDF ready: ' + pdfFileName(s));
      else toast('Download cancelled');
    } catch (e: any) {
      toast('Could not create the PDF: ' + (e && e.message ? e.message : 'unknown error'), 'err');
    } finally {
      setBusy(false);
    }
  };

  const doWhatsApp = () => {
    if (!ensureValid()) return;
    const s = persist();
    const cc = calc(s.price, settings);
    const msg = waMessage(s, settings, cc);
    const url = 'https://wa.me/91' + normMobile(s.customer.mobile) + '?text=' + encodeURIComponent(msg);
    let w: Window | null = null;
    try {
      w = window.open(url, '_blank');
    } catch (e) {
      w = null;
    }
    if (w) {
      try {
        w.opener = null;
      } catch (e) {
        /* ignore */
      }
    } else {
      setWa({ msg, url });
    }
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Message copied');
    } catch (e) {
      const ta = document.getElementById('wa-text') as HTMLTextAreaElement | null;
      if (ta) {
        ta.select();
        try {
          document.execCommand('copy');
          toast('Message copied');
          return;
        } catch (e2) {
          /* ignore */
        }
      }
      toast('Select the text and copy it manually', 'err');
    }
  };

  const goBack = () => {
    if (dirty && !confirmBack) {
      setConfirmBack(true);
      toast('You have unsaved changes \u2013 press Back again to discard them');
      setTimeout(() => setConfirmBack(false), 4000);
      return;
    }
    props.onBack();
  };

  const loadSample = () => {
    const sm = blankQuotation(settings, [], true);
    setQ((p) => ({ ...p, customer: sm.customer, pump: sm.pump, panel: sm.panel, drive: sm.drive, price: sm.price }));
    setSampleOn(true);
  };
  const clearForm = () => {
    const bl = blankQuotation(settings, [], false);
    setQ((p) => ({ ...p, customer: bl.customer, pump: bl.pump, panel: bl.panel, drive: bl.drive, price: '' }));
    setTouched({});
    setAttempted(false);
    setSampleOn(false);
  };

  const printRoot = document.getElementById('print-root');
  const dec = decFor([c.price, c.gst, c.total, c.advance, c.balance]);
  const m = (n: number) => money(n, dec, settings.numFormat);

  return (
    <div className="pb-28">
      {/* header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <button className="btn btn-ghost" onClick={goBack} aria-label="Back">
            <Ic n="back" />
            <span className="hidden sm:inline">Back</span>
          </button>
          <div className="min-w-0">
            <h1 className="page-title truncate">{saved ? 'Edit Quotation' : 'New Quotation'}</h1>
            <div className="text-sm muted truncate">
              {q.number} &middot; {fmtDate(q.date)} &middot; Valid until {fmtDate(q.validUntil)}
            </div>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <span className="muted">Status</span>
          <select className={'inp !w-auto !py-2 st st-' + q.status} value={q.status} onChange={(e) => setQ((p) => ({ ...p, status: e.target.value as Status }))}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button className="btn btn-outline" onClick={doPrint}>
          <Ic n="print" /> Print Quotation
        </button>
        <button className="btn btn-outline" onClick={doWhatsApp}>
          <Ic n="chat" /> Share on WhatsApp
        </button>
        {saved && (
          <button className="btn btn-outline" onClick={() => props.onDuplicate(q)}>
            <Ic n="copy" /> Duplicate Quotation
          </button>
        )}
        {!saved && (
          <button className="btn btn-ghost" onClick={sampleOn || q.customer.name ? clearForm : loadSample}>
            {sampleOn || q.customer.name ? 'Clear form' : 'Load sample data'}
          </button>
        )}
      </div>

      {overflow && (
        <div className="banner banner-warn mb-4">
          <Ic n="warn" />
          <span>The quotation is longer than one A4 page. Shorten the terms or long text fields so the PDF stays on a single page.</span>
        </div>
      )}

      {/* mobile tab switch */}
      <div className="lg:hidden mb-4 grid grid-cols-2 gap-2 seg">
        <button className={tab === 'form' ? 'on' : ''} onClick={() => setTab('form')}>
          <Ic n="form" /> Form
        </button>
        <button className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>
          <Ic n="eye" /> Preview
        </button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_520px] items-start">
        {/* FORM */}
        <div className={(tab === 'form' ? 'block' : 'hidden') + ' lg:block space-y-4'}>
          <Card title="Customer">
            <div className="grid gap-3 sm:grid-cols-2">
              <TF label="Customer Name" req value={q.customer.name} onChange={(v) => upd('customer', 'name', v)} err={shown('customer.name')} onBlur={blur('customer.name')} />
              <TF label="Mobile Number" req inputMode="tel" maxLength={15} value={q.customer.mobile} onChange={(v) => upd('customer', 'mobile', v)} err={shown('customer.mobile')} onBlur={blur('customer.mobile')} placeholder="10-digit mobile" />
              <TF className="sm:col-span-2" label="Address" value={q.customer.address} onChange={(v) => upd('customer', 'address', v)} />
              <TF label="District" value={q.customer.district} onChange={(v) => upd('customer', 'district', v)} />
              <TF label="Pincode" inputMode="numeric" maxLength={6} value={q.customer.pincode} onChange={(v) => upd('customer', 'pincode', v)} err={shown('customer.pincode')} onBlur={blur('customer.pincode')} />
            </div>
          </Card>

          <Card title="Pump">
            <div className="grid gap-3 sm:grid-cols-2">
              <TF label="Company / Brand" req value={q.pump.company} onChange={(v) => upd('pump', 'company', v)} err={shown('pump.company')} onBlur={blur('pump.company')} placeholder="e.g. CRI" />
              <TF label="Capacity" req inputMode="decimal" suffix="HP" value={q.pump.hp} onChange={(v) => upd('pump', 'hp', v)} err={shown('pump.hp')} onBlur={blur('pump.hp')} />
            </div>
          </Card>

          <Card title="Solar Panel">
            <div className="grid gap-3 sm:grid-cols-2">
              <TF label="Company / Brand" req value={q.panel.company} onChange={(v) => updPanel('company', v)} err={shown('panel.company')} onBlur={blur('panel.company')} placeholder="e.g. Adani" />
              <TF label="Wattage" req inputMode="numeric" suffix="W" value={q.panel.wattage} onChange={(v) => updPanel('wattage', v)} err={shown('panel.wattage')} onBlur={blur('panel.wattage')} />
              <TF label="Number of Panels" req inputMode="numeric" value={q.panel.qty} onChange={(v) => updPanel('qty', v)} err={shown('panel.qty')} onBlur={blur('panel.qty')} />
              <TF
                label="Total Solar Capacity"
                inputMode="decimal"
                suffix="kW"
                value={q.panel.kw}
                onChange={(v) => updPanel('kw', v)}
                err={shown('panel.kw')}
                onBlur={blur('panel.kw')}
                hint={q.panel.kwManual ? 'Manually set' : 'Calculated automatically (wattage \u00D7 panels \u00F7 1000)'}
              />
            </div>
            {q.panel.kwManual && (
              <button className="link mt-2" onClick={resetKw}>
                Reset to automatic value
              </button>
            )}
          </Card>

          <Card title="Drive">
            <div className="grid gap-3 sm:grid-cols-3">
              <TF label="Company / Brand" req value={q.drive.company} onChange={(v) => upd('drive', 'company', v)} err={shown('drive.company')} onBlur={blur('drive.company')} placeholder="e.g. INVT" />
              <TF label="Capacity" inputMode="decimal" suffix="HP" value={q.drive.hp} onChange={(v) => upd('drive', 'hp', v)} />
              <TF label="Capacity" inputMode="decimal" suffix="kW" value={q.drive.kw} onChange={(v) => upd('drive', 'kw', v)} />
            </div>
          </Card>

          <Card title="Project">
            <div className="grid gap-3 sm:grid-cols-2">
              <TF label="Structure Type" value={q.structure.type} onChange={(v) => upd('structure', 'type', v)} placeholder="e.g. GI Structure" />
              <SelectField label="Structure" value={q.structure.mode} onChange={(v) => upd('structure', 'mode', v)} options={['Included', 'Extra']} />
              <SelectField label="Installation" value={q.installation} onChange={(v) => setQ((p) => ({ ...p, installation: v as Mode }))} options={['Included', 'Extra']} />
              <SelectField label="Transportation" value={q.transportation} onChange={(v) => setQ((p) => ({ ...p, transportation: v as Mode }))} options={['Included', 'Extra']} />
            </div>
          </Card>

          <Card title="Price">
            <TF label="Project Price (before GST)" req inputMode="decimal" prefix={'\u20B9'} value={q.price} onChange={(v) => setQ((p) => ({ ...p, price: v.replace(/[^0-9.,]/g, '') }))} err={shown('price')} onBlur={blur('price')} placeholder="0" />
            <div className="mt-4 rounded-xl p-3 sm:p-4 summary">
              <div className="flex justify-between py-1">
                <span className="muted">Price</span>
                <span className="font-semibold">{m(c.price)}</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="muted">GST</span>
                <span className="font-semibold">{m(c.gst)}</span>
              </div>
              <div className="flex justify-between items-baseline pt-2 mt-1 border-t bd">
                <span className="font-bold">TOTAL</span>
                <span className="text-2xl font-extrabold accent">{m(c.total)}</span>
              </div>
            </div>
          </Card>

          <Card title="Payment">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="summary rounded-xl p-3">
                <div className="muted text-sm">80% Advance</div>
                <div className="text-lg font-bold">{m(c.advance)}</div>
              </div>
              <div className="summary rounded-xl p-3">
                <div className="muted text-sm">20% Balance after Installation</div>
                <div className="text-lg font-bold">{m(c.balance)}</div>
              </div>
            </div>
          </Card>

          <Card title="Warranty">
            <div className="grid gap-3 sm:grid-cols-3">
              <TF label="Solar Pump" value={q.warranty.pump} onChange={(v) => upd('warranty', 'pump', v)} />
              <TF label="Solar Panels" value={q.warranty.panel} onChange={(v) => upd('warranty', 'panel', v)} />
              <TF label="Solar Drive" value={q.warranty.drive} onChange={(v) => upd('warranty', 'drive', v)} />
            </div>
          </Card>
        </div>

        {/* PREVIEW */}
        <div className={(tab === 'preview' ? 'block' : 'hidden') + ' lg:block lg:sticky lg:top-20'}>
          <div className="muted text-sm mb-2 hidden lg:block">Live preview (A4)</div>
          <Scaled>
            <Sheet q={q} s={settings} c={c} />
          </Scaled>
        </div>
      </div>

      {/* sticky action bar */}
      <div className="actionbar">
        <div className="max-w-6xl mx-auto px-4 flex gap-3">
          <button className="btn btn-outline flex-1 justify-center" onClick={doSave}>
            <Ic n="save" /> Save
          </button>
          <button className="btn btn-primary flex-1 justify-center" onClick={doPdf} disabled={busy}>
            <Ic n="download" /> {busy ? 'Preparing\u2026' : 'Download PDF'}
          </button>
        </div>
      </div>

      {/* print root (hidden on screen, used for print + PDF) */}
      {printRoot && createPortal(<Sheet q={q} s={settings} c={c} />, printRoot)}

      {/* WhatsApp fallback */}
      {wa && (
        <div className="modal-bg" onClick={() => setWa(null)}>
          <div className="modal card p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="sec-title mb-2">Share on WhatsApp</h3>
            <p className="muted text-sm mb-3">WhatsApp could not be opened from here. Copy the message below and send it to the customer, or open WhatsApp directly.</p>
            <textarea id="wa-text" className="inp" rows={12} readOnly value={wa.msg} />
            <div className="flex flex-wrap gap-2 mt-3">
              <button className="btn btn-primary" onClick={() => copyText(wa.msg)}>
                <Ic n="copy" /> Copy message
              </button>
              <a className="btn btn-outline" href={wa.url} target="_blank" rel="noopener noreferrer">
                <Ic n="chat" /> Open WhatsApp
              </a>
              <button className="btn btn-ghost" onClick={() => setWa(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* =========================================================
   DASHBOARD
   ========================================================= */
function Dashboard(props: { quotes: Quotation[]; settings: Settings; go: (v: View) => void; onNew: () => void }) {
  const [term, setTerm] = useState('');
  const month = todayISO().slice(0, 7);
  const stats = [
    ['Total Quotations', props.quotes.length],
    ['This Month', props.quotes.filter((x) => x.date.startsWith(month)).length],
    ['Accepted', props.quotes.filter((x) => x.status === 'Accepted').length],
    ['Pending', props.quotes.filter((x) => x.status === 'Draft' || x.status === 'Sent').length],
  ] as [string, number][];
  return (
    <div>
      <h1 className="page-title mb-1">Solar Pump Quotations</h1>
      <p className="muted mb-5">Customer &rarr; Pump &rarr; Panel &rarr; Drive &rarr; Price &rarr; Quotation</p>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {stats.map(([k, v]) => (
          <div key={k} className="card p-4">
            <div className="text-3xl font-extrabold accent">{v}</div>
            <div className="muted text-sm">{k}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <button className="tile tile-primary" onClick={props.onNew}>
          <Ic n="plus" size={26} />
          <span className="tile-t">New Quotation</span>
          <span className="tile-s">Create a quotation in under 2 minutes</span>
        </button>
        <button className="tile" onClick={() => props.go({ name: 'list', query: '' })}>
          <Ic n="list" size={26} />
          <span className="tile-t">Saved Quotations</span>
          <span className="tile-s">Open, edit, duplicate or update status</span>
        </button>
        <div className="tile">
          <Ic n="search" size={26} />
          <span className="tile-t">Search Quotations</span>
          <form
            className="flex gap-2 w-full mt-1"
            onSubmit={(e) => {
              e.preventDefault();
              props.go({ name: 'list', query: term });
            }}
          >
            <input className="inp" placeholder="Number, name or mobile" value={term} onChange={(e) => setTerm(e.target.value)} />
            <button className="btn btn-primary" type="submit">
              Go
            </button>
          </form>
        </div>
        <button className="tile" onClick={() => props.go({ name: 'settings' })}>
          <Ic n="settings" size={26} />
          <span className="tile-t">Settings</span>
          <span className="tile-s">Company, numbering, warranty, terms, GST</span>
        </button>
      </div>
    </div>
  );
}

/* =========================================================
   SAVED QUOTATIONS
   ========================================================= */
function ListView(props: {
  quotes: Quotation[];
  settings: Settings;
  initialQuery: string;
  onOpen: (q: Quotation) => void;
  onDuplicate: (q: Quotation) => void;
  onDelete: (id: string) => void;
  onStatus: (id: string, s: Status) => void;
  onNew: () => void;
}) {
  const [query, setQuery] = useState(props.initialQuery);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const t = query.trim().toLowerCase();
  const digits = t.replace(/\D/g, '');
  const rows = props.quotes
    .filter((x) => {
      if (!t) return true;
      return (
        x.number.toLowerCase().includes(t) ||
        x.customer.name.toLowerCase().includes(t) ||
        (digits.length > 0 && x.customer.mobile.replace(/\D/g, '').includes(digits))
      );
    })
    .sort((a, b) => b.createdAt - a.createdAt);
  const money0 = (n: number) => money(n, decFor([n]), props.settings.numFormat);

  const askDelete = (id: string) => {
    if (confirmDel === id) {
      props.onDelete(id);
      setConfirmDel(null);
    } else {
      setConfirmDel(id);
      setTimeout(() => setConfirmDel((c) => (c === id ? null : c)), 4000);
    }
  };

  const StatusSel = ({ x }: { x: Quotation }) => (
    <select className={'inp !py-1.5 !w-auto st st-' + x.status} value={x.status} onChange={(e) => props.onStatus(x.id, e.target.value as Status)}>
      {STATUSES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
  const Actions = ({ x }: { x: Quotation }) => (
    <div className="flex gap-1.5 flex-wrap">
      <button className="btn btn-outline btn-sm" onClick={() => props.onOpen(x)}>
        <Ic n="edit" size={15} /> Edit
      </button>
      <button className="btn btn-outline btn-sm" onClick={() => props.onDuplicate(x)}>
        <Ic n="copy" size={15} /> Duplicate
      </button>
      <button className={'btn btn-sm ' + (confirmDel === x.id ? 'btn-danger' : 'btn-outline')} onClick={() => askDelete(x.id)}>
        <Ic n="trash" size={15} /> {confirmDel === x.id ? 'Confirm?' : 'Delete'}
      </button>
    </div>
  );

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="page-title">Saved Quotations</h1>
        <button className="btn btn-primary" onClick={props.onNew}>
          <Ic n="plus" /> New Quotation
        </button>
      </div>
      <div className="relative mb-4">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 muted">
          <Ic n="search" />
        </span>
        <input className="inp" style={{ paddingLeft: 40 }} placeholder="Search by quotation number, customer name or mobile" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {rows.length === 0 ? (
        <div className="card p-8 text-center muted">{props.quotes.length === 0 ? 'No quotations saved yet.' : 'No quotation matches your search.'}</div>
      ) : (
        <>
          <div className="hidden md:block card overflow-x-auto">
            <table className="dt">
              <thead>
                <tr>
                  <th>Quotation No.</th>
                  <th>Customer</th>
                  <th>Date</th>
                  <th>Pump</th>
                  <th>Panels</th>
                  <th>Drive</th>
                  <th className="text-right">Total</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id}>
                    <td className="font-semibold whitespace-nowrap">{x.number}</td>
                    <td>
                      <div className="font-medium">{x.customer.name}</div>
                      <div className="muted text-xs">{x.customer.mobile}</div>
                    </td>
                    <td className="whitespace-nowrap">{fmtDate(x.date)}</td>
                    <td className="whitespace-nowrap">{x.pump.hp} HP</td>
                    <td className="whitespace-nowrap">
                      {x.panel.company}
                      {x.panel.kw ? ' \u00B7 ' + x.panel.kw + ' kW' : ''}
                    </td>
                    <td>{x.drive.company}</td>
                    <td className="text-right font-semibold whitespace-nowrap">{money0(x.total)}</td>
                    <td>
                      <StatusSel x={x} />
                    </td>
                    <td>
                      <Actions x={x} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden space-y-3">
            {rows.map((x) => (
              <div key={x.id} className="card p-4">
                <div className="flex justify-between gap-2 items-start">
                  <div className="min-w-0">
                    <div className="font-semibold">{x.customer.name}</div>
                    <div className="muted text-sm">{x.customer.mobile}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold accent">{money0(x.total)}</div>
                    <div className="muted text-xs">{fmtDate(x.date)}</div>
                  </div>
                </div>
                <div className="muted text-sm mt-2">{x.number}</div>
                <div className="text-sm mt-1">
                  {x.pump.hp} HP pump &middot; {x.panel.company}
                  {x.panel.kw ? ' ' + x.panel.kw + ' kW' : ''} &middot; {x.drive.company}
                </div>
                <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
                  <StatusSel x={x} />
                  <Actions x={x} />
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* =========================================================
   SETTINGS
   ========================================================= */
function readLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onerror = () => reject(new Error('Could not read the image'));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('This file is not a valid image'));
      img.onload = () => {
        const max = 360;
        const r = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(img.width * r));
        cv.height = Math.max(1, Math.round(img.height * r));
        const ctx = cv.getContext('2d');
        if (!ctx) return reject(new Error('Canvas not supported'));
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL('image/png'));
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}

function SettingsView(props: { settings: Settings; onSave: (s: Settings) => void; toast: ToastFn }) {
  const [d, setD] = useState(props.settings);
  const [f, setF] = useState({
    startNumber: String(props.settings.startNumber),
    validityDays: String(props.settings.validityDays),
    goodsPct: String(props.settings.goodsPct),
    goodsGst: String(props.settings.goodsGst),
    serviceGst: String(props.settings.serviceGst),
  });
  const [attempted, setAttempted] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const set = (k: keyof Settings, v: any) => setD((p) => ({ ...p, [k]: v }));
  const setNum = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const errs: Record<string, string> = {};
  if (!d.companyName.trim()) errs.companyName = 'Enter the company name';
  if (!d.phone.trim()) errs.phone = 'Enter a phone number';
  if (!d.prefix.trim()) errs.prefix = 'Enter a prefix';
  else if (/\s/.test(d.prefix)) errs.prefix = 'No spaces allowed';
  const sn = num(f.startNumber);
  if (!(sn >= 1) || !Number.isInteger(sn)) errs.startNumber = 'Whole number, 1 or more';
  const vd = num(f.validityDays);
  if (!(vd >= 1) || !Number.isInteger(vd)) errs.validityDays = 'Whole number of days, 1 or more';
  const gp = num(f.goodsPct);
  if (!(gp >= 0 && gp <= 100)) errs.goodsPct = 'Between 0 and 100';
  const gg = num(f.goodsGst);
  if (!(gg >= 0 && gg <= 100)) errs.goodsGst = 'Between 0 and 100';
  const sg = num(f.serviceGst);
  if (!(sg >= 0 && sg <= 100)) errs.serviceGst = 'Between 0 and 100';
  if (!d.terms.trim()) errs.terms = 'Enter at least one term';
  const e = (k: string) => (attempted ? errs[k] : undefined);

  const save = () => {
    setAttempted(true);
    if (Object.keys(errs).length) {
      props.toast('Please fix the highlighted fields', 'err');
      return;
    }
    props.onSave({ ...d, startNumber: sn, validityDays: vd, goodsPct: gp, goodsGst: gg, serviceGst: sg });
    props.toast('Settings saved');
  };

  const reset = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      setTimeout(() => setConfirmReset(false), 4000);
      return;
    }
    setD(DEFAULT_SETTINGS);
    setF({ startNumber: '1', validityDays: '15', goodsPct: '70', goodsGst: '5', serviceGst: '18' });
    setConfirmReset(false);
    props.toast('Defaults restored \u2013 press Save to apply');
  };

  const onLogo = async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    try {
      set('logo', await readLogo(file));
    } catch (err: any) {
      props.toast(err.message || 'Could not load the logo', 'err');
    }
    ev.target.value = '';
  };

  return (
    <div className="pb-28">
      <h1 className="page-title mb-4">Settings</h1>
      <div className="space-y-4 max-w-3xl">
        <Card title="Company">
          <div className="grid gap-3 sm:grid-cols-2">
            <TF label="Company Name" req value={d.companyName} onChange={(v) => set('companyName', v)} err={e('companyName')} />
            <TF label="Line under name" value={d.unitLine} onChange={(v) => set('unitLine', v)} placeholder="A Unit of ..." />
            <TF className="sm:col-span-2" label="Address" value={d.address} onChange={(v) => set('address', v)} />
            <TF label="Phone" req inputMode="tel" value={d.phone} onChange={(v) => set('phone', v)} err={e('phone')} />
            <TF label="Email" value={d.email} onChange={(v) => set('email', v)} />
            <TF label="GSTIN" value={d.gstin} onChange={(v) => set('gstin', v.toUpperCase())} hint="Left blank until you enter it. Shown in the quotation header only if filled." />
          </div>
          <div className="mt-4 flex items-center gap-4 flex-wrap">
            <div className="logo-box">{d.logo ? <img src={d.logo} alt="Logo" /> : <span className="muted text-xs">No logo</span>}</div>
            <div className="flex gap-2 flex-wrap">
              <label className="btn btn-outline cursor-pointer">
                Upload logo
                <input type="file" accept="image/*" className="hidden" onChange={onLogo} />
              </label>
              <button className="btn btn-ghost" onClick={() => set('logo', DEFAULT_SETTINGS.logo)}>
                Use default logo
              </button>
              <button className="btn btn-ghost" onClick={() => set('logo', '')}>
                Remove
              </button>
            </div>
          </div>
        </Card>

        <Card title="Quotation">
          <div className="grid gap-3 sm:grid-cols-2">
            <TF label="Quotation Prefix" value={d.prefix} onChange={(v) => set('prefix', v)} err={e('prefix')} hint={'Numbers look like ' + (d.prefix || 'NSE/SP') + '/' + new Date().getFullYear() + '/' + String(Math.max(1, sn || 1)).padStart(4, '0')} />
            <TF label="Starting Number" inputMode="numeric" value={f.startNumber} onChange={(v) => setNum('startNumber', v)} err={e('startNumber')} hint="Next number issued will never be lower than this" />
            <TF label="Default Validity (days)" inputMode="numeric" value={f.validityDays} onChange={(v) => setNum('validityDays', v)} err={e('validityDays')} />
            <SelectField label="Amount format" value={d.numFormat} onChange={(v) => set('numFormat', v)} options={['en-IN', 'en-US']} />
          </div>
          <p className="hint mt-2">en-IN writes 1,08,900 (lakh style). en-US writes 108,900.</p>
        </Card>

        <Card title="Warranty (defaults for new quotations)">
          <div className="grid gap-3 sm:grid-cols-3">
            <TF label="Pump" value={d.warrantyPump} onChange={(v) => set('warrantyPump', v)} />
            <TF label="Panel" value={d.warrantyPanel} onChange={(v) => set('warrantyPanel', v)} />
            <TF label="Drive" value={d.warrantyDrive} onChange={(v) => set('warrantyDrive', v)} />
          </div>
        </Card>

        <Card title="Terms &amp; Conditions">
          <textarea className={'inp' + (e('terms') ? ' inp-err' : '')} rows={10} value={d.terms} onChange={(ev) => set('terms', ev.target.value)} />
          <p className="hint mt-1">One term per line. Use {'{validity}'} where the number of validity days should appear. Applies to new quotations.</p>
          {e('terms') && <span className="err">{e('terms')}</span>}
        </Card>

        <Card title="GST (internal only)">
          <div className="grid gap-3 sm:grid-cols-2">
            <TF label="Goods share of project price" inputMode="decimal" suffix="%" value={f.goodsPct} onChange={(v) => setNum('goodsPct', v)} err={e('goodsPct')} />
            <TF label="GST on goods" inputMode="decimal" suffix="%" value={f.goodsGst} onChange={(v) => setNum('goodsGst', v)} err={e('goodsGst')} />
            <TF label="Services share (automatic)" suffix="%" value={gp >= 0 && gp <= 100 ? String(round2(100 - gp)) : ''} onChange={() => undefined} />
            <TF label="GST on services" inputMode="decimal" suffix="%" value={f.serviceGst} onChange={(v) => setNum('serviceGst', v)} err={e('serviceGst')} />
          </div>
          <p className="hint mt-2">Default: goods 70% @ 5%, services 30% @ 18%. The customer quotation shows only Price, GST and Total &ndash; never this split.</p>
        </Card>
      </div>

      <div className="actionbar">
        <div className="max-w-6xl mx-auto px-4 flex gap-3">
          <button className={'btn flex-1 justify-center ' + (confirmReset ? 'btn-danger' : 'btn-outline')} onClick={reset}>
            {confirmReset ? 'Confirm reset?' : 'Reset to defaults'}
          </button>
          <button className="btn btn-primary flex-1 justify-center" onClick={save}>
            <Ic n="save" /> Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   APP SHELL
   ========================================================= */
function App() {
  const storageOk = useMemo(storageWorks, []);
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...loadJSON<Partial<Settings>>(KEYS.settings, {}) }));
  const [quotes, setQuotes] = useState<Quotation[]>(() => loadJSON<Quotation[]>(KEYS.quotes, []));
  const quotesRef = useRef(quotes);
  quotesRef.current = quotes;
  const [view, setView] = useState<View>({ name: 'dashboard' });
  const [toastState, setToastState] = useState<{ msg: string; kind: 'ok' | 'err'; id: number } | null>(null);
  const toastTimer = useRef<any>(null);

  const toast: ToastFn = (msg, kind = 'ok') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastState({ msg, kind, id: Date.now() });
    toastTimer.current = setTimeout(() => setToastState(null), 3500);
  };

  const commitQuotes = (next: Quotation[]) => {
    quotesRef.current = next;
    setQuotes(next);
    if (!saveJSON(KEYS.quotes, next)) toast('Browser storage is full or blocked \u2013 changes are not being saved', 'err');
  };

  const openNew = () => {
    const first = quotesRef.current.length === 0;
    setView({ name: 'editor', key: uid(), initial: blankQuotation(settings, quotesRef.current, first), exists: false });
  };
  const openExisting = (x: Quotation) => setView({ name: 'editor', key: uid(), initial: x, exists: true });
  const duplicate = (x: Quotation) => {
    const b = blankQuotation(settings, quotesRef.current, false);
    const copy: Quotation = {
      ...b,
      pump: { ...x.pump },
      panel: { ...x.panel },
      drive: { ...x.drive },
      structure: { ...x.structure },
      installation: x.installation,
      transportation: x.transportation,
      price: x.price,
      warranty: { ...x.warranty },
      customer: { name: '', mobile: '', address: '', district: '', pincode: '' },
    };
    setView({ name: 'editor', key: uid(), initial: copy, exists: false });
    toast('Duplicated \u2013 enter the new customer details');
    window.scrollTo(0, 0);
  };

  const saveQuote = (qq: Quotation): Quotation => {
    const list = quotesRef.current;
    const exists = list.some((x) => x.id === qq.id);
    let out = qq;
    if (!exists && list.some((x) => x.number === qq.number)) out = { ...qq, number: nextNumber(list, settings, qq.date) };
    commitQuotes(exists ? list.map((x) => (x.id === out.id ? out : x)) : [out, ...list]);
    return out;
  };

  const go = (v: View) => {
    setView(v);
    window.scrollTo(0, 0);
  };

  const nav = [
    { id: 'dashboard', label: 'Home', icon: 'home', on: () => go({ name: 'dashboard' }) },
    { id: 'editor', label: 'New', icon: 'plus', on: openNew },
    { id: 'list', label: 'Saved', icon: 'list', on: () => go({ name: 'list', query: '' }) },
    { id: 'settings', label: 'Settings', icon: 'settings', on: () => go({ name: 'settings' }) },
  ];

  return (
    <div>
      <header className="topbar">
        <div className="max-w-6xl mx-auto px-4 flex items-center justify-between gap-3 h-16">
          <button className="flex items-center gap-2.5 min-w-0" onClick={() => go({ name: 'dashboard' })} aria-label="Home">
            {settings.logo && <img src={settings.logo} alt="" className="h-9 w-9 object-contain" />}
            <span className="brand-name truncate">{settings.companyName}</span>
          </button>
          <nav className="flex gap-1">
            {nav.map((n) => (
              <button key={n.id} className={'navbtn' + (view.name === n.id ? ' on' : '')} onClick={n.on}>
                <Ic n={n.icon} size={18} />
                <span>{n.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-5 sm:py-8">
        {!storageOk && (
          <div className="banner banner-warn mb-4">
            <Ic n="warn" />
            <span>Browser storage is unavailable, so quotations will be lost when this page is closed.</span>
          </div>
        )}
        {view.name === 'dashboard' && <Dashboard quotes={quotes} settings={settings} go={go} onNew={openNew} />}
        {view.name === 'list' && (
          <ListView
            key={view.query}
            quotes={quotes}
            settings={settings}
            initialQuery={view.query}
            onOpen={openExisting}
            onDuplicate={duplicate}
            onNew={openNew}
            onDelete={(id) => {
              commitQuotes(quotesRef.current.filter((x) => x.id !== id));
              toast('Quotation deleted');
            }}
            onStatus={(id, st) => commitQuotes(quotesRef.current.map((x) => (x.id === id ? { ...x, status: st, updatedAt: Date.now() } : x)))}
          />
        )}
        {view.name === 'settings' && (
          <SettingsView
            settings={settings}
            toast={toast}
            onSave={(s) => {
              setSettings(s);
              if (!saveJSON(KEYS.settings, s)) toast('Could not save settings to browser storage', 'err');
            }}
          />
        )}
        {view.name === 'editor' && (
          <Editor
            key={view.key}
            initial={view.initial}
            exists={view.exists}
            settings={settings}
            onSave={saveQuote}
            onDuplicate={duplicate}
            onBack={() => go({ name: 'list', query: '' })}
            toast={toast}
          />
        )}
      </main>

      {toastState && (
        <div className={'toast ' + (toastState.kind === 'err' ? 'toast-err' : 'toast-ok')} role="status" key={toastState.id}>
          {toastState.msg}
        </div>
      )}
    </div>
  );
}

createRoot(document.getElementById('app-root')!).render(<App />);
