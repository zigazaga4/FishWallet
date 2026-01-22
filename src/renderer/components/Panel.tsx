// Panel - Floating side panel (like Claude's artifacts)
// Multi-purpose panel for ideas, websites, notes, dependency nodes, and app preview
// Guided by the Holy Spirit

import { useState, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { LivePreview } from './LivePreview';
import { DependencyNodesView } from './DependencyNodesView';

// Preview mode type - desktop (default), phone (constrained dimensions), or fullscreen (expanded)
export type PreviewMode = 'desktop' | 'phone' | 'fullscreen';

// Panel tab types
export type PanelTab = 'main-idea' | 'dependency-nodes' | 'app';

// Project file interface
interface ProjectFile {
  id: string;
  ideaId: string;
  filePath: string;
  content: string;
  fileType: 'tsx' | 'ts' | 'css';
  isEntryFile: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Dependency Node type
interface DependencyNode {
  id: string;
  ideaId: string;
  name: string;
  provider: string;
  description: string;
  pricing: string | null;
  positionX: number;
  positionY: number;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Dependency Node Connection type
interface DependencyNodeConnection {
  id: string;
  ideaId: string;
  fromNodeId: string;
  toNodeId: string;
  label: string | null;
  createdAt: Date;
}

// Panel props
interface PanelProps {
  isOpen: boolean;
  isLoading: boolean;
  content: string;
  onClose: () => void;
  // Tab control (lifted to parent)
  activeTab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  // App builder props
  appFiles: ProjectFile[];
  appEntryFile: ProjectFile | null;
  appLoading: boolean;
  // Dependency nodes props
  dependencyNodes: DependencyNode[];
  dependencyConnections: DependencyNodeConnection[];
  dependencyNodesLoading: boolean;
  onNodePositionChange?: (nodeId: string, x: number, y: number) => void;
}

// Floating side panel component
export function Panel({
  isOpen,
  isLoading,
  content,
  onClose,
  activeTab,
  onTabChange,
  appFiles,
  appEntryFile,
  appLoading,
  dependencyNodes,
  dependencyConnections,
  dependencyNodesLoading,
  onNodePositionChange
}: PanelProps): ReactElement | null {
  // Preview mode state - desktop, phone, or fullscreen
  const [previewMode, setPreviewMode] = useState<PreviewMode>('desktop');

  if (!isOpen) {
    return null;
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const markdownComponents: Record<string, React.ComponentType<any>> = {
    h1: ({ children }: any) => (
      <h1 className="text-2xl font-semibold text-blue-50 mt-6 mb-3 first:mt-0">{children}</h1>
    ),
    h2: ({ children }: any) => (
      <h2 className="text-xl font-semibold text-blue-50 mt-5 mb-2">{children}</h2>
    ),
    h3: ({ children }: any) => (
      <h3 className="text-lg font-medium text-blue-50 mt-4 mb-2">{children}</h3>
    ),
    h4: ({ children }: any) => (
      <h4 className="text-base font-medium text-blue-100 mt-3 mb-1">{children}</h4>
    ),
    p: ({ children }: any) => (
      <p className="text-blue-100 leading-relaxed mb-3">{children}</p>
    ),
    ul: ({ children }: any) => (
      <ul className="list-disc list-outside ml-5 mb-3 space-y-1 text-blue-100">{children}</ul>
    ),
    ol: ({ children }: any) => (
      <ol className="list-decimal list-outside ml-5 mb-3 space-y-1 text-blue-100">{children}</ol>
    ),
    li: ({ children }: any) => (
      <li className="text-blue-100">{children}</li>
    ),
    strong: ({ children }: any) => (
      <strong className="font-semibold text-blue-50">{children}</strong>
    ),
    em: ({ children }: any) => (
      <em className="italic text-blue-200">{children}</em>
    ),
    code: ({ children, className }: any) => {
      const isInline = !className;
      if (isInline) {
        return (
          <code className="px-1.5 py-0.5 bg-[#1e3a5f] rounded text-sky-300 text-sm font-mono">
            {children}
          </code>
        );
      }
      return (
        <code className="text-sky-300 font-mono text-sm">{children}</code>
      );
    },
    pre: ({ children }: any) => (
      <pre className="bg-[#0d1f3c] rounded-lg p-4 my-3 overflow-x-auto border border-[#1e3a5f]">
        {children}
      </pre>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-4 border-sky-500 pl-4 my-3 text-blue-200 italic">
        {children}
      </blockquote>
    ),
    a: ({ href, children }: any) => (
      <a href={href} className="text-sky-400 hover:text-sky-300 underline" target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
    hr: () => <hr className="my-4 border-[#1e3a5f]" />
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // Render content based on active tab
  const renderContent = (): ReactElement => {
    switch (activeTab) {
      case 'main-idea':
        // Main Idea tab - markdown synthesis content
        if (isLoading && !content) {
          return (
            <div className="flex flex-col items-center justify-center h-full text-blue-300/60">
              <svg className="w-8 h-8 animate-spin text-sky-400 mb-3" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span>Generating...</span>
            </div>
          );
        }

        if (content) {
          return (
            <div className="prose prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {content}
              </ReactMarkdown>
            </div>
          );
        }

        return (
          <div className="flex flex-col items-center justify-center h-full text-blue-300/60">
            <svg className="w-12 h-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <span>No content yet</span>
          </div>
        );

      case 'dependency-nodes':
        // Dependency Nodes tab - Visual node canvas
        return (
          <DependencyNodesView
            nodes={dependencyNodes}
            connections={dependencyConnections}
            isLoading={dependencyNodesLoading}
            onNodePositionChange={onNodePositionChange}
          />
        );

      case 'app':
        // App tab - Live preview of React code (fully isolated in iframe)
        return (
          <div className="h-full flex flex-col">
            {/* Preview mode controls */}
            <div className="flex items-center justify-end gap-2 mb-3">
              {/* Phone mode toggle */}
              <button
                onClick={() => setPreviewMode(previewMode === 'phone' ? 'desktop' : 'phone')}
                className={`p-2 rounded-lg transition-colors ${
                  previewMode === 'phone'
                    ? 'bg-sky-500/20 text-sky-400'
                    : 'text-blue-300 hover:text-blue-100 hover:bg-[#1e3a5f]'
                }`}
                title={previewMode === 'phone' ? 'Exit phone mode' : 'Phone mode (375x667)'}
              >
                {/* Phone icon */}
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </button>
              {/* Fullscreen expand toggle */}
              <button
                onClick={() => setPreviewMode(previewMode === 'fullscreen' ? 'desktop' : 'fullscreen')}
                className={`p-2 rounded-lg transition-colors ${
                  previewMode === 'fullscreen'
                    ? 'bg-sky-500/20 text-sky-400'
                    : 'text-blue-300 hover:text-blue-100 hover:bg-[#1e3a5f]'
                }`}
                title={previewMode === 'fullscreen' ? 'Exit fullscreen' : 'Expand preview'}
              >
                {/* Expand icon */}
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              </button>
            </div>
            {/* Preview container with mode-based sizing */}
            <div className={`flex-1 ${previewMode === 'fullscreen' ? 'fixed inset-0 z-50 bg-[#0d1f3c] p-4' : ''}`}>
              {previewMode === 'fullscreen' && (
                <button
                  onClick={() => setPreviewMode('desktop')}
                  className="absolute top-4 right-4 p-2 bg-[#1e3a5f] text-blue-300 hover:text-blue-100 rounded-lg z-10"
                  title="Exit fullscreen"
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
              <LivePreview
                entryFile={appEntryFile}
                allFiles={appFiles}
                isLoading={appLoading}
                previewMode={previewMode}
              />
            </div>
          </div>
        );
    }
  };

  return (
    // Floating container - 43% width, spacing from edges
    <div className="absolute right-13 top-3 bottom-3 w-[43%] z-10">
      {/* Panel with rounded corners and shadow */}
      <div className="h-full flex flex-col bg-[#0d1f3c] rounded-2xl shadow-2xl shadow-black/40 border border-[#1e3a5f]/80">
        {/* Header */}
        <div className="flex flex-col border-b border-[#1e3a5f] rounded-t-xl">
          {/* Title row */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
              </svg>
              <span className="text-blue-50 font-medium">Panel</span>
              {(isLoading || appLoading) && (
                <svg className="w-4 h-4 animate-spin text-sky-400 ml-2" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
            </div>
            <button
              onClick={onClose}
              className="p-1.5 text-blue-300 hover:text-blue-100 hover:bg-[#1e3a5f] rounded-lg transition-colors"
              aria-label="Close panel"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Tab buttons */}
          <div className="flex items-center gap-1 px-3 pb-2">
            <button
              onClick={() => onTabChange('main-idea')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                activeTab === 'main-idea'
                  ? 'bg-sky-500/20 text-sky-400 font-medium'
                  : 'text-blue-300 hover:text-blue-100 hover:bg-[#1e3a5f]'
              }`}
            >
              Main Idea
            </button>
            <button
              onClick={() => onTabChange('dependency-nodes')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                activeTab === 'dependency-nodes'
                  ? 'bg-sky-500/20 text-sky-400 font-medium'
                  : 'text-blue-300 hover:text-blue-100 hover:bg-[#1e3a5f]'
              }`}
            >
              Dependency Nodes
            </button>
            <button
              onClick={() => onTabChange('app')}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                activeTab === 'app'
                  ? 'bg-sky-500/20 text-sky-400 font-medium'
                  : 'text-blue-300 hover:text-blue-100 hover:bg-[#1e3a5f]'
              }`}
            >
              App
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
