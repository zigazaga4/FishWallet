// File System Service - Manages project files for AI app builder
// Handles CRUD operations for files stored in database
// Guided by the Holy Spirit

import { getDatabase, schema } from '../db';
import { eq, and } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import type { ProjectFile } from '../db/schema';

// Allowed file types for security
const ALLOWED_FILE_TYPES = ['tsx', 'ts', 'css'] as const;
type FileType = typeof ALLOWED_FILE_TYPES[number];

// Maximum file size in bytes (1MB)
const MAX_FILE_SIZE = 1024 * 1024;

// Path validation patterns
const INVALID_PATH_PATTERNS = [
  /\.\./,           // No parent directory traversal
  /^\//,            // No absolute paths
  /^[A-Za-z]:\\/,   // No Windows absolute paths
  /[\x00-\x1f]/,    // No control characters
];

// Validate file path for security
function validateFilePath(filePath: string): void {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('File path is required');
  }

  if (filePath.length > 255) {
    throw new Error('File path exceeds maximum length of 255 characters');
  }

  for (const pattern of INVALID_PATH_PATTERNS) {
    if (pattern.test(filePath)) {
      throw new Error(`Invalid file path: ${filePath}`);
    }
  }
}

// Validate and extract file type from path
function getFileTypeFromPath(filePath: string): FileType {
  const extension = filePath.split('.').pop()?.toLowerCase();

  if (!extension || !ALLOWED_FILE_TYPES.includes(extension as FileType)) {
    throw new Error(`Invalid file type. Allowed types: ${ALLOWED_FILE_TYPES.join(', ')}`);
  }

  return extension as FileType;
}

// Validate content size
function validateContentSize(content: string): void {
  const byteSize = new TextEncoder().encode(content).length;

  if (byteSize > MAX_FILE_SIZE) {
    throw new Error(`File content exceeds maximum size of ${MAX_FILE_SIZE / 1024 / 1024}MB`);
  }
}

// File system service class
class FileSystemService {
  // Create a new file
  createFile(
    ideaId: string,
    filePath: string,
    content: string,
    isEntryFile: boolean = false
  ): ProjectFile {
    validateFilePath(filePath);
    validateContentSize(content);
    const fileType = getFileTypeFromPath(filePath);

    const db = getDatabase();
    const now = new Date();

    // If setting as entry file, clear any existing entry file for this idea
    if (isEntryFile) {
      db.update(schema.projectFiles)
        .set({ isEntryFile: false, updatedAt: now })
        .where(
          and(
            eq(schema.projectFiles.ideaId, ideaId),
            eq(schema.projectFiles.isEntryFile, true)
          )
        )
        .run();
    }

    const newFile: typeof schema.projectFiles.$inferInsert = {
      id: nanoid(),
      ideaId,
      filePath,
      content,
      fileType,
      isEntryFile,
      createdAt: now,
      updatedAt: now
    };

    db.insert(schema.projectFiles).values(newFile).run();

    return {
      ...newFile,
      createdAt: now,
      updatedAt: now
    } as ProjectFile;
  }

  // Get a file by path
  getFileByPath(ideaId: string, filePath: string): ProjectFile | null {
    const db = getDatabase();

    const result = db.query.projectFiles.findFirst({
      where: and(
        eq(schema.projectFiles.ideaId, ideaId),
        eq(schema.projectFiles.filePath, filePath)
      )
    }).sync();

    return result ?? null;
  }

  // Get a file by ID
  getFileById(fileId: string): ProjectFile | null {
    const db = getDatabase();

    const result = db.query.projectFiles.findFirst({
      where: eq(schema.projectFiles.id, fileId)
    }).sync();

    return result ?? null;
  }

  // Update a file's content
  updateFile(ideaId: string, filePath: string, content: string): ProjectFile {
    validateContentSize(content);

    const db = getDatabase();
    const existingFile = this.getFileByPath(ideaId, filePath);

    if (!existingFile) {
      throw new Error(`File not found: ${filePath}`);
    }

    const now = new Date();

    db.update(schema.projectFiles)
      .set({ content, updatedAt: now })
      .where(eq(schema.projectFiles.id, existingFile.id))
      .run();

    return {
      ...existingFile,
      content,
      updatedAt: now
    };
  }

  // Modify specific lines in a file (1-indexed)
  modifyFileLines(
    ideaId: string,
    filePath: string,
    startLine: number,
    endLine: number,
    newContent: string
  ): ProjectFile {
    const existingFile = this.getFileByPath(ideaId, filePath);

    if (!existingFile) {
      throw new Error(`File not found: ${filePath}`);
    }

    const lines = existingFile.content.split('\n');

    // Validate line numbers
    if (startLine < 1 || endLine > lines.length || startLine > endLine) {
      throw new Error(`Invalid line range. File has ${lines.length} lines.`);
    }

    // Replace the lines (1-indexed to 0-indexed)
    const newLines = newContent.split('\n');
    lines.splice(startLine - 1, endLine - startLine + 1, ...newLines);

    const updatedContent = lines.join('\n');
    validateContentSize(updatedContent);

    return this.updateFile(ideaId, filePath, updatedContent);
  }

  // Delete a file
  deleteFile(ideaId: string, filePath: string): void {
    const db = getDatabase();
    const existingFile = this.getFileByPath(ideaId, filePath);

    if (!existingFile) {
      throw new Error(`File not found: ${filePath}`);
    }

    db.delete(schema.projectFiles)
      .where(eq(schema.projectFiles.id, existingFile.id))
      .run();
  }

  // List all files for an idea
  listFiles(ideaId: string): ProjectFile[] {
    const db = getDatabase();

    return db.query.projectFiles.findMany({
      where: eq(schema.projectFiles.ideaId, ideaId),
      orderBy: (files, { asc }) => [asc(files.filePath)]
    }).sync();
  }

  // Get the entry file for an idea
  getEntryFile(ideaId: string): ProjectFile | null {
    const db = getDatabase();

    const result = db.query.projectFiles.findFirst({
      where: and(
        eq(schema.projectFiles.ideaId, ideaId),
        eq(schema.projectFiles.isEntryFile, true)
      )
    }).sync();

    return result ?? null;
  }

  // Set a file as the entry file
  setEntryFile(ideaId: string, filePath: string): ProjectFile {
    const db = getDatabase();
    const targetFile = this.getFileByPath(ideaId, filePath);

    if (!targetFile) {
      throw new Error(`File not found: ${filePath}`);
    }

    const now = new Date();

    // Clear any existing entry file
    db.update(schema.projectFiles)
      .set({ isEntryFile: false, updatedAt: now })
      .where(
        and(
          eq(schema.projectFiles.ideaId, ideaId),
          eq(schema.projectFiles.isEntryFile, true)
        )
      )
      .run();

    // Set the new entry file
    db.update(schema.projectFiles)
      .set({ isEntryFile: true, updatedAt: now })
      .where(eq(schema.projectFiles.id, targetFile.id))
      .run();

    return {
      ...targetFile,
      isEntryFile: true,
      updatedAt: now
    };
  }

  // Delete all files for an idea
  deleteAllFilesForIdea(ideaId: string): number {
    const db = getDatabase();

    const result = db.delete(schema.projectFiles)
      .where(eq(schema.projectFiles.ideaId, ideaId))
      .run();

    return result.changes;
  }

  // Format file content with line numbers for AI display
  formatFileWithLineNumbers(content: string): string {
    if (!content) return '';

    const lines = content.split('\n');
    return lines.map((line, i) => `${(i + 1).toString().padStart(4, ' ')} | ${line}`).join('\n');
  }
}

// Export singleton instance
export const fileSystemService = new FileSystemService();
