import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// AI IPC channel names (must match main process)
const AI_CHANNELS = {
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
  SYNTHESIS_STREAM_ERROR: 'ai:synthesis-stream-error'
} as const;

// File builder IPC channel names (must match main process)
const FILE_BUILDER_CHANNELS = {
  FILES_CREATE: 'files:create',
  FILES_READ: 'files:read',
  FILES_UPDATE: 'files:update',
  FILES_DELETE: 'files:delete',
  FILES_LIST: 'files:list',
  FILES_GET_ENTRY: 'files:get-entry',
  FILES_SET_ENTRY: 'files:set-entry',
  FILES_MODIFY_LINES: 'files:modify-lines',
  APP_BUILDER_STREAM: 'ai:app-builder-stream',
  APP_BUILDER_STREAM_EVENT: 'ai:app-builder-stream-event',
  APP_BUILDER_STREAM_END: 'ai:app-builder-stream-end',
  APP_BUILDER_STREAM_ERROR: 'ai:app-builder-stream-error'
} as const;

// Web search result interface
interface WebSearchResultItem {
  rank: number;
  title: string;
  url: string;
  snippet: string;
}

// Proposed note interface - AI suggests notes for user approval
interface ProposedNote {
  id: string;
  title: string;
  content: string;
  category: 'research' | 'decision' | 'recommendation' | 'insight' | 'warning' | 'todo';
  ideaId: string;
}

// Stream event types for synthesis
// tool_start: Emitted immediately when tool block starts streaming (name and ID known)
// tool_input_delta: Emitted as tool input JSON streams in (for live content preview)
// tool_use: Emitted when tool block is complete (full input parsed)
// web_search: Emitted when AI starts a web search
// web_search_result: Emitted with search results
// note_proposal: Emitted when AI proposes adding a note (requires user approval)
interface SynthesisStreamEvent {
  type: 'thinking_start' | 'thinking' | 'thinking_done' | 'text' | 'tool_start' | 'tool_input_delta' | 'tool_use' | 'tool_result' | 'web_search' | 'web_search_result' | 'note_proposal' | 'done';
  content?: string;
  toolCall?: { id: string; name: string; input: Record<string, unknown> };
  toolId?: string;
  toolName?: string;
  partialInput?: string;
  result?: { success: boolean; data?: unknown; error?: string };
  stopReason?: string;
  // Web search specific fields
  searchQuery?: string;
  searchResults?: WebSearchResultItem[];
  // Note proposal fields
  proposal?: ProposedNote;
}

// Database IPC channel names (must match main process)
const DB_CHANNELS = {
  CREATE_CONVERSATION: 'db:create-conversation',
  GET_CONVERSATION: 'db:get-conversation',
  GET_ALL_CONVERSATIONS: 'db:get-all-conversations',
  UPDATE_CONVERSATION: 'db:update-conversation',
  DELETE_CONVERSATION: 'db:delete-conversation',
  GET_CONVERSATION_WITH_MESSAGES: 'db:get-conversation-with-messages',
  ADD_MESSAGE: 'db:add-message',
  GET_MESSAGES: 'db:get-messages',
  DELETE_MESSAGE: 'db:delete-message'
} as const;

// Ideas IPC channel names (must match main process)
const IDEAS_CHANNELS = {
  CREATE_IDEA: 'ideas:create',
  GET_IDEA: 'ideas:get',
  GET_ALL_IDEAS: 'ideas:get-all',
  GET_IDEAS_BY_STATUS: 'ideas:get-by-status',
  UPDATE_IDEA: 'ideas:update',
  DELETE_IDEA: 'ideas:delete',
  GET_IDEA_WITH_NOTES: 'ideas:get-with-notes',
  ADD_NOTE: 'ideas:add-note',
  GET_NOTES: 'ideas:get-notes',
  DELETE_NOTE: 'ideas:delete-note',
  ACCEPT_NOTE_PROPOSAL: 'ideas:accept-note-proposal',
  CREATE_SYNTHESIS: 'ideas:create-synthesis',
  GET_SYNTHESIS: 'ideas:get-synthesis',
  HAS_SYNTHESIS: 'ideas:has-synthesis',
  DELETE_SYNTHESIS: 'ideas:delete-synthesis',
  GET_IDEA_FULL: 'ideas:get-full',
  STT_INITIALIZE: 'stt:initialize',
  STT_IS_INITIALIZED: 'stt:is-initialized',
  STT_TRANSCRIBE: 'stt:transcribe',
  STT_CLEAR: 'stt:clear',
  DEV_SEED: 'dev:seed'
} as const;

// Message type for chat
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

// Response from the LLM
interface LLMResponse {
  content: string;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
}

// Initialize result type
interface InitializeResult {
  success: boolean;
  error?: string;
}

// Database types
interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  systemPrompt: string | null;
  model: string;
  totalInputTokens: number;
  totalOutputTokens: number;
}

interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
  inputTokens: number | null;
  outputTokens: number | null;
  thinking: string | null;
  contentBlocks: string | null;
}

// Ideas types
interface Idea {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  status: 'active' | 'completed' | 'archived';
  conversationId: string | null;
  synthesisContent: string | null;
  synthesisVersion: number | null;
  synthesisUpdatedAt: Date | null;
}

interface Note {
  id: string;
  ideaId: string;
  content: string;
  durationMs: number | null;
  createdAt: Date;
}

interface TranscriptionResult {
  text: string;
  durationMs?: number;
}

// Project file type
interface ProjectFile {
  id: string;
  ideaId: string;
  filePath: string;
  content: string;
  fileType: 'tsx' | 'ts' | 'css';
  isEntryFile: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// App builder stream event type
interface AppBuilderStreamEvent {
  type: 'thinking_start' | 'thinking' | 'thinking_done' | 'text' | 'tool_start' | 'tool_input_delta' | 'tool_use' | 'tool_result' | 'done';
  content?: string;
  toolCall?: { id: string; name: string; input: Record<string, unknown> };
  toolId?: string;
  toolName?: string;
  partialInput?: string;
  result?: { success: boolean; data?: unknown; error?: string };
  stopReason?: string;
}

// Dependency Nodes IPC channel names (must match main process)
const DEPENDENCY_NODES_CHANNELS = {
  NODES_CREATE: 'dependency-nodes:create',
  NODES_GET: 'dependency-nodes:get',
  NODES_LIST: 'dependency-nodes:list',
  NODES_UPDATE: 'dependency-nodes:update',
  NODES_UPDATE_POSITION: 'dependency-nodes:update-position',
  NODES_DELETE: 'dependency-nodes:delete',
  CONNECTIONS_CREATE: 'dependency-nodes:connect',
  CONNECTIONS_DELETE: 'dependency-nodes:disconnect',
  CONNECTIONS_LIST: 'dependency-nodes:connections',
  NODES_FULL_STATE: 'dependency-nodes:full-state',
  DEPENDENCY_NODES_STREAM: 'ai:dependency-nodes-stream',
  DEPENDENCY_NODES_STREAM_EVENT: 'ai:dependency-nodes-stream-event',
  DEPENDENCY_NODES_STREAM_END: 'ai:dependency-nodes-stream-end',
  DEPENDENCY_NODES_STREAM_ERROR: 'ai:dependency-nodes-stream-error'
} as const;

// Pricing/licensing information structure
interface PricingInfo {
  model: string;
  tiers?: Array<{ name: string; price: string; features: string[] }>;
  perRequest?: string;
  perUnit?: string;
  freeQuota?: string;
  notes?: string;
}

// Dependency Node type
interface DependencyNode {
  id: string;
  ideaId: string;
  name: string;
  provider: string;
  description: string;
  pricing: string | null;
  positionX: number;
  positionY: number;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Dependency Node Connection type
interface DependencyNodeConnection {
  id: string;
  ideaId: string;
  fromNodeId: string;
  toNodeId: string;
  label: string | null;
  createdAt: Date;
}

// Dependency Nodes stream event type
interface DependencyNodesStreamEvent {
  type: 'thinking_start' | 'thinking' | 'thinking_done' | 'text' | 'tool_start' | 'tool_input_delta' | 'tool_use' | 'tool_result' | 'web_search' | 'web_search_result' | 'note_proposal' | 'done';
  content?: string;
  toolCall?: { id: string; name: string; input: Record<string, unknown> };
  toolId?: string;
  toolName?: string;
  partialInput?: string;
  result?: { success: boolean; data?: unknown; error?: string };
  stopReason?: string;
  searchQuery?: string;
  searchResults?: Array<{ rank: number; title: string; url: string; snippet: string }>;
  proposal?: { id: string; title: string; content: string; category: string; ideaId: string };
}

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform information
  platform: process.platform,

  // AI API methods
  ai: {
    initialize: (apiKey: string): Promise<InitializeResult> => {
      return ipcRenderer.invoke(AI_CHANNELS.INITIALIZE, apiKey);
    },
    isInitialized: (): Promise<boolean> => {
      return ipcRenderer.invoke(AI_CHANNELS.IS_INITIALIZED);
    },
    chat: (messages: ChatMessage[]): Promise<LLMResponse> => {
      return ipcRenderer.invoke(AI_CHANNELS.CHAT, messages);
    },
    chatStream: (
      messages: ChatMessage[],
      onChunk: (chunk: string) => void,
      onEnd: () => void,
      onError: (error: string) => void
    ): Promise<() => void> => {
      const chunkHandler = (_event: IpcRendererEvent, chunk: string) => onChunk(chunk);
      const endHandler = () => onEnd();
      const errorHandler = (_event: IpcRendererEvent, error: string) => onError(error);

      ipcRenderer.on(AI_CHANNELS.CHAT_STREAM_CHUNK, chunkHandler);
      ipcRenderer.once(AI_CHANNELS.CHAT_STREAM_END, endHandler);
      ipcRenderer.once(AI_CHANNELS.CHAT_STREAM_ERROR, errorHandler);

      ipcRenderer.invoke(AI_CHANNELS.CHAT_STREAM, messages);

      return Promise.resolve(() => {
        ipcRenderer.removeListener(AI_CHANNELS.CHAT_STREAM_CHUNK, chunkHandler);
        ipcRenderer.removeListener(AI_CHANNELS.CHAT_STREAM_END, endHandler);
        ipcRenderer.removeListener(AI_CHANNELS.CHAT_STREAM_ERROR, errorHandler);
      });
    },
    clear: (): Promise<void> => {
      return ipcRenderer.invoke(AI_CHANNELS.CLEAR);
    },
    // Synthesis stream with tools support
    synthesisStream: (
      ideaId: string,
      messages: ChatMessage[],
      onEvent: (event: SynthesisStreamEvent) => void,
      onEnd: () => void,
      onError: (error: string) => void
    ): Promise<() => void> => {
      const eventHandler = (_event: IpcRendererEvent, streamEvent: SynthesisStreamEvent) => onEvent(streamEvent);
      const endHandler = () => onEnd();
      const errorHandler = (_event: IpcRendererEvent, error: string) => onError(error);

      ipcRenderer.on(AI_CHANNELS.SYNTHESIS_STREAM_EVENT, eventHandler);
      ipcRenderer.once(AI_CHANNELS.SYNTHESIS_STREAM_END, endHandler);
      ipcRenderer.once(AI_CHANNELS.SYNTHESIS_STREAM_ERROR, errorHandler);

      ipcRenderer.invoke(AI_CHANNELS.SYNTHESIS_STREAM, ideaId, messages);

      return Promise.resolve(() => {
        ipcRenderer.removeListener(AI_CHANNELS.SYNTHESIS_STREAM_EVENT, eventHandler);
        ipcRenderer.removeListener(AI_CHANNELS.SYNTHESIS_STREAM_END, endHandler);
        ipcRenderer.removeListener(AI_CHANNELS.SYNTHESIS_STREAM_ERROR, errorHandler);
      });
    }
  },

  // Database API methods
  db: {
    createConversation: (data: { title: string; systemPrompt?: string; model?: string }): Promise<Conversation> => {
      return ipcRenderer.invoke(DB_CHANNELS.CREATE_CONVERSATION, data);
    },
    getConversation: (id: string): Promise<Conversation | null> => {
      return ipcRenderer.invoke(DB_CHANNELS.GET_CONVERSATION, id);
    },
    getAllConversations: (): Promise<Conversation[]> => {
      return ipcRenderer.invoke(DB_CHANNELS.GET_ALL_CONVERSATIONS);
    },
    updateConversation: (id: string, data: Partial<Pick<Conversation, 'title' | 'systemPrompt' | 'model'>>): Promise<Conversation> => {
      return ipcRenderer.invoke(DB_CHANNELS.UPDATE_CONVERSATION, id, data);
    },
    deleteConversation: (id: string): Promise<void> => {
      return ipcRenderer.invoke(DB_CHANNELS.DELETE_CONVERSATION, id);
    },
    getConversationWithMessages: (id: string): Promise<{ conversation: Conversation; messages: Message[] } | null> => {
      return ipcRenderer.invoke(DB_CHANNELS.GET_CONVERSATION_WITH_MESSAGES, id);
    },
    addMessage: (data: {
      conversationId: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      inputTokens?: number;
      outputTokens?: number;
      thinking?: string;
      contentBlocks?: unknown[];
    }): Promise<Message> => {
      return ipcRenderer.invoke(DB_CHANNELS.ADD_MESSAGE, data);
    },
    getMessages: (conversationId: string): Promise<Message[]> => {
      return ipcRenderer.invoke(DB_CHANNELS.GET_MESSAGES, conversationId);
    },
    deleteMessage: (id: string): Promise<void> => {
      return ipcRenderer.invoke(DB_CHANNELS.DELETE_MESSAGE, id);
    }
  },

  // Ideas API methods
  ideas: {
    create: (data: { title: string }): Promise<Idea> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.CREATE_IDEA, data);
    },
    get: (id: string): Promise<Idea | null> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.GET_IDEA, id);
    },
    getAll: (): Promise<Idea[]> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.GET_ALL_IDEAS);
    },
    getByStatus: (status: 'active' | 'completed' | 'archived'): Promise<Idea[]> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.GET_IDEAS_BY_STATUS, status);
    },
    update: (id: string, data: Partial<Pick<Idea, 'title' | 'status'>>): Promise<Idea> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.UPDATE_IDEA, id, data);
    },
    delete: (id: string): Promise<void> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.DELETE_IDEA, id);
    },
    getWithNotes: (id: string): Promise<{ idea: Idea; notes: Note[] } | null> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.GET_IDEA_WITH_NOTES, id);
    },
    addNote: (data: { ideaId: string; content: string; durationMs?: number }): Promise<Note> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.ADD_NOTE, data);
    },
    getNotes: (ideaId: string): Promise<Note[]> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.GET_NOTES, ideaId);
    },
    acceptNoteProposal: (proposal: {
      ideaId: string;
      title: string;
      content: string;
      category: string;
    }): Promise<Note> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.ACCEPT_NOTE_PROPOSAL, proposal);
    },
    deleteNote: (id: string): Promise<void> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.DELETE_NOTE, id);
    },
    // Synthesis conversation methods
    createSynthesis: (ideaId: string): Promise<{ conversation: Conversation; isNew: boolean }> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.CREATE_SYNTHESIS, ideaId);
    },
    getSynthesis: (ideaId: string): Promise<{ conversation: Conversation; messages: Message[] } | null> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.GET_SYNTHESIS, ideaId);
    },
    hasSynthesis: (ideaId: string): Promise<boolean> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.HAS_SYNTHESIS, ideaId);
    },
    deleteSynthesis: (ideaId: string): Promise<void> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.DELETE_SYNTHESIS, ideaId);
    },
    getFull: (ideaId: string): Promise<{
      idea: Idea;
      notes: Note[];
      conversation: Conversation | null;
      messages: Message[];
    } | null> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.GET_IDEA_FULL, ideaId);
    }
  },

  // Speech-to-text API methods
  stt: {
    initialize: (apiKey: string): Promise<InitializeResult> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.STT_INITIALIZE, apiKey);
    },
    isInitialized: (): Promise<boolean> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.STT_IS_INITIALIZED);
    },
    transcribe: (audioData: number[], mimeType: string): Promise<TranscriptionResult> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.STT_TRANSCRIBE, audioData, mimeType);
    },
    clear: (): Promise<void> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.STT_CLEAR);
    }
  },

  // Dev API methods
  dev: {
    seed: (): Promise<{ ideas: number; notes: number }> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.DEV_SEED);
    }
  },

  // Sandbox preload bundle
  sandbox: {
    getPreload: (): Promise<{ success: boolean; content?: string; error?: string }> => {
      return ipcRenderer.invoke('sandbox:get-preload');
    }
  },

  // Files API methods for app builder
  files: {
    create: (ideaId: string, filePath: string, content: string, isEntryFile?: boolean): Promise<ProjectFile> => {
      return ipcRenderer.invoke(FILE_BUILDER_CHANNELS.FILES_CREATE, ideaId, filePath, content, isEntryFile);
    },
    read: (ideaId: string, filePath: string): Promise<ProjectFile | null> => {
      return ipcRenderer.invoke(FILE_BUILDER_CHANNELS.FILES_READ, ideaId, filePath);
    },
    update: (ideaId: string, filePath: string, content: string): Promise<ProjectFile> => {
      return ipcRenderer.invoke(FILE_BUILDER_CHANNELS.FILES_UPDATE, ideaId, filePath, content);
    },
    delete: (ideaId: string, filePath: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(FILE_BUILDER_CHANNELS.FILES_DELETE, ideaId, filePath);
    },
    list: (ideaId: string): Promise<ProjectFile[]> => {
      return ipcRenderer.invoke(FILE_BUILDER_CHANNELS.FILES_LIST, ideaId);
    },
    getEntryFile: (ideaId: string): Promise<ProjectFile | null> => {
      return ipcRenderer.invoke(FILE_BUILDER_CHANNELS.FILES_GET_ENTRY, ideaId);
    },
    setEntryFile: (ideaId: string, filePath: string): Promise<ProjectFile> => {
      return ipcRenderer.invoke(FILE_BUILDER_CHANNELS.FILES_SET_ENTRY, ideaId, filePath);
    },
    modifyLines: (ideaId: string, filePath: string, startLine: number, endLine: number, newContent: string): Promise<ProjectFile> => {
      return ipcRenderer.invoke(FILE_BUILDER_CHANNELS.FILES_MODIFY_LINES, ideaId, filePath, startLine, endLine, newContent);
    },
    // App builder AI stream with file tools
    appBuilderStream: (
      ideaId: string,
      messages: ChatMessage[],
      onEvent: (event: AppBuilderStreamEvent) => void,
      onEnd: () => void,
      onError: (error: string) => void
    ): Promise<() => void> => {
      const eventHandler = (_event: IpcRendererEvent, streamEvent: AppBuilderStreamEvent) => onEvent(streamEvent);
      const endHandler = () => onEnd();
      const errorHandler = (_event: IpcRendererEvent, error: string) => onError(error);

      ipcRenderer.on(FILE_BUILDER_CHANNELS.APP_BUILDER_STREAM_EVENT, eventHandler);
      ipcRenderer.once(FILE_BUILDER_CHANNELS.APP_BUILDER_STREAM_END, endHandler);
      ipcRenderer.once(FILE_BUILDER_CHANNELS.APP_BUILDER_STREAM_ERROR, errorHandler);

      ipcRenderer.invoke(FILE_BUILDER_CHANNELS.APP_BUILDER_STREAM, ideaId, messages);

      return Promise.resolve(() => {
        ipcRenderer.removeListener(FILE_BUILDER_CHANNELS.APP_BUILDER_STREAM_EVENT, eventHandler);
        ipcRenderer.removeListener(FILE_BUILDER_CHANNELS.APP_BUILDER_STREAM_END, endHandler);
        ipcRenderer.removeListener(FILE_BUILDER_CHANNELS.APP_BUILDER_STREAM_ERROR, errorHandler);
      });
    }
  },

  // Dependency Nodes methods
  dependencyNodes: {
    create: (ideaId: string, data: {
      name: string;
      provider: string;
      description: string;
      pricing?: PricingInfo;
      positionX?: number;
      positionY?: number;
      color?: string;
    }): Promise<DependencyNode> => {
      return ipcRenderer.invoke(DEPENDENCY_NODES_CHANNELS.NODES_CREATE, ideaId, data);
    },
    get: (nodeId: string): Promise<DependencyNode | null> => {
      return ipcRenderer.invoke(DEPENDENCY_NODES_CHANNELS.NODES_GET, nodeId);
    },
    list: (ideaId: string): Promise<DependencyNode[]> => {
      return ipcRenderer.invoke(DEPENDENCY_NODES_CHANNELS.NODES_LIST, ideaId);
    },
    update: (nodeId: string, data: {
      name?: string;
      provider?: string;
      description?: string;
      pricing?: PricingInfo;
      color?: string;
    }): Promise<DependencyNode> => {
      return ipcRenderer.invoke(DEPENDENCY_NODES_CHANNELS.NODES_UPDATE, nodeId, data);
    },
    updatePosition: (nodeId: string, positionX: number, positionY: number): Promise<DependencyNode> => {
      return ipcRenderer.invoke(DEPENDENCY_NODES_CHANNELS.NODES_UPDATE_POSITION, nodeId, positionX, positionY);
    },
    delete: (nodeId: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(DEPENDENCY_NODES_CHANNELS.NODES_DELETE, nodeId);
    },
    connect: (ideaId: string, fromNodeId: string, toNodeId: string, label?: string): Promise<DependencyNodeConnection> => {
      return ipcRenderer.invoke(DEPENDENCY_NODES_CHANNELS.CONNECTIONS_CREATE, ideaId, fromNodeId, toNodeId, label);
    },
    disconnect: (fromNodeId: string, toNodeId: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(DEPENDENCY_NODES_CHANNELS.CONNECTIONS_DELETE, fromNodeId, toNodeId);
    },
    getConnections: (ideaId: string): Promise<DependencyNodeConnection[]> => {
      return ipcRenderer.invoke(DEPENDENCY_NODES_CHANNELS.CONNECTIONS_LIST, ideaId);
    },
    getFullState: (ideaId: string): Promise<{ nodes: DependencyNode[]; connections: DependencyNodeConnection[] }> => {
      return ipcRenderer.invoke(DEPENDENCY_NODES_CHANNELS.NODES_FULL_STATE, ideaId);
    },
    // Dependency nodes AI stream with node tools
    dependencyNodesStream: (
      ideaId: string,
      messages: ChatMessage[],
      onEvent: (event: DependencyNodesStreamEvent) => void,
      onEnd: () => void,
      onError: (error: string) => void
    ): Promise<() => void> => {
      const eventHandler = (_event: IpcRendererEvent, streamEvent: DependencyNodesStreamEvent) => onEvent(streamEvent);
      const endHandler = () => onEnd();
      const errorHandler = (_event: IpcRendererEvent, error: string) => onError(error);

      ipcRenderer.on(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_EVENT, eventHandler);
      ipcRenderer.once(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_END, endHandler);
      ipcRenderer.once(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_ERROR, errorHandler);

      ipcRenderer.invoke(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM, ideaId, messages);

      return Promise.resolve(() => {
        ipcRenderer.removeListener(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_EVENT, eventHandler);
        ipcRenderer.removeListener(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_END, endHandler);
        ipcRenderer.removeListener(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM_ERROR, errorHandler);
      });
    }
  },

  // MCP (Firecrawl) methods
  mcp: {
    initialize: (apiKey: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('mcp:initialize', apiKey);
    },
    isInitialized: (): Promise<boolean> => {
      return ipcRenderer.invoke('mcp:is-initialized');
    },
    getTools: (): Promise<{ success: boolean; tools?: Array<{ name: string; description: string; inputSchema: unknown }>; error?: string }> => {
      return ipcRenderer.invoke('mcp:get-tools');
    },
    callTool: (name: string, args: Record<string, unknown>): Promise<{ success: boolean; data?: unknown; error?: string }> => {
      return ipcRenderer.invoke('mcp:call-tool', name, args);
    },
    search: (query: string, options?: { limit?: number; lang?: string; country?: string; scrapeContent?: boolean }): Promise<{ success: boolean; data?: unknown; error?: string }> => {
      return ipcRenderer.invoke('mcp:search', query, options);
    },
    scrape: (url: string, options?: { formats?: string[]; onlyMainContent?: boolean }): Promise<{ success: boolean; data?: unknown; error?: string }> => {
      return ipcRenderer.invoke('mcp:scrape', url, options);
    },
    map: (url: string, options?: { limit?: number; search?: string }): Promise<{ success: boolean; data?: unknown; error?: string }> => {
      return ipcRenderer.invoke('mcp:map', url, options);
    },
    disconnect: (): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('mcp:disconnect');
    }
  }
});

// Type declarations for the exposed API
declare global {
  interface Window {
    electronAPI: {
      platform: NodeJS.Platform;
      ai: {
        initialize: (apiKey: string) => Promise<InitializeResult>;
        isInitialized: () => Promise<boolean>;
        chat: (messages: ChatMessage[]) => Promise<LLMResponse>;
        chatStream: (
          messages: ChatMessage[],
          onChunk: (chunk: string) => void,
          onEnd: () => void,
          onError: (error: string) => void
        ) => Promise<() => void>;
        clear: () => Promise<void>;
        synthesisStream: (
          ideaId: string,
          messages: ChatMessage[],
          onEvent: (event: SynthesisStreamEvent) => void,
          onEnd: () => void,
          onError: (error: string) => void
        ) => Promise<() => void>;
      };
      db: {
        createConversation: (data: { title: string; systemPrompt?: string; model?: string }) => Promise<Conversation>;
        getConversation: (id: string) => Promise<Conversation | null>;
        getAllConversations: () => Promise<Conversation[]>;
        updateConversation: (id: string, data: Partial<Pick<Conversation, 'title' | 'systemPrompt' | 'model'>>) => Promise<Conversation>;
        deleteConversation: (id: string) => Promise<void>;
        getConversationWithMessages: (id: string) => Promise<{ conversation: Conversation; messages: Message[] } | null>;
        addMessage: (data: {
          conversationId: string;
          role: 'user' | 'assistant' | 'system';
          content: string;
          inputTokens?: number;
          outputTokens?: number;
          thinking?: string;
          contentBlocks?: unknown[];
        }) => Promise<Message>;
        getMessages: (conversationId: string) => Promise<Message[]>;
        deleteMessage: (id: string) => Promise<void>;
      };
      ideas: {
        create: (data: { title: string }) => Promise<Idea>;
        get: (id: string) => Promise<Idea | null>;
        getAll: () => Promise<Idea[]>;
        getByStatus: (status: 'active' | 'completed' | 'archived') => Promise<Idea[]>;
        update: (id: string, data: Partial<Pick<Idea, 'title' | 'status'>>) => Promise<Idea>;
        delete: (id: string) => Promise<void>;
        getWithNotes: (id: string) => Promise<{ idea: Idea; notes: Note[] } | null>;
        addNote: (data: { ideaId: string; content: string; durationMs?: number }) => Promise<Note>;
        getNotes: (ideaId: string) => Promise<Note[]>;
        deleteNote: (id: string) => Promise<void>;
        acceptNoteProposal: (proposal: { ideaId: string; title: string; content: string; category: string }) => Promise<Note>;
        createSynthesis: (ideaId: string) => Promise<{ conversation: Conversation; isNew: boolean }>;
        getSynthesis: (ideaId: string) => Promise<{ conversation: Conversation; messages: Message[] } | null>;
        hasSynthesis: (ideaId: string) => Promise<boolean>;
        deleteSynthesis: (ideaId: string) => Promise<void>;
        getFull: (ideaId: string) => Promise<{
          idea: Idea;
          notes: Note[];
          conversation: Conversation | null;
          messages: Message[];
        } | null>;
      };
      stt: {
        initialize: (apiKey: string) => Promise<InitializeResult>;
        isInitialized: () => Promise<boolean>;
        transcribe: (audioData: number[], mimeType: string) => Promise<TranscriptionResult>;
        clear: () => Promise<void>;
      };
      dev: {
        seed: () => Promise<{ ideas: number; notes: number }>;
      };
      sandbox: {
        getPreload: () => Promise<{ success: boolean; content?: string; error?: string }>;
      };
      files: {
        create: (ideaId: string, filePath: string, content: string, isEntryFile?: boolean) => Promise<ProjectFile>;
        read: (ideaId: string, filePath: string) => Promise<ProjectFile | null>;
        update: (ideaId: string, filePath: string, content: string) => Promise<ProjectFile>;
        delete: (ideaId: string, filePath: string) => Promise<{ success: boolean }>;
        list: (ideaId: string) => Promise<ProjectFile[]>;
        getEntryFile: (ideaId: string) => Promise<ProjectFile | null>;
        setEntryFile: (ideaId: string, filePath: string) => Promise<ProjectFile>;
        modifyLines: (ideaId: string, filePath: string, startLine: number, endLine: number, newContent: string) => Promise<ProjectFile>;
        appBuilderStream: (
          ideaId: string,
          messages: ChatMessage[],
          onEvent: (event: AppBuilderStreamEvent) => void,
          onEnd: () => void,
          onError: (error: string) => void
        ) => Promise<() => void>;
      };
      dependencyNodes: {
        create: (ideaId: string, data: {
          name: string;
          provider: string;
          description: string;
          pricing?: PricingInfo;
          positionX?: number;
          positionY?: number;
          color?: string;
        }) => Promise<DependencyNode>;
        get: (nodeId: string) => Promise<DependencyNode | null>;
        list: (ideaId: string) => Promise<DependencyNode[]>;
        update: (nodeId: string, data: {
          name?: string;
          provider?: string;
          description?: string;
          pricing?: PricingInfo;
          color?: string;
        }) => Promise<DependencyNode>;
        updatePosition: (nodeId: string, positionX: number, positionY: number) => Promise<DependencyNode>;
        delete: (nodeId: string) => Promise<{ success: boolean }>;
        connect: (ideaId: string, fromNodeId: string, toNodeId: string, label?: string) => Promise<DependencyNodeConnection>;
        disconnect: (fromNodeId: string, toNodeId: string) => Promise<{ success: boolean }>;
        getConnections: (ideaId: string) => Promise<DependencyNodeConnection[]>;
        getFullState: (ideaId: string) => Promise<{ nodes: DependencyNode[]; connections: DependencyNodeConnection[] }>;
        dependencyNodesStream: (
          ideaId: string,
          messages: ChatMessage[],
          onEvent: (event: DependencyNodesStreamEvent) => void,
          onEnd: () => void,
          onError: (error: string) => void
        ) => Promise<() => void>;
      };
      mcp: {
        initialize: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
        isInitialized: () => Promise<boolean>;
        getTools: () => Promise<{ success: boolean; tools?: Array<{ name: string; description: string; inputSchema: unknown }>; error?: string }>;
        callTool: (name: string, args: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string }>;
        search: (query: string, options?: { limit?: number; lang?: string; country?: string; scrapeContent?: boolean }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
        scrape: (url: string, options?: { formats?: string[]; onlyMainContent?: boolean }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
        map: (url: string, options?: { limit?: number; search?: string }) => Promise<{ success: boolean; data?: unknown; error?: string }>;
        disconnect: () => Promise<{ success: boolean; error?: string }>;
      };
    };
  }
}
