// Sandbox Preload IPC Handler - Serves the sandbox bundle to the renderer
// Guided by the Holy Spirit

import { ipcMain } from 'electron';
import { readFileSync } from 'fs';
import { join } from 'path';
import log from 'electron-log';

// Cache the bundle content to avoid repeated file reads
let cachedBundleContent: string | null = null;

// Get the path to the sandbox preload bundle
function getSandboxPreloadPath(): string {
  // __dirname is dist/main/ipc, go up two levels to dist/, then into renderer/
  return join(__dirname, '..', '..', 'renderer', 'sandbox-preload.js');
}

// Read and cache the sandbox preload bundle
function getSandboxPreloadContent(): string {
  if (cachedBundleContent) {
    return cachedBundleContent;
  }

  const bundlePath = getSandboxPreloadPath();
  log.debug('[SandboxPreload] Loading bundle from:', bundlePath);

  try {
    cachedBundleContent = readFileSync(bundlePath, 'utf-8');
    log.info('[SandboxPreload] Bundle loaded successfully, size:', cachedBundleContent.length);
    return cachedBundleContent;
  } catch (error) {
    log.error('[SandboxPreload] Failed to load bundle:', error);
    throw error;
  }
}

// Register IPC handlers
export function registerSandboxPreloadHandlers(): void {
  // Handler to get the sandbox preload bundle content
  ipcMain.handle('sandbox:get-preload', () => {
    try {
      return {
        success: true,
        content: getSandboxPreloadContent(),
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  log.info('[SandboxPreload] IPC handlers registered');
}

// Clear the cache (useful for development hot reload)
export function clearSandboxPreloadCache(): void {
  cachedBundleContent = null;
  log.debug('[SandboxPreload] Cache cleared');
}
