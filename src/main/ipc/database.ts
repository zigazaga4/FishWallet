import { ipcMain } from 'electron';
import { databaseService } from '../services/database';
import { Conversation, Message } from '../db/schema';

// IPC channel names for database operations
export const DB_CHANNELS = {
  // Conversation operations
  CREATE_CONVERSATION: 'db:create-conversation',
  GET_CONVERSATION: 'db:get-conversation',
  GET_ALL_CONVERSATIONS: 'db:get-all-conversations',
  UPDATE_CONVERSATION: 'db:update-conversation',
  DELETE_CONVERSATION: 'db:delete-conversation',
  GET_CONVERSATION_WITH_MESSAGES: 'db:get-conversation-with-messages',

  // Message operations
  ADD_MESSAGE: 'db:add-message',
  GET_MESSAGES: 'db:get-messages',
  DELETE_MESSAGE: 'db:delete-message',
  UPDATE_MESSAGE_CONTENT_BLOCKS: 'db:update-message-content-blocks'
} as const;

// Register all database-related IPC handlers
export function registerDatabaseHandlers(): void {
  // CONVERSATION HANDLERS

  // Create a new conversation
  ipcMain.handle(
    DB_CHANNELS.CREATE_CONVERSATION,
    (_event, data: { title: string; systemPrompt?: string; model?: string }): Conversation => {
      return databaseService.createConversation(data);
    }
  );

  // Get a conversation by ID
  ipcMain.handle(
    DB_CHANNELS.GET_CONVERSATION,
    (_event, id: string): Conversation | null => {
      return databaseService.getConversation(id);
    }
  );

  // Get all conversations
  ipcMain.handle(
    DB_CHANNELS.GET_ALL_CONVERSATIONS,
    (): Conversation[] => {
      return databaseService.getAllConversations();
    }
  );

  // Update a conversation
  ipcMain.handle(
    DB_CHANNELS.UPDATE_CONVERSATION,
    (_event, id: string, data: Partial<Pick<Conversation, 'title' | 'systemPrompt' | 'model'>>): Conversation => {
      return databaseService.updateConversation(id, data);
    }
  );

  // Delete a conversation
  ipcMain.handle(
    DB_CHANNELS.DELETE_CONVERSATION,
    (_event, id: string): void => {
      databaseService.deleteConversation(id);
    }
  );

  // Get conversation with messages
  ipcMain.handle(
    DB_CHANNELS.GET_CONVERSATION_WITH_MESSAGES,
    (_event, id: string): { conversation: Conversation; messages: Message[] } | null => {
      return databaseService.getConversationWithMessages(id);
    }
  );

  // MESSAGE HANDLERS

  // Add a message to a conversation
  ipcMain.handle(
    DB_CHANNELS.ADD_MESSAGE,
    (_event, data: {
      conversationId: string;
      role: 'user' | 'assistant' | 'system';
      content: string;
      inputTokens?: number;
      outputTokens?: number;
      thinking?: string;
      contentBlocks?: unknown[];
    }): Message => {
      return databaseService.addMessage(data);
    }
  );

  // Get all messages for a conversation
  ipcMain.handle(
    DB_CHANNELS.GET_MESSAGES,
    (_event, conversationId: string): Message[] => {
      return databaseService.getMessages(conversationId);
    }
  );

  // Delete a message
  ipcMain.handle(
    DB_CHANNELS.DELETE_MESSAGE,
    (_event, id: string): void => {
      databaseService.deleteMessage(id);
    }
  );

  // Update contentBlocks for a message (after tool results arrive)
  ipcMain.handle(
    DB_CHANNELS.UPDATE_MESSAGE_CONTENT_BLOCKS,
    (_event, id: string, contentBlocks: unknown[]): void => {
      databaseService.updateMessageContentBlocks(id, contentBlocks);
    }
  );
}
