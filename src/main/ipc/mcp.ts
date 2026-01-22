// MCP IPC Handler - Exposes Firecrawl MCP functionality to renderer
// Guided by the Holy Spirit

import { ipcMain } from 'electron';
import { mcpClientService } from '../services/mcpClient';
import { logger } from '../services/logger';

// IPC channel names
export const MCP_CHANNELS = {
  INITIALIZE: 'mcp:initialize',
  IS_INITIALIZED: 'mcp:is-initialized',
  GET_TOOLS: 'mcp:get-tools',
  CALL_TOOL: 'mcp:call-tool',
  SEARCH: 'mcp:search',
  SCRAPE: 'mcp:scrape',
  MAP: 'mcp:map',
  DISCONNECT: 'mcp:disconnect',
};

// Register MCP IPC handlers
export function registerMcpHandlers(): void {
  // Initialize MCP with Firecrawl API key
  ipcMain.handle(MCP_CHANNELS.INITIALIZE, async (_event, apiKey: string) => {
    try {
      await mcpClientService.initialize(apiKey);
      return { success: true };
    } catch (error) {
      logger.error('[MCP-IPC] Initialize failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to initialize MCP',
      };
    }
  });

  // Check if MCP is initialized
  ipcMain.handle(MCP_CHANNELS.IS_INITIALIZED, async () => {
    return mcpClientService.isInitialized();
  });

  // Get available tools
  ipcMain.handle(MCP_CHANNELS.GET_TOOLS, async () => {
    try {
      const tools = await mcpClientService.getTools();
      return { success: true, tools };
    } catch (error) {
      logger.error('[MCP-IPC] Get tools failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get tools',
      };
    }
  });

  // Call a tool
  ipcMain.handle(
    MCP_CHANNELS.CALL_TOOL,
    async (_event, name: string, args: Record<string, unknown>) => {
      try {
        const result = await mcpClientService.callTool(name, args);
        return result;
      } catch (error) {
        logger.error('[MCP-IPC] Call tool failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to call tool',
        };
      }
    }
  );

  // Search the web
  ipcMain.handle(
    MCP_CHANNELS.SEARCH,
    async (
      _event,
      query: string,
      options?: { limit?: number; lang?: string; country?: string; scrapeContent?: boolean }
    ) => {
      try {
        const result = await mcpClientService.search(query, options);
        return result;
      } catch (error) {
        logger.error('[MCP-IPC] Search failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Search failed',
        };
      }
    }
  );

  // Scrape a URL
  ipcMain.handle(
    MCP_CHANNELS.SCRAPE,
    async (
      _event,
      url: string,
      options?: { formats?: string[]; onlyMainContent?: boolean }
    ) => {
      try {
        const result = await mcpClientService.scrape(url, options);
        return result;
      } catch (error) {
        logger.error('[MCP-IPC] Scrape failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Scrape failed',
        };
      }
    }
  );

  // Map a website
  ipcMain.handle(
    MCP_CHANNELS.MAP,
    async (_event, url: string, options?: { limit?: number; search?: string }) => {
      try {
        const result = await mcpClientService.map(url, options);
        return result;
      } catch (error) {
        logger.error('[MCP-IPC] Map failed:', error);
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Map failed',
        };
      }
    }
  );

  // Disconnect MCP
  ipcMain.handle(MCP_CHANNELS.DISCONNECT, async () => {
    try {
      await mcpClientService.disconnect();
      return { success: true };
    } catch (error) {
      logger.error('[MCP-IPC] Disconnect failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to disconnect',
      };
    }
  });

  logger.info('[MCP-IPC] Handlers registered');
}
