// File Builder IPC Handler - Handles file operations and AI app builder streaming
// Guided by the Holy Spirit

import { ipcMain, BrowserWindow } from 'electron';
import { fileSystemService } from '../services/fileSystem';
import { appBuilderTools, executeFileToolCall, generateAppBuilderSystemPrompt } from '../services/aiFileTools';
import { langChainService, ChatMessage, StreamEvent, ToolCall, ConversationTurn } from '../services/langchain';
import { ideasService } from '../services/ideas';
import { logger, logStreamEvent, logToolExecution, logApiError } from '../services/logger';
import Anthropic from '@anthropic-ai/sdk';

// IPC channel names for file builder operations
export const FILE_BUILDER_CHANNELS = {
  // File CRUD operations
  FILES_CREATE: 'files:create',
  FILES_READ: 'files:read',
  FILES_UPDATE: 'files:update',
  FILES_DELETE: 'files:delete',
  FILES_LIST: 'files:list',
  FILES_GET_ENTRY: 'files:get-entry',
  FILES_SET_ENTRY: 'files:set-entry',
  FILES_MODIFY_LINES: 'files:modify-lines',
  // AI app builder stream
  APP_BUILDER_STREAM: 'ai:app-builder-stream',
  APP_BUILDER_STREAM_EVENT: 'ai:app-builder-stream-event',
  APP_BUILDER_STREAM_END: 'ai:app-builder-stream-end',
  APP_BUILDER_STREAM_ERROR: 'ai:app-builder-stream-error'
} as const;

// Safety limit for tool rounds
const MAX_TOOL_ROUNDS = 1000;

// Register all file builder IPC handlers
export function registerFileBuilderHandlers(): void {
  logger.info('[FileBuilder-IPC] Registering file builder handlers');

  // Create a new file
  ipcMain.handle(
    FILE_BUILDER_CHANNELS.FILES_CREATE,
    async (_event, ideaId: string, filePath: string, content: string, isEntryFile?: boolean) => {
      logger.info('[FileBuilder-IPC] Create file request', { ideaId, filePath });
      return fileSystemService.createFile(ideaId, filePath, content, isEntryFile ?? false);
    }
  );

  // Read a file
  ipcMain.handle(
    FILE_BUILDER_CHANNELS.FILES_READ,
    async (_event, ideaId: string, filePath: string) => {
      logger.debug('[FileBuilder-IPC] Read file request', { ideaId, filePath });
      return fileSystemService.getFileByPath(ideaId, filePath);
    }
  );

  // Update a file
  ipcMain.handle(
    FILE_BUILDER_CHANNELS.FILES_UPDATE,
    async (_event, ideaId: string, filePath: string, content: string) => {
      logger.info('[FileBuilder-IPC] Update file request', { ideaId, filePath });
      return fileSystemService.updateFile(ideaId, filePath, content);
    }
  );

  // Delete a file
  ipcMain.handle(
    FILE_BUILDER_CHANNELS.FILES_DELETE,
    async (_event, ideaId: string, filePath: string) => {
      logger.info('[FileBuilder-IPC] Delete file request', { ideaId, filePath });
      fileSystemService.deleteFile(ideaId, filePath);
      return { success: true };
    }
  );

  // List all files for an idea
  ipcMain.handle(
    FILE_BUILDER_CHANNELS.FILES_LIST,
    async (_event, ideaId: string) => {
      logger.debug('[FileBuilder-IPC] List files request', { ideaId });
      return fileSystemService.listFiles(ideaId);
    }
  );

  // Get entry file
  ipcMain.handle(
    FILE_BUILDER_CHANNELS.FILES_GET_ENTRY,
    async (_event, ideaId: string) => {
      logger.debug('[FileBuilder-IPC] Get entry file request', { ideaId });
      return fileSystemService.getEntryFile(ideaId);
    }
  );

  // Set entry file
  ipcMain.handle(
    FILE_BUILDER_CHANNELS.FILES_SET_ENTRY,
    async (_event, ideaId: string, filePath: string) => {
      logger.info('[FileBuilder-IPC] Set entry file request', { ideaId, filePath });
      return fileSystemService.setEntryFile(ideaId, filePath);
    }
  );

  // Modify specific lines in a file
  ipcMain.handle(
    FILE_BUILDER_CHANNELS.FILES_MODIFY_LINES,
    async (_event, ideaId: string, filePath: string, startLine: number, endLine: number, newContent: string) => {
      logger.info('[FileBuilder-IPC] Modify file lines request', { ideaId, filePath, startLine, endLine });
      return fileSystemService.modifyFileLines(ideaId, filePath, startLine, endLine, newContent);
    }
  );

  // App builder AI stream with file tools
  ipcMain.handle(
    FILE_BUILDER_CHANNELS.APP_BUILDER_STREAM,
    async (event, ideaId: string, userMessages: ChatMessage[]): Promise<void> => {
      const webContents = event.sender;
      const window = BrowserWindow.fromWebContents(webContents);

      logger.info('[AppBuilder] Stream request received', { ideaId, messageCount: userMessages.length });

      if (!window) {
        logger.error('[AppBuilder] Could not find browser window');
        throw new Error('Could not find browser window');
      }

      try {
        // Get the idea
        const idea = ideasService.getIdea(ideaId);
        if (!idea) {
          logger.error('[AppBuilder] Idea not found', { ideaId });
          throw new Error(`Idea ${ideaId} not found`);
        }

        // Get existing files for context
        const existingFiles = fileSystemService.listFiles(ideaId).map(f => ({
          filePath: f.filePath,
          fileType: f.fileType,
          isEntryFile: f.isEntryFile,
          lineCount: f.content.split('\n').length
        }));

        // Generate system prompt
        const systemPrompt = generateAppBuilderSystemPrompt(idea.title, existingFiles);

        // Build messages array with system prompt
        const messages: ChatMessage[] = [
          { role: 'system', content: systemPrompt },
          ...userMessages
        ];

        logger.info('[AppBuilder] Starting agentic stream', { totalMessages: messages.length });

        // Process the stream with agentic tool loop
        await processAppBuilderStream(
          webContents,
          ideaId,
          messages,
          appBuilderTools
        );

        logger.info('[AppBuilder] Stream completed successfully');
        webContents.send(FILE_BUILDER_CHANNELS.APP_BUILDER_STREAM_END);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        logger.error('[AppBuilder] Stream error', { error: errorMessage });
        logApiError('AppBuilder', error);
        webContents.send(FILE_BUILDER_CHANNELS.APP_BUILDER_STREAM_ERROR, errorMessage);
      }
    }
  );
}

// Stream result structure for tracking state
interface StreamResult {
  stopReason: string;
  toolCalls: ToolCall[];
  assistantContent: Anthropic.ContentBlock[];
  textContent: string;
  thinkingContent: string;
  thinkingSignature?: string;
}

// Process the agentic stream with tool execution loop
async function processAppBuilderStream(
  webContents: Electron.WebContents,
  ideaId: string,
  initialMessages: ChatMessage[],
  tools: Anthropic.Tool[]
): Promise<void> {
  logger.info('[AppBuilder-Agentic] Starting agentic loop');

  // Track all conversation turns for full context
  const conversationTurns: ConversationTurn[] = [];

  // First round
  const firstResult = await streamFirstRound(webContents, initialMessages, tools);

  logger.info('[AppBuilder-Agentic] First round completed', {
    stopReason: firstResult.stopReason,
    toolCallCount: firstResult.toolCalls.length
  });

  // If no tool calls, we're done
  if (firstResult.stopReason !== 'tool_use' || firstResult.toolCalls.length === 0) {
    logger.info('[AppBuilder-Agentic] No tool calls, ending loop');
    return;
  }

  // Execute tool calls
  const toolResults = await executeToolCallsAndNotify(
    webContents,
    ideaId,
    firstResult.toolCalls
  );

  // Add first turn to conversation history
  conversationTurns.push({
    assistantContent: firstResult.assistantContent,
    toolResults: toolResults
  });

  // Continue with tool results
  await processContinuationRounds(
    webContents,
    ideaId,
    initialMessages,
    conversationTurns,
    tools,
    1
  );
}

// Stream the first round
async function streamFirstRound(
  webContents: Electron.WebContents,
  messages: ChatMessage[],
  tools: Anthropic.Tool[]
): Promise<StreamResult> {
  const result: StreamResult = {
    stopReason: 'end_turn',
    toolCalls: [],
    assistantContent: [],
    textContent: '',
    thinkingContent: '',
    thinkingSignature: undefined
  };

  for await (const streamEvent of langChainService.chatStreamWithTools(messages, tools)) {
    // Log stream events (skip verbose tool_input_delta)
    if (streamEvent.type !== 'tool_input_delta') {
      logStreamEvent('AppBuilder-FirstRound', streamEvent.type,
        streamEvent.type === 'tool_start' ? { toolName: streamEvent.toolName } :
        streamEvent.type === 'done' ? { stopReason: streamEvent.stopReason } :
        undefined
      );
    }

    // Send event to frontend
    webContents.send(FILE_BUILDER_CHANNELS.APP_BUILDER_STREAM_EVENT, streamEvent);

    // Collect stream event data
    collectStreamEventData(streamEvent, result);
  }

  // Build assistant content blocks
  buildAssistantContentBlocks(result);

  return result;
}

// Process continuation rounds after tool execution
async function processContinuationRounds(
  webContents: Electron.WebContents,
  ideaId: string,
  baseMessages: ChatMessage[],
  conversationTurns: ConversationTurn[],
  tools: Anthropic.Tool[],
  roundNumber: number
): Promise<void> {
  logger.info(`[AppBuilder-Continuation] Starting round ${roundNumber + 1}`);

  if (roundNumber >= MAX_TOOL_ROUNDS) {
    logger.warn('[AppBuilder-Continuation] Max tool rounds reached');
    return;
  }

  // Stream continuation response with full history
  const result = await streamContinuationWithFullHistory(
    webContents,
    baseMessages,
    conversationTurns,
    tools
  );

  logger.info(`[AppBuilder-Continuation] Round ${roundNumber + 1} completed`, {
    stopReason: result.stopReason,
    toolCallCount: result.toolCalls.length
  });

  // If no more tool calls, we're done
  if (result.stopReason !== 'tool_use' || result.toolCalls.length === 0) {
    logger.info('[AppBuilder-Continuation] No more tool calls, ending loop');
    return;
  }

  // Execute new tool calls
  const newToolResults = await executeToolCallsAndNotify(
    webContents,
    ideaId,
    result.toolCalls
  );

  // Add this turn to conversation history
  conversationTurns.push({
    assistantContent: result.assistantContent,
    toolResults: newToolResults
  });

  // Recursively continue
  await processContinuationRounds(
    webContents,
    ideaId,
    baseMessages,
    conversationTurns,
    tools,
    roundNumber + 1
  );
}

// Stream continuation using full conversation history
async function streamContinuationWithFullHistory(
  webContents: Electron.WebContents,
  baseMessages: ChatMessage[],
  conversationTurns: ConversationTurn[],
  tools: Anthropic.Tool[]
): Promise<StreamResult> {
  const result: StreamResult = {
    stopReason: 'end_turn',
    toolCalls: [],
    assistantContent: [],
    textContent: '',
    thinkingContent: '',
    thinkingSignature: undefined
  };

  for await (const streamEvent of langChainService.continueWithFullHistory(
    baseMessages,
    conversationTurns,
    tools
  )) {
    if (streamEvent.type !== 'tool_input_delta') {
      logStreamEvent('AppBuilder-Continuation', streamEvent.type,
        streamEvent.type === 'tool_start' ? { toolName: streamEvent.toolName } :
        streamEvent.type === 'done' ? { stopReason: streamEvent.stopReason } :
        undefined
      );
    }

    webContents.send(FILE_BUILDER_CHANNELS.APP_BUILDER_STREAM_EVENT, streamEvent);
    collectStreamEventData(streamEvent, result);
  }

  buildAssistantContentBlocks(result);

  return result;
}

// Collect data from stream events
function collectStreamEventData(streamEvent: StreamEvent, result: StreamResult): void {
  switch (streamEvent.type) {
    case 'thinking':
      result.thinkingContent += streamEvent.content;
      break;

    case 'thinking_done':
      if (streamEvent.signature) {
        result.thinkingSignature = streamEvent.signature;
      }
      break;

    case 'text':
      result.textContent += streamEvent.content;
      break;

    case 'tool_use':
      result.toolCalls.push(streamEvent.toolCall);
      break;

    case 'done':
      result.stopReason = streamEvent.stopReason;
      if (streamEvent.thinkingData?.signature) {
        result.thinkingSignature = streamEvent.thinkingData.signature;
      }
      break;
  }
}

// Build Anthropic content blocks from collected data
function buildAssistantContentBlocks(result: StreamResult): void {
  result.assistantContent = [];

  // Add thinking block if present
  if (result.thinkingContent && result.thinkingSignature) {
    result.assistantContent.push({
      type: 'thinking',
      thinking: result.thinkingContent,
      signature: result.thinkingSignature
    } as unknown as Anthropic.ThinkingBlock);
  }

  // Add text block
  if (result.textContent) {
    result.assistantContent.push({
      type: 'text',
      text: result.textContent
    } as Anthropic.TextBlock);
  }

  // Add tool use blocks
  for (const tc of result.toolCalls) {
    result.assistantContent.push({
      type: 'tool_use',
      id: tc.id,
      name: tc.name,
      input: tc.input
    } as Anthropic.ToolUseBlock);
  }
}

// Execute tool calls and send results to frontend
async function executeToolCallsAndNotify(
  webContents: Electron.WebContents,
  ideaId: string,
  toolCalls: ToolCall[]
): Promise<Array<{ tool_use_id: string; content: string }>> {
  const results: Array<{ tool_use_id: string; content: string }> = [];

  for (const tc of toolCalls) {
    logger.info('[AppBuilder-ToolExecution] Executing tool', {
      toolName: tc.name,
      toolId: tc.id
    });

    const result = await executeFileToolCall(ideaId, tc.name, tc.input);

    logger.info('[AppBuilder-ToolExecution] Tool completed', {
      toolName: tc.name,
      success: result.success
    });

    logToolExecution('AppBuilder', tc.name, tc.input, result);

    results.push({
      tool_use_id: tc.id,
      content: JSON.stringify(result)
    });

    // Send tool result event to frontend
    webContents.send(FILE_BUILDER_CHANNELS.APP_BUILDER_STREAM_EVENT, {
      type: 'tool_result',
      toolId: tc.id,
      toolName: tc.name,
      result
    });
  }

  return results;
}
