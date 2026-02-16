// Project Scaffolding Service - Creates Vite + React + TS + Tailwind projects on disk
// Each idea gets its own project folder at ~/Documents/FishWallet/<idea-name>/

import { mkdirSync, writeFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from './logger';

// Result of scaffolding a project
export interface ScaffoldResult {
  success: boolean;
  projectPath?: string;
  error?: string;
}

// Base directory for all idea projects
const PROJECTS_BASE = join(homedir(), 'Documents', 'FishWallet');

// Sanitize a title into a valid folder name
export function sanitizeFolderName(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')   // remove special chars
    .replace(/\s+/g, '-')            // spaces to hyphens
    .replace(/-+/g, '-')             // collapse multiple hyphens
    .replace(/^-|-$/g, '')           // trim leading/trailing hyphens
    .slice(0, 50) || 'project';      // max 50 chars, fallback
}

// Ensure a unique path by appending -2, -3, etc. if folder exists
export function ensureUniquePath(basePath: string): string {
  if (!existsSync(basePath)) return basePath;

  let counter = 2;
  let candidate = `${basePath}-${counter}`;
  while (existsSync(candidate)) {
    counter++;
    candidate = `${basePath}-${counter}`;
  }
  return candidate;
}

// Template files embedded in the app (no network needed for scaffolding)
const TEMPLATES: Record<string, string> = {
  'package.json': JSON.stringify({
    name: 'idea-project',
    private: true,
    version: '0.0.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc -b && vite build',
      preview: 'vite preview'
    },
    dependencies: {
      'react': '^19.1.0',
      'react-dom': '^19.1.0',
      'lucide-react': '^0.469.0',
      'framer-motion': '^12.0.0',
      'clsx': '^2.1.1',
      'date-fns': '^4.1.0',
      'axios': '^1.7.0',
      'uuid': '^11.0.0',
      'zod': '^3.24.0',
      'zustand': '^5.0.0',
      'react-hot-toast': '^2.5.0'
    },
    devDependencies: {
      '@tailwindcss/vite': '^4.1.0',
      '@types/react': '^19.0.0',
      '@types/react-dom': '^19.0.0',
      '@types/uuid': '^10.0.0',
      '@vitejs/plugin-react-swc': '^4.0.0',
      'tailwindcss': '^4.1.0',
      'typescript': '^5.7.0',
      'vite': '^6.0.0'
    }
  }, null, 2),

  'vite.config.ts': `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
})
`,

  'tsconfig.json': JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      useDefineForClassFields: true,
      lib: ['ES2020', 'DOM', 'DOM.Iterable'],
      module: 'ESNext',
      skipLibCheck: true,
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      isolatedModules: true,
      moduleDetection: 'force',
      noEmit: true,
      jsx: 'react-jsx',
      strict: true,
      noUnusedLocals: false,
      noUnusedParameters: false,
      noFallthroughCasesInSwitch: true,
      noUncheckedSideEffectImports: true
    },
    include: ['src']
  }, null, 2),

  'index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,

  'src/main.tsx': `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`,

  'src/App.tsx': `export default function App() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-white mb-4">Hello World</h1>
        <p className="text-slate-400 text-lg">Start building your app</p>
      </div>
    </div>
  )
}
`,

  'src/index.css': `@import "tailwindcss";
`,

  'src/vite-env.d.ts': `/// <reference types="vite/client" />
`
};

// Scaffold a new Vite project for an idea
// Creates <idea-name>/main/ structure — projectPath points to the idea-level folder
export async function scaffoldProject(ideaTitle: string): Promise<ScaffoldResult> {
  try {
    // Ensure base directory exists
    mkdirSync(PROJECTS_BASE, { recursive: true });

    // Generate folder name and ensure uniqueness for the idea-level folder
    const folderName = sanitizeFolderName(ideaTitle);
    const ideaPath = ensureUniquePath(join(PROJECTS_BASE, folderName));

    logger.info('[ProjectScaffold] Creating project', { ideaTitle, ideaPath });

    // Create idea-level directory and main branch subfolder
    const mainBranchPath = join(ideaPath, 'main');
    mkdirSync(mainBranchPath, { recursive: true });

    // Create src subdirectory inside main branch
    mkdirSync(join(mainBranchPath, 'src'), { recursive: true });

    // Write all template files into main branch folder
    for (const [filePath, content] of Object.entries(TEMPLATES)) {
      const fullPath = join(mainBranchPath, filePath);
      writeFileSync(fullPath, content, 'utf-8');
    }

    logger.info('[ProjectScaffold] Project scaffolded successfully', { ideaPath, branchFolder: 'main' });

    // Return the idea-level folder as projectPath (not the branch subfolder)
    return { success: true, projectPath: ideaPath };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('[ProjectScaffold] Failed to scaffold project', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}

// Scaffold template files into an existing branch folder
export function scaffoldBranchFolder(branchFolderPath: string): void {
  mkdirSync(join(branchFolderPath, 'src'), { recursive: true });
  for (const [filePath, content] of Object.entries(TEMPLATES)) {
    const fullPath = join(branchFolderPath, filePath);
    writeFileSync(fullPath, content, 'utf-8');
  }
}

// Install dependencies for a project (runs npm install)
export async function installDependencies(projectPath: string): Promise<{ success: boolean; error?: string }> {
  try {
    logger.info('[ProjectScaffold] Installing dependencies', { projectPath });

    execSync('npm install', {
      cwd: projectPath,
      timeout: 120000, // 2 minute timeout
      stdio: 'pipe'
    });

    logger.info('[ProjectScaffold] Dependencies installed successfully', { projectPath });
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error('[ProjectScaffold] Failed to install dependencies', { error: errorMsg });
    return { success: false, error: errorMsg };
  }
}
