// Backup IPC Handler — exposes backup operations to the renderer

import { ipcMain } from 'electron';
import { backupService, BackupInfo, BackupResult } from '../services/backup';
import { logger } from '../services/logger';

export const BACKUP_CHANNELS = {
  CREATE: 'backup:create',
  LIST: 'backup:list',
  DELETE: 'backup:delete'
} as const;

export function registerBackupHandlers(): void {
  logger.info('[Backup-IPC] Registering backup handlers');

  ipcMain.handle(BACKUP_CHANNELS.CREATE, async (): Promise<BackupResult> => {
    logger.info('[Backup-IPC] Create backup request');
    return backupService.createBackup();
  });

  ipcMain.handle(BACKUP_CHANNELS.LIST, async (): Promise<BackupInfo[]> => {
    return backupService.listBackups();
  });

  ipcMain.handle(BACKUP_CHANNELS.DELETE, async (_event, timestamp: string): Promise<{ success: boolean }> => {
    logger.info('[Backup-IPC] Delete backup request', { timestamp });
    return backupService.deleteBackup(timestamp);
  });
}
