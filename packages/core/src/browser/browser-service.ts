// ============================================================================
// BrowserService - Playwright-based browser automation
// ============================================================================

import { EventEmitter } from 'eventemitter3';

/**
 * Snapshot of a page's accessible content.
 */
export interface PageSnapshot {
  title: string;
  url: string;
  /** Accessible text representation of the page */
  text: string;
}

interface BrowserEvents {
  'navigated': (data: { url: string; title: string }) => void;
  'error': (error: Error) => void;
}

/**
 * BrowserService wraps Playwright to provide headless browser automation.
 *
 * This is a thin abstraction over Playwright's browser/page APIs, exposing
 * only the operations needed by higher-level agents (navigate, snapshot,
 * evaluate, click, fill, etc.).
 */
export class BrowserService extends EventEmitter<BrowserEvents> {
  private browser: any = null;
  private page: any = null;
  private launched = false;

  /**
   * Launch a headless Chromium browser.
   */
  async launch(): Promise<void> {
    if (this.launched) return;
    try {
      const { chromium } = await import('playwright');
      this.browser = await chromium.launch({ headless: true });
      const context = await this.browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });
      this.page = await context.newPage();
      this.launched = true;
    } catch (err: any) {
      throw new Error(`Failed to launch browser: ${err.message}`);
    }
  }

  /**
   * Navigate to the given URL.
   */
  async navigate(url: string, options?: { timeout?: number }): Promise<void> {
    await this.ensurePage();
    const timeout = options?.timeout ?? 30_000;
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout });
    const title = await this.page.title();
    this.emit('navigated', { url, title });
  }

  /**
   * Take a text snapshot of the current page (accessible tree).
   */
  async snapshot(): Promise<PageSnapshot> {
    await this.ensurePage();
    const title: string = await this.page.title();
    const url: string = this.page.url();
    const text: string = await this.page.evaluate(
      'document.body?.innerText ?? ""',
    );
    return { title, url, text };
  }

  /**
   * Execute a function in the page context and return its result.
   */
  async evaluate<T>(fn: string | ((...args: any[]) => T), ...args: any[]): Promise<T> {
    await this.ensurePage();
    return this.page.evaluate(fn, ...args);
  }

  /**
   * Click an element matching the given selector.
   */
  async click(selector: string): Promise<void> {
    await this.ensurePage();
    await this.page.click(selector);
  }

  /**
   * Fill a form input matching the given selector.
   */
  async fill(selector: string, value: string): Promise<void> {
    await this.ensurePage();
    await this.page.fill(selector, value);
  }

  /**
   * Wait for a selector to appear.
   */
  async waitForSelector(selector: string, options?: { timeout?: number }): Promise<void> {
    await this.ensurePage();
    await this.page.waitForSelector(selector, options);
  }

  /**
   * Get the current page URL.
   */
  getUrl(): string {
    return this.page?.url() ?? '';
  }

  /**
   * Close the browser and clean up resources.
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      this.launched = false;
    }
  }

  private async ensurePage(): Promise<void> {
    if (!this.launched || !this.page) {
      await this.launch();
    }
  }
}
