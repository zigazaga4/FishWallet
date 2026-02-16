import { useState, useRef, useEffect, useCallback, useMemo, type ReactElement } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Panel, type PanelTab } from './Panel';
import { ConversationTree } from './ConversationTree';
import { ChatInput } from './ChatInput';
import { MessageItem } from './MessageItem';
import { StreamingArea } from './StreamingArea';
import { wakeWordService } from '../services/wakeWordService';
import type {
  ContentBlock, ChatMessage, SearchResultItem, ProposedNote, ProposalStatus,
  DependencyNode, DependencyNodeConnection, StreamEvent
} from './types/chat';

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

// Throttle utility for scroll handler
function throttle<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let lastCall = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    const now = Date.now();
    if (now - lastCall >= ms) {
      lastCall = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        lastCall = Date.now();
        timer = null;
        fn(...args);
      }, ms - (now - lastCall));
    }
  }) as T;
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
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [liveStreamingTokens, setLiveStreamingTokens] = useState<{ input: number; output: number }>({ input: 0, output: 0 });
  const [isThinking, setIsThinking] = useState<boolean>(false);
  const [isCompacting, setIsCompacting] = useState<boolean>(false);
  const [previewRefreshKey, setPreviewRefreshKey] = useState<number>(0);
  const [currentThinkingRound, setCurrentThinkingRound] = useState<number>(0);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [proposalStatuses, setProposalStatuses] = useState<Record<string, ProposalStatus>>({});
  const [streamingBlocks, setStreamingBlocks] = useState<ContentBlock[]>([]);
  const activeBlocksRef = useRef<ContentBlock[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [userHasScrolled, setUserHasScrolled] = useState<boolean>(false);

  // Panel state
  const [panelOpen, setPanelOpen] = useState<boolean>(false);
  const [panelContent, setPanelContent] = useState<string>('');
  const [panelLoading, setPanelLoading] = useState<boolean>(false);
  const [activePanelTab, setActivePanelTab] = useState<PanelTab>('main-idea');

  // Dependency nodes state
  const [dependencyNodes, setDependencyNodes] = useState<DependencyNode[]>([]);
  const [dependencyConnections, setDependencyConnections] = useState<DependencyNodeConnection[]>([]);
  const [dependencyNodesLoading, setDependencyNodesLoading] = useState<boolean>(false);

  // Branch / tree state
  const [showTree, setShowTree] = useState<boolean>(false);
  const [branches, setBranches] = useState<Array<{
    id: string; ideaId: string; parentBranchId: string | null;
    conversationId: string | null; label: string; depth: number;
    isActive: boolean; createdAt: Date; updatedAt: Date;
  }>>([]);
  const [activeBranchId, setActiveBranchId] = useState<string | null>(null);
  const [isCreatingBranch, setIsCreatingBranch] = useState<boolean>(false);
  const [effectiveConversationId, setEffectiveConversationId] = useState<string>(conversationId);

  // Snapshot viewing state
  const [viewingSnapshotId, setViewingSnapshotId] = useState<string | null>(null);
  const [viewingSnapshotData, setViewingSnapshotData] = useState<{
    versionNumber: number;
    synthesisContent: string | null;
    nodes: DependencyNode[];
    connections: DependencyNodeConnection[];
  } | null>(null);

  // Voice input state
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState<boolean>(false);
  const [isWakeWordEnabled, setIsWakeWordEnabled] = useState<boolean>(true);
  const [isWakeWordAvailable] = useState<boolean>(wakeWordService.isAvailable());
  const [pendingTranscription, setPendingTranscription] = useState<string | null>(null);

  // Voice agent state (Haiku-powered app navigation)
  const [isVoiceAgentRecording, setIsVoiceAgentRecording] = useState<boolean>(false);
  const [isVoiceAgentRunning, setIsVoiceAgentRunning] = useState<boolean>(false);
  const [voiceAgentResponse, setVoiceAgentResponse] = useState<string | null>(null);
  const voiceAgentRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceAgentChunksRef = useRef<Blob[]>([]);
  const voiceAgentStreamRef = useRef<MediaStream | null>(null);
  const voiceAgentCleanupRef = useRef<(() => void) | null>(null);
  const voiceAgentResponseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ref to accumulate tokens during streaming (for saving to database)
  const streamTokensRef = useRef<{ input: number; output: number }>({ input: 0, output: 0 });

  // Use refs to prevent race conditions and stale closures
  const activeStreamCleanupRef = useRef<(() => void) | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // Debounce timer for dependency nodes reload
  const dependencyNodesReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDependencyNodesReload = useRef<boolean>(false);

  // Ref to capture snapshot-created events during streaming
  const pendingSnapshotRef = useRef<{ ideaId: string; versionNumber: number; snapshotId: string } | null>(null);

  // Refs for throttled scroll handler (avoids stale closures)
  const isStreamingRef = useRef(isStreaming);
  useEffect(() => { isStreamingRef.current = isStreaming; }, [isStreaming]);
  const isLoadingRef = useRef(isLoading);
  useEffect(() => { isLoadingRef.current = isLoading; }, [isLoading]);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Cleanup function to stop all media tracks
  const cleanupAudioStream = (): void => {
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log('[IdeaChat] Stopped audio track:', track.kind, track.label);
      });
      audioStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
  };

  // Cleanup on unmount
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      console.log('[IdeaChat] Unmounting, cleaning up...');
      if (activeStreamCleanupRef.current) {
        activeStreamCleanupRef.current();
        activeStreamCleanupRef.current = null;
      }
      if (dependencyNodesReloadTimerRef.current) {
        clearTimeout(dependencyNodesReloadTimerRef.current);
        dependencyNodesReloadTimerRef.current = null;
      }
      cleanupAudioStream();
      // Cleanup voice agent resources
      if (voiceAgentStreamRef.current) {
        voiceAgentStreamRef.current.getTracks().forEach(t => t.stop());
        voiceAgentStreamRef.current = null;
      }
      voiceAgentRecorderRef.current = null;
      if (voiceAgentCleanupRef.current) {
        voiceAgentCleanupRef.current();
        voiceAgentCleanupRef.current = null;
      }
      if (voiceAgentResponseTimerRef.current) {
        clearTimeout(voiceAgentResponseTimerRef.current);
      }
      wakeWordService.stop().catch(() => {/* ignore cleanup errors */});
    };
  }, []);

  // Track recording state for wake word callbacks
  const isRecordingRef = useRef(isRecording);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  // Voice agent refs for wake word callbacks
  const isVoiceAgentRecordingRef = useRef(isVoiceAgentRecording);
  useEffect(() => { isVoiceAgentRecordingRef.current = isVoiceAgentRecording; }, [isVoiceAgentRecording]);
  const isVoiceAgentRunningRef = useRef(isVoiceAgentRunning);
  useEffect(() => { isVoiceAgentRunningRef.current = isVoiceAgentRunning; }, [isVoiceAgentRunning]);

  // Wake word detection - "ALEXA" to start/stop invisible voice agent recording
  useEffect(() => {
    let mounted = true;

    const setupWakeWord = async () => {
      if (isWakeWordEnabled) {
        const success = await wakeWordService.start({
          onWakeWord: () => {
            // First "Alexa" → start invisible recording for voice agent
            if (!isVoiceAgentRecordingRef.current && !isVoiceAgentRunningRef.current) {
              console.log('[WakeWord] Starting invisible voice agent recording');
              startVoiceAgentRecording();
            }
          },
          onStopWord: () => {
            // Second "Alexa" → stop recording, transcribe, send to voice agent
            if (isVoiceAgentRecordingRef.current) {
              console.log('[WakeWord] Stopping voice agent recording → transcribe → navigate');
              stopVoiceAgentRecording();
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
    };
  }, [isWakeWordEnabled]);

  // Listen for snapshot-created events (version badges)
  useEffect(() => {
    const cleanup = window.electronAPI.snapshots.onCreated((data) => {
      if (data.ideaId === ideaId) {
        pendingSnapshotRef.current = data;
      }
    });
    return cleanup;
  }, [ideaId]);

  // Sync effectiveConversationId when prop changes
  useEffect(() => {
    setEffectiveConversationId(conversationId);
  }, [conversationId]);

  // Load existing messages on mount or when effective conversation changes
  useEffect(() => {
    initialScrollDoneRef.current = false;
    loadMessages();
    loadDependencyNodes();
  }, [effectiveConversationId]);

  // Start the dev server eagerly when entering the idea conversation
  useEffect(() => {
    window.electronAPI.devServer.start(ideaId).catch(() => {
      // Dev server start failure is non-fatal — LivePreview will retry
    });
  }, [ideaId]);

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

  // Debounced version of loadDependencyNodes
  const loadDependencyNodesDebounced = useCallback((): void => {
    pendingDependencyNodesReload.current = true;

    if (dependencyNodesReloadTimerRef.current) {
      clearTimeout(dependencyNodesReloadTimerRef.current);
    }

    dependencyNodesReloadTimerRef.current = setTimeout(() => {
      if (isMountedRef.current && pendingDependencyNodesReload.current) {
        pendingDependencyNodesReload.current = false;
        loadDependencyNodes();
      }
    }, 300);
  }, [ideaId]);

  // Handle node position change (drag)
  const handleNodePositionChange = useCallback(async (nodeId: string, x: number, y: number): Promise<void> => {
    setDependencyNodes(prev => prev.map(n =>
      n.id === nodeId ? { ...n, positionX: x, positionY: y } : n
    ));
    await window.electronAPI.dependencyNodes.updatePosition(nodeId, x, y);
  }, []);

  // Handle accepting a note proposal
  const handleAcceptProposal = useCallback(async (proposal: ProposedNote): Promise<void> => {
    setProposalStatuses(prev => ({
      ...prev,
      [proposal.id]: { isProcessing: true, isAccepted: false, isRejected: false }
    }));

    await window.electronAPI.ideas.acceptNoteProposal({
      ideaId: proposal.ideaId,
      title: proposal.title,
      content: proposal.content,
      category: proposal.category
    });

    setProposalStatuses(prev => ({
      ...prev,
      [proposal.id]: { isProcessing: false, isAccepted: true, isRejected: false }
    }));
  }, []);

  // Handle rejecting a note proposal
  const handleRejectProposal = useCallback((proposalId: string): void => {
    setProposalStatuses(prev => ({
      ...prev,
      [proposalId]: { isProcessing: false, isAccepted: false, isRejected: true }
    }));
  }, []);

  // View a historical version snapshot in the panel
  const handleViewSnapshot = useCallback(async (snapshotId: string): Promise<void> => {
    const snapshot = await window.electronAPI.snapshots.get(snapshotId);
    if (!snapshot || !isMountedRef.current) return;

    const nodes: DependencyNode[] = JSON.parse(snapshot.nodesSnapshot);
    const connections: DependencyNodeConnection[] = JSON.parse(snapshot.connectionsSnapshot);

    setViewingSnapshotId(snapshotId);
    setViewingSnapshotData({
      versionNumber: snapshot.versionNumber,
      synthesisContent: snapshot.synthesisContent,
      nodes,
      connections
    });
    setPanelOpen(true);
  }, []);

  // Restore a historical version as the live version
  const handleRestoreSnapshot = useCallback(async (snapshotId: string): Promise<void> => {
    await window.electronAPI.snapshots.restore(snapshotId);
    if (!isMountedRef.current) return;

    setViewingSnapshotId(null);
    setViewingSnapshotData(null);

    const fullData = await window.electronAPI.ideas.getFull(ideaId);
    if (fullData?.idea.synthesisContent) {
      setPanelContent(fullData.idea.synthesisContent);
    } else {
      setPanelContent('');
    }
    await loadDependencyNodes();
  }, [ideaId]);

  // Return to live data from snapshot viewing
  const handleBackToLive = useCallback((): void => {
    setViewingSnapshotId(null);
    setViewingSnapshotData(null);
  }, []);

  // --- Branch / Tree handlers ---

  const handleOpenTree = useCallback(async (): Promise<void> => {
    await window.electronAPI.branches.ensureRoot(ideaId);
    const allBranches = await window.electronAPI.branches.getAll(ideaId);
    if (!isMountedRef.current) return;
    setBranches(allBranches);
    const active = allBranches.find(b => b.isActive);
    setActiveBranchId(active?.id ?? null);
    setShowTree(true);
  }, [ideaId]);

  const reloadBranches = async (): Promise<void> => {
    const allBranches = await window.electronAPI.branches.getAll(ideaId);
    if (!isMountedRef.current) return;
    setBranches(allBranches);
    const active = allBranches.find(b => b.isActive);
    setActiveBranchId(active?.id ?? null);
  };

  const reloadLiveData = async (): Promise<void> => {
    const fullData = await window.electronAPI.ideas.getFull(ideaId);
    if (!isMountedRef.current || !fullData) return;

    if (fullData.idea.conversationId) {
      setEffectiveConversationId(fullData.idea.conversationId);
    }

    setPanelContent(fullData.idea.synthesisContent || '');

    const allMessages: ChatMessage[] = [];
    if (fullData.conversation?.systemPrompt) {
      allMessages.push({
        id: 'system-prompt',
        role: 'system',
        content: fullData.conversation.systemPrompt,
        createdAt: fullData.conversation.createdAt
      });
    }
    for (const msg of fullData.messages) {
      const chatMsg: ChatMessage = {
        id: msg.id,
        role: msg.role,
        content: msg.content,
        createdAt: msg.createdAt
      };
      if (msg.thinking) chatMsg.thinking = msg.thinking;
      if (msg.contentBlocks) {
        try { chatMsg.contentBlocks = JSON.parse(msg.contentBlocks); } catch { /* ignore */ }
      }
      allMessages.push(chatMsg);
    }
    setMessages(allMessages);

    await loadDependencyNodes();
  };

  const handleSwitchBranch = async (branchId: string): Promise<void> => {
    await window.electronAPI.branches.switchTo(branchId);
    if (!isMountedRef.current) return;
    await reloadLiveData();
    await reloadBranches();
  };

  const handleCreateChild = async (parentBranchId: string, label: string): Promise<void> => {
    setIsCreatingBranch(true);
    try {
      await window.electronAPI.branches.createChild(parentBranchId, label);
      if (!isMountedRef.current) return;
      await reloadLiveData();
      await reloadBranches();
    } finally {
      if (isMountedRef.current) setIsCreatingBranch(false);
    }
  };

  const handleDeleteBranch = async (branchId: string): Promise<void> => {
    await window.electronAPI.branches.delete(branchId);
    if (!isMountedRef.current) return;
    await reloadLiveData();
    await reloadBranches();
  };

  // Track if we've already started synthesis for new conversation
  const hasStartedSynthesisRef = useRef<boolean>(false);
  const [messagesLoaded, setMessagesLoaded] = useState<boolean>(false);

  // Track whether initial scroll to bottom has been done
  const initialScrollDoneRef = useRef<boolean>(false);

  // Load messages from database
  const loadMessages = async (): Promise<void> => {
    const fullData = await window.electronAPI.ideas.getFull(ideaId);
    if (!isMountedRef.current) return;

    if (fullData && fullData.conversation) {
      if (fullData.idea.synthesisContent) {
        setPanelContent(fullData.idea.synthesisContent);
      }

      const allMessages: ChatMessage[] = [];

      if (fullData.conversation.systemPrompt) {
        allMessages.push({
          id: 'system-prompt',
          role: 'system',
          content: fullData.conversation.systemPrompt,
          createdAt: fullData.conversation.createdAt
        });
      }

      for (const msg of fullData.messages) {
        const chatMsg: ChatMessage = {
          id: msg.id,
          role: msg.role,
          content: msg.content,
          createdAt: msg.createdAt
        };

        if (msg.thinking) {
          chatMsg.thinking = msg.thinking;
        }

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

  // Filtered messages for rendering (exclude system messages except compaction markers)
  const filteredMessages = useMemo(() =>
    messages.filter(m => m.role !== 'system' || m.content.startsWith('[COMPACTION]')),
    [messages]
  );

  // Virtual list setup
  const virtualizer = useVirtualizer({
    count: filteredMessages.length,
    getScrollElement: () => messagesContainerRef.current,
    estimateSize: (index) => {
      const msg = filteredMessages[index];
      if (msg.role === 'user') return 72;
      if (msg.role === 'system') return 52;
      // Assistant: estimate from content
      const contentLength = msg.content?.length || 0;
      const blockCount = msg.contentBlocks?.length || 1;
      return Math.max(100, Math.min(800, contentLength * 0.3 + blockCount * 80));
    },
    overscan: 5,
  });

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    if (!userHasScrolled && filteredMessages.length > 0) {
      // Use requestAnimationFrame to wait for virtualizer to measure
      requestAnimationFrame(() => {
        // On initial load, jump instantly to the bottom; afterwards scroll smoothly
        const behavior = initialScrollDoneRef.current ? 'smooth' : 'auto';
        virtualizer.scrollToIndex(filteredMessages.length - 1, { align: 'end', behavior });
        initialScrollDoneRef.current = true;
      });
    }
  }, [filteredMessages.length, userHasScrolled]);

  // Auto-scroll during streaming (streaming area is below virtual list)
  useEffect(() => {
    if (!userHasScrolled && isStreaming && messagesContainerRef.current) {
      const el = messagesContainerRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [streamingBlocks, userHasScrolled, isStreaming]);

  // Remeasure when panel opens/closes (width changes)
  useEffect(() => {
    virtualizer.measure();
  }, [panelOpen]);

  // Throttled scroll handler using refs to avoid stale closures
  const handleScroll = useMemo(
    () => throttle((): void => {
      if (!messagesContainerRef.current) return;

      const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 100;

      if (!isAtBottom && (isStreamingRef.current || isLoadingRef.current)) {
        setUserHasScrolled(true);
      }

      if (isAtBottom) {
        setUserHasScrolled(false);
      }
    }, 100),
    []
  );

  // Get synthesis response via Claude Code subprocess
  const getSynthesisResponse = useCallback(async (
    messageText: string
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
    setProposalStatuses({});
    setStreamingBlocks([]);
    setUserHasScrolled(false);

    // Reset token tracking for this stream
    streamTokensRef.current = { input: 0, output: 0 };
    setLiveStreamingTokens({ input: 0, output: 0 });

    // Use local variables for accumulation to avoid closure issues
    let currentRoundNumber = 0;
    let currentThinkingBlockId: string | null = null;
    const blocks: ContentBlock[] = [];
    activeBlocksRef.current = blocks;
    let currentTextBlockId: string | null = null;
    // Track whether current blocks have been saved to messages by round_complete.
    // Blocks are kept in the array so tool_result events can match them.
    // Cleared when new content arrives for the next round.
    let roundSaved = false;
    // DB message ID of the last round_complete save (for updating contentBlocks after tool results)
    let lastSavedDbMessageId: string | null = null;

    // Clear blocks from a saved round when new content starts
    const clearSavedRound = (): void => {
      if (roundSaved) {
        blocks.length = 0;
        currentTextBlockId = null;
        currentThinkingBlockId = null;
        currentRoundNumber = 0;
        roundSaved = false;
        lastSavedDbMessageId = null;
      }
    };

    // Helper to get or create current text block
    const getOrCreateTextBlock = (): ContentBlock => {
      if (currentTextBlockId) {
        const existing = blocks.find(b => b.id === currentTextBlockId);
        if (existing) return existing;
      }
      const newBlock: ContentBlock = {
        id: crypto.randomUUID(),
        type: 'text',
        content: ''
      };
      blocks.push(newBlock);
      currentTextBlockId = newBlock.id;
      return newBlock;
    };

    // Helper to find parent Task block for sub-agent events
    const findParentTaskBlock = (parentToolUseId: string): ContentBlock | undefined => {
      return blocks.find(b => b.type === 'tool_use' && b.id === parentToolUseId);
    };

    // Helper to find a block by ID across top-level and nested childBlocks
    const findBlockDeep = (blockId: string): ContentBlock | undefined => {
      for (const b of blocks) {
        if (b.id === blockId) return b;
        if (b.childBlocks) {
          const child = b.childBlocks.find(c => c.id === blockId);
          if (child) return child;
        }
      }
      return undefined;
    };

    // Helper: trigger re-render of saved message containing a specific block ID
    const rerenderSavedMessage = (blockId: string): void => {
      setMessages(prev => {
        for (let i = prev.length - 1; i >= 0; i--) {
          const msg = prev[i];
          if (msg.role === 'assistant' && msg.contentBlocks) {
            if (msg.contentBlocks.some(b => b.id === blockId)) {
              const updated = [...prev];
              updated[i] = { ...msg, contentBlocks: [...msg.contentBlocks] };
              return updated;
            }
          }
        }
        return prev;
      });
    };

    try {
      const cleanup = await window.electronAPI.ai.synthesisStream(
        ideaId,
        messageText,
        // On event
        (event: StreamEvent) => {
          if (!isMountedRef.current) return;

          switch (event.type) {
            case 'thinking_start':
              // Skip sub-agent thinking — only show tool activity
              if (event.parentToolUseId) break;
              clearSavedRound();
              currentRoundNumber++;
              currentTextBlockId = null;
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
              if (event.parentToolUseId) break;
              if (event.content && currentThinkingBlockId) {
                const activeThinking = blocks.find(b => b.id === currentThinkingBlockId);
                if (activeThinking) {
                  activeThinking.content = (activeThinking.content || '') + event.content;
                  setStreamingBlocks([...blocks]);
                }
              }
              break;

            case 'thinking_done':
              if (event.parentToolUseId) break;
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
              // Skip sub-agent text — it becomes the Task tool result
              if (event.parentToolUseId) break;
              clearSavedRound();
              if (event.content) {
                const textBlock = getOrCreateTextBlock();
                textBlock.content = (textBlock.content || '') + event.content;
                setStreamingBlocks([...blocks]);
              }
              break;

            case 'tool_start':
              if (event.toolId && event.toolName) {
                // Sub-agent event — nest under parent Task block
                if (event.parentToolUseId) {
                  const parentBlock = findParentTaskBlock(event.parentToolUseId);
                  if (parentBlock) {
                    if (!parentBlock.childBlocks) parentBlock.childBlocks = [];
                    const existing = parentBlock.childBlocks.find(c => c.id === event.toolId);
                    if (!existing) {
                      parentBlock.childBlocks.push({
                        id: event.toolId,
                        type: 'tool_use',
                        toolName: event.toolName,
                        toolInput: undefined,
                        parentToolUseId: event.parentToolUseId
                      });
                    }
                    if (roundSaved) {
                      rerenderSavedMessage(event.parentToolUseId);
                    } else {
                      setStreamingBlocks([...blocks]);
                    }
                  }
                  break;
                }

                clearSavedRound();
                const existingTool = blocks.find(b => b.id === event.toolId);
                if (existingTool) break;
                currentTextBlockId = null;
                const toolBlock: ContentBlock = {
                  id: event.toolId,
                  type: 'tool_use',
                  toolName: event.toolName,
                  toolInput: undefined,
                  // Timestamp for elapsed timer on Task blocks
                  _createdAt: Date.now(),
                  // Initialize childBlocks for Task tool to hold sub-agent activity
                  ...(event.toolName === 'Task' ? { childBlocks: [] } : {})
                };
                blocks.push(toolBlock);
                setStreamingBlocks([...blocks]);

                if (event.toolName === 'update_synthesis') {
                  setPanelOpen(true);
                  setPanelLoading(true);
                  setPanelContent('');
                }

                if (['create_dependency_node', 'update_dependency_node', 'delete_dependency_node', 'connect_dependency_nodes', 'disconnect_dependency_nodes'].includes(event.toolName)) {
                  setPanelOpen(true);
                  setActivePanelTab('dependency-nodes');
                  setDependencyNodesLoading(true);
                }
              }
              break;

            case 'tool_input_delta':
              if (event.partialInput && event.toolId) {
                // Find tool block — check nested childBlocks for sub-agent events
                const deltaToolBlock = event.parentToolUseId
                  ? findParentTaskBlock(event.parentToolUseId)?.childBlocks?.find(c => c.id === event.toolId)
                  : blocks.find(b => b.id === event.toolId);
                if (deltaToolBlock) {
                  if (!deltaToolBlock._rawInput) deltaToolBlock._rawInput = '';
                  deltaToolBlock._rawInput += event.partialInput;

                  // Try to extract toolInput from partial JSON (best effort)
                  if (!deltaToolBlock.toolInput) {
                    try {
                      deltaToolBlock.toolInput = JSON.parse(deltaToolBlock._rawInput);
                      setStreamingBlocks([...blocks]);
                    } catch {
                      // Not complete JSON yet — try to extract key fields from partial
                      const raw = deltaToolBlock._rawInput;
                      const fileMatch = raw.match(/"file_path"\s*:\s*"([^"]+)"/);
                      const cmdMatch = raw.match(/"command"\s*:\s*"([^"]+)"/);
                      const patternMatch = raw.match(/"pattern"\s*:\s*"([^"]+)"/);
                      if (fileMatch || cmdMatch || patternMatch) {
                        deltaToolBlock.toolInput = {
                          ...(fileMatch ? { file_path: fileMatch[1] } : {}),
                          ...(cmdMatch ? { command: cmdMatch[1] } : {}),
                          ...(patternMatch ? { pattern: patternMatch[1] } : {})
                        };
                        setStreamingBlocks([...blocks]);
                      }
                    }
                  }
                }

                // Special handling for update_synthesis panel content
                if (event.toolName === 'update_synthesis') {
                  const extractedContent = extractContentFromPartialJson(event.partialInput);
                  if (extractedContent) {
                    setPanelContent(extractedContent);
                  }
                }
              }
              break;

            case 'tool_use':
              if (event.toolCall) {
                // Find tool block — check nested childBlocks for sub-agent events
                const existingTool = event.parentToolUseId
                  ? findParentTaskBlock(event.parentToolUseId)?.childBlocks?.find(c => c.id === event.toolCall!.id)
                  : blocks.find(b => b.id === event.toolCall!.id);
                if (existingTool) {
                  existingTool.toolInput = event.toolCall.input;
                  if (roundSaved && event.parentToolUseId) {
                    rerenderSavedMessage(event.parentToolUseId);
                  } else {
                    setStreamingBlocks([...blocks]);
                  }
                }

                if (event.toolCall.name === 'update_synthesis' && event.toolCall.input.content) {
                  setPanelContent(event.toolCall.input.content as string);
                  setPanelLoading(false);
                }
              }
              break;

            case 'tool_result':
              if (event.result) {
                // Find matching tool block — check nested childBlocks for sub-agent events
                let toolBlock: ContentBlock | undefined;
                if (event.parentToolUseId) {
                  const parentBlock = findParentTaskBlock(event.parentToolUseId);
                  toolBlock = parentBlock?.childBlocks?.find(
                    c => c.type === 'tool_use' &&
                         (event.toolId ? c.id === event.toolId : c.toolName === event.toolName) &&
                         !c.toolResult
                  );
                } else {
                  toolBlock = blocks.find(
                    b => b.type === 'tool_use' &&
                         (event.toolId ? b.id === event.toolId : b.toolName === event.toolName) &&
                         !b.toolResult
                  );
                }
                if (toolBlock) {
                  toolBlock.toolResult = event.result;

                  if (roundSaved) {
                    // Round already saved to messages — blocks are shared references,
                    // so the mutation above updated both. Trigger re-render of saved messages.
                    // For sub-agent events, search by parent Task block ID.
                    const searchId = event.parentToolUseId || toolBlock.id;
                    rerenderSavedMessage(searchId);

                    // Persist the updated contentBlocks (with toolResult) to the database
                    if (lastSavedDbMessageId) {
                      window.electronAPI.db.updateMessageContentBlocks(lastSavedDbMessageId, [...blocks])
                        .catch(err => console.error('[IdeaChat] Failed to update tool result in DB:', err));
                    }
                  } else {
                    // Round not yet saved — update streaming blocks
                    setStreamingBlocks([...blocks]);
                  }
                }

                // Clear panel loading when update_synthesis completes
                if (event.toolName === 'update_synthesis' || toolBlock?.toolName === 'update_synthesis') {
                  setPanelLoading(false);
                }

                if (event.result.success && ['create_dependency_node', 'update_dependency_node', 'delete_dependency_node', 'connect_dependency_nodes', 'disconnect_dependency_nodes'].includes(event.toolName || '')) {
                  loadDependencyNodesDebounced();
                }
              }
              break;

            case 'web_search':
              console.log('[WebSearch] Received web_search event:', event);
              setIsSearching(true);
              setSearchQuery(event.searchQuery || 'Searching...');
              setSearchResults([]);
              break;

            case 'web_search_result':
              console.log('[WebSearch] Received web_search_result event:', event);
              setIsSearching(false);
              if (event.searchResults) {
                setSearchResults(event.searchResults);
              }
              break;

            case 'note_proposal':
              if (event.proposal) {
                let proposalToolBlock = event.toolId
                  ? blocks.find(b => b.id === event.toolId && b.type === 'tool_use')
                  : null;

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

            case 'round_complete': {
              // Skip sub-agent round_complete — internal to sub-agent
              if (event.parentToolUseId) break;
              const roundTextContent = blocks.filter(b => b.type === 'text').map(b => b.content || '').join('');
              const roundThinkingBlocks = blocks.filter(b => b.type === 'thinking');
              const roundThinkingContent = roundThinkingBlocks
                .map((b, idx) => `--- Thought ${idx + 1} ---\n${b.content}`)
                .join('\n\n');

              if (blocks.length > 0) {
                const roundMsg: ChatMessage = {
                  id: crypto.randomUUID(),
                  role: 'assistant',
                  content: roundTextContent,
                  createdAt: new Date(),
                  thinking: roundThinkingContent || undefined,
                  contentBlocks: [...blocks]
                };
                setMessages(prev => [...prev, roundMsg]);

                window.electronAPI.db.addMessage({
                  conversationId: effectiveConversationId,
                  role: 'assistant',
                  content: roundTextContent,
                  thinking: roundThinkingContent || undefined,
                  contentBlocks: [...blocks],
                  inputTokens: streamTokensRef.current.input > 0 ? streamTokensRef.current.input : undefined,
                  outputTokens: streamTokensRef.current.output > 0 ? streamTokensRef.current.output : undefined
                }).then(savedMsg => {
                  // Track DB message ID so tool_result events can update it
                  lastSavedDbMessageId = savedMsg.id;
                }).catch(err => console.error('[IdeaChat] Failed to save round message:', err));
              }

              // Don't clear blocks yet — tool_result events arrive AFTER round_complete.
              // Keep blocks so tool results can match them. clearSavedRound() will
              // clean up when the next round's content starts.
              roundSaved = true;
              setStreamingBlocks([]);
              streamTokensRef.current = { input: 0, output: 0 };
              setLiveStreamingTokens({ input: 0, output: 0 });
              break;
            }

            case 'error_user_message': {
              if (event.content) {
                const errorUserMsg: ChatMessage = {
                  id: crypto.randomUUID(),
                  role: 'user',
                  content: event.content,
                  createdAt: new Date()
                };
                setMessages(prev => [...prev, errorUserMsg]);

                window.electronAPI.db.addMessage({
                  conversationId: effectiveConversationId,
                  role: 'user',
                  content: event.content
                }).catch(err => console.error('[IdeaChat] Failed to save error message:', err));
              }
              break;
            }

            case 'compact_status':
              setIsCompacting(event.compacting ?? false);
              break;

            case 'compact_boundary':
              setIsCompacting(false);
              // Insert a compaction divider message into the chat
              setMessages(prev => [...prev, {
                id: `compaction-${Date.now()}`,
                role: 'system' as const,
                content: '[COMPACTION]',
                createdAt: new Date()
              }]);
              break;

            case 'tool_progress': {
              // Update elapsed time on the matching tool block (top-level or nested)
              if (event.toolId) {
                const progressBlock = findBlockDeep(event.toolId);
                if (progressBlock) {
                  progressBlock.elapsedSeconds = event.elapsedSeconds;
                  setStreamingBlocks([...blocks]);
                }
              }
              break;
            }

            case 'subagent_done':
              // Task notification — sub-agent completed. The tool_result for the
              // Task block will handle marking it done. Nothing extra needed here.
              break;

            case 'done':
              if (event.usage) {
                streamTokensRef.current.input += event.usage.inputTokens;
                streamTokensRef.current.output += event.usage.outputTokens;
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

          // Remove IPC event listener to prevent duplicate handlers on next stream
          if (activeStreamCleanupRef.current) {
            activeStreamCleanupRef.current();
          }
          activeStreamCleanupRef.current = null;

          setIsStreaming(false);
          setIsThinking(false);
          setIsCompacting(false);
          setDependencyNodesLoading(false);

          await loadDependencyNodes();

          // Build snapshot block if one was created
          const snapshotBlock: ContentBlock | null = pendingSnapshotRef.current ? {
            id: `snapshot-${pendingSnapshotRef.current.snapshotId}`,
            type: 'version_snapshot',
            versionNumber: pendingSnapshotRef.current.versionNumber,
            snapshotId: pendingSnapshotRef.current.snapshotId
          } : null;
          pendingSnapshotRef.current = null;

          if (snapshotBlock) {
            blocks.push(snapshotBlock);
          }

          const fullTextContent = blocks
            .filter(b => b.type === 'text')
            .map(b => b.content || '')
            .join('');

          const thinkingBlocks = blocks.filter(b => b.type === 'thinking');
          const fullThinkingContent = thinkingBlocks
            .map((block, idx) => `--- Thought ${idx + 1} ---\n${block.content}`)
            .join('\n\n');

          if (roundSaved && snapshotBlock) {
            // round_complete already saved this round's blocks — save snapshot as its own message
            const snapshotMsg: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: '',
              createdAt: new Date(),
              contentBlocks: [snapshotBlock]
            };
            setMessages(prev => [...prev, snapshotMsg]);
            await window.electronAPI.db.addMessage({
              conversationId: effectiveConversationId,
              role: 'assistant',
              content: '',
              contentBlocks: [snapshotBlock]
            });
          } else if (!roundSaved && (blocks.length > 0 || fullTextContent.length > 0)) {
            // Save unsaved content (no round_complete fired for this round)
            const assistantMessage: ChatMessage = {
              id: crypto.randomUUID(),
              role: 'assistant',
              content: fullTextContent,
              createdAt: new Date(),
              thinking: fullThinkingContent || undefined,
              contentBlocks: blocks.length > 0 ? [...blocks] : undefined
            };

            setMessages(prev => [...prev, assistantMessage]);

            await window.electronAPI.db.addMessage({
              conversationId: effectiveConversationId,
              role: 'assistant',
              content: fullTextContent,
              thinking: fullThinkingContent || undefined,
              contentBlocks: blocks.length > 0 ? blocks : undefined,
              inputTokens: streamTokensRef.current.input > 0 ? streamTokensRef.current.input : undefined,
              outputTokens: streamTokensRef.current.output > 0 ? streamTokensRef.current.output : undefined
            });
          }

          setCurrentThinkingRound(0);
          setSearchQuery('');
          setSearchResults([]);
          setIsSearching(false);
          setStreamingBlocks([]);
          // Trigger dev server restart so preview shows latest code
          setPreviewRefreshKey(prev => prev + 1);
        },
        // On error
        (errorMsg: string) => {
          if (!isMountedRef.current) return;

          // Remove IPC event listener to prevent duplicate handlers on next stream
          if (activeStreamCleanupRef.current) {
            activeStreamCleanupRef.current();
          }
          activeStreamCleanupRef.current = null;
          setIsStreaming(false);
          setIsThinking(false);
          setIsCompacting(false);
          setError(errorMsg);
          setCurrentThinkingRound(0);
          setStreamingBlocks([]);
        }
      );

      activeStreamCleanupRef.current = cleanup;
    } catch (err) {
      if (isMountedRef.current) {
        setIsStreaming(false);
        setIsThinking(false);
        const errorMessage = err instanceof Error ? err.message : 'Failed to get synthesis response';
        setError(errorMessage);
      }
    }
  }, [ideaId, effectiveConversationId]);

  // Auto-start synthesis for new conversations
  useEffect(() => {
    if (
      isNewConversation &&
      messagesLoaded &&
      !hasStartedSynthesisRef.current &&
      !isStreaming &&
      !isLoading
    ) {
      const hasOnlySystemMessage = messages.length > 0 &&
        messages.every(m => m.role === 'system');

      if (hasOnlySystemMessage) {
        hasStartedSynthesisRef.current = true;

        const triggerContent = 'Analizează ideile și fa sinteza lor într-o idee. Nu propune note - doar sintetizează.';

        getSynthesisResponse(triggerContent);
      }
    }
  }, [isNewConversation, messagesLoaded, messages, isStreaming, isLoading, getSynthesisResponse, effectiveConversationId]);

  // Handle sending a message (called by ChatInput with text)
  const handleSend = useCallback(async (text: string): Promise<void> => {
    if (!text.trim() || isLoading || isStreaming) return;

    const trimmedInput = text.trim();

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmedInput,
      createdAt: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);
    setUserHasScrolled(false);

    try {
      await window.electronAPI.db.addMessage({
        conversationId: effectiveConversationId,
        role: 'user',
        content: userMessage.content
      });

      // Claude Code manages context via session IDs — just send the current message text
      await getSynthesisResponse(trimmedInput);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send message';
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, isStreaming, messages, effectiveConversationId, getSynthesisResponse]);

  // Handle stop/abort streaming
  const handleStop = useCallback(async (): Promise<void> => {
    try {
      if (activeStreamCleanupRef.current) {
        activeStreamCleanupRef.current();
        activeStreamCleanupRef.current = null;
      }

      await window.electronAPI.ai.abortSynthesis(ideaId);

      const currentBlocks = activeBlocksRef.current;
      if (currentBlocks && currentBlocks.length > 0) {
        const fullTextContent = currentBlocks
          .filter(b => b.type === 'text')
          .map(b => b.content || '')
          .join('');
        const thinkingBlocks = currentBlocks.filter(b => b.type === 'thinking');
        const fullThinkingContent = thinkingBlocks
          .map((b, i) => `--- Thought ${i + 1} ---\n${b.content}`)
          .join('\n\n');

        const partialMessage: ChatMessage = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: fullTextContent,
          createdAt: new Date(),
          thinking: fullThinkingContent || undefined,
          contentBlocks: [...currentBlocks]
        };

        setMessages(prev => [...prev, partialMessage]);

        window.electronAPI.db.addMessage({
          conversationId: effectiveConversationId,
          role: 'assistant',
          content: fullTextContent,
          thinking: fullThinkingContent || undefined,
          contentBlocks: [...currentBlocks]
        }).catch(err => console.error('[IdeaChat] Failed to save partial message:', err));
      }

      activeBlocksRef.current = [];
      setIsStreaming(false);
      setIsLoading(false);
      setIsThinking(false);
      setDependencyNodesLoading(false);
      setPanelLoading(false);
      setCurrentThinkingRound(0);
      setIsSearching(false);
      setStreamingBlocks([]);
    } catch (err) {
      console.error('Failed to stop synthesis:', err);
    }
  }, [ideaId, effectiveConversationId]);

  // Track if we should auto-send after recording (for wake word)
  const autoSendAfterRecordingRef = useRef<boolean>(false);

  // Start voice recording
  const startRecording = useCallback(async (autoSend = false): Promise<void> => {
    try {
      setError(null);
      autoSendAfterRecordingRef.current = autoSend;

      cleanupAudioStream();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      console.log('[IdeaChat] Microphone stream acquired');

      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log('[IdeaChat] MediaRecorder stopped');
        cleanupAudioStream();
        await processRecording();
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      cleanupAudioStream();
      setError('Could not access microphone. Please grant permission.');
      console.error('Microphone error:', err);
    }
  }, []);

  // Stop voice recording
  const stopRecording = useCallback((): void => {
    console.log('[IdeaChat] Stop recording called');
    if (mediaRecorderRef.current && isRecording) {
      try {
        mediaRecorderRef.current.stop();
        setIsRecording(false);
        setIsProcessingAudio(true);
      } catch (err) {
        console.error('[IdeaChat] Error stopping recorder:', err);
        cleanupAudioStream();
        setIsRecording(false);
        setIsProcessingAudio(false);
      }
    } else {
      cleanupAudioStream();
      setIsRecording(false);
    }
  }, [isRecording]);

  // Process recorded audio through STT
  const processRecording = async (): Promise<void> => {
    try {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioData = Array.from(new Uint8Array(arrayBuffer));

      const result = await window.electronAPI.stt.transcribe(audioData, 'audio/webm');

      if (result.text && result.text.trim()) {
        const transcribedText = result.text.trim();

        if (autoSendAfterRecordingRef.current) {
          autoSendAfterRecordingRef.current = false;
          setIsProcessingAudio(false);

          const userMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'user',
            content: transcribedText,
            createdAt: new Date()
          };

          setMessages(prev => [...prev, userMessage]);
          setIsLoading(true);
          setUserHasScrolled(false);

          await window.electronAPI.db.addMessage({
            conversationId: effectiveConversationId,
            role: 'user',
            content: userMessage.content
          });

          const allMessages = [...messages, userMessage].map(m => ({
            role: m.role,
            content: m.content,
            thinking: m.thinking,
            contentBlocks: m.contentBlocks
          }));

          await getSynthesisResponse(allMessages);
          setIsLoading(false);
        } else {
          // Normal mode - pass to ChatInput via pending transcription
          setPendingTranscription(transcribedText);
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

  // Clear pending transcription after ChatInput consumes it
  const handleTranscriptionConsumed = useCallback(() => {
    setPendingTranscription(null);
  }, []);

  // ─── Voice Agent: invisible recording → STT → Haiku DOM navigation ───

  // Start invisible recording for voice agent (no UI indicator)
  const startVoiceAgentRecording = useCallback(async () => {
    try {
      // Cleanup any previous voice agent stream
      if (voiceAgentStreamRef.current) {
        voiceAgentStreamRef.current.getTracks().forEach(t => t.stop());
        voiceAgentStreamRef.current = null;
      }
      voiceAgentRecorderRef.current = null;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceAgentStreamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      voiceAgentChunksRef.current = [];

      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          voiceAgentChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        console.log('[VoiceAgent] Recording stopped, transcribing...');
        // Cleanup mic stream
        if (voiceAgentStreamRef.current) {
          voiceAgentStreamRef.current.getTracks().forEach(t => t.stop());
          voiceAgentStreamRef.current = null;
        }
        voiceAgentRecorderRef.current = null;

        // Transcribe the audio
        try {
          const audioBlob = new Blob(voiceAgentChunksRef.current, { type: 'audio/webm' });
          const arrayBuffer = await audioBlob.arrayBuffer();
          const audioData = Array.from(new Uint8Array(arrayBuffer));

          const result = await window.electronAPI.stt.transcribe(audioData, 'audio/webm');
          if (result.text && result.text.trim()) {
            const command = result.text.trim();
            console.log('[VoiceAgent] Transcribed command:', command);
            runVoiceAgentCommand(command);
          } else {
            console.log('[VoiceAgent] No text transcribed');
            setIsVoiceAgentRecording(false);
          }
        } catch (err) {
          console.error('[VoiceAgent] Transcription error:', err);
          setIsVoiceAgentRecording(false);
        }
      };

      voiceAgentRecorderRef.current = recorder;
      recorder.start();
      setIsVoiceAgentRecording(true);
      console.log('[VoiceAgent] Invisible recording started');
    } catch (err) {
      console.error('[VoiceAgent] Failed to start recording:', err);
    }
  }, []);

  // Stop invisible recording (triggers onstop → transcribe → voice agent)
  const stopVoiceAgentRecording = useCallback(() => {
    // Use ref (not state) to avoid stale closure from wake word effect
    if (voiceAgentRecorderRef.current) {
      try {
        voiceAgentRecorderRef.current.stop();
        setIsVoiceAgentRecording(false);
      } catch (err) {
        console.error('[VoiceAgent] Error stopping recorder:', err);
        setIsVoiceAgentRecording(false);
      }
    }
  }, []);

  // Run a voice command through the Haiku voice agent
  const runVoiceAgentCommand = useCallback(async (command: string) => {
    setIsVoiceAgentRunning(true);
    setVoiceAgentResponse(null);

    // Clear any existing response timer
    if (voiceAgentResponseTimerRef.current) {
      clearTimeout(voiceAgentResponseTimerRef.current);
      voiceAgentResponseTimerRef.current = null;
    }

    let responseText = '';

    try {
      const cleanup = await window.electronAPI.voiceAgent.run(
        ideaId,
        command,
        (event) => {
          // Accumulate text responses
          if (event.type === 'text' && event.content) {
            responseText += event.content;
            setVoiceAgentResponse(responseText);
          }
        },
        () => {
          // Stream ended
          setIsVoiceAgentRunning(false);
          if (responseText) {
            setVoiceAgentResponse(responseText);
          }
          // Auto-clear response after 5 seconds
          voiceAgentResponseTimerRef.current = setTimeout(() => {
            setVoiceAgentResponse(null);
          }, 5000);
        },
        (error) => {
          console.error('[VoiceAgent] Error:', error);
          setIsVoiceAgentRunning(false);
          setVoiceAgentResponse('Error: ' + error);
          voiceAgentResponseTimerRef.current = setTimeout(() => {
            setVoiceAgentResponse(null);
          }, 5000);
        }
      );

      voiceAgentCleanupRef.current = cleanup;
    } catch (err) {
      console.error('[VoiceAgent] Failed to run command:', err);
      setIsVoiceAgentRunning(false);
    }
  }, [ideaId]);

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
          {/* Wake word toggle button */}
          {isWakeWordAvailable && (
            <button
              onClick={() => setIsWakeWordEnabled(!isWakeWordEnabled)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors ${
                isWakeWordEnabled
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'text-blue-300 hover:text-emerald-400 hover:bg-[#1e3a5f]'
              }`}
              aria-label="Toggle voice activation"
              title={isWakeWordEnabled ? 'Voice active - say "Alexa" to start/stop recording' : 'Enable voice activation'}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <span className="text-sm">Alexa</span>
              {isWakeWordEnabled && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>
          )}

          {/* Tree button */}
          <button
            onClick={handleOpenTree}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-blue-300 hover:text-emerald-400 hover:bg-[#1e3a5f] transition-colors"
            aria-label="Conversation tree"
            title="Open conversation tree"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 20v-8m0 0V8m0 4l-5-5m5 5l5-5" />
              <circle cx="7" cy="3" r="2" strokeWidth={2} />
              <circle cx="17" cy="3" r="2" strokeWidth={2} />
              <circle cx="12" cy="20" r="2" strokeWidth={2} />
            </svg>
            <span className="text-sm">Tree</span>
          </button>

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
          <div className={`mx-auto transition-all duration-300 ease-in-out ${
            panelOpen ? 'max-w-2xl' : 'max-w-4xl'
          }`}>
            {/* Virtualized message list */}
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map(virtualRow => (
                <div
                  key={filteredMessages[virtualRow.index].id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <div className="pb-6">
                    <MessageItem
                      message={filteredMessages[virtualRow.index]}
                      proposalStatuses={proposalStatuses}
                      onAcceptProposal={handleAcceptProposal}
                      onRejectProposal={handleRejectProposal}
                      onViewSnapshot={handleViewSnapshot}
                      onRestoreSnapshot={handleRestoreSnapshot}
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Streaming area - outside virtual list, always at bottom */}
            <StreamingArea
              isStreaming={isStreaming}
              isThinking={isThinking}
              isCompacting={isCompacting}
              streamingBlocks={streamingBlocks}
              isSearching={isSearching}
              searchQuery={searchQuery}
              searchResults={searchResults}
              proposalStatuses={proposalStatuses}
              isLoading={isLoading}
              onAcceptProposal={handleAcceptProposal}
              onRejectProposal={handleRejectProposal}
            />

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
          dependencyNodes={dependencyNodes}
          dependencyConnections={dependencyConnections}
          dependencyNodesLoading={dependencyNodesLoading}
          onNodePositionChange={handleNodePositionChange}
          ideaId={ideaId}
          activeBranchId={activeBranchId}
          conversationId={effectiveConversationId}
          streamingTokens={{
            input: liveStreamingTokens.input,
            output: liveStreamingTokens.output,
            isStreaming: isStreaming
          }}
          viewingSnapshot={viewingSnapshotData ? {
            versionNumber: viewingSnapshotData.versionNumber,
            synthesisContent: viewingSnapshotData.synthesisContent,
            nodes: viewingSnapshotData.nodes,
            connections: viewingSnapshotData.connections
          } : undefined}
          onBackToLive={handleBackToLive}
          onRestoreSnapshot={viewingSnapshotId ? () => handleRestoreSnapshot(viewingSnapshotId) : undefined}
          previewRefreshKey={previewRefreshKey}
        />
      </div>

      {/* Input area - extracted component with local state */}
      <ChatInput
        onSend={handleSend}
        onStop={handleStop}
        isLoading={isLoading}
        isStreaming={isStreaming}
        isRecording={isRecording}
        isProcessingAudio={isProcessingAudio}
        onStartRecording={startRecording}
        onStopRecording={stopRecording}
        panelOpen={panelOpen}
        pendingTranscription={pendingTranscription}
        onTranscriptionConsumed={handleTranscriptionConsumed}
      />

      {/* Voice Agent floating overlay */}
      {(isVoiceAgentRecording || isVoiceAgentRunning || voiceAgentResponse) && (
        <div className="fixed bottom-24 right-6 z-50 max-w-xs">
          <div className="bg-[#1a2744] border border-[#2a4a7f] rounded-lg px-4 py-3 shadow-xl">
            {isVoiceAgentRecording && (
              <div className="flex items-center gap-2 text-red-400 text-sm">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                Listening... say your command, then &quot;Alexa&quot; to send
              </div>
            )}
            {isVoiceAgentRunning && !voiceAgentResponse && (
              <div className="flex items-center gap-2 text-blue-400 text-sm">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Voice Agent working...
              </div>
            )}
            {voiceAgentResponse && (
              <div className="text-[#c5d5e8] text-sm leading-relaxed">
                {voiceAgentResponse}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Conversation Tree overlay */}
      {showTree && (
        <ConversationTree
          ideaId={ideaId}
          branches={branches}
          activeBranchId={activeBranchId}
          onSwitchBranch={handleSwitchBranch}
          onCreateChild={handleCreateChild}
          onDeleteBranch={handleDeleteBranch}
          onClose={() => setShowTree(false)}
          isCreatingBranch={isCreatingBranch}
        />
      )}
    </div>
  );
}
