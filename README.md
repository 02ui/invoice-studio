# Invoice Studio

A tiny, private invoicing app that runs entirely on your computer.
No accounts, no database, no cloud — one HTML page, one optional local server, and your data in a plain JSON file you own.

Built for freelancers and small studios who want to make clean invoices and keep an eye on their numbers without signing up for anything.

## Features

- **Invoices** — line items, four currencies (`$ £ € ₺`), tax/VAT, live A4 preview that always fits one page, PDF export (print → "Save as PDF")
- **Clients & services** — save the people you bill and the things you bill for; add them to an invoice in one click; import clients from CSV
- **Expenses** — one-off, monthly, or yearly business costs by category
- **Savings** — track cash savings and reserves alongside the business
- **Dashboard** — revenue, expenses, projected net profit and tax for your fiscal year, a monthly revenue chart, and a hand-built SVG Sankey diagram showing where the money flows
- **Yours to style** — the invoice design lives in one CSS file (`public/invoice.css`); the accent colour, logo, and business details come from Settings

## Run it

**Easiest:** open `public/index.html` in your browser. Done. Data is saved in the browser (localStorage).

**Recommended:** run the tiny local server so your data is written to a real file (`data.json`) you can back up or sync:

```bash
node serve.js
```

then open **http://localhost:4242**. No dependencies — Node.js is all you need.

## Your data

- Browser mode: stored in localStorage on that device.
- Server mode: stored in `data.json` next to `serve.js` (gitignored — never commit it).
- The **Back up my data** button downloads everything as a single JSON file; restore from Settings.

## Customising the invoice

- Colours, spacing, typography: edit `public/invoice.css` (every class is prefixed `inv-`).
- Markup/structure: edit `renderInvoiceTicket()` in `public/invoice-template.js`.
- Keep the `.inv-page` → `.inv-ticket-fit` → `.inv-ticket` wrapper structure — that's what guarantees the invoice always scales to a single A4 page, on screen and in the PDF.

## License

MIT — see [LICENSE](LICENSE).
