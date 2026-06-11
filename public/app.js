/* =========================================================
   app.js — invoice app logic (no framework, no server, no DB)
   Data is stored in this browser via localStorage.
   ========================================================= */

(function () {
  "use strict";

  /* ---------- tiny helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const view = $("#view");

  function uid() {
    return (crypto.randomUUID && crypto.randomUUID()) ||
      "id" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function nl2br(s) { return String(s || "").replace(/\n/g, "<br>"); }

  const CURRENCIES = {
    USD: { code: "USD", symbol: "$", locale: "en-US", label: "US Dollar ($)" },
    GBP: { code: "GBP", symbol: "£", locale: "en-GB", label: "British Pound (£)" },
    EUR: { code: "EUR", symbol: "€", locale: "en-IE", label: "Euro (€)" },
    TRY: { code: "TRY", symbol: "₺", locale: "tr-TR", label: "Turkish Lira (₺)" },
  };
  function money(amount, code) {
    const c = CURRENCIES[code] || CURRENCIES.USD;
    const n = Number(amount) || 0;
    try {
      return new Intl.NumberFormat(c.locale, { style: "currency", currency: c.code }).format(n);
    } catch (e) {
      return c.symbol + n.toFixed(2);
    }
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    const p = String(iso).split("-").map(Number);
    if (p.length !== 3 || !p[0]) return esc(iso);
    const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return String(p[2]).padStart(2, "0") + " " + m[p[1] - 1] + " " + p[0];
  }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function addDaysISO(iso, days) {
    const p = String(iso).split("-").map(Number);
    const d = new Date(p[0], p[1] - 1, p[2]);
    d.setDate(d.getDate() + days);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function pad2(n) { return String(n).padStart(2, "0"); }
  function isoOf(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }

  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  /* ---------- tax year ----------
     The company's accounting year (set in Settings, used by the Dashboard).
     Defined by a start month + day; it runs for 12 months, so the default
     1 March start means the year runs 1 Mar → 28/29 Feb. */
  function taxStart() {
    const s = state.settings || {};
    return {
      m: Math.min(12, Math.max(1, Number(s.taxYearStartMonth) || 1)),
      d: Math.min(31, Math.max(1, Number(s.taxYearStartDay) || 1)),
    };
  }
  // The calendar year in which the tax year CONTAINING `iso` starts.
  function taxYearOf(iso) {
    const p = String(iso || "").split("-").map(Number);
    if (!p[0]) return null;
    const s = taxStart();
    return (p[1] > s.m || (p[1] === s.m && p[2] >= s.d)) ? p[0] : p[0] - 1;
  }
  // First & last day (ISO) of the tax year starting in calendar year Y.
  function taxYearWindow(Y) {
    const s = taxStart();
    const startISO = Y + "-" + pad2(s.m) + "-" + pad2(s.d);
    const nd = new Date(Y + 1, s.m - 1, s.d); nd.setDate(nd.getDate() - 1);  // day before next start
    return { startISO, endISO: isoOf(nd) };
  }
  function taxYearLabel(Y) {
    const w = taxYearWindow(Y);
    return fmtDate(w.startISO) + " – " + fmtDate(w.endISO);
  }
  // 0–11: how many months after the tax-year start that `iso` falls.
  function monthIndexInTaxYear(iso) {
    const p = String(iso || "").split("-").map(Number);
    return (((p[1] || 1) - taxStart().m) + 12) % 12;
  }

  // Accept "#abc", "abc", "#aabbcc", "aabbcc" -> "#aabbcc" (or null if invalid)
  function normalizeHex(v) {
    let h = String(v || "").trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split("").map((c) => c + c).join("");
    if (/^[0-9a-fA-F]{6}$/.test(h)) return "#" + h.toLowerCase();
    return null;
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, 2200);
  }

  /* ---------- store ----------
     Data is saved in this browser (localStorage) on this device.
  */
  const DB_KEY = "invoice_studio_v1";

  // When opened via http://localhost:8347 the app saves data to data.json in
  // the project folder (handy for backups and file sync). When opened as a
  // local file (file://) it falls back to localStorage as before.
  const ON_SERVER = window.location.hostname === "localhost" ||
                    window.location.hostname === "127.0.0.1";
  const DEFAULTS = {
    settings: {
      businessName: "",
      businessEmail: "",
      businessPhone: "",
      businessAddress: "",
      logo: "",
      defaultCurrency: "USD",
      invoicePrefix: "",
      nextNumber: 1,
      accentColor: "#E18910",
      notes: "Thank you for your business.",
      taxYearStartMonth: 1,   // 1–12; default January
      taxYearStartDay: 1,     // default 1st → tax year runs 1 Mar – 28/29 Feb
      corpTaxRate: 20,        // %% — set to your local corporation/income tax rate
      merchantMap: {},        // learned: normalised merchant name → category (or "__skip")
    },
    clients: [],
    services: [],
    invoices: [],
    expenses: [],
    savings: [],              // cash savings + reserve assets (balance-sheet, not P&L)
  };

  let state;
  let firstRun = false;

  // Build state from a raw data object. Returns false if there was nothing real to load.
  function applyData(data) {
    const empty = !data || typeof data !== "object" ||
      (!data.settings && !(data.clients || []).length && !(data.services || []).length && !(data.invoices || []).length);
    if (empty) {
      firstRun = true;
      state = JSON.parse(JSON.stringify(DEFAULTS));
      return false;
    }
    firstRun = false;
    state = {
      settings: Object.assign({}, DEFAULTS.settings, data.settings || {}),
      clients: data.clients || [],
      services: data.services || [],
      invoices: data.invoices || [],
      expenses: data.expenses || [],
      savings: data.savings || [],
    };
    return true;
  }

  function load() {
    if (ON_SERVER) {
      // Try to load from data.json via the local server first.
      return fetch("/api/load")
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
        .then(data => {
          if (data && (data.invoices || data.clients || data.settings)) {
            // Server has real data — use it and mirror to localStorage as a cache.
            applyData(data);
            try { localStorage.setItem(DB_KEY, JSON.stringify(state)); } catch (e) {}
          } else {
            // No server data yet (first time running via server).
            // Migrate anything already in localStorage so nothing is lost.
            const raw = localStorage.getItem(DB_KEY);
            if (raw) {
              try { applyData(JSON.parse(raw)); } catch (e) { state = JSON.parse(JSON.stringify(DEFAULTS)); }
            } else {
              firstRun = true;
              state = JSON.parse(JSON.stringify(DEFAULTS));
            }
            // Push whatever we have to data.json so it exists for next time.
            _saveToServer();
          }
        });
    }
    // file:// path — synchronous localStorage (unchanged behaviour).
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) { firstRun = true; state = JSON.parse(JSON.stringify(DEFAULTS)); save(); }
    else { try { applyData(JSON.parse(raw)); } catch (e) { state = JSON.parse(JSON.stringify(DEFAULTS)); } }
    return Promise.resolve();
  }

  function _saveToServer() {
    fetch("/api/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    }).catch(() => {}); // fire-and-forget; never block the UI
  }

  function save() {
    try { localStorage.setItem(DB_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
    if (ON_SERVER) _saveToServer();
  }

  /* ---------- invoice math ---------- */
  function lineAmount(it) { return (Number(it.qty) || 0) * (Number(it.rate) || 0); }
  function calcTotals(inv) {
    const subtotal = (inv.items || []).reduce((a, it) => a + lineAmount(it), 0);
    const taxRate = Number(inv.taxRate) || 0;
    const taxAmount = subtotal * taxRate / 100;
    return { subtotal, taxRate, taxAmount, total: subtotal + taxAmount };
  }

  /* =========================================================
     THE INVOICE TEMPLATE — delegated to invoice-template.js
     (single source for the invoice's look). Edit the design
     there + invoice.css.
     ========================================================= */
  function renderInvoiceHTML(inv) {
    const client = state.clients.find((c) => c.id === inv.clientId);
    return InvoiceTemplate.renderInvoiceTicket(inv, state.settings, client);
  }

  /* ---------- PDF (via the browser's Save as PDF) ---------- */
  function printInvoice(inv) {
    const root = $("#print-root");
    root.innerHTML = renderInvoiceHTML(inv);
    // Briefly lay it out off-screen so we can measure and scale it to one A4 page.
    root.style.cssText = "display:block;position:fixed;left:-10000px;top:0;";
    fitTicket(root.querySelector(".inv-page"));
    root.style.cssText = "";
    const cleanup = () => { root.innerHTML = ""; window.removeEventListener("afterprint", cleanup); };
    window.addEventListener("afterprint", cleanup);
    window.print();
  }

  // One-click PDF via the browser's print window ("Save as PDF").
  function downloadPDF(inv) {
    if (!inv) return;
    printInvoice(inv);
  }

  /* =========================================================
     ROUTER
     ========================================================= */
  let current = "invoices";
  function route(name) {
    current = name;
    $$(".nav-item").forEach((b) => b.classList.toggle("active", b.dataset.route === name));
    if (name === "dashboard") renderDashboard();
    else if (name === "invoices") renderInvoices();
    else if (name === "clients") renderClients();
    else if (name === "services") renderServices();
    else if (name === "expenses") renderExpenses();
    else if (name === "savings") renderSavings();
    else if (name === "settings") renderSettings();
  }

  const EXPENSE_CATEGORIES = ["Software", "Subscriptions", "Hosting", "Salaries", "Accountant", "Office rent", "Equipment", "Marketing", "Telecoms", "Travel", "Professional services", "Other"];
  const EXPENSE_FREQ = { once: "One-off", monthly: "Monthly", yearly: "Yearly" };

  /* =========================================================
     VIEW: Dashboard — revenue, tax & the company's situation
     ========================================================= */
  let dashYear = null;

  /* A small from-scratch Sankey (income-statement "flow" chart) in SVG.
     nodes: {id, col, value, color, labelSide:'left'|'right', label:{name,value}}
     links: {source, target, value, color}   — values balance per column. */
  function renderSankeySVG(nodes, links) {
    const W = 1000, H = 480, nodeW = 15, gap = 16, padT = 18, L = 150, R = 178;
    const byId = {};
    nodes.forEach((n) => { byId[n.id] = n; });
    const cols = {};
    nodes.forEach((n) => { (cols[n.col] = cols[n.col] || []).push(n); });
    const colKeys = Object.keys(cols).map(Number).sort((a, b) => a - b);
    const maxCol = colKeys[colKeys.length - 1] || 0;
    let maxColSum = 0, maxNodes = 1;
    colKeys.forEach((k) => {
      const sum = cols[k].reduce((a, n) => a + n.value, 0);
      if (sum > maxColSum) maxColSum = sum;
      if (cols[k].length > maxNodes) maxNodes = cols[k].length;
    });
    const avail = H - padT * 2 - (maxNodes - 1) * gap;
    const scale = maxColSum > 0 ? avail / maxColSum : 0;
    const innerW = W - L - R - nodeW;
    colKeys.forEach((k) => {
      const list = cols[k];
      const x = L + (maxCol > 0 ? (k / maxCol) * innerW : 0);
      const totalH = list.reduce((a, n) => a + n.value * scale, 0) + (list.length - 1) * gap;
      let y = padT + (H - padT * 2 - totalH) / 2;
      list.forEach((n) => { n.x = x; n.h = Math.max(1.5, n.value * scale); n.y = y; y += n.h + gap; });
    });
    // stack each node's link endpoints, ordered by the other end's vertical position
    const outBy = {}, inBy = {};
    nodes.forEach((n) => { outBy[n.id] = []; inBy[n.id] = []; });
    links.forEach((l) => { outBy[l.source].push(l); inBy[l.target].push(l); });
    Object.keys(outBy).forEach((id) => {
      let oy = byId[id].y;
      outBy[id].sort((a, b) => byId[a.target].y - byId[b.target].y)
        .forEach((l) => { l._sy0 = oy; oy += l.value * scale; l._sy1 = oy; });
    });
    Object.keys(inBy).forEach((id) => {
      let iy = byId[id].y;
      inBy[id].sort((a, b) => byId[a.source].y - byId[b.source].y)
        .forEach((l) => { l._ty0 = iy; iy += l.value * scale; l._ty1 = iy; });
    });
    let paths = "";
    links.forEach((l) => {
      const s = byId[l.source], t = byId[l.target];
      const sx = s.x + nodeW, tx = t.x, cx = (sx + tx) / 2;
      paths += `<path d="M${sx},${l._sy0.toFixed(1)} C${cx},${l._sy0.toFixed(1)} ${cx},${l._ty0.toFixed(1)} ${tx},${l._ty0.toFixed(1)} L${tx},${l._ty1.toFixed(1)} C${cx},${l._ty1.toFixed(1)} ${cx},${l._sy1.toFixed(1)} ${sx},${l._sy1.toFixed(1)} Z" fill="${l.color}" fill-opacity="0.4"></path>`;
    });
    let rects = "", labels = "";
    nodes.forEach((n) => {
      rects += `<rect x="${n.x}" y="${n.y.toFixed(1)}" width="${nodeW}" height="${n.h.toFixed(1)}" rx="2.5" fill="${n.color}"></rect>`;
      const cy = n.y + n.h / 2;
      const left = n.labelSide === "left";
      const lx = left ? n.x - 9 : n.x + nodeW + 9;
      const anc = left ? "end" : "start";
      labels += `<text x="${lx}" y="${cy.toFixed(1)}" text-anchor="${anc}">`
        + `<tspan class="nm" x="${lx}" dy="-0.25em">${esc(n.label.name)}</tspan>`
        + `<tspan class="v" x="${lx}" dy="1.25em">${esc(n.label.value)}</tspan></text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="sankey" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Fiscal year income flow">${paths}${rects}${labels}</svg>`;
  }

  function renderDashboard() {
    const s = state.settings;
    // Only real invoices count — Drafts are not money yet.
    const real = state.invoices.filter((i) => (i.status || "Draft") !== "Draft" && i.issueDate);
    const curYear = taxYearOf(todayISO());

    // which tax years can be viewed (every year that has invoices, plus this one)
    let years = Array.from(new Set(real.map((i) => taxYearOf(i.issueDate)).filter((v) => v != null)));
    if (years.indexOf(curYear) === -1) years.push(curYear);
    years.sort((a, b) => b - a);
    if (dashYear == null || years.indexOf(dashYear) === -1) dashYear = (years.indexOf(curYear) !== -1) ? curYear : years[0];
    const Y = dashYear;

    const inYear = real.filter((i) => taxYearOf(i.issueDate) === Y);

    // Group by currency — $ £ € ₺ can't be added together.
    const byCur = {};
    inYear.forEach((inv) => {
      const t = calcTotals(inv);
      const c = inv.currency || s.defaultCurrency || "USD";
      const g = byCur[c] || (byCur[c] = { revenue: 0, tax: 0, total: 0, paid: 0, outstanding: 0, count: 0, months: new Array(12).fill(0) });
      g.revenue += t.subtotal; g.tax += t.taxAmount; g.total += t.total; g.count++;
      if ((inv.status || "") === "Paid") g.paid += t.total; else g.outstanding += t.total;
      g.months[monthIndexInTaxYear(inv.issueDate)] += t.total;
    });
    const curs = Object.keys(byCur);
    let primary = (s.defaultCurrency && byCur[s.defaultCurrency]) ? s.defaultCurrency
      : curs.slice().sort((a, b) => byCur[b].total - byCur[a].total)[0];
    if (!primary) primary = s.defaultCurrency || "USD";
    const g = byCur[primary] || { revenue: 0, tax: 0, total: 0, paid: 0, outstanding: 0, count: 0, months: new Array(12).fill(0) };

    // Expenses for this fiscal year, projected to year-end (monthly × 12), grouped by currency.
    const expByCur = {};
    (state.expenses || []).forEach((ex) => {
      if (!ex.date || taxYearOf(ex.date) !== Y) return;
      const mult = ex.frequency === "monthly" ? 12 : 1;   // yearly & one-off count once
      const c = ex.currency || s.defaultCurrency || "USD";
      expByCur[c] = (expByCur[c] || 0) + (Number(ex.amount) || 0) * mult;
    });
    const expenses = expByCur[primary] || 0;
    const otherExpCurs = Object.keys(expByCur).filter((c) => c !== primary && expByCur[c] > 0);
    const netProfit = g.revenue - expenses;
    const corpRate = Math.max(0, Number(s.corpTaxRate) || 0);
    const corpTax = Math.max(0, netProfit) * corpRate / 100;

    // ---------- Sankey income-statement flow (primary currency) ----------
    const SC = { rev: "#E18910", profit: "#1f9d55", cost: "#cf4a3a" };
    const clientRev = {};
    inYear.forEach((inv) => {
      if ((inv.currency || s.defaultCurrency || "USD") !== primary) return;
      const cid = inv.clientId || "";
      clientRev[cid] = (clientRev[cid] || 0) + calcTotals(inv).subtotal;
    });
    const expCat = {};
    (state.expenses || []).forEach((ex) => {
      if (!ex.date || taxYearOf(ex.date) !== Y) return;
      if ((ex.currency || s.defaultCurrency || "USD") !== primary) return;
      const cat = ex.category || "Other";
      expCat[cat] = (expCat[cat] || 0) + (Number(ex.amount) || 0) * (ex.frequency === "monthly" ? 12 : 1);
    });

    const sNodes = [], sLinks = [];
    const profitPos = netProfit > 0;
    let expFlow = expenses, catFactor = 1;
    if (!profitPos && expenses > 0 && g.revenue > 0) { expFlow = g.revenue; catFactor = g.revenue / expenses; }

    let srcEntries = Object.keys(clientRev).map((cid) => ({ cid, v: clientRev[cid] })).filter((e) => e.v > 0).sort((a, b) => b.v - a.v);
    if (srcEntries.length > 6) {
      const top = srcEntries.slice(0, 5);
      top.push({ cid: "__other", v: srcEntries.slice(5).reduce((a, e) => a + e.v, 0) });
      srcEntries = top;
    }
    srcEntries.forEach((e) => {
      const nm = e.cid === "__other" ? "Other clients" : ((state.clients.find((c) => c.id === e.cid) || {}).name || "No client");
      sNodes.push({ id: "src:" + e.cid, col: 0, value: e.v, color: SC.rev, labelSide: "left", label: { name: nm, value: money(e.v, primary) } });
      sLinks.push({ source: "src:" + e.cid, target: "revenue", value: e.v, color: SC.rev });
    });
    sNodes.push({ id: "revenue", col: 1, value: g.revenue, color: SC.rev, labelSide: "right", label: { name: "Revenue", value: money(g.revenue, primary) } });
    if (profitPos) {
      sNodes.push({ id: "opprofit", col: 2, value: netProfit, color: SC.profit, labelSide: "right", label: { name: "Operating profit", value: money(netProfit, primary) } });
      sLinks.push({ source: "revenue", target: "opprofit", value: netProfit, color: SC.profit });
      const netAfter = netProfit - corpTax;
      if (netAfter > 0) {
        sNodes.push({ id: "net", col: 3, value: netAfter, color: SC.profit, labelSide: "right", label: { name: "Net profit", value: money(netAfter, primary) } });
        sLinks.push({ source: "opprofit", target: "net", value: netAfter, color: SC.profit });
      }
      if (corpTax > 0) {
        sNodes.push({ id: "tax", col: 3, value: corpTax, color: SC.cost, labelSide: "right", label: { name: "Corporation tax", value: money(corpTax, primary) } });
        sLinks.push({ source: "opprofit", target: "tax", value: corpTax, color: SC.cost });
      }
    }
    if (expenses > 0) {
      sNodes.push({ id: "expenses", col: 2, value: expFlow, color: SC.cost, labelSide: "right", label: { name: "Total expenses", value: money(expenses, primary) } });
      sLinks.push({ source: "revenue", target: "expenses", value: expFlow, color: SC.cost });
      Object.keys(expCat).map((cat) => ({ cat, v: expCat[cat] })).filter((e) => e.v > 0).sort((a, b) => b.v - a.v).forEach((e) => {
        sNodes.push({ id: "cat:" + e.cat, col: 3, value: e.v * catFactor, color: SC.cost, labelSide: "right", label: { name: e.cat, value: money(e.v, primary) } });
        sLinks.push({ source: "expenses", target: "cat:" + e.cat, value: e.v * catFactor, color: SC.cost });
      });
    }
    const sankeyHasData = g.revenue > 0 && sLinks.length > 1;
    const sankeySVG = sankeyHasData ? renderSankeySVG(sNodes, sLinks) : "";

    // ---------- Cash & reserves (balance-sheet snapshot, all currencies, not year-filtered) ----------
    const savByCur = {};
    (state.savings || []).forEach((sv) => {
      const c = CURRENCIES[sv.currency] ? sv.currency : "GBP";
      const o = savByCur[c] || (savByCur[c] = { cash: 0, reserve: 0 });
      if (sv.kind === "reserve") o.reserve += Number(sv.amount) || 0; else o.cash += Number(sv.amount) || 0;
    });
    const savCurs = Object.keys(savByCur).sort();
    const savingsCard = savCurs.length ? `
      <div class="card card-pad">
        <div class="section-title">Cash &amp; reserves <span class="muted" style="font-weight:400;text-transform:none;letter-spacing:0">— what you hold now</span></div>
        <div class="dash-stats">
          ${savCurs.map((c) => { const o = savByCur[c]; return `
            <div class="stat-card">
              <div class="stat-label">${esc((CURRENCIES[c] || {}).label || c)}</div>
              <div class="stat-value">${money(o.cash + o.reserve, c)}</div>
              <div class="stat-sub">${money(o.cash, c)} cash · ${money(o.reserve, c)} reserves</div>
            </div>`; }).join("")}
        </div>
      </div>` : "";

    const yearOptions = years.map((y) =>
      `<option value="${y}" ${y === Y ? "selected" : ""}>${y === curYear ? "This fiscal year" : "Fiscal year"} · ${taxYearLabel(y)}</option>`
    ).join("");

    // monthly bar chart (in the primary currency)
    const ts = taxStart();
    const maxM = Math.max.apply(null, g.months.concat([0]));
    const bars = g.months.map((v, idx) => {
      const h = maxM > 0 ? Math.max(2, Math.round((v / maxM) * 100)) : 0;
      const label = MONTH_SHORT[(ts.m - 1 + idx) % 12];
      return `<div class="bar-col">
          <div class="bar-wrap"><div class="bar" style="height:${h}%" title="${label}: ${money(v, primary)}"></div></div>
          <div class="bar-lbl">${label}</div>
        </div>`;
    }).join("");

    const others = curs.filter((c) => c !== primary);
    const othersBlock = others.length ? `
      <div class="card card-pad" style="margin-top:18px">
        <div class="section-title">Other currencies this fiscal year</div>
        <table class="table">
          <thead><tr><th>Currency</th><th class="t-right">Revenue (ex-VAT)</th><th class="t-right">Tax</th><th class="t-right">Total</th></tr></thead>
          <tbody>${others.map((c) => `<tr>
            <td><strong>${esc((CURRENCIES[c] || {}).label || c)}</strong></td>
            <td class="t-right">${money(byCur[c].revenue, c)}</td>
            <td class="t-right">${money(byCur[c].tax, c)}</td>
            <td class="t-right">${money(byCur[c].total, c)}</td></tr>`).join("")}</tbody>
        </table>
      </div>` : "";

    const hasData = inYear.length > 0;
    const curLabel = (CURRENCIES[primary] || {}).label || primary;

    view.innerHTML = `
      <div class="page-head">
        <div><h1>Dashboard</h1><div class="sub">Your company's situation for the selected fiscal year.</div></div>
        <select class="select dash-year" id="dash-year" style="max-width:320px">${yearOptions}</select>
      </div>

      ${!real.length ? `<div class="welcome">No counted invoices yet — once you create invoices and mark them <strong>Sent</strong> or <strong>Paid</strong>, your revenue appears here. Drafts are not counted.</div>` : ""}

      <div class="dash-stats">
        <div class="stat-card"><div class="stat-label">Revenue (ex-VAT)</div><div class="stat-value">${money(g.revenue, primary)}</div><div class="stat-sub">in ${esc(curLabel)}</div></div>
        <div class="stat-card"><div class="stat-label">Expenses</div><div class="stat-value">${money(expenses, primary)}</div><div class="stat-sub">projected full year</div></div>
        <div class="stat-card"><div class="stat-label">Net profit</div><div class="stat-value" style="${netProfit < 0 ? "color:#b91c1c" : ""}">${money(netProfit, primary)}</div><div class="stat-sub">revenue − expenses</div></div>
        <div class="stat-card"><div class="stat-label">Corporation tax</div><div class="stat-value">${money(corpTax, primary)}</div><div class="stat-sub">≈ ${corpRate}% of profit</div></div>
      </div>

      <div class="dash-split">
        <span>VAT collected: <b>${money(g.tax, primary)}</b></span>
        <span>Total invoiced: <b>${money(g.total, primary)}</b></span>
        <span>Collected (paid): <b>${money(g.paid, primary)}</b></span>
        <span>Outstanding: <b>${money(g.outstanding, primary)}</b></span>
        ${otherExpCurs.length ? `<span class="muted">+ expenses in ${esc(otherExpCurs.join(", "))} (shown separately)</span>` : ""}
      </div>

      ${savingsCard}

      ${sankeyHasData ? `
      <div class="card card-pad">
        <div class="section-title">Where your money flows — fiscal year (${esc(primary)})</div>
        <div class="sankey-legend"><span class="sk-dot" style="background:${SC.rev}"></span>Revenue<span class="sk-dot" style="background:${SC.profit}"></span>Profit<span class="sk-dot" style="background:${SC.cost}"></span>Costs &amp; tax</div>
        <div class="sankey-wrap">${sankeySVG}</div>
      </div>` : ""}

      <div class="card card-pad">
        <div class="section-title">Monthly total invoiced — ${esc(primary)}</div>
        ${hasData ? `<div class="bar-chart">${bars}</div>` : `<div class="empty" style="padding:32px 20px"><p>No invoices in this tax year yet.</p></div>`}
      </div>

      ${othersBlock}`;

    const sel = $("#dash-year");
    if (sel) sel.addEventListener("change", () => { dashYear = Number(sel.value); renderDashboard(); });
  }

  /* =========================================================
     VIEW: Invoices list
     ========================================================= */
  function renderInvoices() {
    const list = state.invoices.slice().sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    let body;
    if (!list.length) {
      body = `<div class="card"><div class="empty">
        <h3>No invoices yet</h3>
        <p>Create your first invoice — it takes about a minute.</p>
        <button class="btn btn-primary" data-action="new-invoice"><span class="plus">+</span> New invoice</button>
      </div></div>`;
    } else {
      const rows = list.map((inv) => {
        const client = state.clients.find((c) => c.id === inv.clientId);
        const t = calcTotals(inv);
        const cls = inv.status === "Paid" ? "pill-paid" : inv.status === "Sent" ? "pill-sent" : "pill-draft";
        return `<tr class="row-click" data-open="${inv.id}">
          <td><strong>${esc(inv.number) || "—"}</strong></td>
          <td>${client ? esc(client.name) : "<span class='muted'>No client</span>"}</td>
          <td>${fmtDate(inv.issueDate)}</td>
          <td class="t-right">${money(t.total, inv.currency)}</td>
          <td><span class="pill ${cls}">${esc(inv.status || "Draft")}</span></td>
          <td class="t-actions" data-stop>
            <button class="btn btn-sm" data-edit="${inv.id}">Open</button>
            <button class="btn btn-sm" data-pdf="${inv.id}">PDF</button>
          </td>
        </tr>`;
      }).join("");
      body = `<div class="card"><table class="table">
        <thead><tr><th>Number</th><th>Client</th><th>Issue date</th><th class="t-right">Total</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    }

    view.innerHTML = `
      ${firstRunBanner()}
      <div class="page-head">
        <div><h1>Invoices</h1><div class="sub">${list.length} invoice${list.length === 1 ? "" : "s"}</div></div>
        <button class="btn btn-primary" data-action="new-invoice"><span class="plus">+</span> New invoice</button>
      </div>
      ${body}`;

    $$("[data-open]", view).forEach((tr) => tr.addEventListener("click", () => openBuilder(tr.dataset.open)));
    $$("[data-stop]", view).forEach((td) => td.addEventListener("click", (e) => e.stopPropagation()));
    $$("[data-edit]", view).forEach((b) => b.addEventListener("click", () => openBuilder(b.dataset.edit)));
    $$("[data-pdf]", view).forEach((b) => b.addEventListener("click", () => {
      const inv = state.invoices.find((i) => i.id === b.dataset.pdf);
      if (inv) downloadPDF(inv);
    }));
  }

  function firstRunBanner() {
    if (!firstRun) return "";
    return `<div class="welcome">👋 Welcome! Your data is saved on this device. Start in <strong>Settings</strong> to add your business name and logo, then create your first invoice.</div>`;
  }

  /* =========================================================
     VIEW: Builder (create / edit invoice)
     ========================================================= */
  let draft = null;
  let draftIsNew = true;

  function newDraft() {
    const s = state.settings;
    const num = (s.invoicePrefix || "") + String(s.nextNumber || 1);
    const issue = todayISO();
    return {
      id: uid(),
      number: num,
      clientId: state.clients[0] ? state.clients[0].id : "",
      currency: s.defaultCurrency || "USD",
      status: "Draft",
      issueDate: issue,
      dueDate: addDaysISO(issue, 14),
      items: [{ description: "", qty: 1, rate: "" }],
      taxRate: "",
      notes: s.notes || "",
      createdAt: Date.now(),
    };
  }

  function openBuilder(id) {
    if (id) {
      const found = state.invoices.find((i) => i.id === id);
      draft = JSON.parse(JSON.stringify(found));
      draftIsNew = false;
    } else {
      draft = newDraft();
      draftIsNew = true;
    }
    current = "builder";
    $$(".nav-item").forEach((b) => b.classList.remove("active"));
    renderBuilder();
  }

  function clientOptions(selected) {
    const opts = state.clients.map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${esc(c.name)}</option>`).join("");
    return `<option value="">— Select a client —</option>${opts}`;
  }
  function serviceOptions() {
    if (!state.services.length) return "";
    return `<option value="">+ Add from services…</option>` +
      state.services.map((sv) => `<option value="${sv.id}">${esc(sv.name)} — ${money(sv.rate, draft.currency)}</option>`).join("");
  }

  function renderItemsRows() {
    return draft.items.map((it, i) => `
      <div class="item-row" data-i="${i}">
        <input class="input" data-item="description" data-i="${i}" placeholder="Description" value="${esc(it.description)}">
        <input class="input" data-item="qty" data-i="${i}" type="number" min="0" step="any" placeholder="Qty" value="${esc(it.qty)}">
        <input class="input" data-item="rate" data-i="${i}" type="number" min="0" step="any" placeholder="Rate" value="${esc(it.rate)}">
        <div class="amount">${money(lineAmount(it), draft.currency)}</div>
        <button class="icon-btn" data-del-item="${i}" title="Remove">✕</button>
      </div>`).join("");
  }

  function renderBuilder() {
    const s = state.settings;
    view.innerHTML = `
      <div class="page-head">
        <div>
          <h1>${draftIsNew ? "New invoice" : "Edit invoice"}</h1>
          <div class="sub">${draftIsNew ? "Fill in the details — the preview updates as you type." : "Editing " + esc(draft.number)}</div>
        </div>
        <div class="toolbar">
          <button class="btn" data-action="cancel">Cancel</button>
          <button class="btn" data-action="save">Save</button>
          <button class="btn btn-primary" data-action="save-pdf">Save &amp; download PDF</button>
        </div>
      </div>

      <div class="builder">
        <div class="builder-form">
          <div class="card card-pad">
            <div class="section-title">Invoice details</div>
            <div class="row-2">
              <div class="field"><label>Invoice number</label>
                <input class="input" data-f="number" value="${esc(draft.number)}"></div>
              <div class="field"><label>Status</label>
                <select class="select" data-f="status">
                  ${["Draft", "Sent", "Paid"].map((x) => `<option ${x === draft.status ? "selected" : ""}>${x}</option>`).join("")}
                </select></div>
            </div>
            <div class="row-3">
              <div class="field"><label>Currency</label>
                <select class="select" data-f="currency">
                  ${Object.values(CURRENCIES).map((c) => `<option value="${c.code}" ${c.code === draft.currency ? "selected" : ""}>${c.label}</option>`).join("")}
                </select></div>
              <div class="field"><label>Issue date</label>
                <input class="input" type="date" data-f="issueDate" value="${esc(draft.issueDate)}"></div>
              <div class="field"><label>Due date</label>
                <input class="input" type="date" data-f="dueDate" value="${esc(draft.dueDate)}"></div>
            </div>
          </div>

          <div class="card card-pad">
            <div class="section-title">Bill to</div>
            <div class="field">
              <label>Client</label>
              <select class="select" data-f="clientId">${clientOptions(draft.clientId)}</select>
              <button class="link-btn" data-action="toggle-add-client" style="margin-top:8px">+ Add a new client</button>
            </div>
            <div id="inline-client" hidden></div>
          </div>

          <div class="card card-pad">
            <div class="section-title">Items</div>
            <div class="items-head">
              <span>Description</span><span>Qty</span><span>Rate</span><span style="text-align:right">Amount</span><span></span>
            </div>
            <div id="items">${renderItemsRows()}</div>
            <div class="add-row">
              <button class="btn btn-sm" data-action="add-item"><span class="plus">+</span> Add item</button>
              ${state.services.length ? `<select class="select" id="svc-pick" style="max-width:240px">${serviceOptions()}</select>` : ""}
            </div>

            <div class="totals-box">
              <div class="field" style="max-width:200px;margin-bottom:8px">
                <label>Tax / VAT (%)</label>
                <input class="input" type="number" min="0" step="any" data-f="taxRate" placeholder="0" value="${esc(draft.taxRate)}">
              </div>
              <div id="totals"></div>
            </div>
          </div>

          <div class="card card-pad">
            <div class="section-title">Notes</div>
            <div class="field">
              <textarea class="textarea" data-f="notes" placeholder="Payment terms, thank-you note, bank details…">${esc(draft.notes)}</textarea>
            </div>
          </div>
        </div>

        <div class="preview-pane">
          <div class="preview-bar">
            <span>Live preview</span>
            <button class="btn btn-sm" data-action="save-pdf">Download PDF</button>
          </div>
          <div class="preview-scroll" id="preview"></div>
        </div>
      </div>`;

    bindBuilder();
    renderPreview();
    renderTotals();
    // re-fit once the web fonts have loaded (their real height changes the scale)
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => { if (current === "builder") renderPreview(); });
    }
  }

  function renderPreview() {
    $("#preview").innerHTML = renderInvoiceHTML(draft);
    const page = $("#preview").querySelector(".inv-page");
    fitTicket(page);   // scale the ticket so it fits one A4 page
    fitPreview();      // scale the whole A4 page down to fit the preview pane
  }
  // Scale the ticket so it ALWAYS fits on a single A4 page (used on screen and for print).
  function fitTicket(pageEl) {
    if (!pageEl) return;
    const fitBox = pageEl.querySelector(".inv-ticket-fit");
    const ticket = pageEl.querySelector(".inv-ticket");
    if (!fitBox || !ticket) return;
    const availW = pageEl.clientWidth * 0.94;
    const availH = pageEl.clientHeight * 0.94;
    const tW = ticket.offsetWidth, tH = ticket.offsetHeight;
    if (!tW || !tH || !availW || !availH) return;
    fitBox.style.setProperty("--fit", String(Math.min(1, availW / tW, availH / tH)));
  }
  // Scale the whole A4 page down so it's fully visible in the (smaller) preview pane.
  function fitPreview() {
    const pane = $("#preview");
    if (!pane) return;
    const page = pane.querySelector(".inv-page");
    if (!page) return;
    page.style.zoom = "1";
    const natural = page.offsetWidth;
    const avail = pane.clientWidth;
    if (natural > 0 && avail > 0) page.style.zoom = String(Math.min(1, avail / natural));
  }
  function renderTotals() {
    const t = calcTotals(draft);
    const cur = draft.currency;
    $("#totals").innerHTML = `
      <div class="totals-line"><span>Subtotal</span><span>${money(t.subtotal, cur)}</span></div>
      ${t.taxRate ? `<div class="totals-line"><span>Tax / VAT (${t.taxRate}%)</span><span>${money(t.taxAmount, cur)}</span></div>` : ""}
      <div class="totals-line grand"><span>Total</span><span>${money(t.total, cur)}</span></div>`;
  }

  function bindBuilder() {
    // top-level fields
    $$("[data-f]", view).forEach((inp) => {
      inp.addEventListener("input", () => {
        draft[inp.dataset.f] = inp.value;
        if (inp.dataset.f === "currency") $("#items").innerHTML = renderItemsRows();
        renderPreview();
        if (inp.dataset.f === "taxRate" || inp.dataset.f === "currency") renderTotals();
      });
    });

    // line items (event delegation on #items)
    const items = $("#items");
    items.addEventListener("input", (e) => {
      const inp = e.target.closest("[data-item]");
      if (!inp) return;
      const i = Number(inp.dataset.i);
      draft.items[i][inp.dataset.item] = inp.value;
      // update just this row's amount + preview + totals (no full re-render = keep focus)
      const row = inp.closest(".item-row");
      if (row) $(".amount", row).textContent = money(lineAmount(draft.items[i]), draft.currency);
      renderPreview();
      renderTotals();
    });
    items.addEventListener("click", (e) => {
      const del = e.target.closest("[data-del-item]");
      if (!del) return;
      draft.items.splice(Number(del.dataset.delItem), 1);
      if (!draft.items.length) draft.items.push({ description: "", qty: 1, rate: "" });
      items.innerHTML = renderItemsRows();
      renderPreview(); renderTotals();
    });

    // service picker
    const svc = $("#svc-pick");
    if (svc) svc.addEventListener("change", () => {
      const sv = state.services.find((x) => x.id === svc.value);
      if (sv) {
        draft.items.push({ description: sv.name, qty: 1, rate: sv.rate });
        items.innerHTML = renderItemsRows();
        renderPreview(); renderTotals();
      }
      svc.value = "";
    });

    // toolbar / actions
    $$("[data-action]", view).forEach((b) => b.addEventListener("click", () => builderAction(b.dataset.action)));
  }

  function builderAction(a) {
    if (a === "cancel") { firstRun = false; route("invoices"); return; }
    if (a === "add-item") {
      draft.items.push({ description: "", qty: 1, rate: "" });
      $("#items").innerHTML = renderItemsRows();
      renderPreview(); renderTotals();
      return;
    }
    if (a === "toggle-add-client") { toggleInlineClient(); return; }
    if (a === "save") { saveDraft(); return; }
    if (a === "save-pdf") { const saved = saveDraft(); if (saved) downloadPDF(saved); return; }
  }

  function toggleInlineClient() {
    const box = $("#inline-client");
    if (!box.hidden) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = `
      <div class="inline-add">
        <div class="row-2">
          <div class="field"><label>Name</label><input class="input" id="ic-name" placeholder="Client or company"></div>
          <div class="field"><label>Email</label><input class="input" id="ic-email" placeholder="name@email.com"></div>
        </div>
        <div class="field"><label>Address</label><textarea class="textarea" id="ic-address" placeholder="Street, city, postcode, country"></textarea></div>
        <button class="btn btn-primary btn-sm" id="ic-save">Add client</button>
      </div>`;
    $("#ic-save").addEventListener("click", () => {
      const name = $("#ic-name").value.trim();
      if (!name) { toast("Please enter a client name"); return; }
      const c = { id: uid(), name, email: $("#ic-email").value.trim(), phone: "", address: $("#ic-address").value.trim() };
      state.clients.push(c); save();
      draft.clientId = c.id;
      box.hidden = true; box.innerHTML = "";
      $('[data-f="clientId"]').innerHTML = clientOptions(draft.clientId);
      renderPreview();
      toast("Client added");
    });
  }

  function saveDraft() {
    if (!draft.clientId) { toast("Pick a client first"); return null; }
    const hasItem = draft.items.some((it) => (it.description || "").trim() || Number(it.rate));
    if (!hasItem) { toast("Add at least one item"); return null; }

    const existing = state.invoices.findIndex((i) => i.id === draft.id);
    if (existing >= 0) {
      state.invoices[existing] = draft;
    } else {
      state.invoices.push(draft);
      // bump the auto-number only for brand-new invoices that used the suggested number
      const suggested = (state.settings.invoicePrefix || "") + String(state.settings.nextNumber || 1);
      if (draft.number === suggested) state.settings.nextNumber = (state.settings.nextNumber || 1) + 1;
    }
    save();
    firstRun = false;
    toast("Invoice saved");
    const saved = draft;
    // stay on invoices list after a normal save
    setTimeout(() => { if (current !== "builder") return; route("invoices"); }, 50);
    return saved;
  }

  /* ---------- CSV import ---------- */
  function parseCSV(text) {
    const rows = [];
    let cur = [], field = "", inQ = false;
    text = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else { inQ = false; }
        } else field += ch;
      } else if (ch === '"') { inQ = true; }
      else if (ch === ",") { cur.push(field); field = ""; }
      else if (ch === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else field += ch;
    }
    if (field.length || cur.length) { cur.push(field); rows.push(cur); }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
  }

  function importClientsFromCSV(text) {
    const rows = parseCSV(text);
    if (!rows.length) { toast("That CSV looks empty"); return; }
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const find = (names) => header.findIndex((h) => names.includes(h));
    let nameI = find(["name", "client", "company", "client name", "full name"]);
    let emailI = find(["email", "e-mail", "mail"]);
    let phoneI = find(["phone", "tel", "telephone", "mobile", "number"]);
    let addrI = find(["address", "addr", "billing address"]);
    let start = 1;
    if (nameI === -1 && emailI === -1 && phoneI === -1 && addrI === -1) {
      // no recognisable header — assume columns are: name, email, phone, address
      nameI = 0; emailI = 1; phoneI = 2; addrI = 3; start = 0;
    } else if (nameI === -1) nameI = 0;

    const added = [];
    for (let r = start; r < rows.length; r++) {
      const row = rows[r];
      const name = (row[nameI] || "").trim();
      if (!name) continue;
      added.push({
        id: uid(), name,
        email: emailI > -1 ? (row[emailI] || "").trim() : "",
        phone: phoneI > -1 ? (row[phoneI] || "").trim() : "",
        address: addrI > -1 ? (row[addrI] || "").trim() : "",
      });
    }
    if (!added.length) { toast("No clients found in that file"); return; }
    if (!confirm("Add " + added.length + " client" + (added.length === 1 ? "" : "s") + " from this file?")) return;
    state.clients.push.apply(state.clients, added);
    save(); renderClients();
    toast("Added " + added.length + " client" + (added.length === 1 ? "" : "s"));
  }

  /* =========================================================
     VIEW: Clients
     ========================================================= */
  function renderClients() {
    const rows = state.clients.length
      ? state.clients.map((c) => `<tr>
          <td><strong>${esc(c.name)}</strong></td>
          <td>${esc(c.email) || "<span class='muted'>—</span>"}</td>
          <td>${esc(c.phone) || "<span class='muted'>—</span>"}</td>
          <td class="t-actions">
            <button class="btn btn-sm" data-edit-client="${c.id}">Edit</button>
            <button class="btn btn-sm btn-danger" data-del-client="${c.id}">Delete</button>
          </td></tr>`).join("")
      : `<tr><td colspan="4"><div class="empty"><h3>No clients yet</h3><p>Add the people and companies you invoice.</p></div></td></tr>`;

    view.innerHTML = `
      <div class="page-head">
        <div><h1>Clients</h1><div class="sub">${state.clients.length} saved · CSV columns: name, email, phone, address</div></div>
        <div class="toolbar">
          <button class="btn" id="import-clients">Import CSV</button>
          <input type="file" id="import-clients-file" accept=".csv,text/csv" hidden>
          <button class="btn btn-primary" data-new-client><span class="plus">+</span> New client</button>
        </div>
      </div>
      <div class="card"><table class="table">
        <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;

    $("[data-new-client]").addEventListener("click", () => clientForm());
    $("#import-clients").addEventListener("click", () => $("#import-clients-file").click());
    $("#import-clients-file").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => importClientsFromCSV(String(reader.result));
      reader.readAsText(file);
    });
    $$("[data-edit-client]", view).forEach((b) => b.addEventListener("click", () => clientForm(b.dataset.editClient)));
    $$("[data-del-client]", view).forEach((b) => b.addEventListener("click", () => {
      if (confirm("Delete this client? Invoices already created keep their details.")) {
        state.clients = state.clients.filter((c) => c.id !== b.dataset.delClient);
        save(); renderClients(); toast("Client deleted");
      }
    }));
  }

  function clientForm(id) {
    const c = id ? state.clients.find((x) => x.id === id) : { name: "", email: "", phone: "", address: "" };
    view.innerHTML = `
      <div class="page-head"><div><h1>${id ? "Edit client" : "New client"}</h1></div>
        <div class="toolbar"><button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" data-save>Save client</button></div>
      </div>
      <div class="card card-pad" style="max-width:640px">
        <div class="row-2">
          <div class="field"><label>Name</label><input class="input" id="c-name" value="${esc(c.name)}" placeholder="Client or company"></div>
          <div class="field"><label>Email</label><input class="input" id="c-email" value="${esc(c.email)}" placeholder="name@email.com"></div>
        </div>
        <div class="field"><label>Phone</label><input class="input" id="c-phone" value="${esc(c.phone)}" placeholder="Optional"></div>
        <div class="field"><label>Address</label><textarea class="textarea" id="c-address" placeholder="Street, city, postcode, country">${esc(c.address)}</textarea></div>
      </div>`;
    $("[data-cancel]").addEventListener("click", renderClients);
    $("[data-save]").addEventListener("click", () => {
      const name = $("#c-name").value.trim();
      if (!name) { toast("Please enter a name"); return; }
      const data = { name, email: $("#c-email").value.trim(), phone: $("#c-phone").value.trim(), address: $("#c-address").value.trim() };
      if (id) { Object.assign(c, data); } else { state.clients.push(Object.assign({ id: uid() }, data)); }
      save(); renderClients(); toast("Client saved");
    });
  }

  /* =========================================================
     VIEW: Services
     ========================================================= */
  function renderServices() {
    const rows = state.services.length
      ? state.services.map((s) => `<tr>
          <td><strong>${esc(s.name)}</strong></td>
          <td>${esc(s.description) || "<span class='muted'>—</span>"}</td>
          <td class="t-right">${Number(s.rate) ? Number(s.rate).toFixed(2) : "—"}</td>
          <td class="t-actions">
            <button class="btn btn-sm" data-edit-svc="${s.id}">Edit</button>
            <button class="btn btn-sm btn-danger" data-del-svc="${s.id}">Delete</button>
          </td></tr>`).join("")
      : `<tr><td colspan="4"><div class="empty"><h3>No services yet</h3><p>Save services you bill often so you can add them to invoices in one click.</p></div></td></tr>`;

    view.innerHTML = `
      <div class="page-head">
        <div><h1>Services</h1><div class="sub">Reusable line items · rate is a number, currency is set per invoice</div></div>
        <button class="btn btn-primary" data-new-svc><span class="plus">+</span> New service</button>
      </div>
      <div class="card"><table class="table">
        <thead><tr><th>Name</th><th>Description</th><th class="t-right">Default rate</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;

    $("[data-new-svc]").addEventListener("click", () => serviceForm());
    $$("[data-edit-svc]", view).forEach((b) => b.addEventListener("click", () => serviceForm(b.dataset.editSvc)));
    $$("[data-del-svc]", view).forEach((b) => b.addEventListener("click", () => {
      if (confirm("Delete this service?")) {
        state.services = state.services.filter((s) => s.id !== b.dataset.delSvc);
        save(); renderServices(); toast("Service deleted");
      }
    }));
  }

  function serviceForm(id) {
    const s = id ? state.services.find((x) => x.id === id) : { name: "", description: "", rate: "" };
    view.innerHTML = `
      <div class="page-head"><div><h1>${id ? "Edit service" : "New service"}</h1></div>
        <div class="toolbar"><button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" data-save>Save service</button></div>
      </div>
      <div class="card card-pad" style="max-width:640px">
        <div class="field"><label>Name</label><input class="input" id="s-name" value="${esc(s.name)}" placeholder="e.g. Logo design"></div>
        <div class="field"><label>Description</label><input class="input" id="s-desc" value="${esc(s.description)}" placeholder="Optional — shown on the invoice line"></div>
        <div class="field" style="max-width:220px"><label>Default rate</label><input class="input" id="s-rate" type="number" min="0" step="any" value="${esc(s.rate)}" placeholder="0.00">
          <span class="hint">Just the number. £ or $ is chosen per invoice.</span></div>
      </div>`;
    $("[data-cancel]").addEventListener("click", renderServices);
    $("[data-save]").addEventListener("click", () => {
      const name = $("#s-name").value.trim();
      if (!name) { toast("Please enter a name"); return; }
      const data = { name, description: $("#s-desc").value.trim(), rate: $("#s-rate").value };
      if (id) { Object.assign(s, data); } else { state.services.push(Object.assign({ id: uid() }, data)); }
      save(); renderServices(); toast("Service saved");
    });
  }

  /* =========================================================
     VIEW: Expenses
     ========================================================= */
  function renderExpenses() {
    const list = state.expenses.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const rows = list.length
      ? list.map((x) => `<tr>
          <td>${fmtDate(x.date)}</td>
          <td><strong>${esc(x.description) || "—"}</strong></td>
          <td>${esc(x.category) || "—"}</td>
          <td>${EXPENSE_FREQ[x.frequency] || "One-off"}</td>
          <td class="t-right">${money(x.amount, x.currency)}</td>
          <td class="t-actions">
            <button class="btn btn-sm" data-edit-exp="${x.id}">Edit</button>
            <button class="btn btn-sm btn-danger" data-del-exp="${x.id}">Delete</button>
          </td></tr>`).join("")
      : `<tr><td colspan="6"><div class="empty"><h3>No expenses yet</h3><p>Add your business costs — software, hosting, salaries, office rent and so on. Mark recurring ones Monthly or Yearly and the Dashboard projects them to the fiscal year end.</p></div></td></tr>`;

    view.innerHTML = `
      <div class="page-head">
        <div><h1>Expenses</h1><div class="sub">${state.expenses.length} saved · feeds the Dashboard's profit &amp; corporation-tax estimate</div></div>
        <div class="toolbar">
          <button class="btn" id="import-exp">Import bank CSV</button>
          <input type="file" id="import-exp-file" accept=".csv,text/csv" hidden>
          <button class="btn btn-primary" data-new-exp><span class="plus">+</span> New expense</button>
        </div>
      </div>
      <div class="card"><table class="table">
        <thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Frequency</th><th class="t-right">Amount</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;

    $("[data-new-exp]").addEventListener("click", () => expenseForm());
    $("#import-exp").addEventListener("click", () => $("#import-exp-file").click());
    $("#import-exp-file").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const parsed = parseBankCSV(String(reader.result));
        if (parsed.error) { toast(parsed.error); return; }
        const built = buildImportGroups(parsed.rows);
        if (!built.groups.length) { toast(built.dupCount ? "Those rows were already imported." : "No expense (money-out) rows found in that file."); return; }
        pendingImport = built;
        renderImportReview();
      };
      reader.readAsText(file);
      e.target.value = "";
    });
    $$("[data-edit-exp]", view).forEach((b) => b.addEventListener("click", () => expenseForm(b.dataset.editExp)));
    $$("[data-del-exp]", view).forEach((b) => b.addEventListener("click", () => {
      if (confirm("Delete this expense?")) {
        state.expenses = state.expenses.filter((x) => x.id !== b.dataset.delExp);
        save(); renderExpenses(); toast("Expense deleted");
      }
    }));
  }

  function expenseForm(id) {
    const x = id ? state.expenses.find((e) => e.id === id)
      : { description: "", category: "Software", amount: "", currency: state.settings.defaultCurrency || "USD", date: todayISO(), frequency: "monthly" };
    view.innerHTML = `
      <div class="page-head"><div><h1>${id ? "Edit expense" : "New expense"}</h1></div>
        <div class="toolbar"><button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" data-save>Save expense</button></div>
      </div>
      <div class="card card-pad" style="max-width:680px">
        <div class="field"><label>Description</label><input class="input" id="x-desc" value="${esc(x.description)}" placeholder="e.g. Figma subscription"></div>
        <div class="row-2">
          <div class="field"><label>Category</label>
            <select class="select" id="x-cat">${EXPENSE_CATEGORIES.map((c) => `<option ${c === x.category ? "selected" : ""}>${c}</option>`).join("")}</select></div>
          <div class="field"><label>Frequency</label>
            <select class="select" id="x-freq">${Object.keys(EXPENSE_FREQ).map((k) => `<option value="${k}" ${k === (x.frequency || "once") ? "selected" : ""}>${EXPENSE_FREQ[k]}</option>`).join("")}</select></div>
        </div>
        <div class="row-3">
          <div class="field"><label>Amount</label><input class="input" id="x-amount" type="number" min="0" step="any" value="${esc(x.amount)}" placeholder="0.00"></div>
          <div class="field"><label>Currency</label>
            <select class="select" id="x-cur">${Object.values(CURRENCIES).map((c) => `<option value="${c.code}" ${c.code === x.currency ? "selected" : ""}>${c.label}</option>`).join("")}</select></div>
          <div class="field"><label>Date</label><input class="input" id="x-date" type="date" value="${esc(x.date)}"></div>
        </div>
        <span class="hint">Tip: mark a cost <strong>Monthly</strong> and the Dashboard multiplies it by 12 to project the full fiscal year.</span>
      </div>`;
    $("[data-cancel]").addEventListener("click", renderExpenses);
    $("[data-save]").addEventListener("click", () => {
      const desc = $("#x-desc").value.trim();
      const amount = Number($("#x-amount").value);
      if (!desc) { toast("Please enter a description"); return; }
      if (!(amount > 0)) { toast("Enter an amount greater than 0"); return; }
      const data = {
        description: desc,
        category: $("#x-cat").value,
        frequency: $("#x-freq").value,
        amount: amount,
        currency: $("#x-cur").value,
        date: $("#x-date").value || todayISO(),
      };
      if (id) { Object.assign(x, data); } else { state.expenses.push(Object.assign({ id: uid() }, data)); }
      save(); renderExpenses(); toast("Expense saved");
    });
  }

  /* =========================================================
     Bank CSV → expenses import (group by merchant, tag, remember)
     ========================================================= */
  let pendingImport = null;

  function ddmmyyyyToISO(s) {
    const p = String(s || "").trim().split(/[\/\-.]/);
    if (p.length !== 3) return "";
    let y = p[2];
    if (y.length === 2) y = "20" + y;
    if (!/^\d{4}$/.test(y)) return "";
    return y + "-" + String(p[1]).padStart(2, "0") + "-" + String(p[0]).padStart(2, "0");
  }
  function normMerchant(name) { return String(name || "").trim().toUpperCase().replace(/\s+/g, " "); }

  function parseBankCSV(text) {
    const rows = parseCSV(text);
    if (!rows.length) return { error: "That file looks empty." };
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (names) => header.findIndex((h) => names.indexOf(h) !== -1);
    const di = col(["date"]);
    const ni = col(["name", "merchant", "description"]);
    const ai = col(["amount", "value"]);
    const ci = col(["currency"]);
    const ti = col(["transaction id", "id"]);
    if (di === -1 || ai === -1) return { error: "Couldn't find Date and Amount columns in that CSV." };
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const date = ddmmyyyyToISO(row[di]);
      if (!date) continue;
      const amt = Number(String(row[ai] == null ? "" : row[ai]).replace(/[^0-9.\-]/g, ""));
      if (!(amt < 0)) continue;                       // money out only (income comes from invoices)
      const name = String((ni !== -1 ? row[ni] : "") || "(unnamed)").trim();
      const currency = (ci !== -1 ? String(row[ci]).trim().toUpperCase() : "") || (state.settings.defaultCurrency || "GBP");
      const txid = ti !== -1 && String(row[ti]).trim() ? String(row[ti]).trim() : (date + "|" + name + "|" + Math.abs(amt));
      out.push({ date: date, name: name, cost: Math.abs(amt), currency: CURRENCIES[currency] ? currency : "GBP", txid: txid });
    }
    return { rows: out };
  }

  function buildImportGroups(parsed) {
    const seen = {};
    (state.expenses || []).forEach((e) => { if (e.sourceId) seen[e.sourceId] = true; });
    const fresh = parsed.filter((p) => !seen[p.txid]);
    const map = {};
    fresh.forEach((p) => {
      const key = normMerchant(p.name);
      const g = map[key] || (map[key] = { key: key, name: p.name, count: 0, total: 0, currency: p.currency, txns: [], chosen: "__skip" });
      g.count++; g.total += p.cost; g.txns.push(p);
    });
    const groups = Object.keys(map).map((k) => map[k]).sort((a, b) => b.total - a.total);
    return { groups: groups, dupCount: parsed.length - fresh.length };
  }

  function renderImportReview() {
    const groups = pendingImport.groups, dupCount = pendingImport.dupCount;
    const mm = state.settings.merchantMap || {};
    const catOpts = (sel) => `<option value="__skip" ${sel === "__skip" ? "selected" : ""}>— Skip (not a business expense) —</option>`
      + EXPENSE_CATEGORIES.map((c) => `<option value="${esc(c)}" ${sel === c ? "selected" : ""}>${esc(c)}</option>`).join("");
    // seed each group's choice from what we've learned before
    groups.forEach((g) => { g.chosen = mm[g.key] || "__skip"; });
    const rows = groups.map((g, i) => `<tr>
        <td><strong>${esc(g.name)}</strong>${mm[g.key] && mm[g.key] !== "__skip" ? ` <span class="pill pill-sent">auto</span>` : ""}</td>
        <td>${g.count}</td>
        <td class="t-right">${money(g.total, g.currency)}</td>
        <td><select class="select select-sm" data-imp="${i}">${catOpts(g.chosen)}</select></td>
      </tr>`).join("");
    view.innerHTML = `
      <div class="page-head">
        <div><h1>Review import</h1><div class="sub">${groups.length} merchant${groups.length === 1 ? "" : "s"} to tag${dupCount ? ` · ${dupCount} already-imported row${dupCount === 1 ? "" : "s"} skipped` : ""}</div></div>
        <div class="toolbar"><button class="btn" data-imp-cancel>Cancel</button><button class="btn btn-primary" data-imp-add>Add tagged expenses</button></div>
      </div>
      <div class="welcome">Only merchants you give a <strong>category</strong> are added — the rest stay skipped. Your choices are <strong>remembered</strong>, so next month these same merchants are tagged automatically (shown as <span class="pill pill-sent">auto</span>). Money-in rows are ignored; your revenue comes from invoices.</div>
      <div class="card"><table class="table">
        <thead><tr><th>Merchant</th><th>Txns</th><th class="t-right">Total</th><th style="width:260px">Category</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    $$("[data-imp]", view).forEach((sel) => sel.addEventListener("change", () => { groups[Number(sel.dataset.imp)].chosen = sel.value; }));
    $("[data-imp-cancel]").addEventListener("click", () => { pendingImport = null; renderExpenses(); });
    $("[data-imp-add]").addEventListener("click", commitImport);
  }

  function commitImport() {
    const mm = state.settings.merchantMap || (state.settings.merchantMap = {});
    let added = 0;
    pendingImport.groups.forEach((g) => {
      mm[g.key] = g.chosen;                           // learn the choice (including skip)
      if (g.chosen === "__skip") return;
      g.txns.forEach((t) => {
        state.expenses.push({ id: uid(), description: g.name, category: g.chosen, amount: t.cost, currency: t.currency, date: t.date, frequency: "once", sourceId: t.txid, source: "csv" });
        added++;
      });
    });
    save(); pendingImport = null;
    renderExpenses();
    toast(added ? ("Added " + added + " expense" + (added === 1 ? "" : "s")) : "Saved your tagging choices");
  }

  /* =========================================================
     VIEW: Savings & reserves (balance-sheet; shown on Dashboard)
     ========================================================= */
  const SAVING_KINDS = { cash: "Cash savings", reserve: "Reserve asset" };

  function renderSavings() {
    const list = state.savings.slice().sort((a, b) =>
      (SAVING_KINDS[a.kind] || "").localeCompare(SAVING_KINDS[b.kind] || "") || String(a.label).localeCompare(String(b.label)));
    const rows = list.length
      ? list.map((x) => `<tr>
          <td><strong>${esc(x.label) || "—"}</strong></td>
          <td>${SAVING_KINDS[x.kind] || "—"}</td>
          <td class="t-right">${money(x.amount, x.currency)}</td>
          <td class="t-actions">
            <button class="btn btn-sm" data-edit-sav="${x.id}">Edit</button>
            <button class="btn btn-sm btn-danger" data-del-sav="${x.id}">Delete</button>
          </td></tr>`).join("")
      : `<tr><td colspan="4"><div class="empty"><h3>No savings or reserves yet</h3><p>Add cash savings (any currency) and reserve assets you hold. They show as a summary on your Dashboard and don't affect profit or tax.</p></div></td></tr>`;
    view.innerHTML = `
      <div class="page-head">
        <div><h1>Savings &amp; reserves</h1><div class="sub">What your company holds · shown on the Dashboard · not counted as income or expense</div></div>
        <button class="btn btn-primary" data-new-sav><span class="plus">+</span> New entry</button>
      </div>
      <div class="card"><table class="table">
        <thead><tr><th>Label</th><th>Type</th><th class="t-right">Amount</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
    $("[data-new-sav]").addEventListener("click", () => savingsForm());
    $$("[data-edit-sav]", view).forEach((b) => b.addEventListener("click", () => savingsForm(b.dataset.editSav)));
    $$("[data-del-sav]", view).forEach((b) => b.addEventListener("click", () => {
      if (confirm("Delete this entry?")) { state.savings = state.savings.filter((x) => x.id !== b.dataset.delSav); save(); renderSavings(); toast("Deleted"); }
    }));
  }

  function savingsForm(id) {
    const x = id ? state.savings.find((e) => e.id === id)
      : { label: "", kind: "cash", amount: "", currency: state.settings.defaultCurrency || "GBP" };
    view.innerHTML = `
      <div class="page-head"><div><h1>${id ? "Edit entry" : "New savings / reserve"}</h1></div>
        <div class="toolbar"><button class="btn" data-cancel>Cancel</button><button class="btn btn-primary" data-save>Save</button></div>
      </div>
      <div class="card card-pad" style="max-width:620px">
        <div class="field"><label>Label</label><input class="input" id="sv-label" value="${esc(x.label)}" placeholder="e.g. Business savings account, Corporation-tax reserve"></div>
        <div class="row-3">
          <div class="field"><label>Type</label>
            <select class="select" id="sv-kind">${Object.keys(SAVING_KINDS).map((k) => `<option value="${k}" ${k === x.kind ? "selected" : ""}>${SAVING_KINDS[k]}</option>`).join("")}</select></div>
          <div class="field"><label>Amount</label><input class="input" id="sv-amount" type="number" min="0" step="any" value="${esc(x.amount)}" placeholder="0.00"></div>
          <div class="field"><label>Currency</label>
            <select class="select" id="sv-cur">${Object.values(CURRENCIES).map((c) => `<option value="${c.code}" ${c.code === x.currency ? "selected" : ""}>${c.label}</option>`).join("")}</select></div>
        </div>
        <span class="hint">Cash savings can be in any currency. Reserve assets are usually in British Pounds (£).</span>
      </div>`;
    $("[data-cancel]").addEventListener("click", renderSavings);
    $("[data-save]").addEventListener("click", () => {
      const label = $("#sv-label").value.trim();
      const amount = Number($("#sv-amount").value);
      if (!label) { toast("Please enter a label"); return; }
      if (!(amount > 0)) { toast("Enter an amount greater than 0"); return; }
      const data = { label: label, kind: $("#sv-kind").value, amount: amount, currency: $("#sv-cur").value };
      if (id) { Object.assign(x, data); } else { state.savings.push(Object.assign({ id: uid() }, data)); }
      save(); renderSavings(); toast("Saved");
    });
  }

  /* =========================================================
     VIEW: Settings
     ========================================================= */
  function renderSettings() {
    const s = state.settings;
    view.innerHTML = `
      ${firstRun ? `<div class="welcome">👋 Welcome! First, add your business details below and click <strong>Save settings</strong>. Then create your first invoice.</div>` : ""}
      <div class="page-head"><div><h1>Settings</h1><div class="sub">Your business details appear on every invoice.</div></div>
        <button class="btn btn-primary" data-save-settings>Save settings</button>
      </div>

      <div class="card card-pad" style="max-width:760px">
        <div class="section-title">Your business</div>
        <div class="row-2">
          <div class="field"><label>Business name</label><input class="input" id="st-name" value="${esc(s.businessName)}" placeholder="Acme Studio"></div>
          <div class="field"><label>Email</label><input class="input" id="st-email" value="${esc(s.businessEmail)}" placeholder="hello@email.com"></div>
        </div>
        <div class="row-2">
          <div class="field"><label>Phone</label><input class="input" id="st-phone" value="${esc(s.businessPhone)}" placeholder="Optional"></div>
          <div class="field"><label>Default currency</label>
            <select class="select" id="st-currency">
              ${Object.values(CURRENCIES).map((c) => `<option value="${c.code}" ${c.code === s.defaultCurrency ? "selected" : ""}>${c.label}</option>`).join("")}
            </select></div>
        </div>
        <div class="field"><label>Address</label><textarea class="textarea" id="st-address" placeholder="Street, city, postcode, country">${esc(s.businessAddress)}</textarea></div>

        <div class="field"><label>Logo</label>
          <div class="logo-prev">
            <div id="logo-box">${s.logo ? `<img src="${esc(s.logo)}" alt="logo">` : `<span class="muted small">No logo</span>`}</div>
            <input type="file" id="st-logo" accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg">
            ${s.logo ? `<button class="link-btn" id="logo-remove">Remove</button>` : ""}
          </div>
          <details style="margin-top:10px">
            <summary class="link-btn" style="display:inline-block">…or paste SVG code instead</summary>
            <textarea class="textarea" id="st-logo-svg" placeholder="Paste your &lt;svg&gt;…&lt;/svg&gt; code here" style="margin-top:8px;font-family:ui-monospace,Menlo,monospace;font-size:12px"></textarea>
            <button class="btn btn-sm" id="st-logo-svg-apply" style="margin-top:6px">Use this SVG</button>
          </details>
          <span class="hint">PNG, JPG or SVG. An SVG stays perfectly crisp at any size.</span>
        </div>

        <hr class="sep">
        <div class="section-title">Invoice defaults</div>
        <div class="row-3">
          <div class="field"><label>Number prefix</label><input class="input" id="st-prefix" value="${esc(s.invoicePrefix)}" placeholder="INV-"></div>
          <div class="field"><label>Next number</label><input class="input" id="st-next" type="number" min="1" value="${esc(s.nextNumber)}"></div>
          <div class="field"><label>Accent colour (hex)</label>
            <div style="display:flex;gap:8px;align-items:center">
              <span id="accent-swatch" style="width:36px;height:36px;border-radius:8px;border:1px solid var(--line-strong);background:${esc(s.accentColor || "#E18910")};flex:none"></span>
              <input class="input" id="st-accent" value="${esc(s.accentColor || "#E18910")}" placeholder="#E18910">
            </div>
            <span class="hint">Type a hex code, e.g. #112233.</span>
          </div>
        </div>
        <div class="field"><label>Default note on invoices</label><textarea class="textarea" id="st-notes">${esc(s.notes)}</textarea></div>

        <hr class="sep">
        <div class="section-title">Fiscal year</div>
        <p class="muted small" style="margin-top:-6px">Your accounting year — the <strong>Dashboard</strong> uses it to group revenue, expenses and tax. Default: 1 March → 28 February.</p>
        <div class="row-2" style="max-width:460px">
          <div class="field"><label>Fiscal year starts — month</label>
            <select class="select" id="st-tymonth">${MONTH_LONG.map((m, i) => `<option value="${i + 1}" ${(i + 1) === (Number(s.taxYearStartMonth) || 1) ? "selected" : ""}>${m}</option>`).join("")}</select>
          </div>
          <div class="field"><label>Day of month</label>
            <input class="input" id="st-tyday" type="number" min="1" max="31" value="${esc(Number(s.taxYearStartDay) || 1)}">
          </div>
        </div>
        <span class="hint" id="ty-hint"></span>

        <div class="field" style="max-width:240px;margin-top:16px"><label>Corporation tax rate (%)</label>
          <input class="input" id="st-corptax" type="number" min="0" max="100" step="any" value="${esc(s.corpTaxRate != null ? s.corpTaxRate : 19)}">
          <span class="hint">UK small-profits rate is 19%. Used on the Dashboard to estimate tax.</span>
        </div>
      </div>

      <div class="card card-pad" style="max-width:760px;margin-top:20px">
        <div class="section-title">Your data</div>
        <p class="muted small" style="margin-top:0">Everything is stored only in this browser on this computer. Back up regularly and keep the file safe — it's your records.</p>
        <div class="toolbar">
          <button class="btn" data-action="backup">Download backup</button>
          <button class="btn" id="restore-btn">Restore from backup</button>
          <input type="file" id="restore-file" accept="application/json,.json" hidden>
        </div>
      </div>`;

    // logo upload
    $("#st-logo").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { s.logo = reader.result; $("#logo-box").innerHTML = `<img src="${esc(s.logo)}" alt="logo">`; };
      reader.readAsDataURL(file);
    });
    const logoRemove = $("#logo-remove");
    if (logoRemove) logoRemove.addEventListener("click", () => { s.logo = ""; renderSettings(); });

    // paste raw SVG code as logo
    $("#st-logo-svg-apply").addEventListener("click", () => {
      const code = $("#st-logo-svg").value.trim();
      if (!/<svg[\s>]/i.test(code)) { toast("That doesn't look like SVG code"); return; }
      s.logo = "data:image/svg+xml," + encodeURIComponent(code);
      $("#logo-box").innerHTML = `<img src="${esc(s.logo)}" alt="logo">`;
      toast("Logo set from SVG");
    });

    // live accent swatch as you type a hex
    $("#st-accent").addEventListener("input", () => {
      const hex = normalizeHex($("#st-accent").value);
      if (hex) $("#accent-swatch").style.background = hex;
    });

    // tax year — live "runs X → Y" hint (end is the day before the start)
    function updateTyHint() {
      const m = Math.min(12, Math.max(1, Number($("#st-tymonth").value) || 1));
      const d = Math.min(31, Math.max(1, Number($("#st-tyday").value) || 1));
      const end = new Date(2003, m - 1, d); end.setDate(end.getDate() - 1);  // non-leap reference year
      $("#ty-hint").textContent =
        "Your tax year runs " + d + " " + MONTH_SHORT[m - 1] +
        " → " + end.getDate() + " " + MONTH_SHORT[end.getMonth()] + " (ends the day before it starts again).";
    }
    $("#st-tymonth").addEventListener("change", updateTyHint);
    $("#st-tyday").addEventListener("input", updateTyHint);
    updateTyHint();

    $("[data-save-settings]").addEventListener("click", () => {
      s.businessName = $("#st-name").value.trim();
      s.businessEmail = $("#st-email").value.trim();
      s.businessPhone = $("#st-phone").value.trim();
      s.businessAddress = $("#st-address").value.trim();
      s.defaultCurrency = $("#st-currency").value;
      s.invoicePrefix = $("#st-prefix").value;
      s.nextNumber = Number($("#st-next").value) || 1;
      const hex = normalizeHex($("#st-accent").value);
      if (!hex) { toast("Accent colour must be a hex code like #112233"); return; }
      s.accentColor = hex;
      s.notes = $("#st-notes").value;
      s.taxYearStartMonth = Math.min(12, Math.max(1, Number($("#st-tymonth").value) || 1));
      s.taxYearStartDay = Math.min(31, Math.max(1, Number($("#st-tyday").value) || 1));
      s.corpTaxRate = Math.min(100, Math.max(0, Number($("#st-corptax").value) || 0));
      save(); firstRun = false; toast("Settings saved");
    });

    $("#restore-btn").addEventListener("click", () => $("#restore-file").click());
    $("#restore-file").addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          if (!data || typeof data !== "object") throw new Error("bad");
          if (!confirm("Restore this backup? It replaces everything currently in the app.")) return;
          state = {
            settings: Object.assign({}, DEFAULTS.settings, data.settings || {}),
            clients: data.clients || [],
            services: data.services || [],
            invoices: data.invoices || [],
            expenses: data.expenses || [],
            savings: data.savings || [],
          };
          save(); firstRun = false; route("dashboard"); toast("Backup restored");
        } catch (err) { toast("That file isn't a valid backup"); }
      };
      reader.readAsText(file);
    });
  }

  /* ---------- backup ---------- */
  function backup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = todayISO();
    a.href = url; a.download = "invoices-backup-" + d + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("Backup downloaded");
  }

  /* =========================================================
     GLOBAL wiring
     ========================================================= */
  document.addEventListener("click", (e) => {
    const r = e.target.closest("[data-route]");
    if (r) { route(r.dataset.route); return; }
    const a = e.target.closest("[data-action]");
    if (a && !a.closest("#view")) { // sidebar / global actions only
      if (a.dataset.action === "new-invoice") openBuilder();
      else if (a.dataset.action === "backup") backup();
    }
  });

  // Also handle [data-action="new-invoice"] inside the view (empty-state buttons)
  view.addEventListener("click", (e) => {
    const a = e.target.closest('[data-action="new-invoice"]');
    if (a) openBuilder();
  });

  // keep the live preview fitted when the window resizes
  window.addEventListener("resize", () => { if (current === "builder") fitPreview(); });

  /* ---------- boot ---------- */
  (function () {
    load().then(() => {
      route(firstRun ? "settings" : "dashboard");
    });
  })();
})();
