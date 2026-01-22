// ProposedNoteBlock - Displays AI-proposed notes with accept/reject buttons
// Shows collapsible content and allows user to approve adding notes to the idea
// Guided by the Holy Spirit

import { useState, type ReactElement } from 'react';

// Proposed note interface
interface ProposedNote {
  id: string;
  title: string;
  content: string;
  category: 'research' | 'decision' | 'recommendation' | 'insight' | 'warning' | 'todo';
  ideaId: string;
}

// Props for the ProposedNoteBlock component
interface ProposedNoteBlockProps {
  proposal: ProposedNote;
  onAccept: (proposal: ProposedNote) => Promise<void>;
  onReject: (proposalId: string) => void;
  isProcessing?: boolean;
  isAccepted?: boolean;
  isRejected?: boolean;
}

// Category colors and icons
const categoryStyles: Record<ProposedNote['category'], { bg: string; text: string; icon: ReactElement }> = {
  research: {
    bg: 'bg-blue-500/20',
    text: 'text-blue-400',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    )
  },
  decision: {
    bg: 'bg-purple-500/20',
    text: 'text-purple-400',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    )
  },
  recommendation: {
    bg: 'bg-emerald-500/20',
    text: 'text-emerald-400',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
      </svg>
    )
  },
  insight: {
    bg: 'bg-amber-500/20',
    text: 'text-amber-400',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
      </svg>
    )
  },
  warning: {
    bg: 'bg-red-500/20',
    text: 'text-red-400',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    )
  },
  todo: {
    bg: 'bg-cyan-500/20',
    text: 'text-cyan-400',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    )
  }
};

// Proposed note block component with accept/reject functionality
export function ProposedNoteBlock({
  proposal,
  onAccept,
  onReject,
  isProcessing = false,
  isAccepted = false,
  isRejected = false
}: ProposedNoteBlockProps): ReactElement {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const style = categoryStyles[proposal.category];
  const isResolved = isAccepted || isRejected;

  return (
    <div className={`mb-4 rounded-lg border transition-all ${
      isAccepted ? 'border-emerald-500/50 bg-emerald-500/5' :
      isRejected ? 'border-red-500/30 bg-red-500/5 opacity-60' :
      'border-[#1e3a5f] bg-[#0d1f3c]'
    }`}>
      {/* Header - clickable to expand/collapse */}
      <div className="p-3">
        <div className="flex items-start justify-between gap-3">
          {/* Left side - category badge and title */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex-1 flex items-start gap-2 text-left"
          >
            {/* Category badge */}
            <span className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
              {style.icon}
              <span className="capitalize">{proposal.category}</span>
            </span>

            {/* Title */}
            <div className="flex-1">
              <h4 className="text-sm font-medium text-blue-100">{proposal.title}</h4>
              {!isExpanded && (
                <p className="text-xs text-blue-300/60 mt-0.5 line-clamp-1">
                  {proposal.content.slice(0, 100)}...
                </p>
              )}
            </div>

            {/* Expand/collapse chevron */}
            <svg
              className={`w-4 h-4 text-blue-400 transition-transform flex-shrink-0 mt-0.5 ${isExpanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Right side - action buttons or status */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {isProcessing ? (
              <div className="flex items-center gap-1.5 text-blue-400">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                <span className="text-xs">Adding...</span>
              </div>
            ) : isAccepted ? (
              <div className="flex items-center gap-1.5 text-emerald-400">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-xs font-medium">Added</span>
              </div>
            ) : isRejected ? (
              <div className="flex items-center gap-1.5 text-red-400/70">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                <span className="text-xs">Rejected</span>
              </div>
            ) : (
              <>
                {/* Accept button */}
                <button
                  onClick={() => onAccept(proposal)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors text-xs font-medium"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Accept
                </button>
                {/* Reject button */}
                <button
                  onClick={() => onReject(proposal.id)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-red-500/10 text-red-400/70 hover:bg-red-500/20 hover:text-red-400 transition-colors text-xs font-medium"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Reject
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-0">
          <div className="p-3 bg-[#0a1628] rounded-lg border border-[#1e3a5f]/50">
            <div className="prose prose-sm prose-invert max-w-none">
              <pre className="whitespace-pre-wrap text-xs text-blue-100/90 font-sans leading-relaxed">
                {proposal.content}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
