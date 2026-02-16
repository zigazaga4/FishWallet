// LivePreview - Shows localhost iframe from Vite dev server
// Each idea has a real Vite project on disk; the dev server serves it

import { useState, useEffect, useRef, useCallback, type ReactElement } from 'react';
import type { PreviewMode } from './Panel';

// Phone dimensions (iPhone SE)
const PHONE_WIDTH = 375;
const PHONE_HEIGHT = 667;

// Props for LivePreview component
interface LivePreviewProps {
  ideaId: string;
  activeBranchId?: string | null;
  previewMode?: PreviewMode;
  isSnapshot?: boolean;
  refreshKey?: number;
}

// LivePreview component — renders localhost iframe from Vite dev server
export function LivePreview({ ideaId, activeBranchId, previewMode = 'desktop', isSnapshot, refreshKey }: LivePreviewProps): ReactElement {
  const [port, setPort] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleRefresh = useCallback(() => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  }, []);

  const handleOpenInBrowser = useCallback(() => {
    if (port) {
      window.electronAPI.shell.openExternal(`http://localhost:${port}`);
    }
  }, [port]);

  // Restart dev server when refreshKey changes (after AI completes a round)
  useEffect(() => {
    if (!refreshKey || refreshKey === 0 || isSnapshot) return;

    let cancelled = false;
    (async () => {
      try {
        // Stop current dev server
        await window.electronAPI.devServer.stop();
        // Brief pause for process cleanup
        await new Promise(r => setTimeout(r, 300));
        // Start fresh
        const result = await window.electronAPI.devServer.start(ideaId);
        if (cancelled) return;
        if (result.success) {
          setPort(result.port);
          // Reload iframe with fresh server
          if (iframeRef.current) {
            iframeRef.current.src = `http://localhost:${result.port}`;
          }
        }
      } catch {
        // Dev server restart failed — iframe will show stale content
      }
    })();

    return () => { cancelled = true; };
  }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start/reuse dev server when ideaId or active branch changes
  useEffect(() => {
    if (isSnapshot) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        // Always call start — the main process checks both ideaId AND projectPath,
        // so it will restart when the branch (and thus folder) changes
        const result = await window.electronAPI.devServer.start(ideaId);
        if (cancelled) return;

        if (result.success) {
          setPort(result.port);
        } else {
          setError(result.error || 'Failed to start dev server');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to start dev server');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [ideaId, activeBranchId, isSnapshot]);

  // Snapshot mode: no running dev server
  if (isSnapshot) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-blue-300/60">
        <svg className="w-12 h-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
        <span>Snapshot preview not available</span>
      </div>
    );
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-blue-300/60">
        <svg className="w-8 h-8 animate-spin text-sky-400 mb-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>Starting dev server...</span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-red-400/80 p-4">
        <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span className="font-medium mb-1">Dev server failed</span>
        <span className="text-sm text-red-400/60 text-center">{error}</span>
      </div>
    );
  }

  // No port available
  if (!port) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-blue-300/60">
        <svg className="w-12 h-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
        <span>No app to preview</span>
        <span className="text-sm mt-1 text-blue-300/40">Ask the AI to build something</span>
      </div>
    );
  }

  const iframeSrc = `http://localhost:${port}`;

  // Toolbar with refresh and open in browser buttons
  const toolbar = (
    <div className="flex items-center gap-1 px-2 py-1 bg-[#0d1b2a] border-b border-blue-900/30">
      <span className="text-xs text-blue-400/60 mr-auto truncate">localhost:{port}</span>
      <button
        onClick={handleRefresh}
        className="p-1 rounded text-blue-400/60 hover:text-blue-300 hover:bg-blue-900/30 transition-colors"
        title="Refresh"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
      </button>
      <button
        onClick={handleOpenInBrowser}
        className="p-1 rounded text-blue-400/60 hover:text-blue-300 hover:bg-blue-900/30 transition-colors"
        title="Open in browser"
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
        </svg>
      </button>
    </div>
  );

  // Phone mode: constrained to phone dimensions, centered
  if (previewMode === 'phone') {
    return (
      <div className="h-full flex flex-col bg-[#0a1628] rounded-lg">
        {toolbar}
        <div className="flex-1 flex items-center justify-center">
          <div
            className="relative rounded-[2rem] border-4 border-gray-800 bg-gray-900 shadow-xl overflow-hidden"
            style={{ width: PHONE_WIDTH + 24, height: PHONE_HEIGHT + 48 }}
          >
            {/* Phone notch */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-6 bg-gray-800 rounded-b-xl z-10" />
            {/* Phone screen */}
            <div className="absolute inset-3 top-6 bottom-6 rounded-lg overflow-hidden">
              <iframe
                ref={iframeRef}
                src={iframeSrc}
                className="w-full h-full border-0 bg-white"
                title="App Preview"
              />
            </div>
            {/* Home indicator */}
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-32 h-1 bg-gray-600 rounded-full" />
          </div>
        </div>
      </div>
    );
  }

  // Desktop/fullscreen mode: fills available space
  return (
    <div className="h-full flex flex-col">
      {toolbar}
      <iframe
        ref={iframeRef}
        src={iframeSrc}
        className="flex-1 w-full border-0 rounded-lg bg-white"
        title="App Preview"
      />
    </div>
  );
}
