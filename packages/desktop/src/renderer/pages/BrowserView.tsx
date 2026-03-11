import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowLeft, ArrowRight, RotateCw, Home, Globe, ExternalLink,
  Camera, Play, Square, Eye, RefreshCw, Loader,
} from 'lucide-react';
import { api } from '../api';

const BOOKMARKS = [
  { name: 'Google', url: 'https://www.google.com', icon: '🔍' },
  { name: 'GitHub', url: 'https://github.com', icon: '🐙' },
  { name: 'Baidu', url: 'https://www.baidu.com', icon: '🔎' },
  { name: 'Claude', url: 'https://claude.ai', icon: '🤖' },
  { name: 'ChatGPT', url: 'https://chat.openai.com', icon: '💬' },
  { name: 'HuggingFace', url: 'https://huggingface.co', icon: '🤗' },
];

export function BrowserView() {
  const [inputUrl, setInputUrl] = useState('');
  const [currentUrl, setCurrentUrl] = useState('');
  const [title, setTitle] = useState('');
  const [isLaunched, setIsLaunched] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [showSnapshot, setShowSnapshot] = useState(false);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [actionLog, setActionLog] = useState<string[]>([]);
  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check browser state on mount
  useEffect(() => {
    api.browser.state().then((s: any) => {
      if (s?.launched) {
        setIsLaunched(true);
        setCurrentUrl(s.currentUrl || '');
        setTitle(s.title || '');
        setInputUrl(s.currentUrl || '');
        if (s.currentUrl) captureScreenshot();
      }
    }).catch(() => {});
  }, []);

  // Listen for WS navigation events (from AI or other sources)
  useEffect(() => {
    const unsub = api.browser.onNavigated((data: any) => {
      setCurrentUrl(data.url || '');
      setTitle(data.title || '');
      setInputUrl(data.url || '');
      addLog(`Navigated: ${data.url}`);
    });
    return unsub;
  }, []);

  // Auto-refresh interval
  useEffect(() => {
    if (autoRefresh && isLaunched && currentUrl) {
      autoRefreshRef.current = setInterval(() => {
        captureScreenshot(true);
      }, 3000);
    }
    return () => {
      if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current);
        autoRefreshRef.current = null;
      }
    };
  }, [autoRefresh, isLaunched, currentUrl]);

  const addLog = (msg: string) => {
    setActionLog((prev) => [...prev.slice(-49), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  };

  const captureScreenshot = useCallback(async (silent = false) => {
    try {
      setIsCapturing(true);
      const result = await api.browser.screenshot();
      if (result?.image) {
        setScreenshot(result.image);
        if (!silent) addLog('Screenshot captured');
      }
    } catch {
      if (!silent) addLog('Screenshot failed');
    } finally {
      setIsCapturing(false);
    }
  }, []);

  const handleNavigate = useCallback(async (url: string) => {
    if (!url.trim()) return;
    setIsLoading(true);
    setScreenshot(null);
    try {
      if (!isLaunched) {
        await api.browser.launch();
        setIsLaunched(true);
        addLog('Browser launched');
      }
      const result = await api.browser.navigate(url);
      if (result) {
        setCurrentUrl(result.url);
        setTitle(result.title);
        setInputUrl(result.url);
        addLog(`Navigated: ${result.url}`);
      }
      // Auto-screenshot after navigation
      await captureScreenshot();
    } catch (err: any) {
      addLog(`Error: ${err.message || 'Navigation failed'}`);
    } finally {
      setIsLoading(false);
    }
  }, [isLaunched, captureScreenshot]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleNavigate(inputUrl);
  };

  const handleBack = async () => {
    setIsLoading(true);
    try {
      const r = await api.browser.back();
      if (r) { setCurrentUrl(r.url); setTitle(r.title); setInputUrl(r.url); }
      await captureScreenshot();
    } finally { setIsLoading(false); }
  };

  const handleForward = async () => {
    setIsLoading(true);
    try {
      const r = await api.browser.forward();
      if (r) { setCurrentUrl(r.url); setTitle(r.title); setInputUrl(r.url); }
      await captureScreenshot();
    } finally { setIsLoading(false); }
  };

  const handleRefresh = async () => {
    setIsLoading(true);
    try {
      const r = await api.browser.reload();
      if (r) { setCurrentUrl(r.url); setTitle(r.title); }
      await captureScreenshot();
    } finally { setIsLoading(false); }
  };

  const handleHome = () => {
    setCurrentUrl('');
    setTitle('');
    setInputUrl('');
    setScreenshot(null);
    setSnapshot(null);
    setShowSnapshot(false);
    setAutoRefresh(false);
  };

  const handleSnapshot = async () => {
    try {
      const result = await api.browser.snapshot();
      if (result?.snapshot) {
        setSnapshot(result.snapshot);
        setShowSnapshot(true);
        addLog('Snapshot captured');
      }
    } catch (err: any) {
      addLog(`Snapshot error: ${err.message}`);
    }
  };

  const handleLaunchToggle = async () => {
    if (isLaunched) {
      await api.browser.close();
      setIsLaunched(false);
      setCurrentUrl('');
      setTitle('');
      setScreenshot(null);
      setSnapshot(null);
      setAutoRefresh(false);
      addLog('Browser closed');
    } else {
      await api.browser.launch();
      setIsLaunched(true);
      addLog('Browser launched');
    }
  };

  const isHome = !currentUrl;

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--color-bg)' }}>
      {/* Toolbar */}
      <div
        className="shrink-0 flex items-center gap-1.5 px-3 py-2"
        style={{ background: 'var(--color-bg-secondary)', borderBottom: '1px solid var(--color-border)' }}
      >
        <button
          onClick={handleLaunchToggle}
          className={`btn btn-ghost p-1.5 rounded-lg ${isLaunched ? 'text-[var(--color-success)]' : ''}`}
          title={isLaunched ? 'Close browser' : 'Launch browser'}
        >
          {isLaunched ? <Square size={16} /> : <Play size={16} />}
        </button>

        <div className="w-px h-5 bg-[var(--color-border)]" />

        <button onClick={handleBack} disabled={!isLaunched} className="btn btn-ghost p-1.5" title="Back">
          <ArrowLeft size={16} />
        </button>
        <button onClick={handleForward} disabled={!isLaunched} className="btn btn-ghost p-1.5" title="Forward">
          <ArrowRight size={16} />
        </button>
        <button onClick={handleRefresh} disabled={!isLaunched || isHome} className="btn btn-ghost p-1.5" title="Refresh">
          <RotateCw size={16} className={isLoading ? 'animate-spin' : ''} />
        </button>
        <button onClick={handleHome} className="btn btn-ghost p-1.5" title="Home">
          <Home size={16} />
        </button>

        {/* Address bar */}
        <div
          className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-lg"
          style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)' }}
        >
          <Globe size={14} className="shrink-0 text-[var(--color-text-muted)]" />
          <input
            type="text"
            value={inputUrl}
            onChange={(e) => setInputUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter URL..."
            className="flex-1 bg-transparent text-sm outline-none text-[var(--color-text)]"
            style={{ caretColor: 'var(--color-primary)' }}
            spellCheck={false}
          />
          {isLoading && <Loader size={13} className="animate-spin text-[var(--color-primary)]" />}
          {title && !isLoading && (
            <span className="text-[10px] text-[var(--color-text-muted)] truncate max-w-40">{title}</span>
          )}
        </div>

        <div className="w-px h-5 bg-[var(--color-border)]" />

        {/* Capture screenshot */}
        <button
          onClick={() => captureScreenshot()}
          disabled={!isLaunched || isHome}
          className="btn btn-ghost p-1.5"
          title="Refresh screenshot"
        >
          <Camera size={16} className={isCapturing ? 'animate-pulse' : ''} />
        </button>
        {/* Auto-refresh toggle */}
        <button
          onClick={() => setAutoRefresh(!autoRefresh)}
          disabled={!isLaunched || isHome}
          className={`btn btn-ghost p-1.5 ${autoRefresh ? 'text-[var(--color-primary)]' : ''}`}
          title={autoRefresh ? 'Stop auto-refresh (3s)' : 'Auto-refresh screenshot every 3s'}
        >
          <RefreshCw size={16} className={autoRefresh ? 'animate-spin' : ''} />
        </button>
        {/* Accessibility snapshot */}
        <button
          onClick={handleSnapshot}
          disabled={!isLaunched || isHome}
          className={`btn btn-ghost p-1.5 ${showSnapshot ? 'text-[var(--color-primary)]' : ''}`}
          title="Accessibility snapshot (for AI)"
        >
          <Eye size={16} />
        </button>
        {/* Open externally */}
        <button
          onClick={() => currentUrl && window.open(currentUrl, '_blank', 'noopener,noreferrer')}
          disabled={isHome}
          className="btn btn-ghost p-1.5"
          title="Open in system browser"
        >
          <ExternalLink size={16} />
        </button>
      </div>

      {/* Loading bar */}
      {isLoading && (
        <div className="h-0.5 bg-[var(--color-border)]">
          <div className="h-full animate-pulse" style={{ width: '60%', background: 'var(--gradient-primary)' }} />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Main view: screenshot or home */}
        <div className="flex-1 flex flex-col min-w-0">
          {isHome ? (
            <HomeScreen isLaunched={isLaunched} onNavigate={handleNavigate} />
          ) : (
            <div className="flex-1 overflow-auto" style={{ background: '#1a1a2e' }}>
              {screenshot ? (
                <img
                  src={`data:image/png;base64,${screenshot}`}
                  alt="Live page view"
                  className="w-full"
                  style={{ imageRendering: 'auto' }}
                />
              ) : isLoading ? (
                <div className="flex-1 flex items-center justify-center h-full">
                  <div className="flex flex-col items-center gap-3">
                    <Loader size={28} className="animate-spin text-[var(--color-primary)]" />
                    <span className="text-sm text-[var(--color-text-muted)]">Loading page...</span>
                  </div>
                </div>
              ) : (
                <div className="flex-1 flex items-center justify-center h-full">
                  <div className="flex flex-col items-center gap-2 text-center px-8">
                    <Globe size={28} className="text-[var(--color-text-muted)] opacity-40" />
                    <p className="text-sm text-[var(--color-text-muted)]">Capturing page...</p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action log */}
          {actionLog.length > 0 && (
            <div
              className="shrink-0 max-h-24 overflow-y-auto px-3 py-1.5 font-mono text-[10px] leading-relaxed"
              style={{
                background: 'var(--color-bg-secondary)',
                borderTop: '1px solid var(--color-border)',
                color: 'var(--color-text-muted)',
              }}
            >
              {actionLog.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          )}
        </div>

        {/* Right panel: Accessibility snapshot */}
        {showSnapshot && snapshot && (
          <div
            className="shrink-0 flex flex-col overflow-hidden"
            style={{
              width: 380,
              borderLeft: '1px solid var(--color-border)',
              background: 'var(--color-bg-secondary)',
            }}
          >
            <div className="flex items-center justify-between px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <span className="text-xs font-semibold text-[var(--color-text)]">
                Accessibility Tree (AI View)
              </span>
              <button onClick={() => setShowSnapshot(false)} className="btn btn-ghost p-1 text-xs">
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-auto p-3">
              <pre
                className="text-[11px] leading-relaxed whitespace-pre-wrap font-mono"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {snapshot}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function HomeScreen({ isLaunched, onNavigate }: { isLaunched: boolean; onNavigate: (url: string) => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8">
      <div className="flex items-center gap-3 mb-2">
        <div
          className="flex items-center justify-center rounded-xl"
          style={{
            width: 44, height: 44,
            background: 'linear-gradient(135deg, rgba(56,189,248,0.15) 0%, rgba(6,214,160,0.15) 100%)',
            border: '1px solid rgba(56,189,248,0.25)',
          }}
        >
          <Globe size={22} style={{ color: '#38bdf8' }} />
        </div>
        <div>
          <h2 className="font-bold text-lg text-[var(--color-text)]">AI Browser</h2>
          <p className="text-xs text-[var(--color-text-muted)]">
            Playwright-powered headless browser
          </p>
        </div>
      </div>

      <p className="text-xs text-[var(--color-text-muted)] mb-6">
        {isLaunched
          ? 'Browser is running. Enter a URL or click a bookmark.'
          : 'Click ▶ to launch, then navigate to any website.'}
      </p>

      <div className="grid grid-cols-3 gap-3" style={{ maxWidth: 480 }}>
        {BOOKMARKS.map((bm) => (
          <button
            key={bm.url}
            onClick={() => onNavigate(bm.url)}
            className="bookmark-card flex flex-col items-center gap-2 p-4 rounded-xl"
          >
            <span style={{ fontSize: 28 }}>{bm.icon}</span>
            <span className="text-xs font-medium text-[var(--color-text-secondary)]">{bm.name}</span>
          </button>
        ))}
      </div>

      <div className="mt-8 flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
        <span className={`status-dot ${isLaunched ? 'active' : ''}`} />
        {isLaunched ? 'Chromium running (headless)' : 'Browser not started'}
      </div>
    </div>
  );
}
