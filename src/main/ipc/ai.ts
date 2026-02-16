// AI IPC Handler - Streams AI responses via Claude Code Agent SDK subprocess
// Claude Code manages its own conversation context via session IDs
// Tools are exposed as an in-process MCP server

import { ipcMain, BrowserWindow } from 'electron';
import { streamClaudeCode, isClaudeCodeAvailable, StreamEvent } from '../services/claudeCode';
import { createFishWalletMcpServer, ToolCallEvent } from '../services/mcpToolServer';
import { generateSynthesisSystemPrompt } from '../services/aiTools';
import { ideasService } from '../services/ideas';
import { databaseService } from '../services/database';
import { logger, logApiError } from '../services/logger';
import { formatErrorsForAI, clearPanelErrors, hasPanelErrors } from '../services/panelErrors';
import { snapshotsService } from '../services/snapshots';
import { branchesService } from '../services/branches';
import { SNAPSHOT_CHANNELS } from './snapshots';

// IPC channel names for AI operations
export const AI_CHANNELS = {
  // Synthesis-specific channels
  SYNTHESIS_STREAM: 'ai:synthesis-stream',
  SYNTHESIS_STREAM_EVENT: 'ai:synthesis-stream-event',
  SYNTHESIS_STREAM_END: 'ai:synthesis-stream-end',
  SYNTHESIS_STREAM_ERROR: 'ai:synthesis-stream-error',
  // Abort channel
  SYNTHESIS_ABORT: 'ai:synthesis-abort',
  // Availability check
  CHECK_AVAILABLE: 'ai:check-available'
} as const;

// Track active abort controllers per idea
const activeAbortControllers = new Map<string, AbortController>();

// Maximum number of error fixing rounds to prevent infinite loops
const MAX_ERROR_FIX_ROUNDS = 3;

// Maximum retries when Claude Code subprocess exits with code 1
const MAX_EXIT_CODE_1_RETRIES = 2;

// Delay to wait for panel errors to be reported (ms)
const PANEL_ERROR_CHECK_DELAY = 1500;

// Register all AI-related IPC handlers
export function registerAIHandlers(): void {
  logger.info('[AI-IPC] Registering AI handlers');

  // Check if Claude Code CLI is available
  ipcMain.handle(AI_CHANNELS.CHECK_AVAILABLE, (): boolean => {
    return isClaudeCodeAvailable();
  });

  // Abort an active synthesis stream
  ipcMain.handle(AI_CHANNELS.SYNTHESIS_ABORT, async (_event, ideaId: string): Promise<{ success: boolean }> => {
    logger.info('[AI-IPC] Abort request received for idea:', ideaId);
    const controller = activeAbortControllers.get(ideaId);
    if (controller) {
      controller.abort();
    }
    return { success: true };
  });

  // Synthesis stream — agentic loop via Claude Code subprocess + MCP tools
  ipcMain.handle(
    AI_CHANNELS.SYNTHESIS_STREAM,
    async (event, ideaId: string, messageText: string): Promise<void> => {
      const webContents = event.sender;
      const window = BrowserWindow.fromWebContents(webContents);

      logger.info('[Synthesis] Stream request received', { ideaId, messageLength: messageText.length });

      if (!window) {
        logger.error('[Synthesis] Could not find browser window');
        throw new Error('Could not find browser window');
      }

      try {
        // Get the idea and current synthesis
        const idea = ideasService.getIdea(ideaId);
        if (!idea) {
          logger.error('[Synthesis] Idea not found', { ideaId });
          throw new Error(`Idea ${ideaId} not found`);
        }

        // Resolve the active branch's folder path for Claude Code's cwd
        const branchFolderPath = branchesService.getActiveBranchFolderPath(ideaId);

        // Generate system prompt append with current synthesis context
        const systemPromptAppend = generateSynthesisSystemPrompt(
          idea.title,
          idea.synthesisContent ?? null
        );

        // Get Claude session ID from conversation for session resumption
        let sessionId: string | null = null;
        if (idea.conversationId) {
          sessionId = databaseService.getConversationSessionId(idea.conversationId);
          logger.info('[Synthesis] Session lookup', {
            conversationId: idea.conversationId,
            hasSessionId: !!sessionId
          });
        }

        // Create MCP server with all tools for this idea
        const { server: mcpServer, events: mcpEvents } = createFishWalletMcpServer(ideaId);

        // Track tools called for snapshot creation
        const allToolsCalled = new Set<string>();

        // Wire up MCP tool call events → renderer side effects
        mcpEvents.on('toolCall', ({ toolName, result }: ToolCallEvent) => {
          allToolsCalled.add(toolName);

          // Forward tool result to renderer for display
          webContents.send(AI_CHANNELS.SYNTHESIS_STREAM_EVENT, {
            type: 'tool_result',
            toolName,
            result
          });

          // Note proposal → renderer shows approval UI
          if (toolName === 'propose_note' && result.success && result.data) {
            const data = result.data as { type?: string; proposal?: unknown };
            if (data?.type === 'note_proposal' && data?.proposal) {
              webContents.send(AI_CHANNELS.SYNTHESIS_STREAM_EVENT, {
                type: 'note_proposal',
                proposal: data.proposal
              });
            }
          }
        });

        // Check if there's a stale abort controller from a previous failed request
        const existingController = activeAbortControllers.get(ideaId);
        if (existingController) {
          logger.warn('[Synthesis] Found existing abort controller, cleaning up', {
            ideaId,
            wasAborted: existingController.signal.aborted
          });
          activeAbortControllers.delete(ideaId);
        }

        // Create abort controller for this stream
        const abortController = new AbortController();
        activeAbortControllers.set(ideaId, abortController);

        try {
          // Stream the response via Claude Code subprocess with retry on exit code 1
          let lastError: Error | null = null;
          for (let attempt = 0; attempt <= MAX_EXIT_CODE_1_RETRIES; attempt++) {
            try {
              await streamClaudeCode({
                prompt: messageText,
                systemPromptAppend,
                sessionId,
                mcpServer,
                abortController,
                projectPath: branchFolderPath || null,
                onEvent: (streamEvent: StreamEvent) => {
                  webContents.send(AI_CHANNELS.SYNTHESIS_STREAM_EVENT, streamEvent);
                },
                onSessionId: (newSessionId: string) => {
                  sessionId = newSessionId;
                  if (idea.conversationId) {
                    databaseService.updateConversationSessionId(idea.conversationId, newSessionId);
                    logger.info('[Synthesis] Session ID saved', { sessionId: newSessionId });
                  }
                }
              });
              lastError = null;
              break; // Success — exit retry loop
            } catch (err) {
              const msg = err instanceof Error ? err.message : '';
              if (msg.includes('exited with code 1') && attempt < MAX_EXIT_CODE_1_RETRIES && !abortController.signal.aborted) {
                logger.warn('[Synthesis] Claude Code exited with code 1, retrying', {
                  attempt: attempt + 1,
                  maxRetries: MAX_EXIT_CODE_1_RETRIES,
                  hadSessionId: !!sessionId
                });
                // Clear session ID — start fresh on retry
                sessionId = null;
                if (idea.conversationId) {
                  databaseService.updateConversationSessionId(idea.conversationId, '');
                }
                // Brief pause before retry
                await new Promise(resolve => setTimeout(resolve, 1000));
                continue;
              }
              // Not retryable or out of retries — rethrow
              throw err;
            }
          }
          if (lastError) throw lastError;

          // Panel error fix loop: detect runtime errors and ask Claude to fix them
          if (!abortController.signal.aborted) {
            for (let errorRound = 0; errorRound < MAX_ERROR_FIX_ROUNDS; errorRound++) {
              if (abortController.signal.aborted) break;

              // Wait for panel to render and report errors
              await new Promise(resolve => setTimeout(resolve, PANEL_ERROR_CHECK_DELAY));

              if (abortController.signal.aborted || !hasPanelErrors(ideaId)) break;

              const panelErrorMessage = formatErrorsForAI(ideaId);
              if (!panelErrorMessage) break;
              clearPanelErrors(ideaId);

              logger.info('[PanelErrorFix] Starting fix round', { errorRound: errorRound + 1 });

              // Signal renderer to show error as user message
              webContents.send(AI_CHANNELS.SYNTHESIS_STREAM_EVENT, {
                type: 'error_user_message',
                content: panelErrorMessage
              });

              // Send error to same session — Claude Code has full context of what it did
              // Retry on exit code 1 (same logic as main query)
              for (let attempt = 0; attempt <= MAX_EXIT_CODE_1_RETRIES; attempt++) {
                try {
                  await streamClaudeCode({
                    prompt: panelErrorMessage,
                    systemPromptAppend,
                    sessionId,
                    mcpServer,
                    abortController,
                    projectPath: branchFolderPath || null,
                    onEvent: (streamEvent: StreamEvent) => {
                      webContents.send(AI_CHANNELS.SYNTHESIS_STREAM_EVENT, streamEvent);
                    },
                    onSessionId: (newSessionId: string) => {
                      sessionId = newSessionId;
                      if (idea.conversationId) {
                        databaseService.updateConversationSessionId(idea.conversationId, newSessionId);
                      }
                    }
                  });
                  break;
                } catch (err) {
                  const msg = err instanceof Error ? err.message : '';
                  if (msg.includes('exited with code 1') && attempt < MAX_EXIT_CODE_1_RETRIES && !abortController.signal.aborted) {
                    logger.warn('[PanelErrorFix] Claude Code exited with code 1, retrying', { attempt: attempt + 1 });
                    sessionId = null;
                    if (idea.conversationId) {
                      databaseService.updateConversationSessionId(idea.conversationId, '');
                    }
                    await new Promise(resolve => setTimeout(resolve, 1000));
                    continue;
                  }
                  throw err;
                }
              }
            }
          }

          // Always create a version snapshot after AI turns
          // Claude Code's built-in file tools bypass our MCP server, so we can't
          // detect file modifications — just snapshot every completed turn
          if (!abortController.signal.aborted) {
            try {
              const snapshot = snapshotsService.createSnapshot(ideaId, [...allToolsCalled]);
              webContents.send(SNAPSHOT_CHANNELS.CREATED, {
                ideaId,
                versionNumber: snapshot.versionNumber,
                snapshotId: snapshot.id
              });
            } catch (snapshotError) {
              logger.error('[Synthesis] Failed to create snapshot', { error: snapshotError });
            }
          }

          // Signal stream end
          if (abortController.signal.aborted) {
            logger.info('[Synthesis] Stream was aborted');
          } else {
            logger.info('[Synthesis] Stream completed successfully');
          }
          webContents.send(AI_CHANNELS.SYNTHESIS_STREAM_END);
        } finally {
          activeAbortControllers.delete(ideaId);
        }
      } catch (error) {
        activeAbortControllers.delete(ideaId);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        logger.error('[Synthesis] Stream error', {
          error: errorMessage,
          stack: error instanceof Error ? error.stack : undefined
        });
        logApiError('Synthesis', error);
        webContents.send(AI_CHANNELS.SYNTHESIS_STREAM_ERROR, errorMessage);
      }
    }
  );
}
