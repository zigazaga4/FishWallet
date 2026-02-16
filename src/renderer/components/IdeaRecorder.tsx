import { useState, useRef, useEffect, type ReactElement } from 'react';

// Props for the IdeaRecorder component
interface IdeaRecorderProps {
  ideaId: string;
  onBack: () => void;
  onOpenChat: (ideaId: string, conversationId: string, isNew: boolean) => void;
}

// Note type from the database
interface Note {
  id: string;
  ideaId: string;
  content: string;
  durationMs: number | null;
  createdAt: Date;
}

// Recording state
type RecordingState = 'idle' | 'recording' | 'processing';

// Voice recorder component with batch transcription
// Uses gpt-4o-mini-transcribe for best accuracy
// Supports unlimited duration via automatic chunking (requires ffmpeg)
export function IdeaRecorder({ ideaId, onBack, onOpenChat }: IdeaRecorderProps): ReactElement {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle');
  const [notes, setNotes] = useState<Note[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isSTTInitialized, setIsSTTInitialized] = useState<boolean>(false);
  const [isAIInitialized, setIsAIInitialized] = useState<boolean>(false);
  const [hasSynthesis, setHasSynthesis] = useState<boolean>(false);
  const [isSynthesizing, setIsSynthesizing] = useState<boolean>(false);
  const [recordingDuration, setRecordingDuration] = useState<number>(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingStartTimeRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const durationIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup function to stop all media tracks
  const cleanupStream = (): void => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log('[IdeaRecorder] Stopped track:', track.kind, track.label);
      });
      streamRef.current = null;
    }
    mediaRecorderRef.current = null;
  };

  // Load existing data on mount and cleanup on unmount
  useEffect(() => {
    loadData();

    // Cleanup on unmount - stop any active recording
    return () => {
      console.log('[IdeaRecorder] Unmounting, cleaning up...');
      cleanupStream();
    };
  }, [ideaId]);

  // Load all data for the idea
  const loadData = async (): Promise<void> => {
    // Check services
    const sttInit = await window.electronAPI.stt.isInitialized();
    setIsSTTInitialized(sttInit);
    setIsAIInitialized(true); // Claude Code Agent SDK — no API key needed

    // Load notes
    const loadedNotes = await window.electronAPI.ideas.getNotes(ideaId);
    setNotes(loadedNotes);

    // Check if synthesis exists
    const synthesis = await window.electronAPI.ideas.getSynthesis(ideaId);
    if (synthesis) {
      setHasSynthesis(true);
    }
  };

  // Format duration as mm:ss
  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Start recording
  const startRecording = async (): Promise<void> => {
    try {
      setError(null);
      setRecordingDuration(0);

      // Clean up any existing stream first
      cleanupStream();

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      console.log('[IdeaRecorder] Microphone stream acquired');

      // Create MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm'
      });

      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        console.log('[IdeaRecorder] MediaRecorder stopped');
        // Stop all tracks using cleanup function
        cleanupStream();

        // Process the recording
        await processRecording();
      };

      mediaRecorderRef.current = mediaRecorder;
      recordingStartTimeRef.current = Date.now();

      // Start duration timer
      durationIntervalRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - recordingStartTimeRef.current) / 1000);
        setRecordingDuration(elapsed);
      }, 1000);

      mediaRecorder.start();
      setRecordingState('recording');
    } catch (err) {
      // Make sure to cleanup on error
      cleanupStream();
      setError('Could not access microphone. Please grant permission.');
      console.error('Microphone error:', err);
    }
  };

  // Stop recording
  const stopRecording = (): void => {
    console.log('[IdeaRecorder] Stop recording called');
    if (mediaRecorderRef.current && recordingState === 'recording') {
      try {
        mediaRecorderRef.current.stop();
        setRecordingState('processing');
      } catch (err) {
        // If stop fails, force cleanup
        console.error('[IdeaRecorder] Error stopping recorder:', err);
        cleanupStream();
        setRecordingState('idle');
      }
    } else {
      // Force cleanup just in case
      cleanupStream();
    }
  };

  // Process the recorded audio
  const processRecording = async (): Promise<void> => {
    try {
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      const durationMs = Date.now() - recordingStartTimeRef.current;

      console.log(`[IdeaRecorder] Processing ${(audioBlob.size / 1024 / 1024).toFixed(2)}MB audio, ${Math.round(durationMs / 1000)}s`);

      // Convert blob to array buffer then to number array
      const arrayBuffer = await audioBlob.arrayBuffer();
      const audioData = Array.from(new Uint8Array(arrayBuffer));

      // Transcribe the audio (handles chunking automatically for long audio)
      const result = await window.electronAPI.stt.transcribe(audioData, 'audio/webm');

      if (result.text && result.text.trim()) {
        // Save the note to database
        const note = await window.electronAPI.ideas.addNote({
          ideaId,
          content: result.text.trim(),
          durationMs
        });

        // Add to local state
        setNotes(prevNotes => [...prevNotes, note]);
      }

      setRecordingState('idle');
      setRecordingDuration(0);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process recording';
      setError(errorMessage);
      setRecordingState('idle');
      setRecordingDuration(0);
      console.error('Processing error:', err);
    }
  };

  // Delete a note
  const deleteNote = async (noteId: string): Promise<void> => {
    await window.electronAPI.ideas.deleteNote(noteId);
    setNotes(prevNotes => prevNotes.filter(n => n.id !== noteId));
  };

  // Start synthesis - creates conversation and opens chat
  const startSynthesis = async (): Promise<void> => {
    if (notes.length === 0) {
      setError('Add some notes before synthesizing your idea.');
      return;
    }

    setIsSynthesizing(true);
    setError(null);

    try {
      // Create synthesis conversation
      const result = await window.electronAPI.ideas.createSynthesis(ideaId);
      setHasSynthesis(true);

      // Open full screen chat - new conversation
      onOpenChat(ideaId, result.conversation.id, true);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to start synthesis';
      setError(errorMessage);
      console.error('Synthesis error:', err);
    } finally {
      setIsSynthesizing(false);
    }
  };

  // Open existing synthesis
  const openSynthesis = async (): Promise<void> => {
    const synthesis = await window.electronAPI.ideas.getSynthesis(ideaId);
    if (synthesis) {
      // Open full screen chat - existing conversation
      onOpenChat(ideaId, synthesis.conversation.id, false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col p-8">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sky-400 hover:text-sky-300 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span>Back</span>
        </button>

        <h1 className="text-2xl font-light text-blue-50">
          Your Idea
        </h1>

        {/* Synthesize button */}
        <div className="flex items-center gap-2">
          {hasSynthesis ? (
            <>
              <button
                onClick={openSynthesis}
                className="flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500
                           text-white rounded-xl transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
                <span>View Synthesis</span>
              </button>
              <button
                onClick={async () => {
                  await window.electronAPI.ideas.deleteSynthesis(ideaId);
                  setHasSynthesis(false);
                }}
                className="p-2 bg-red-900/50 hover:bg-red-800
                           text-red-300 hover:text-red-200 rounded-xl transition-colors"
                title="Delete synthesis conversation"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </>
          ) : (
            <button
              onClick={startSynthesis}
              disabled={notes.length === 0 || !isAIInitialized || isSynthesizing}
              className="flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-400
                         text-white rounded-xl transition-colors
                         disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSynthesizing ? (
                <>
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>Starting...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>Synthesize Idea</span>
                </>
              )}
            </button>
          )}
        </div>
      </header>

      {/* API Key warnings */}
      {!isSTTInitialized && (
        <div className="mb-4 p-4 bg-amber-900/20 rounded-xl border border-amber-700/50">
          <p className="text-amber-300 text-sm">
            Please initialize the OpenAI API key to enable voice transcription.
          </p>
        </div>
      )}

      {!isAIInitialized && (
        <div className="mb-4 p-4 bg-amber-900/20 rounded-xl border border-amber-700/50">
          <p className="text-amber-300 text-sm">
            Please initialize the Anthropic API key to enable idea synthesis.
          </p>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="mb-4 p-4 bg-red-900/20 rounded-xl border border-red-700/50">
          <p className="text-red-300 text-sm">{error}</p>
        </div>
      )}

      {/* Recording button */}
      <div className="flex justify-center mb-4">
        <button
          onClick={recordingState === 'recording' ? stopRecording : startRecording}
          disabled={recordingState === 'processing' || !isSTTInitialized}
          className={`relative w-24 h-24 rounded-full transition-all duration-300 ease-out
                      ${recordingState === 'recording'
                        ? 'bg-red-500 scale-110'
                        : recordingState === 'processing'
                          ? 'bg-sky-600 opacity-70'
                          : 'bg-sky-500 hover:bg-sky-400 hover:scale-105'
                      }
                      disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100`}
        >
          {/* Pulsing ring when recording */}
          {recordingState === 'recording' && (
            <span className="absolute inset-0 rounded-full bg-red-400 animate-ping" />
          )}

          {/* Icon */}
          <span className="relative z-10 flex items-center justify-center">
            {recordingState === 'processing' ? (
              <svg className="w-10 h-10 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : recordingState === 'recording' ? (
              <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg className="w-10 h-10 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            )}
          </span>
        </button>
      </div>

      {/* Recording duration */}
      {recordingState === 'recording' && (
        <div className="text-center mb-2">
          <span className="text-2xl font-mono text-red-400">
            {formatDuration(recordingDuration)}
          </span>
        </div>
      )}

      {/* Recording status text */}
      <p className="text-center text-sky-300 mb-6 text-sm">
        {recordingState === 'recording'
          ? 'Listening... Tap to stop'
          : recordingState === 'processing'
            ? 'Transcribing your words...'
            : 'Tap to speak your thoughts'
        }
      </p>

      {/* Info about long recordings */}
      {recordingState === 'idle' && (
        <p className="text-center text-blue-300/40 mb-6 text-xs">
          Speak as long as you want - unlimited duration supported
        </p>
      )}

      {/* Notes list */}
      <div className="flex-1 overflow-auto">
        <h2 className="text-lg font-medium text-blue-50 mb-4">
          Notes ({notes.length})
        </h2>

        {notes.length === 0 ? (
          <p className="text-blue-200/60 text-center py-8">
            Your spoken thoughts will appear here
          </p>
        ) : (
          <div className="space-y-3">
            {notes.map((note) => (
              <div
                key={note.id}
                className="p-4 bg-[#112240] rounded-xl border border-[#1e3a5f]"
              >
                <p className="text-blue-100 leading-relaxed text-sm">
                  {note.content}
                </p>
                <div className="mt-2 flex items-center justify-between text-xs text-blue-200/60">
                  <span>
                    {new Date(note.createdAt).toLocaleTimeString()}
                    {note.durationMs && ` · ${formatDuration(Math.round(note.durationMs / 1000))}`}
                  </span>
                  <button
                    onClick={() => deleteNote(note.id)}
                    className="text-sky-400 hover:text-red-400 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
