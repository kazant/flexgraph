# Privacy Policy — FlexGraph license validation

> Draft — have it reviewed. Merge into your company's main privacy policy.

**Controller:** FlexGraph Labs AS, Eksempelveien 1, 0150 Oslo, Norway · privacy@flexgraph.example

## What the library sends
When a page that uses FlexGraph loads on a non-development domain, the library sends one request to `https://license.flexgraph.example/v1/validate` (and then at most about once a week per browser, thanks to caching) containing:

- the project **license key**,
- the **domain** (hostname) of the page,
- the **library version**.

No cookies, no user identifiers, no page content and no personal data about end users are sent. The signed response is cached in the browser's `localStorage`.

## What the server stores
- **Customers:** email address, company name, payment-provider customer id, subscription status — to provide the service (contract, GDPR art. 6(1)(b)).
- **Validation statistics:** per project, domain, day and library version: a request count and whether the domain was registered. Kept for 90 days, used for the customer usage dashboard and to detect license misuse (legitimate interest, art. 6(1)(f)).
- **IP addresses** of requests are processed only in memory for rate limiting (up to one minute) and are **not stored**.

## Processors
Cloudflare (hosting), [Lemon Squeezy / Stripe] (payments, acts as merchant of record where applicable), Resend (email). Data may be processed outside the EEA under Standard Contractual Clauses.

## Your rights
You can request access, correction, deletion, restriction or portability of your data, and object to processing, by emailing privacy@flexgraph.example. You may complain to Datatilsynet (the Norwegian Data Protection Authority).
