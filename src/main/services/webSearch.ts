// Web Search Service - Provides web search capabilities for AI research
// Uses Brave Search API for searching APIs, documentation, and pricing info
// Guided by the Holy Spirit

import { logger } from './logger';

// Search result interface
export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
  favicon?: string;
}

// Search response interface
export interface WebSearchResponse {
  query: string;
  results: WebSearchResult[];
  totalResults: number;
}

// Brave Search API response structure
interface BraveSearchResponse {
  web?: {
    results?: Array<{
      title?: string;
      url: string;
      description?: string;
      profile?: {
        img?: string;
      };
    }>;
    totalResults?: number;
  };
}

// Web Search Service class
class WebSearchService {
  private apiKey: string | null = null;
  private baseUrl = 'https://api.search.brave.com/res/v1/web/search';

  // Initialize with API key from environment or manual setting
  constructor() {
    const envApiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (envApiKey) {
      this.apiKey = envApiKey;
      logger.info('[WebSearch] Initialized with environment API key');
    }
  }

  // Set API key manually
  initialize(apiKey: string): void {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('Brave Search API key is required');
    }
    this.apiKey = apiKey;
    logger.info('[WebSearch] Initialized with provided API key');
  }

  // Check if service is ready
  isInitialized(): boolean {
    return this.apiKey !== null;
  }

  // Perform web search
  async search(query: string, count: number = 5): Promise<WebSearchResponse> {
    if (!this.apiKey) {
      throw new Error('Web search not initialized. Please set BRAVE_SEARCH_API_KEY.');
    }

    logger.info('[WebSearch] Searching', { query, count });

    const url = new URL(this.baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('count', count.toString());
    url.searchParams.set('safesearch', 'moderate');

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': this.apiKey
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('[WebSearch] API error', { status: response.status, error: errorText });
      throw new Error(`Web search failed: ${response.status} ${errorText}`);
    }

    const data = await response.json() as BraveSearchResponse;

    // Parse Brave Search response
    const results: WebSearchResult[] = [];

    if (data.web?.results) {
      for (const result of data.web.results.slice(0, count)) {
        results.push({
          title: result.title || 'No title',
          url: result.url,
          description: result.description || '',
          favicon: result.profile?.img || undefined
        });
      }
    }

    logger.info('[WebSearch] Search completed', { query, resultCount: results.length });

    return {
      query,
      results,
      totalResults: data.web?.totalResults || results.length
    };
  }

  // Search specifically for API documentation and pricing
  async searchApiInfo(apiName: string): Promise<WebSearchResponse> {
    const query = `${apiName} API pricing documentation official`;
    return this.search(query, 5);
  }

  // Reset service
  reset(): void {
    this.apiKey = null;
    logger.info('[WebSearch] Service reset');
  }
}

// Export singleton instance
export const webSearchService = new WebSearchService();
