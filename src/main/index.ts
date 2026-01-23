import { app, BrowserWindow } from 'electron';
import { config } from 'dotenv';
import { join } from 'path';
import { createMainWindow } from './window';
import { registerAIHandlers } from './ipc/ai';
import { registerDatabaseHandlers } from './ipc/database';
import { registerIdeasHandlers } from './ipc/ideas';
import { registerFileBuilderHandlers } from './ipc/fileBuilder';
import { registerSandboxPreloadHandlers } from './ipc/sandboxPreload';
import { registerDependencyNodesHandlers } from './ipc/dependencyNodes';
import { registerMcpHandlers } from './ipc/mcp';
import { registerPanelErrorHandlers } from './ipc/panelErrors';
import { initializeDatabase, closeDatabase } from './db';
import { speechToTextService } from './services/speechToText';
import { langChainService } from './services/langchain';
import { mcpClientService } from './services/mcpClient';
import { logger } from './services/logger';

// Load environment variables from .env file
// In production, .env might be in extraResources or app path
const envPaths = [
  join(app.getAppPath(), '.env'),
  join(process.resourcesPath || '', '.env'),
  join(app.isPackaged ? process.resourcesPath || '' : app.getAppPath(), '.env')
];
for (const envPath of envPaths) {
  const result = config({ path: envPath });
  if (!result.error) {
    logger.info('[Main] Loaded .env from:', envPath);
    break;
  }
}

// Handle creating/removing shortcuts on Windows when installing/uninstalling
// Only run on Windows with Squirrel installer
if (process.platform === 'win32') {
  try {
    if (require('electron-squirrel-startup')) {
      app.quit();
    }
  } catch {
    // Module not available - not using Squirrel installer
  }
}

// Keep a global reference of the window object to prevent garbage collection
let mainWindow: BrowserWindow | null = null;

// Create window when Electron has finished initialization
app.whenReady().then(async () => {
  // Initialize database
  initializeDatabase();

  // Auto-initialize services from environment variables
  speechToTextService.initializeFromEnv();
  langChainService.initializeFromEnv();

  // Register IPC handlers before creating window
  registerAIHandlers();
  registerDatabaseHandlers();
  registerIdeasHandlers();
  registerFileBuilderHandlers();
  registerSandboxPreloadHandlers();
  registerDependencyNodesHandlers();
  registerMcpHandlers();
  registerPanelErrorHandlers();

  // Initialize MCP (Firecrawl) - use env var or hardcoded fallback
  const firecrawlApiKey = process.env.FIRECRAWL_API_KEY || 'fc-b992ceca9119406899518232c096f14d';
  logger.info('[Main] Initializing MCP with API key:', firecrawlApiKey ? 'present' : 'missing', 'source:', process.env.FIRECRAWL_API_KEY ? 'env' : 'hardcoded');
  mcpClientService.initialize(firecrawlApiKey).catch((error) => {
    logger.error('[Main] Failed to initialize MCP:', error);
  });

  mainWindow = await createMainWindow();

  // On macOS, re-create a window when dock icon is clicked and no windows are open
  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = await createMainWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Clean up reference, close database, and disconnect MCP when quitting
app.on('before-quit', async () => {
  mainWindow = null;
  closeDatabase();

  // Disconnect MCP server
  if (mcpClientService.isInitialized()) {
    await mcpClientService.disconnect();
  }
});
