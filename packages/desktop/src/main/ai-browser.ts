/**
 * AI Browser Controller - Embedded Chromium browser for agent-controlled web automation
 *
 * Provides a BrowserWindow-based browser that the agent can use for:
 * - Web browsing and scraping
 * - Screenshot capture for AI vision
 * - Basic form interaction
 */

import { BrowserWindow, BrowserView, ipcMain } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

export interface BrowserState {
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export class AIBrowser {
  private window: BrowserWindow | null = null;
  private screenshotDir: string;

  constructor() {
    this.screenshotDir = path.join(os.homedir(), '.jarvis', 'data', 'screenshots');
    fs.mkdirSync(this.screenshotDir, { recursive: true });
  }

  /**
   * Open the browser window. Creates a new window if none exists.
   */
  open(url?: string): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      this.window.show();
      if (url) this.navigate(url);
      return this.window;
    }

    this.window = new BrowserWindow({
      width: 1280,
      height: 900,
      title: 'Jarvis AI Browser',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // Disable automation detection
        webgl: true,
      },
    });

    // Disable automation detection headers
    this.window.webContents.session.webRequest.onBeforeSendHeaders(
      (details, callback) => {
        const headers = { ...details.requestHeaders };
        delete headers['Sec-CH-UA-Platform'];
        callback({ requestHeaders: headers });
      }
    );

    if (url) {
      this.window.loadURL(url);
    } else {
      this.window.loadURL('about:blank');
    }

    this.window.on('closed', () => {
      this.window = null;
    });

    return this.window;
  }

  /**
   * Navigate to a URL.
   */
  async navigate(url: string): Promise<void> {
    if (!this.window || this.window.isDestroyed()) {
      this.open(url);
      return;
    }
    await this.window.loadURL(url);
  }

  /**
   * Get the current browser state.
   */
  getState(): BrowserState | null {
    if (!this.window || this.window.isDestroyed()) return null;

    const wc = this.window.webContents;
    return {
      url: wc.getURL(),
      title: wc.getTitle(),
      isLoading: wc.isLoading(),
      canGoBack: wc.canGoBack(),
      canGoForward: wc.canGoForward(),
    };
  }

  /**
   * Take a screenshot of the current page.
   * Returns the path to the saved screenshot.
   */
  async screenshot(): Promise<string | null> {
    if (!this.window || this.window.isDestroyed()) return null;

    const image = await this.window.webContents.capturePage();
    const pngBuffer = image.toPNG();
    const filename = `screenshot-${Date.now()}.png`;
    const filePath = path.join(this.screenshotDir, filename);
    fs.writeFileSync(filePath, pngBuffer);
    return filePath;
  }

  /**
   * Execute JavaScript in the browser page context.
   */
  async executeJS(code: string): Promise<unknown> {
    if (!this.window || this.window.isDestroyed()) return null;
    return this.window.webContents.executeJavaScript(code);
  }

  /**
   * Get page content as text.
   */
  async getPageText(): Promise<string | null> {
    if (!this.window || this.window.isDestroyed()) return null;
    return this.window.webContents.executeJavaScript(
      'document.body.innerText'
    );
  }

  /**
   * Get page HTML.
   */
  async getPageHTML(): Promise<string | null> {
    if (!this.window || this.window.isDestroyed()) return null;
    return this.window.webContents.executeJavaScript(
      'document.documentElement.outerHTML'
    );
  }

  /**
   * Go back in browser history.
   */
  goBack(): void {
    if (this.window && !this.window.isDestroyed() && this.window.webContents.canGoBack()) {
      this.window.webContents.goBack();
    }
  }

  /**
   * Go forward in browser history.
   */
  goForward(): void {
    if (this.window && !this.window.isDestroyed() && this.window.webContents.canGoForward()) {
      this.window.webContents.goForward();
    }
  }

  /**
   * Close the browser window.
   */
  close(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy();
      this.window = null;
    }
  }

  /**
   * Register IPC handlers for browser control from the renderer.
   */
  registerIPC(): void {
    ipcMain.handle('browser:open', async (_event, url?: string) => {
      this.open(url);
      return this.getState();
    });

    ipcMain.handle('browser:navigate', async (_event, url: string) => {
      await this.navigate(url);
      return this.getState();
    });

    ipcMain.handle('browser:state', async () => {
      return this.getState();
    });

    ipcMain.handle('browser:screenshot', async () => {
      return this.screenshot();
    });

    ipcMain.handle('browser:executeJS', async (_event, code: string) => {
      return this.executeJS(code);
    });

    ipcMain.handle('browser:getPageText', async () => {
      return this.getPageText();
    });

    ipcMain.handle('browser:goBack', async () => {
      this.goBack();
      return this.getState();
    });

    ipcMain.handle('browser:goForward', async () => {
      this.goForward();
      return this.getState();
    });

    ipcMain.handle('browser:close', async () => {
      this.close();
    });
  }
}
