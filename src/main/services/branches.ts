// Branches Service - Git-like conversation tree branching
// Each branch gets its own folder on disk inside the idea's project directory

import { eq, and, isNull } from 'drizzle-orm';
import { getDatabase, schema } from '../db';
import { ConversationBranch } from '../db/schema';
import { ideasService } from './ideas';
import { dependencyNodesService } from './dependencyNodes';
import { databaseService } from './database';
import { sanitizeFolderName } from './projectScaffold';
import { compactConversation } from './compaction';
import { logger } from './logger';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { cpSync, rmSync, existsSync } from 'fs';

class BranchesService {
  private generateId(): string {
    return randomUUID();
  }

  // Resolve the full disk path for a branch's project folder
  getBranchFolderPath(ideaId: string, branchId: string): string | null {
    const idea = ideasService.getIdea(ideaId);
    if (!idea?.projectPath) return null;

    const branch = this.getBranch(branchId);
    if (!branch?.folderName) return null;

    return join(idea.projectPath, branch.folderName);
  }

  // Get the active branch's full folder path for an idea
  getActiveBranchFolderPath(ideaId: string): string | null {
    const idea = ideasService.getIdea(ideaId);
    if (!idea?.projectPath) return null;

    const activeBranch = this.getActiveBranch(ideaId);
    if (!activeBranch?.folderName) {
      // Fallback: if no branch exists yet, use 'main'
      return join(idea.projectPath, 'main');
    }

    return join(idea.projectPath, activeBranch.folderName);
  }

  // Get all branches for an idea (for tree rendering)
  getBranches(ideaId: string): ConversationBranch[] {
    const db = getDatabase();
    return db.select().from(schema.conversationBranches)
      .where(eq(schema.conversationBranches.ideaId, ideaId))
      .all();
  }

  // Get a single branch by ID
  getBranch(branchId: string): ConversationBranch | null {
    const db = getDatabase();
    return db.select().from(schema.conversationBranches)
      .where(eq(schema.conversationBranches.id, branchId))
      .get() ?? null;
  }

  // Get the currently active branch for an idea
  getActiveBranch(ideaId: string): ConversationBranch | null {
    const db = getDatabase();
    return db.select().from(schema.conversationBranches)
      .where(and(
        eq(schema.conversationBranches.ideaId, ideaId),
        eq(schema.conversationBranches.isActive, true)
      ))
      .get() ?? null;
  }

  // Ensure a root branch exists for an idea (lazy init)
  ensureRootBranch(ideaId: string): ConversationBranch {
    const db = getDatabase();

    // Check if root already exists
    const existingRoot = db.select().from(schema.conversationBranches)
      .where(and(
        eq(schema.conversationBranches.ideaId, ideaId),
        isNull(schema.conversationBranches.parentBranchId)
      ))
      .get();

    if (existingRoot) return existingRoot;

    // Create root branch from current idea state
    const idea = ideasService.getIdea(ideaId);
    if (!idea) throw new Error(`Idea ${ideaId} not found`);

    const now = new Date();
    const rootId = this.generateId();

    db.insert(schema.conversationBranches).values({
      id: rootId,
      ideaId,
      parentBranchId: null,
      conversationId: idea.conversationId,
      label: 'Main',
      depth: 0,
      folderName: 'main',
      synthesisContent: null,  // live state is in the idea table
      filesSnapshot: '[]',     // files live on disk
      nodesSnapshot: '[]',
      connectionsSnapshot: '[]',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }).run();

    logger.info('[Branches] Created root branch', { ideaId, rootId, folderName: 'main' });

    return this.getBranch(rootId)!;
  }

  // Save current live state (synthesis + nodes) into a branch record's snapshot fields
  // Files are NOT saved — each branch has its own folder on disk
  saveLiveStateToBranch(branchId: string): void {
    const db = getDatabase();
    const branch = this.getBranch(branchId);
    if (!branch) throw new Error(`Branch ${branchId} not found`);

    const idea = ideasService.getIdea(branch.ideaId);
    if (!idea) throw new Error(`Idea ${branch.ideaId} not found`);

    const { nodes, connections } = dependencyNodesService.getFullState(branch.ideaId);

    const nodesData = nodes.map(n => ({
      id: n.id,
      name: n.name,
      provider: n.provider,
      description: n.description,
      pricing: n.pricing,
      positionX: n.positionX,
      positionY: n.positionY,
      color: n.color
    }));

    const connectionsData = connections.map(c => ({
      id: c.id,
      fromNodeId: c.fromNodeId,
      toNodeId: c.toNodeId,
      label: c.label,
      details: c.details
    }));

    db.update(schema.conversationBranches)
      .set({
        synthesisContent: idea.synthesisContent ?? null,
        nodesSnapshot: JSON.stringify(nodesData),
        connectionsSnapshot: JSON.stringify(connectionsData),
        updatedAt: new Date()
      })
      .where(eq(schema.conversationBranches.id, branchId))
      .run();

    logger.info('[Branches] Saved live state to branch', {
      branchId,
      nodesCount: nodesData.length
    });
  }

  // Restore a branch's stored snapshot into live tables (synthesis + nodes only)
  // Files are already on disk in the branch's folder — no file restore needed
  restoreBranchState(branchId: string): void {
    const db = getDatabase();
    const branch = this.getBranch(branchId);
    if (!branch) throw new Error(`Branch ${branchId} not found`);

    const ideaId = branch.ideaId;

    // 1. Restore synthesis + conversation link
    db.update(schema.ideas)
      .set({
        synthesisContent: branch.synthesisContent,
        synthesisUpdatedAt: new Date(),
        updatedAt: new Date(),
        conversationId: branch.conversationId
      })
      .where(eq(schema.ideas.id, ideaId))
      .run();

    // 2. Restore nodes and connections
    dependencyNodesService.deleteAllNodesForIdea(ideaId);
    const nodesData = JSON.parse(branch.nodesSnapshot) as Array<{
      id: string; name: string; provider: string; description: string;
      pricing: string | null; positionX: number; positionY: number; color: string | null;
    }>;
    const connectionsData = JSON.parse(branch.connectionsSnapshot) as Array<{
      id: string; fromNodeId: string; toNodeId: string;
      label: string | null; details: string | null;
    }>;

    for (const node of nodesData) {
      const now = new Date();
      db.insert(schema.apiNodes).values({
        id: node.id,
        ideaId,
        name: node.name,
        apiProvider: node.provider,
        description: node.description,
        pricing: node.pricing,
        positionX: node.positionX,
        positionY: node.positionY,
        color: node.color,
        createdAt: now,
        updatedAt: now
      }).run();
    }

    for (const conn of connectionsData) {
      db.insert(schema.apiNodeConnections).values({
        id: conn.id,
        ideaId,
        fromNodeId: conn.fromNodeId,
        toNodeId: conn.toNodeId,
        label: conn.label,
        details: conn.details,
        createdAt: new Date()
      }).run();
    }

    logger.info('[Branches] Restored branch state to live tables', {
      branchId,
      ideaId,
      nodesRestored: nodesData.length,
      connectionsRestored: connectionsData.length
    });
  }

  // Switch to a different branch
  // Each branch has its own folder on disk — switching only saves/restores synthesis + nodes
  switchToBranch(branchId: string): void {
    const db = getDatabase();
    const targetBranch = this.getBranch(branchId);
    if (!targetBranch) throw new Error(`Branch ${branchId} not found`);

    const currentActive = this.getActiveBranch(targetBranch.ideaId);
    if (currentActive?.id === branchId) return; // already active

    // Save current live state (synthesis + nodes) to the currently active branch
    if (currentActive) {
      this.saveLiveStateToBranch(currentActive.id);
      db.update(schema.conversationBranches)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(schema.conversationBranches.id, currentActive.id))
        .run();
    }

    // Restore target branch state (synthesis + nodes) to live tables
    this.restoreBranchState(branchId);

    // Mark target as active
    db.update(schema.conversationBranches)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(schema.conversationBranches.id, branchId))
      .run();

    logger.info('[Branches] Switched to branch', {
      from: currentActive?.id,
      to: branchId,
      ideaId: targetBranch.ideaId,
      folderName: targetBranch.folderName
    });
  }

  // Generate a unique folder name for a new branch within the idea's project directory
  private generateBranchFolderName(ideaProjectPath: string, label: string): string {
    const baseName = sanitizeFolderName(label);
    let candidate = baseName;
    let counter = 2;

    while (existsSync(join(ideaProjectPath, candidate))) {
      candidate = `${baseName}-${counter}`;
      counter++;
    }

    return candidate;
  }

  // Create a child branch from a parent
  // Copies the parent's disk folder to a new sibling folder
  async createChildBranch(parentBranchId: string, label?: string): Promise<ConversationBranch> {
    const db = getDatabase();
    const parent = this.getBranch(parentBranchId);
    if (!parent) throw new Error(`Parent branch ${parentBranchId} not found`);

    const ideaId = parent.ideaId;
    const idea = ideasService.getIdea(ideaId);
    if (!idea) throw new Error(`Idea ${ideaId} not found`);
    if (!idea.projectPath) throw new Error(`Idea ${ideaId} has no project path`);

    // 1. Save current active branch state (synthesis + nodes)
    const currentActive = this.getActiveBranch(ideaId);
    if (currentActive) {
      this.saveLiveStateToBranch(currentActive.id);
    }

    // 2. Determine parent folder path
    const parentFolderName = parent.folderName || 'main';
    const parentFolderPath = join(idea.projectPath, parentFolderName);

    // 3. Generate child folder name and copy parent folder
    const childLabel = label || `Branch ${this.countChildren(parentBranchId) + 1}`;
    const childFolderName = this.generateBranchFolderName(idea.projectPath, childLabel);
    const childFolderPath = join(idea.projectPath, childFolderName);

    logger.info('[Branches] Copying parent folder for new branch', {
      parentFolder: parentFolderName,
      childFolder: childFolderName
    });

    // Copy the entire parent folder (including node_modules) to child folder
    cpSync(parentFolderPath, childFolderPath, { recursive: true });

    // 4. Get parent's nodes/connections state
    let parentSynthesis: string | null;
    let parentNodesJson: string;
    let parentConnectionsJson: string;

    if (currentActive?.id === parentBranchId) {
      // Parent is active — read from live tables
      parentSynthesis = idea.synthesisContent ?? null;
      const { nodes, connections } = dependencyNodesService.getFullState(ideaId);

      parentNodesJson = JSON.stringify(nodes.map(n => ({
        id: n.id, name: n.name, provider: n.provider,
        description: n.description, pricing: n.pricing,
        positionX: n.positionX, positionY: n.positionY, color: n.color
      })));
      parentConnectionsJson = JSON.stringify(connections.map(c => ({
        id: c.id, fromNodeId: c.fromNodeId, toNodeId: c.toNodeId,
        label: c.label, details: c.details
      })));
    } else {
      // Parent is not active — read from stored snapshot
      parentSynthesis = parent.synthesisContent;
      parentNodesJson = parent.nodesSnapshot;
      parentConnectionsJson = parent.connectionsSnapshot;
    }

    // 5. Run compaction on parent's conversation (with caching)
    let compactedSummary = '';
    if (parent.conversationId) {
      const currentMessageCount = databaseService.getMessageCount(parent.conversationId);
      const cacheValid = parent.compactionCache
        && parent.compactionMessageCount !== null
        && parent.compactionMessageCount === currentMessageCount;

      if (cacheValid) {
        compactedSummary = parent.compactionCache!;
        logger.info('[Branches] Using cached compaction', {
          parentBranchId,
          messageCount: currentMessageCount
        });
      } else {
        try {
          compactedSummary = await compactConversation(parent.conversationId);
          // Cache the result on the parent branch
          db.update(schema.conversationBranches)
            .set({
              compactionCache: compactedSummary,
              compactionMessageCount: currentMessageCount,
              updatedAt: new Date()
            })
            .where(eq(schema.conversationBranches.id, parentBranchId))
            .run();
          logger.info('[Branches] Compaction completed and cached', {
            parentBranchId,
            messageCount: currentMessageCount
          });
        } catch (err) {
          logger.error('[Branches] Compaction failed, proceeding without summary', { error: err });
          compactedSummary = '(Conversation summary could not be generated)';
        }
      }
    }

    // 6. Create new conversation seeded with compacted summary
    const systemPrompt = compactedSummary
      ? `You are continuing work on an idea. Here is a summary of the previous conversation branch:\n\n${compactedSummary}\n\nContinue working from this context. The user may want to explore a different direction or continue building on what was done.`
      : undefined;

    const childConversation = databaseService.createConversation({
      title: childLabel,
      systemPrompt
    });

    // 7. Insert new branch record
    const now = new Date();
    const childId = this.generateId();

    db.insert(schema.conversationBranches).values({
      id: childId,
      ideaId,
      parentBranchId,
      conversationId: childConversation.id,
      label: childLabel,
      depth: parent.depth + 1,
      folderName: childFolderName,
      synthesisContent: parentSynthesis,
      filesSnapshot: '[]',  // files live on disk in the branch folder
      nodesSnapshot: parentNodesJson,
      connectionsSnapshot: parentConnectionsJson,
      isActive: false,
      createdAt: now,
      updatedAt: now,
    }).run();

    logger.info('[Branches] Created child branch', {
      childId,
      parentBranchId,
      ideaId,
      label: childLabel,
      folderName: childFolderName,
      depth: parent.depth + 1
    });

    // 8. Switch to the new branch (restores its state + marks active)
    this.switchToBranch(childId);

    return this.getBranch(childId)!;
  }

  // Count direct children of a branch
  private countChildren(branchId: string): number {
    const db = getDatabase();
    const children = db.select().from(schema.conversationBranches)
      .where(eq(schema.conversationBranches.parentBranchId, branchId))
      .all();
    return children.length;
  }

  // Delete a branch, its descendants, and their disk folders
  deleteBranch(branchId: string): void {
    const db = getDatabase();
    const branch = this.getBranch(branchId);
    if (!branch) throw new Error(`Branch ${branchId} not found`);

    // Cannot delete root
    if (!branch.parentBranchId) {
      throw new Error('Cannot delete the root branch');
    }

    // If active, switch to parent first
    if (branch.isActive) {
      this.switchToBranch(branch.parentBranchId);
    }

    // Recursively delete children first
    const children = db.select().from(schema.conversationBranches)
      .where(eq(schema.conversationBranches.parentBranchId, branchId))
      .all();

    for (const child of children) {
      this.deleteBranch(child.id);
    }

    // Delete the branch's disk folder
    if (branch.folderName) {
      const idea = ideasService.getIdea(branch.ideaId);
      if (idea?.projectPath) {
        const folderPath = join(idea.projectPath, branch.folderName);
        try {
          rmSync(folderPath, { recursive: true, force: true });
          logger.info('[Branches] Deleted branch folder', { folderPath });
        } catch (err) {
          logger.error('[Branches] Failed to delete branch folder', { error: err });
        }
      }
    }

    // Delete the branch's conversation if it exists
    if (branch.conversationId) {
      databaseService.deleteConversation(branch.conversationId);
    }

    // Delete the branch record
    db.delete(schema.conversationBranches)
      .where(eq(schema.conversationBranches.id, branchId))
      .run();

    logger.info('[Branches] Deleted branch', { branchId, ideaId: branch.ideaId });
  }

  // Update a branch label
  updateBranchLabel(branchId: string, label: string): ConversationBranch {
    const db = getDatabase();
    db.update(schema.conversationBranches)
      .set({ label, updatedAt: new Date() })
      .where(eq(schema.conversationBranches.id, branchId))
      .run();
    return this.getBranch(branchId)!;
  }
}

export const branchesService = new BranchesService();
