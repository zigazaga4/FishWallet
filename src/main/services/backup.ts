// Backup Service — creates timestamped full backups of the SQLite DB and all project folders

import { app } from 'electron';
import { join } from 'path';
import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, rmSync, cpSync } from 'fs';
import { logger } from './logger';

// Directories to skip when copying project folders
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', '.vite', 'versions']);
const SKIP_FILES = new Set(['package-lock.json']);

// Root folder where all FishWallet ideas live
const FISH_WALLET_ROOT = join(app.getPath('documents'), 'FishWallet');

// Backups folder
const BACKUPS_DIR = join(FISH_WALLET_ROOT, 'backups');

export interface BackupInfo {
  timestamp: string;
  path: string;
  createdAt: string;
}

export interface BackupResult {
  success: boolean;
  path: string;
  timestamp: string;
}

// Filter function for cpSync — skip heavy/generated directories
function copyFilter(src: string): boolean {
  const name = src.replace(/\\/g, '/').split('/').pop() || '';
  if (SKIP_DIRS.has(name)) return false;
  if (SKIP_FILES.has(name)) return false;
  return true;
}

class BackupService {
  // Create a full backup: DB + all project folders
  createBackup(): BackupResult {
    const now = new Date();
    const timestamp = now.toISOString().replace(/:/g, '-').replace(/\.\d+Z$/, '');
    const backupDir = join(BACKUPS_DIR, timestamp);

    logger.info('[Backup] Creating backup', { timestamp, backupDir });

    // Create backup folder
    mkdirSync(backupDir, { recursive: true });

    try {
      // 1. Copy SQLite database files
      const dbDir = join(app.getPath('userData'), 'data');
      const dbFile = join(dbDir, 'fishwallet.db');

      if (existsSync(dbFile)) {
        copyFileSync(dbFile, join(backupDir, 'fishwallet.db'));
        logger.info('[Backup] Database copied');

        // Also copy WAL and SHM files if they exist (SQLite WAL mode)
        const walFile = dbFile + '-wal';
        const shmFile = dbFile + '-shm';
        if (existsSync(walFile)) {
          copyFileSync(walFile, join(backupDir, 'fishwallet.db-wal'));
        }
        if (existsSync(shmFile)) {
          copyFileSync(shmFile, join(backupDir, 'fishwallet.db-shm'));
        }
      } else {
        logger.warn('[Backup] Database file not found', { dbFile });
      }

      // 2. Copy all project/idea folders (skip backups folder itself)
      if (existsSync(FISH_WALLET_ROOT)) {
        const entries = readdirSync(FISH_WALLET_ROOT, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name === 'backups') continue; // Don't backup the backups

          const srcPath = join(FISH_WALLET_ROOT, entry.name);
          const destPath = join(backupDir, entry.name);

          logger.info('[Backup] Copying project folder', { name: entry.name });
          cpSync(srcPath, destPath, { recursive: true, filter: copyFilter });
        }
      }

      logger.info('[Backup] Backup completed successfully', { timestamp });
      return { success: true, path: backupDir, timestamp };
    } catch (err) {
      // Clean up partial backup on failure
      logger.error('[Backup] Failed', { error: err instanceof Error ? err.message : String(err) });
      try {
        rmSync(backupDir, { recursive: true, force: true });
      } catch { /* ignore cleanup errors */ }
      throw err;
    }
  }

  // List all existing backups
  listBackups(): BackupInfo[] {
    if (!existsSync(BACKUPS_DIR)) return [];

    const entries = readdirSync(BACKUPS_DIR, { withFileTypes: true });
    const backups: BackupInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const backupPath = join(BACKUPS_DIR, entry.name);
      const stat = statSync(backupPath);

      backups.push({
        timestamp: entry.name,
        path: backupPath,
        createdAt: stat.birthtime.toISOString()
      });
    }

    // Sort newest first
    backups.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    return backups;
  }

  // Delete a specific backup
  deleteBackup(timestamp: string): { success: boolean } {
    const backupPath = join(BACKUPS_DIR, timestamp);
    if (!existsSync(backupPath)) {
      logger.warn('[Backup] Backup not found for deletion', { timestamp });
      return { success: false };
    }

    rmSync(backupPath, { recursive: true, force: true });
    logger.info('[Backup] Backup deleted', { timestamp });
    return { success: true };
  }
}

export const backupService = new BackupService();
