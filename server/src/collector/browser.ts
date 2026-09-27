import { chromium, type Browser, type BrowserContext } from 'playwright';
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
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled'],
      proxy: proxyFromUrl(config.COLLECT_HTTPS_PROXY),
    });
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

/** Load the live page in headless Chromium; returns its HTML and a screenshot of what loaded. */
export async function browserFetch(url: string, adapter: SourceAdapter): Promise<FetchResult> {
  // Wait for the host's turn first, so a page slot is never held through a politeness delay.
  await politeWait(adapter.host);
  return withPageSlot(() => browserFetchNow(url, adapter));
}

async function browserFetchNow(url: string, adapter: SourceAdapter): Promise<FetchResult> {
  const ctx = await newContext(adapter, true);
  try {
    const page = await ctx.newPage();
    const fetchedAt = new Date();
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
    const html = await page.content();
    const height = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 900);
    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: true,
      clip: { x: 0, y: 0, width: 1366, height: Math.min(Math.max(height, 900), MAX_SHOT_HEIGHT) },
    });
    return { method: 'browser', status: response?.status() ?? 0, finalUrl: page.url(), html, screenshot, fetchedAt };
  } finally {
    await ctx.close();
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

export async function closeBrowser(): Promise<void> {
  if (browser) await browser.close().catch(() => undefined);
  browser = null;
}
