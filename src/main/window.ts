import { BrowserWindow, session, systemPreferences } from 'electron';
import { join } from 'path';

// Determine if running in development mode
const isDev = process.env.NODE_ENV === 'development';

// Set up permission handlers for media access (microphone, camera)
function setupPermissionHandlers(): void {
  const ses = session.defaultSession;

  // Handle permission requests (microphone, camera, etc.)
  ses.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'microphone', 'camera', 'audioCapture'];

    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  // Handle permission checks
  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const allowedPermissions = ['media', 'microphone', 'camera', 'audioCapture'];
    return allowedPermissions.includes(permission);
  });

  // Strip COEP/COOP headers from all responses so cross-origin iframes
  // (app preview at localhost:5174+) are not blocked by ERR_BLOCKED_BY_RESPONSE.
  ses.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    delete headers['cross-origin-embedder-policy'];
    delete headers['Cross-Origin-Embedder-Policy'];
    delete headers['cross-origin-opener-policy'];
    delete headers['Cross-Origin-Opener-Policy'];
    callback({ responseHeaders: headers });
  });
}

// Request microphone access on Windows/macOS
async function requestMicrophoneAccess(): Promise<boolean> {
  if (process.platform === 'darwin') {
    // macOS requires explicit permission request
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'not-determined') {
      return await systemPreferences.askForMediaAccess('microphone');
    }
    return status === 'granted';
  } else if (process.platform === 'win32') {
    // Windows 10/11 - check if microphone access is allowed in system settings
    const status = systemPreferences.getMediaAccessStatus('microphone');
    // On Windows, 'granted' means app has access, 'denied' means blocked in settings
    return status === 'granted';
  }
  return true; // Linux and others
}

// Dev server URL from environment variable
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

// Window configuration constants
const WINDOW_CONFIG = {
  width: 1200,
  height: 800,
  minWidth: 800,
  minHeight: 600
} as const;

// Create the main application window
export async function createMainWindow(): Promise<BrowserWindow> {
  // Set up permission handlers before creating window
  setupPermissionHandlers();

  // Request microphone access
  const micAccess = await requestMicrophoneAccess();
  console.log('[Window] Microphone access:', micAccess ? 'granted' : 'denied');

  const mainWindow = new BrowserWindow({
    width: WINDOW_CONFIG.width,
    height: WINDOW_CONFIG.height,
    minWidth: WINDOW_CONFIG.minWidth,
    minHeight: WINDOW_CONFIG.minHeight,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    show: false,
    backgroundColor: '#1a1a1a'
  });

  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Load the app URL based on environment
  if (isDev) {
    await mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return mainWindow;
}
