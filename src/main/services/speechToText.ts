import OpenAI from 'openai';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { randomUUID } from 'crypto';

// Speech-to-text model options
const MODELS = {
  GPT4O_TRANSCRIBE: 'gpt-4o-transcribe',
  GPT4O_MINI_TRANSCRIBE: 'gpt-4o-mini-transcribe',
  WHISPER_1: 'whisper-1'
} as const;

// Default model - using gpt-4o-mini-transcribe for good balance of quality and speed
const DEFAULT_MODEL = MODELS.GPT4O_MINI_TRANSCRIBE;

// Transcription result
export interface TranscriptionResult {
  text: string;
  durationMs?: number;
}

// Speech-to-text service using OpenAI
export class SpeechToTextService {
  private client: OpenAI | null = null;
  private apiKey: string | null = null;

  // Auto-initialize from environment variable if available
  initializeFromEnv(): void {
    const envApiKey = process.env.OPENAI_API_KEY;
    if (envApiKey && envApiKey.trim() !== '') {
      this.initialize(envApiKey);
    }
  }

  // Initialize the service with an API key
  initialize(apiKey: string): void {
    if (!apiKey || apiKey.trim() === '') {
      throw new Error('OpenAI API key is required');
    }

    this.apiKey = apiKey;
    this.client = new OpenAI({
      apiKey: this.apiKey,
      timeout: Infinity
    });
  }

  // Check if the service is initialized
  isInitialized(): boolean {
    return this.client !== null;
  }

  // Transcribe audio from a buffer (webm, mp3, wav, etc.)
  async transcribe(audioBuffer: Buffer, mimeType: string): Promise<TranscriptionResult> {
    if (!this.client) {
      throw new Error('SpeechToText service not initialized. Call initialize() with API key first.');
    }

    // Determine file extension from mime type
    const extension = this.getExtensionFromMimeType(mimeType);

    // Create a temporary file for the audio
    const tempDir = app.getPath('temp');
    const tempFilePath = join(tempDir, `audio_${randomUUID()}.${extension}`);

    try {
      // Write the buffer to a temporary file
      writeFileSync(tempFilePath, audioBuffer);

      // Create a File object from the buffer for the API
      const file = new File([new Uint8Array(audioBuffer)], `audio.${extension}`, { type: mimeType });

      // Call OpenAI transcription API
      // Language set to Romanian (ro) for better accuracy with Romanian speech
      const transcription = await this.client.audio.transcriptions.create({
        file: file,
        model: DEFAULT_MODEL,
        language: 'ro',
        response_format: 'json'
      });

      return {
        text: transcription.text
      };
    } finally {
      // Clean up temporary file
      try {
        unlinkSync(tempFilePath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  // Get file extension from mime type
  private getExtensionFromMimeType(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      'audio/webm': 'webm',
      'audio/mp3': 'mp3',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'mp4',
      'audio/m4a': 'm4a',
      'audio/wav': 'wav',
      'audio/wave': 'wav',
      'audio/x-wav': 'wav',
      'audio/ogg': 'ogg'
    };

    return mimeToExt[mimeType] || 'webm';
  }

  // Clear the API key and client
  clear(): void {
    this.client = null;
    this.apiKey = null;
  }
}

// Singleton instance
export const speechToTextService = new SpeechToTextService();
