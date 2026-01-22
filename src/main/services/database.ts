import { eq, desc, asc } from 'drizzle-orm';
import { getDatabase, schema } from '../db';
import { Conversation, NewConversation, Message, NewMessage } from '../db/schema';
import { randomUUID } from 'crypto';

// Database service for conversation and message operations
export class DatabaseService {
  // Generate a unique ID
  private generateId(): string {
    return randomUUID();
  }

  // Get current timestamp
  private now(): Date {
    return new Date();
  }

  // CONVERSATION OPERATIONS

  // Create a new conversation
  createConversation(data: { title: string; systemPrompt?: string; model?: string }): Conversation {
    const db = getDatabase();
    const now = this.now();

    const newConversation: NewConversation = {
      id: this.generateId(),
      title: data.title,
      systemPrompt: data.systemPrompt,
      model: data.model || 'claude-sonnet-4-5-20250929',
      createdAt: now,
      updatedAt: now,
      totalInputTokens: 0,
      totalOutputTokens: 0
    };

    db.insert(schema.conversations).values(newConversation).run();

    return this.getConversation(newConversation.id)!;
  }

  // Get a conversation by ID
  getConversation(id: string): Conversation | null {
    const db = getDatabase();
    const result = db.select().from(schema.conversations).where(eq(schema.conversations.id, id)).get();
    return result || null;
  }

  // Get all conversations ordered by updated date
  getAllConversations(): Conversation[] {
    const db = getDatabase();
    return db.select().from(schema.conversations).orderBy(desc(schema.conversations.updatedAt)).all();
  }

  // Update a conversation
  updateConversation(id: string, data: Partial<Pick<Conversation, 'title' | 'systemPrompt' | 'model'>>): Conversation {
    const db = getDatabase();

    db.update(schema.conversations)
      .set({
        ...data,
        updatedAt: this.now()
      })
      .where(eq(schema.conversations.id, id))
      .run();

    const updated = this.getConversation(id);
    if (!updated) {
      throw new Error(`Conversation with id ${id} not found`);
    }
    return updated;
  }

  // Delete a conversation (cascades to messages)
  deleteConversation(id: string): void {
    const db = getDatabase();
    db.delete(schema.conversations).where(eq(schema.conversations.id, id)).run();
  }

  // Update conversation token counts
  updateConversationTokens(id: string, inputTokens: number, outputTokens: number): void {
    const db = getDatabase();
    const conversation = this.getConversation(id);

    if (!conversation) {
      throw new Error(`Conversation with id ${id} not found`);
    }

    db.update(schema.conversations)
      .set({
        totalInputTokens: conversation.totalInputTokens + inputTokens,
        totalOutputTokens: conversation.totalOutputTokens + outputTokens,
        updatedAt: this.now()
      })
      .where(eq(schema.conversations.id, id))
      .run();
  }

  // MESSAGE OPERATIONS

  // Add a message to a conversation
  addMessage(data: {
    conversationId: string;
    role: 'user' | 'assistant' | 'system';
    content: string;
    inputTokens?: number;
    outputTokens?: number;
    thinking?: string;
    contentBlocks?: unknown[];
  }): Message {
    const db = getDatabase();
    const now = this.now();

    const newMessage: NewMessage = {
      id: this.generateId(),
      conversationId: data.conversationId,
      role: data.role,
      content: data.content,
      createdAt: now,
      inputTokens: data.inputTokens,
      outputTokens: data.outputTokens,
      thinking: data.thinking,
      contentBlocks: data.contentBlocks ? JSON.stringify(data.contentBlocks) : undefined
    };

    db.insert(schema.messages).values(newMessage).run();

    // Update conversation's updatedAt timestamp
    db.update(schema.conversations)
      .set({ updatedAt: now })
      .where(eq(schema.conversations.id, data.conversationId))
      .run();

    // Update token counts if provided
    if (data.inputTokens || data.outputTokens) {
      this.updateConversationTokens(
        data.conversationId,
        data.inputTokens || 0,
        data.outputTokens || 0
      );
    }

    return this.getMessage(newMessage.id)!;
  }

  // Get a message by ID
  getMessage(id: string): Message | null {
    const db = getDatabase();
    const result = db.select().from(schema.messages).where(eq(schema.messages.id, id)).get();
    return result || null;
  }

  // Get all messages for a conversation ordered by creation date
  getMessages(conversationId: string): Message[] {
    const db = getDatabase();
    return db.select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(asc(schema.messages.createdAt))
      .all();
  }

  // Delete a message
  deleteMessage(id: string): void {
    const db = getDatabase();
    db.delete(schema.messages).where(eq(schema.messages.id, id)).run();
  }

  // Get conversation with messages
  getConversationWithMessages(id: string): { conversation: Conversation; messages: Message[] } | null {
    const conversation = this.getConversation(id);
    if (!conversation) {
      return null;
    }

    const messages = this.getMessages(id);
    return { conversation, messages };
  }
}

// Singleton instance
export const databaseService = new DatabaseService();
