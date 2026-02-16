// Claude Code Service - Wraps the Agent SDK to spawn Claude Code as a subprocess
// Claude Code manages its own conversation context via session IDs

import { query, type SDKMessage, type SDKResultMessage, type McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk';
import { logger } from './logger';
import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';

// Base fields present on all stream events (parentToolUseId links to sub-agent parent)
interface StreamEventBase { parentToolUseId?: string }

// Re-export StreamEvent for use in IPC handlers (same shape as before)
export type StreamEvent =
  | (StreamEventBase & { type: 'thinking_start' })
  | (StreamEventBase & { type: 'thinking'; content: string })
  | (StreamEventBase & { type: 'thinking_done'; signature?: string })
  | (StreamEventBase & { type: 'text'; content: string })
  | (StreamEventBase & { type: 'tool_start'; toolId: string; toolName: string })
  | (StreamEventBase & { type: 'tool_input_delta'; toolId: string; toolName: string; partialInput: string })
  | (StreamEventBase & { type: 'tool_use'; toolName: string; toolId: string; input: Record<string, unknown>; toolCall: { id: string; name: string; input: Record<string, unknown> } })
  | (StreamEventBase & { type: 'tool_result'; toolId: string; toolName?: string; result: { success: boolean; data?: unknown; error?: string } })
  | (StreamEventBase & { type: 'round_complete' })
  | (StreamEventBase & { type: 'compact_status'; compacting: boolean })
  | (StreamEventBase & { type: 'compact_boundary'; trigger: 'manual' | 'auto'; preTokens: number })
  | (StreamEventBase & { type: 'error_user_message'; content: string })
  | (StreamEventBase & { type: 'tool_progress'; toolId: string; toolName: string; elapsedSeconds: number })
  | (StreamEventBase & { type: 'subagent_done'; toolId: string; summary: string })
  | (StreamEventBase & { type: 'done'; stopReason: string; usage?: { inputTokens: number; outputTokens: number } });

// Options for streaming a Claude Code query
export interface ClaudeCodeStreamOptions {
  prompt: string;
  systemPromptAppend: string;
  sessionId?: string | null;
  mcpServer: McpSdkServerConfigWithInstance;
  abortController?: AbortController;
  onEvent: (event: StreamEvent) => void;
  onSessionId: (sessionId: string) => void;
  projectPath?: string | null;
  model?: string;
}

// MCP server key used in query options — tool names become mcp__fw__<toolName>
const MCP_SERVER_KEY = 'fw';

// Environment variables that must be stripped before spawning Claude Code subprocess.
// Electron and VS Code inject these, which cause the subprocess to crash (exit code 1).
const ENV_VARS_TO_STRIP = [
  'NODE_OPTIONS',
  'VSCODE_INSPECTOR_OPTIONS',
  'ELECTRON_RUN_AS_NODE',
  'ELECTRON_NO_ASAR',
  'NODE_DEBUG',
];

// Build a clean environment for the Claude Code subprocess
function getCleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !ENV_VARS_TO_STRIP.includes(key)) {
      env[key] = value;
    }
  }
  return env;
}

// Track active content blocks during streaming for proper event translation
interface BlockInfo {
  type: 'text' | 'thinking' | 'tool_use';
  toolId?: string;
  toolName?: string;
  inputChunks?: string[];
}

// Stream a query through Claude Code subprocess
export async function streamClaudeCode(options: ClaudeCodeStreamOptions): Promise<SDKResultMessage | null> {
  const {
    prompt,
    systemPromptAppend,
    sessionId,
    mcpServer,
    abortController,
    onEvent,
    onSessionId,
    projectPath,
    model
  } = options;

  // Build clean environment (strip Electron/VS Code vars that crash the subprocess)
  const cleanEnv = getCleanEnv();

  logger.info('[ClaudeCode] Starting query', {
    hasSessionId: !!sessionId,
    sessionId: sessionId || 'none',
    promptLength: prompt.length,
    projectPath: projectPath || 'none',
    mcpServerConnected: !!mcpServer,
    strippedEnvVars: ENV_VARS_TO_STRIP.filter(k => k in process.env)
  });

  // Track content blocks by scope+index for translating streaming events.
  // Key format: "parentToolUseId|index" (or "main|index" for root agent).
  // This prevents collisions when multiple sub-agents stream in parallel.
  const blocks = new Map<string, BlockInfo>();
  // Only fire onSessionId once per query (session ID is on every stream chunk)
  let sessionIdEmitted = false;

  const q = query({
    prompt,
    options: {
      model: model || 'claude-opus-4-6',
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: systemPromptAppend
      },
      mcpServers: { [MCP_SERVER_KEY]: mcpServer },
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      // Clean environment: strip Electron/VS Code vars that cause subprocess crashes
      // Also disable background tasks to prevent runaway token consumption
      env: { ...cleanEnv, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' },
      // Capture stderr from Claude Code subprocess for debugging crashes
      stderr: (data: string) => {
        logger.warn('[ClaudeCode] stderr:', data.trim());
      },
      // Write debug output to file for diagnosing exit code 1 crashes
      debugFile: '/Users/mobinedvin/FishWallet/FishWallet/logs/claude-code-debug.log',
      // Set cwd to the idea's project folder so built-in file tools operate there
      ...(projectPath ? { cwd: projectPath } : {}),
      // Session resume: if we have a session ID, resume it
      ...(sessionId ? { resume: sessionId } : {}),
      ...(abortController ? { abortController } : {})
    }
  });

  let result: SDKResultMessage | null = null;

  // Wrap onSessionId to deduplicate
  const onSessionIdOnce = (id: string): void => {
    if (!sessionIdEmitted) {
      sessionIdEmitted = true;
      onSessionId(id);
    }
  };

  try {
    for await (const message of q) {
      handleSdkMessage(message, blocks, onEvent, onSessionIdOnce);

      if (message.type === 'result') {
        result = message as SDKResultMessage;
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      logger.info('[ClaudeCode] Query aborted');
    } else {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('[ClaudeCode] Query error', {
        error: errorMessage,
        sessionId: sessionId || 'none',
        projectPath: projectPath || 'none',
        isExitCode1: errorMessage.includes('exited with code 1')
      });

      // For exit code 1: try to extract the real error from the debug log
      if (errorMessage.includes('exited with code 1')) {
        logger.error('[ClaudeCode] Exit code 1 debug info', {
          promptLength: prompt.length,
          promptPreview: prompt.slice(0, 200),
          systemPromptAppendLength: systemPromptAppend.length
        });

        // Read debug log to find the actual API error
        const debugLogPath = '/Users/mobinedvin/FishWallet/FishWallet/logs/claude-code-debug.log';
        try {
          if (existsSync(debugLogPath)) {
            const debugContent = readFileSync(debugLogPath, 'utf-8');
            const lines = debugContent.split('\n').slice(-50);
            // Look for common API error patterns
            const apiError = lines.find(l =>
              l.includes('credit balance is too low') ||
              l.includes('invalid_request_error') ||
              l.includes('authentication_error') ||
              l.includes('rate_limit_error') ||
              l.includes('overloaded_error')
            );
            if (apiError) {
              // Extract the message from the JSON error
              const msgMatch = apiError.match(/"message":"([^"]+)"/);
              const friendlyMessage = msgMatch ? msgMatch[1] : apiError;
              logger.error('[ClaudeCode] Real API error found in debug log:', friendlyMessage);
              throw new Error(friendlyMessage);
            }
          }
        } catch (debugErr) {
          // If the debug error is our re-thrown friendly message, propagate it
          if (debugErr instanceof Error && !debugErr.message.includes('exited with code')) {
            throw debugErr;
          }
          // Otherwise fall through to throw original error
        }
      }

      throw err;
    }
  }

  return result;
}

// Strip MCP prefix from tool name: "mcp__fw__propose_note" → "propose_note"
function stripMcpPrefix(name: string): string {
  const prefix = `mcp__${MCP_SERVER_KEY}__`;
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

// Build scoped key for the blocks map: "parentId|index"
function blockKey(parentToolUseId: string | undefined, index: number): string {
  return `${parentToolUseId || 'main'}|${index}`;
}

// Translate a single SDK message to our StreamEvent format
function handleSdkMessage(
  message: SDKMessage,
  blocks: Map<string, BlockInfo>,
  onEvent: (event: StreamEvent) => void,
  onSessionId: (sessionId: string) => void
): void {
  switch (message.type) {
    case 'system': {
      const sysMsg = message as { type: 'system'; subtype: string; session_id?: string; status?: string | null; compact_metadata?: { trigger: 'manual' | 'auto'; pre_tokens: number }; task_id?: string; summary?: string };
      if (sysMsg.subtype === 'init' && sysMsg.session_id) {
        onSessionId(sysMsg.session_id);
        logger.info('[ClaudeCode] Session initialized', { sessionId: sysMsg.session_id });
      } else if (sysMsg.subtype === 'status') {
        const compacting = sysMsg.status === 'compacting';
        onEvent({ type: 'compact_status', compacting });
        logger.info('[ClaudeCode] Status update', { status: sysMsg.status });
      } else if (sysMsg.subtype === 'compact_boundary') {
        const meta = sysMsg.compact_metadata;
        onEvent({
          type: 'compact_boundary',
          trigger: meta?.trigger || 'auto',
          preTokens: meta?.pre_tokens || 0
        });
        logger.info('[ClaudeCode] Compaction boundary', { trigger: meta?.trigger, preTokens: meta?.pre_tokens });
      } else if (sysMsg.subtype === 'task_notification') {
        // Sub-agent task completed/failed/stopped
        onEvent({
          type: 'subagent_done',
          toolId: sysMsg.task_id || '',
          summary: sysMsg.summary || ''
        });
        logger.info('[ClaudeCode] Task notification', { taskId: sysMsg.task_id });
      }
      break;
    }

    case 'stream_event': {
      const streamMsg = message as unknown as { type: 'stream_event'; event: Record<string, unknown>; session_id?: string; parent_tool_use_id?: string | null };
      const evt = streamMsg.event;

      // Capture session ID from stream events too (for resumed sessions)
      if (streamMsg.session_id) {
        onSessionId(streamMsg.session_id);
      }

      // Extract parent_tool_use_id — non-null means this event is from a sub-agent
      const parentToolUseId = streamMsg.parent_tool_use_id || undefined;
      const evtType = evt.type as string;
      translateStreamEvent(evt, blocks, onEvent, parentToolUseId);
      break;
    }

    case 'assistant': {
      // Complete assistant message — extract content blocks, then emit round_complete
      const assistantMsg = message as unknown as {
        type: 'assistant';
        parent_tool_use_id?: string | null;
        message?: {
          content?: Array<{
            type: string;
            id?: string;
            name?: string;
            input?: Record<string, unknown>;
            text?: string;
            thinking?: string;
          }>;
        };
      };
      const assistantParentId = assistantMsg.parent_tool_use_id || undefined;

      // For sub-agent messages, extract content blocks and emit individual events
      // (Sub-agents don't emit stream_events — only complete assistant messages)
      if (assistantParentId && assistantMsg.message?.content) {
        for (const block of assistantMsg.message.content) {
          if (block.type === 'tool_use' && block.id && block.name) {
            const toolName = stripMcpPrefix(block.name);
            onEvent({ type: 'tool_start', toolId: block.id, toolName, parentToolUseId: assistantParentId });
            onEvent({
              type: 'tool_use',
              toolName,
              toolId: block.id,
              input: block.input || {},
              toolCall: { id: block.id, name: toolName, input: block.input || {} },
              parentToolUseId: assistantParentId
            });
          }
        }
      }

      onEvent({ type: 'round_complete', parentToolUseId: assistantParentId });
      // Only clear blocks for this agent's scope (don't wipe parallel sub-agents)
      const scopePrefix = `${assistantParentId || 'main'}|`;
      for (const key of blocks.keys()) {
        if (key.startsWith(scopePrefix)) blocks.delete(key);
      }
      break;
    }

    case 'result': {
      const resultMsg = message as unknown as SDKResultMessage;
      if (resultMsg.subtype === 'success') {
        onEvent({
          type: 'done',
          stopReason: 'end_turn',
          usage: {
            inputTokens: resultMsg.usage.input_tokens,
            outputTokens: resultMsg.usage.output_tokens
          }
        });
      } else {
        onEvent({
          type: 'done',
          stopReason: resultMsg.subtype
        });
      }
      break;
    }

    case 'user': {
      // User messages contain tool results from built-in Claude Code tools (Read, Write, Edit, Bash, etc.)
      const userMsg = message as unknown as {
        type: 'user';
        message: { role: string; content: string | Array<Record<string, unknown>> };
        isReplay?: boolean;
        parent_tool_use_id?: string | null;
      };
      // Skip replayed messages from session resume — they're from previous turns
      if (userMsg.isReplay) break;

      const userParentId = userMsg.parent_tool_use_id || undefined;
      const content = userMsg.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
            const isError = !!block.is_error;
            let resultText: string | undefined;
            if (typeof block.content === 'string') {
              resultText = block.content;
            } else if (Array.isArray(block.content)) {
              resultText = (block.content as Array<Record<string, unknown>>)
                .filter((b) => b.type === 'text' && typeof b.text === 'string')
                .map((b) => b.text as string)
                .join('\n');
            }
            onEvent({
              type: 'tool_result',
              toolId: block.tool_use_id as string,
              result: {
                success: !isError,
                ...(isError ? { error: resultText || 'Tool failed' } : { data: resultText })
              },
              parentToolUseId: userParentId
            });
          }
        }
      }
      break;
    }

    case 'tool_progress': {
      // Periodic progress updates for running tools (including sub-agent Task tools)
      const progressMsg = message as unknown as {
        type: 'tool_progress';
        tool_use_id: string;
        tool_name: string;
        parent_tool_use_id?: string | null;
        elapsed_time_seconds: number;
      };
      onEvent({
        type: 'tool_progress',
        toolId: progressMsg.tool_use_id,
        toolName: progressMsg.tool_name,
        elapsedSeconds: progressMsg.elapsed_time_seconds,
        parentToolUseId: progressMsg.parent_tool_use_id || undefined
      });
      break;
    }

    // tool_use_summary, files_persisted, etc. — not needed for the UI
    default:
      break;
  }
}

// Translate raw Anthropic streaming event to our StreamEvent format
function translateStreamEvent(
  evt: Record<string, unknown>,
  blocks: Map<string, BlockInfo>,
  onEvent: (event: StreamEvent) => void,
  parentToolUseId?: string
): void {
  const eventType = evt.type as string;

  switch (eventType) {
    case 'content_block_start': {
      const index = evt.index as number;
      const key = blockKey(parentToolUseId, index);
      const contentBlock = evt.content_block as Record<string, unknown>;
      const blockType = contentBlock.type as string;

      if (blockType === 'thinking') {
        blocks.set(key, { type: 'thinking' });
        onEvent({ type: 'thinking_start', parentToolUseId });
      } else if (blockType === 'text') {
        blocks.set(key, { type: 'text' });
      } else if (blockType === 'tool_use') {
        const toolId = contentBlock.id as string;
        const rawName = contentBlock.name as string;
        const toolName = stripMcpPrefix(rawName);
        blocks.set(key, { type: 'tool_use', toolId, toolName, inputChunks: [] });
        onEvent({ type: 'tool_start', toolId, toolName, parentToolUseId });
      }
      break;
    }

    case 'content_block_delta': {
      const index = evt.index as number;
      const key = blockKey(parentToolUseId, index);
      const delta = evt.delta as Record<string, unknown>;
      const deltaType = delta.type as string;
      const block = blocks.get(key);

      if (deltaType === 'thinking_delta' && block?.type === 'thinking') {
        onEvent({ type: 'thinking', content: delta.thinking as string, parentToolUseId });
      } else if (deltaType === 'text_delta' && block?.type === 'text') {
        onEvent({ type: 'text', content: delta.text as string, parentToolUseId });
      } else if (deltaType === 'input_json_delta' && block?.type === 'tool_use') {
        const partialInput = delta.partial_json as string;
        block.inputChunks?.push(partialInput);
        onEvent({
          type: 'tool_input_delta',
          toolId: block.toolId || '',
          toolName: block.toolName || '',
          partialInput,
          parentToolUseId
        });
      }
      break;
    }

    case 'content_block_stop': {
      const index = evt.index as number;
      const key = blockKey(parentToolUseId, index);
      const block = blocks.get(key);

      if (block?.type === 'thinking') {
        onEvent({ type: 'thinking_done', parentToolUseId });
      } else if (block?.type === 'tool_use') {
        // Reconstruct the full input from accumulated chunks
        const fullInputJson = (block.inputChunks || []).join('');
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(fullInputJson);
        } catch {
          logger.warn('[ClaudeCode] Failed to parse tool input JSON', { toolName: block.toolName });
        }
        onEvent({
          type: 'tool_use',
          toolName: block.toolName || '',
          toolId: block.toolId || '',
          input,
          toolCall: {
            id: block.toolId || '',
            name: block.toolName || '',
            input
          },
          parentToolUseId
        });
      }
      break;
    }

    // message_start, message_delta, message_stop — we handle at the SDKMessage level
    default:
      break;
  }
}

// Check if Claude Code CLI is available on this system
export function isClaudeCodeAvailable(): boolean {
  try {
    execSync('claude --version', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
