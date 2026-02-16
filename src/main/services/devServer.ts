// Dev Server Service - Manages Vite dev servers for idea projects
// Only one dev server active at a time. Starting a new one stops the old one.

import { spawn, ChildProcess } from 'child_process';
import { logger } from './logger';

// Active dev server state
interface ActiveDevServer {
  ideaId: string;
  port: number;
  process: ChildProcess;
  projectPath: string;
}

let activeServer: ActiveDevServer | null = null;

// Mutex to prevent concurrent startDevServer calls from racing
let startupPromise: Promise<{ port: number; success: boolean; error?: string }> | null = null;

// Port range to try for dev servers
const PORT_START = 5174;
const PORT_END = 5178;

// Start a Vite dev server for a project
export async function startDevServer(
  ideaId: string,
  projectPath: string
): Promise<{ port: number; success: boolean; error?: string }> {
  // If already running for this idea AND same project path, return existing port
  if (activeServer && activeServer.ideaId === ideaId && activeServer.projectPath === projectPath) {
    logger.info('[DevServer] Already running for idea', { ideaId, port: activeServer.port });
    return { port: activeServer.port, success: true };
  }

  // If a startup is already in progress, wait for it
  if (startupPromise) {
    logger.info('[DevServer] Startup already in progress, waiting', { ideaId });
    return startupPromise;
  }

  // Acquire the lock
  startupPromise = (async () => {
    try {
      // Stop any existing server first
      await stopDevServer();

      // Try ports sequentially
      for (let port = PORT_START; port <= PORT_END; port++) {
        try {
          const result = await tryStartOnPort(ideaId, projectPath, port);
          if (result.success) {
            return result;
          }
        } catch {
          // Port in use or failed, try next
          continue;
        }
      }

      return { port: 0, success: false, error: 'All ports in use (5174-5178)' };
    } finally {
      startupPromise = null;
    }
  })();

  return startupPromise;
}

// Try to start the dev server on a specific port
function tryStartOnPort(
  ideaId: string,
  projectPath: string,
  port: number
): Promise<{ port: number; success: boolean; error?: string }> {
  return new Promise((resolve) => {
    logger.info('[DevServer] Attempting to start on port', { port, projectPath });

    const child = spawn('npx', ['vite', '--port', String(port), '--strictPort'], {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      env: { ...process.env }
    });

    let resolved = false;
    let stderrOutput = '';

    // Set a timeout in case the server never becomes ready
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        child.kill();
        resolve({ port, success: false, error: 'Dev server startup timed out' });
      }
    }, 30000); // 30 second timeout

    // Watch stdout for the "ready" signal (localhost URL)
    child.stdout?.on('data', (data: Buffer) => {
      const output = data.toString();
      logger.info('[DevServer] stdout:', output.trim());

      // Vite outputs something like: Local: http://localhost:5174/
      if (output.includes(`localhost:${port}`) || output.includes(`127.0.0.1:${port}`)) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);

          activeServer = {
            ideaId,
            port,
            process: child,
            projectPath
          };

          logger.info('[DevServer] Started successfully', { ideaId, port });
          resolve({ port, success: true });
        }
      }
    });

    child.stderr?.on('data', (data: Buffer) => {
      stderrOutput += data.toString();
      logger.warn('[DevServer] stderr:', data.toString().trim());
    });

    child.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ port, success: false, error: err.message });
      }
    });

    child.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({
          port,
          success: false,
          error: `Dev server exited with code ${code}${stderrOutput ? `: ${stderrOutput.slice(0, 200)}` : ''}`
        });
      }

      // Clean up if this was the active server
      if (activeServer?.process === child) {
        activeServer = null;
      }
    });
  });
}

// Stop the active dev server
export async function stopDevServer(): Promise<void> {
  if (!activeServer) return;

  const { ideaId, port, process: serverProcess } = activeServer;
  logger.info('[DevServer] Stopping server', { ideaId, port });

  activeServer = null;

  // Try SIGTERM first
  serverProcess.kill('SIGTERM');

  // Wait up to 3 seconds, then SIGKILL
  await new Promise<void>((resolve) => {
    const killTimeout = setTimeout(() => {
      try {
        serverProcess.kill('SIGKILL');
      } catch {
        // Process already gone
      }
      resolve();
    }, 3000);

    serverProcess.on('exit', () => {
      clearTimeout(killTimeout);
      resolve();
    });
  });

  logger.info('[DevServer] Server stopped', { ideaId, port });
}

// Get the currently active dev server
export function getActiveDevServer(): { port: number; ideaId: string } | null {
  if (!activeServer) return null;
  return { port: activeServer.port, ideaId: activeServer.ideaId };
}

// Shutdown all dev servers (called on app quit)
export function shutdownAllDevServers(): void {
  if (activeServer) {
    logger.info('[DevServer] Shutting down all servers');
    try {
      activeServer.process.kill('SIGKILL');
    } catch {
      // Process already gone
    }
    activeServer = null;
  }
}
