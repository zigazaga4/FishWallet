// Dependency Nodes IPC Handler - Handles dependency node operations and AI streaming
// AI streaming uses Claude Code Agent SDK subprocess with MCP tools

import { ipcMain, BrowserWindow } from 'electron';
import { dependencyNodesService, PricingInfo } from '../services/dependencyNodes';
import { generateDependencyNodesSystemPrompt } from '../services/aiNodeTools';
import { streamClaudeCode, StreamEvent } from '../services/claudeCode';
import { createFishWalletMcpServer, ToolCallEvent } from '../services/mcpToolServer';
import { ideasService } from '../services/ideas';
import { branchesService } from '../services/branches';
import { logger, logApiError } from '../services/logger';
import { snapshotsService, hasModifyingTools } from '../services/snapshots';
import { SNAPSHOT_CHANNELS } from './snapshots';

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

  // Dependency nodes AI stream — agentic loop via Claude Code subprocess + MCP tools
  // Each request is a fresh session (no conversation resumption for dependency nodes)
  ipcMain.handle(
    DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM,
    async (event, ideaId: string, messageText: string): Promise<void> => {
      const webContents = event.sender;
      const window = BrowserWindow.fromWebContents(webContents);

      logger.info('[DependencyNodes] Stream request received', { ideaId, messageLength: messageText.length });

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
        const existingNodes = state.nodes.map((n: { id: string; name: string; provider: string }) => ({
          id: n.id,
          name: n.name,
          provider: n.provider
        }));
        const existingConnections = state.connections.map((c: { fromNodeId: string; toNodeId: string; label: string | null }) => ({
          fromNodeId: c.fromNodeId,
          toNodeId: c.toNodeId,
          label: c.label
        }));

        // Generate system prompt append with dependency nodes context
        const systemPromptAppend = generateDependencyNodesSystemPrompt(
          idea.title,
          existingNodes,
          existingConnections
        );

        // Create MCP server with all tools for this idea
        const { server: mcpServer, events: mcpEvents } = createFishWalletMcpServer(ideaId);

        // Track tools called for snapshot creation
        const allToolsCalled = new Set<string>();

        // Wire up MCP tool call events → renderer side effects
        mcpEvents.on('toolCall', ({ toolName, result }: ToolCallEvent) => {
          allToolsCalled.add(toolName);

          // Forward tool result to renderer
          webContents.send(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_EVENT, {
            type: 'tool_result',
            toolName,
            result
          });

          // Note proposal → renderer shows approval UI
          if (toolName === 'propose_note' && result.success && result.data) {
            const data = result.data as { type?: string; proposal?: unknown };
            if (data?.type === 'note_proposal' && data?.proposal) {
              webContents.send(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_EVENT, {
                type: 'note_proposal',
                proposal: data.proposal
              });
            }
          }

          // Firecrawl search results → renderer shows search results UI
          if (toolName === 'firecrawl_search' && result.success) {
            const searchData = result.data as {
              results?: Array<{ title: string; url: string; snippet: string; markdown?: string }>;
            };
            const searchResults = (searchData.results || []).map((r: { title: string; url: string; snippet: string }, idx: number) => ({
              rank: idx + 1,
              title: r.title,
              url: r.url,
              snippet: r.snippet || ''
            }));
            webContents.send(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_EVENT, {
              type: 'web_search_result',
              searchResults
            });
          }
        });

        // Stream the response via Claude Code subprocess (fresh session, no resume)
        await streamClaudeCode({
          prompt: messageText,
          systemPromptAppend,
          sessionId: null,
          mcpServer,
          projectPath: branchesService.getActiveBranchFolderPath(ideaId) || null,
          onEvent: (streamEvent: StreamEvent) => {
            // Emit web_search loading indicator before forwarding tool_use event
            if (streamEvent.type === 'tool_use' && streamEvent.toolName === 'firecrawl_search') {
              const searchQuery = (streamEvent.input as { query?: string })?.query || '';
              webContents.send(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_EVENT, {
                type: 'web_search',
                toolId: streamEvent.toolId,
                searchQuery
              });
            }

            // Forward all stream events to renderer
            webContents.send(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_EVENT, streamEvent);
          },
          onSessionId: () => {
            // No session persistence for dependency nodes
          }
        });

        // Create version snapshot if any modifying tools were called
        if (hasModifyingTools(allToolsCalled)) {
          try {
            const snapshot = snapshotsService.createSnapshot(ideaId, [...allToolsCalled]);
            webContents.send(SNAPSHOT_CHANNELS.CREATED, {
              ideaId,
              versionNumber: snapshot.versionNumber,
              snapshotId: snapshot.id
            });
          } catch (snapshotError) {
            logger.error('[DependencyNodes] Failed to create snapshot', { error: snapshotError });
          }
        }

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
