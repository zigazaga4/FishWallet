// Voice Agent IPC Handler — bridges renderer to the Haiku voice navigation agent
// Uses Claude Code Agent SDK with claude-haiku-4-5-20251001 model
// Each idea/conversation gets its own voice agent session ID

import { ipcMain, BrowserWindow } from 'electron';
import { streamClaudeCode, StreamEvent } from '../services/claudeCode';
import { createVoiceAgentMcpServer } from '../services/voiceAgentMcpServer';
import { logger } from '../services/logger';

// IPC channel names for voice agent
export const VOICE_AGENT_CHANNELS = {
  RUN: 'voice-agent:run',
  EVENT: 'voice-agent:event',
  END: 'voice-agent:end',
  ERROR: 'voice-agent:error',
  ABORT: 'voice-agent:abort'
} as const;

// Voice agent session IDs per idea (in memory — no persistence needed)
const voiceAgentSessions = new Map<string, string>();

// Active abort controllers per idea
const activeAbortControllers = new Map<string, AbortController>();

// Voice agent system prompt
const VOICE_AGENT_SYSTEM_PROMPT = `You are a voice-controlled app navigation assistant. The user speaks commands and you interact with the app running in a preview panel.

Your job is to:
1. Read the page to understand what's currently visible
2. Find the specific elements the user is referring to
3. Interact with those elements (click buttons, type text, scroll, navigate)
4. Briefly confirm what you did

Rules:
- Always start by reading the page with read_page to understand the current state
- Use find_elements with CSS selectors to locate specific elements
- Be precise with selectors — use IDs, classes, text content, or roles
- After clicking or typing, wait briefly then read the page again to confirm the action worked
- Keep your text responses very short (1-2 sentences max) — the user is voice-controlling, not reading essays
- If you can't find what the user asked for, say so briefly and describe what you see instead`;

// Register voice agent IPC handlers
export function registerVoiceAgentHandlers(): void {
  logger.info('[VoiceAgent-IPC] Registering voice agent handlers');

  // Run a voice agent command
  ipcMain.handle(
    VOICE_AGENT_CHANNELS.RUN,
    async (event, ideaId: string, command: string): Promise<void> => {
      const webContents = event.sender;
      const window = BrowserWindow.fromWebContents(webContents);

      logger.info('[VoiceAgent] Run request', { ideaId, commandLength: command.length });

      if (!window) {
        webContents.send(VOICE_AGENT_CHANNELS.ERROR, 'Could not find browser window');
        return;
      }

      // Clean up any stale abort controller
      const existingController = activeAbortControllers.get(ideaId);
      if (existingController) {
        existingController.abort();
        activeAbortControllers.delete(ideaId);
      }

      const abortController = new AbortController();
      activeAbortControllers.set(ideaId, abortController);

      // Get or create voice agent session ID for this idea
      let sessionId = voiceAgentSessions.get(ideaId) || null;

      try {
        // Create MCP server with DOM interaction tools
        const mcpServer = createVoiceAgentMcpServer(window);

        await streamClaudeCode({
          prompt: command,
          systemPromptAppend: VOICE_AGENT_SYSTEM_PROMPT,
          sessionId,
          mcpServer,
          abortController,
          model: 'claude-haiku-4-5-20251001',
          onEvent: (streamEvent: StreamEvent) => {
            // Forward relevant events to renderer
            // Filter to only text and tool events (skip thinking for speed)
            if (['text', 'tool_start', 'tool_use', 'tool_result', 'done'].includes(streamEvent.type)) {
              webContents.send(VOICE_AGENT_CHANNELS.EVENT, streamEvent);
            }
          },
          onSessionId: (newSessionId: string) => {
            sessionId = newSessionId;
            voiceAgentSessions.set(ideaId, newSessionId);
            logger.info('[VoiceAgent] Session ID saved', { ideaId, sessionId: newSessionId });
          }
        });

        webContents.send(VOICE_AGENT_CHANNELS.END);
        logger.info('[VoiceAgent] Command completed', { ideaId });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error('[VoiceAgent] Error', { ideaId, error: msg });

        // On exit code 1, clear the session to start fresh next time
        if (msg.includes('exited with code 1')) {
          voiceAgentSessions.delete(ideaId);
        }

        webContents.send(VOICE_AGENT_CHANNELS.ERROR, msg);
      } finally {
        activeAbortControllers.delete(ideaId);
      }
    }
  );

  // Abort an active voice agent command
  ipcMain.handle(
    VOICE_AGENT_CHANNELS.ABORT,
    async (_event, ideaId: string): Promise<{ success: boolean }> => {
      logger.info('[VoiceAgent] Abort request', { ideaId });
      const controller = activeAbortControllers.get(ideaId);
      if (controller) {
        controller.abort();
        activeAbortControllers.delete(ideaId);
      }
      return { success: true };
    }
  );
}
