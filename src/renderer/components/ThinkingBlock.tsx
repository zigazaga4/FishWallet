import { useState, useRef, useEffect, memo, type ReactElement } from 'react';

// Props for the ThinkingBlock component
interface ThinkingBlockProps {
  content: string;
  isThinking: boolean;
  roundNumber?: number;
}

// Collapsible thinking block component - shows Claude's extended thinking
// Guided by the Holy Spirit
export const ThinkingBlock = memo(function ThinkingBlock({ content, isThinking, roundNumber }: ThinkingBlockProps): ReactElement {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // Store the preview text - only update once when we have enough content
  const previewRef = useRef<string>('');
  const hasSetPreviewRef = useRef<boolean>(false);

  // Set preview text once when we have enough content (first ~150 chars)
  useEffect(() => {
    if (isThinking && content.length > 100 && !hasSetPreviewRef.current) {
      // Capture the first part of thinking as preview
      previewRef.current = content.slice(0, 150);
      hasSetPreviewRef.current = true;
    }
    // Reset when thinking starts fresh
    if (!isThinking && content.length === 0) {
      previewRef.current = '';
      hasSetPreviewRef.current = false;
    }
  }, [content, isThinking]);

  // Calculate approximate token count (rough estimate: 4 chars per token)
  const estimatedTokens = Math.ceil(content.length / 4);

  // Preview text to show while thinking
  const previewText = previewRef.current || content.slice(0, 150);

  return (
    <div className="mb-4">
      {/* Thinking header - clickable to expand/collapse */}
      <button
        onClick={() => !isThinking && setIsExpanded(!isExpanded)}
        disabled={isThinking}
        className={`flex items-center gap-2 text-sm transition-colors ${
          isThinking
            ? 'text-blue-300/70 cursor-default'
            : 'text-blue-300/70 hover:text-blue-200 cursor-pointer'
        }`}
      >
        {/* Thinking indicator icon */}
        {isThinking ? (
          <svg className="w-4 h-4 animate-spin text-sky-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
          </svg>
        )}

        {/* Label */}
        <span>
          {isThinking
            ? `Thinking${roundNumber ? ` (${roundNumber})` : ''}...`
            : `Thought${roundNumber ? ` ${roundNumber}` : ''}`}
        </span>

        {/* Token count badge */}
        {!isThinking && content.length > 0 && (
          <span className="px-1.5 py-0.5 text-xs bg-[#1e3a5f] rounded text-blue-300/60">
            ~{estimatedTokens.toLocaleString()} tokens
          </span>
        )}

        {/* Expand/collapse chevron - only when not thinking */}
        {!isThinking && content.length > 0 && (
          <svg
            className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>

      {/* Preview while thinking - shows beginning of thought with fade */}
      {isThinking && previewText.length > 0 && (
        <div className="mt-2 relative overflow-hidden">
          <p className="text-xs text-blue-200/50 italic leading-relaxed">
            {previewText}
          </p>
          {/* Fade overlay */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-transparent to-[#0a1628]" />
        </div>
      )}

      {/* Full thinking content - expandable after thinking is done */}
      {!isThinking && isExpanded && content.length > 0 && (
        <div className="mt-2 p-3 bg-[#0d1f3c] rounded-lg border border-[#1e3a5f]/50 max-h-80 overflow-y-auto">
          <pre className="text-xs text-blue-200/60 whitespace-pre-wrap font-mono leading-relaxed">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
});
