// IPC handlers for conversation branches (git-like tree)
// Guided by the Holy Spirit

import { ipcMain } from 'electron';
import { branchesService } from '../services/branches';
import { logger } from '../services/logger';

export const BRANCH_CHANNELS = {
  GET_ALL: 'branches:get-all',
  GET: 'branches:get',
  GET_ACTIVE: 'branches:get-active',
  ENSURE_ROOT: 'branches:ensure-root',
  CREATE_CHILD: 'branches:create-child',
  SWITCH_TO: 'branches:switch-to',
  DELETE: 'branches:delete',
  UPDATE_LABEL: 'branches:update-label'
};

export function registerBranchHandlers(): void {
  // Get all branches for an idea (tree rendering)
  ipcMain.handle(BRANCH_CHANNELS.GET_ALL, async (_event, ideaId: string) => {
    try {
      return branchesService.getBranches(ideaId);
    } catch (error) {
      logger.error('[Branches IPC] Error getting branches', { error });
      throw error;
    }
  });

  // Get a single branch by ID
  ipcMain.handle(BRANCH_CHANNELS.GET, async (_event, branchId: string) => {
    try {
      return branchesService.getBranch(branchId);
    } catch (error) {
      logger.error('[Branches IPC] Error getting branch', { error });
      throw error;
    }
  });

  // Get the active branch for an idea
  ipcMain.handle(BRANCH_CHANNELS.GET_ACTIVE, async (_event, ideaId: string) => {
    try {
      return branchesService.getActiveBranch(ideaId);
    } catch (error) {
      logger.error('[Branches IPC] Error getting active branch', { error });
      throw error;
    }
  });

  // Ensure root branch exists (lazy init)
  ipcMain.handle(BRANCH_CHANNELS.ENSURE_ROOT, async (_event, ideaId: string) => {
    try {
      return branchesService.ensureRootBranch(ideaId);
    } catch (error) {
      logger.error('[Branches IPC] Error ensuring root branch', { error });
      throw error;
    }
  });

  // Create a child branch (async — compaction takes time)
  ipcMain.handle(BRANCH_CHANNELS.CREATE_CHILD, async (_event, parentBranchId: string, label?: string) => {
    try {
      return await branchesService.createChildBranch(parentBranchId, label);
    } catch (error) {
      logger.error('[Branches IPC] Error creating child branch', { error });
      throw error;
    }
  });

  // Switch to a different branch
  ipcMain.handle(BRANCH_CHANNELS.SWITCH_TO, async (_event, branchId: string) => {
    try {
      branchesService.switchToBranch(branchId);
      return { success: true };
    } catch (error) {
      logger.error('[Branches IPC] Error switching branch', { error });
      throw error;
    }
  });

  // Delete a branch and its descendants
  ipcMain.handle(BRANCH_CHANNELS.DELETE, async (_event, branchId: string) => {
    try {
      branchesService.deleteBranch(branchId);
      return { success: true };
    } catch (error) {
      logger.error('[Branches IPC] Error deleting branch', { error });
      throw error;
    }
  });

  // Update a branch label
  ipcMain.handle(BRANCH_CHANNELS.UPDATE_LABEL, async (_event, branchId: string, label: string) => {
    try {
      return branchesService.updateBranchLabel(branchId, label);
    } catch (error) {
      logger.error('[Branches IPC] Error updating branch label', { error });
      throw error;
    }
  });
}
