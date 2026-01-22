// Dependency Nodes IPC Handler - Handles dependency node operations and AI streaming
// Guided by the Holy Spirit

import { ipcMain, BrowserWindow } from 'electron';
import { dependencyNodesService, PricingInfo } from '../services/dependencyNodes';
import { executeDependencyNodeToolCall, generateDependencyNodesSystemPrompt } from '../services/aiNodeTools';
import { getAllTools, executeToolCall } from '../services/aiTools';
import { langChainService, ChatMessage, StreamEvent, ToolCall, ConversationTurn } from '../services/langchain';
import { ideasService } from '../services/ideas';
import { logger, logStreamEvent, logToolExecution, logApiError } from '../services/logger';
import Anthropic from '@anthropic-ai/sdk';

// IPC channel names for dependency node operations
export const DEPENDENCY_NODES_CHANNELS = {
  // Node CRUD operations
  NODES_CREATE: 'dependency-nodes:create',
  NODES_GET: 'dependency-nodes:get',
  NODES_LIST: 'dependency-nodes:list',
  NODES_UPDATE: 'dependency-nodes:update',
  NODES_UPDATE_POSITION: 'dependency-nodes:update-position',
  NODES_DELETE: 'dependency-nodes:delete',
  // Connection operations
  CONNECTIONS_CREATE: 'dependency-nodes:connect',
  CONNECTIONS_DELETE: 'dependency-nodes:disconnect',
  CONNECTIONS_LIST: 'dependency-nodes:connections',
  // Full state
  NODES_FULL_STATE: 'dependency-nodes:full-state',
  // AI stream
  DEPENDENCY_NODES_STREAM: 'ai:dependency-nodes-stream',
  DEPENDENCY_NODES_STREAM_EVENT: 'ai:dependency-nodes-stream-event',
  DEPENDENCY_NODES_STREAM_END: 'ai:dependency-nodes-stream-end',
  DEPENDENCY_NODES_STREAM_ERROR: 'ai:dependency-nodes-stream-error'
} as const;

// Safety limit for tool rounds
const MAX_TOOL_ROUNDS = 1000;

// Register all dependency nodes IPC handlers
export function registerDependencyNodesHandlers(): void {
  logger.info('[DependencyNodes-IPC] Registering dependency nodes handlers');

  // Create a new node
  ipcMain.handle(
    DEPENDENCY_NODES_CHANNELS.NODES_CREATE,
    async (_event, ideaId: string, data: {
      name: string;
      provider: string;
      description: string;
      pricing?: PricingInfo;
      positionX?: number;
      positionY?: number;
      color?: string;
    }) => {
      logger.info('[DependencyNodes-IPC] Create node request', { ideaId, name: data.name });
      return dependencyNodesService.createNode({ ideaId, ...data });
    }
  );

  // Get a node by ID
  ipcMain.handle(
    DEPENDENCY_NODES_CHANNELS.NODES_GET,
    async (_event, nodeId: string) => {
      logger.debug('[DependencyNodes-IPC] Get node request', { nodeId });
      return dependencyNodesService.getNode(nodeId);
    }
  );

  // List all nodes for an idea
  ipcMain.handle(
    DEPENDENCY_NODES_CHANNELS.NODES_LIST,
    async (_event, ideaId: string) => {
      logger.debug('[DependencyNodes-IPC] List nodes request', { ideaId });
      return dependencyNodesService.getNodesForIdea(ideaId);
    }
  );

  // Update a node
  ipcMain.handle(
    DEPENDENCY_NODES_CHANNELS.NODES_UPDATE,
    async (_event, nodeId: string, data: {
      name?: string;
      provider?: string;
      description?: string;
      pricing?: PricingInfo;
      color?: string;
    }) => {
      logger.info('[DependencyNodes-IPC] Update node request', { nodeId });
      return dependencyNodesService.updateNode(nodeId, data);
    }
  );

  // Update node position (for drag operations)
  ipcMain.handle(
    DEPENDENCY_NODES_CHANNELS.NODES_UPDATE_POSITION,
    async (_event, nodeId: string, positionX: number, positionY: number) => {
      logger.debug('[DependencyNodes-IPC] Update node position', { nodeId, positionX, positionY });
      return dependencyNodesService.updateNodePosition(nodeId, positionX, positionY);
    }
  );

  // Delete a node
  ipcMain.handle(
    DEPENDENCY_NODES_CHANNELS.NODES_DELETE,
    async (_event, nodeId: string) => {
      logger.info('[DependencyNodes-IPC] Delete node request', { nodeId });
      dependencyNodesService.deleteNode(nodeId);
      return { success: true };
    }
  );

  // Create a connection
  ipcMain.handle(
    DEPENDENCY_NODES_CHANNELS.CONNECTIONS_CREATE,
    async (_event, ideaId: string, fromNodeId: string, toNodeId: string, label?: string) => {
      logger.info('[DependencyNodes-IPC] Create connection request', { ideaId, fromNodeId, toNodeId });
      return dependencyNodesService.createConnection({ ideaId, fromNodeId, toNodeId, label });
    }
  );

  // Delete a connection
  ipcMain.handle(
    DEPENDENCY_NODES_CHANNELS.CONNECTIONS_DELETE,
    async (_event, fromNodeId: string, toNodeId: string) => {
      logger.info('[DependencyNodes-IPC] Delete connection request', { fromNodeId, toNodeId });
      dependencyNodesService.deleteConnectionBetween(fromNodeId, toNodeId);
      return { success: true };
    }
  );

  // List connections for an idea
  ipcMain.handle(
    DEPENDENCY_NODES_CHANNELS.CONNECTIONS_LIST,
    async (_event, ideaId: string) => {
      logger.debug('[DependencyNodes-IPC] List connections request', { ideaId });
      return dependencyNodesService.getConnectionsForIdea(ideaId);
    }
  );

  // Get full state (nodes + connections)
  ipcMain.handle(
    DEPENDENCY_NODES_CHANNELS.NODES_FULL_STATE,
    async (_event, ideaId: string) => {
      logger.debug('[DependencyNodes-IPC] Get full state request', { ideaId });
      return dependencyNodesService.getFullState(ideaId);
    }
  );

  // Dependency nodes AI stream with node tools
  ipcMain.handle(
    DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM,
    async (event, ideaId: string, userMessages: ChatMessage[]): Promise<void> => {
      const webContents = event.sender;
      const window = BrowserWindow.fromWebContents(webContents);

      logger.info('[DependencyNodes] Stream request received', { ideaId, messageCount: userMessages.length });

      if (!window) {
        logger.error('[DependencyNodes] Could not find browser window');
        throw new Error('Could not find browser window');
      }

      try {
        // Get the idea
        const idea = ideasService.getIdea(ideaId);
        if (!idea) {
          logger.error('[DependencyNodes] Idea not found', { ideaId });
          throw new Error(`Idea ${ideaId} not found`);
        }

        // Get existing nodes and connections for context
        const state = dependencyNodesService.getFullState(ideaId);
        const existingNodes = state.nodes.map(n => ({
          id: n.id,
          name: n.name,
          provider: n.provider
        }));
        const existingConnections = state.connections.map(c => ({
          fromNodeId: c.fromNodeId,
          toNodeId: c.toNodeId,
          label: c.label
        }));

        // Generate system prompt
        const systemPrompt = generateDependencyNodesSystemPrompt(idea.title, existingNodes, existingConnections);

        // Build messages array with system prompt
        const messages: ChatMessage[] = [
          { role: 'system', content: systemPrompt },
          ...userMessages
        ];

        logger.info('[DependencyNodes] Starting agentic stream', { totalMessages: messages.length });

        // Process the stream with agentic tool loop - ALL tools available
        await processDependencyNodesStream(
          webContents,
          ideaId,
          messages,
          getAllTools()
        );

        logger.info('[DependencyNodes] Stream completed successfully');
        webContents.send(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_END);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        logger.error('[DependencyNodes] Stream error', { error: errorMessage });
        logApiError('DependencyNodes', error);
        webContents.send(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_ERROR, errorMessage);
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
async function processDependencyNodesStream(
  webContents: Electron.WebContents,
  ideaId: string,
  initialMessages: ChatMessage[],
  tools: Anthropic.ToolUnion[]
): Promise<void> {
  logger.info('[DependencyNodes-Agentic] Starting agentic loop');

  // Track all conversation turns for full context
  const conversationTurns: ConversationTurn[] = [];

  // First round
  const firstResult = await streamFirstRound(webContents, initialMessages, tools);

  logger.info('[DependencyNodes-Agentic] First round completed', {
    stopReason: firstResult.stopReason,
    toolCallCount: firstResult.toolCalls.length
  });

  // If no tool calls, we're done
  if (firstResult.stopReason !== 'tool_use' || firstResult.toolCalls.length === 0) {
    logger.info('[DependencyNodes-Agentic] No tool calls, ending loop');
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
  tools: Anthropic.ToolUnion[]
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
      logStreamEvent('DependencyNodes-FirstRound', streamEvent.type,
        streamEvent.type === 'tool_start' ? { toolName: streamEvent.toolName } :
        streamEvent.type === 'done' ? { stopReason: streamEvent.stopReason } :
        undefined
      );
    }

    // Send event to frontend
    webContents.send(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_EVENT, streamEvent);

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
  tools: Anthropic.ToolUnion[],
  roundNumber: number
): Promise<void> {
  logger.info(`[DependencyNodes-Continuation] Starting round ${roundNumber + 1}`);

  if (roundNumber >= MAX_TOOL_ROUNDS) {
    logger.warn('[DependencyNodes-Continuation] Max tool rounds reached');
    return;
  }

  // Stream continuation response with full history
  const result = await streamContinuationWithFullHistory(
    webContents,
    baseMessages,
    conversationTurns,
    tools
  );

  logger.info(`[DependencyNodes-Continuation] Round ${roundNumber + 1} completed`, {
    stopReason: result.stopReason,
    toolCallCount: result.toolCalls.length
  });

  // If no more tool calls, we're done
  if (result.stopReason !== 'tool_use' || result.toolCalls.length === 0) {
    logger.info('[DependencyNodes-Continuation] No more tool calls, ending loop');
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
  tools: Anthropic.ToolUnion[]
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
      logStreamEvent('DependencyNodes-Continuation', streamEvent.type,
        streamEvent.type === 'tool_start' ? { toolName: streamEvent.toolName } :
        streamEvent.type === 'done' ? { stopReason: streamEvent.stopReason } :
        undefined
      );
    }

    webContents.send(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_EVENT, streamEvent);
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

// Dependency node tool names for routing
const DEPENDENCY_NODE_TOOL_NAMES = new Set([
  'create_dependency_node',
  'update_dependency_node',
  'delete_dependency_node',
  'connect_dependency_nodes',
  'disconnect_dependency_nodes',
  'read_dependency_nodes'
]);

// Execute tool calls and send results to frontend
// Routes to appropriate executor based on tool name
async function executeToolCallsAndNotify(
  webContents: Electron.WebContents,
  ideaId: string,
  toolCalls: ToolCall[]
): Promise<Array<{ tool_use_id: string; content: string }>> {
  const results: Array<{ tool_use_id: string; content: string }> = [];

  for (const tc of toolCalls) {
    logger.info('[DependencyNodes-ToolExecution] Executing tool', {
      toolName: tc.name,
      toolId: tc.id
    });

    // Emit web_search event for Firecrawl search tools (for UI loading state)
    if (tc.name === 'firecrawl_search') {
      const searchQuery = (tc.input as { query?: string })?.query || '';
      logger.info('[DependencyNodes-ToolExecution] Emitting web_search event for firecrawl_search', { searchQuery });
      webContents.send(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_EVENT, {
        type: 'web_search',
        toolId: tc.id,
        searchQuery
      });
    }

    // Route to appropriate executor based on tool name
    let result;
    if (DEPENDENCY_NODE_TOOL_NAMES.has(tc.name)) {
      // Dependency node tool
      result = await executeDependencyNodeToolCall(ideaId, tc.name, tc.input);
    } else {
      // Synthesis tool, Firecrawl tools, and others
      result = await executeToolCall(ideaId, tc.name, tc.input);
    }

    logger.info('[DependencyNodes-ToolExecution] Tool completed', {
      toolName: tc.name,
      success: result.success
    });

    logToolExecution('DependencyNodes', tc.name, tc.input, result);

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
      logger.info('[DependencyNodes-ToolExecution] Emitting web_search_result event', { resultCount: searchResults.length });
      webContents.send(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_EVENT, {
        type: 'web_search_result',
        toolId: tc.id,
        searchResults
      });
    }

    // Send tool result event to frontend
    webContents.send(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_EVENT, {
      type: 'tool_result',
      toolId: tc.id,
      toolName: tc.name,
      result
    });

    // Handle propose_note specially - emit note_proposal event
    if (tc.name === 'propose_note' && result.success && result.data) {
      const proposalData = result.data as { proposalId: string; title: string; content: string; category: string };
      webContents.send(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_EVENT, {
        type: 'note_proposal',
        proposal: {
          id: proposalData.proposalId,
          title: proposalData.title,
          content: proposalData.content,
          category: proposalData.category,
          ideaId: ideaId
        }
      });
    }
  }

  return results;
}
