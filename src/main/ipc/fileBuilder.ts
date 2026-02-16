// File Builder IPC Handler - Handles file CRUD operations
// Guided by the Holy Spirit

import { ipcMain } from 'electron';
import { fileSystemService } from '../services/fileSystem';
import { logger } from '../services/logger';

// IPC channel names for file operations
export const FILE_BUILDER_CHANNELS = {
  FILES_CREATE: 'files:create',
  FILES_READ: 'files:read',
  FILES_UPDATE: 'files:update',
  FILES_DELETE: 'files:delete',
  FILES_LIST: 'files:list',
  FILES_GET_ENTRY: 'files:get-entry',
  FILES_SET_ENTRY: 'files:set-entry',
  FILES_MODIFY_LINES: 'files:modify-lines'
} as const;

// Register file builder IPC handlers
export function registerFileBuilderHandlers(): void {
  logger.info('[FileBuilder-IPC] Registering file builder handlers');

  // Create a new file
  ipcMain.handle(
    FILE_BUILDER_CHANNELS.FILES_CREATE,
    async (_event, ideaId: string, filePath: string, content: string, isEntryFile?: boolean) => {
      logger.info('[FileBuilder-IPC] Create file request', { ideaId, filePath });
      return fileSystemService.createFile(ideaId, filePath, content, isEntryFile ?? false);
    }
  );

  // Read a file
  ipcMain.handle(
    FILE_BUILDER_CHANNELS.FILES_READ,
    async (_event, ideaId: string, filePath: string) => {
      logger.debug('[FileBuilder-IPC] Read file request', { ideaId, filePath });
      return fileSystemService.getFileByPath(ideaId, filePath);
    }
  );

  // Update a file
  ipcMain.handle(
    FILE_BUILDER_CHANNELS.FILES_UPDATE,
    async (_event, ideaId: string, filePath: string, content: string) => {
      logger.info('[FileBuilder-IPC] Update file request', { ideaId, filePath });
      return fileSystemService.updateFile(ideaId, filePath, content);
    }
  );

  // Delete a file
  ipcMain.handle(
    FILE_BUILDER_CHANNELS.FILES_DELETE,
    async (_event, ideaId: string, filePath: string) => {
      logger.info('[FileBuilder-IPC] Delete file request', { ideaId, filePath });
      fileSystemService.deleteFile(ideaId, filePath);
      return { success: true };
    }
  );

  // List all files for an idea
  ipcMain.handle(
    FILE_BUILDER_CHANNELS.FILES_LIST,
    async (_event, ideaId: string) => {
      logger.debug('[FileBuilder-IPC] List files request', { ideaId });
      return fileSystemService.listFiles(ideaId);
    }
  );

  // Get entry file
  ipcMain.handle(
    FILE_BUILDER_CHANNELS.FILES_GET_ENTRY,
    async (_event, ideaId: string) => {
      logger.debug('[FileBuilder-IPC] Get entry file request', { ideaId });
      return fileSystemService.getEntryFile(ideaId);
    }
  );

  // Set entry file
  ipcMain.handle(
    FILE_BUILDER_CHANNELS.FILES_SET_ENTRY,
    async (_event, ideaId: string, filePath: string) => {
      logger.info('[FileBuilder-IPC] Set entry file request', { ideaId, filePath });
      return fileSystemService.setEntryFile(ideaId, filePath);
    }
  );

  // Modify specific lines in a file
  ipcMain.handle(
    FILE_BUILDER_CHANNELS.FILES_MODIFY_LINES,
    async (_event, ideaId: string, filePath: string, startLine: number, endLine: number, newContent: string) => {
      logger.info('[FileBuilder-IPC] Modify file lines request', { ideaId, filePath, startLine, endLine });
      return fileSystemService.modifyFileLines(ideaId, filePath, startLine, endLine, newContent);
    }
  );
}
