// Wake word detection service using Picovoice Porcupine Web
// Listens for wake words to activate/deactivate voice input
// Currently uses built-in keywords - see comments for custom keyword setup

import { Porcupine, BuiltInKeyword } from '@picovoice/porcupine-web';
import type { PorcupineDetection } from '@picovoice/porcupine-web';

// Picovoice Access Key - get yours free at https://console.picovoice.ai/
const ACCESS_KEY = 'fChEkznGPsiZne2KPG30zJhj84SU1aH7p5WHbu9nhF9Gle8eFqH+tA==';

// Built-in keywords to use
// For custom keywords like "hey ben":
// 1. Go to https://console.picovoice.ai/ppn (free account)
// 2. Create a custom wake word model for "hey ben"
// 3. Download the .ppn file for Web (base64)
// 4. Replace the keyword below with the custom model
const WAKE_KEYWORD = BuiltInKeyword.Jarvis;  // Says "Jarvis" to start
const STOP_KEYWORD = BuiltInKeyword.Terminator;  // Says "Terminator" to stop

// Model URL from Picovoice CDN (v3.0.0 params)
const MODEL_URL = 'https://cdn.picovoice.ai/models/porcupine/porcupine_params.pv';

type WakeWordCallback = () => void;

interface WakeWordServiceConfig {
  onWakeWord: WakeWordCallback;  // Called when wake word is detected ("Jarvis")
  onStopWord?: WakeWordCallback;  // Called when stop word is detected ("Terminator")
  onError?: (error: string) => void;
}

class WakeWordService {
  private porcupine: Porcupine | null = null;
  private isListening = false;
  private config: WakeWordServiceConfig | null = null;
  private initialized = false;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;

  // Check if wake word service is available
  isAvailable(): boolean {
    return typeof window !== 'undefined' &&
           typeof AudioContext !== 'undefined' &&
           typeof navigator !== 'undefined' &&
           !!navigator.mediaDevices?.getUserMedia;
  }

  // Initialize the Porcupine engine
  async initialize(config: WakeWordServiceConfig): Promise<boolean> {
    if (!this.isAvailable()) {
      console.warn('[WakeWord] Wake word service not available');
      return false;
    }

    if (this.initialized && this.porcupine) {
      return true;
    }

    this.config = config;

    try {
      // Create Porcupine instance with both wake and stop keywords
      // Using callback-based API for v4.x
      this.porcupine = await Porcupine.create(
        ACCESS_KEY,
        [WAKE_KEYWORD, STOP_KEYWORD],
        (detection: PorcupineDetection) => {
          // Callback is called when a keyword is detected
          if (detection.index === 0) {
            console.log('[WakeWord] Wake word "Jarvis" detected!');
            this.config?.onWakeWord();
          } else if (detection.index === 1) {
            console.log('[WakeWord] Stop word "Terminator" detected!');
            this.config?.onStopWord?.();
          }
        },
        { publicPath: MODEL_URL },
        {
          processErrorCallback: (error) => {
            console.error('[WakeWord] Processing error:', error);
            this.config?.onError?.(error.message);
          }
        }
      );

      this.initialized = true;
      console.log('[WakeWord] Porcupine initialized successfully');
      console.log('[WakeWord] Wake word: "Jarvis" | Stop word: "Terminator"');
      return true;
    } catch (error) {
      console.error('[WakeWord] Failed to initialize Porcupine:', error);
      config.onError?.(error instanceof Error ? error.message : 'Failed to initialize');
      return false;
    }
  }

  // Start listening for wake words
  async start(config: WakeWordServiceConfig): Promise<boolean> {
    if (!this.isAvailable()) {
      console.warn('[WakeWord] Wake word service not available');
      config.onError?.('Voice activation not available');
      return false;
    }

    if (this.isListening) {
      return true;
    }

    // Initialize if not already done
    if (!this.initialized || !this.porcupine) {
      const initResult = await this.initialize(config);
      if (!initResult || !this.porcupine) {
        config.onError?.('Failed to initialize wake word detection');
        return false;
      }
    }

    this.config = config;

    try {
      // Get microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: this.porcupine.sampleRate,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      // Create audio context
      this.audioContext = new AudioContext({
        sampleRate: this.porcupine.sampleRate
      });

      // Create source node from microphone
      this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Create script processor for audio processing
      const frameLength = this.porcupine.frameLength;
      this.processorNode = this.audioContext.createScriptProcessor(frameLength, 1, 1);

      // Buffer to accumulate samples
      let audioBuffer: number[] = [];

      this.processorNode.onaudioprocess = (event) => {
        if (!this.porcupine || !this.isListening) return;

        const inputData = event.inputBuffer.getChannelData(0);

        // Convert float32 to int16 and accumulate
        for (let i = 0; i < inputData.length; i++) {
          const sample = Math.max(-1, Math.min(1, inputData[i]));
          audioBuffer.push(sample * 0x7FFF);
        }

        // Process when we have enough samples
        while (audioBuffer.length >= frameLength) {
          const frame = new Int16Array(audioBuffer.slice(0, frameLength));
          audioBuffer = audioBuffer.slice(frameLength);

          // Process frame - callback will be triggered if keyword detected
          // Note: process() is async but we don't await it here to avoid blocking audio
          this.porcupine.process(frame).catch(err => {
            console.error('[WakeWord] Process error:', err);
          });
        }
      };

      // Connect the audio graph
      this.sourceNode.connect(this.processorNode);
      this.processorNode.connect(this.audioContext.destination);

      this.isListening = true;
      console.log('[WakeWord] Started listening');
      console.log('[WakeWord] Say "JARVIS" to start recording, "TERMINATOR" to stop');
      return true;
    } catch (error) {
      console.error('[WakeWord] Failed to start:', error);
      config.onError?.(error instanceof Error ? error.message : 'Failed to start voice detection');
      await this.stop();
      return false;
    }
  }

  // Stop listening
  async stop(): Promise<void> {
    this.isListening = false;

    // Disconnect and cleanup audio nodes
    if (this.processorNode) {
      this.processorNode.disconnect();
      this.processorNode = null;
    }

    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }

    if (this.audioContext) {
      await this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }

    // Stop media stream tracks
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }

    console.log('[WakeWord] Stopped listening');
  }

  // Cleanup resources
  async cleanup(): Promise<void> {
    await this.stop();

    if (this.porcupine) {
      await this.porcupine.release();
      this.porcupine = null;
    }

    this.initialized = false;
    console.log('[WakeWord] Cleaned up');
  }

  // Check if currently listening
  getIsListening(): boolean {
    return this.isListening;
  }
}

// Singleton instance
export const wakeWordService = new WakeWordService();
