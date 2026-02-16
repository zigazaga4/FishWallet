// IPC handlers for idea snapshots
// Guided by the Holy Spirit

import { ipcMain } from 'electron';
import { snapshotsService } from '../services/snapshots';
import { logger } from '../services/logger';

// IPC channel names for snapshot operations
export const SNAPSHOT_CHANNELS = {
  LIST: 'snapshots:list',
  GET: 'snapshots:get',
  RESTORE: 'snapshots:restore',
  // Event sent from backend to frontend when a snapshot is created
  CREATED: 'idea:snapshot-created'
};

export function registerSnapshotHandlers(): void {
  // List all snapshots for an idea
  ipcMain.handle(SNAPSHOT_CHANNELS.LIST, async (_event, ideaId: string) => {
    try {
      return snapshotsService.getSnapshots(ideaId);
    } catch (error) {
      logger.error('[Snapshots IPC] Error listing snapshots', { error });
      throw error;
    }
  });

  // Get a specific snapshot by ID
  ipcMain.handle(SNAPSHOT_CHANNELS.GET, async (_event, snapshotId: string) => {
    try {
      return snapshotsService.getSnapshot(snapshotId);
    } catch (error) {
      logger.error('[Snapshots IPC] Error getting snapshot', { error });
      throw error;
    }
  });

  // Restore live data from a snapshot
  ipcMain.handle(SNAPSHOT_CHANNELS.RESTORE, async (_event, snapshotId: string) => {
    try {
      snapshotsService.restoreSnapshot(snapshotId);
      return { success: true };
    } catch (error) {
      logger.error('[Snapshots IPC] Error restoring snapshot', { error });
      throw error;
    }
  });
}
