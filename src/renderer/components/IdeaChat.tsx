import { useState, useRef, useEffect, useCallback, type ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ThinkingBlock } from './ThinkingBlock';
import { WebSearchBlock } from './WebSearchBlock';
import { ProposedNoteBlock } from './ProposedNoteBlock';
import { Panel, type PanelTab } from './Panel';
import { wakeWordService } from '../services/wakeWordService';

// Content block for ordered display - includes thinking blocks for proper ordering
interface ContentBlock {
  id: string;
  type: 'text' | 'tool_use' | 'thinking';
  content?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolResult?: { success: boolean; data?: unknown; error?: string };
  // Thinking-specific fields
  roundNumber?: number;
  isThinkingActive?: boolean;
  // Note proposal fields (for propose_note tool)
  proposal?: ProposedNote;
}

// Message type for display
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
  thinking?: string;
  contentBlocks?: ContentBlock[];
}

// Web search result item
interface SearchResultItem {
  rank: number;
  title: string;
  url: string;
  snippet: string;
}

// Proposed note from AI
interface ProposedNote {
  id: string;
  title: string;
  content: string;
  category: 'research' | 'decision' | 'recommendation' | 'insight' | 'warning' | 'todo';
  ideaId: string;
}

// Proposal status for tracking accept/reject
interface ProposalStatus {
  isProcessing: boolean;
  isAccepted: boolean;
  isRejected: boolean;
}

// Stream event type from synthesis/app builder API
// tool_start: Emitted immediately when tool block starts streaming (name and ID known)
// tool_input_delta: Emitted as tool input JSON streams in (for live content preview)
// tool_use: Emitted when tool block is complete (full input parsed)
// web_search: Emitted when AI starts a web search
// web_search_result: Emitted with search results
// note_proposal: Emitted when AI proposes adding a note (includes toolId for matching)
interface StreamEvent {
  type: 'thinking_start' | 'thinking' | 'thinking_done' | 'text' | 'tool_start' | 'tool_input_delta' | 'tool_use' | 'tool_result' | 'web_search' | 'web_search_result' | 'note_proposal' | 'done';
  content?: string;
  toolCall?: { id: string; name: string; input: Record<string, unknown> };
  toolId?: string;  // Used by tool_start, tool_result, note_proposal to match tool blocks
  toolName?: string;
  partialInput?: string;
  result?: { success: boolean; data?: unknown; error?: string };
  stopReason?: string;
  // Web search specific fields
  searchQuery?: string;
  searchResults?: SearchResultItem[];
  // Note proposal fields (note_proposal event)
  proposal?: ProposedNote;
  // Token usage (from done event)
  usage?: { inputTokens: number; outputTokens: number };
}

// Project file interface
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

// Extract content from partial JSON string like {"content":"# My Idea\n...
function extractContentFromPartialJson(partialJson: string): string {
  // Find the start of the content value
  const contentMatch = partialJson.match(/"content"\s*:\s*"/);
  if (!contentMatch) return '';

  const startIndex = partialJson.indexOf(contentMatch[0]) + contentMatch[0].length;
  let content = partialJson.slice(startIndex);

  // Remove trailing incomplete parts (might end mid-escape or with incomplete JSON)
  // If it ends with a complete closing quote and brace, remove them
  if (content.endsWith('"}')) {
    content = content.slice(0, -2);
  } else if (content.endsWith('"')) {
    content = content.slice(0, -1);
  }

  // Unescape JSON string escapes
  try {
    // Add quotes to make it a valid JSON string and parse
    content = JSON.parse('"' + content + '"');
  } catch {
    // If parsing fails, do basic unescaping
    content = content
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }

  return content;
}

// Props for the IdeaChat component
interface IdeaChatProps {
  ideaId: string;
  conversationId: string;
  isNewConversation: boolean;
  onBack: () => void;
}

// Full screen chat component for idea synthesis - TRAE DeepBlue inspired design
// Guided by the Holy Spirit
export function IdeaChat({ ideaId, conversationId, isNewConversation, onBack }: IdeaChatProps): ReactElement {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [liveStreamingTokens, setLiveStreamingTokens] = useState<{ input: number; output: number }>({ input: 0, output: 0 });
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [currentThinkingRound, setCurrentThinkingRound] = useState<number>(0);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  // Note: proposals are now stored directly in ContentBlock.proposal for inline rendering
  const [proposalStatuses, setProposalStatuses] = useState<Map<string, ProposalStatus>>(new Map());
  const [streamingBlocks, setStreamingBlocks] = useState<ContentBlock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [userHasScrolled, setUserHasScrolled] = useState<boolean>(false);

  // Panel state
  const [panelOpen, setPanelOpen] = useState<boolean>(false);
  const [panelContent, setPanelContent] = useState<string>('');
  const [panelLoading, setPanelLoading] = useState<boolean>(false);
  const [activePanelTab, setActivePanelTab] = useState<PanelTab>('main-idea');

  // App builder state
  const [appFiles, setAppFiles] = useState<ProjectFile[]>([]);
  const [appEntryFile, setAppEntryFile] = useState<ProjectFile | null>(null);
  const [appLoading, setAppLoading] = useState<boolean>(false);

  // Dependency nodes state
  const [dependencyNodes, setDependencyNodes] = useState<DependencyNode[]>([]);
  const [dependencyConnections, setDependencyConnections] = useState<DependencyNodeConnection[]>([]);
  const [dependencyNodesLoading, setDependencyNodesLoading] = useState<boolean>(false);

  // Voice input state
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState<boolean>(false);
  const [isWakeWordEnabled, setIsWakeWordEnabled] = useState<boolean>(false);
  const [isWakeWordAvailable] = useState<boolean>(wakeWordService.isAvailable());

  // Ref to accumulate tokens during streaming (for saving to database)
  const streamTokensRef = useRef<{ input: number; output: number }>({ input: 0, output: 0 });

  // Use refs to prevent race conditions and stale closures
  const activeStreamCleanupRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Clean up any active stream
      if (activeStreamCleanupRef.current) {
        activeStreamCleanupRef.current();
        activeStreamCleanupRef.current = null;
      }
      // Stop wake word detection
      wakeWordService.stop().catch(() => {/* ignore cleanup errors */});
    };
  }, []);

  // Track recording state for wake word callbacks
  const isRecordingRef = useRef(isRecording);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Wake word detection - "JARVIS" to activate voice input
  useEffect(() => {
    let mounted = true;

    const setupWakeWord = async () => {
      if (isWakeWordEnabled) {
        const success = await wakeWordService.start({
          onWakeWord: () => {
            // Start recording if not already recording and not busy
            if (!isRecordingRef.current && !isLoading && !isStreaming && !isProcessingAudio) {
              console.log('[WakeWord] Starting recording from wake word');
              startRecording(true); // Auto-send when stopped
            }
          },
          onStopWord: () => {
            // Stop recording and send if currently recording
            if (isRecordingRef.current) {
              console.log('[WakeWord] Stopping recording from stop word');
              stopRecording();
            }
          },
          onError: (error) => {
            console.error('[WakeWord] Error:', error);
            if (mounted) {
              setError(error);
              setIsWakeWordEnabled(false);
            }
          }
        });
        if (!success && mounted) {
          setIsWakeWordEnabled(false);
        }
      } else {
        await wakeWordService.stop();
      }
    };

    setupWakeWord();

    return () => {
      mounted = false;
      // Don't stop here - let the main cleanup handle it
    };
  }, [isWakeWordEnabled, isLoading, isStreaming, isProcessingAudio]);

  // Load existing messages on mount
  useEffect(() => {
    loadMessages();
    loadAppFiles();
    loadDependencyNodes();
  }, [conversationId]);

  // Load dependency nodes for the idea
  const loadDependencyNodes = async (): Promise<void> => {
    try {
      setDependencyNodesLoading(true);
      const state = await window.electronAPI.dependencyNodes.getFullState(ideaId);
      if (!isMountedRef.current) return;

      setDependencyNodes(state.nodes);
      setDependencyConnections(state.connections);
    } finally {
      if (isMountedRef.current) {
        setDependencyNodesLoading(false);
      }
    }
  };

  // Handle node position change (drag)
  const handleNodePositionChange = async (nodeId: string, x: number, y: number): Promise<void> => {
    // Optimistic update
    setDependencyNodes(prev => prev.map(n =>
      n.id === nodeId ? { ...n, positionX: x, positionY: y } : n
    ));

    // Persist to database
    await window.electronAPI.dependencyNodes.updatePosition(nodeId, x, y);
  };

  // Handle accepting a note proposal - creates the actual note
  const handleAcceptProposal = async (proposal: ProposedNote): Promise<void> => {
    // Set processing state
    setProposalStatuses(prev => {
      const newMap = new Map(prev);
      newMap.set(proposal.id, { isProcessing: true, isAccepted: false, isRejected: false });
      return newMap;
    });

    // Call API to create the note
    await window.electronAPI.ideas.acceptNoteProposal({
      ideaId: proposal.ideaId,
      title: proposal.title,
      content: proposal.content,
      category: proposal.category
    });

    // Update status to accepted
    setProposalStatuses(prev => {
      const newMap = new Map(prev);
      newMap.set(proposal.id, { isProcessing: false, isAccepted: true, isRejected: false });
      return newMap;
    });
  };

  // Handle rejecting a note proposal
  const handleRejectProposal = (proposalId: string): void => {
    setProposalStatuses(prev => {
      const newMap = new Map(prev);
      newMap.set(proposalId, { isProcessing: false, isAccepted: false, isRejected: true });
      return newMap;
    });
  };

  // Load app files for the idea
  const loadAppFiles = async (): Promise<void> => {
    try {
      setAppLoading(true);
      const files = await window.electronAPI.files.list(ideaId);
      if (!isMountedRef.current) return;

      setAppFiles(files);
      const entryFile = files.find(f => f.isEntryFile) ?? null;
      setAppEntryFile(entryFile);
    } finally {
      if (isMountedRef.current) {
        setAppLoading(false);
      }
    }
  };

  // Track if we've already started synthesis for new conversation
  const hasStartedSynthesisRef = useRef<boolean>(false);
  // Track if messages have been loaded for new conversation auto-start
  const [messagesLoaded, setMessagesLoaded] = useState<boolean>(false);

  // Load messages from database
  const loadMessages = async (): Promise<void> => {
    // Load full idea data including synthesis content
    const fullData = await window.electronAPI.ideas.getFull(ideaId);
    if (!isMountedRef.current) return;

    if (fullData && fullData.conversation) {
      // Load synthesis content into panel if it exists
      if (fullData.idea.synthesisContent) {
        setPanelContent(fullData.idea.synthesisContent);
      }

      // Build messages array including system prompt from conversation
      const allMessages: ChatMessage[] = [];

      // Add system prompt as system message if it exists
      if (fullData.conversation.systemPrompt) {
        allMessages.push({
          id: 'system-prompt',
          role: 'system',
          content: fullData.conversation.systemPrompt,
          createdAt: fullData.conversation.createdAt
        });
      }

      // Add existing messages from database, parsing thinking and contentBlocks
      for (const msg of fullData.messages) {
        const chatMsg: ChatMessage = {
          id: msg.id,
          role: msg.role,
          content: msg.content,
          createdAt: msg.createdAt
        };

        // Parse thinking if present
        if (msg.thinking) {
          chatMsg.thinking = msg.thinking;
        }

        // Parse contentBlocks if present (stored as JSON string)
        if (msg.contentBlocks) {
          try {
            chatMsg.contentBlocks = JSON.parse(msg.contentBlocks);
          } catch {
            // Ignore parse errors
          }
        }

        allMessages.push(chatMsg);
      }

      setMessages(allMessages);
      setMessagesLoaded(true);
    }
  };

  // Auto-scroll to bottom only when user hasn't manually scrolled
  useEffect(() => {
    if (!userHasScrolled && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, streamingBlocks, userHasScrolled]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Handle scroll to detect user scrolling
  const handleScroll = (): void => {
    if (!messagesContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;

    // If user scrolls away from bottom, stop auto-scrolling
    if (!isAtBottom && (isStreaming || isLoading)) {
      setUserHasScrolled(true);
    }

    // If user scrolls back to bottom, resume auto-scrolling
    if (isAtBottom) {
      setUserHasScrolled(false);
    }
  };

  // Get synthesis response using the new API with tools
  const getSynthesisResponse = useCallback(async (
    chatMessages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  ): Promise<void> => {
    // Clean up any previous active stream
    if (activeStreamCleanupRef.current) {
      activeStreamCleanupRef.current();
      activeStreamCleanupRef.current = null;
    }

    setIsStreaming(true);
    setIsThinking(false);
    setCurrentThinkingRound(0);
    setIsSearching(false);
    setSearchQuery('');
    setSearchResults([]);
    setProposalStatuses(new Map());
    setStreamingBlocks([]);
    setUserHasScrolled(false);

    // Reset token tracking for this stream
    streamTokensRef.current = { input: 0, output: 0 };
    setLiveStreamingTokens({ input: 0, output: 0 });

    // Use local variables for accumulation to avoid closure issues
    let currentRoundNumber = 0;
    let currentThinkingBlockId: string | null = null;
    const blocks: ContentBlock[] = [];
    let currentTextBlockId: string | null = null;

    // Helper to get or create current text block
    const getOrCreateTextBlock = (): ContentBlock => {
      if (currentTextBlockId) {
        const existing = blocks.find(b => b.id === currentTextBlockId);
        if (existing) return existing;
      }
      // Create new text block
      const newBlock: ContentBlock = {
        id: crypto.randomUUID(),
        type: 'text',
        content: ''
      };
      blocks.push(newBlock);
      currentTextBlockId = newBlock.id;
      return newBlock;
    };

    try {
      const cleanup = await window.electronAPI.ai.synthesisStream(
        ideaId,
        chatMessages,
        // On event
        (event: StreamEvent) => {
          if (!isMountedRef.current) return;

          switch (event.type) {
            case 'thinking_start':
              // Start a new thinking round - add to blocks array for proper ordering
              currentRoundNumber++;
              currentTextBlockId = null; // End any current text block
              const thinkingBlock: ContentBlock = {
                id: crypto.randomUUID(),
                type: 'thinking',
                content: '',
                roundNumber: currentRoundNumber,
                isThinkingActive: true
              };
              blocks.push(thinkingBlock);
              currentThinkingBlockId = thinkingBlock.id;
              setStreamingBlocks([...blocks]);
              setCurrentThinkingRound(currentRoundNumber);
              setIsThinking(true);
              break;

            case 'thinking':
              if (event.content && currentThinkingBlockId) {
                // Update the current thinking block's content
                const activeThinking = blocks.find(b => b.id === currentThinkingBlockId);
                if (activeThinking) {
                  activeThinking.content = (activeThinking.content || '') + event.content;
                  setStreamingBlocks([...blocks]);
                }
              }
              break;

            case 'thinking_done':
              // Mark current thinking block as complete
              if (currentThinkingBlockId) {
                const completedThinking = blocks.find(b => b.id === currentThinkingBlockId);
                if (completedThinking) {
                  completedThinking.isThinkingActive = false;
                  setStreamingBlocks([...blocks]);
                }
                currentThinkingBlockId = null;
              }
              setIsThinking(false);
              break;

            case 'text':
              if (event.content) {
                // Append to current text block
                const textBlock = getOrCreateTextBlock();
                textBlock.content = (textBlock.content || '') + event.content;
                setStreamingBlocks([...blocks]);
              }
              break;

            case 'tool_start':
              // Tool block started streaming - create block immediately in loading state
              if (event.toolId && event.toolName) {
                // Check if we already have this tool block (avoid duplicates)
                const existingTool = blocks.find(b => b.id === event.toolId);
                if (existingTool) {
                  // Already have this tool, skip
                  break;
                }
                // End current text block
                currentTextBlockId = null;
                // Add tool block in loading state (no input yet)
                const toolBlock: ContentBlock = {
                  id: event.toolId,
                  type: 'tool_use',
                  toolName: event.toolName,
                  toolInput: undefined // Input not available yet
                };
                blocks.push(toolBlock);
                setStreamingBlocks([...blocks]);

                // Open panel when update_synthesis tool starts
                if (event.toolName === 'update_synthesis') {
                  setPanelOpen(true);
                  setPanelLoading(true);
                  setPanelContent('');
                }

                // Open panel and switch to App tab when file tools are used
                if (['create_file', 'update_file', 'modify_file_lines'].includes(event.toolName)) {
                  setPanelOpen(true);
                  setActivePanelTab('app');
                  setAppLoading(true);
                }

                // Open panel and switch to Dependency Nodes tab when node tools are used
                if (['create_dependency_node', 'update_dependency_node', 'delete_dependency_node', 'connect_dependency_nodes', 'disconnect_dependency_nodes'].includes(event.toolName)) {
                  setPanelOpen(true);
                  setActivePanelTab('dependency-nodes');
                  setDependencyNodesLoading(true);
                }
              }
              break;

            case 'tool_input_delta':
              // Stream tool input content live into panel
              if (event.toolName === 'update_synthesis' && event.partialInput) {
                console.log('[Panel] tool_input_delta received, length:', event.partialInput.length);
                const extractedContent = extractContentFromPartialJson(event.partialInput);
                console.log('[Panel] extracted content length:', extractedContent.length);
                if (extractedContent) {
                  setPanelContent(extractedContent);
                }
              }
              break;

            case 'tool_use':
              // Tool block complete - update with full input
              if (event.toolCall) {
                // Find existing tool block (created by tool_start) and update with full input
                const existingTool = blocks.find(b => b.id === event.toolCall!.id);
                if (existingTool) {
                  existingTool.toolInput = event.toolCall.input;
                  setStreamingBlocks([...blocks]);
                }

                // Update synthesis panel content when update_synthesis tool completes
                if (event.toolCall.name === 'update_synthesis' && event.toolCall.input.content) {
                  setPanelContent(event.toolCall.input.content as string);
                  setPanelLoading(false);
                }
              }
              break;

            case 'tool_result':
              if (event.result) {
                // Find the tool block by ID (preferred) or name as fallback
                const toolBlock = blocks.find(
                  b => b.type === 'tool_use' &&
                       (event.toolId ? b.id === event.toolId : b.toolName === event.toolName) &&
                       !b.toolResult
                );
                if (toolBlock) {
                  toolBlock.toolResult = event.result;
                  setStreamingBlocks([...blocks]);
                }

                // Refresh app files after file operations complete
                if (event.result.success && ['create_file', 'update_file', 'modify_file_lines', 'delete_file', 'set_entry_file'].includes(event.toolName || '')) {
                  // Use setTimeout to avoid state update conflicts
                  setTimeout(() => {
                    if (isMountedRef.current) {
                      loadAppFiles();
                      setAppLoading(false);
                    }
                  }, 0);
                }

                // Refresh dependency nodes after node operations complete
                if (event.result.success && ['create_dependency_node', 'update_dependency_node', 'delete_dependency_node', 'connect_dependency_nodes', 'disconnect_dependency_nodes'].includes(event.toolName || '')) {
                  // Use setTimeout to avoid state update conflicts
                  setTimeout(() => {
                    if (isMountedRef.current) {
                      loadDependencyNodes();
                      setDependencyNodesLoading(false);
                    }
                  }, 0);
                }
              }
              break;

            case 'web_search':
              // AI started a web search
              console.log('[WebSearch] Received web_search event:', event);
              setIsSearching(true);
              setSearchQuery(event.searchQuery || 'Searching...');
              setSearchResults([]);
              break;

            case 'web_search_result':
              // Web search completed with results
              console.log('[WebSearch] Received web_search_result event:', event);
              setIsSearching(false);
              if (event.searchResults) {
                setSearchResults(event.searchResults);
              }
              break;

            case 'note_proposal':
              // AI proposed adding a note - attach to the corresponding propose_note tool block
              // Match by toolId for accuracy when multiple proposals arrive at once
              if (event.proposal) {
                // First try to match by toolId (most accurate)
                let proposalToolBlock = event.toolId
                  ? blocks.find(b => b.id === event.toolId && b.type === 'tool_use')
                  : null;

                // Fallback: find first propose_note tool without a proposal
                if (!proposalToolBlock) {
                  proposalToolBlock = blocks.find(
                    b => b.type === 'tool_use' &&
                         b.toolName === 'propose_note' &&
                         !b.proposal
                  );
                }

                if (proposalToolBlock) {
                  proposalToolBlock.proposal = event.proposal;
                  setStreamingBlocks([...blocks]);
                } else {
                  // Tool block might not exist yet - create a placeholder
                  const placeholderBlock: ContentBlock = {
                    id: event.toolId || crypto.randomUUID(),
                    type: 'tool_use',
                    toolName: 'propose_note',
                    proposal: event.proposal,
                    toolResult: { success: true, data: event.proposal }
                  };
                  blocks.push(placeholderBlock);
                  setStreamingBlocks([...blocks]);
                }
              }
              break;

            case 'done':
              // Streaming complete for this round - capture token usage for database
              if (event.usage) {
                streamTokensRef.current.input += event.usage.inputTokens;
                streamTokensRef.current.output += event.usage.outputTokens;
                // Also update live streaming tokens for real-time stats display
                setLiveStreamingTokens({
                  input: streamTokensRef.current.input,
                  output: streamTokensRef.current.output
                });
              }
              break;
          }
        },
        // On end
        async () => {
          if (!isMountedRef.current) return;

          // Clear the cleanup ref since stream ended naturally
          activeStreamCleanupRef.current = null;

          setIsStreaming(false);
          setIsThinking(false);
          setAppLoading(false);
          setDependencyNodesLoading(false);

          // Refresh app files and dependency nodes in case any tools were used
          await loadAppFiles();
          await loadDependencyNodes();

          // Combine all text content for storage
          const fullTextContent = blocks
            .filter(b => b.type === 'text')
            .map(b => b.content || '')
            .join('');

          // Combine all thinking blocks into a single string for storage
          // Format: each round separated by a marker
          const thinkingBlocks = blocks.filter(b => b.type === 'thinking');
          const fullThinkingContent = thinkingBlocks
            .map((block, idx) => `--- Thought ${idx + 1} ---\n${block.content}`)
            .join('\n\n');

          // Create assistant message with all content blocks (including thinking for proper ordering)
          const assistantMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: fullTextContent,
            createdAt: new Date(),
            thinking: fullThinkingContent || undefined, // Keep for backwards compatibility
            contentBlocks: blocks.length > 0 ? [...blocks] : undefined
          };

          setMessages(prev => [...prev, assistantMessage]);
          setCurrentThinkingRound(0);
          setSearchQuery('');
          setSearchResults([]);
          setIsSearching(false);
          setStreamingBlocks([]);

          // Save to database with all contentBlocks and token usage
          await window.electronAPI.db.addMessage({
            conversationId,
            role: 'assistant',
            content: fullTextContent,
            thinking: fullThinkingContent || undefined, // Keep for backwards compatibility
            contentBlocks: blocks.length > 0 ? blocks : undefined,
            inputTokens: streamTokensRef.current.input > 0 ? streamTokensRef.current.input : undefined,
            outputTokens: streamTokensRef.current.output > 0 ? streamTokensRef.current.output : undefined
          });
        },
        // On error
        (errorMsg: string) => {
          if (!isMountedRef.current) return;

          activeStreamCleanupRef.current = null;
          setIsStreaming(false);
          setIsThinking(false);
          setError(errorMsg);
          setCurrentThinkingRound(0);
          setStreamingBlocks([]);
        }
      );

      // Store the cleanup function
      activeStreamCleanupRef.current = cleanup;
    } catch (err) {
      if (isMountedRef.current) {
        setIsStreaming(false);
        setIsThinking(false);
        const errorMessage = err instanceof Error ? err.message : 'Failed to get synthesis response';
        setError(errorMessage);
      }
    }
  }, [ideaId, conversationId]);

  // Auto-start synthesis for new conversations (triggered by "Synthesize Idea" button)
  // This runs after messages are loaded and getSynthesisResponse is available
  useEffect(() => {
    // Only trigger for new conversations with no user/assistant messages yet
    if (
      isNewConversation &&
      messagesLoaded &&
      !hasStartedSynthesisRef.current &&
      !isStreaming &&
      !isLoading
    ) {
      // Check if we only have system message (no actual conversation yet)
      const hasOnlySystemMessage = messages.length > 0 &&
        messages.every(m => m.role === 'system');

      if (hasOnlySystemMessage) {
        hasStartedSynthesisRef.current = true;

        // Initial trigger message for synthesis (not shown in UI)
        // Claude API requires at least one user message
        const triggerContent = 'Analizează ideile și fa sinteza lor într-o idee. Nu propune note - doar sintetizează.';

        // Prepare messages including the trigger message (don't add to UI state)
        const initialMessages = [
          ...messages.map(m => ({ role: m.role, content: m.content })),
          { role: 'user' as const, content: triggerContent }
        ];

        getSynthesisResponse(initialMessages);
      }
    }
  }, [isNewConversation, messagesLoaded, messages, isStreaming, isLoading, getSynthesisResponse, conversationId]);

  // Handle sending a message
  const handleSend = async (): Promise<void> => {
    if (!inputValue.trim() || isLoading || isStreaming) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: inputValue.trim(),
      createdAt: new Date()
    };

    setInputValue('');
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);
    setUserHasScrolled(false);

    try {
      // Save user message to database
      await window.electronAPI.db.addMessage({
        conversationId,
        role: 'user',
        content: userMessage.content
      });

      // Get response - all tools always available
      const allMessages = [...messages, userMessage].map(m => ({
        role: m.role,
        content: m.content
      }));

      await getSynthesisResponse(allMessages);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  // Handle key press in input
  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Handle stop/abort streaming
  const handleStop = async (): Promise<void> => {
    try {
      // Clean up any active stream listener
      if (activeStreamCleanupRef.current) {
        activeStreamCleanupRef.current();
        activeStreamCleanupRef.current = null;
      }

      // Send abort signal to the main process
      await window.electronAPI.ai.abortSynthesis(ideaId);

      // Reset all loading/streaming states
      setIsStreaming(false);
      setIsLoading(false);
      setIsThinking(false);
      setAppLoading(false);
      setDependencyNodesLoading(false);
      setPanelLoading(false);
      setCurrentThinkingRound(0);
      setIsSearching(false);

      // Keep the streaming blocks as they are (partial content is still useful)
    } catch (err) {
      console.error('Failed to stop synthesis:', err);
    }
  };

  // Track if we should auto-send after recording (for wake word)
  const autoSendAfterRecordingRef = useRef<boolean>(false);

  // Start voice recording
  const startRecording = async (autoSend = false): Promise<void> => {
    try {
      setError(null);
      autoSendAfterRecordingRef.current = autoSend;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        await processRecording();
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      setError('Could not access microphone. Please grant permission.');
      console.error('Microphone error:', err);
    }
  };

  // Stop voice recording
  const stopRecording = (): void => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      setIsProcessingAudio(true);
    }
  };

  // Process recorded audio through STT
  const processRecording = async (): Promise<void> => {
    try {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioData = Array.from(new Uint8Array(arrayBuffer));

      const result = await window.electronAPI.stt.transcribe(audioData, 'audio/webm');

      if (result.text && result.text.trim()) {
        const transcribedText = result.text.trim();

        // If auto-send is enabled (from wake word), send directly
        if (autoSendAfterRecordingRef.current) {
          autoSendAfterRecordingRef.current = false;
          setIsProcessingAudio(false);

          // Create and send the message directly
          const userMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: transcribedText,
            createdAt: new Date()
          };

          setMessages(prev => [...prev, userMessage]);
          setIsLoading(true);
          setUserHasScrolled(false);

          // Save user message to database
          await window.electronAPI.db.addMessage({
            conversationId,
            role: 'user',
            content: userMessage.content
          });

          // Get response
          const allMessages = [...messages, userMessage].map(m => ({
            role: m.role,
            content: m.content
          }));

          await getSynthesisResponse(allMessages);
          setIsLoading(false);
        } else {
          // Normal mode - just append to input
          setInputValue(prev => {
            const newValue = prev ? `${prev} ${transcribedText}` : transcribedText;
            return newValue;
          });
          inputRef.current?.focus();
          setIsProcessingAudio(false);
        }
      } else {
        setIsProcessingAudio(false);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to transcribe audio';
      setError(errorMessage);
      console.error('Transcription error:', err);
      setIsProcessingAudio(false);
      autoSendAfterRecordingRef.current = false;
    }
  };

  // Format tool name for display
  const formatToolName = (name: string): string => {
    return name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  // Markdown components styling for AI responses
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const markdownComponents: Record<string, React.ComponentType<any>> = {
    h1: ({ children }: any) => (
      <h1 className="text-2xl font-semibold text-blue-50 mt-6 mb-3">{children}</h1>
    ),
    h2: ({ children }: any) => (
      <h2 className="text-xl font-semibold text-blue-50 mt-5 mb-2">{children}</h2>
    ),
    h3: ({ children }: any) => (
      <h3 className="text-lg font-medium text-blue-50 mt-4 mb-2">{children}</h3>
    ),
    h4: ({ children }: any) => (
      <h4 className="text-base font-medium text-blue-100 mt-3 mb-1">{children}</h4>
    ),
    p: ({ children }: any) => (
      <p className="text-blue-100 leading-relaxed mb-3">{children}</p>
    ),
    ul: ({ children }: any) => (
      <ul className="list-disc list-outside ml-5 mb-3 space-y-1 text-blue-100">{children}</ul>
    ),
    ol: ({ children }: any) => (
      <ol className="list-decimal list-outside ml-5 mb-3 space-y-1 text-blue-100">{children}</ol>
    ),
    li: ({ children }: any) => (
      <li className="text-blue-100">{children}</li>
    ),
    strong: ({ children }: any) => (
      <strong className="font-semibold text-blue-50">{children}</strong>
    ),
    em: ({ children }: any) => (
      <em className="italic text-blue-200">{children}</em>
    ),
    code: ({ children, className }: any) => {
      const isInline = !className;
      if (isInline) {
        return (
          <code className="px-1.5 py-0.5 bg-[#1e3a5f] rounded text-sky-300 text-sm font-mono">
            {children}
          </code>
        );
      }
      return (
        <code className="text-sky-300 font-mono text-sm">{children}</code>
      );
    },
    pre: ({ children }: any) => (
      <pre className="bg-[#0d1f3c] rounded-lg p-4 my-3 overflow-x-auto border border-[#1e3a5f]">
        {children}
      </pre>
    ),
    blockquote: ({ children }: any) => (
      <blockquote className="border-l-4 border-sky-500 pl-4 my-3 text-blue-200 italic">
        {children}
      </blockquote>
    ),
    a: ({ href, children }: any) => (
      <a href={href} className="text-sky-400 hover:text-sky-300 underline" target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ),
    hr: () => <hr className="my-4 border-[#1e3a5f]" />
  };
  /* eslint-enable @typescript-eslint/no-explicit-any */

  return (
    <div className="h-screen flex flex-col bg-[#0a1628] overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#1e3a5f]">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sky-400 hover:text-sky-300 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span>Back to Idea</span>
        </button>

        <h1 className="text-xl font-light text-blue-50">Idea Synthesis</h1>

        <div className="flex items-center gap-2">
          {/* Wake word toggle button - "Hey Ben" */}
          {isWakeWordAvailable && (
            <button
              onClick={() => setIsWakeWordEnabled(!isWakeWordEnabled)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
                isWakeWordEnabled
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'text-blue-300 hover:text-emerald-400 hover:bg-[#1e3a5f]'
              }`}
              aria-label="Toggle voice activation"
              title={isWakeWordEnabled ? 'Voice active - say "Hey Ben" to start, "Gata Ben" to send' : 'Enable voice activation'}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <span className="text-sm">Hey Ben</span>
              {isWakeWordEnabled && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>
          )}

          {/* Panel toggle button */}
          <button
            onClick={() => setPanelOpen(!panelOpen)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
              panelOpen
                ? 'bg-sky-500/20 text-sky-400'
                : 'text-blue-300 hover:text-sky-400 hover:bg-[#1e3a5f]'
            }`}
            aria-label="Toggle panel"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
            <span className="text-sm">Panel</span>
          </button>
        </div>
      </header>

      {/* Error message */}
      {error && (
        <div className="mx-6 mt-4 p-3 bg-red-900/20 rounded-lg border border-red-700/50">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Messages area - contains floating panel */}
      <div className="flex-1 relative overflow-hidden">
        {/* Messages scroll container - shifts left when panel open */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className={`h-full overflow-y-auto px-6 py-6 transition-all duration-300 ease-in-out ${
            panelOpen ? 'pr-[calc(43%+1rem)]' : ''
          }`}
        >
        <div className={`mx-auto space-y-6 transition-all duration-300 ease-in-out ${
          panelOpen ? 'max-w-2xl' : 'max-w-4xl'
        }`}>
          {messages.filter(m => m.role !== 'system').map((message) => (
            <div key={message.id}>
              {message.role === 'user' ? (
                // User message - keep bubble style
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl px-5 py-3 bg-sky-600 text-white">
                    <p className="leading-relaxed">{message.content}</p>
                  </div>
                </div>
              ) : (
                // Assistant message - flat style without background
                <div className="space-y-2">
                  {/* Render content blocks in order if available (includes thinking, tools, text) */}
                  {message.contentBlocks && message.contentBlocks.length > 0 ? (
                    message.contentBlocks.map((block, index) => {
                      if (block.type === 'thinking') {
                        // Thinking block - rendered in order with other blocks
                        return (
                          <ThinkingBlock
                            key={block.id}
                            content={block.content || ''}
                            isThinking={false}
                            roundNumber={block.roundNumber || index + 1}
                          />
                        );
                      } else if (block.type === 'tool_use') {
                        // Special handling for propose_note - render ProposedNoteBlock
                        if (block.toolName === 'propose_note' && block.proposal) {
                          const status = proposalStatuses.get(block.proposal.id);
                          return (
                            <ProposedNoteBlock
                              key={block.id}
                              proposal={block.proposal}
                              onAccept={handleAcceptProposal}
                              onReject={handleRejectProposal}
                              isProcessing={status?.isProcessing}
                              isAccepted={status?.isAccepted}
                              isRejected={status?.isRejected}
                            />
                          );
                        }
                        // Generic tool block
                        return (
                          <div key={block.id} className="flex items-start gap-2 text-sm">
                            <span className={`px-2 py-0.5 rounded text-xs ${
                              block.toolResult?.success
                                ? 'bg-emerald-900/50 text-emerald-300'
                                : 'bg-amber-900/50 text-amber-300'
                            }`}>
                              {formatToolName(block.toolName || 'unknown')}
                            </span>
                            {block.toolResult?.success && (
                              <span className="text-blue-300/60 text-xs">completed</span>
                            )}
                          </div>
                        );
                      } else {
                        // Text block
                        return block.content ? (
                          <div key={block.id} className="prose prose-invert max-w-none">
                            <ReactMarkdown
                              remarkPlugins={[remarkGfm]}
                              components={markdownComponents}
                            >
                              {block.content}
                            </ReactMarkdown>
                          </div>
                        ) : null;
                      }
                    })
                  ) : (
                    // Fallback: render thinking and content directly if no content blocks
                    <>
                      {/* Backwards compatibility: show thinking from message.thinking field */}
                      {message.thinking && (
                        <ThinkingBlock content={message.thinking} isThinking={false} />
                      )}
                      {message.content && (
                        <div className="prose prose-invert max-w-none">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={markdownComponents}
                          >
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Streaming response - render blocks in order */}
          {(isStreaming || isThinking || streamingBlocks.length > 0) && (
            <div className="space-y-2">
              {/* Web search block while streaming */}
              {(isSearching || searchQuery) && (
                <WebSearchBlock
                  query={searchQuery}
                  results={searchResults}
                  isSearching={isSearching}
                />
              )}

              {/* Render all blocks in order - thinking, tools, and text */}
              {streamingBlocks.map((block) => {
                if (block.type === 'thinking') {
                  // Thinking block - renders in place within the stream
                  return (
                    <ThinkingBlock
                      key={block.id}
                      content={block.content || ''}
                      isThinking={block.isThinkingActive || false}
                      roundNumber={block.roundNumber}
                    />
                  );
                } else if (block.type === 'tool_use') {
                  // Special handling for propose_note - render ProposedNoteBlock
                  if (block.toolName === 'propose_note' && block.proposal) {
                    const status = proposalStatuses.get(block.proposal.id);
                    return (
                      <ProposedNoteBlock
                        key={block.id}
                        proposal={block.proposal}
                        onAccept={handleAcceptProposal}
                        onReject={handleRejectProposal}
                        isProcessing={status?.isProcessing}
                        isAccepted={status?.isAccepted}
                        isRejected={status?.isRejected}
                      />
                    );
                  }
                  // Generic tool block
                  return (
                    <div key={block.id} className="flex items-center gap-2 text-sm">
                      {!block.toolResult ? (
                        <svg className="w-4 h-4 animate-spin text-sky-400" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                      <span className="px-2 py-0.5 rounded bg-[#1e3a5f] text-sky-300 text-xs">
                        {formatToolName(block.toolName || 'unknown')}
                      </span>
                      <span className="text-blue-300/60 text-xs">
                        {block.toolResult ? 'completed' : 'running...'}
                      </span>
                    </div>
                  );
                } else {
                  // Text block
                  return (
                    <div key={block.id} className="prose prose-invert max-w-none">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={markdownComponents}
                      >
                        {block.content || ''}
                      </ReactMarkdown>
                    </div>
                  );
                }
              })}

              {/* Loading state - starting to think, no blocks yet */}
              {isThinking && streamingBlocks.length === 0 && (
                <div className="flex items-center gap-3 text-blue-200/60">
                  <svg className="w-5 h-5 animate-spin text-sky-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>Starting to think...</span>
                </div>
              )}
            </div>
          )}


          {/* Initial loading indicator */}
          {isLoading && !isStreaming && !isThinking && streamingBlocks.length === 0 && (
            <div className="flex items-center gap-3 text-blue-200/60">
              <svg className="w-5 h-5 animate-spin text-sky-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span>Preparing synthesis...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
        </div>

        {/* Floating Panel - inside messages area */}
        <Panel
          isOpen={panelOpen}
          isLoading={panelLoading}
          content={panelContent}
          onClose={() => setPanelOpen(false)}
          activeTab={activePanelTab}
          onTabChange={setActivePanelTab}
          appFiles={appFiles}
          appEntryFile={appEntryFile}
          appLoading={appLoading}
          dependencyNodes={dependencyNodes}
          dependencyConnections={dependencyConnections}
          dependencyNodesLoading={dependencyNodesLoading}
          onNodePositionChange={handleNodePositionChange}
          ideaId={ideaId}
          conversationId={conversationId}
          streamingTokens={{
            input: liveStreamingTokens.input,
            output: liveStreamingTokens.output,
            isStreaming: isStreaming
          }}
        />
      </div>

      {/* Input area */}
      <div className="border-t border-[#1e3a5f] px-6 py-4">
        <div className={`mx-auto flex items-end gap-4 transition-all duration-300 ease-in-out ${
          panelOpen ? 'max-w-2xl' : 'max-w-4xl'
        }`}>
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyPress}
            placeholder="Ask a follow-up question or request changes..."
            disabled={isLoading || isStreaming}
            rows={1}
            className="flex-1 bg-[#112240] border border-[#1e3a5f] rounded-xl px-4 py-3
                       text-blue-100 placeholder-blue-300/40
                       focus:outline-none focus:border-sky-500
                       disabled:opacity-50 disabled:cursor-not-allowed
                       resize-none"
            style={{ minHeight: '48px', maxHeight: '120px' }}
          />
          {/* Voice input button */}
          <button
            onClick={isRecording ? stopRecording : () => startRecording()}
            disabled={isLoading || isStreaming || isProcessingAudio}
            className={`p-3 rounded-xl transition-colors
                       ${isRecording
                         ? 'bg-red-500 text-white animate-pulse'
                         : isProcessingAudio
                           ? 'bg-amber-500 text-white'
                           : 'bg-[#1e3a5f] text-blue-300 hover:bg-[#2a4a6f] hover:text-sky-400'
                       }
                       disabled:opacity-50 disabled:cursor-not-allowed`}
            title={isRecording ? 'Stop recording' : isProcessingAudio ? 'Processing...' : 'Voice input'}
          >
            {isProcessingAudio ? (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : isRecording ? (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            )}
          </button>
          {/* Stop button - shown when streaming/loading */}
          {(isStreaming || isLoading) ? (
            <button
              onClick={handleStop}
              className="p-3 rounded-xl bg-red-500 text-white
                         hover:bg-red-400 transition-colors"
              title="Stop generation"
            >
              <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!inputValue.trim()}
              className="p-3 rounded-xl bg-sky-500 text-white
                         hover:bg-sky-400 transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
