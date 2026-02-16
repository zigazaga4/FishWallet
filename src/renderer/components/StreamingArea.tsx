// StreamingArea - Displays streaming blocks during AI response
// NOT memoized - intentionally re-renders per token
// Guided by the Holy Spirit

import { useState, useEffect, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ThinkingBlock } from './ThinkingBlock';
import { WebSearchBlock } from './WebSearchBlock';
import { ProposedNoteBlock } from './ProposedNoteBlock';
import type { ContentBlock, SearchResultItem, ProposedNote, ProposalStatus } from './types/chat';
import { formatToolName, getToolDetail, markdownComponents } from './types/chat';

// Self-updating elapsed timer for running Task blocks
function TaskTimer({ startTime }: { startTime: number }): ReactElement {
  const [elapsed, setElapsed] = useState(Math.floor((Date.now() - startTime) / 1000));
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);
  return <span className="text-purple-300/50 text-xs ml-auto tabular-nums">{elapsed}s</span>;
}

interface StreamingAreaProps {
  isStreaming: boolean;
  isThinking: boolean;
  isCompacting: boolean;
  streamingBlocks: ContentBlock[];
  isSearching: boolean;
  searchQuery: string;
  searchResults: SearchResultItem[];
  proposalStatuses: Record<string, ProposalStatus>;
  isLoading: boolean;
  onAcceptProposal: (proposal: ProposedNote) => Promise<void>;
  onRejectProposal: (proposalId: string) => void;
}

export function StreamingArea({
  isStreaming,
  isThinking,
  isCompacting,
  streamingBlocks,
  isSearching,
  searchQuery,
  searchResults,
  proposalStatuses,
  isLoading,
  onAcceptProposal,
  onRejectProposal
}: StreamingAreaProps): ReactElement | null {
  const showStreaming = isStreaming || isThinking || isCompacting || streamingBlocks.length > 0;
  const showLoading = isLoading && !isStreaming && !isThinking && !isCompacting && streamingBlocks.length === 0;

  if (!showStreaming && !showLoading) return null;

  return (
    <>
      {showStreaming && (
        <div className="space-y-2">
          {/* Web search block while streaming */}
          {(isSearching || searchQuery) && (
            <WebSearchBlock
              query={searchQuery}
              results={searchResults}
              isSearching={isSearching}
            />
          )}

          {/* Render all blocks in order - thinking, tools, and text */}
          {streamingBlocks.map((block) => {
            if (block.type === 'thinking') {
              return (
                <ThinkingBlock
                  key={block.id}
                  content={block.content || ''}
                  isThinking={block.isThinkingActive || false}
                  roundNumber={block.roundNumber}
                />
              );
            } else if (block.type === 'tool_use') {
              if (block.toolName === 'propose_note' && block.proposal) {
                const status = proposalStatuses[block.proposal.id];
                return (
                  <ProposedNoteBlock
                    key={block.id}
                    proposal={block.proposal}
                    onAccept={onAcceptProposal}
                    onReject={onRejectProposal}
                    isProcessing={status?.isProcessing}
                    isAccepted={status?.isAccepted}
                    isRejected={status?.isRejected}
                  />
                );
              }
              const detail = getToolDetail(block.toolName, block.toolInput);
              const isTask = block.toolName === 'Task';
              const hasChildren = isTask && block.childBlocks && block.childBlocks.length > 0;
              return (
                <div key={block.id}>
                  <div className="flex items-center gap-2 text-sm">
                    {!block.toolResult ? (
                      <svg className="w-4 h-4 animate-spin text-sky-400 shrink-0" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    <span className={`px-2 py-0.5 rounded text-xs shrink-0 ${
                      isTask ? 'bg-purple-900/50 text-purple-300' : 'bg-[#1e3a5f] text-sky-300'
                    }`}>
                      {formatToolName(block.toolName || 'unknown')}
                    </span>
                    {detail && (
                      <span className="text-blue-200/50 text-xs truncate" title={detail}>
                        {detail}
                      </span>
                    )}
                    {!detail && (
                      <span className="text-blue-300/60 text-xs">
                        {block.toolResult ? 'completed' : 'running...'}
                      </span>
                    )}
                    {isTask && !block.toolResult && block._createdAt && (
                      <TaskTimer startTime={block._createdAt} />
                    )}
                  </div>
                  {/* Nested sub-agent tool calls */}
                  {hasChildren && (
                    <div className="ml-5 mt-1 pl-3 border-l-2 border-purple-500/30 space-y-1">
                      {block.childBlocks!.map((child) => {
                        const childDetail = getToolDetail(child.toolName, child.toolInput);
                        return (
                          <div key={child.id} className="flex items-center gap-2 text-sm">
                            {!child.toolResult ? (
                              <svg className="w-3.5 h-3.5 animate-spin text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                            ) : (
                              <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                            <span className="px-1.5 py-0.5 rounded bg-purple-900/30 text-purple-300 text-xs shrink-0">
                              {formatToolName(child.toolName || 'unknown')}
                            </span>
                            {childDetail && (
                              <span className="text-blue-200/40 text-xs truncate" title={childDetail}>
                                {childDetail}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            } else {
              if (!block.content?.trim()) return null;
              return (
                <div key={block.id} className="prose prose-invert max-w-none">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {block.content}
                  </ReactMarkdown>
                </div>
              );
            }
          })}

          {/* Compaction indicator */}
          {isCompacting && (
            <div className="flex items-center gap-3 py-2">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20">
                <svg className="w-4 h-4 animate-spin text-amber-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-xs text-amber-400/80 font-medium">Compacting context...</span>
              </div>
            </div>
          )}

          {/* Loading state - starting to think, no blocks yet */}
          {isThinking && streamingBlocks.length === 0 && (
            <div className="flex items-center gap-3 text-blue-200/60">
              <svg className="w-5 h-5 animate-spin text-sky-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span>Starting to think...</span>
            </div>
          )}
        </div>
      )}

      {/* Initial loading indicator */}
      {showLoading && (
        <div className="flex items-center gap-3 text-blue-200/60">
          <svg className="w-5 h-5 animate-spin text-sky-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Preparing synthesis...</span>
        </div>
      )}
    </>
  );
}
