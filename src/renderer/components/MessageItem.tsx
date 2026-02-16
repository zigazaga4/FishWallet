// MessageItem - Memoized message row for virtual list
// Renders compaction dividers, user bubbles, and assistant content blocks
// Guided by the Holy Spirit

import { memo, useState, useEffect, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ThinkingBlock } from './ThinkingBlock';
import { ProposedNoteBlock } from './ProposedNoteBlock';
import type { ChatMessage, ContentBlock, ProposedNote, ProposalStatus } from './types/chat';
import { formatToolName, getToolDetail, markdownComponents } from './types/chat';

// Self-updating elapsed timer for running Task blocks in saved messages
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

interface MessageItemProps {
  message: ChatMessage;
  proposalStatuses: Record<string, ProposalStatus>;
  onAcceptProposal: (proposal: ProposedNote) => Promise<void>;
  onRejectProposal: (proposalId: string) => void;
  onViewSnapshot: (snapshotId: string) => void;
  onRestoreSnapshot: (snapshotId: string) => void;
}

export const MessageItem = memo(function MessageItem({
  message,
  proposalStatuses,
  onAcceptProposal,
  onRejectProposal,
  onViewSnapshot,
  onRestoreSnapshot
}: MessageItemProps): ReactElement {
  // Compaction divider
  if (message.role === 'system' && message.content.startsWith('[COMPACTION]')) {
    return (
      <div className="flex items-center gap-3 py-2">
        <div className="flex-1 h-px bg-amber-500/30" />
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20">
          <svg className="w-3.5 h-3.5 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <span className="text-xs text-amber-400/80 font-medium">Context compacted — older messages summarized</span>
        </div>
        <div className="flex-1 h-px bg-amber-500/30" />
      </div>
    );
  }

  // User message
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl px-5 py-3 bg-sky-600 text-white">
          <p className="leading-relaxed">{message.content}</p>
        </div>
      </div>
    );
  }

  // Assistant message
  return (
    <div className="space-y-2">
      {message.contentBlocks && message.contentBlocks.length > 0 ? (
        message.contentBlocks.map((block, index) => {
          if (block.type === 'thinking') {
            return (
              <ThinkingBlock
                key={block.id}
                content={block.content || ''}
                isThinking={false}
                roundNumber={block.roundNumber || index + 1}
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
            const isRunning = !block.toolResult;
            const hasChildren = isTask && block.childBlocks && block.childBlocks.length > 0;
            return (
              <div key={block.id}>
                <div className="flex items-center gap-2 text-sm">
                  {/* Status indicator: spinner while running, checkmark/X when done */}
                  {isRunning ? (
                    <svg className={`w-4 h-4 animate-spin shrink-0 ${isTask ? 'text-purple-400' : 'text-sky-400'}`} fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : block.toolResult?.error ? (
                    <svg className="w-4 h-4 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  <span className={`px-2 py-0.5 rounded text-xs shrink-0 ${
                    isTask
                      ? (block.toolResult?.error ? 'bg-red-900/50 text-red-300' : 'bg-purple-900/50 text-purple-300')
                      : block.toolResult?.success
                        ? 'bg-emerald-900/50 text-emerald-300'
                        : block.toolResult?.error
                          ? 'bg-red-900/50 text-red-300'
                          : 'bg-[#1e3a5f] text-sky-300'
                  }`}>
                    {formatToolName(block.toolName || 'unknown')}
                  </span>
                  {detail && (
                    <span className="text-blue-200/50 text-xs truncate" title={detail}>
                      {detail}
                    </span>
                  )}
                  {!detail && isRunning && (
                    <span className="text-blue-300/60 text-xs">running...</span>
                  )}
                  {/* Elapsed timer for running Task blocks */}
                  {isTask && isRunning && block._createdAt && (
                    <TaskTimer startTime={block._createdAt} />
                  )}
                </div>
                {/* Nested sub-agent tool calls in saved messages */}
                {hasChildren && (
                  <div className="ml-5 mt-1 pl-3 border-l-2 border-purple-500/30 space-y-1">
                    {block.childBlocks!.map((child) => {
                      const childDetail = getToolDetail(child.toolName, child.toolInput);
                      const childRunning = !child.toolResult;
                      return (
                        <div key={child.id} className="flex items-center gap-2 text-sm">
                          {childRunning ? (
                            <svg className="w-3.5 h-3.5 animate-spin text-purple-400 shrink-0" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                          ) : child.toolResult?.error ? (
                            <svg className="w-3.5 h-3.5 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          ) : (
                            <svg className="w-3.5 h-3.5 text-emerald-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                          <span className={`px-1.5 py-0.5 rounded text-xs shrink-0 ${
                            child.toolResult?.success
                              ? 'bg-emerald-900/30 text-emerald-300'
                              : child.toolResult?.error
                                ? 'bg-red-900/30 text-red-300'
                                : 'bg-purple-900/30 text-purple-300'
                          }`}>
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
          } else if (block.type === 'version_snapshot') {
            return (
              <div key={block.id} className="flex items-center gap-2 mt-2">
                <span className="px-3 py-1 rounded-full bg-indigo-900/50 text-indigo-300 text-xs font-medium border border-indigo-500/30">
                  Version {block.versionNumber}
                </span>
                <button
                  onClick={() => block.snapshotId && onViewSnapshot(block.snapshotId)}
                  className="px-2 py-1 rounded text-xs text-blue-300 hover:text-blue-100 hover:bg-[#1e3a5f] transition-colors flex items-center gap-1"
                  title="View this version"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  View
                </button>
                <button
                  onClick={() => block.snapshotId && onRestoreSnapshot(block.snapshotId)}
                  className="px-2 py-1 rounded text-xs text-amber-300 hover:text-amber-100 hover:bg-amber-900/30 transition-colors flex items-center gap-1"
                  title="Restore this version"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                  </svg>
                  Restore
                </button>
              </div>
            );
          } else {
            return block.content ? (
              <div key={block.id} className="prose prose-invert max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={markdownComponents}
                >
                  {block.content}
                </ReactMarkdown>
              </div>
            ) : null;
          }
        })
      ) : (
        <>
          {message.thinking && (
            <ThinkingBlock content={message.thinking} isThinking={false} />
          )}
          {message.content && (
            <div className="prose prose-invert max-w-none">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={markdownComponents}
              >
                {message.content}
              </ReactMarkdown>
            </div>
          )}
        </>
      )}
    </div>
  );
}, (prevProps, nextProps) => {
  // Custom comparator: messages are immutable after creation
  if (prevProps.message !== nextProps.message) return false;

  // Check if any proposal in this message has a changed status
  const blocks = prevProps.message.contentBlocks;
  if (blocks) {
    for (const block of blocks) {
      if (block.type === 'tool_use' && block.proposal) {
        const prevStatus = prevProps.proposalStatuses[block.proposal.id];
        const nextStatus = nextProps.proposalStatuses[block.proposal.id];
        if (prevStatus !== nextStatus) return false;
      }
    }
  }

  return true;
});
