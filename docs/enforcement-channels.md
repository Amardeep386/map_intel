# Enforcement channels: Amazon Brand Registry and eBay VeRO

*Phase 0 spike · 23 Sep 2026. These are working notes, not legal advice. Every point below should go through the legal review (Decision 5).*

## The short answer

- **Neither channel enforces MAP.** Amazon Brand Registry and eBay VeRO both exist to protect **intellectual property**: trademarks, copyright, patents and counterfeits. A listing priced below MAP is not an IP violation. Reporting one through these tools is misuse, and it can cost the brand its reporting access.
- **MAP is enforced through the brand's own relationship with its resellers.** That means a notice to the seller, the reseller agreement or authorised-seller programme, and supply decisions. Marketplaces stay out of it.
- **These channels matter only for a subset of cases.** They apply when the seller is also **infringing**: fake or counterfeit units, misuse of the brand's photos or copy, or, after legal review, goods that are "materially different" (for example no manufacturer warranty or wrong-region units).
- **For MAP Intel, this sets the Phase 4 design.** Enforcement cases need two separate tracks: a **pricing track** (notices, the case lifecycle and re-checks) and an **IP track** (marketplace reports with the evidence bundle). A pricing case must never be filed as an IP report.

## Amazon Brand Registry

| Topic | Notes |
|---|---|
| Who can join | A brand owner with a registered trademark, or a pending one filed through Amazon's IP Accelerator law-firm network. The pilot brands are all registered. MAP Intel would act as the brand's agent, with a user added to the brand's Brand Registry account. |
| Report a Violation (RAV) | Lets the brand search by ASIN, keyword or image and report listings for **trademark, copyright, design/utility patent or counterfeit** issues. Strong reports name the exact listing, the exact right infringed, and the proof (screenshots with time stamps, test buys, packaging photos, invoices). |
| Other tools | **Transparency** puts serialised codes on units and blocks counterfeits at fulfilment. **Project Zero** lets the brand remove counterfeit listings itself, but only with strict internal rules and very high accuracy. **APEX** is Amazon's low-cost utility-patent evaluation. None of these handle pricing. |
| Pricing | Amazon does not police MAP between a brand and third-party sellers. As a first-party retailer, Amazon sets its own prices; MAP pressure there goes through the brand's vendor relationship. |
| Finding sellers to notify | Under the US INFORM Consumers Act (in force since June 2023), marketplaces must show the business name and address of high-volume third-party sellers. That is the lawful route for delivering a MAP notice. It fits the Phase 2a `seller_contact` and Phase 4 notice work. |
| Automation | We found no public API for filing RAV reports: the Selling Partner API has no infringement-reporting endpoint. Plan for analysts to file reports by hand in the Brand Registry console, with MAP Intel producing the evidence pack. Re-check this before Phase 4. |
| Risk | Filing IP complaints to push out low-priced but genuine sellers can bring counter-notices, loss of Brand Registry privileges, and legal exposure (tortious interference, false-claim disputes). |

## eBay VeRO (Verified Rights Owner programme)

| Topic | Notes |
|---|---|
| What it covers | Reports from IP owners about listings that infringe copyright, trademark, design rights or patents, including counterfeits and unauthorised copies. Parallel imports are covered in some regions only. Misrepresented warranties are also covered. |
| What it does not cover | Pricing and MAP, and lawful resale of genuine goods (the "first sale" principle in the US). |
| How it works | The rights owner (or its authorised agent) joins VeRO, then reports listings through eBay's VeRO reporting tool (the Notice of Claimed Infringement). eBay may remove the listing, warn the seller, restrict the account or suspend it. Sellers can respond or counter-notice. |
| Automation | Reporting runs through eBay's VeRO tools. We did not find a general public API for filing VeRO reports; confirm with eBay if volume grows. |
| Relevance to the pilot | eBay is not one of the Phase 0 launch sources (Amazon, Best Buy, Walmart). Keep VeRO as a Phase 4 option for counterfeit and grey-market cases. |

## Related marketplace channel (for completeness)

- **Walmart Marketplace** has a Brand Portal for IP reports on Walmart.com listings. It follows the same rule: IP only, not pricing.

## What this means for the build

1. **Phase 2a:** store seller business name and address (from INFORM disclosures) in `seller_contact`, with source and capture date.
2. **Phase 3:** every violation's evidence bundle already has what an IP report needs: time-stamped screenshot, HTML and SHA-256, captured at collection.
3. **Phase 4:** add a `marketplace_report` record with channel (`amazon_rav`, `ebay_vero`, `walmart_brand_portal`), the IP basis chosen by a person, the reference number returned, and the outcome. Only allow it on cases an analyst has marked as an IP issue, and require a reason.
4. **Legal review (Decision 5):** confirm the wording of MAP notices, when the material-differences doctrine can be used, and whether MAP Intel may file reports as the brand's agent.

## Sources

- eBay, Intellectual property policy / VeRO: https://www.ebay.com/help/policies/listing-policies/selling-policies/intellectual-property-vero-program?id=4349
- eBay VeRO programme page: https://pages.ebay.com/vero
- AMZ Sellers Attorney, 2026 Brand Registry Playbook: https://www.amazonsellers.attorney/2026-brand-registry-playbook.html
- SentryKit, "Does Amazon enforce MAP pricing?": https://sentrykit.com/blog/does-amazon-enforce-map-pricing/
- Jungle Scout, MAP pricing enforcement on Amazon: https://www.junglescout.com/resources/articles/map-pricing-enforcement/
