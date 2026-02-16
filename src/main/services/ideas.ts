import { eq, desc, asc } from 'drizzle-orm';
import { getDatabase, schema } from '../db';
import { Idea, NewIdea, Note, NewNote, Conversation, Message } from '../db/schema';
import { randomUUID } from 'crypto';
import { rmSync } from 'fs';
import { join } from 'path';
import { databaseService } from './database';
import { dependencyNodesService } from './dependencyNodes';
import { scaffoldProject, installDependencies } from './projectScaffold';
import { logger } from './logger';

// Ideas service for idea and note operations
export class IdeasService {
  // Generate a unique ID
  private generateId(): string {
    return randomUUID();
  }

  // Get current timestamp
  private now(): Date {
    return new Date();
  }

  // IDEA OPERATIONS

  // Create a new idea (async to support project scaffolding)
  async createIdea(data: { title: string }): Promise<Idea> {
    const db = getDatabase();
    const now = this.now();

    const newIdea: NewIdea = {
      id: this.generateId(),
      title: data.title,
      createdAt: now,
      updatedAt: now,
      status: 'active'
    };

    db.insert(schema.ideas).values(newIdea).run();

    // Scaffold a Vite project for this idea
    const scaffoldResult = await scaffoldProject(data.title);
    if (scaffoldResult.success && scaffoldResult.projectPath) {
      db.update(schema.ideas)
        .set({ projectPath: scaffoldResult.projectPath })
        .where(eq(schema.ideas.id, newIdea.id))
        .run();

      // Fire npm install in background — runs in the main/ branch subfolder
      installDependencies(join(scaffoldResult.projectPath, 'main')).catch((err) => {
        logger.error('[Ideas] Background npm install failed', { error: err });
      });
    }

    return this.getIdea(newIdea.id)!;
  }

  // Get an idea by ID
  getIdea(id: string): Idea | null {
    const db = getDatabase();
    const result = db.select().from(schema.ideas).where(eq(schema.ideas.id, id)).get();
    return result || null;
  }

  // Get all ideas ordered by updated date
  getAllIdeas(): Idea[] {
    const db = getDatabase();
    return db.select().from(schema.ideas).orderBy(desc(schema.ideas.updatedAt)).all();
  }

  // Get ideas by status
  getIdeasByStatus(status: 'active' | 'completed' | 'archived'): Idea[] {
    const db = getDatabase();
    return db.select()
      .from(schema.ideas)
      .where(eq(schema.ideas.status, status))
      .orderBy(desc(schema.ideas.updatedAt))
      .all();
  }

  // Update an idea
  updateIdea(id: string, data: Partial<Pick<Idea, 'title' | 'status'>>): Idea {
    const db = getDatabase();

    db.update(schema.ideas)
      .set({
        ...data,
        updatedAt: this.now()
      })
      .where(eq(schema.ideas.id, id))
      .run();

    const updated = this.getIdea(id);
    if (!updated) {
      throw new Error(`Idea with id ${id} not found`);
    }
    return updated;
  }

  // Delete an idea (cascades to notes, removes project folder)
  deleteIdea(id: string): void {
    const db = getDatabase();
    const idea = this.getIdea(id);

    // Remove project folder from disk if it exists
    if (idea?.projectPath) {
      try {
        rmSync(idea.projectPath, { recursive: true, force: true });
        logger.info('[Ideas] Removed project folder', { projectPath: idea.projectPath });
      } catch (err) {
        logger.error('[Ideas] Failed to remove project folder', { error: err });
      }
    }

    db.delete(schema.ideas).where(eq(schema.ideas.id, id)).run();
  }

  // NOTE OPERATIONS

  // Add a note to an idea
  addNote(data: {
    ideaId: string;
    content: string;
    durationMs?: number;
  }): Note {
    const db = getDatabase();
    const now = this.now();

    const newNote: NewNote = {
      id: this.generateId(),
      ideaId: data.ideaId,
      content: data.content,
      durationMs: data.durationMs,
      createdAt: now
    };

    db.insert(schema.notes).values(newNote).run();

    // Update idea's updatedAt timestamp
    db.update(schema.ideas)
      .set({ updatedAt: now })
      .where(eq(schema.ideas.id, data.ideaId))
      .run();

    return this.getNote(newNote.id)!;
  }

  // Get a note by ID
  getNote(id: string): Note | null {
    const db = getDatabase();
    const result = db.select().from(schema.notes).where(eq(schema.notes.id, id)).get();
    return result || null;
  }

  // Get all notes for an idea ordered by creation date
  getNotes(ideaId: string): Note[] {
    const db = getDatabase();
    return db.select()
      .from(schema.notes)
      .where(eq(schema.notes.ideaId, ideaId))
      .orderBy(asc(schema.notes.createdAt))
      .all();
  }

  // Delete a note
  deleteNote(id: string): void {
    const db = getDatabase();
    db.delete(schema.notes).where(eq(schema.notes.id, id)).run();
  }

  // Get idea with notes
  getIdeaWithNotes(id: string): { idea: Idea; notes: Note[] } | null {
    const idea = this.getIdea(id);
    if (!idea) {
      return null;
    }

    const notes = this.getNotes(id);
    return { idea, notes };
  }

  // SYNTHESIS CONVERSATION OPERATIONS

  // Generate the system prompt for idea synthesis
  private generateSynthesisSystemPrompt(idea: Idea, notes: Note[]): string {
    const notesText = notes
      .map((note, index) => {
        const time = new Date(note.createdAt).toLocaleTimeString();
        return `[Note ${index + 1} - ${time}]\n${note.content}`;
      })
      .join('\n\n');

    return `You are a thoughtful assistant helping to synthesize and structure ideas. You are guided by wisdom and clarity.

The user has been capturing voice notes for an idea titled: "${idea.title}"

Here are all the notes they've recorded, in chronological order:

---
${notesText}
---

Your role is to:
1. Analyze all the notes and identify the core concept
2. Extract key themes, features, and requirements mentioned
3. Identify any decisions or preferences the user has expressed
4. Note any concerns, questions, or areas that need more thought
5. Help structure this into a coherent plan or concept document

Be conversational and helpful. The user may ask follow-up questions or want to explore specific aspects deeper. Always reference their original notes when relevant.

Start by providing a comprehensive synthesis of their idea, then be ready to discuss and refine it further.`;
  }

  // Create or get the synthesis conversation for an idea
  createSynthesisConversation(ideaId: string): { conversation: Conversation; isNew: boolean } {
    const db = getDatabase();
    const idea = this.getIdea(ideaId);

    if (!idea) {
      throw new Error(`Idea with id ${ideaId} not found`);
    }

    // If conversation already exists, return it
    if (idea.conversationId) {
      const existingConversation = databaseService.getConversation(idea.conversationId);
      if (existingConversation) {
        return { conversation: existingConversation, isNew: false };
      }
    }

    // Get notes for the system prompt
    const notes = this.getNotes(ideaId);
    const systemPrompt = this.generateSynthesisSystemPrompt(idea, notes);

    // Create new conversation
    const conversation = databaseService.createConversation({
      title: `Synthesis: ${idea.title}`,
      systemPrompt: systemPrompt
    });

    // Link conversation to idea
    db.update(schema.ideas)
      .set({
        conversationId: conversation.id,
        updatedAt: this.now()
      })
      .where(eq(schema.ideas.id, ideaId))
      .run();

    return { conversation, isNew: true };
  }

  // Get the synthesis conversation for an idea
  getSynthesisConversation(ideaId: string): { conversation: Conversation; messages: Message[] } | null {
    const idea = this.getIdea(ideaId);

    if (!idea || !idea.conversationId) {
      return null;
    }

    return databaseService.getConversationWithMessages(idea.conversationId);
  }

  // Check if idea has a synthesis conversation
  hasSynthesisConversation(ideaId: string): boolean {
    const idea = this.getIdea(ideaId);
    return idea !== null && idea.conversationId !== null;
  }

  // Delete the synthesis conversation for an idea
  deleteSynthesisConversation(ideaId: string): void {
    const db = getDatabase();
    const idea = this.getIdea(ideaId);

    if (!idea || !idea.conversationId) {
      throw new Error(`Idea ${ideaId} has no synthesis conversation to delete`);
    }

    // Delete the conversation (messages cascade, idea.conversationId set to null by ON DELETE SET NULL)
    db.delete(schema.conversations)
      .where(eq(schema.conversations.id, idea.conversationId))
      .run();

    // Clear the synthesis content
    db.update(schema.ideas)
      .set({
        synthesisContent: null,
        synthesisVersion: 0,
        synthesisUpdatedAt: null
      })
      .where(eq(schema.ideas.id, ideaId))
      .run();

    // Also delete all API nodes for this idea
    dependencyNodesService.deleteAllNodesForIdea(ideaId);
  }

  // SYNTHESIS CONTENT OPERATIONS

  // Update the synthesis content for an idea
  updateSynthesis(ideaId: string, content: string): void {
    const db = getDatabase();
    const idea = this.getIdea(ideaId);

    if (!idea) {
      throw new Error(`Idea ${ideaId} not found`);
    }

    const currentVersion = idea.synthesisVersion ?? 0;

    db.update(schema.ideas)
      .set({
        synthesisContent: content,
        synthesisVersion: currentVersion + 1,
        synthesisUpdatedAt: this.now(),
        updatedAt: this.now()
      })
      .where(eq(schema.ideas.id, ideaId))
      .run();
  }

  // Get the synthesis content for an idea
  getSynthesisContent(ideaId: string): { content: string | null; version: number } {
    const idea = this.getIdea(ideaId);

    if (!idea) {
      throw new Error(`Idea ${ideaId} not found`);
    }

    return {
      content: idea.synthesisContent ?? null,
      version: idea.synthesisVersion ?? 0
    };
  }

  // Get full idea data including notes and conversation
  getIdeaFull(id: string): {
    idea: Idea;
    notes: Note[];
    conversation: Conversation | null;
    messages: Message[];
  } | null {
    const idea = this.getIdea(id);
    if (!idea) {
      return null;
    }

    const notes = this.getNotes(id);

    let conversation: Conversation | null = null;
    let messages: Message[] = [];

    if (idea.conversationId) {
      const convData = databaseService.getConversationWithMessages(idea.conversationId);
      if (convData) {
        conversation = convData.conversation;
        messages = convData.messages;
      }
    }

    return { idea, notes, conversation, messages };
  }
}

// Singleton instance
export const ideasService = new IdeasService();
