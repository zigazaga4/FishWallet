// WebSearchBlock - Displays web search queries and results in the chat
// Shows the AI's research process as it searches for API information
// Guided by the Holy Spirit

import { useState, memo, type ReactElement } from 'react';

// Search result item interface
interface SearchResultItem {
  rank: number;
  title: string;
  url: string;
  snippet: string;
}

// Props for the WebSearchBlock component
interface WebSearchBlockProps {
  query: string;
  results: SearchResultItem[];
  isSearching: boolean;
}

// Collapsible web search block component - shows AI's web research
export const WebSearchBlock = memo(function WebSearchBlock({ query, results, isSearching }: WebSearchBlockProps): ReactElement {
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  return (
    <div className="mb-4">
      {/* Search header - clickable to expand/collapse */}
      <button
        onClick={() => !isSearching && setIsExpanded(!isExpanded)}
        disabled={isSearching}
        className={`flex items-center gap-2 text-sm transition-colors ${
          isSearching
            ? 'text-blue-300/70 cursor-default'
            : 'text-blue-300/70 hover:text-blue-200 cursor-pointer'
        }`}
      >
        {/* Search icon */}
        {isSearching ? (
          <svg className="w-4 h-4 animate-spin text-emerald-400" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        )}

        {/* Label */}
        <span>
          {isSearching ? 'Searching...' : 'Web search'}
        </span>

        {/* Result count badge */}
        {!isSearching && results.length > 0 && (
          <span className="px-1.5 py-0.5 text-xs bg-[#1e3a5f] rounded text-emerald-400/80">
            {results.length} results
          </span>
        )}

        {/* Expand/collapse chevron - only when not searching */}
        {!isSearching && results.length > 0 && (
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

      {/* Query display */}
      <div className="mt-1 ml-6">
        <p className="text-xs text-blue-200/60 italic">
          &quot;{query}&quot;
        </p>
      </div>

      {/* Results preview while searching */}
      {isSearching && (
        <div className="mt-2 ml-6 flex items-center gap-2 text-xs text-blue-300/50">
          <div className="flex gap-1">
            <div className="w-1.5 h-1.5 bg-emerald-400/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
            <div className="w-1.5 h-1.5 bg-emerald-400/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <div className="w-1.5 h-1.5 bg-emerald-400/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
          <span>Fetching results...</span>
        </div>
      )}

      {/* Full results - expandable after search is done */}
      {!isSearching && isExpanded && results.length > 0 && (
        <div className="mt-2 ml-6 space-y-2 max-h-64 overflow-y-auto">
          {results.map((result, index) => (
            <div
              key={index}
              className="p-2 bg-[#0d1f3c] rounded-lg border border-[#1e3a5f]/50 hover:border-emerald-500/30 transition-colors"
            >
              {/* Title and URL */}
              <div className="flex items-start gap-2">
                <span className="text-[10px] text-emerald-400/60 font-mono mt-0.5">
                  {result.rank}
                </span>
                <div className="flex-1 min-w-0">
                  <a
                    href={result.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium text-blue-200 hover:text-emerald-400 transition-colors line-clamp-1"
                  >
                    {result.title}
                  </a>
                  <p className="text-[10px] text-blue-400/50 truncate">
                    {result.url}
                  </p>
                </div>
                {/* External link icon */}
                <a
                  href={result.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400/50 hover:text-emerald-400 transition-colors flex-shrink-0"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
              </div>
              {/* Snippet */}
              <p className="mt-1 text-[11px] text-blue-200/50 line-clamp-2 ml-4">
                {result.snippet}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* No results message */}
      {!isSearching && results.length === 0 && (
        <div className="mt-2 ml-6 text-xs text-red-400/60">
          No results found
        </div>
      )}
    </div>
  );
});
