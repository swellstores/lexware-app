# Lexware Office for Swell

Creates invoices and credit notes in [Lexware Office](https://www.lexware.de/) (formerly lexoffice) for a Swell store's orders. An order that becomes paid gets an invoice. A refund gets a credit note. Each document is shown on its order in Swell, with its number, a link into Lexware and the PDF.

Data flows one way, from Swell to Lexware, with the merchant's own API key. The app reads orders and customers. It writes only its own records in Swell, and only new documents and contacts in Lexware.

## Setup

1. In Lexware (plan XL): complete the company and tax settings, then create an API key under Extensions → Public API (`app.lexware.de/addons/public-api`). "All permissions" works. For a key with selected permissions, see "API key permissions".
2. In Swell, open Apps → Lexware Office → Settings, paste the key, save, and press **Test connection**. It names the Lexware company and says how it will be invoiced.
3. Under **Documents**, choose:
   - **Create documents as**: drafts or finalized documents. See "Drafts and finalized documents".
   - **Document language**: German, English, or German for Germany, Austria, Switzerland and Liechtenstein and English elsewhere.
   - **Create credit notes for refunds**.
   - **E-mail documents to customers**.
4. Turn on **Create documents automatically**.

Settings are separate for the store's test and live environments, and both start empty.

## What is created

| In Swell | In Lexware |
| --- | --- |
| An order becomes paid | An invoice |
| A payment of an invoiced order is refunded, in part or in full | A credit note that names the invoice |
| **Create Lexware invoice** on an order, or **Create Lexware invoices** on selected orders | An invoice, paid or not |

**The invoice.** Addressed to the billing address. A first line names the Swell order. Then one line per order item, one for shipping, and discounts as a negative line per tax rate, named after the coupon. A paid order's invoice says that it is already paid, and how. Title, introduction, closing text, layout and number range come from the Lexware account.

**The credit note.** A refund in Swell is an amount and names no items. A refund of the whole invoice repeats the invoice's lines. A partial refund becomes one line per tax rate, split in the proportion the rates have on the invoice. The credit note names the invoice, the order and the refund in its first line. It is not linked to the invoice in Lexware: Lexware allows one linked credit note per invoice and means it for unpaid invoices.

**Orders without a document.** An order in another currency than EUR is skipped: Lexware invoices in EUR only. A refund of an order the app did not invoice is ignored. A free order never becomes "paid" in Swell and gets no invoice; use the action if one is wanted.

## Tax

The app does not decide what tax is due. It takes the tax Swell charged and chooses the Lexware tax type that says the same:

| Order | Lexware document |
| --- | --- |
| Lexware account is a small business (§19 UStG) or tax-exempt | Invoice without VAT |
| Germany | Net invoice when store prices exclude tax, gross invoice when they include it |
| Another EU country, tax charged | The same, marked as a distance sale when Lexware is set to the destination country's VAT (One-Stop-Shop) |
| Another EU country, no tax, customer has a VAT ID | Tax-free intra-community supply |
| Outside the EU, no tax | Tax-free export of goods, or service to a third country when nothing is shipped |

An order that fits none of these is not sent. It is listed under **Needs attention** with the reason. The usual reasons:

- **No tax where tax is due**: a German or EU consumer order that was charged no tax. Gift cards are the exception and are invoiced without tax.
- **Rates Lexware does not accept for the country**: for example the destination country's rate while Lexware is set to German VAT for EU consumers, or the reverse. Lexware decides this, and the app passes on its answer.
- **Tax that is not what the rates give**: the store calculates tax before discounts. Tax has to be calculated after discounts (Settings → Taxes in Swell).
- **No VAT ID of your own in Lexware**: tax-free EU invoices need the merchant's VAT ID in Lexware's company settings.

**To the cent.** Lexware computes all totals itself: each line rounded to cents, summed per tax rate, tax on each sum. Swell computes tax per item with four decimals and rounds the order total. The app reproduces Lexware's calculation before it sends anything. When a net invoice would be a cent off, the same lines are sent as gross amounts, whose sum is the order total. If no layout gives the order total, nothing is sent.

**Contacts.** Lexware accepts a one-time address for German addresses only. For every other country the app creates a Lexware contact for the customer, once, and uses it for later orders of the same customer.

## Drafts and finalized documents

A **finalized** document is numbered, booked, has a PDF, and cannot be changed or deleted through the API. A **draft** waits in Lexware until someone finalizes it there. A draft takes a number from the range too, but can be edited and deleted in Lexware.

- New installs create drafts until the setting is changed.
- A draft has no PDF, so the customer is not e-mailed. After finalizing a draft in Lexware, open the document in Swell and choose **Read again from Lexware**: the app fetches the PDF and e-mails the customer if e-mails are on. For many at once, select them on the **Drafts** tab of Orders → Lexware documents and choose **Retry**.
- Lexware's API has no sandbox. A key always belongs to a real account, and every document counts. In the store's test environment use a Lexware test account (free for 30 days, at `app.lexware.de/signup/app/trial`), or keep drafts.

## In the dashboard

- **Orders → Lexware documents** lists every invoice and credit note, with tabs for **Needs attention**, **In Lexware**, **Drafts** and **Skipped**. A document's page shows the number, the PDF, the Lexware status and tax type, and has **View in Lexware**.
- **The order's Lexware tab** shows the order's documents. **Create Lexware invoice** is in the order's Actions menu.
- A document that needs attention has **Retry** and **Mark as resolved**. Resolve it after creating the document in Lexware by hand, or when none is needed: the app will then not create it.
- **Retry failed documents**, in the Actions menu of the app's settings page, retries everything under Needs attention.

Through the API, an order's documents expand as `$app.lexware.documents`.

## Day-to-day use

Once the app is switched on, a paid or refunded order needs nothing from you: its document appears in Lexware and on the order shortly after.

- **Payments.** Invoices arrive in Lexware as open. Assign the payments there as usual (see "Limits and known issues").
- **Drafts.** While the app creates drafts, review and finalize them in Lexware. Then choose **Read again from Lexware** on the document in Swell, or select several on the **Drafts** tab and choose **Retry**.
- **Needs attention.** When the e-mail "Action needed" arrives, open Orders → Lexware documents → **Needs attention** and read the reason. Correct the cause and choose **Retry**, or choose **Mark as resolved** after creating the document in Lexware by hand.
- **Orders the automation does not cover.** For unpaid orders, such as bank transfer, and for orders from before the install, choose **Create Lexware invoice** on the order, or select orders in the order list.

## When something goes wrong

| What happens | What the app does |
| --- | --- |
| Lexware is down, slow or rate-limiting | The event is delivered again by Swell at growing intervals, for up to a day. Then the document is listed under Needs attention |
| An answer from Lexware is lost | The next attempt looks for the document in Lexware before creating anything: among the documents created at that time, by its total and its first line |
| The same event arrives twice | The second one finds the document's record and stops |
| An event and a click on Retry reach the same document at the same moment | One of them takes the record, the other stops |
| Lexware refuses the key, or the plan lost API access | Affected documents are listed under Needs attention. The store's administrators get one e-mail. After the key is corrected, **Retry failed documents** creates them |
| Lexware refuses a document, or no invoice can be built | Listed under Needs attention with the reason. The administrators get one e-mail while such documents wait, not one per order |
| A document was created in Lexware, but its number or PDF could not be read | Listed under Needs attention with what is known. **Retry** finishes it and creates nothing |
| A draft was deleted in Lexware, or the API key now belongs to another Lexware account | The next time the app reads the document it is listed under Needs attention. **Retry** creates it again, **Mark as resolved** leaves it. A credit note for an invoice that is gone has to be created in Lexware by hand |

E-mails to administrators are sent by the notification "Lexware Office needs attention", and the customer's e-mail by "Lexware document for the customer". Both can be edited or switched off under Settings → Notifications.

## Limits and known issues

- **Invoices are not marked as paid in Lexware.** The Public API cannot write payments. Invoices arrive as open and state that they are paid; payments are assigned in Lexware as usual. A paid order's invoice is due on its own date, so Lexware lists it as overdue from the next day until its payment is assigned. A credit note stays open until the refund is assigned to it.
- **Changes to an order after its invoice** (edited or canceled items without a refund) are not followed.
- **Credit notes are by amount**, not by item, because a Swell refund names no items.
- **Subscription renewals that create no order** are not invoiced. Renewals that create an order are.
- **Billing and delivery in different tax countries** may be refused by Lexware, which checks tax rates against the country of the document's address.
- **The PDF link is not protected.** The PDF is stored as a file in Swell at an address that cannot be guessed, like other Swell files. Anyone with the link can open it.
- **E-invoices** (XRechnung, ZUGFeRD) are whatever Lexware produces for the document; the app does not control it.
- The customer's e-mail carries a link to the PDF, not an attachment.

## API key permissions

A key with selected permissions needs: profile (read), invoices (read and write), credit notes (read and write), contacts (read and write), and the voucher list. A missing permission shows as "The API key is not allowed to do this" on the affected document. This list follows Lexware's permission names and was not tested one by one; a key with all permissions was.

## How it is built

| Block | Files | Job |
| --- | --- | --- |
| Manifest | `swell.json` | Integration app. Scopes: `read_orders`, `read_accounts` |
| Settings | `settings/connection.json`, `settings/documents.json` | Key, switch, document options; **Test connection** and **Retry failed documents** |
| Models | `models/documents.json`, `models/alerts.json`, `models/orders.json` | The ledger of documents; open alerts; a link from the order to its documents |
| Views | `content/documents.json`, `content/orders.json` | The documents list and page; the order's tab and actions |
| Event functions | `functions/invoice-order.ts`, `functions/credit-refund.ts` | `order.paid` and `payment.refund.succeeded`, only while the app is switched on |
| Actions | `functions/create-invoice.ts`, `process-document.ts`, `resolve-document.ts`, `test-connection.ts` | The dashboard buttons |
| Workflow | `functions/process-documents.ts` | Bulk work in steps of five documents, at Lexware's pace |
| Notifications | `notifications/document-ready.*`, `notifications/alert.*` | The customer's e-mail; the administrators' alert |
| Library | `functions/lib/` | See below |

`functions/lib/`:

- `process.ts` is the state machine: claim the record, create in Lexware, read number and status, store the PDF, e-mail. Every stage is saved before the next, so any caller can resume a record. Start here.
- `documents.ts` is the ledger. A record is created under a unique key per order or refund before anything is sent, which is what keeps a document from being created twice. A later attempt takes the record by raising its attempt counter in the store, so two attempts that start together cannot both go on.
- `invoice.ts` and `credit-note.ts` build the Lexware payloads. Both are pure. `tax.ts` chooses the tax type, `money.ts` does the arithmetic in whole numbers, `dates.ts` writes German local time.
- `lexware.ts` is the API client: two requests per second, waits on 429, and marks a write without an answer as uncertain.
- `alerts.ts`, `event.ts`, `actions.ts`, `settings.ts`, `texts.ts` are small.

`models/orders.json` and `content/orders.json` name the documents collection by its short name, `documents`. The platform turns a short name into the app's own collection when the app is installed. Do not write `apps/lexware/documents` there: that form is stored as written, the dashboard cannot resolve it, and the order page fails to open.

## Development

```bash
npm install
npm test            # unit tests, no network
npm run typecheck
swell app push      # deploys to the test environment of the logged-in store
```

The unit tests replace Lexware with an in-memory stand-in (`test/helpers/lexware.ts`) and the store with another (`test/helpers/store.ts`). The orders in `test/fixtures/orders.ts` are real API responses, and the expected invoices are what Lexware produced for them.

After a change in `functions/lib/` only, push with `--force`: push skips function files whose own content did not change.

### App Store listing

| What | Where |
| --- | --- |
| Full description | `DESCRIPTION.md` |
| Short description | `description` in `swell.json` (up to 70 characters) |
| Icon | `assets/icon.png` |
| Screenshots | `assets/images/*.png` (3200 × 1800), listed in `images` in `swell.json` |

## License

[MIT](LICENSE.md)
