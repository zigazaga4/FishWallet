// ChatInput - Isolated input component with local state
// Prevents message list re-renders on every keystroke
// Guided by the Holy Spirit

import { useState, useRef, useEffect, useCallback, memo, type ReactElement } from 'react';

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  isLoading: boolean;
  isStreaming: boolean;
  isRecording: boolean;
  isProcessingAudio: boolean;
  onStartRecording: (autoSend?: boolean) => void;
  onStopRecording: () => void;
  panelOpen: boolean;
  pendingTranscription: string | null;
  onTranscriptionConsumed: () => void;
}

export const ChatInput = memo(function ChatInput({
  onSend,
  onStop,
  isLoading,
  isStreaming,
  isRecording,
  isProcessingAudio,
  onStartRecording,
  onStopRecording,
  panelOpen,
  pendingTranscription,
  onTranscriptionConsumed
}: ChatInputProps): ReactElement {
  const [inputValue, setInputValue] = useState<string>('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Handle pending voice transcription
  useEffect(() => {
    if (pendingTranscription) {
      setInputValue(prev => prev ? `${prev} ${pendingTranscription}` : pendingTranscription);
      inputRef.current?.focus();
      onTranscriptionConsumed();
    }
  }, [pendingTranscription, onTranscriptionConsumed]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputValue.trim() && !isLoading && !isStreaming) {
        onSend(inputValue.trim());
        setInputValue('');
      }
    }
  }, [inputValue, isLoading, isStreaming, onSend]);

  const handleSendClick = useCallback(() => {
    if (inputValue.trim() && !isLoading && !isStreaming) {
      onSend(inputValue.trim());
      setInputValue('');
    }
  }, [inputValue, isLoading, isStreaming, onSend]);

  return (
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
          disabled={isLoading}
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
          onClick={isRecording ? onStopRecording : () => onStartRecording()}
          disabled={isLoading || isProcessingAudio}
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
            onClick={onStop}
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
            onClick={handleSendClick}
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
  );
});
