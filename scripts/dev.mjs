import { spawn } from 'child_process';
import getPort from 'get-port';

// Find an available port and start the dev servers
async function startDev() {
  const port = await getPort({ port: [5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180] });

  console.log(`Starting dev server on port ${port}`);

  // Start Vite with the found port
  const vite = spawn('npx', ['vite', '--port', port.toString()], {
    stdio: 'inherit',
    shell: true
  });

  // Wait for Vite to be ready, then start Electron
  const waitOn = spawn('npx', ['wait-on', `http://localhost:${port}`], {
    stdio: 'inherit',
    shell: true
  });

  waitOn.on('close', async (code) => {
    if (code === 0) {
      // Build main process
      const build = spawn('npm', ['run', 'build:main'], {
        stdio: 'inherit',
        shell: true
      });

      build.on('close', (buildCode) => {
        if (buildCode === 0) {
          // Start Electron with the dev URL
          spawn('npx', ['electron', '.'], {
            stdio: 'inherit',
            shell: true,
            env: {
              ...process.env,
              NODE_ENV: 'development',
              VITE_DEV_SERVER_URL: `http://localhost:${port}`
            }
          });
        }
      });
    }
  });

  // Handle process termination
  process.on('SIGINT', () => {
    vite.kill();
    process.exit();
  });

  process.on('SIGTERM', () => {
    vite.kill();
    process.exit();
  });
}

startDev();
