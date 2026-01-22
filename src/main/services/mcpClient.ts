// MCP Client Service - Manages connection to Firecrawl MCP server via stdio
// Spawns the server as a child process and communicates via JSON-RPC over stdio
// Guided by the Holy Spirit

import { spawn, ChildProcess } from 'child_process';
import { logger } from './logger';
import path from 'path';
import { createInterface, Interface } from 'readline';
import { app } from 'electron';

// Tool result type
interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// JSON-RPC request/response types
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

// Pending request tracker
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

// MCP Client service class - stdio mode
class MCPClientService {
  private serverProcess: ChildProcess | null = null;
  private isConnected: boolean = false;
  private firecrawlApiKey: string | null = null;
  private requestId: number = 0;
  private pendingRequests: Map<number, PendingRequest> = new Map();
  private readline: Interface | null = null;

  // Initialize the MCP server and connect via stdio
  async initialize(apiKey: string): Promise<void> {
    if (this.isConnected) {
      logger.info('[MCP] Already connected');
      return;
    }

    this.firecrawlApiKey = apiKey;

    try {
      logger.info('[MCP] Starting Firecrawl MCP server in stdio mode...');

      // Path to the firecrawl-mcp-server
      // In production (packaged app): resources/firecrawl-mcp-server/dist/index.js
      // In development: sibling directory to fishWallet
      let mcpServerPath: string;

      if (app.isPackaged) {
        // Production mode - MCP server is bundled in extraResources
        mcpServerPath = path.join(
          process.resourcesPath,
          'firecrawl-mcp-server',
          'dist',
          'index.js'
        );
      } else {
        // Development mode - MCP server is in sibling directory or resources folder
        const resourcesPath = path.resolve(__dirname, '../../../resources/firecrawl-mcp-server/dist/index.js');
        const siblingPath = path.resolve(__dirname, '../../../../firecrawl-mcp-server/dist/index.js');

        // Prefer resources folder if it exists (consistent with production)
        const fs = require('fs');
        if (fs.existsSync(resourcesPath)) {
          mcpServerPath = resourcesPath;
        } else {
          mcpServerPath = siblingPath;
        }
      }

      logger.info('[MCP] Server path:', mcpServerPath);
      logger.info('[MCP] App is packaged:', app.isPackaged);

      // Spawn the server process in stdio mode (default)
      this.serverProcess = spawn('node', [mcpServerPath], {
        env: {
          ...process.env,
          FIRECRAWL_API_KEY: apiKey,
          // Do NOT set HTTP_STREAMABLE_SERVER - use default stdio mode
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Set up readline to parse newline-delimited JSON from stdout
      this.readline = createInterface({
        input: this.serverProcess.stdout!,
        crlfDelay: Infinity,
      });

      // Handle incoming JSON-RPC responses
      this.readline.on('line', (line) => {
        if (!line.trim()) return;

        try {
          const response = JSON.parse(line) as JsonRpcResponse;
          logger.debug('[MCP] Received response:', { id: response.id, hasResult: !!response.result, hasError: !!response.error });

          // Find and resolve the pending request
          const pending = this.pendingRequests.get(response.id);
          if (pending) {
            this.pendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(new Error(`RPC error: ${response.error.message}`));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch (parseError) {
          // Not JSON or not a response - might be log output
          logger.debug('[MCP-Server]', line);
        }
      });

      // Log server stderr
      this.serverProcess.stderr?.on('data', (data) => {
        const msg = data.toString().trim();
        // Filter out debug messages, only log errors
        if (msg.includes('ERROR') || msg.includes('error')) {
          logger.error('[MCP-Server Error]', msg);
        } else {
          logger.debug('[MCP-Server]', msg);
        }
      });

      this.serverProcess.on('error', (error) => {
        logger.error('[MCP] Server process error:', error);
        this.isConnected = false;
      });

      this.serverProcess.on('exit', (code) => {
        logger.info('[MCP] Server process exited with code:', code);
        this.isConnected = false;
        this.cleanup();
      });

      // Give server a moment to start
      await new Promise(resolve => setTimeout(resolve, 500));

      // Initialize the MCP session
      await this.initializeSession();
      this.isConnected = true;

      logger.info('[MCP] Connected to Firecrawl MCP server via stdio');

    } catch (error) {
      logger.error('[MCP] Failed to initialize:', error);
      this.isConnected = false;
      this.cleanup();
      throw error;
    }
  }

  // Cleanup resources
  private cleanup(): void {
    if (this.readline) {
      this.readline.close();
      this.readline = null;
    }
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      pending.reject(new Error('Connection closed'));
      this.pendingRequests.delete(id);
    }
  }

  // Initialize MCP session
  private async initializeSession(): Promise<void> {
    const response = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
      },
      clientInfo: {
        name: 'fishwallet-mcp-client',
        version: '1.0.0',
      },
    });

    logger.info('[MCP] Session initialized:', response);

    // Send initialized notification
    this.sendNotification('notifications/initialized');
  }

  // Send JSON-RPC request and wait for response
  private sendRequest(method: string, params?: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.serverProcess || !this.serverProcess.stdin) {
        reject(new Error('Server not connected'));
        return;
      }

      const id = ++this.requestId;
      const request: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
      };

      if (params) {
        request.params = params;
      }

      // Store the pending request
      this.pendingRequests.set(id, { resolve, reject });

      // Set timeout for request
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 60000); // 60 second timeout for long operations like search

      // Clear timeout when resolved
      const originalResolve = resolve;
      const originalReject = reject;
      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          originalResolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          originalReject(error);
        },
      });

      // Send the request
      const requestStr = JSON.stringify(request) + '\n';
      logger.debug('[MCP] Sending request:', { id, method });
      this.serverProcess.stdin.write(requestStr);
    });
  }

  // Send JSON-RPC notification (no response expected)
  private sendNotification(method: string, params?: Record<string, unknown>): void {
    if (!this.serverProcess || !this.serverProcess.stdin) {
      logger.warn('[MCP] Cannot send notification - server not connected');
      return;
    }

    const notification = {
      jsonrpc: '2.0',
      method,
      ...(params && { params }),
    };

    const notificationStr = JSON.stringify(notification) + '\n';
    logger.debug('[MCP] Sending notification:', { method });
    this.serverProcess.stdin.write(notificationStr);
  }

  // Check if connected
  isInitialized(): boolean {
    return this.isConnected;
  }

  // Get available tools
  async getTools(): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
    if (!this.isConnected) {
      throw new Error('MCP client not initialized');
    }

    const result = await this.sendRequest('tools/list') as { tools: Array<{ name: string; description?: string; inputSchema: unknown }> };
    return result.tools.map(tool => ({
      name: tool.name,
      description: tool.description || '',
      inputSchema: tool.inputSchema,
    }));
  }

  // Call a tool
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.isConnected) {
      throw new Error('MCP client not initialized');
    }

    try {
      logger.info('[MCP] Calling tool:', { name, args });

      const result = await this.sendRequest('tools/call', {
        name,
        arguments: args,
      }) as { content: Array<{ type: string; text?: string }>; isError?: boolean };

      logger.info('[MCP] Tool result received:', { name, isError: result.isError });

      // Parse the result content
      if (result.content && Array.isArray(result.content)) {
        const textContent = result.content.find(c => c.type === 'text');
        if (textContent && textContent.text) {
          try {
            const data = JSON.parse(textContent.text);
            // Log raw Firecrawl response for debugging search issues
            if (name === 'firecrawl_search') {
              logger.info('[MCP] Firecrawl search raw response:', {
                success: data.success,
                dataKeys: Object.keys(data.data || data || {}),
                hasResults: Array.isArray(data.data) ? data.data.length : (data.data?.results?.length || 0),
                rawDataPreview: JSON.stringify(data).substring(0, 500)
              });
            }
            return {
              success: !result.isError,
              data,
            };
          } catch {
            return {
              success: !result.isError,
              data: textContent.text,
            };
          }
        }
      }

      return {
        success: !result.isError,
        data: result.content,
      };

    } catch (error) {
      logger.error('[MCP] Tool call failed:', { name, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Convenience method: Search the web
  // Uses Firecrawl's search API which searches across the web
  async search(query: string, options?: {
    limit?: number;
    location?: string;
    scrapeContent?: boolean;
  }): Promise<ToolResult> {
    // Build search parameters matching Firecrawl MCP server expectations
    const searchParams: Record<string, unknown> = {
      query,
      limit: options?.limit || 5,
      // Default to web source for general searches
      sources: [{ type: 'web' }],
    };

    // Add location if provided
    if (options?.location) {
      searchParams.location = options.location;
    }

    // Add scrape options if content scraping is requested
    if (options?.scrapeContent) {
      searchParams.scrapeOptions = {
        formats: ['markdown'],
        onlyMainContent: true,
      };
    }

    return this.callTool('firecrawl_search', searchParams);
  }

  // Convenience method: Scrape a URL
  async scrape(url: string, options?: {
    formats?: string[];
    onlyMainContent?: boolean;
  }): Promise<ToolResult> {
    return this.callTool('firecrawl_scrape', {
      url,
      formats: options?.formats || ['markdown'],
      onlyMainContent: options?.onlyMainContent ?? true,
    });
  }

  // Convenience method: Map a website (discover URLs)
  async map(url: string, options?: {
    limit?: number;
    search?: string;
  }): Promise<ToolResult> {
    return this.callTool('firecrawl_map', {
      url,
      ...(options?.limit && { limit: options.limit }),
      ...(options?.search && { search: options.search }),
    });
  }

  // Disconnect and cleanup
  async disconnect(): Promise<void> {
    this.cleanup();

    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }

    this.isConnected = false;
    logger.info('[MCP] Disconnected from Firecrawl MCP server');
  }
}

// Singleton instance
export const mcpClientService = new MCPClientService();
