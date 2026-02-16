// Wake word detection service using openWakeWord (ONNX/WASM)
// Runs 100% locally in the browser — no accounts, no servers
// Currently uses "alexa" keyword; swap model file for custom wake words

/* eslint-disable @typescript-eslint/no-explicit-any */

import * as ort from 'onnxruntime-web';
import { WakeWordEngine } from 'openwakeword-wasm-browser';

type WakeWordCallback = () => void;

interface WakeWordServiceConfig {
  onWakeWord: WakeWordCallback;  // Called when "alexa" is detected
  onStopWord?: WakeWordCallback;  // Called on second detection (toggle)
  onError?: (error: string) => void;
}

// Monotonic counter to detect stale async continuations (React strict mode)
let startGeneration = 0;

class WakeWordService {
  private engine: any = null;
  private isListening = false;
  private config: WakeWordServiceConfig | null = null;
  private wakeActive = false;  // Tracks toggle state: false = waiting for wake, true = waiting for stop

  // Check if wake word service is available
  isAvailable(): boolean {
    return typeof window !== 'undefined' &&
      typeof AudioContext !== 'undefined' &&
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia;
  }

  // Start listening for wake words
  async start(config: WakeWordServiceConfig): Promise<boolean> {
    if (!this.isAvailable()) {
      console.warn('[WakeWord] Wake word service not available');
      config.onError?.('Voice activation not available');
      return false;
    }

    if (this.isListening && this.engine) {
      this.config = config;
      return true;
    }

    this.config = config;
    this.wakeActive = false;

    // Bump generation so any in-flight start() from a previous mount aborts
    const gen = ++startGeneration;

    try {
      // Clean up any previous engine first
      if (this.engine) {
        try { await this.engine.stop(); } catch { /* ignore */ }
        this.engine = null;
      }

      // Set wasmPaths as an OBJECT (not string) so the bundle's inlined
      // Emscripten glue code is used instead of dynamically importing .mjs files
      ort.env.wasm.wasmPaths = {
        wasm: '/openwakeword/ort/ort-wasm-simd-threaded.wasm'
      } as any;

      // Create engine — do NOT pass ortWasmPath (it sets wasmPaths as a string
      // which would bypass the inlined glue code and break in Vite)
      const engine = new WakeWordEngine({
        keywords: ['alexa'],
        baseAssetUrl: '/openwakeword/models',
        detectionThreshold: 0.3,
        cooldownMs: 2000,
        debug: true,
      });

      // Load models
      console.log('[WakeWord] Loading ONNX models...');
      await engine.load();

      // Check if this start() is still current (React strict mode may have
      // unmounted and re-mounted, spawning a newer start())
      if (gen !== startGeneration) {
        console.log('[WakeWord] Stale start() detected after load, aborting');
        try { await engine.stop(); } catch { /* ignore */ }
        return false;
      }

      console.log('[WakeWord] Models loaded successfully');
      this.engine = engine;

      // Listen for detections — toggle between wake and stop
      engine.on('detect', ({ keyword, score }: { keyword: string; score: number }) => {
        if (!this.wakeActive) {
          // First detection = wake
          console.log(`[WakeWord] Wake word "${keyword}" detected (score: ${score.toFixed(2)})`);
          this.wakeActive = true;
          this.config?.onWakeWord();
        } else {
          // Second detection = stop
          console.log(`[WakeWord] Stop word "${keyword}" detected (score: ${score.toFixed(2)})`);
          this.wakeActive = false;
          this.config?.onStopWord?.();
        }
      });

      engine.on('error', (err: any) => {
        console.error('[WakeWord] Engine error:', err);
      });

      // Start microphone
      await engine.start();

      // Check again after start()
      if (gen !== startGeneration) {
        console.log('[WakeWord] Stale start() detected after engine.start, aborting');
        try { await engine.stop(); } catch { /* ignore */ }
        return false;
      }

      this.isListening = true;
      console.log('[WakeWord] Started listening — say "ALEXA" to activate/deactivate');
      return true;
    } catch (error) {
      console.error('[WakeWord] Failed to start:', error);
      config.onError?.(error instanceof Error ? error.message : 'Failed to start wake word detection');
      this.isListening = false;
      return false;
    }
  }

  // Stop listening
  async stop(): Promise<void> {
    this.isListening = false;

    if (this.engine) {
      try {
        await this.engine.stop();
      } catch {
        // Ignore stop errors
      }
      this.engine = null;
    }

    console.log('[WakeWord] Stopped listening');
  }

  // Cleanup resources
  async cleanup(): Promise<void> {
    await this.stop();
    console.log('[WakeWord] Cleaned up');
  }

  // Check if currently listening
  getIsListening(): boolean {
    return this.isListening;
  }
}

// Singleton instance
export const wakeWordService = new WakeWordService();
