// Shared types for the IdeaChat component tree
// Guided by the Holy Spirit

import type { ReactElement } from 'react';

// Content block for ordered display - includes thinking blocks for proper ordering
export interface ContentBlock {
  id: string;
  type: 'text' | 'tool_use' | 'thinking' | 'version_snapshot';
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: { success: boolean; data?: unknown; error?: string };
  // Internal: accumulated raw JSON for progressive parsing (not persisted)
  _rawInput?: string;
  // Internal: creation timestamp for elapsed time display (not persisted)
  _createdAt?: number;
  // Thinking-specific fields
  roundNumber?: number;
  isThinkingActive?: boolean;
  // Note proposal fields (for propose_note tool)
  proposal?: ProposedNote;
  // Version snapshot fields
  versionNumber?: number;
  snapshotId?: string;
  // Sub-agent (Task tool) fields
  parentToolUseId?: string;     // Links this block to a parent Task tool block
  childBlocks?: ContentBlock[]; // Nested sub-agent blocks under a Task
  elapsedSeconds?: number;      // Latest progress time for running tools
}

// Message type for display
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
  thinking?: string;
  contentBlocks?: ContentBlock[];
}

// Web search result item
export interface SearchResultItem {
  rank: number;
  title: string;
  url: string;
  snippet: string;
}

// Proposed note from AI
export interface ProposedNote {
  id: string;
  title: string;
  content: string;
  category: 'research' | 'decision' | 'recommendation' | 'insight' | 'warning' | 'todo';
  ideaId: string;
}

// Proposal status for tracking accept/reject
export interface ProposalStatus {
  isProcessing: boolean;
  isAccepted: boolean;
  isRejected: boolean;
}

// Project file interface
export interface ProjectFile {
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
export interface DependencyNode {
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
export interface DependencyNodeConnection {
  id: string;
  ideaId: string;
  fromNodeId: string;
  toNodeId: string;
  label: string | null;
  details: string | null;
  createdAt: Date;
}

// Stream event type from synthesis/app builder API
export interface StreamEvent {
  type: 'thinking_start' | 'thinking' | 'thinking_done' | 'text' | 'tool_start' | 'tool_input_delta' | 'tool_use' | 'tool_result' | 'web_search' | 'web_search_result' | 'note_proposal' | 'round_complete' | 'compact_status' | 'compact_boundary' | 'error_user_message' | 'tool_progress' | 'subagent_done' | 'done';
  content?: string;
  toolCall?: { id: string; name: string; input: Record<string, unknown> };
  toolId?: string;
  toolName?: string;
  partialInput?: string;
  result?: { success: boolean; data?: unknown; error?: string };
  stopReason?: string;
  searchQuery?: string;
  searchResults?: SearchResultItem[];
  proposal?: ProposedNote;
  usage?: { inputTokens: number; outputTokens: number };
  // Compaction fields
  compacting?: boolean;
  trigger?: 'manual' | 'auto';
  preTokens?: number;
  // Sub-agent fields
  parentToolUseId?: string;
  elapsedSeconds?: number;
  summary?: string;
}

// Format tool name for display (module-level pure function)
export function formatToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

// Extract the most relevant detail from tool input for display
export function getToolDetail(toolName?: string, input?: Record<string, unknown>): string | null {
  if (!toolName || !input) return null;
  const name = toolName.toLowerCase();

  // File tools — show file path (basename only)
  if (name === 'read' || name === 'write' || name === 'edit') {
    const filePath = input.file_path as string | undefined;
    if (filePath) {
      const parts = filePath.split('/');
      return parts[parts.length - 1];
    }
  }

  // Bash — show command (truncated)
  if (name === 'bash') {
    const cmd = input.command as string | undefined;
    if (cmd) return cmd.length > 80 ? cmd.slice(0, 77) + '...' : cmd;
  }

  // Glob — show pattern
  if (name === 'glob') {
    const pattern = input.pattern as string | undefined;
    if (pattern) return pattern;
  }

  // Grep — show pattern
  if (name === 'grep') {
    const pattern = input.pattern as string | undefined;
    if (pattern) return `/${pattern}/`;
  }

  // TodoWrite / TodoRead
  if (name === 'todowrite' || name === 'todoread') {
    const todos = input.todos as Array<{ content?: string }> | undefined;
    if (todos?.length) return `${todos.length} item${todos.length > 1 ? 's' : ''}`;
  }

  // Task — show description
  if (name === 'task') {
    const desc = input.description as string | undefined;
    if (desc) return desc.length > 60 ? desc.slice(0, 57) + '...' : desc;
  }

  // MCP tools — show a relevant field if present
  const content = input.content as string | undefined;
  if (content) return content.length > 60 ? content.slice(0, 57) + '...' : content;

  return null;
}

// Markdown components styling for AI responses (module-level constant)
/* eslint-disable @typescript-eslint/no-explicit-any */
export const markdownComponents: Record<string, React.ComponentType<any>> = {
  h1: ({ children }: any) => (
    <h1 className="text-2xl font-semibold text-blue-50 mt-6 mb-3">{children}</h1>
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
