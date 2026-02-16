declare module 'openwakeword-wasm-browser' {
  export class WakeWordEngine {
    constructor(options?: {
      keywords?: string[];
      baseAssetUrl?: string;
      ortWasmPath?: string;
      detectionThreshold?: number;
      cooldownMs?: number;
      debug?: boolean;
      executionProviders?: string[];
      embeddingWindowSize?: number;
      frameSize?: number;
      sampleRate?: number;
      vadHangoverFrames?: number;
    });
    load(): Promise<void>;
    start(options?: { deviceId?: string; gain?: number }): Promise<void>;
    stop(): Promise<void>;
    on(event: string, handler: (payload: any) => void): () => void;
    off(event: string, handler: (payload: any) => void): void;
    setActiveKeywords(keywords: string[]): void;
    setGain(value: number): void;
  }
  export const MODEL_FILE_MAP: Record<string, string>;
}
