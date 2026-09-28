# Extractor fixtures

Real pages, gzipped, used by `test/adapters.test.ts`. Refresh a fixture when a retailer changes its
layout (Data Health shows `layout_changed`), and keep the old one if the old layout can still appear.

| File | Captured | Egress | Notes |
|---|---|---|---|
| `walmart/brand-samsung.html.gz` | 27 Sep 2026 | India (HTTP) | `/brand/samsung/10030086`, 15 products |
| `walmart/product-lg-p01.html.gz` | 27 Sep 2026 | India (HTTP) | `/ip/seller-offers/18196407846`, 6 other sellers not in SSR JSON; CSP names captcha.net |
| `target/challenge-press-hold.html.gz` | 27 Sep 2026 | India (headless) | HUMAN "Press & hold" overlay on the LG brand page |
