import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { config } from '../lib/config.js';
import { politeWait } from './http.js';
import type { FetchResult, SourceAdapter } from './types.js';

let browser: Browser | null = null;

// A small semaphore: at most COLLECT_BROWSER_PAGES pages open at once in this process, whichever
// source queue asks (six source workers share one 512 MB instance).
let open = 0;
const waiting: (() => void)[] = [];
export async function withPageSlot<T>(fn: () => Promise<T>, max = config.COLLECT_BROWSER_PAGES): Promise<T> {
  if (open >= max) await new Promise<void>((resolve) => waiting.push(resolve));
  open += 1;
  try {
    return await fn();
  } finally {
    open -= 1;
    waiting.shift()?.();
  }
}

/** Playwright wants the proxy credentials apart from the server address. */
export function proxyFromUrl(raw: string | undefined): { server: string; username?: string; password?: string } | undefined {
  if (!raw) return undefined;
  const u = new URL(raw);
  const server = `${u.protocol}//${u.host}`;
  return u.username ? { server, username: decodeURIComponent(u.username), password: decodeURIComponent(u.password) } : { server };
}

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    // Plain headless Chromium: nothing hides that it is automated (decisions 27 and 34).
    browser = await chromium.launch({ headless: true, proxy: proxyFromUrl(config.COLLECT_HTTPS_PROXY) });
  }
  return browser;
}

async function newContext(adapter: SourceAdapter, javaScriptEnabled: boolean): Promise<BrowserContext> {
  const b = await getBrowser();
  const ctx = await b.newContext({
    userAgent: config.COLLECT_USER_AGENT,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    viewport: { width: 1366, height: 900 },
    javaScriptEnabled,
    // Re-rendering stored HTML (JS off) happens on about:blank, where the page's own CSP meta tag
    // (written for the retailer's origin) would block its CSS and images. Live fetches keep CSP.
    bypassCSP: !javaScriptEnabled,
  });
  if (adapter.cookies?.length) {
    await ctx.addCookies(adapter.cookies.map((c) => ({ ...c, path: '/' })));
  }
  return ctx;
}

const MAX_SHOT_HEIGHT = 4000;

// One context per source for the life of the process: its cookies carry from page to page, as in a
// person's browser. Each page is its own tab, opened and closed; one at a time (withPageSlot).
const liveContexts = new Map<string, Promise<BrowserContext>>();
async function liveContext(adapter: SourceAdapter): Promise<BrowserContext> {
  let ctx = liveContexts.get(adapter.code);
  if (!ctx || !(await ctx.then((c) => c.browser()?.isConnected() ?? false).catch(() => false))) {
    ctx = newContext(adapter, true);
    liveContexts.set(adapter.code, ctx);
  }
  return ctx;
}

const pause = (min: number, max: number) => new Promise((r) => setTimeout(r, min + Math.floor(Math.random() * (max - min))));

/**
 * Scroll positions for looking at the page: down to `target` in 2 or 3 steps, then back to the top.
 * Pure, so it is tested.
 */
export function scrollPlan(target: number, steps: number): number[] {
  const n = Math.max(1, steps);
  const down = Array.from({ length: n }, (_, i) => Math.round((target * (i + 1)) / n));
  return [...down, 0];
}

/** Load the live page in headless Chromium; returns its HTML and a screenshot of what loaded. */
export async function browserFetch(url: string, adapter: SourceAdapter): Promise<FetchResult> {
  // Wait for the host's turn first, so a page slot is never held through a politeness delay.
  await politeWait(adapter);
  return withPageSlot(() => browserFetchNow(url, adapter));
}

async function browserFetchNow(url: string, adapter: SourceAdapter): Promise<FetchResult> {
  const ctx = await liveContext(adapter);
  const page = await ctx.newPage();
  try {
    const fetchedAt = new Date();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    if (adapter.scrollTo?.length) await lookAtOffer(page, adapter.scrollTo);
    const html = await page.content();
    const height = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 900);
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: true,
      clip: { x: 0, y: 0, width: 1366, height: Math.min(Math.max(height, 900), MAX_SHOT_HEIGHT) },
    });
    return { method: 'browser', status: response?.status() ?? 0, finalUrl: page.url(), html, screenshot, fetchedAt };
  } finally {
    await page.close().catch(() => undefined);
  }
}

/** Scroll down to the offer (the first selector present, else half the page) and back to the top. */
async function lookAtOffer(page: Page, selectors: string[]): Promise<void> {
  const target = await page
    .evaluate((sels) => {
      for (const s of sels) {
        const el = document.querySelector(s);
        if (el) return Math.max(0, el.getBoundingClientRect().top + window.scrollY - 200);
      }
      return Math.round(document.documentElement.scrollHeight / 2);
    }, selectors)
    .catch(() => 0);
  for (const y of scrollPlan(target, 2 + Math.floor(Math.random() * 2))) {
    await page.evaluate((top) => window.scrollTo({ top, behavior: 'smooth' }), y).catch(() => undefined);
    await pause(400, 900);
  }
}

/**
 * Screenshot of HTML we already fetched over plain HTTP. JavaScript is off, so the picture shows
 * exactly the captured (and hashed) HTML; images and CSS still load from the retailer's CDN.
 */
export async function renderScreenshot(html: string, baseUrl: string, adapter: SourceAdapter): Promise<Buffer> {
  return withPageSlot(() => renderScreenshotNow(html, baseUrl, adapter));
}

async function renderScreenshotNow(html: string, baseUrl: string, adapter: SourceAdapter): Promise<Buffer> {
  const ctx = await newContext(adapter, false);
  try {
    const page = await ctx.newPage();
    const withBase = /<head[^>]*>/i.test(html)
      ? html.replace(/<head([^>]*)>/i, `<head$1><base href="${baseUrl}">`)
      : `<base href="${baseUrl}">${html}`;
    await page.setContent(withBase, { waitUntil: 'load', timeout: 30_000 }).catch(() => undefined);
    const height = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 900);
    return await page.screenshot({
      type: 'png',
      fullPage: true,
      clip: { x: 0, y: 0, width: 1366, height: Math.min(Math.max(height, 900), MAX_SHOT_HEIGHT) },
    });
  } finally {
    await ctx.close();
  }
}

/** PNG of an evidence card (apiCard.ts): our own HTML, JavaScript off; the product image loads from its CDN. */
export async function renderCard(html: string): Promise<Buffer> {
  return withPageSlot(async () => {
    const b = await getBrowser();
    const ctx = await b.newContext({ viewport: { width: 1040, height: 800 }, javaScriptEnabled: false, locale: 'en-US' });
    try {
      const page = await ctx.newPage();
      await page.setContent(html, { waitUntil: 'load', timeout: 20_000 }).catch(() => undefined);
      return await page.locator('#card').screenshot({ type: 'png' });
    } finally {
      await ctx.close();
    }
  });
}

/** Print a self-contained HTML document (a report) to PDF. Scripts off; page size comes from its @page CSS. */
export async function renderPdf(html: string): Promise<Buffer> {
  return withPageSlot(async () => {
    const b = await getBrowser();
    const ctx = await b.newContext({ javaScriptEnabled: false, locale: 'en-US' });
    try {
      const page = await ctx.newPage();
      await page.setContent(html, { waitUntil: 'load', timeout: 30_000 });
      return await page.pdf({ preferCSSPageSize: true, printBackground: true });
    } finally {
      await ctx.close();
    }
  });
}

export async function closeBrowser(): Promise<void> {
  for (const ctx of liveContexts.values()) await ctx.then((c) => c.close()).catch(() => undefined);
  liveContexts.clear();
  if (browser) await browser.close().catch(() => undefined);
  browser = null;
}
