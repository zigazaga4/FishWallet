// Firecrawl Service - Direct SDK integration (no subprocess needed)
// Replaces MCP server approach with direct API calls

import FirecrawlApp from '@mendable/firecrawl-js';
import { logger } from './logger';

// Tool result type
interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// Firecrawl Service class - direct SDK usage
class FirecrawlService {
  private client: FirecrawlApp | null = null;
  private isConnected: boolean = false;
  private firecrawlApiKey: string | null = null;

  // Initialize the Firecrawl client
  async initialize(apiKey: string): Promise<void> {
    if (this.isConnected && this.firecrawlApiKey === apiKey) {
      logger.info('[Firecrawl] Already initialized');
      return;
    }

    this.firecrawlApiKey = apiKey;

    try {
      logger.info('[Firecrawl] Initializing Firecrawl SDK...');

      // Create the Firecrawl client directly
      this.client = new FirecrawlApp({ apiKey });
      this.isConnected = true;

      logger.info('[Firecrawl] SDK initialized successfully');

    } catch (error) {
      logger.error('[Firecrawl] Failed to initialize:', error);
      this.isConnected = false;
      this.client = null;
      throw error;
    }
  }

  // Check if initialized
  isInitialized(): boolean {
    return this.isConnected && this.client !== null;
  }

  // Get available tools (for compatibility)
  async getTools(): Promise<Array<{ name: string; description: string; inputSchema: unknown }>> {
    return [
      {
        name: 'firecrawl_search',
        description: 'Search the web using Firecrawl',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            limit: { type: 'number' },
          },
          required: ['query'],
        },
      },
      {
        name: 'firecrawl_scrape',
        description: 'Scrape a URL using Firecrawl',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            formats: { type: 'array', items: { type: 'string' } },
            onlyMainContent: { type: 'boolean' },
          },
          required: ['url'],
        },
      },
      {
        name: 'firecrawl_map',
        description: 'Map/discover URLs on a website',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            limit: { type: 'number' },
            search: { type: 'string' },
          },
          required: ['url'],
        },
      },
    ];
  }

  // Call a tool (for compatibility with existing code)
  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.isConnected || !this.client) {
      return {
        success: false,
        error: 'Firecrawl client not initialized',
      };
    }

    try {
      logger.info('[Firecrawl] Calling tool:', { name, args });

      switch (name) {
        case 'firecrawl_search':
          return this.search(args.query as string, {
            limit: args.limit as number | undefined,
            scrapeContent: args.scrapeOptions !== undefined,
          });

        case 'firecrawl_scrape':
          return this.scrape(args.url as string, {
            formats: args.formats as string[] | undefined,
            onlyMainContent: args.onlyMainContent as boolean | undefined,
          });

        case 'firecrawl_map':
          return this.map(args.url as string, {
            limit: args.limit as number | undefined,
            search: args.search as string | undefined,
          });

        default:
          return {
            success: false,
            error: `Unknown tool: ${name}`,
          };
      }
    } catch (error) {
      logger.error('[Firecrawl] Tool call failed:', { name, error });
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Search the web
  async search(query: string, options?: {
    limit?: number;
    location?: string;
    scrapeContent?: boolean;
  }): Promise<ToolResult> {
    if (!this.client) {
      return { success: false, error: 'Client not initialized' };
    }

    try {
      logger.info('[Firecrawl] Executing search:', { query, limit: options?.limit });

      const searchParams: Record<string, unknown> = {
        limit: options?.limit || 5,
      };

      if (options?.scrapeContent) {
        searchParams.scrapeOptions = {
          formats: ['markdown'],
          onlyMainContent: true,
        };
      }

      const result = await this.client.search(query, searchParams as any);

      // SearchData has web, news, images arrays
      const webResults = result.web || [];
      logger.info('[Firecrawl] Search completed:', {
        resultCount: webResults.length
      });

      // Return in format expected by aiTools.ts (expects data.web array)
      return {
        success: true,
        data: {
          web: webResults,
        },
      };
    } catch (error) {
      logger.error('[Firecrawl] Search failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Search failed',
      };
    }
  }

  // Scrape a URL
  async scrape(url: string, options?: {
    formats?: string[];
    onlyMainContent?: boolean;
  }): Promise<ToolResult> {
    if (!this.client) {
      return { success: false, error: 'Client not initialized' };
    }

    try {
      logger.info('[Firecrawl] Executing scrape:', { url });

      const result = await this.client.scrape(url, {
        formats: (options?.formats || ['markdown']) as any,
        onlyMainContent: options?.onlyMainContent ?? true,
      });

      logger.info('[Firecrawl] Scrape completed:', { url });

      return {
        success: true,
        data: {
          success: true,
          ...result,
        },
      };
    } catch (error) {
      logger.error('[Firecrawl] Scrape failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Scrape failed',
      };
    }
  }

  // Map a website (discover URLs)
  async map(url: string, options?: {
    limit?: number;
    search?: string;
  }): Promise<ToolResult> {
    if (!this.client) {
      return { success: false, error: 'Client not initialized' };
    }

    try {
      logger.info('[Firecrawl] Executing map:', { url, limit: options?.limit });

      const result = await this.client.map(url, {
        ...(options?.limit && { limit: options.limit }),
        ...(options?.search && { search: options.search }),
      });

      logger.info('[Firecrawl] Map completed:', {
        url,
        urlCount: Array.isArray(result.links) ? result.links.length : 0
      });

      return {
        success: true,
        data: {
          success: true,
          links: result.links,
        },
      };
    } catch (error) {
      logger.error('[Firecrawl] Map failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Map failed',
      };
    }
  }

  // Disconnect (for compatibility - no-op since there's no subprocess)
  async disconnect(): Promise<void> {
    this.client = null;
    this.isConnected = false;
    this.firecrawlApiKey = null;
    logger.info('[Firecrawl] Client disconnected');
  }
}

// Singleton instance - keep same export name for compatibility
export const mcpClientService = new FirecrawlService();
