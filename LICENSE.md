# FlexGraph Commercial License Agreement (EULA)

> **Draft — have a lawyer review this before use.** It is a starting point that reflects the licensing model in PLAN.md, not legal advice. Check the requirements for selling to businesses and consumers in Norway/EU (including VAT/MVA, consumer rights and the right of withdrawal).

Version 1.0 — effective [DATE]

This agreement ("Agreement") is between **FlexGraph Labs AS**, org. no. 999 999 999, Eksempelveien 1, 0150 Oslo, Norway ("Licensor") and the person or entity that subscribes to or uses FlexGraph ("Customer").

## 1. Definitions

- **Software**: the FlexGraph JavaScript library, CSS, type definitions and documentation, in any version, including the trial build.
- **Project**: one application with **one production domain** (optionally including its subdomains when the Customer selects the wildcard option) and **up to three non-production domains** (staging, test, preview). `localhost` and `127.0.0.1` may always be used for development at no cost.
- **License Key**: the key issued for one Project.
- **Subscription**: the paid recurring plan for one or more Projects (USD 79 per Project per month, or the annual price shown at purchase).

## 2. License grant

Subject to an active, paid Subscription, Licensor grants Customer a non-exclusive, non-transferable, worldwide license during the Subscription term to:

1. use the Software in the Project for which the License Key was issued, on the domains registered for that Project;
2. modify the Software's CSS and configuration, and bundle the Software into the Project's distributed application;
3. allow end users of the Project to use the Software as part of the Project, without a separate license.

One License Key covers one Project. Each additional Project requires an additional License.

## 3. Restrictions

Customer must not:

1. remove, disable, circumvent or interfere with the license check, watermark, "License inactive" overlay or any related mechanism, or use a modified build for that purpose;
2. share a License Key between Projects, or use it on domains not registered for its Project;
3. redistribute the Software as a standalone library, component, SDK or development tool, or make it available to third parties for their own development;
4. publish the Software or a registry access token publicly;
5. reverse engineer the Software except to the extent permitted by mandatory law.

Bypassing the license check is a material breach of this Agreement.

## 4. Domains

Customer registers the Project's domains in the customer portal. Domains may be changed up to three times per 30 days. Licensor may refuse registrations that indicate that one License is used for several Projects.

## 5. License validation and data

The Software contacts Licensor's license server to validate the License Key. It sends the License Key, the domain (hostname) and the library version. The server does not receive personal data about Customer's end users; IP addresses are used transiently for rate limiting only. See the Privacy Policy. Customer must allow the Software to reach `https://license.flexgraph.example` (Content Security Policy `connect-src`). Offline licenses are available as an add-on for networks without internet access.

## 6. Fees, payment failure and locked mode

1. Fees are billed in advance per Project for each billing period through Licensor's payment provider.
2. If a payment fails, the Software keeps working for a **14-day grace period** and Licensor sends reminders.
3. After the grace period, or when a Subscription ends, the Software enters **locked mode**: graphs render with a visible "License inactive" overlay to end users and interaction is disabled, and access to the private package registry is revoked. Customer accepts this behaviour.
4. Locked mode ends automatically within at most 7 days after payment (usually immediately).

## 7. Term and termination

The Subscription renews automatically until canceled. Customer may cancel at any time in the customer portal; the license continues until the end of the paid period. Licensor may terminate for material breach on written notice. On termination, Customer must stop using the Software in production.

## 8. Audit

On reasonable written notice, and not more than once per year, Licensor may verify Customer's compliance with this Agreement, including the domains on which the Software is used. Licensor's server-side validation logs may be used for this purpose.

## 9. Support and updates

During the Subscription, Customer may install updates from the private registry. Support is provided by email on a reasonable-efforts basis unless otherwise agreed.

## 10. Warranty and liability

1. The Software is provided "as is". Licensor does not warrant that it is error-free or fit for a particular purpose, except as required by mandatory law.
2. Licensor's total liability is limited to the fees paid by Customer in the 12 months before the claim. Licensor is not liable for indirect or consequential loss, lost profits or lost data. These limits do not apply to gross negligence, wilful misconduct, or where mandatory law provides otherwise (including consumer law).

## 11. Trial

The trial build is free for evaluation on `localhost` only. It always shows a watermark and may not be used in production.

## 12. Governing law

This Agreement is governed by Norwegian law. Disputes are subject to the jurisdiction of Oslo tingrett, unless mandatory consumer law provides otherwise.

## 13. Contact

FlexGraph Labs AS · licenses@flexgraph.example
