// IPC handlers for panel error reporting
// Allows renderer to report iframe errors to main process

import { ipcMain } from 'electron';
import { logger } from '../services/logger';
import {
  reportPanelError,
  getPanelErrors,
  clearPanelErrors,
  hasPanelErrors,
  formatErrorsForAI,
  getPanelErrorLogPath,
  type PanelError
} from '../services/panelErrors';

// IPC channel names for panel errors
export const PANEL_ERROR_CHANNELS = {
  REPORT_ERROR: 'panel-errors:report',
  GET_ERRORS: 'panel-errors:get',
  CLEAR_ERRORS: 'panel-errors:clear',
  HAS_ERRORS: 'panel-errors:has',
  GET_LOG_PATH: 'panel-errors:log-path'
} as const;

// Register panel error IPC handlers
export function registerPanelErrorHandlers(): void {
  logger.info('[PanelErrors-IPC] Registering panel error handlers');

  // Report a panel error from the renderer
  ipcMain.handle(
    PANEL_ERROR_CHANNELS.REPORT_ERROR,
    async (
      _event,
      ideaId: string,
      message: string,
      source?: string,
      line?: number,
      column?: number,
      stack?: string
    ): Promise<void> => {
      logger.info('[PanelErrors-IPC] Error reported', { ideaId, message, source, line });
      reportPanelError(ideaId, message, source, line, column, stack);
    }
  );

  // Get all errors for an idea
  ipcMain.handle(
    PANEL_ERROR_CHANNELS.GET_ERRORS,
    async (_event, ideaId: string): Promise<PanelError[]> => {
      return getPanelErrors(ideaId);
    }
  );

  // Clear errors for an idea
  ipcMain.handle(
    PANEL_ERROR_CHANNELS.CLEAR_ERRORS,
    async (_event, ideaId: string): Promise<void> => {
      clearPanelErrors(ideaId);
    }
  );

  // Check if idea has errors
  ipcMain.handle(
    PANEL_ERROR_CHANNELS.HAS_ERRORS,
    async (_event, ideaId: string): Promise<boolean> => {
      return hasPanelErrors(ideaId);
    }
  );

  // Get log file path
  ipcMain.handle(
    PANEL_ERROR_CHANNELS.GET_LOG_PATH,
    async (): Promise<string> => {
      return getPanelErrorLogPath();
    }
  );
}

// Export for use in ai.ts
export { formatErrorsForAI, clearPanelErrors, hasPanelErrors };
