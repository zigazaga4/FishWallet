import WebSocket from 'ws';
import { logger } from './logger';

// Real-time Speech-to-Text service using OpenAI Realtime API
// Streams audio via WebSocket for unlimited duration transcription

const REALTIME_URL = 'wss://api.openai.com/v1/realtime';
const REALTIME_MODEL = 'gpt-4o-realtime-preview';  // Connection model
const TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';  // Transcription model

// Events from server
interface ServerEvent {
  type: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

// Session callbacks
export interface RealtimeSttCallbacks {
  onTranscriptDelta?: (delta: string) => void;
  onTranscriptComplete?: (transcript: string) => void;
  onError?: (error: string) => void;
  onSessionCreated?: () => void;
  onSessionEnded?: () => void;
}

// Real-time STT session
export class RealtimeSttSession {
  private ws: WebSocket | null = null;
  private apiKey: string;
  private callbacks: RealtimeSttCallbacks;
  private isSessionReady = false;
  private fullTranscript = '';
  private language: string;

  constructor(apiKey: string, callbacks: RealtimeSttCallbacks, language = 'ro') {
    this.apiKey = apiKey;
    this.callbacks = callbacks;
    this.language = language;
  }

  // Start the real-time transcription session
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      logger.info('[RealtimeSTT] Starting session...');

      // Use the realtime model in URL
      const url = `${REALTIME_URL}?model=${REALTIME_MODEL}`;

      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });

      this.ws.on('open', () => {
        logger.info('[RealtimeSTT] WebSocket connected');
        this.configureSession();
      });

      this.ws.on('message', (data: Buffer) => {
        try {
          const event: ServerEvent = JSON.parse(data.toString());
          this.handleServerEvent(event, resolve);
        } catch (error) {
          logger.error('[RealtimeSTT] Failed to parse server event:', error);
        }
      });

      this.ws.on('error', (error) => {
        logger.error('[RealtimeSTT] WebSocket error:', error);
        this.callbacks.onError?.(error.message);
        reject(error);
      });

      this.ws.on('close', (code, reason) => {
        logger.info(`[RealtimeSTT] WebSocket closed: ${code} - ${reason.toString()}`);
        this.isSessionReady = false;
        this.callbacks.onSessionEnded?.();
      });

      // Timeout for session creation
      setTimeout(() => {
        if (!this.isSessionReady) {
          reject(new Error('Session creation timeout'));
          this.close();
        }
      }, 15000);
    });
  }

  // Configure the transcription session
  private configureSession(): void {
    // Use session.update with input_audio_transcription enabled
    const sessionConfig = {
      type: 'session.update',
      session: {
        modalities: ['text'],
        input_audio_format: 'pcm16',
        input_audio_transcription: {
          model: TRANSCRIPTION_MODEL,
          language: this.language
        },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500
        }
      }
    };

    this.send(sessionConfig);
    logger.info('[RealtimeSTT] Session config sent:', JSON.stringify(sessionConfig, null, 2));
  }

  // Handle events from the server
  private handleServerEvent(event: ServerEvent, onReady?: (value: void) => void): void {
    // Log ALL events for debugging
    logger.debug(`[RealtimeSTT] Event received: ${event.type}`);

    switch (event.type) {
      case 'session.created':
        logger.info('[RealtimeSTT] Session created');
        this.isSessionReady = true;
        this.callbacks.onSessionCreated?.();
        onReady?.();
        break;

      case 'session.updated':
        logger.info('[RealtimeSTT] Session updated successfully');
        break;

      case 'input_audio_buffer.speech_started':
        logger.info('[RealtimeSTT] Speech started - VAD detected voice');
        break;

      case 'input_audio_buffer.speech_stopped':
        logger.info('[RealtimeSTT] Speech stopped - VAD detected silence');
        break;

      case 'input_audio_buffer.committed':
        logger.info('[RealtimeSTT] Audio buffer committed');
        break;

      case 'conversation.item.created':
        logger.info('[RealtimeSTT] Conversation item created:', event.item?.type);
        break;

      // Transcription events - multiple possible event names
      case 'conversation.item.input_audio_transcription.delta':
        logger.info(`[RealtimeSTT] Transcription delta: "${event.delta}"`);
        if (event.delta) {
          this.callbacks.onTranscriptDelta?.(event.delta);
        }
        break;

      case 'conversation.item.input_audio_transcription.completed':
        logger.info(`[RealtimeSTT] Transcription completed: "${event.transcript}"`);
        if (event.transcript) {
          this.fullTranscript += (this.fullTranscript ? ' ' : '') + event.transcript;
          this.callbacks.onTranscriptComplete?.(event.transcript);
        }
        break;

      // Alternative event name format
      case 'conversation.item.audio_transcription.completed':
        logger.info(`[RealtimeSTT] Audio transcription completed: "${event.transcript}"`);
        if (event.transcript) {
          this.fullTranscript += (this.fullTranscript ? ' ' : '') + event.transcript;
          this.callbacks.onTranscriptComplete?.(event.transcript);
        }
        break;

      case 'response.audio_transcript.delta':
        logger.info(`[RealtimeSTT] Response transcript delta: "${event.delta}"`);
        if (event.delta) {
          this.callbacks.onTranscriptDelta?.(event.delta);
        }
        break;

      case 'response.audio_transcript.done':
        logger.info(`[RealtimeSTT] Response transcript done: "${event.transcript}"`);
        if (event.transcript) {
          this.fullTranscript += (this.fullTranscript ? ' ' : '') + event.transcript;
          this.callbacks.onTranscriptComplete?.(event.transcript);
        }
        break;

      case 'error':
        logger.error('[RealtimeSTT] Server error:', JSON.stringify(event.error));
        this.callbacks.onError?.(event.error?.message || 'Unknown error');
        break;

      default:
        // Log unknown events to help debug
        if (event.type.includes('transcription') || event.type.includes('transcript')) {
          logger.info(`[RealtimeSTT] Transcription-related event: ${event.type}`, JSON.stringify(event));
        }
    }
  }

  // Send audio data (PCM16 format, base64 encoded)
  sendAudio(audioData: Buffer): void {
    if (!this.isSessionReady || !this.ws) {
      return;
    }

    const event = {
      type: 'input_audio_buffer.append',
      audio: audioData.toString('base64')
    };

    this.send(event);
  }

  // Send audio data from Int16Array (common format from Web Audio API)
  sendAudioInt16(samples: Int16Array): void {
    const buffer = Buffer.from(samples.buffer);
    this.sendAudio(buffer);
  }

  // Commit the audio buffer (trigger transcription if VAD is disabled)
  commitAudio(): void {
    if (!this.isSessionReady || !this.ws) return;

    this.send({ type: 'input_audio_buffer.commit' });
    logger.debug('[RealtimeSTT] Audio buffer committed manually');
  }

  // Get the full transcript accumulated so far
  getFullTranscript(): string {
    return this.fullTranscript;
  }

  // Clear the accumulated transcript
  clearTranscript(): void {
    this.fullTranscript = '';
  }

  // Send a message to the WebSocket
  private send(data: object): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  // Check if session is active
  isActive(): boolean {
    return this.isSessionReady && this.ws?.readyState === WebSocket.OPEN;
  }

  // Close the session
  close(): void {
    logger.info('[RealtimeSTT] Closing session');
    this.isSessionReady = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

// Service class to manage real-time STT sessions
export class RealtimeSttService {
  private apiKey: string | null = null;
  private activeSession: RealtimeSttSession | null = null;

  // Initialize with API key
  initialize(apiKey: string): void {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('OpenAI API key is required');
    }
    this.apiKey = apiKey;
    logger.info('[RealtimeSTT] Service initialized');
  }

  // Auto-initialize from environment
  initializeFromEnv(): void {
    const envApiKey = process.env.OPENAI_API_KEY;
    if (envApiKey && envApiKey.trim() !== '') {
      this.initialize(envApiKey);
    }
  }

  // Check if initialized
  isInitialized(): boolean {
    return this.apiKey !== null;
  }

  // Start a new real-time transcription session
  async startSession(callbacks: RealtimeSttCallbacks, language = 'ro'): Promise<RealtimeSttSession> {
    if (!this.apiKey) {
      throw new Error('RealtimeSTT service not initialized');
    }

    // Close any existing session
    if (this.activeSession?.isActive()) {
      this.activeSession.close();
    }

    const session = new RealtimeSttSession(this.apiKey, callbacks, language);
    await session.start();
    this.activeSession = session;
    return session;
  }

  // Get active session
  getActiveSession(): RealtimeSttSession | null {
    return this.activeSession?.isActive() ? this.activeSession : null;
  }

  // Close active session
  closeSession(): void {
    this.activeSession?.close();
    this.activeSession = null;
  }

  // Clear
  clear(): void {
    this.closeSession();
    this.apiKey = null;
  }
}

// Singleton instance
export const realtimeSttService = new RealtimeSttService();
