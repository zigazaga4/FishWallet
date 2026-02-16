// Snapshots Service - Version snapshots of idea state (synthesis, files on disk, nodes)
// Files are read from/written to the active branch's disk folder

import { eq, desc, and } from 'drizzle-orm';
import { getDatabase, schema } from '../db';
import { IdeaSnapshot } from '../db/schema';
import { ideasService } from './ideas';
import { branchesService } from './branches';
import { dependencyNodesService } from './dependencyNodes';
import { logger } from './logger';
import { randomUUID } from 'crypto';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join, relative, dirname } from 'path';

// Directories/files to skip when reading project files from disk
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.vite', 'versions']);
const SKIP_FILES = new Set(['package-lock.json']);

// Tools that modify idea state and should trigger a snapshot
// Note: Claude Code's built-in file tools (Write, Edit, Bash) bypass our MCP server,
// so we always create a snapshot after AI turns regardless of this set
export const MODIFYING_TOOLS = new Set([
  // Synthesis
  'update_synthesis', 'modify_synthesis_lines', 'add_to_synthesis', 'remove_from_synthesis',
  // Dependency nodes
  'create_dependency_node', 'update_dependency_node', 'delete_dependency_node',
  'connect_dependency_nodes', 'disconnect_dependency_nodes'
]);

// Check if any tool in the set is a modifying tool
export function hasModifyingTools(toolsCalled: Set<string>): boolean {
  for (const tool of toolsCalled) {
    if (MODIFYING_TOOLS.has(tool)) return true;
  }
  return false;
}

// Read all project files from a disk folder recursively
// Returns array of { filePath (relative), content } — skips node_modules, dist, .git
function readProjectFilesFromDisk(folderPath: string): Array<{ filePath: string; content: string }> {
  const files: Array<{ filePath: string; content: string }> = [];

  function walk(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (SKIP_FILES.has(entry.name)) continue;

      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        try {
          const content = readFileSync(fullPath, 'utf-8');
          const relPath = relative(folderPath, fullPath);
          files.push({ filePath: relPath, content });
        } catch {
          // Skip files that can't be read (binary, permissions, etc.)
        }
      }
    }
  }

  walk(folderPath);
  return files;
}

// Clear all project source files from a folder, keeping protected directories
function clearProjectFiles(folderPath: string): void {
  const protectedNames = new Set([...SKIP_DIRS, 'node_modules', 'dist']);
  let entries;
  try {
    entries = readdirSync(folderPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (protectedNames.has(entry.name)) continue;
    if (SKIP_FILES.has(entry.name)) continue;
    rmSync(join(folderPath, entry.name), { recursive: true, force: true });
  }
}

// Copy files from a version folder back to the project root
function copyVersionToDisk(versionDir: string, projectDir: string): void {
  const files = readProjectFilesFromDisk(versionDir);
  for (const file of files) {
    const fullPath = join(projectDir, file.filePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, 'utf-8');
  }
}

// Save project files to a version folder on disk
function saveVersionToDisk(branchFolderPath: string, versionNumber: number, filesData: Array<{ filePath: string; content: string }>): void {
  const versionDir = join(branchFolderPath, 'versions', `v${versionNumber}`);
  mkdirSync(versionDir, { recursive: true });
  for (const file of filesData) {
    const fullPath = join(versionDir, file.filePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, file.content, 'utf-8');
  }
}

class SnapshotsService {
  private generateId(): string {
    return randomUUID();
  }

  // Get the latest version number for an idea (0 if no snapshots exist)
  getLatestVersion(ideaId: string): number {
    const db = getDatabase();
    const latest = db.select({ versionNumber: schema.ideaSnapshots.versionNumber })
      .from(schema.ideaSnapshots)
      .where(eq(schema.ideaSnapshots.ideaId, ideaId))
      .orderBy(desc(schema.ideaSnapshots.versionNumber))
      .limit(1)
      .get();

    return latest?.versionNumber ?? 0;
  }

  // Create a snapshot of the current idea state
  // Reads files from the active branch's folder on disk
  createSnapshot(ideaId: string, toolsUsed: string[]): IdeaSnapshot {
    const db = getDatabase();

    // Get current state
    const idea = ideasService.getIdea(ideaId);
    if (!idea) {
      throw new Error(`Idea ${ideaId} not found`);
    }

    // Get the active branch's folder path for file reading
    const branchFolderPath = branchesService.getActiveBranchFolderPath(ideaId);
    let filesData: Array<{ filePath: string; content: string }> = [];
    if (branchFolderPath && existsSync(branchFolderPath)) {
      filesData = readProjectFilesFromDisk(branchFolderPath);
    }

    const { nodes, connections } = dependencyNodesService.getFullState(ideaId);
    const nextVersion = this.getLatestVersion(ideaId) + 1;

    // Serialize node data
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

    // Serialize connection data
    const connectionsData = connections.map(c => ({
      id: c.id,
      fromNodeId: c.fromNodeId,
      toNodeId: c.toNodeId,
      label: c.label,
      details: c.details
    }));

    const snapshot: typeof schema.ideaSnapshots.$inferInsert = {
      id: this.generateId(),
      ideaId,
      versionNumber: nextVersion,
      synthesisContent: idea.synthesisContent ?? null,
      filesSnapshot: JSON.stringify(filesData),
      nodesSnapshot: JSON.stringify(nodesData),
      connectionsSnapshot: JSON.stringify(connectionsData),
      toolsUsed: JSON.stringify(toolsUsed),
      createdAt: new Date()
    };

    db.insert(schema.ideaSnapshots).values(snapshot).run();

    // Save project files to disk version folder
    if (branchFolderPath && filesData.length > 0) {
      try {
        saveVersionToDisk(branchFolderPath, nextVersion, filesData);
      } catch (err) {
        logger.error('[Snapshots] Failed to save version to disk', { error: err, versionNumber: nextVersion });
      }
    }

    logger.info('[Snapshots] Created snapshot', {
      ideaId,
      versionNumber: nextVersion,
      filesCount: filesData.length,
      nodesCount: nodesData.length,
      connectionsCount: connectionsData.length,
      toolsUsed,
      versionDir: branchFolderPath ? join(branchFolderPath, 'versions', `v${nextVersion}`) : 'none'
    });

    return db.select().from(schema.ideaSnapshots)
      .where(eq(schema.ideaSnapshots.id, snapshot.id))
      .get()!;
  }

  // List all snapshots for an idea (ordered by version, newest first)
  getSnapshots(ideaId: string): IdeaSnapshot[] {
    const db = getDatabase();
    return db.select().from(schema.ideaSnapshots)
      .where(eq(schema.ideaSnapshots.ideaId, ideaId))
      .orderBy(desc(schema.ideaSnapshots.versionNumber))
      .all();
  }

  // Get a specific snapshot by ID
  getSnapshot(snapshotId: string): IdeaSnapshot | null {
    const db = getDatabase();
    return db.select().from(schema.ideaSnapshots)
      .where(eq(schema.ideaSnapshots.id, snapshotId))
      .get() ?? null;
  }

  // Get a specific snapshot by idea ID and version number
  getSnapshotByVersion(ideaId: string, versionNumber: number): IdeaSnapshot | null {
    const db = getDatabase();
    return db.select().from(schema.ideaSnapshots)
      .where(and(
        eq(schema.ideaSnapshots.ideaId, ideaId),
        eq(schema.ideaSnapshots.versionNumber, versionNumber)
      ))
      .get() ?? null;
  }

  // Restore live data from a snapshot
  // Writes files back to the active branch's folder on disk
  restoreSnapshot(snapshotId: string): void {
    const db = getDatabase();
    const snapshot = this.getSnapshot(snapshotId);

    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found`);
    }

    const ideaId = snapshot.ideaId;

    logger.info('[Snapshots] Restoring snapshot', {
      snapshotId,
      ideaId,
      versionNumber: snapshot.versionNumber
    });

    // 1. Restore synthesis content
    if (snapshot.synthesisContent !== undefined) {
      const idea = ideasService.getIdea(ideaId);
      if (idea) {
        db.update(schema.ideas)
          .set({
            synthesisContent: snapshot.synthesisContent,
            synthesisUpdatedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(schema.ideas.id, ideaId))
          .run();
      }
    }

    // 2. Restore files from disk version folder (hot-swap)
    const branchFolderPath = branchesService.getActiveBranchFolderPath(ideaId);
    if (branchFolderPath) {
      const versionDir = join(branchFolderPath, 'versions', `v${snapshot.versionNumber}`);
      if (existsSync(versionDir)) {
        // Hot-swap: clear current source files, copy version files back
        clearProjectFiles(branchFolderPath);
        copyVersionToDisk(versionDir, branchFolderPath);
        logger.info('[Snapshots] Restored files from disk version folder', { versionDir });
      } else {
        // Fallback: restore from DB if disk version doesn't exist (older snapshots)
        const filesData = JSON.parse(snapshot.filesSnapshot) as Array<{
          filePath: string;
          content: string;
        }>;
        if (filesData.length > 0) {
          clearProjectFiles(branchFolderPath);
          for (const file of filesData) {
            const fullPath = join(branchFolderPath, file.filePath);
            mkdirSync(dirname(fullPath), { recursive: true });
            writeFileSync(fullPath, file.content, 'utf-8');
          }
          logger.info('[Snapshots] Restored files from DB fallback (no disk version)', {
            filesCount: filesData.length
          });
        }
      }
    }

    // 3. Restore nodes - delete all current (cascades connections), insert snapshot nodes
    dependencyNodesService.deleteAllNodesForIdea(ideaId);

    const nodesData = JSON.parse(snapshot.nodesSnapshot) as Array<{
      id: string;
      name: string;
      provider: string;
      description: string;
      pricing: string | null;
      positionX: number;
      positionY: number;
      color: string | null;
    }>;

    const connectionsData = JSON.parse(snapshot.connectionsSnapshot) as Array<{
      id: string;
      fromNodeId: string;
      toNodeId: string;
      label: string | null;
      details: string | null;
    }>;

    // Insert nodes with their original IDs so connections work
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

    // Insert connections with their original IDs
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

    logger.info('[Snapshots] Restore completed', {
      ideaId,
      versionNumber: snapshot.versionNumber,
      nodesRestored: nodesData.length,
      connectionsRestored: connectionsData.length
    });
  }
}

export const snapshotsService = new SnapshotsService();
