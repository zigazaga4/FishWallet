// Dev Server Service - Manages Vite dev servers for idea projects
// Only one dev server active at a time. Starting a new one stops the old one.

import { spawn, execSync, ChildProcess } from 'child_process';
import { createServer } from 'net';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from './logger';

const isWindows = process.platform === 'win32';

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

// Find a free port by letting the OS assign one
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = (addr && typeof addr === 'object') ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

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

      // Ensure node_modules exist before starting Vite
      if (!existsSync(join(projectPath, 'node_modules'))) {
        logger.info('[DevServer] node_modules missing, running npm install', { projectPath });
        try {
          execSync('npm install', { cwd: projectPath, timeout: 120000, stdio: 'pipe' });
          logger.info('[DevServer] npm install completed', { projectPath });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('[DevServer] npm install failed', { error: msg });
          return { port: 0, success: false, error: `npm install failed: ${msg.slice(0, 200)}` };
        }
      }

      // Let the OS pick a free port
      const port = await findFreePort();
      logger.info('[DevServer] OS assigned free port', { port });

      return await tryStartOnPort(ideaId, projectPath, port);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { port: 0, success: false, error: msg };
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

    const child = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host'], {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
      detached: false,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' }
    });

    let resolved = false;
    let stderrOutput = '';
    let allOutput = ''; // Accumulate all output to handle chunked writes

    // Set a timeout in case the server never becomes ready
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        killProcessTree(child);
        resolve({ port, success: false, error: 'Dev server startup timed out' });
      }
    }, 30000); // 30 second timeout

    // Strip ANSI escape codes — Vite outputs colored text that breaks string matching
    function stripAnsi(s: string): string {
      return s.replace(/\x1b\[[0-9;]*m/g, '');
    }

    // Check if Vite is ready by looking for the port in accumulated output
    function checkReady(source: string, chunk: string): void {
      allOutput += stripAnsi(chunk);
      logger.info(`[DevServer] ${source}:`, chunk.trim());

      // Vite outputs: "Local: http://localhost:<port>/" on stdout or stderr
      if (allOutput.includes(`localhost:${port}`) || allOutput.includes(`127.0.0.1:${port}`)) {
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
    }

    // Watch both stdout and stderr — on Windows, Vite may print to either
    child.stdout?.on('data', (data: Buffer) => checkReady('stdout', data.toString()));

    child.stderr?.on('data', (data: Buffer) => {
      stderrOutput += data.toString();
      checkReady('stderr', data.toString());
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

// Kill a process tree — on Windows, child.kill() only kills the shell wrapper,
// not the actual Vite process. Use taskkill /T /F to kill the entire tree.
function killProcessTree(child: ChildProcess): void {
  if (isWindows && child.pid) {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
      return;
    } catch {
      // Process already gone
    }
  }
  // Unix: SIGTERM is enough
  try { child.kill('SIGTERM'); } catch { /* already gone */ }
}

// Stop the active dev server
export async function stopDevServer(): Promise<void> {
  if (!activeServer) return;

  const { ideaId, port, process: serverProcess } = activeServer;
  logger.info('[DevServer] Stopping server', { ideaId, port });

  activeServer = null;

  killProcessTree(serverProcess);

  // Wait up to 3 seconds for exit confirmation
  await new Promise<void>((resolve) => {
    const killTimeout = setTimeout(() => {
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
    killProcessTree(activeServer.process);
    activeServer = null;
  }
}
