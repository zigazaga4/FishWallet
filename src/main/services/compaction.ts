// Compaction Service - Summarizes conversation history for branch seeding
// Uses Claude Code Agent SDK for LLM calls

import { query } from '@anthropic-ai/claude-agent-sdk';
import { databaseService } from './database';
import { logger } from './logger';

// Character budget for conversation content (~4 chars per token, 170k token budget ≈ 680k chars)
const MAX_INPUT_CHARS = 680000;

const COMPACTION_SYSTEM_PROMPT = `You are a conversation summarizer. Your job is to create a comprehensive summary of a conversation between a user and an AI assistant about building an idea/product.

Your summary MUST capture:
1. **Key decisions made** — what the user decided about architecture, technology, design, naming, etc.
2. **Requirements gathered** — functional and non-functional requirements discussed
3. **Current state** — what has been built so far (files created, APIs integrated, features implemented)
4. **Architecture** — system design, data flow, component structure, API dependencies
5. **Open questions** — anything unresolved or explicitly deferred
6. **User preferences** — style preferences, priorities, constraints mentioned

Format the summary as structured sections with bullet points. Be thorough — this summary will be the ONLY context a new conversation branch receives. Nothing else from the original conversation carries over.

Write in a factual, neutral tone. Do not add opinions or suggestions.`;

/**
 * Compact a conversation into a summary string for branch seeding.
 *
 * 1. Load messages from the conversation
 * 2. Filter to user messages + assistant text output only (no tool calls, no thinking)
 * 3. Format as [User]/[Assistant] sections
 * 4. Truncate to char budget from the end
 * 5. Call LLM via Agent SDK to produce a structured summary
 */
export async function compactConversation(conversationId: string): Promise<string> {
  logger.info('[Compaction] Starting compaction', { conversationId });

  // 1. Load messages
  const messages = databaseService.getMessages(conversationId);
  if (messages.length === 0) {
    logger.warn('[Compaction] No messages found', { conversationId });
    return '(Empty conversation — no prior context)';
  }

  // 2. Filter and format messages
  const formattedParts: string[] = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      formattedParts.push(`[System]: ${msg.content}`);
    } else if (msg.role === 'user') {
      if (msg.contentBlocks) {
        try {
          const blocks = JSON.parse(msg.contentBlocks);
          const hasToolResults = Array.isArray(blocks) && blocks.every(
            (b: { type: string }) => b.type === 'tool_result'
          );
          if (hasToolResults) continue;
        } catch {
          // Parse failed, use content as-is
        }
      }
      if (msg.content.trim()) {
        formattedParts.push(`[User]: ${msg.content}`);
      }
    } else if (msg.role === 'assistant') {
      let textContent = '';

      if (msg.contentBlocks) {
        try {
          const blocks = JSON.parse(msg.contentBlocks);
          if (Array.isArray(blocks)) {
            const textParts = blocks
              .filter((b: { type: string }) => b.type === 'text')
              .map((b: { content?: string; text?: string }) => b.content || b.text || '')
              .filter((t: string) => t.trim());
            textContent = textParts.join('\n');
          }
        } catch {
          textContent = msg.content;
        }
      } else {
        textContent = msg.content;
      }

      if (textContent.trim()) {
        formattedParts.push(`[Assistant]: ${textContent}`);
      }
    }
  }

  if (formattedParts.length === 0) {
    logger.warn('[Compaction] No meaningful content after filtering', { conversationId });
    return '(Conversation had no meaningful text content)';
  }

  // 3. Truncate using char-based estimation — keep most recent parts
  let includedParts = [...formattedParts];
  let conversationText = includedParts.join('\n\n');

  while (conversationText.length > MAX_INPUT_CHARS && includedParts.length > 1) {
    includedParts = includedParts.slice(1);
    conversationText = '...(earlier conversation truncated)...\n\n' + includedParts.join('\n\n');
  }

  logger.info('[Compaction] Final conversation text', {
    messageCount: messages.length,
    includedParts: includedParts.length,
    totalParts: formattedParts.length,
    charCount: conversationText.length
  });

  // 4. Call LLM via Agent SDK to produce summary
  const promptText = `Here is the conversation to summarize:\n\n${conversationText}`;

  let summaryContent = '';

  const q = query({
    prompt: promptText,
    options: {
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: COMPACTION_SYSTEM_PROMPT
      },
      tools: [],
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true
    }
  });

  for await (const message of q) {
    if (message.type === 'assistant') {
      // Extract text content from the complete assistant message
      const assistantMsg = message as unknown as {
        type: 'assistant';
        message: { content: Array<{ type: string; text?: string }> };
      };
      if (assistantMsg.message?.content) {
        for (const block of assistantMsg.message.content) {
          if (block.type === 'text' && block.text) {
            summaryContent += block.text;
          }
        }
      }
    }
  }

  logger.info('[Compaction] Compaction complete', {
    conversationId,
    summaryLength: summaryContent.length
  });

  return summaryContent || '(Failed to generate summary)';
}
