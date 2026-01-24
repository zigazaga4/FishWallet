import Anthropic from '@anthropic-ai/sdk';

// Claude Sonnet 4.5 model configuration
const MODEL_ID = 'claude-sonnet-4-5-20250929';
const MAX_TOKENS = 16000;
const THINKING_BUDGET_TOKENS = 7000;

// Message types for conversation
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Tool call information
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// Thinking block with signature for continuation
export interface ThinkingData {
  content: string;
  signature?: string;
}

// Response from the LLM
export interface LLMResponse {
  content: string;
  thinking?: string;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
  toolCalls?: ToolCall[];
  stopReason?: string;
}

// Stream event types
// tool_start: Emitted immediately when tool block starts streaming (name and ID known)
// tool_input_delta: Emitted as tool input JSON streams in (for live content preview)
// tool_use: Emitted when tool block is complete (full input parsed)
// Web search result item
export interface WebSearchResultItem {
  rank: number;
  title: string;
  url: string;
  snippet: string;
}

// Token usage from API response
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export type StreamEvent =
  | { type: 'thinking_start' }
  | { type: 'thinking'; content: string }
  | { type: 'thinking_done'; signature?: string }
  | { type: 'text'; content: string }
  | { type: 'tool_start'; toolId: string; toolName: string }
  | { type: 'tool_input_delta'; toolId: string; toolName: string; partialInput: string }
  | { type: 'tool_use'; toolCall: ToolCall }
  | { type: 'web_search'; toolId: string; searchQuery: string }
  | { type: 'web_search_result'; toolId: string; searchResults: WebSearchResultItem[] }
  | { type: 'done'; stopReason: string; thinkingData?: ThinkingData; usage?: TokenUsage };

// Conversation turn for multi-round tool use
// Tracks one assistant response + the tool results for that response
export interface ConversationTurn {
  assistantContent: Anthropic.ContentBlock[];
  toolResults: Array<{ tool_use_id: string; content: string }>;
}

// LangChain service class for managing Anthropic Claude interactions
// Using Anthropic SDK directly for extended thinking support
export class LangChainService {
  private client: Anthropic | null = null;
  private apiKey: string | null = null;

  // Auto-initialize from environment variable if available
  initializeFromEnv(): void {
    const envApiKey = process.env.ANTHROPIC_API_KEY;
    if (envApiKey && envApiKey.trim() !== '') {
      this.initialize(envApiKey);
    }
  }

  // Initialize the service with an API key
  initialize(apiKey: string): void {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('API key is required');
    }

    this.apiKey = apiKey;
    this.client = new Anthropic({
      apiKey: this.apiKey,
      defaultHeaders: {
        'anthropic-beta': 'interleaved-thinking-2025-05-14'
      }
    });
  }

  // Check if the service is initialized
  isInitialized(): boolean {
    return this.client !== null;
  }

  // Convert chat messages to Anthropic format
  private convertMessages(messages: ChatMessage[]): {
    systemPrompt: string | undefined;
    anthropicMessages: Anthropic.MessageParam[];
  } {
    let systemPrompt: string | undefined;
    const anthropicMessages: Anthropic.MessageParam[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') {
        systemPrompt = msg.content;
      } else {
        anthropicMessages.push({
          role: msg.role,
          content: msg.content
        });
      }
    }

    return { systemPrompt, anthropicMessages };
  }

  // Send a message and get a response with extended thinking
  async chat(messages: ChatMessage[]): Promise<LLMResponse> {
    if (!this.client) {
      throw new Error('LangChain service not initialized. Call initialize() with API key first.');
    }

    const { systemPrompt, anthropicMessages } = this.convertMessages(messages);

    const response = await this.client.messages.create({
      model: MODEL_ID,
      max_tokens: MAX_TOKENS,
      thinking: {
        type: 'enabled',
        budget_tokens: THINKING_BUDGET_TOKENS
      },
      system: systemPrompt,
      messages: anthropicMessages
    });

    // Extract content and thinking from response
    let content = '';
    let thinking = '';

    for (const block of response.content) {
      if (block.type === 'thinking') {
        thinking = block.thinking;
      } else if (block.type === 'text') {
        content += block.text;
      }
    }

    // Extract token usage
    const tokenUsage = {
      input: response.usage.input_tokens,
      output: response.usage.output_tokens,
      total: response.usage.input_tokens + response.usage.output_tokens
    };

    return {
      content,
      thinking,
      tokenUsage
    };
  }

  // Stream chunk types for distinguishing content
  // Format: "thinking:" prefix for thinking, "text:" prefix for text, "thinking_done:" for end of thinking
  async *chatStream(messages: ChatMessage[]): AsyncGenerator<string, void, unknown> {
    if (!this.client) {
      throw new Error('LangChain service not initialized. Call initialize() with API key first.');
    }

    const { systemPrompt, anthropicMessages } = this.convertMessages(messages);

    const stream = this.client.messages.stream({
      model: MODEL_ID,
      max_tokens: MAX_TOKENS,
      thinking: {
        type: 'enabled',
        budget_tokens: THINKING_BUDGET_TOKENS
      },
      system: systemPrompt,
      messages: anthropicMessages
    });

    // Track if we're in thinking mode
    let isThinking = false;

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        if (event.content_block.type === 'thinking') {
          isThinking = true;
          yield 'thinking_start:';
        } else {
          if (isThinking) {
            yield 'thinking_done:';
          }
          isThinking = false;
        }
      } else if (event.type === 'content_block_delta') {
        if (isThinking && event.delta.type === 'thinking_delta') {
          // Yield thinking content with prefix
          yield `thinking:${event.delta.thinking}`;
        } else if (!isThinking && event.delta.type === 'text_delta') {
          // Yield text content with prefix
          yield `text:${event.delta.text}`;
        }
      }
    }
  }

  // Stream with tools support - yields structured events
  // Supports both regular tools (Anthropic.Tool) and server tools (WebSearchTool)
  async *chatStreamWithTools(
    messages: ChatMessage[],
    tools?: Anthropic.ToolUnion[]
  ): AsyncGenerator<StreamEvent, void, unknown> {
    if (!this.client) {
      throw new Error('LangChain service not initialized. Call initialize() with API key first.');
    }

    const { systemPrompt, anthropicMessages } = this.convertMessages(messages);

    // Build request options
    const requestOptions: Anthropic.MessageCreateParamsStreaming = {
      model: MODEL_ID,
      max_tokens: MAX_TOKENS,
      thinking: {
        type: 'enabled',
        budget_tokens: THINKING_BUDGET_TOKENS
      },
      system: systemPrompt,
      messages: anthropicMessages,
      stream: true
    };

    // Add tools if provided
    if (tools && tools.length > 0) {
      requestOptions.tools = tools;
    }

    const stream = this.client.messages.stream(requestOptions);

    // Track current state
    let isThinking = false;
    let currentToolCall: ToolCall | null = null;
    let toolInputJson = '';
    let thinkingContent = '';
    let thinkingSignature: string | undefined;
    let currentBlockIndex = -1;

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const block = event.content_block;
        currentBlockIndex = event.index;

        // Debug: log all block types to see what Anthropic is sending
        console.log('[LangChain] content_block_start type:', block.type, 'block:', JSON.stringify(block).slice(0, 200));

        if (block.type === 'thinking') {
          isThinking = true;
          thinkingContent = '';
          yield { type: 'thinking_start' };
        } else if (block.type === 'tool_use') {
          if (isThinking) {
            yield { type: 'thinking_done', signature: thinkingSignature };
            isThinking = false;
          }
          // Emit tool_start immediately - UI can show loading state
          yield { type: 'tool_start', toolId: block.id, toolName: block.name };
          // Start of tool use block
          currentToolCall = {
            id: block.id,
            name: block.name,
            input: {}
          };
          toolInputJson = '';
        } else if (block.type === 'server_tool_use') {
          // Server tool use (e.g., web search) - handled by Anthropic
          if (isThinking) {
            yield { type: 'thinking_done', signature: thinkingSignature };
            isThinking = false;
          }
          // Emit web_search event for the frontend
          yield {
            type: 'web_search',
            toolId: block.id,
            searchQuery: (block.input as { query?: string })?.query || ''
          };
        } else if (block.type === 'web_search_tool_result') {
          // Web search results from Anthropic native web search
          // Note: Anthropic encrypts the page content (encrypted_content) for model use only
          // For display, we only have title, url, and page_age
          const resultBlock = block as Anthropic.WebSearchToolResultBlock;
          const content = resultBlock.content;
          const searchResults: WebSearchResultItem[] = [];

          // Content can be an array of results or an error object
          if (Array.isArray(content)) {
            content.forEach((item, idx) => {
              if (item.type === 'web_search_result') {
                const r = item as Anthropic.WebSearchResultBlock;
                searchResults.push({
                  rank: idx + 1,
                  title: r.title || '',
                  url: r.url,
                  snippet: r.page_age ? `Published: ${r.page_age}` : ''
                });
              }
            });
          }

          yield {
            type: 'web_search_result',
            toolId: resultBlock.tool_use_id,
            searchResults
          };
        } else {
          if (isThinking) {
            yield { type: 'thinking_done', signature: thinkingSignature };
            isThinking = false;
          }
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;

        if (delta.type === 'thinking_delta') {
          thinkingContent += delta.thinking;
          yield { type: 'thinking', content: delta.thinking };
        } else if (delta.type === 'text_delta') {
          yield { type: 'text', content: delta.text };
        } else if (delta.type === 'input_json_delta') {
          // Accumulate tool input JSON
          toolInputJson += delta.partial_json;
          // Emit delta for live streaming of tool input
          if (currentToolCall) {
            yield {
              type: 'tool_input_delta',
              toolId: currentToolCall.id,
              toolName: currentToolCall.name,
              partialInput: toolInputJson
            };
          }
        } else if (delta.type === 'signature_delta' && 'signature' in delta) {
          // Capture the thinking signature
          thinkingSignature = (delta as { type: 'signature_delta'; signature: string }).signature;
        }
      } else if (event.type === 'content_block_stop') {
        // If we were building a tool call, finalize it
        if (currentToolCall) {
          try {
            currentToolCall.input = toolInputJson ? JSON.parse(toolInputJson) : {};
          } catch {
            currentToolCall.input = {};
          }
          yield { type: 'tool_use', toolCall: currentToolCall };
          currentToolCall = null;
          toolInputJson = '';
        }
      } else if (event.type === 'message_stop') {
        // End of message
      } else if (event.type === 'message_delta') {
        if (event.delta.stop_reason) {
          // Capture usage from the delta event (handle null values)
          const usage = event.usage ? {
            inputTokens: event.usage.input_tokens ?? 0,
            outputTokens: event.usage.output_tokens
          } : undefined;

          yield {
            type: 'done',
            stopReason: event.delta.stop_reason,
            thinkingData: thinkingContent ? { content: thinkingContent, signature: thinkingSignature } : undefined,
            usage
          };
        }
      }
    }
  }

  // Continue conversation with FULL history of all previous turns
  // This properly includes ALL thinking blocks from ALL rounds as required by the API
  async *continueWithFullHistory(
    baseMessages: ChatMessage[],
    conversationTurns: ConversationTurn[],
    tools?: Anthropic.ToolUnion[]
  ): AsyncGenerator<StreamEvent, void, unknown> {
    if (!this.client) {
      throw new Error('LangChain service not initialized.');
    }

    const { systemPrompt, anthropicMessages } = this.convertMessages(baseMessages);

    // Build the full message history with ALL previous turns
    const allMessages: Anthropic.MessageParam[] = [...anthropicMessages];

    // Add each conversation turn (assistant response + tool results)
    for (const turn of conversationTurns) {
      // Add assistant message with all content blocks (thinking, text, tool_use)
      allMessages.push({
        role: 'assistant',
        content: turn.assistantContent
      });

      // Add user message with tool results
      allMessages.push({
        role: 'user',
        content: turn.toolResults.map(result => ({
          type: 'tool_result' as const,
          tool_use_id: result.tool_use_id,
          content: result.content
        }))
      });
    }

    const requestOptions: Anthropic.MessageCreateParamsStreaming = {
      model: MODEL_ID,
      max_tokens: MAX_TOKENS,
      thinking: {
        type: 'enabled',
        budget_tokens: THINKING_BUDGET_TOKENS
      },
      system: systemPrompt,
      messages: allMessages,
      stream: true
    };

    if (tools && tools.length > 0) {
      requestOptions.tools = tools;
    }

    const stream = this.client.messages.stream(requestOptions);

    // Track current state
    let isThinking = false;
    let currentToolCall: ToolCall | null = null;
    let toolInputJson = '';
    let thinkingContent = '';
    let thinkingSignature: string | undefined;

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const block = event.content_block;

        // Debug: log all block types
        console.log('[LangChain-Cont] content_block_start type:', block.type);

        if (block.type === 'thinking') {
          isThinking = true;
          thinkingContent = '';
          yield { type: 'thinking_start' };
        } else if (block.type === 'tool_use') {
          if (isThinking) {
            yield { type: 'thinking_done', signature: thinkingSignature };
            isThinking = false;
          }
          // Emit tool_start immediately - UI can show loading state
          yield { type: 'tool_start', toolId: block.id, toolName: block.name };
          currentToolCall = {
            id: block.id,
            name: block.name,
            input: {}
          };
          toolInputJson = '';
        } else if (block.type === 'server_tool_use') {
          // Server tool use (e.g., web search) - handled by Anthropic
          if (isThinking) {
            yield { type: 'thinking_done', signature: thinkingSignature };
            isThinking = false;
          }
          // Emit web_search event for the frontend
          yield {
            type: 'web_search',
            toolId: block.id,
            searchQuery: (block.input as { query?: string })?.query || ''
          };
        } else if (block.type === 'web_search_tool_result') {
          // Web search results from Anthropic native web search
          const resultBlock = block as Anthropic.WebSearchToolResultBlock;
          const content = resultBlock.content;
          const searchResults: WebSearchResultItem[] = [];

          if (Array.isArray(content)) {
            content.forEach((item, idx) => {
              if (item.type === 'web_search_result') {
                const r = item as Anthropic.WebSearchResultBlock;
                searchResults.push({
                  rank: idx + 1,
                  title: r.title || '',
                  url: r.url,
                  snippet: r.page_age ? `Published: ${r.page_age}` : ''
                });
              }
            });
          }

          yield {
            type: 'web_search_result',
            toolId: resultBlock.tool_use_id,
            searchResults
          };
        } else {
          if (isThinking) {
            yield { type: 'thinking_done', signature: thinkingSignature };
            isThinking = false;
          }
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;

        if (delta.type === 'thinking_delta') {
          thinkingContent += delta.thinking;
          yield { type: 'thinking', content: delta.thinking };
        } else if (delta.type === 'text_delta') {
          yield { type: 'text', content: delta.text };
        } else if (delta.type === 'input_json_delta') {
          toolInputJson += delta.partial_json;
          // Emit delta for live streaming of tool input
          if (currentToolCall) {
            yield {
              type: 'tool_input_delta',
              toolId: currentToolCall.id,
              toolName: currentToolCall.name,
              partialInput: toolInputJson
            };
          }
        } else if (delta.type === 'signature_delta' && 'signature' in delta) {
          // Capture the thinking signature
          thinkingSignature = (delta as { type: 'signature_delta'; signature: string }).signature;
        }
      } else if (event.type === 'content_block_stop') {
        if (currentToolCall) {
          try {
            currentToolCall.input = toolInputJson ? JSON.parse(toolInputJson) : {};
          } catch {
            currentToolCall.input = {};
          }
          yield { type: 'tool_use', toolCall: currentToolCall };
          currentToolCall = null;
          toolInputJson = '';
        }
      } else if (event.type === 'message_delta') {
        if (event.delta.stop_reason) {
          // Capture usage from the delta event (handle null values)
          const usage = event.usage ? {
            inputTokens: event.usage.input_tokens ?? 0,
            outputTokens: event.usage.output_tokens
          } : undefined;

          yield {
            type: 'done',
            stopReason: event.delta.stop_reason,
            thinkingData: thinkingContent ? { content: thinkingContent, signature: thinkingSignature } : undefined,
            usage
          };
        }
      }
    }
  }

  // Clear the API key and client
  clear(): void {
    this.client = null;
    this.apiKey = null;
  }
}

// Singleton instance of the LangChain service
export const langChainService = new LangChainService();
