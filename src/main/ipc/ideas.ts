import { ipcMain, BrowserWindow } from 'electron';
import { ideasService } from '../services/ideas';
import { speechToTextService, TranscriptionResult } from '../services/speechToText';
import { realtimeSttService, RealtimeSttSession } from '../services/realtimeStt';
import { seedDatabase } from '../services/seed';
import { Idea, Note, Conversation, Message } from '../db/schema';
import { logger } from '../services/logger';

// IPC channel names for ideas operations
export const IDEAS_CHANNELS = {
  // Idea operations
  CREATE_IDEA: 'ideas:create',
  GET_IDEA: 'ideas:get',
  GET_ALL_IDEAS: 'ideas:get-all',
  GET_IDEAS_BY_STATUS: 'ideas:get-by-status',
  UPDATE_IDEA: 'ideas:update',
  DELETE_IDEA: 'ideas:delete',
  GET_IDEA_WITH_NOTES: 'ideas:get-with-notes',

  // Note operations
  ADD_NOTE: 'ideas:add-note',
  GET_NOTES: 'ideas:get-notes',
  DELETE_NOTE: 'ideas:delete-note',
  ACCEPT_NOTE_PROPOSAL: 'ideas:accept-note-proposal',

  // Synthesis conversation operations
  CREATE_SYNTHESIS: 'ideas:create-synthesis',
  GET_SYNTHESIS: 'ideas:get-synthesis',
  HAS_SYNTHESIS: 'ideas:has-synthesis',
  DELETE_SYNTHESIS: 'ideas:delete-synthesis',
  GET_IDEA_FULL: 'ideas:get-full',

  // Speech-to-text operations (batch)
  STT_INITIALIZE: 'stt:initialize',
  STT_IS_INITIALIZED: 'stt:is-initialized',
  STT_TRANSCRIBE: 'stt:transcribe',
  STT_CLEAR: 'stt:clear',

  // Real-time speech-to-text operations (streaming)
  REALTIME_STT_START: 'realtime-stt:start',
  REALTIME_STT_SEND_AUDIO: 'realtime-stt:send-audio',
  REALTIME_STT_STOP: 'realtime-stt:stop',
  REALTIME_STT_GET_TRANSCRIPT: 'realtime-stt:get-transcript',
  // Events sent from main to renderer
  REALTIME_STT_DELTA: 'realtime-stt:delta',
  REALTIME_STT_COMPLETE: 'realtime-stt:complete',
  REALTIME_STT_ERROR: 'realtime-stt:error',

  // Dev operations
  DEV_SEED: 'dev:seed'
} as const;

// Register all ideas-related IPC handlers
export function registerIdeasHandlers(): void {
  // IDEA HANDLERS

  // Create a new idea
  ipcMain.handle(
    IDEAS_CHANNELS.CREATE_IDEA,
    async (_event, data: { title: string }): Promise<Idea> => {
      return ideasService.createIdea(data);
    }
  );

  // Get an idea by ID
  ipcMain.handle(
    IDEAS_CHANNELS.GET_IDEA,
    (_event, id: string): Idea | null => {
      return ideasService.getIdea(id);
    }
  );

  // Get all ideas
  ipcMain.handle(
    IDEAS_CHANNELS.GET_ALL_IDEAS,
    (): Idea[] => {
      return ideasService.getAllIdeas();
    }
  );

  // Get ideas by status
  ipcMain.handle(
    IDEAS_CHANNELS.GET_IDEAS_BY_STATUS,
    (_event, status: 'active' | 'completed' | 'archived'): Idea[] => {
      return ideasService.getIdeasByStatus(status);
    }
  );

  // Update an idea
  ipcMain.handle(
    IDEAS_CHANNELS.UPDATE_IDEA,
    (_event, id: string, data: Partial<Pick<Idea, 'title' | 'status'>>): Idea => {
      return ideasService.updateIdea(id, data);
    }
  );

  // Delete an idea
  ipcMain.handle(
    IDEAS_CHANNELS.DELETE_IDEA,
    (_event, id: string): void => {
      ideasService.deleteIdea(id);
    }
  );

  // Get idea with notes
  ipcMain.handle(
    IDEAS_CHANNELS.GET_IDEA_WITH_NOTES,
    (_event, id: string): { idea: Idea; notes: Note[] } | null => {
      return ideasService.getIdeaWithNotes(id);
    }
  );

  // NOTE HANDLERS

  // Add a note to an idea
  ipcMain.handle(
    IDEAS_CHANNELS.ADD_NOTE,
    (_event, data: { ideaId: string; content: string; durationMs?: number }): Note => {
      return ideasService.addNote(data);
    }
  );

  // Get all notes for an idea
  ipcMain.handle(
    IDEAS_CHANNELS.GET_NOTES,
    (_event, ideaId: string): Note[] => {
      return ideasService.getNotes(ideaId);
    }
  );

  // Delete a note
  ipcMain.handle(
    IDEAS_CHANNELS.DELETE_NOTE,
    (_event, id: string): void => {
      ideasService.deleteNote(id);
    }
  );

  // Accept a note proposal from AI - creates the actual note
  ipcMain.handle(
    IDEAS_CHANNELS.ACCEPT_NOTE_PROPOSAL,
    (_event, proposal: {
      ideaId: string;
      title: string;
      content: string;
      category: string;
    }): Note => {
      // Format the content with title and category as a header
      const formattedContent = `## ${proposal.title}\n**Category:** ${proposal.category}\n\n${proposal.content}`;
      return ideasService.addNote({
        ideaId: proposal.ideaId,
        content: formattedContent
      });
    }
  );

  // SYNTHESIS CONVERSATION HANDLERS

  // Create or get synthesis conversation for an idea
  ipcMain.handle(
    IDEAS_CHANNELS.CREATE_SYNTHESIS,
    (_event, ideaId: string): { conversation: Conversation; isNew: boolean } => {
      return ideasService.createSynthesisConversation(ideaId);
    }
  );

  // Get synthesis conversation for an idea
  ipcMain.handle(
    IDEAS_CHANNELS.GET_SYNTHESIS,
    (_event, ideaId: string): { conversation: Conversation; messages: Message[] } | null => {
      return ideasService.getSynthesisConversation(ideaId);
    }
  );

  // Check if idea has synthesis conversation
  ipcMain.handle(
    IDEAS_CHANNELS.HAS_SYNTHESIS,
    (_event, ideaId: string): boolean => {
      return ideasService.hasSynthesisConversation(ideaId);
    }
  );

  // Delete synthesis conversation for an idea
  ipcMain.handle(
    IDEAS_CHANNELS.DELETE_SYNTHESIS,
    (_event, ideaId: string): void => {
      ideasService.deleteSynthesisConversation(ideaId);
    }
  );

  // Get full idea data including notes and conversation
  ipcMain.handle(
    IDEAS_CHANNELS.GET_IDEA_FULL,
    (_event, ideaId: string): {
      idea: Idea;
      notes: Note[];
      conversation: Conversation | null;
      messages: Message[];
    } | null => {
      return ideasService.getIdeaFull(ideaId);
    }
  );

  // SPEECH-TO-TEXT HANDLERS

  // Initialize speech-to-text with OpenAI API key
  ipcMain.handle(
    IDEAS_CHANNELS.STT_INITIALIZE,
    (_event, apiKey: string): { success: boolean; error?: string } => {
      try {
        speechToTextService.initialize(apiKey);
        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        return { success: false, error: errorMessage };
      }
    }
  );

  // Check if speech-to-text is initialized
  ipcMain.handle(
    IDEAS_CHANNELS.STT_IS_INITIALIZED,
    (): boolean => {
      return speechToTextService.isInitialized();
    }
  );

  // Transcribe audio
  ipcMain.handle(
    IDEAS_CHANNELS.STT_TRANSCRIBE,
    async (_event, audioData: number[], mimeType: string): Promise<TranscriptionResult> => {
      const buffer = Buffer.from(audioData);
      return speechToTextService.transcribe(buffer, mimeType);
    }
  );

  // Clear speech-to-text service
  ipcMain.handle(
    IDEAS_CHANNELS.STT_CLEAR,
    (): void => {
      speechToTextService.clear();
    }
  );

  // REAL-TIME SPEECH-TO-TEXT HANDLERS

  // Active session reference
  let activeRealtimeSession: RealtimeSttSession | null = null;

  // Start real-time transcription session
  ipcMain.handle(
    IDEAS_CHANNELS.REALTIME_STT_START,
    async (event, language: string = 'ro'): Promise<{ success: boolean; error?: string }> => {
      try {
        // Initialize service if not already
        if (!realtimeSttService.isInitialized()) {
          realtimeSttService.initializeFromEnv();
        }

        if (!realtimeSttService.isInitialized()) {
          return { success: false, error: 'OpenAI API key not configured' };
        }

        // Get the sender window to send events back
        const senderWindow = BrowserWindow.fromWebContents(event.sender);

        // Start session with callbacks
        activeRealtimeSession = await realtimeSttService.startSession({
          onTranscriptDelta: (delta) => {
            if (senderWindow && !senderWindow.isDestroyed()) {
              senderWindow.webContents.send(IDEAS_CHANNELS.REALTIME_STT_DELTA, delta);
            }
          },
          onTranscriptComplete: (transcript) => {
            if (senderWindow && !senderWindow.isDestroyed()) {
              senderWindow.webContents.send(IDEAS_CHANNELS.REALTIME_STT_COMPLETE, transcript);
            }
          },
          onError: (error) => {
            logger.error('[RealtimeSTT-IPC] Error:', error);
            if (senderWindow && !senderWindow.isDestroyed()) {
              senderWindow.webContents.send(IDEAS_CHANNELS.REALTIME_STT_ERROR, error);
            }
          },
          onSessionCreated: () => {
            logger.info('[RealtimeSTT-IPC] Session ready');
          },
          onSessionEnded: () => {
            logger.info('[RealtimeSTT-IPC] Session ended');
            activeRealtimeSession = null;
          }
        }, language);

        return { success: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to start real-time STT';
        logger.error('[RealtimeSTT-IPC] Start failed:', errorMessage);
        return { success: false, error: errorMessage };
      }
    }
  );

  // Send audio to real-time session (PCM16 Int16Array)
  ipcMain.handle(
    IDEAS_CHANNELS.REALTIME_STT_SEND_AUDIO,
    (_event, audioData: number[]): void => {
      if (activeRealtimeSession?.isActive()) {
        const buffer = Buffer.from(new Int16Array(audioData).buffer);
        activeRealtimeSession.sendAudio(buffer);
      }
    }
  );

  // Stop real-time transcription session
  ipcMain.handle(
    IDEAS_CHANNELS.REALTIME_STT_STOP,
    (): string => {
      const transcript = activeRealtimeSession?.getFullTranscript() || '';
      activeRealtimeSession?.close();
      activeRealtimeSession = null;
      return transcript;
    }
  );

  // Get current transcript from active session
  ipcMain.handle(
    IDEAS_CHANNELS.REALTIME_STT_GET_TRANSCRIPT,
    (): string => {
      return activeRealtimeSession?.getFullTranscript() || '';
    }
  );

  // DEV HANDLERS

  // Seed database with test data
  ipcMain.handle(
    IDEAS_CHANNELS.DEV_SEED,
    async (): Promise<{ ideas: number; notes: number }> => {
      return seedDatabase();
    }
  );
}
