/* ============================================================
   invoice-template.js  —  SINGLE SOURCE for the invoice markup.
   Used by the live preview and by PDF export (print).
   Pure function — no DOM, no app state. Pairs with invoice.css.

   The default design is intentionally clean and neutral:
   your business name (or uploaded logo), an accent colour you
   pick in Settings, and a classic items table on a white A4 page.
   Restyle freely in invoice.css — or rewrite this markup.
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.InvoiceTemplate = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function nl2br(s) { return String(s || "").replace(/\n/g, "<br>"); }

  var CURRENCIES = {
    USD: { code: "USD", symbol: "$", locale: "en-US", label: "US Dollar ($)" },
    GBP: { code: "GBP", symbol: "£", locale: "en-GB", label: "British Pound (£)" },
    EUR: { code: "EUR", symbol: "€", locale: "en-IE", label: "Euro (€)" },
    TRY: { code: "TRY", symbol: "₺", locale: "tr-TR", label: "Turkish Lira (₺)" },
  };
  function money(amount, code) {
    var c = CURRENCIES[code] || CURRENCIES.USD;
    var n = Number(amount) || 0;
    try {
      return new Intl.NumberFormat(c.locale, { style: "currency", currency: c.code }).format(n);
    } catch (e) {
      return c.symbol + n.toFixed(2);
    }
  }
  function fmtDate(iso) {
    if (!iso) return "—";
    var p = String(iso).split("-").map(Number);
    if (p.length !== 3 || !p[0]) return esc(iso);
    var m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return String(p[2]).padStart(2, "0") + " " + m[p[1] - 1] + " " + p[0];
  }
  function lineAmount(it) { return (Number(it.qty) || 0) * (Number(it.rate) || 0); }
  function calcTotals(inv) {
    var subtotal = (inv.items || []).reduce(function (a, it) { return a + lineAmount(it); }, 0);
    var taxRate = Number(inv.taxRate) || 0;
    var taxAmount = subtotal * taxRate / 100;
    return { subtotal: subtotal, taxRate: taxRate, taxAmount: taxAmount, total: subtotal + taxAmount };
  }

  /* ---------- the invoice markup (pairs with invoice.css) ---------- */
  function renderInvoiceTicket(inv, settings, client) {
    var s = settings || {};
    client = client || null;
    var cur = inv.currency || s.defaultCurrency;
    var t = calcTotals(inv);
    var accent = /^#[0-9a-fA-F]{6}$/.test(String(s.accentColor || "")) ? s.accentColor : "#4f46e5";

    var num = String(inv.number || "");
    var year = String(inv.issueDate || "").slice(0, 4) || String(new Date().getFullYear());

    var brand = s.logo
      ? '<img class="inv-logo" src="' + esc(s.logo) + '" alt="">'
      : '<span class="inv-bizname">' + (esc(s.businessName) || "Your business") + "</span>";

    var contact = [s.businessEmail, s.businessPhone].filter(Boolean).map(esc)
      .join("&nbsp;&nbsp;·&nbsp;&nbsp;");

    var rows = (inv.items || []).length
      ? inv.items.map(function (it) {
          return `
            <div class="inv-item">
              <div class="inv-item-desc">${esc(it.description) || "&nbsp;"}</div>
              <div class="inv-r">${esc(it.qty === "" || it.qty == null ? "" : it.qty)}</div>
              <div class="inv-r">${money(it.rate, cur)}</div>
              <div class="inv-r">${money(lineAmount(it), cur)}</div>
            </div>`;
        }).join("")
      : `<div class="inv-item"><div class="inv-item-desc inv-muted">No items yet</div><div></div><div></div><div></div></div>`;

    return `
    <div class="inv-page" style="--inv-accent:${esc(accent)}">
      <div class="inv-ticket-fit">
        <article class="inv-ticket">

          <header class="inv-head">
            <div class="inv-brand">${brand}</div>
            <div class="inv-head-meta">${nl2br(esc(s.businessAddress))}</div>
          </header>

          <section class="inv-title-row">
            <div>
              <h1 class="inv-title">Invoice</h1>
              <div class="inv-number">${esc(num) ? "Nº " + esc(num) : ""}</div>
            </div>
            <div class="inv-dates">
              <div class="inv-date-row"><span class="inv-date-lbl">Issue date</span><span class="inv-date-val">${fmtDate(inv.issueDate)}</span></div>
              <div class="inv-date-row"><span class="inv-date-lbl">Due date</span><span class="inv-date-val">${fmtDate(inv.dueDate)}</span></div>
            </div>
          </section>

          <section class="inv-parties">
            <div class="inv-party">
              <div class="inv-party-lbl">Bill from</div>
              <div class="inv-party-name">${esc(s.businessName) || "—"}</div>
              <address class="inv-party-addr">${nl2br(esc(s.businessAddress))}</address>
            </div>
            <div class="inv-party">
              <div class="inv-party-lbl">Bill to</div>
              <div class="inv-party-name">${client ? esc(client.name) : "—"}</div>
              <address class="inv-party-addr">${client ? nl2br(esc(client.address)) : ""}</address>
            </div>
          </section>

          <section class="inv-items">
            <div class="inv-items-head">
              <div>Description</div>
              <div class="inv-r">Qty</div>
              <div class="inv-r">Rate</div>
              <div class="inv-r">Amount</div>
            </div>
            ${rows}
            <div class="inv-subtotals">
              <div class="inv-sub-row"><span>Subtotal</span><span>${money(t.subtotal, cur)}</span></div>
              ${t.taxRate ? `<div class="inv-sub-row"><span>Tax / VAT (${t.taxRate}%)</span><span>${money(t.taxAmount, cur)}</span></div>` : ""}
              <div class="inv-total-row"><span>Total</span><span>${money(t.total, cur)}</span></div>
            </div>
          </section>

          ${inv.notes ? `<p class="inv-note">${nl2br(esc(inv.notes))}</p>` : ""}

          <footer class="inv-footer">
            ${esc(year)}${s.businessName ? "&nbsp;&nbsp;·&nbsp;&nbsp;" + esc(s.businessName) : ""}${contact ? "&nbsp;&nbsp;·&nbsp;&nbsp;" + contact : ""}
          </footer>

        </article>
      </div>
    </div>`;
  }

  return {
    renderInvoiceTicket: renderInvoiceTicket,
    money: money, fmtDate: fmtDate, calcTotals: calcTotals, lineAmount: lineAmount,
    esc: esc, nl2br: nl2br, CURRENCIES: CURRENCIES,
  };
});
