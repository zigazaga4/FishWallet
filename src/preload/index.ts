import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

// AI IPC channel names (must match main process)
const AI_CHANNELS = {
  SYNTHESIS_STREAM: 'ai:synthesis-stream',
  SYNTHESIS_STREAM_EVENT: 'ai:synthesis-stream-event',
  SYNTHESIS_STREAM_END: 'ai:synthesis-stream-end',
  SYNTHESIS_STREAM_ERROR: 'ai:synthesis-stream-error',
  SYNTHESIS_ABORT: 'ai:synthesis-abort',
  CHECK_AVAILABLE: 'ai:check-available'
} as const;

// Dev server IPC channel names
const DEVSERVER_CHANNELS = {
  START: 'devserver:start',
  STOP: 'devserver:stop',
  STATUS: 'devserver:status'
} as const;

// Snapshot IPC channel names
const SNAPSHOT_CHANNELS = {
  LIST: 'snapshots:list',
  GET: 'snapshots:get',
  RESTORE: 'snapshots:restore',
  CREATED: 'idea:snapshot-created'
} as const;

// Backup IPC channel names
const BACKUP_CHANNELS = {
  CREATE: 'backup:create',
  LIST: 'backup:list',
  DELETE: 'backup:delete'
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
  type: 'thinking_start' | 'thinking' | 'thinking_done' | 'text' | 'tool_start' | 'tool_input_delta' | 'tool_use' | 'tool_result' | 'web_search' | 'web_search_result' | 'note_proposal' | 'round_complete' | 'error_user_message' | 'tool_progress' | 'subagent_done' | 'done';
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
  // Token usage (from done event)
  usage?: { inputTokens: number; outputTokens: number };
  // Sub-agent fields
  parentToolUseId?: string;
  elapsedSeconds?: number;
  summary?: string;
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
  DELETE_MESSAGE: 'db:delete-message',
  UPDATE_MESSAGE_CONTENT_BLOCKS: 'db:update-message-content-blocks'
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
  // Real-time STT
  REALTIME_STT_START: 'realtime-stt:start',
  REALTIME_STT_SEND_AUDIO: 'realtime-stt:send-audio',
  REALTIME_STT_STOP: 'realtime-stt:stop',
  REALTIME_STT_GET_TRANSCRIPT: 'realtime-stt:get-transcript',
  REALTIME_STT_DELTA: 'realtime-stt:delta',
  REALTIME_STT_COMPLETE: 'realtime-stt:complete',
  REALTIME_STT_ERROR: 'realtime-stt:error',
  DEV_SEED: 'dev:seed'
} as const;

// Initialize result type (used by STT)
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
  details: string | null;
  createdAt: Date;
}

// Dependency Nodes stream event type
interface DependencyNodesStreamEvent {
  type: 'thinking_start' | 'thinking' | 'thinking_done' | 'text' | 'tool_start' | 'tool_input_delta' | 'tool_use' | 'tool_result' | 'web_search' | 'web_search_result' | 'note_proposal' | 'round_complete' | 'error_user_message' | 'done';
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

// Idea snapshot interface
interface IdeaSnapshot {
  id: string;
  ideaId: string;
  versionNumber: number;
  synthesisContent: string | null;
  filesSnapshot: string;
  nodesSnapshot: string;
  connectionsSnapshot: string;
  toolsUsed: string | null;
  createdAt: Date;
}

// Conversation branch interface
interface ConversationBranch {
  id: string;
  ideaId: string;
  parentBranchId: string | null;
  conversationId: string | null;
  label: string;
  depth: number;
  synthesisContent: string | null;
  filesSnapshot: string;
  nodesSnapshot: string;
  connectionsSnapshot: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Branch IPC channel names
const BRANCH_CHANNELS = {
  GET_ALL: 'branches:get-all',
  GET: 'branches:get',
  GET_ACTIVE: 'branches:get-active',
  ENSURE_ROOT: 'branches:ensure-root',
  CREATE_CHILD: 'branches:create-child',
  SWITCH_TO: 'branches:switch-to',
  DELETE: 'branches:delete',
  UPDATE_LABEL: 'branches:update-label'
} as const;

// Panel error interface
interface PanelError {
  timestamp: Date;
  ideaId: string;
  message: string;
  source?: string;
  line?: number;
  column?: number;
  stack?: string;
}

// Voice agent IPC channel names
const VOICE_AGENT_CHANNELS = {
  RUN: 'voice-agent:run',
  EVENT: 'voice-agent:event',
  END: 'voice-agent:end',
  ERROR: 'voice-agent:error',
  ABORT: 'voice-agent:abort'
} as const;

// Voice agent stream event type
interface VoiceAgentStreamEvent {
  type: 'text' | 'tool_start' | 'tool_use' | 'tool_result' | 'done';
  content?: string;
  toolId?: string;
  toolName?: string;
  stopReason?: string;
}

// Panel error IPC channel names
const PANEL_ERROR_CHANNELS = {
  REPORT_ERROR: 'panel-errors:report',
  GET_ERRORS: 'panel-errors:get',
  CLEAR_ERRORS: 'panel-errors:clear',
  HAS_ERRORS: 'panel-errors:has',
  GET_LOG_PATH: 'panel-errors:log-path'
} as const;


// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // Platform information
  platform: process.platform,

  // AI API methods — Claude Code Agent SDK (no API key needed)
  ai: {
    // Check if Claude Code CLI is available on this system
    checkAvailable: (): Promise<boolean> => {
      return ipcRenderer.invoke(AI_CHANNELS.CHECK_AVAILABLE);
    },

    // Synthesis stream via Claude Code subprocess + MCP tools
    synthesisStream: (
      ideaId: string,
      messageText: string,
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

      ipcRenderer.invoke(AI_CHANNELS.SYNTHESIS_STREAM, ideaId, messageText);

      return Promise.resolve(() => {
        ipcRenderer.removeListener(AI_CHANNELS.SYNTHESIS_STREAM_EVENT, eventHandler);
        ipcRenderer.removeListener(AI_CHANNELS.SYNTHESIS_STREAM_END, endHandler);
        ipcRenderer.removeListener(AI_CHANNELS.SYNTHESIS_STREAM_ERROR, errorHandler);
      });
    },

    // Abort an active synthesis stream
    abortSynthesis: (ideaId: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(AI_CHANNELS.SYNTHESIS_ABORT, ideaId);
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
    },
    updateMessageContentBlocks: (id: string, contentBlocks: unknown[]): Promise<void> => {
      return ipcRenderer.invoke(DB_CHANNELS.UPDATE_MESSAGE_CONTENT_BLOCKS, id, contentBlocks);
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

  // Speech-to-text API methods (batch transcription)
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

  // Real-time speech-to-text API methods (streaming transcription)
  realtimeStt: {
    start: (language?: string): Promise<InitializeResult> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.REALTIME_STT_START, language || 'ro');
    },
    sendAudio: (audioData: number[]): Promise<void> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.REALTIME_STT_SEND_AUDIO, audioData);
    },
    stop: (): Promise<string> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.REALTIME_STT_STOP);
    },
    getTranscript: (): Promise<string> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.REALTIME_STT_GET_TRANSCRIPT);
    },
    // Event listeners for real-time updates
    onDelta: (callback: (delta: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, delta: string) => callback(delta);
      ipcRenderer.on(IDEAS_CHANNELS.REALTIME_STT_DELTA, handler);
      return () => ipcRenderer.removeListener(IDEAS_CHANNELS.REALTIME_STT_DELTA, handler);
    },
    onComplete: (callback: (transcript: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, transcript: string) => callback(transcript);
      ipcRenderer.on(IDEAS_CHANNELS.REALTIME_STT_COMPLETE, handler);
      return () => ipcRenderer.removeListener(IDEAS_CHANNELS.REALTIME_STT_COMPLETE, handler);
    },
    onError: (callback: (error: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, error: string) => callback(error);
      ipcRenderer.on(IDEAS_CHANNELS.REALTIME_STT_ERROR, handler);
      return () => ipcRenderer.removeListener(IDEAS_CHANNELS.REALTIME_STT_ERROR, handler);
    }
  },

  // Dev API methods
  dev: {
    seed: (): Promise<{ ideas: number; notes: number }> => {
      return ipcRenderer.invoke(IDEAS_CHANNELS.DEV_SEED);
    }
  },

  // Dev server API methods
  shell: {
    openExternal: (url: string): Promise<void> => {
      return ipcRenderer.invoke('shell:open-external', url);
    }
  },

  devServer: {
    start: (ideaId: string): Promise<{ port: number; success: boolean; error?: string }> => {
      return ipcRenderer.invoke(DEVSERVER_CHANNELS.START, ideaId);
    },
    stop: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(DEVSERVER_CHANNELS.STOP);
    },
    status: (): Promise<{ port: number; ideaId: string } | null> => {
      return ipcRenderer.invoke(DEVSERVER_CHANNELS.STATUS);
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
    // Dependency nodes AI stream via Claude Code subprocess + MCP tools
    dependencyNodesStream: (
      ideaId: string,
      messageText: string,
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

      ipcRenderer.invoke(DEPENDENCY_NODES_CHANNELS.DEPENDENCY_NODES_STREAM, ideaId, messageText);

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
  },

  // Panel errors API - for reporting and retrieving iframe runtime errors
  panelErrors: {
    report: (
      ideaId: string,
      message: string,
      source?: string,
      line?: number,
      column?: number,
      stack?: string
    ): Promise<void> => {
      return ipcRenderer.invoke(PANEL_ERROR_CHANNELS.REPORT_ERROR, ideaId, message, source, line, column, stack);
    },
    get: (ideaId: string): Promise<PanelError[]> => {
      return ipcRenderer.invoke(PANEL_ERROR_CHANNELS.GET_ERRORS, ideaId);
    },
    clear: (ideaId: string): Promise<void> => {
      return ipcRenderer.invoke(PANEL_ERROR_CHANNELS.CLEAR_ERRORS, ideaId);
    },
    has: (ideaId: string): Promise<boolean> => {
      return ipcRenderer.invoke(PANEL_ERROR_CHANNELS.HAS_ERRORS, ideaId);
    },
    getLogPath: (): Promise<string> => {
      return ipcRenderer.invoke(PANEL_ERROR_CHANNELS.GET_LOG_PATH);
    }
  },

  // Voice Agent API — voice-controlled app navigation via Haiku
  voiceAgent: {
    run: (
      ideaId: string,
      command: string,
      onEvent: (event: VoiceAgentStreamEvent) => void,
      onEnd: () => void,
      onError: (error: string) => void
    ): Promise<() => void> => {
      const eventHandler = (_event: IpcRendererEvent, streamEvent: VoiceAgentStreamEvent) => onEvent(streamEvent);
      const endHandler = () => onEnd();
      const errorHandler = (_event: IpcRendererEvent, error: string) => onError(error);

      ipcRenderer.on(VOICE_AGENT_CHANNELS.EVENT, eventHandler);
      ipcRenderer.once(VOICE_AGENT_CHANNELS.END, endHandler);
      ipcRenderer.once(VOICE_AGENT_CHANNELS.ERROR, errorHandler);

      ipcRenderer.invoke(VOICE_AGENT_CHANNELS.RUN, ideaId, command);

      return Promise.resolve(() => {
        ipcRenderer.removeListener(VOICE_AGENT_CHANNELS.EVENT, eventHandler);
        ipcRenderer.removeListener(VOICE_AGENT_CHANNELS.END, endHandler);
        ipcRenderer.removeListener(VOICE_AGENT_CHANNELS.ERROR, errorHandler);
      });
    },
    abort: (ideaId: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(VOICE_AGENT_CHANNELS.ABORT, ideaId);
    }
  },

  // Branches API - git-like conversation tree
  branches: {
    getAll: (ideaId: string): Promise<ConversationBranch[]> => {
      return ipcRenderer.invoke(BRANCH_CHANNELS.GET_ALL, ideaId);
    },
    get: (branchId: string): Promise<ConversationBranch | null> => {
      return ipcRenderer.invoke(BRANCH_CHANNELS.GET, branchId);
    },
    getActive: (ideaId: string): Promise<ConversationBranch | null> => {
      return ipcRenderer.invoke(BRANCH_CHANNELS.GET_ACTIVE, ideaId);
    },
    ensureRoot: (ideaId: string): Promise<ConversationBranch> => {
      return ipcRenderer.invoke(BRANCH_CHANNELS.ENSURE_ROOT, ideaId);
    },
    createChild: (parentBranchId: string, label?: string): Promise<ConversationBranch> => {
      return ipcRenderer.invoke(BRANCH_CHANNELS.CREATE_CHILD, parentBranchId, label);
    },
    switchTo: (branchId: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(BRANCH_CHANNELS.SWITCH_TO, branchId);
    },
    delete: (branchId: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(BRANCH_CHANNELS.DELETE, branchId);
    },
    updateLabel: (branchId: string, label: string): Promise<ConversationBranch> => {
      return ipcRenderer.invoke(BRANCH_CHANNELS.UPDATE_LABEL, branchId, label);
    }
  },

  // Snapshots API - version snapshots of idea state
  snapshots: {
    list: (ideaId: string): Promise<IdeaSnapshot[]> => {
      return ipcRenderer.invoke(SNAPSHOT_CHANNELS.LIST, ideaId);
    },
    get: (snapshotId: string): Promise<IdeaSnapshot | null> => {
      return ipcRenderer.invoke(SNAPSHOT_CHANNELS.GET, snapshotId);
    },
    restore: (snapshotId: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(SNAPSHOT_CHANNELS.RESTORE, snapshotId);
    },
    onCreated: (callback: (data: { ideaId: string; versionNumber: number; snapshotId: string }) => void): () => void => {
      const handler = (_event: IpcRendererEvent, data: { ideaId: string; versionNumber: number; snapshotId: string }) => callback(data);
      ipcRenderer.on(SNAPSHOT_CHANNELS.CREATED, handler);
      return () => {
        ipcRenderer.removeListener(SNAPSHOT_CHANNELS.CREATED, handler);
      };
    }
  },

  // Backup API — full app backups (DB + project folders)
  backup: {
    create: (): Promise<{ success: boolean; path: string; timestamp: string }> => {
      return ipcRenderer.invoke(BACKUP_CHANNELS.CREATE);
    },
    list: (): Promise<Array<{ timestamp: string; path: string; createdAt: string }>> => {
      return ipcRenderer.invoke(BACKUP_CHANNELS.LIST);
    },
    delete: (timestamp: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke(BACKUP_CHANNELS.DELETE, timestamp);
    }
  }
});

// Type declarations for the exposed API
declare global {
  interface Window {
    electronAPI: {
      platform: NodeJS.Platform;
      ai: {
        checkAvailable: () => Promise<boolean>;
        synthesisStream: (
          ideaId: string,
          messageText: string,
          onEvent: (event: SynthesisStreamEvent) => void,
          onEnd: () => void,
          onError: (error: string) => void
        ) => Promise<() => void>;
        abortSynthesis: (ideaId: string) => Promise<{ success: boolean }>;
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
        updateMessageContentBlocks: (id: string, contentBlocks: unknown[]) => Promise<void>;
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
      realtimeStt: {
        start: (language?: string) => Promise<InitializeResult>;
        sendAudio: (audioData: number[]) => Promise<void>;
        stop: () => Promise<string>;
        getTranscript: () => Promise<string>;
        onDelta: (callback: (delta: string) => void) => () => void;
        onComplete: (callback: (transcript: string) => void) => () => void;
        onError: (callback: (error: string) => void) => () => void;
      };
      dev: {
        seed: () => Promise<{ ideas: number; notes: number }>;
      };
      shell: {
        openExternal: (url: string) => Promise<void>;
      };
      devServer: {
        start: (ideaId: string) => Promise<{ port: number; success: boolean; error?: string }>;
        stop: () => Promise<{ success: boolean }>;
        status: () => Promise<{ port: number; ideaId: string } | null>;
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
          messageText: string,
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
      panelErrors: {
        report: (
          ideaId: string,
          message: string,
          source?: string,
          line?: number,
          column?: number,
          stack?: string
        ) => Promise<void>;
        get: (ideaId: string) => Promise<PanelError[]>;
        clear: (ideaId: string) => Promise<void>;
        has: (ideaId: string) => Promise<boolean>;
        getLogPath: () => Promise<string>;
      };
      voiceAgent: {
        run: (
          ideaId: string,
          command: string,
          onEvent: (event: VoiceAgentStreamEvent) => void,
          onEnd: () => void,
          onError: (error: string) => void
        ) => Promise<() => void>;
        abort: (ideaId: string) => Promise<{ success: boolean }>;
      };
      branches: {
        getAll: (ideaId: string) => Promise<ConversationBranch[]>;
        get: (branchId: string) => Promise<ConversationBranch | null>;
        getActive: (ideaId: string) => Promise<ConversationBranch | null>;
        ensureRoot: (ideaId: string) => Promise<ConversationBranch>;
        createChild: (parentBranchId: string, label?: string) => Promise<ConversationBranch>;
        switchTo: (branchId: string) => Promise<{ success: boolean }>;
        delete: (branchId: string) => Promise<{ success: boolean }>;
        updateLabel: (branchId: string, label: string) => Promise<ConversationBranch>;
      };
      snapshots: {
        list: (ideaId: string) => Promise<IdeaSnapshot[]>;
        get: (snapshotId: string) => Promise<IdeaSnapshot | null>;
        restore: (snapshotId: string) => Promise<{ success: boolean }>;
        onCreated: (callback: (data: { ideaId: string; versionNumber: number; snapshotId: string }) => void) => () => void;
      };
      backup: {
        create: () => Promise<{ success: boolean; path: string; timestamp: string }>;
        list: () => Promise<Array<{ timestamp: string; path: string; createdAt: string }>>;
        delete: (timestamp: string) => Promise<{ success: boolean }>;
      };
    };
  }
}
