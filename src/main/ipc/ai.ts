import { ipcMain, BrowserWindow } from 'electron';
import { langChainService, ChatMessage, LLMResponse, StreamEvent, ToolCall, ConversationTurn } from '../services/langchain';
import { getAllTools, executeToolCall, generateSynthesisSystemPrompt } from '../services/aiTools';
import { executeDependencyNodeToolCall } from '../services/aiNodeTools';
import { ideasService } from '../services/ideas';
import { dependencyNodesService } from '../services/dependencyNodes';
import { logger, logStreamEvent, logToolExecution, logAssistantContent, logApiError } from '../services/logger';
import { formatErrorsForAI, clearPanelErrors, hasPanelErrors } from '../services/panelErrors';
import Anthropic from '@anthropic-ai/sdk';

// IPC channel names for AI operations
export const AI_CHANNELS = {
  INITIALIZE: 'ai:initialize',
  CHAT: 'ai:chat',
  CHAT_STREAM: 'ai:chat-stream',
  CHAT_STREAM_CHUNK: 'ai:chat-stream-chunk',
  CHAT_STREAM_END: 'ai:chat-stream-end',
  CHAT_STREAM_ERROR: 'ai:chat-stream-error',
  IS_INITIALIZED: 'ai:is-initialized',
  CLEAR: 'ai:clear',
  // Synthesis-specific channels
  SYNTHESIS_STREAM: 'ai:synthesis-stream',
  SYNTHESIS_STREAM_EVENT: 'ai:synthesis-stream-event',
  SYNTHESIS_STREAM_END: 'ai:synthesis-stream-end',
  SYNTHESIS_STREAM_ERROR: 'ai:synthesis-stream-error',
  // Abort channel
  SYNTHESIS_ABORT: 'ai:synthesis-abort'
} as const;

// Track active streams per idea for abort functionality
const activeStreams = new Map<string, { aborted: boolean }>();

// Check if stream is aborted
function isStreamAborted(ideaId: string): boolean {
  const stream = activeStreams.get(ideaId);
  return stream?.aborted === true;
}

// Mark stream as aborted
function abortStream(ideaId: string): void {
  const stream = activeStreams.get(ideaId);
  if (stream) {
    stream.aborted = true;
    logger.info('[AI-IPC] Stream aborted for idea:', ideaId);
  }
}

// Start tracking a stream
function startStreamTracking(ideaId: string): void {
  activeStreams.set(ideaId, { aborted: false });
}

// Stop tracking a stream
function stopStreamTracking(ideaId: string): void {
  activeStreams.delete(ideaId);
}

// Safety limit for tool rounds (effectively unlimited)
const MAX_TOOL_ROUNDS = 1000;

// Maximum number of error fixing rounds to prevent infinite loops
const MAX_ERROR_FIX_ROUNDS = 3;

// Delay to wait for panel errors to be reported (ms)
const PANEL_ERROR_CHECK_DELAY = 1500;

// Register all AI-related IPC handlers
export function registerAIHandlers(): void {
  logger.info('[AI-IPC] Registering AI handlers');

  // Initialize the LangChain service with API key
  ipcMain.handle(AI_CHANNELS.INITIALIZE, async (_event, apiKey: string): Promise<{ success: boolean; error?: string }> => {
    logger.info('[AI-IPC] Initialize request received');
    try {
      langChainService.initialize(apiKey);
      logger.info('[AI-IPC] LangChain service initialized successfully');
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      logger.error('[AI-IPC] Initialize failed:', errorMessage);
      return { success: false, error: errorMessage };
    }
  });

  // Check if the service is initialized
  ipcMain.handle(AI_CHANNELS.IS_INITIALIZED, (): boolean => {
    const isInit = langChainService.isInitialized();
    logger.debug('[AI-IPC] Is initialized check:', isInit);
    return isInit;
  });

  // Send chat message and get response
  ipcMain.handle(AI_CHANNELS.CHAT, async (_event, messages: ChatMessage[]): Promise<LLMResponse> => {
    logger.info('[AI-IPC] Chat request received', { messageCount: messages.length });
    return langChainService.chat(messages);
  });

  // Send chat message and stream response
  ipcMain.handle(AI_CHANNELS.CHAT_STREAM, async (event, messages: ChatMessage[]): Promise<void> => {
    const webContents = event.sender;
    const window = BrowserWindow.fromWebContents(webContents);

    if (!window) {
      throw new Error('Could not find browser window');
    }

    try {
      for await (const chunk of langChainService.chatStream(messages)) {
        webContents.send(AI_CHANNELS.CHAT_STREAM_CHUNK, chunk);
      }
      webContents.send(AI_CHANNELS.CHAT_STREAM_END);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      webContents.send(AI_CHANNELS.CHAT_STREAM_ERROR, errorMessage);
    }
  });

  // Clear the service
  ipcMain.handle(AI_CHANNELS.CLEAR, (): void => {
    logger.info('[AI-IPC] Clear request received');
    langChainService.clear();
  });

  // Abort an active synthesis stream
  ipcMain.handle(AI_CHANNELS.SYNTHESIS_ABORT, async (_event, ideaId: string): Promise<{ success: boolean }> => {
    logger.info('[AI-IPC] Abort request received for idea:', ideaId);
    abortStream(ideaId);
    return { success: true };
  });

  // Synthesis stream with tools - handles the agentic loop
  ipcMain.handle(
    AI_CHANNELS.SYNTHESIS_STREAM,
    async (event, ideaId: string, userMessages: ChatMessage[]): Promise<void> => {
      const webContents = event.sender;
      const window = BrowserWindow.fromWebContents(webContents);

      logger.info('[Synthesis] Stream request received', { ideaId, messageCount: userMessages.length });

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

        logger.debug('[Synthesis] Idea found', {
          ideaId,
          title: idea.title,
          hasSynthesis: !!idea.synthesisContent
        });

        // Generate system prompt with current synthesis
        const systemPrompt = generateSynthesisSystemPrompt(
          idea.title,
          idea.synthesisContent ?? null
        );

        logger.debug('[Synthesis] System prompt generated', {
          promptLength: systemPrompt.length
        });

        // Build messages array with system prompt
        const messages: ChatMessage[] = [
          { role: 'system', content: systemPrompt },
          ...userMessages
        ];

        logger.info('[Synthesis] Starting agentic stream', {
          totalMessages: messages.length
        });

        // Start tracking this stream for abort functionality
        startStreamTracking(ideaId);

        try {
          // Process the stream with agentic tool loop (includes all tools)
          await processAgenticStream(
            webContents,
            ideaId,
            messages,
            getAllTools(),
            0 // errorFixRound - starts at 0
          );

          // Check if aborted
          if (isStreamAborted(ideaId)) {
            logger.info('[Synthesis] Stream was aborted');
            webContents.send(AI_CHANNELS.SYNTHESIS_STREAM_END);
          } else {
            logger.info('[Synthesis] Stream completed successfully');
            webContents.send(AI_CHANNELS.SYNTHESIS_STREAM_END);
          }
        } finally {
          // Always clean up stream tracking
          stopStreamTracking(ideaId);
        }
      } catch (error) {
        stopStreamTracking(ideaId);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        logger.error('[Synthesis] Stream error', { error: errorMessage, stack: error instanceof Error ? error.stack : undefined });
        logApiError('Synthesis', error);
        webContents.send(AI_CHANNELS.SYNTHESIS_STREAM_ERROR, errorMessage);
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
  inputTokens: number;
  outputTokens: number;
}

// Process the agentic stream with tool execution loop
// This maintains the FULL conversation history across all rounds
// errorFixRound tracks how many times we've tried to fix panel errors
async function processAgenticStream(
  webContents: Electron.WebContents,
  ideaId: string,
  initialMessages: ChatMessage[],
  tools: Anthropic.ToolUnion[],
  errorFixRound: number = 0
): Promise<void> {
  logger.info('[Agentic] Starting agentic loop', { errorFixRound });

  // Check for abort before starting
  if (isStreamAborted(ideaId)) {
    logger.info('[Agentic] Stream aborted before starting');
    return;
  }

  // Track all conversation turns for full context
  const conversationTurns: ConversationTurn[] = [];

  // First round: use chatStreamWithTools
  const firstResult = await streamFirstRound(webContents, ideaId, initialMessages, tools);

  // Check for abort after first round
  if (isStreamAborted(ideaId)) {
    logger.info('[Agentic] Stream aborted after first round');
    return;
  }

  logger.info('[Agentic] First round completed', {
    stopReason: firstResult.stopReason,
    toolCallCount: firstResult.toolCalls.length,
    hasThinking: !!firstResult.thinkingContent,
    hasSignature: !!firstResult.thinkingSignature,
    textLength: firstResult.textContent.length,
    contentBlockTypes: firstResult.assistantContent.map(b => b.type)
  });

  // If no tool calls, check for panel errors before ending
  if (firstResult.stopReason !== 'tool_use' || firstResult.toolCalls.length === 0) {
    logger.info('[Agentic] No tool calls, checking for panel errors before ending');
    await checkAndHandlePanelErrors(
      webContents,
      ideaId,
      initialMessages,
      tools,
      errorFixRound
    );
    return;
  }

  // Check for abort before executing tools
  if (isStreamAborted(ideaId)) {
    logger.info('[Agentic] Stream aborted before tool execution');
    return;
  }

  // Execute tool calls
  logger.info('[Agentic] Executing tool calls', {
    tools: firstResult.toolCalls.map(tc => tc.name)
  });

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

  logger.info('[Agentic] First turn added to history', {
    turnCount: conversationTurns.length,
    contentBlockTypes: firstResult.assistantContent.map(b => b.type)
  });

  // Continue with tool results - pass full conversation history
  await processContinuationRounds(
    webContents,
    ideaId,
    initialMessages,
    conversationTurns,
    tools,
    1, // round number
    errorFixRound
  );
}

// Check for panel errors and start a new agentic round to fix them if needed
async function checkAndHandlePanelErrors(
  webContents: Electron.WebContents,
  ideaId: string,
  previousMessages: ChatMessage[],
  tools: Anthropic.ToolUnion[],
  errorFixRound: number
): Promise<void> {
  // Check for abort
  if (isStreamAborted(ideaId)) {
    logger.info('[PanelErrorFix] Stream aborted, skipping error check');
    return;
  }

  // Don't check for errors if we've already tried to fix too many times
  if (errorFixRound >= MAX_ERROR_FIX_ROUNDS) {
    logger.warn('[PanelErrorFix] Max error fix rounds reached, not checking for more errors', {
      errorFixRound,
      maxRounds: MAX_ERROR_FIX_ROUNDS
    });
    return;
  }

  // Wait for panel to render and report any errors
  logger.info('[PanelErrorFix] Waiting for panel errors to be reported');
  await new Promise(resolve => setTimeout(resolve, PANEL_ERROR_CHECK_DELAY));

  // Check for abort after waiting
  if (isStreamAborted(ideaId)) {
    logger.info('[PanelErrorFix] Stream aborted during error check wait');
    return;
  }

  // Check if there are any panel errors
  if (!hasPanelErrors(ideaId)) {
    logger.info('[PanelErrorFix] No panel errors found');
    return;
  }

  // Get formatted error message for AI
  const errorMessage = formatErrorsForAI(ideaId);
  if (!errorMessage) {
    logger.info('[PanelErrorFix] No error message formatted (errors may have been cleared)');
    return;
  }

  logger.info('[PanelErrorFix] Panel errors detected, starting fix round', {
    errorFixRound: errorFixRound + 1,
    errorMessage: errorMessage.substring(0, 200) + '...'
  });

  // Clear the errors now that we're going to fix them
  clearPanelErrors(ideaId);

  // Add the error message as a new user message
  const messagesWithError: ChatMessage[] = [
    ...previousMessages,
    {
      role: 'user',
      content: errorMessage
    }
  ];

  // Start a new agentic round to fix the errors
  await processAgenticStream(
    webContents,
    ideaId,
    messagesWithError,
    tools,
    errorFixRound + 1
  );
}

// Stream the first round using chatStreamWithTools
async function streamFirstRound(
  webContents: Electron.WebContents,
  ideaId: string,
  messages: ChatMessage[],
  tools: Anthropic.ToolUnion[]
): Promise<StreamResult> {
  logger.debug('[FirstRound] Starting stream');

  const result: StreamResult = {
    stopReason: 'end_turn',
    toolCalls: [],
    assistantContent: [],
    textContent: '',
    thinkingContent: '',
    thinkingSignature: undefined,
    inputTokens: 0,
    outputTokens: 0
  };

  // Stream the response
  for await (const streamEvent of langChainService.chatStreamWithTools(messages, tools)) {
    // Log each stream event (skip tool_input_delta for verbosity, just count them)
    if (streamEvent.type === 'tool_input_delta') {
      // Log periodically to avoid spam
      if (streamEvent.partialInput && streamEvent.partialInput.length % 500 < 50) {
        logger.debug(`[FirstRound] tool_input_delta: ${streamEvent.toolName}, length=${streamEvent.partialInput.length}`);
      }
    } else {
      logStreamEvent('FirstRound', streamEvent.type,
        streamEvent.type === 'tool_start' ? { toolName: streamEvent.toolName, toolId: streamEvent.toolId } :
        streamEvent.type === 'tool_use' ? { toolName: streamEvent.toolCall.name } :
        streamEvent.type === 'done' ? { stopReason: streamEvent.stopReason } :
        streamEvent.type === 'thinking_done' ? { hasSignature: !!streamEvent.signature } :
        undefined
      );
    }

    // Send event to frontend
    webContents.send(AI_CHANNELS.SYNTHESIS_STREAM_EVENT, streamEvent);

    // Track content for building continuation
    collectStreamEventData(streamEvent, result);
  }

  logger.debug('[FirstRound] Stream ended', {
    thinkingLength: result.thinkingContent.length,
    textLength: result.textContent.length,
    toolCallCount: result.toolCalls.length,
    hasSignature: !!result.thinkingSignature
  });

  // Build assistant content blocks
  buildAssistantContentBlocks(result);

  return result;
}

// Process continuation rounds after tool execution
// This maintains full conversation history for API compliance
async function processContinuationRounds(
  webContents: Electron.WebContents,
  ideaId: string,
  baseMessages: ChatMessage[],
  conversationTurns: ConversationTurn[],
  tools: Anthropic.ToolUnion[],
  roundNumber: number,
  errorFixRound: number = 0
): Promise<void> {
  // Check for abort at start of round
  if (isStreamAborted(ideaId)) {
    logger.info('[Continuation] Stream aborted, stopping continuation rounds');
    return;
  }

  logger.info(`[Continuation] Starting round ${roundNumber + 1}`);

  if (roundNumber >= MAX_TOOL_ROUNDS) {
    logger.warn('[Continuation] Max tool rounds reached, stopping');
    return;
  }

  // Log the full conversation history being sent
  logger.debug('[Continuation] Full conversation history', {
    turnCount: conversationTurns.length,
    turns: conversationTurns.map((turn, i) => ({
      turn: i + 1,
      contentBlockTypes: turn.assistantContent.map(b => b.type),
      toolResultCount: turn.toolResults.length
    }))
  });

  // Stream continuation response with FULL conversation history
  const result = await streamContinuationWithFullHistory(
    webContents,
    ideaId,
    baseMessages,
    conversationTurns,
    tools
  );

  // Check for abort after streaming
  if (isStreamAborted(ideaId)) {
    logger.info('[Continuation] Stream aborted after continuation stream');
    return;
  }

  logger.info(`[Continuation] Round ${roundNumber + 1} completed`, {
    stopReason: result.stopReason,
    toolCallCount: result.toolCalls.length,
    hasThinking: !!result.thinkingContent,
    hasSignature: !!result.thinkingSignature,
    contentBlockTypes: result.assistantContent.map(b => b.type)
  });

  // If no more tool calls, check for panel errors before ending
  if (result.stopReason !== 'tool_use' || result.toolCalls.length === 0) {
    logger.info('[Continuation] No more tool calls, checking for panel errors');
    await checkAndHandlePanelErrors(
      webContents,
      ideaId,
      baseMessages,
      tools,
      errorFixRound
    );
    return;
  }

  // Execute new tool calls
  logger.info('[Continuation] Executing tool calls', {
    tools: result.toolCalls.map(tc => tc.name)
  });

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

  logger.info('[Continuation] Turn added to history', {
    turnCount: conversationTurns.length
  });

  // Recursively continue with updated history
  await processContinuationRounds(
    webContents,
    ideaId,
    baseMessages,
    conversationTurns,
    tools,
    roundNumber + 1,
    errorFixRound
  );
}

// Stream continuation using full conversation history
// This properly includes ALL previous thinking blocks as required by API
async function streamContinuationWithFullHistory(
  webContents: Electron.WebContents,
  ideaId: string,
  baseMessages: ChatMessage[],
  conversationTurns: ConversationTurn[],
  tools: Anthropic.ToolUnion[]
): Promise<StreamResult> {
  logger.debug('[ContinuationStream] Starting with full history');

  const result: StreamResult = {
    stopReason: 'end_turn',
    toolCalls: [],
    assistantContent: [],
    textContent: '',
    thinkingContent: '',
    thinkingSignature: undefined,
    inputTokens: 0,
    outputTokens: 0
  };

  try {
    // Stream the continuation response using the new method that takes full history
    for await (const streamEvent of langChainService.continueWithFullHistory(
      baseMessages,
      conversationTurns,
      tools
    )) {
      // Check for abort during streaming
      if (isStreamAborted(ideaId)) {
        logger.info('[ContinuationStream] Stream aborted during streaming');
        break;
      }
      // Log each stream event (skip tool_input_delta for verbosity, just count them)
      if (streamEvent.type === 'tool_input_delta') {
        // Log periodically to avoid spam
        if (streamEvent.partialInput && streamEvent.partialInput.length % 500 < 50) {
          logger.debug(`[ContinuationStream] tool_input_delta: ${streamEvent.toolName}, length=${streamEvent.partialInput.length}`);
        }
      } else {
        logStreamEvent('ContinuationStream', streamEvent.type,
          streamEvent.type === 'tool_start' ? { toolName: streamEvent.toolName, toolId: streamEvent.toolId } :
          streamEvent.type === 'tool_use' ? { toolName: streamEvent.toolCall.name } :
          streamEvent.type === 'done' ? { stopReason: streamEvent.stopReason } :
          streamEvent.type === 'thinking_done' ? { hasSignature: !!streamEvent.signature } :
          undefined
        );
      }

      // Send event to frontend
      webContents.send(AI_CHANNELS.SYNTHESIS_STREAM_EVENT, streamEvent);

      // Track content for building next continuation
      collectStreamEventData(streamEvent, result);
    }
  } catch (error) {
    logger.error('[ContinuationStream] Error during stream', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }

  logger.debug('[ContinuationStream] Ended', {
    thinkingLength: result.thinkingContent.length,
    textLength: result.textContent.length,
    toolCallCount: result.toolCalls.length,
    hasSignature: !!result.thinkingSignature
  });

  // Build assistant content blocks
  buildAssistantContentBlocks(result);

  return result;
}

// Collect data from stream events into result structure
function collectStreamEventData(streamEvent: StreamEvent, result: StreamResult): void {
  switch (streamEvent.type) {
    case 'thinking':
      result.thinkingContent += streamEvent.content;
      break;

    case 'thinking_done':
      if (streamEvent.signature) {
        result.thinkingSignature = streamEvent.signature;
        logger.debug('[CollectData] Captured thinking signature');
      }
      break;

    case 'text':
      result.textContent += streamEvent.content;
      break;

    case 'tool_use':
      result.toolCalls.push(streamEvent.toolCall);
      logger.debug('[CollectData] Tool call captured', {
        toolName: streamEvent.toolCall.name,
        toolId: streamEvent.toolCall.id
      });
      break;

    case 'done':
      result.stopReason = streamEvent.stopReason;
      // Also capture signature from done event if available
      if (streamEvent.thinkingData?.signature) {
        result.thinkingSignature = streamEvent.thinkingData.signature;
        logger.debug('[CollectData] Captured thinking signature from done event');
      }
      // Capture token usage
      if (streamEvent.usage) {
        result.inputTokens += streamEvent.usage.inputTokens;
        result.outputTokens += streamEvent.usage.outputTokens;
        logger.debug('[CollectData] Captured token usage', {
          inputTokens: streamEvent.usage.inputTokens,
          outputTokens: streamEvent.usage.outputTokens
        });
      }
      break;
  }
}

// Build Anthropic content blocks from collected data
// IMPORTANT: When thinking is enabled, assistant message MUST start with thinking block
function buildAssistantContentBlocks(result: StreamResult): void {
  result.assistantContent = [];

  // Add thinking block with signature (REQUIRED for continuation when thinking is enabled)
  if (result.thinkingContent && result.thinkingSignature) {
    result.assistantContent.push({
      type: 'thinking',
      thinking: result.thinkingContent,
      signature: result.thinkingSignature
    } as unknown as Anthropic.ThinkingBlock);
    logger.debug('[BuildContent] Added thinking block', {
      thinkingLength: result.thinkingContent.length,
      hasSignature: true
    });
  } else if (result.thinkingContent) {
    logger.warn('[BuildContent] Thinking content without signature', {
      thinkingLength: result.thinkingContent.length
    });
  } else {
    logger.debug('[BuildContent] No thinking content in this round');
  }

  // Add text block
  if (result.textContent) {
    result.assistantContent.push({
      type: 'text',
      text: result.textContent
    } as Anthropic.TextBlock);
    logger.debug('[BuildContent] Added text block', {
      textLength: result.textContent.length
    });
  }

  // Add tool use blocks
  for (const tc of result.toolCalls) {
    result.assistantContent.push({
      type: 'tool_use',
      id: tc.id,
      name: tc.name,
      input: tc.input
    } as Anthropic.ToolUseBlock);
    logger.debug('[BuildContent] Added tool_use block', {
      toolName: tc.name,
      toolId: tc.id
    });
  }

  logger.info('[BuildContent] Final assistant content', {
    blockCount: result.assistantContent.length,
    blockTypes: result.assistantContent.map(b => b.type)
  });
}

// Dependency node tool names for routing
const DEPENDENCY_NODE_TOOL_NAMES = [
  'create_dependency_node',
  'update_dependency_node',
  'delete_dependency_node',
  'connect_dependency_nodes',
  'disconnect_dependency_nodes',
  'read_dependency_nodes'
];

// Firecrawl tool names for special UI handling
const FIRECRAWL_TOOL_NAMES = ['firecrawl_search', 'firecrawl_scrape', 'firecrawl_map'];

// Execute tool calls and send results to frontend
// Routes to appropriate tool executor based on tool name
async function executeToolCallsAndNotify(
  webContents: Electron.WebContents,
  ideaId: string,
  toolCalls: ToolCall[]
): Promise<Array<{ tool_use_id: string; content: string }>> {
  const results: Array<{ tool_use_id: string; content: string }> = [];

  for (const tc of toolCalls) {
    logger.info('[ToolExecution] Executing tool', {
      toolName: tc.name,
      toolId: tc.id,
      input: tc.input
    });

    // Emit web_search event for Firecrawl search tools (for UI loading state)
    if (tc.name === 'firecrawl_search') {
      const searchQuery = (tc.input as { query?: string })?.query || '';
      logger.info('[ToolExecution] Emitting web_search event for firecrawl_search', { searchQuery });
      webContents.send(AI_CHANNELS.SYNTHESIS_STREAM_EVENT, {
        type: 'web_search',
        toolId: tc.id,
        searchQuery
      });
    }

    // Route to appropriate tool executor
    let result;
    if (DEPENDENCY_NODE_TOOL_NAMES.includes(tc.name)) {
      // Dependency node tools
      result = await executeDependencyNodeToolCall(ideaId, tc.name, tc.input);
    } else {
      // Synthesis tools, Firecrawl tools, and others
      result = await executeToolCall(ideaId, tc.name, tc.input);
    }

    logger.info('[ToolExecution] Tool completed', {
      toolName: tc.name,
      success: result.success,
      hasData: !!result.data,
      error: result.error
    });

    logToolExecution('ToolExecution', tc.name, tc.input, result);

    results.push({
      tool_use_id: tc.id,
      content: JSON.stringify(result)
    });

    // Emit web_search_result event for Firecrawl search (for UI display)
    if (tc.name === 'firecrawl_search' && result.success) {
      const searchData = result.data as {
        results?: Array<{ title: string; url: string; snippet: string; markdown?: string }>;
      };
      const searchResults = (searchData.results || []).map((r, idx) => ({
        rank: idx + 1,
        title: r.title,
        url: r.url,
        snippet: r.snippet || ''
      }));
      logger.info('[ToolExecution] Emitting web_search_result event', { resultCount: searchResults.length });
      webContents.send(AI_CHANNELS.SYNTHESIS_STREAM_EVENT, {
        type: 'web_search_result',
        toolId: tc.id,
        searchResults
      });
    }

    // Check if this is a note proposal - emit special event for UI
    const resultData = result.data as { type?: string; proposal?: unknown } | undefined;
    if (result.success && resultData?.type === 'note_proposal' && resultData?.proposal) {
      logger.info('[ToolExecution] Emitting note_proposal event to frontend', {
        proposalId: (resultData.proposal as { id?: string })?.id
      });
      webContents.send(AI_CHANNELS.SYNTHESIS_STREAM_EVENT, {
        type: 'note_proposal',
        toolId: tc.id,
        proposal: resultData.proposal
      });
    }

    // Send tool result event to frontend for display
    webContents.send(AI_CHANNELS.SYNTHESIS_STREAM_EVENT, {
      type: 'tool_result',
      toolId: tc.id,
      toolName: tc.name,
      result
    });
  }

  return results;
}
