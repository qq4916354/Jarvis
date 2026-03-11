// ============================================================================
// ResearchAgent - Intelligent web research built on BrowserService
// ============================================================================

import { EventEmitter } from 'eventemitter3';
import { BrowserService } from './browser-service.js';

// ─── Types ───────────────────────────────────────────────────────

export interface ResearchConfig {
  /** Maximum number of pages to visit. Default: 10 */
  maxPages?: number;
  /** Maximum link-follow depth. Default: 2 */
  maxDepth?: number;
  /** Per-page timeout in ms. Default: 30000 */
  timeout?: number;
  /** Search engine to use. Default: 'google' */
  searchEngine?: string;
}

export interface ResearchFinding {
  url: string;
  title: string;
  /** Extracted main content (nav/ads/sidebar stripped) */
  content: string;
  /** Relevance score 0-1 */
  relevanceScore: number;
  extractedAt: number;
  metadata?: Record<string, unknown>;
}

export interface ResearchReport {
  topic: string;
  summary: string;
  findings: ResearchFinding[];
  keyInsights: string[];
  sources: { url: string; title: string }[];
  generatedAt: number;
}

export interface ResearchEvents {
  'page:visiting': (data: { url: string; pageNum: number; total: number }) => void;
  'page:extracted': (finding: ResearchFinding) => void;
  'progress': (data: { phase: string; progress: number }) => void;
  'complete': (report: ResearchReport) => void;
  'error': (data: { error: string; url?: string }) => void;
}

/** Callback used to summarize findings into a report via an AI model. */
export type SummarizerFn = (prompt: string) => Promise<string>;

/** Maximum content length per page to avoid token explosion. */
const MAX_CONTENT_LENGTH = 8_000;

/** Default configuration values. */
const DEFAULTS: Required<ResearchConfig> = {
  maxPages: 10,
  maxDepth: 2,
  timeout: 30_000,
  searchEngine: 'google',
};

// ─── ResearchAgent ───────────────────────────────────────────────

/**
 * ResearchAgent performs automated web research on a given topic.
 *
 * It uses BrowserService for page navigation and content extraction,
 * and an injected summarizer callback for AI-powered report generation.
 * Progress is communicated via EventEmitter events.
 */
export class ResearchAgent extends EventEmitter<ResearchEvents> {
  private readonly config: Required<ResearchConfig>;

  constructor(
    private browser: BrowserService,
    config: ResearchConfig = {},
    private summarizer?: SummarizerFn,
  ) {
    super();
    this.config = { ...DEFAULTS, ...config };
  }

  // ─── Public API ──────────────────────────────────────────────

  /**
   * Main entry: research a topic and return a structured report.
   */
  async research(topic: string): Promise<ResearchReport> {
    this.emit('progress', { phase: 'searching', progress: 0 });

    // Phase 1 - Search for relevant URLs
    let urls: string[];
    try {
      urls = await this.search(topic, this.config.maxPages);
    } catch (err: any) {
      this.emit('error', { error: `Search failed: ${err.message}` });
      urls = [];
    }

    if (urls.length === 0) {
      const emptyReport = this.buildEmptyReport(topic);
      this.emit('complete', emptyReport);
      return emptyReport;
    }

    this.emit('progress', { phase: 'extracting', progress: 0.2 });

    // Phase 2 - Extract content from each URL
    const findings: ResearchFinding[] = [];
    const pagesToVisit = urls.slice(0, this.config.maxPages);

    for (let i = 0; i < pagesToVisit.length; i++) {
      const url = pagesToVisit[i];
      this.emit('page:visiting', { url, pageNum: i + 1, total: pagesToVisit.length });

      try {
        const finding = await this.extractContent(url);
        if (finding.content.length > 0) {
          finding.relevanceScore = this.computeRelevance(finding.content, topic);
          findings.push(finding);
          this.emit('page:extracted', finding);
        }
      } catch (err: any) {
        this.emit('error', { error: `Extract failed: ${err.message}`, url });
      }

      const progress = 0.2 + (0.6 * (i + 1)) / pagesToVisit.length;
      this.emit('progress', { phase: 'extracting', progress });
    }

    this.emit('progress', { phase: 'generating', progress: 0.8 });

    // Phase 3 - Generate report
    const report = await this.generateReport(topic, findings);

    this.emit('progress', { phase: 'complete', progress: 1 });
    this.emit('complete', report);

    return report;
  }

  /**
   * Extract the main content from a web page, filtering out navigation,
   * ads, sidebars, and other irrelevant elements.
   */
  async extractContent(url: string): Promise<ResearchFinding> {
    await this.browser.navigate(url, { timeout: this.config.timeout });

    const result = await this.browser.evaluate<{ title: string; text: string }>(`(() => {
      var removeSelectors = [
        'nav', 'header', 'footer', 'aside',
        '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
        '.nav', '.navbar', '.sidebar', '.menu', '.footer', '.header',
        '.advertisement', '.ad', '.ads', '.adsbygoogle',
        '.cookie-banner', '.cookie-notice', '.popup',
        '.social-share', '.share-buttons', '.comments',
        'script', 'style', 'noscript', 'iframe'
      ];
      for (var i = 0; i < removeSelectors.length; i++) {
        document.querySelectorAll(removeSelectors[i]).forEach(function(el) { el.remove(); });
      }
      var contentSelectors = [
        'main', 'article', '[role="main"]',
        '.content', '.post-content', '.article-content',
        '.entry-content', '.page-content', '#content', '#main'
      ];
      var contentEl = null;
      for (var j = 0; j < contentSelectors.length; j++) {
        contentEl = document.querySelector(contentSelectors[j]);
        if (contentEl) break;
      }
      if (!contentEl) contentEl = document.body;
      var title = document.title || '';
      var text = (contentEl && contentEl.textContent ? contentEl.textContent : '')
        .replace(/\\s+/g, ' ').trim();
      return { title: title, text: text };
    })()`);

    const content = result.text.slice(0, MAX_CONTENT_LENGTH);

    return {
      url,
      title: result.title,
      content,
      relevanceScore: 0,
      extractedAt: Date.now(),
    };
  }

  /**
   * Query a search engine and return result URLs.
   */
  async search(query: string, maxResults: number = 10): Promise<string[]> {
    const encodedQuery = encodeURIComponent(query);
    const searchUrl = this.buildSearchUrl(encodedQuery);

    await this.browser.navigate(searchUrl, { timeout: this.config.timeout });

    const snapshot = await this.browser.snapshot();
    const urls = this.extractSearchUrls(snapshot.text, searchUrl);

    // Deduplicate and limit
    const unique = [...new Set(urls)];
    return unique.slice(0, maxResults);
  }

  /**
   * Generate a structured research report from findings.
   * Uses the injected summarizer callback if available; otherwise
   * falls back to a simple extractive summary.
   */
  async generateReport(
    topic: string,
    findings: ResearchFinding[],
  ): Promise<ResearchReport> {
    // Sort by relevance
    const sorted = [...findings].sort((a, b) => b.relevanceScore - a.relevanceScore);

    const sources = sorted.map((f) => ({ url: f.url, title: f.title }));

    if (this.summarizer) {
      return this.generateAIReport(topic, sorted, sources);
    }

    return this.generateExtractiveReport(topic, sorted, sources);
  }

  /**
   * Extract structured data (tables, lists) from a page.
   */
  async extractStructuredData(url: string): Promise<Record<string, unknown>> {
    await this.browser.navigate(url, { timeout: this.config.timeout });

    const data = await this.browser.evaluate<Record<string, unknown>>(`(() => {
      var result = {};
      // Extract tables
      var tables = [];
      document.querySelectorAll('table').forEach(function(table) {
        var headers = [];
        table.querySelectorAll('thead th, thead td, tr:first-child th').forEach(function(th) {
          headers.push((th.textContent || '').trim());
        });
        var rows = [];
        var bodyRows = table.querySelectorAll('tbody tr, tr');
        bodyRows.forEach(function(tr, idx) {
          if (idx === 0 && headers.length > 0) return;
          var cells = [];
          tr.querySelectorAll('td, th').forEach(function(td) {
            cells.push((td.textContent || '').trim());
          });
          if (cells.length > 0) {
            var row = {};
            cells.forEach(function(cell, i) {
              var key = headers[i] || ('col_' + i);
              row[key] = cell;
            });
            rows.push(row);
          }
        });
        if (rows.length > 0) tables.push(rows);
      });
      if (tables.length > 0) result.tables = tables;
      // Extract lists
      var lists = [];
      document.querySelectorAll('ul, ol').forEach(function(list) {
        var items = [];
        list.querySelectorAll(':scope > li').forEach(function(li) {
          var text = (li.textContent || '').trim();
          if (text) items.push(text.slice(0, 500));
        });
        if (items.length > 0) lists.push(items);
      });
      if (lists.length > 0) result.lists = lists;
      // Extract headings
      var headings = [];
      document.querySelectorAll('h1, h2, h3').forEach(function(h) {
        var text = (h.textContent || '').trim();
        if (text) headings.push(text);
      });
      if (headings.length > 0) result.headings = headings;
      return result;
    })()`);

    return data;
  }

  // ─── Private Helpers ─────────────────────────────────────────

  /**
   * Build the search engine URL for the given encoded query.
   */
  private buildSearchUrl(encodedQuery: string): string {
    switch (this.config.searchEngine) {
      case 'bing':
        return `https://www.bing.com/search?q=${encodedQuery}`;
      case 'duckduckgo':
        return `https://duckduckgo.com/?q=${encodedQuery}`;
      case 'google':
      default:
        return `https://www.google.com/search?q=${encodedQuery}`;
    }
  }

  /**
   * Extract result URLs from search engine page text.
   * Uses regex to find http(s) URLs that are not from the search engine itself.
   */
  private extractSearchUrls(text: string, searchUrl: string): string[] {
    const searchDomain = new URL(searchUrl).hostname;
    const urlPattern = /https?:\/\/[^\s"'<>)\]]+/g;
    const matches = text.match(urlPattern) || [];

    return matches.filter((url) => {
      try {
        const parsed = new URL(url);
        // Filter out search engine URLs, common non-content URLs
        const skipDomains = [
          searchDomain,
          'accounts.google.com',
          'support.google.com',
          'maps.google.com',
          'policies.google.com',
          'play.google.com',
        ];
        if (skipDomains.some((d) => parsed.hostname.includes(d))) return false;
        // Skip image/video/map results
        if (/\.(jpg|jpeg|png|gif|svg|mp4|webm)$/i.test(parsed.pathname)) return false;
        return true;
      } catch {
        return false;
      }
    });
  }

  /**
   * Compute a simple keyword-overlap relevance score (0-1).
   */
  private computeRelevance(content: string, topic: string): number {
    const keywords = topic
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    if (keywords.length === 0) return 0.5;

    const lowerContent = content.toLowerCase();
    let matches = 0;
    for (const kw of keywords) {
      if (lowerContent.includes(kw)) matches++;
    }

    return matches / keywords.length;
  }

  /**
   * Generate an AI-powered report using the injected summarizer.
   */
  private async generateAIReport(
    topic: string,
    findings: ResearchFinding[],
    sources: { url: string; title: string }[],
  ): Promise<ResearchReport> {
    const contentBlock = findings
      .map((f, i) => `[Source ${i + 1}: ${f.title}]\n${f.content.slice(0, 2000)}`)
      .join('\n\n---\n\n');

    const prompt = [
      `You are a research analyst. Based on the following web sources about "${topic}", `,
      `produce a JSON object with exactly these fields:`,
      `- "summary": a comprehensive 2-4 paragraph summary`,
      `- "keyInsights": an array of 3-7 key insight strings`,
      ``,
      `Sources:`,
      contentBlock,
      ``,
      `Respond ONLY with valid JSON, no markdown fences.`,
    ].join('\n');

    try {
      const raw = await this.summarizer!(prompt);
      const parsed = JSON.parse(raw);
      return {
        topic,
        summary: parsed.summary || '',
        findings,
        keyInsights: Array.isArray(parsed.keyInsights) ? parsed.keyInsights : [],
        sources,
        generatedAt: Date.now(),
      };
    } catch {
      // Fall back to extractive if AI fails
      return this.generateExtractiveReport(topic, findings, sources);
    }
  }

  /**
   * Generate a simple extractive report without AI.
   */
  private generateExtractiveReport(
    topic: string,
    findings: ResearchFinding[],
    sources: { url: string; title: string }[],
  ): ResearchReport {
    const topFindings = findings.slice(0, 5);

    const summary = topFindings
      .map((f) => {
        const snippet = f.content.slice(0, 300).trim();
        return `${f.title}: ${snippet}`;
      })
      .join('\n\n');

    const keyInsights = topFindings
      .filter((f) => f.content.length > 50)
      .map((f) => {
        // Extract first meaningful sentence
        const sentences = f.content.split(/[.!?]+/).filter((s) => s.trim().length > 20);
        return sentences[0]?.trim() || f.title;
      });

    return {
      topic,
      summary: summary || `No relevant content found for "${topic}".`,
      findings,
      keyInsights,
      sources,
      generatedAt: Date.now(),
    };
  }

  /**
   * Build an empty report for when no results are found.
   */
  private buildEmptyReport(topic: string): ResearchReport {
    return {
      topic,
      summary: `No results found for "${topic}".`,
      findings: [],
      keyInsights: [],
      sources: [],
      generatedAt: Date.now(),
    };
  }
}
