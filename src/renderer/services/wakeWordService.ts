// Wake word detection service using Web Speech API
// Listens for "Hey Ben" to start recording and "Gata Ben" to stop

type WakeWordCallback = () => void;

interface WakeWordServiceConfig {
  onWakeWord: WakeWordCallback;  // Called when "Hey Ben" is detected
  onStopWord: WakeWordCallback;  // Called when "Gata Ben" is detected
  onError?: (error: string) => void;
}

// Check if Web Speech API is available
const SpeechRecognition = (window as unknown as { SpeechRecognition?: typeof window.SpeechRecognition; webkitSpeechRecognition?: typeof window.SpeechRecognition }).SpeechRecognition ||
                          (window as unknown as { webkitSpeechRecognition?: typeof window.SpeechRecognition }).webkitSpeechRecognition;

class WakeWordService {
  private recognition: SpeechRecognition | null = null;
  private isListening = false;
  private config: WakeWordServiceConfig | null = null;
  private restartTimeout: ReturnType<typeof setTimeout> | null = null;

  // Wake words (case-insensitive)
  private readonly WAKE_WORD = 'hey ben';
  private readonly STOP_WORD = 'gata ben';

  isAvailable(): boolean {
    return !!SpeechRecognition;
  }

  start(config: WakeWordServiceConfig): boolean {
    if (!SpeechRecognition) {
      console.warn('Web Speech API not available');
      config.onError?.('Voice activation not available in this browser');
      return false;
    }

    if (this.isListening) {
      return true;
    }

    this.config = config;
    this.recognition = new SpeechRecognition();
    this.recognition.continuous = true;
    this.recognition.interimResults = true;
    this.recognition.lang = 'ro-RO'; // Romanian for "gata ben"

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      const results = event.results;

      // Check all results for wake words
      for (let i = event.resultIndex; i < results.length; i++) {
        const transcript = results[i][0].transcript.toLowerCase().trim();
        console.log('[WakeWord] Heard:', transcript);

        // Check for wake word
        if (transcript.includes(this.WAKE_WORD) || transcript.includes('hey ben') || transcript.includes('hei ben')) {
          console.log('[WakeWord] Wake word detected!');
          this.config?.onWakeWord();
        }

        // Check for stop word
        if (transcript.includes(this.STOP_WORD) || transcript.includes('gata ben') || transcript.includes('gata, ben')) {
          console.log('[WakeWord] Stop word detected!');
          this.config?.onStopWord();
        }
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      console.error('[WakeWord] Error:', event.error);

      // Don't report "no-speech" as an error - it's normal
      if (event.error !== 'no-speech' && event.error !== 'aborted') {
        this.config?.onError?.(`Voice detection error: ${event.error}`);
      }

      // Restart on recoverable errors
      if (event.error === 'no-speech' || event.error === 'audio-capture') {
        this.scheduleRestart();
      }
    };

    this.recognition.onend = () => {
      console.log('[WakeWord] Recognition ended');
      // Auto-restart if we're still supposed to be listening
      if (this.isListening) {
        this.scheduleRestart();
      }
    };

    try {
      this.recognition.start();
      this.isListening = true;
      console.log('[WakeWord] Started listening for wake words');
      return true;
    } catch (err) {
      console.error('[WakeWord] Failed to start:', err);
      this.config?.onError?.('Failed to start voice detection');
      return false;
    }
  }

  private scheduleRestart(): void {
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
    }

    this.restartTimeout = setTimeout(() => {
      if (this.isListening && this.recognition) {
        try {
          this.recognition.start();
          console.log('[WakeWord] Restarted listening');
        } catch (err) {
          console.error('[WakeWord] Failed to restart:', err);
        }
      }
    }, 100);
  }

  stop(): void {
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    this.isListening = false;

    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        // Ignore errors when stopping
      }
      this.recognition = null;
    }

    console.log('[WakeWord] Stopped listening');
  }

  getIsListening(): boolean {
    return this.isListening;
  }
}

// Singleton instance
export const wakeWordService = new WakeWordService();
