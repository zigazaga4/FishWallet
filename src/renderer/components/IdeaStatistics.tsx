// IdeaStatistics - Cost and token usage analytics for an idea
// Shows detailed breakdown of Claude API costs based on actual token usage
// Guided by the Holy Spirit

import { useState, useEffect, useRef, type ReactElement } from 'react';

// Streaming tokens interface (passed from parent)
interface StreamingTokens {
  input: number;
  output: number;
  isStreaming: boolean;
}

// Message type from database
interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: Date;
  inputTokens: number | null;
  outputTokens: number | null;
}

// Conversation type from database
interface Conversation {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  model: string;
  totalInputTokens: number;
  totalOutputTokens: number;
}

// Props for the component
interface IdeaStatisticsProps {
  ideaId: string;
  conversationId: string | null;
  streamingTokens?: StreamingTokens;
}

// Pricing per million tokens (from Anthropic docs - https://platform.claude.com/docs/en/about-claude/pricing)
const MODEL_PRICING: Record<string, { input: number; output: number; name: string }> = {
  // Claude Opus 4.5
  'claude-opus-4-5-20251001': { input: 5, output: 25, name: 'Claude Opus 4.5' },
  // Claude Sonnet 4.5
  'claude-sonnet-4-5-20250929': { input: 3, output: 15, name: 'Claude Sonnet 4.5' },
  // Claude Sonnet 4
  'claude-sonnet-4-20250514': { input: 3, output: 15, name: 'Claude Sonnet 4' },
  // Claude Haiku 4.5
  'claude-haiku-4-5-20251001': { input: 1, output: 5, name: 'Claude Haiku 4.5' },
  // Fallback for unknown models (assume Sonnet pricing)
  'default': { input: 3, output: 15, name: 'Claude (Unknown)' }
};

// Get pricing for a model
function getModelPricing(modelId: string): { input: number; output: number; name: string } {
  return MODEL_PRICING[modelId] || MODEL_PRICING['default'];
}

// Calculate cost from tokens
function calculateCost(inputTokens: number, outputTokens: number, modelId: string): number {
  const pricing = getModelPricing(modelId);
  const inputCost = (inputTokens / 1_000_000) * pricing.input;
  const outputCost = (outputTokens / 1_000_000) * pricing.output;
  return inputCost + outputCost;
}

// Format currency
function formatCurrency(amount: number): string {
  if (amount < 0.01) {
    return `$${amount.toFixed(6)}`;
  } else if (amount < 1) {
    return `$${amount.toFixed(4)}`;
  }
  return `$${amount.toFixed(2)}`;
}

// Format large numbers with commas
function formatNumber(num: number): string {
  return num.toLocaleString();
}

// Daily usage stats for chart
interface DailyStats {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  messageCount: number;
}

export function IdeaStatistics({ ideaId, conversationId, streamingTokens }: IdeaStatisticsProps): ReactElement {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const wasStreamingRef = useRef(false);

  // Load conversation and messages
  useEffect(() => {
    async function loadData() {
      if (!conversationId) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const result = await window.electronAPI.db.getConversationWithMessages(conversationId);
        if (result) {
          setConversation(result.conversation);
          setMessages(result.messages);

          // Calculate daily stats
          const statsMap = new Map<string, DailyStats>();
          const model = result.conversation.model;

          result.messages.forEach(msg => {
            const date = new Date(msg.createdAt).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric'
            });

            const existing = statsMap.get(date) || {
              date,
              inputTokens: 0,
              outputTokens: 0,
              cost: 0,
              messageCount: 0
            };

            const inputTokens = msg.inputTokens || 0;
            const outputTokens = msg.outputTokens || 0;

            existing.inputTokens += inputTokens;
            existing.outputTokens += outputTokens;
            existing.cost += calculateCost(inputTokens, outputTokens, model);
            existing.messageCount += 1;

            statsMap.set(date, existing);
          });

          setDailyStats(Array.from(statsMap.values()));
        }
      } catch (error) {
        console.error('Failed to load statistics:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [conversationId, refreshTrigger]);

  // Auto-refresh when streaming ends
  useEffect(() => {
    if (streamingTokens?.isStreaming) {
      wasStreamingRef.current = true;
    } else if (wasStreamingRef.current && !streamingTokens?.isStreaming) {
      // Streaming just ended, refresh data
      wasStreamingRef.current = false;
      setRefreshTrigger(prev => prev + 1);
    }
  }, [streamingTokens?.isStreaming]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-blue-300/60">
        <svg className="w-8 h-8 animate-spin text-sky-400 mb-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>Loading statistics...</span>
      </div>
    );
  }

  // No conversation yet
  if (!conversationId || !conversation) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-blue-300/60">
        <svg className="w-12 h-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <span>No usage data yet</span>
        <span className="text-sm mt-1 text-blue-300/40">Start a conversation to see statistics</span>
      </div>
    );
  }

  const pricing = getModelPricing(conversation.model);

  // Combine database totals with current streaming tokens
  const streamingInput = streamingTokens?.input || 0;
  const streamingOutput = streamingTokens?.output || 0;
  const isCurrentlyStreaming = streamingTokens?.isStreaming || false;

  const liveInputTokens = conversation.totalInputTokens + streamingInput;
  const liveOutputTokens = conversation.totalOutputTokens + streamingOutput;
  const liveTotalTokens = liveInputTokens + liveOutputTokens;

  const totalCost = calculateCost(liveInputTokens, liveOutputTokens, conversation.model);
  const inputCost = (liveInputTokens / 1_000_000) * pricing.input;
  const outputCost = (liveOutputTokens / 1_000_000) * pricing.output;
  const totalTokens = liveTotalTokens;

  // Calculate averages
  const assistantMessages = messages.filter(m => m.role === 'assistant');
  const avgInputPerMsg = assistantMessages.length > 0
    ? Math.round(conversation.totalInputTokens / assistantMessages.length)
    : 0;
  const avgOutputPerMsg = assistantMessages.length > 0
    ? Math.round(conversation.totalOutputTokens / assistantMessages.length)
    : 0;
  const avgCostPerMsg = assistantMessages.length > 0
    ? totalCost / assistantMessages.length
    : 0;

  // Find max for chart scaling
  const maxDailyCost = Math.max(...dailyStats.map(d => d.cost), 0.001);

  return (
    <div className="h-full overflow-y-auto space-y-4">
      {/* Model Info */}
      <div className="bg-[#112240] rounded-lg p-4 border border-[#1e3a5f]">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-blue-300">Model</h3>
          <span className="text-xs text-blue-400 bg-[#1e3a5f] px-2 py-0.5 rounded">
            {pricing.name}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div>
            <span className="text-blue-400">Input Price</span>
            <p className="text-blue-100 font-medium">${pricing.input}/MTok</p>
          </div>
          <div>
            <span className="text-blue-400">Output Price</span>
            <p className="text-blue-100 font-medium">${pricing.output}/MTok</p>
          </div>
        </div>
      </div>

      {/* Total Cost Card */}
      <div className={`bg-gradient-to-br from-emerald-900/30 to-emerald-800/20 rounded-lg p-4 border ${
        isCurrentlyStreaming ? 'border-emerald-400/60 shadow-lg shadow-emerald-500/20' : 'border-emerald-500/30'
      } transition-all duration-300`}>
        <div className="flex items-center gap-2 mb-2">
          <svg className={`w-5 h-5 text-emerald-400 ${isCurrentlyStreaming ? 'animate-pulse' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-emerald-300 text-sm font-medium">Total Cost</span>
          {isCurrentlyStreaming && (
            <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
              Live
            </span>
          )}
        </div>
        <p className={`text-3xl font-bold text-emerald-100 transition-all duration-150 ${
          isCurrentlyStreaming ? 'tabular-nums' : ''
        }`}>
          {formatCurrency(totalCost)}
        </p>
        <p className="text-xs text-emerald-400 mt-1">
          <span className={isCurrentlyStreaming ? 'tabular-nums' : ''}>{formatNumber(totalTokens)}</span> total tokens
          {isCurrentlyStreaming && streamingInput + streamingOutput > 0 && (
            <span className="text-emerald-300 ml-1">
              (+{formatNumber(streamingInput + streamingOutput)} streaming)
            </span>
          )}
        </p>
      </div>

      {/* Token Breakdown */}
      <div className={`bg-[#112240] rounded-lg p-4 border ${
        isCurrentlyStreaming ? 'border-sky-500/40' : 'border-[#1e3a5f]'
      } transition-colors duration-300`}>
        <h3 className="text-sm font-medium text-blue-300 mb-3">Token Breakdown</h3>

        {/* Input tokens */}
        <div className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full bg-sky-400 ${isCurrentlyStreaming ? 'animate-pulse' : ''}`} />
              <span className="text-xs text-blue-300">Input Tokens</span>
            </div>
            <span className={`text-xs text-blue-100 font-medium ${isCurrentlyStreaming ? 'tabular-nums' : ''}`}>
              {formatNumber(liveInputTokens)}
              {isCurrentlyStreaming && streamingInput > 0 && (
                <span className="text-sky-400 ml-1">(+{formatNumber(streamingInput)})</span>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex-1 bg-[#0d1f3c] rounded-full h-2 mr-3 overflow-hidden">
              <div
                className={`bg-sky-400 h-2 rounded-full transition-all duration-150 ${
                  isCurrentlyStreaming ? 'animate-pulse' : ''
                }`}
                style={{
                  width: `${totalTokens > 0 ? (liveInputTokens / totalTokens) * 100 : 0}%`
                }}
              />
            </div>
            <span className={`text-xs text-sky-400 font-medium w-20 text-right ${isCurrentlyStreaming ? 'tabular-nums' : ''}`}>
              {formatCurrency(inputCost)}
            </span>
          </div>
        </div>

        {/* Output tokens */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full bg-amber-400 ${isCurrentlyStreaming ? 'animate-pulse' : ''}`} />
              <span className="text-xs text-blue-300">Output Tokens</span>
            </div>
            <span className={`text-xs text-blue-100 font-medium ${isCurrentlyStreaming ? 'tabular-nums' : ''}`}>
              {formatNumber(liveOutputTokens)}
              {isCurrentlyStreaming && streamingOutput > 0 && (
                <span className="text-amber-400 ml-1">(+{formatNumber(streamingOutput)})</span>
              )}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <div className="flex-1 bg-[#0d1f3c] rounded-full h-2 mr-3 overflow-hidden">
              <div
                className={`bg-amber-400 h-2 rounded-full transition-all duration-150 ${
                  isCurrentlyStreaming ? 'animate-pulse' : ''
                }`}
                style={{
                  width: `${totalTokens > 0 ? (liveOutputTokens / totalTokens) * 100 : 0}%`
                }}
              />
            </div>
            <span className={`text-xs text-amber-400 font-medium w-20 text-right ${isCurrentlyStreaming ? 'tabular-nums' : ''}`}>
              {formatCurrency(outputCost)}
            </span>
          </div>
        </div>
      </div>

      {/* Averages */}
      <div className="bg-[#112240] rounded-lg p-4 border border-[#1e3a5f]">
        <h3 className="text-sm font-medium text-blue-300 mb-3">Averages per Response</h3>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="text-lg font-bold text-blue-100">{formatNumber(avgInputPerMsg)}</p>
            <p className="text-[10px] text-blue-400">Input Tokens</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-blue-100">{formatNumber(avgOutputPerMsg)}</p>
            <p className="text-[10px] text-blue-400">Output Tokens</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-emerald-400">{formatCurrency(avgCostPerMsg)}</p>
            <p className="text-[10px] text-blue-400">Cost</p>
          </div>
        </div>
      </div>

      {/* Usage by Day (simple bar chart) */}
      {dailyStats.length > 1 && (
        <div className="bg-[#112240] rounded-lg p-4 border border-[#1e3a5f]">
          <h3 className="text-sm font-medium text-blue-300 mb-3">Daily Usage</h3>
          <div className="space-y-2">
            {dailyStats.slice(-7).map(day => (
              <div key={day.date} className="flex items-center gap-2">
                <span className="text-[10px] text-blue-400 w-12 shrink-0">{day.date}</span>
                <div className="flex-1 bg-[#0d1f3c] rounded h-4 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400 flex items-center justify-end pr-1"
                    style={{ width: `${Math.max((day.cost / maxDailyCost) * 100, 5)}%` }}
                  >
                    <span className="text-[9px] text-white font-medium">
                      {formatCurrency(day.cost)}
                    </span>
                  </div>
                </div>
                <span className="text-[10px] text-blue-400 w-8 text-right">{day.messageCount} msg</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Session Info */}
      <div className="bg-[#112240] rounded-lg p-4 border border-[#1e3a5f]">
        <h3 className="text-sm font-medium text-blue-300 mb-3">Session Info</h3>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <span className="text-blue-400">Messages</span>
            <p className="text-blue-100 font-medium">{messages.length}</p>
          </div>
          <div>
            <span className="text-blue-400">AI Responses</span>
            <p className="text-blue-100 font-medium">{assistantMessages.length}</p>
          </div>
          <div>
            <span className="text-blue-400">Started</span>
            <p className="text-blue-100 font-medium">
              {new Date(conversation.createdAt).toLocaleDateString()}
            </p>
          </div>
          <div>
            <span className="text-blue-400">Last Activity</span>
            <p className="text-blue-100 font-medium">
              {new Date(conversation.updatedAt).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>

      {/* Cost Projection */}
      <div className="bg-[#112240] rounded-lg p-4 border border-[#1e3a5f]">
        <h3 className="text-sm font-medium text-blue-300 mb-3">Cost Projections</h3>
        <p className="text-[10px] text-blue-400 mb-3">Based on current average usage</p>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-[#0d1f3c] rounded-lg p-2">
            <p className="text-sm font-bold text-blue-100">
              {formatCurrency(avgCostPerMsg * 10)}
            </p>
            <p className="text-[10px] text-blue-400">10 responses</p>
          </div>
          <div className="bg-[#0d1f3c] rounded-lg p-2">
            <p className="text-sm font-bold text-blue-100">
              {formatCurrency(avgCostPerMsg * 50)}
            </p>
            <p className="text-[10px] text-blue-400">50 responses</p>
          </div>
          <div className="bg-[#0d1f3c] rounded-lg p-2">
            <p className="text-sm font-bold text-blue-100">
              {formatCurrency(avgCostPerMsg * 100)}
            </p>
            <p className="text-[10px] text-blue-400">100 responses</p>
          </div>
        </div>
      </div>

      {/* Pricing Reference */}
      <div className="bg-[#0d1f3c] rounded-lg p-3 border border-[#1e3a5f]/50">
        <p className="text-[10px] text-blue-400 text-center">
          Pricing from{' '}
          <a
            href="https://www.anthropic.com/pricing"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sky-400 hover:text-sky-300 underline"
          >
            Anthropic API Pricing
          </a>
          {' '}- Updated Jan 2025
        </p>
      </div>
    </div>
  );
}
