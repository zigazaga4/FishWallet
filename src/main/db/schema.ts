import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// Conversations table - stores conversation metadata
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  // System prompt for this conversation
  systemPrompt: text('system_prompt'),
  // Model configuration
  model: text('model').notNull().default('claude-opus-4-5-20251101'),
  // Token usage tracking
  totalInputTokens: integer('total_input_tokens').notNull().default(0),
  totalOutputTokens: integer('total_output_tokens').notNull().default(0),
  // Claude Code session ID for context resumption
  claudeSessionId: text('claude_session_id')
});

// Messages table - stores individual messages in conversations
export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  // Token usage for this message
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  // Extended thinking content from Claude
  thinking: text('thinking'),
  // Content blocks (tool calls, etc.) stored as JSON
  contentBlocks: text('content_blocks')
});

// Define relations between tables
export const conversationsRelations = relations(conversations, ({ many }) => ({
  messages: many(messages)
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id]
  })
}));

// Ideas table - stores idea sessions created by voice
export const ideas = sqliteTable('ideas', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
  // Status of the idea
  status: text('status', { enum: ['active', 'completed', 'archived'] }).notNull().default('active'),
  // Link to synthesis conversation (optional - created when user starts synthesis)
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  // The main synthesized idea content - stored with line numbers for AI modification
  synthesisContent: text('synthesis_content'),
  // Version number for tracking synthesis changes
  synthesisVersion: integer('synthesis_version').default(0),
  // When the synthesis was last updated
  synthesisUpdatedAt: integer('synthesis_updated_at', { mode: 'timestamp' }),
  // Path to the Vite project folder on disk
  projectPath: text('project_path')
});

// Notes table - stores voice notes within an idea
export const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  ideaId: text('idea_id').notNull().references(() => ideas.id, { onDelete: 'cascade' }),
  // Transcribed text from voice
  content: text('content').notNull(),
  // Duration of the audio in milliseconds
  durationMs: integer('duration_ms'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

// Project files table - stores files created by AI app builder
export const projectFiles = sqliteTable('project_files', {
  id: text('id').primaryKey(),
  ideaId: text('idea_id').notNull().references(() => ideas.id, { onDelete: 'cascade' }),
  // File path relative to project root (e.g., "App.tsx", "components/Button.tsx")
  filePath: text('file_path').notNull(),
  // File content
  content: text('content').notNull(),
  // File type: tsx, ts, or css
  fileType: text('file_type', { enum: ['tsx', 'ts', 'css'] }).notNull(),
  // Whether this is the entry file to render in live preview
  isEntryFile: integer('is_entry_file', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

// Define relations for ideas and notes
export const ideasRelations = relations(ideas, ({ many, one }) => ({
  notes: many(notes),
  projectFiles: many(projectFiles),
  apiNodes: many(apiNodes),
  apiNodeConnections: many(apiNodeConnections),
  snapshots: many(ideaSnapshots),
  branches: many(conversationBranches),
  conversation: one(conversations, {
    fields: [ideas.conversationId],
    references: [conversations.id]
  })
}));

export const notesRelations = relations(notes, ({ one }) => ({
  idea: one(ideas, {
    fields: [notes.ideaId],
    references: [ideas.id]
  })
}));

// Define relations for project files
export const projectFilesRelations = relations(projectFiles, ({ one }) => ({
  idea: one(ideas, {
    fields: [projectFiles.ideaId],
    references: [ideas.id]
  })
}));

// API Nodes table - stores visual API nodes for idea planning
export const apiNodes = sqliteTable('api_nodes', {
  id: text('id').primaryKey(),
  ideaId: text('idea_id').notNull().references(() => ideas.id, { onDelete: 'cascade' }),
  // Node display name (e.g., "OpenAI GPT-4", "Stripe Payments")
  name: text('name').notNull(),
  // API provider/service name
  apiProvider: text('api_provider').notNull(),
  // Brief description of what this API does
  description: text('description').notNull(),
  // Pricing information as structured JSON
  pricing: text('pricing'),
  // Position on canvas (x, y coordinates)
  positionX: integer('position_x').notNull().default(0),
  positionY: integer('position_y').notNull().default(0),
  // Visual customization
  color: text('color').default('#3b82f6'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull()
});

// API Node Connections table - stores flow connections between nodes
export const apiNodeConnections = sqliteTable('api_node_connections', {
  id: text('id').primaryKey(),
  ideaId: text('idea_id').notNull().references(() => ideas.id, { onDelete: 'cascade' }),
  // Source node
  fromNodeId: text('from_node_id').notNull().references(() => apiNodes.id, { onDelete: 'cascade' }),
  // Target node
  toNodeId: text('to_node_id').notNull().references(() => apiNodes.id, { onDelete: 'cascade' }),
  // Connection label (e.g., "sends data", "triggers")
  label: text('label'),
  // Technical integration details (JSON) - how they connect, data flow, SDKs, protocol
  details: text('details'),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

// Define relations for API nodes
export const apiNodesRelations = relations(apiNodes, ({ one, many }) => ({
  idea: one(ideas, {
    fields: [apiNodes.ideaId],
    references: [ideas.id]
  }),
  outgoingConnections: many(apiNodeConnections, { relationName: 'fromNode' }),
  incomingConnections: many(apiNodeConnections, { relationName: 'toNode' })
}));

// Define relations for API node connections
export const apiNodeConnectionsRelations = relations(apiNodeConnections, ({ one }) => ({
  idea: one(ideas, {
    fields: [apiNodeConnections.ideaId],
    references: [ideas.id]
  }),
  fromNode: one(apiNodes, {
    fields: [apiNodeConnections.fromNodeId],
    references: [apiNodes.id],
    relationName: 'fromNode'
  }),
  toNode: one(apiNodes, {
    fields: [apiNodeConnections.toNodeId],
    references: [apiNodes.id],
    relationName: 'toNode'
  })
}));

// Idea snapshots table - stores versioned snapshots of idea state
export const ideaSnapshots = sqliteTable('idea_snapshots', {
  id: text('id').primaryKey(),
  ideaId: text('idea_id').notNull().references(() => ideas.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  // Snapshot data
  synthesisContent: text('synthesis_content'),
  filesSnapshot: text('files_snapshot').notNull(),           // JSON array
  nodesSnapshot: text('nodes_snapshot').notNull(),            // JSON array
  connectionsSnapshot: text('connections_snapshot').notNull(), // JSON array
  // Metadata
  toolsUsed: text('tools_used'),                              // JSON array of tool names
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull()
});

// Define relations for idea snapshots
export const ideaSnapshotsRelations = relations(ideaSnapshots, ({ one }) => ({
  idea: one(ideas, {
    fields: [ideaSnapshots.ideaId],
    references: [ideas.id]
  })
}));

// Conversation branches table - git-like tree structure for idea conversations
export const conversationBranches = sqliteTable('conversation_branches', {
  id: text('id').primaryKey(),
  ideaId: text('idea_id').notNull().references(() => ideas.id, { onDelete: 'cascade' }),
  parentBranchId: text('parent_branch_id'),  // null = root branch
  conversationId: text('conversation_id').references(() => conversations.id, { onDelete: 'set null' }),
  label: text('label').notNull().default('Branch'),
  depth: integer('depth').notNull().default(0),
  // Folder name within the idea's project directory (e.g. 'main', 'feature-auth')
  folderName: text('folder_name'),
  // Branch state snapshot (same format as ideaSnapshots)
  synthesisContent: text('synthesis_content'),
  filesSnapshot: text('files_snapshot').notNull().default('[]'),
  nodesSnapshot: text('nodes_snapshot').notNull().default('[]'),
  connectionsSnapshot: text('connections_snapshot').notNull().default('[]'),
  // Compaction cache — avoids re-compacting when creating multiple children
  compactionCache: text('compaction_cache'),
  compactionMessageCount: integer('compaction_message_count'),
  // Active flag - exactly one branch per idea is active at a time
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

// Define relations for conversation branches
export const conversationBranchesRelations = relations(conversationBranches, ({ one, many }) => ({
  idea: one(ideas, {
    fields: [conversationBranches.ideaId],
    references: [ideas.id]
  }),
  parent: one(conversationBranches, {
    fields: [conversationBranches.parentBranchId],
    references: [conversationBranches.id],
    relationName: 'parentBranch'
  }),
  children: many(conversationBranches, { relationName: 'parentBranch' }),
  conversation: one(conversations, {
    fields: [conversationBranches.conversationId],
    references: [conversations.id]
  })
}));

// Type exports for use in services
export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type Idea = typeof ideas.$inferSelect;
export type NewIdea = typeof ideas.$inferInsert;
export type Note = typeof notes.$inferSelect;
export type NewNote = typeof notes.$inferInsert;
export type ProjectFile = typeof projectFiles.$inferSelect;
export type NewProjectFile = typeof projectFiles.$inferInsert;
export type ApiNode = typeof apiNodes.$inferSelect;
export type NewApiNode = typeof apiNodes.$inferInsert;
export type ApiNodeConnection = typeof apiNodeConnections.$inferSelect;
export type NewApiNodeConnection = typeof apiNodeConnections.$inferInsert;
export type IdeaSnapshot = typeof ideaSnapshots.$inferSelect;
export type NewIdeaSnapshot = typeof ideaSnapshots.$inferInsert;
export type ConversationBranch = typeof conversationBranches.$inferSelect;
export type NewConversationBranch = typeof conversationBranches.$inferInsert;
