import { drizzle, BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import Database from 'better-sqlite3';
import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import * as schema from './schema';

// Database instance
let db: BetterSQLite3Database<typeof schema> | null = null;
let sqlite: Database.Database | null = null;

// Get the path to the database file
function getDatabasePath(): string {
  const userDataPath = app.getPath('userData');
  const dbDir = join(userDataPath, 'data');

  // Ensure the directory exists
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }

  return join(dbDir, 'fishwallet.db');
}

// Initialize the database connection
export function initializeDatabase(): BetterSQLite3Database<typeof schema> {
  if (db) {
    return db;
  }

  const dbPath = getDatabasePath();
  console.log(`Initializing database at: ${dbPath}`);

  sqlite = new Database(dbPath);

  // Enable foreign keys
  sqlite.pragma('foreign_keys = ON');

  // Enable WAL mode for better concurrent access
  sqlite.pragma('journal_mode = WAL');

  // Create the Drizzle instance with schema
  db = drizzle(sqlite, { schema });

  // Create tables if they don't exist
  createTables();

  return db;
}

// Create database tables
function createTables(): void {
  if (!sqlite) {
    throw new Error('SQLite database not initialized');
  }

  // Create conversations table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      system_prompt TEXT,
      model TEXT NOT NULL DEFAULT 'claude-sonnet-4-5-20250929',
      total_input_tokens INTEGER NOT NULL DEFAULT 0,
      total_output_tokens INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Create messages table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    )
  `);

  // Create indexes for better query performance
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
  `);

  // Create ideas table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS ideas (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
      conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL
    )
  `);

  // Migration: Add conversation_id column if it doesn't exist
  try {
    sqlite.exec(`ALTER TABLE ideas ADD COLUMN conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add synthesis columns if they don't exist
  try {
    sqlite.exec(`ALTER TABLE ideas ADD COLUMN synthesis_content TEXT`);
  } catch {
    // Column already exists, ignore error
  }
  try {
    sqlite.exec(`ALTER TABLE ideas ADD COLUMN synthesis_version INTEGER DEFAULT 0`);
  } catch {
    // Column already exists, ignore error
  }
  try {
    sqlite.exec(`ALTER TABLE ideas ADD COLUMN synthesis_updated_at INTEGER`);
  } catch {
    // Column already exists, ignore error
  }

  // Migration: Add thinking and content_blocks columns to messages table
  try {
    sqlite.exec(`ALTER TABLE messages ADD COLUMN thinking TEXT`);
  } catch {
    // Column already exists, ignore error
  }
  try {
    sqlite.exec(`ALTER TABLE messages ADD COLUMN content_blocks TEXT`);
  } catch {
    // Column already exists, ignore error
  }

  // Create notes table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL,
      content TEXT NOT NULL,
      duration_ms INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE
    )
  `);

  // Create indexes for ideas and notes
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_ideas_updated_at ON ideas(updated_at);
    CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
    CREATE INDEX IF NOT EXISTS idx_notes_idea_id ON notes(idea_id);
    CREATE INDEX IF NOT EXISTS idx_notes_created_at ON notes(created_at);
  `);

  // Create project_files table for AI app builder
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS project_files (
      id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      content TEXT NOT NULL,
      file_type TEXT NOT NULL CHECK (file_type IN ('tsx', 'ts', 'css')),
      is_entry_file INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE,
      UNIQUE(idea_id, file_path)
    )
  `);

  // Create indexes for project_files
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_project_files_idea_id ON project_files(idea_id);
    CREATE INDEX IF NOT EXISTS idx_project_files_entry ON project_files(idea_id, is_entry_file);
  `);

  // Create api_nodes table for visual API planning
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS api_nodes (
      id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL,
      name TEXT NOT NULL,
      api_provider TEXT NOT NULL,
      description TEXT NOT NULL,
      pricing TEXT,
      position_x INTEGER NOT NULL DEFAULT 0,
      position_y INTEGER NOT NULL DEFAULT 0,
      color TEXT DEFAULT '#3b82f6',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE
    )
  `);

  // Create api_node_connections table for flow connections
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS api_node_connections (
      id TEXT PRIMARY KEY,
      idea_id TEXT NOT NULL,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      label TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE,
      FOREIGN KEY (from_node_id) REFERENCES api_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (to_node_id) REFERENCES api_nodes(id) ON DELETE CASCADE
    )
  `);

  // Create indexes for api_nodes and connections
  sqlite.exec(`
    CREATE INDEX IF NOT EXISTS idx_api_nodes_idea_id ON api_nodes(idea_id);
    CREATE INDEX IF NOT EXISTS idx_api_node_connections_idea_id ON api_node_connections(idea_id);
    CREATE INDEX IF NOT EXISTS idx_api_node_connections_from ON api_node_connections(from_node_id);
    CREATE INDEX IF NOT EXISTS idx_api_node_connections_to ON api_node_connections(to_node_id);
  `);
}

// Get the database instance
export function getDatabase(): BetterSQLite3Database<typeof schema> {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

// Close the database connection
export function closeDatabase(): void {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    db = null;
  }
}

// Export schema for use in queries
export { schema };
