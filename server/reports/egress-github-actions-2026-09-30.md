# Egress probe — GitHub Actions (ubuntu-latest), 30 Sep 2026 11:00 UTC

Run from branch `amazon-lg-slice`: `npm run egress:probe -- --per 3 --sources amazon_us,walmart_us --browser`.
Egress label `github-actions`, IP `134.33.77.23`. Copied from the job log (the run was cancelled
afterwards by a hang on exit, fixed in `closePoliteness`; the results were complete).

| Source | Method | URL | Status | Result | Time |
|---|---|---|---|---|---|
| Amazon | http | /dp/B0GS4231WF | 200 | captcha | 109 ms |
| Amazon | http | /dp/B0DGJ7HYG1 | 200 | captcha | 98 ms |
| Amazon | http | /dp/B0GQVPX1PJ | 200 | captcha | 93 ms |
| Amazon | browser | /dp/B0GS4231WF | 200 | captcha | 6877 ms |
| Amazon | browser | /dp/B0DGJ7HYG1 | 200 | captcha | 3165 ms |
| Amazon | browser | /dp/B0GQVPX1PJ | 200 | captcha | 2732 ms |
| Amazon | browser | /s?k=LG+gram+laptop | 503 | access_denied ("sorry" page) | 4312 ms |
| Walmart | http | /ip/5318023297 | 200 | $1,777.86 | 1746 ms |
| Walmart | http | /ip/20008614465 | 200 | $1,797.99 | 1722 ms |
| Walmart | http | /ip/17620862962 | 200 | $399.00 | 1515 ms |

**Amazon: 0 of 7 real pages** (HTTP and browser, product and search). Walmart: 3 of 3 priced.
