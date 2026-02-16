// Dev Server IPC Handlers - Manages Vite dev server lifecycle via IPC

import { ipcMain } from 'electron';
import { startDevServer, stopDevServer, getActiveDevServer } from '../services/devServer';
import { branchesService } from '../services/branches';
import { logger } from '../services/logger';

// IPC channel names for dev server operations
export const DEVSERVER_CHANNELS = {
  START: 'devserver:start',
  STOP: 'devserver:stop',
  STATUS: 'devserver:status'
} as const;

// Register all dev server IPC handlers
export function registerDevServerHandlers(): void {
  logger.info('[DevServer-IPC] Registering dev server handlers');

  // Start dev server for an idea
  ipcMain.handle(
    DEVSERVER_CHANNELS.START,
    async (_event, ideaId: string): Promise<{ port: number; success: boolean; error?: string }> => {
      logger.info('[DevServer-IPC] Start request', { ideaId });

      // Resolve the active branch's folder path
      const branchFolderPath = branchesService.getActiveBranchFolderPath(ideaId);
      if (!branchFolderPath) {
        return { port: 0, success: false, error: 'Idea has no project folder' };
      }

      return startDevServer(ideaId, branchFolderPath);
    }
  );

  // Stop the active dev server
  ipcMain.handle(
    DEVSERVER_CHANNELS.STOP,
    async (): Promise<{ success: boolean }> => {
      logger.info('[DevServer-IPC] Stop request');
      await stopDevServer();
      return { success: true };
    }
  );

  // Get status of the active dev server
  ipcMain.handle(
    DEVSERVER_CHANNELS.STATUS,
    async (): Promise<{ port: number; ideaId: string } | null> => {
      return getActiveDevServer();
    }
  );
}
