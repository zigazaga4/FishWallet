import OpenAI from 'openai';
import { writeFileSync, unlinkSync, readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { app } from 'electron';
import { randomUUID } from 'crypto';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import { logger } from './logger';

const execAsync = promisify(exec);

// Best OpenAI STT model - gpt-4o-mini-transcribe offers great accuracy at lower cost
// Alternative: 'gpt-4o-transcribe' for best accuracy (2x cost)
const DEFAULT_MODEL = 'gpt-4o-mini-transcribe';

// OpenAI API limits:
// - Max file size: 25MB
// - Max duration: 1500 seconds (25 minutes) per request
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;  // 20MB to be safe
const MAX_DURATION_SECONDS = 1200;  // 20 minutes to be safe (limit is 25 min)

// Chunk duration for splitting long audio (20 minutes)
const CHUNK_DURATION_SECONDS = MAX_DURATION_SECONDS;

// Transcription result
export interface TranscriptionResult {
  text: string;
  durationMs?: number;
}

// Speech-to-text service using OpenAI
export class SpeechToTextService {
  private client: OpenAI | null = null;
  private apiKey: string | null = null;
  private ffmpegAvailable: boolean | null = null;

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
    this.createClient();
    this.checkFfmpeg();
  }

  // Create a fresh OpenAI client
  private createClient(): void {
    if (!this.apiKey) return;

    logger.debug('[STT] Creating fresh OpenAI client');
    // No timeout - let the request complete naturally or be cancelled by user
    this.client = new OpenAI({
      apiKey: this.apiKey
    });
  }

  // Check if ffmpeg is available on the system
  private checkFfmpeg(): void {
    try {
      execSync('ffmpeg -version', { stdio: 'ignore' });
      this.ffmpegAvailable = true;
      logger.info('[STT] ffmpeg is available for audio chunking');
    } catch {
      this.ffmpegAvailable = false;
      logger.warn('[STT] ffmpeg not found - long audio files (>25min) will fail. Install ffmpeg for better support.');
    }
  }

  // Refresh the client (recreate to get fresh connections)
  private refreshClient(): void {
    logger.info('[STT] Refreshing OpenAI client due to connection issue');
    this.createClient();
  }

  // Check if the service is initialized
  isInitialized(): boolean {
    return this.client !== null;
  }

  // Get audio duration using ffprobe
  private async getAudioDuration(filePath: string): Promise<number> {
    try {
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
        { timeout: 10000 }
      );
      const duration = parseFloat(stdout.trim());
      logger.info(`[STT] Audio duration: ${duration.toFixed(1)} seconds`);
      return duration;
    } catch {
      logger.warn('[STT] Could not determine audio duration');
      return 0;
    }
  }

  // Split audio file into chunks using ffmpeg
  private async splitAudioIntoChunks(
    inputPath: string,
    outputDir: string,
    extension: string
  ): Promise<string[]> {
    const outputPattern = join(outputDir, `chunk_%03d.${extension}`);

    // Use ffmpeg to split audio into chunks
    // -f segment: use segment muxer
    // -segment_time: duration of each segment in seconds
    // -c copy: copy codec (fast, no re-encoding)
    const cmd = `ffmpeg -i "${inputPath}" -f segment -segment_time ${CHUNK_DURATION_SECONDS} -c copy "${outputPattern}" -y`;

    logger.info(`[STT] Splitting audio into ${CHUNK_DURATION_SECONDS / 60} minute chunks...`);

    try {
      await execAsync(cmd, { timeout: 120000 }); // 2 minute timeout for splitting
    } catch (error) {
      // ffmpeg returns non-zero exit code even on success sometimes, check if files were created
      logger.debug('[STT] ffmpeg split command completed (may have warnings)');
    }

    // Find all created chunk files
    const files = readdirSync(outputDir)
      .filter(f => f.startsWith('chunk_') && f.endsWith(`.${extension}`))
      .sort()
      .map(f => join(outputDir, f));

    if (files.length === 0) {
      throw new Error('Failed to split audio - no chunks created');
    }

    logger.info(`[STT] Created ${files.length} audio chunks`);
    return files;
  }

  // Transcribe a single audio file/chunk
  private async transcribeSingleFile(
    audioBuffer: Buffer,
    extension: string,
    mimeType: string,
    language: string,
    chunkIndex?: number
  ): Promise<string> {
    const maxRetries = 3;
    let lastError: Error | null = null;
    const chunkLabel = chunkIndex !== undefined ? ` (chunk ${chunkIndex + 1})` : '';

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.debug(`[STT] Attempt ${attempt}/${maxRetries}${chunkLabel}`);

        const file = new File([new Uint8Array(audioBuffer)], `audio.${extension}`, { type: mimeType });

        const transcription = await this.client!.audio.transcriptions.create({
          file: file,
          model: DEFAULT_MODEL,
          language: language,
          response_format: 'json'
        });

        const preview = transcription.text.length > 50
          ? transcription.text.substring(0, 50) + '...'
          : transcription.text;
        logger.info(`[STT] Transcription successful${chunkLabel}: "${preview}"`);
        return transcription.text;
      } catch (error) {
        lastError = error as Error;
        const errorName = (error as Error).name || 'Unknown';
        const errorMessage = (error as Error).message || 'No message';

        logger.warn(`[STT] Attempt ${attempt} failed${chunkLabel}: ${errorName} - ${errorMessage}`);

        const isConnectionError = errorName.includes('Timeout') ||
                                  errorName.includes('Connection') ||
                                  errorMessage.includes('ECONNRESET') ||
                                  errorMessage.includes('timed out');

        if (isConnectionError && attempt < maxRetries) {
          this.refreshClient();
          const waitMs = Math.pow(2, attempt - 1) * 1000;
          logger.info(`[STT] Retrying in ${waitMs}ms with fresh client...`);
          await new Promise(resolve => setTimeout(resolve, waitMs));
          continue;
        } else if (!isConnectionError) {
          throw error;
        }
      }
    }

    throw lastError || new Error('Transcription failed after all retries');
  }

  // Transcribe audio from a buffer (webm, mp3, wav, etc.)
  // Automatically chunks long audio for unlimited duration support
  async transcribe(audioBuffer: Buffer, mimeType: string, language = 'ro'): Promise<TranscriptionResult> {
    if (!this.client) {
      throw new Error('SpeechToText service not initialized. Call initialize() with API key first.');
    }

    const extension = this.getExtensionFromMimeType(mimeType);
    const tempDir = app.getPath('temp');
    const sessionId = randomUUID();
    const tempFilePath = join(tempDir, `audio_${sessionId}.${extension}`);
    const chunkDir = join(tempDir, `chunks_${sessionId}`);
    const filesToCleanup: string[] = [tempFilePath];

    const fileSizeMB = (audioBuffer.length / 1024 / 1024).toFixed(2);
    logger.info(`[STT] Starting transcription: ${fileSizeMB} MB, ${mimeType}, language: ${language}`);

    try {
      // Write the buffer to a temporary file
      writeFileSync(tempFilePath, audioBuffer);

      // Check if we need to chunk the audio (by size or duration)
      let needsChunking = audioBuffer.length > MAX_FILE_SIZE_BYTES;
      let audioDuration = 0;

      // If ffmpeg is available, also check duration
      if (this.ffmpegAvailable) {
        audioDuration = await this.getAudioDuration(tempFilePath);
        if (audioDuration > MAX_DURATION_SECONDS) {
          needsChunking = true;
          logger.info(`[STT] Audio exceeds ${MAX_DURATION_SECONDS / 60} minutes, will chunk`);
        }
      }

      if (needsChunking && this.ffmpegAvailable) {
        logger.info(`[STT] Chunking required (size: ${fileSizeMB}MB, duration: ${audioDuration.toFixed(0)}s)`);

        // Create chunk directory
        const { mkdirSync } = await import('fs');
        mkdirSync(chunkDir, { recursive: true });
        filesToCleanup.push(chunkDir);

        // Split audio into chunks
        const chunkPaths = await this.splitAudioIntoChunks(tempFilePath, chunkDir, extension);

        // Transcribe each chunk
        const transcriptions: string[] = [];
        for (let i = 0; i < chunkPaths.length; i++) {
          logger.info(`[STT] Transcribing chunk ${i + 1}/${chunkPaths.length}...`);
          const chunkBuffer = readFileSync(chunkPaths[i]);
          const text = await this.transcribeSingleFile(chunkBuffer, extension, mimeType, language, i);
          transcriptions.push(text);
          filesToCleanup.push(chunkPaths[i]);
        }

        // Combine transcriptions
        const fullText = transcriptions.join(' ');
        logger.info(`[STT] Combined ${chunkPaths.length} chunks into ${fullText.length} characters`);

        return {
          text: fullText,
          durationMs: audioDuration > 0 ? audioDuration * 1000 : undefined
        };
      } else {
        // File is small enough, transcribe directly
        if (needsChunking && !this.ffmpegAvailable) {
          logger.warn(`[STT] Large/long file without ffmpeg - may fail. Install ffmpeg for chunking support.`);
        }

        const text = await this.transcribeSingleFile(audioBuffer, extension, mimeType, language);
        return {
          text,
          durationMs: audioDuration > 0 ? audioDuration * 1000 : undefined
        };
      }
    } finally {
      // Clean up all temporary files
      for (const filePath of filesToCleanup) {
        try {
          if (existsSync(filePath)) {
            const { rmSync, statSync } = await import('fs');
            const stat = statSync(filePath);
            if (stat.isDirectory()) {
              rmSync(filePath, { recursive: true, force: true });
            } else {
              unlinkSync(filePath);
            }
          }
        } catch {
          // Ignore cleanup errors
        }
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
