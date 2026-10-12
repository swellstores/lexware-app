Lexware Office (formerly lexoffice) is where your invoices are issued and your books are kept. This app creates the invoice in Lexware when an order is paid and the credit note when a payment is refunded, so nobody types an order into Lexware again.

**What it does**

- An order becomes paid: an invoice is created in Lexware with your number range, layout and texts. Each order item, shipping and discounts are on it, and it says that it is already paid.
- A payment is refunded, in part or in full: a credit note is created that names the invoice. A full refund repeats the invoice's lines; a partial refund is split over the invoice's tax rates.
- Each document is shown on its order in Swell and under Orders → Lexware documents, with its number, a link into Lexware and the PDF.
- If you like, the customer gets the PDF by e-mail, in German or English.
- For orders the automation does not cover, such as unpaid bank transfer orders or orders from before the install, choose Create Lexware invoice on the order, or select orders in the order list.

**Exact, with the right tax type**

- The invoice total is what the customer paid, to the cent. Lexware calculates tax in its own way, so the app reproduces that calculation before it sends anything.
- Germany: invoices with 19 %, 7 % and 0 %, net or gross like your store's prices.
- EU consumers: the destination country's VAT when your Lexware account uses the One-Stop-Shop, German VAT otherwise.
- EU businesses with a VAT ID: tax-free intra-community supply. Countries outside the EU: tax-free export.
- Small businesses (§19 UStG): invoices without VAT.
- The app carries the tax your store charged and never guesses. An order that fits no Lexware tax type is not sent; it is listed with the reason.

**Reliable**

- One invoice per order and one credit note per refund, also when a request is repeated or its answer is lost.
- Nothing is lost quietly. What could not be created is listed under Needs attention with the reason, and can be retried one by one or all at once.
- If Lexware stops accepting your API key, the store's administrators get an e-mail.
- The app only reads your orders. It never changes orders, payments or customers in Swell, and never edits or deletes anything in Lexware.

**Setup**

1. In Lexware, complete your company and tax settings and create an API key under Extensions → Public API. The Public API needs the Lexware plan XL.
2. Paste the key into the app's settings, save, and press Test connection.
3. Choose drafts or finalized documents, the language, and whether customers are e-mailed.
4. Turn on "Create documents automatically".

**Good to know**

- Lexware has no way to mark an invoice as paid through its API. Invoices arrive as open and say "already paid"; you assign the payments in Lexware as usual.
- Lexware issues invoices in EUR only. Orders in other currencies are skipped.
- A finalized document cannot be changed or deleted through the API. Start with drafts, and use a Lexware test account in your store's test environment.

Requires a Lexware Office account with the plan XL.
