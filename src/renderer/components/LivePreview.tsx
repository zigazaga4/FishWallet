// LivePreview - Renders React code in a sandboxed iframe
// Uses iframe for complete CSS and JS isolation
// Loads prebuilt package bundle for fast, offline-capable previews
// Guided by the Holy Spirit

import { useState, useEffect, useRef, type ReactElement } from 'react';
import type { PreviewMode } from './Panel';

// Project file interface
interface ProjectFile {
  id: string;
  ideaId: string;
  filePath: string;
  content: string;
  fileType: 'tsx' | 'ts' | 'css';
  isEntryFile: boolean;
  createdAt: Date;
  updatedAt: Date;
}

// Phone dimensions (iPhone SE)
const PHONE_WIDTH = 375;
const PHONE_HEIGHT = 667;

// Props for LivePreview component
interface LivePreviewProps {
  entryFile: ProjectFile | null;
  allFiles: ProjectFile[];
  isLoading: boolean;
  previewMode?: PreviewMode;
  ideaId: string; // Required to associate errors with the idea
}

// Package mapping: npm package name -> global variable name
const PACKAGE_GLOBALS: Record<string, string> = {
  'react': 'React',
  'react-dom': 'ReactDOM',
  'react-dom/client': 'ReactDOM',
  'lucide-react': 'LucideReact',
  'framer-motion': 'FramerMotion',
  '@headlessui/react': 'HeadlessUI',
  'clsx': 'clsx',
  'date-fns': 'dateFns',
  'uuid': 'uuid',
  'zustand': 'zustand',
  'axios': 'axios',
  'zod': 'zod',
  'react-hot-toast': 'reactHotToast',
  'three': 'THREE',
};

// Transform npm package imports to use preloaded globals
function transformPackageImports(code: string): string {
  let transformed = code;

  for (const [pkg, globalVar] of Object.entries(PACKAGE_GLOBALS)) {
    const escapedPkg = pkg.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');

    // Named imports: import { X, Y } from 'package'
    const namedImportRegex = new RegExp(
      `import\\s*\\{([^}]+)\\}\\s*from\\s*['"]${escapedPkg}['"];?`,
      'g'
    );
    transformed = transformed.replace(namedImportRegex, (_, imports) => {
      return `const {${imports}} = window.${globalVar};`;
    });

    // Default import: import Package from 'package'
    const defaultImportRegex = new RegExp(
      `import\\s+(\\w+)\\s+from\\s*['"]${escapedPkg}['"];?`,
      'g'
    );
    transformed = transformed.replace(defaultImportRegex, (_, importName) => {
      return `const ${importName} = window.${globalVar}.default || window.${globalVar};`;
    });

    // Namespace import: import * as Package from 'package'
    const namespaceImportRegex = new RegExp(
      `import\\s*\\*\\s*as\\s+(\\w+)\\s+from\\s*['"]${escapedPkg}['"];?`,
      'g'
    );
    transformed = transformed.replace(namespaceImportRegex, (_, importName) => {
      return `const ${importName} = window.${globalVar};`;
    });
  }

  return transformed;
}

// Transform local file imports to use the module registry
function transformLocalImports(code: string): string {
  let transformed = code;

  // Named imports from local files: import { X, Y } from './path'
  transformed = transformed.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"]\.\/([^'"]+)['"];?/g,
    (_, imports, path) => {
      const moduleName = pathToModuleName(path);
      return `const {${imports}} = window.__MODULES__['${moduleName}'];`;
    }
  );

  // Default import from local files: import X from './path'
  transformed = transformed.replace(
    /import\s+(\w+)\s+from\s*['"]\.\/([^'"]+)['"];?/g,
    (_, importName, path) => {
      const moduleName = pathToModuleName(path);
      return `const ${importName} = window.__MODULES__['${moduleName}'].default || window.__MODULES__['${moduleName}'];`;
    }
  );

  // Remove any remaining local imports
  transformed = transformed.replace(
    /^import\s+.*?from\s*['"]\..*?['"];?\s*$/gm,
    ''
  );

  return transformed;
}

// Convert file path to module name
function pathToModuleName(path: string): string {
  // Remove .tsx/.ts extension and normalize
  return path.replace(/\.(tsx?|ts)$/, '').replace(/^\.\//, '');
}

// Transform all imports (packages and local)
function transformImports(code: string): string {
  let transformed = transformPackageImports(code);
  transformed = transformLocalImports(transformed);

  // Remove any remaining unsupported imports
  transformed = transformed.replace(
    /^import\s+.*?from\s+['"].*?['"];?\s*$/gm,
    '// [Unsupported import removed]'
  );
  transformed = transformed.replace(/^import\s+['"].*?['"];?\s*$/gm, '');

  return transformed;
}

// Transform a module file to register in the global module registry
function transformModuleFile(code: string, filePath: string): string {
  if (!code) return '';

  let transformed = code;

  // Transform imports
  transformed = transformImports(transformed);

  // Get module name from path
  const moduleName = pathToModuleName(filePath);

  // Collect exports
  const exports: string[] = [];

  // Handle export default function Name
  const exportDefaultFunctionMatch = transformed.match(/export\s+default\s+function\s+(\w+)/);
  if (exportDefaultFunctionMatch) {
    const componentName = exportDefaultFunctionMatch[1];
    transformed = transformed.replace(/export\s+default\s+function/, 'function');
    exports.push(`default: ${componentName}`);
  }

  // Handle export default ComponentName
  const exportDefaultMatch = transformed.match(/export\s+default\s+(\w+)\s*;?\s*$/m);
  if (exportDefaultMatch && !exportDefaultFunctionMatch) {
    const componentName = exportDefaultMatch[1];
    transformed = transformed.replace(/export\s+default\s+\w+\s*;?\s*$/m, '');
    exports.push(`default: ${componentName}`);
  }

  // Handle named exports: export function Name or export const Name
  const namedExportMatches = transformed.matchAll(/export\s+(function|const|let|var)\s+(\w+)/g);
  for (const match of namedExportMatches) {
    exports.push(match[2]);
  }

  // Remove export keywords but keep the declarations
  transformed = transformed.replace(/^export\s+/gm, '');

  // Register module in global registry
  if (exports.length > 0) {
    const exportsObj = exports.map(e => {
      if (e.startsWith('default:')) {
        return e;
      }
      return `${e}: ${e}`;
    }).join(', ');
    transformed = transformed + `\n\nwindow.__MODULES__['${moduleName}'] = { ${exportsObj} };`;
  }

  return transformed.trim();
}

// Transform entry file for iframe execution
function transformEntryFile(code: string): string {
  if (!code) return '';

  let transformed = code;

  // Transform imports to use preloaded globals
  transformed = transformImports(transformed);

  // Handle export default function Name
  const exportDefaultFunctionMatch = transformed.match(/export\s+default\s+function\s+(\w+)/);
  if (exportDefaultFunctionMatch) {
    const componentName = exportDefaultFunctionMatch[1];
    transformed = transformed.replace(/export\s+default\s+function/, 'function');
    transformed = transformed + `\n\nReactDOM.createRoot(document.getElementById('root')).render(React.createElement(${componentName}));`;
  } else {
    // Handle export default ComponentName
    const exportDefaultMatch = transformed.match(/export\s+default\s+(\w+)\s*;?\s*$/m);
    if (exportDefaultMatch) {
      const componentName = exportDefaultMatch[1];
      transformed = transformed.replace(/export\s+default\s+\w+\s*;?\s*$/m, '');
      transformed = transformed + `\n\nReactDOM.createRoot(document.getElementById('root')).render(React.createElement(${componentName}));`;
    }
  }

  // Remove remaining export keywords
  transformed = transformed.replace(/^export\s+/gm, '');

  return transformed.trim();
}

// Legacy function for backward compatibility
function transformCode(code: string): string {
  return transformEntryFile(code);
}

// Extract CSS from CSS files
function extractCss(files: ProjectFile[]): string {
  return files
    .filter(f => f.fileType === 'css')
    .map(f => f.content)
    .join('\n\n');
}

// Generate the HTML document for the iframe with all module files
function generateIframeHtml(
  moduleCode: string[],
  entryCode: string,
  css: string,
  preloadBundle: string
): string {
  const safeCss = css.replace(/<\/style>/gi, '<\\/style>');
  const safeEntryJs = entryCode.replace(/<\/script>/gi, '<\\/script>');

  // Create separate script blocks for each module
  const moduleScripts = moduleCode.map((code, i) => {
    const safeCode = code.replace(/<\/script>/gi, '<\\/script>');
    return `
    // Module ${i + 1}
    try {
      ${safeCode}
    } catch (err) {
      console.error('Module ${i + 1} error:', err);
      reportErrorToParent('Module ${i + 1} error: ' + (err.message || err), err.stack);
    }`;
  }).join('\n');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <script src="https://cdn.tailwindcss.com"><\/script>
  <script>
    // Initialize module registry
    window.__MODULES__ = {};

    // Report error to parent window with full details
    function reportErrorToParent(message, stack, source, line, column) {
      if (window.parent !== window) {
        window.parent.postMessage({
          type: 'panel-error',
          message: String(message),
          source: source || undefined,
          line: line || undefined,
          column: column || undefined,
          stack: stack || undefined
        }, '*');
      }
    }

    // Global error handler - reports to parent window
    // Note: Cross-origin errors show as "Script error." - use try-catch for details
    window.onerror = function(msg, url, line, col, error) {
      var errorMsg = String(msg);
      var errorStack = error?.stack || undefined;

      // If we get "Script error." it means the error was from cross-origin
      // The actual error should have been caught by try-catch blocks
      if (errorMsg === 'Script error.' || errorMsg === 'Script error') {
        // Still show it but note it's a cross-origin error
        errorMsg = 'Script error (cross-origin - see try-catch for details)';
      }

      showError('Runtime Error: ' + errorMsg + (line ? ' (line ' + line + ')' : ''));
      reportErrorToParent(errorMsg, errorStack, url, line, col);
      return true;
    };

    window.onunhandledrejection = function(event) {
      var errorMsg = 'Unhandled Promise: ' + (event.reason?.message || event.reason);
      var errorStack = event.reason?.stack || undefined;
      showError(errorMsg);
      reportErrorToParent(errorMsg, errorStack);
    };

    function showError(message) {
      var container = document.getElementById('error-container');
      if (container) {
        container.innerHTML = '<div class="error-display">' + escapeHtml(message) + '</div>';
        container.style.display = 'block';
      }
    }

    function escapeHtml(text) {
      var div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }
  <\/script>
  <!-- Preloaded packages bundle -->
  <script>${preloadBundle}<\/script>
  <script src="https://unpkg.com/@babel/standalone/babel.min.js"><\/script>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; }
    .error-display {
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      border: 1px solid #ff6b6b;
      border-left: 4px solid #ff6b6b;
      color: #ff6b6b;
      padding: 16px;
      border-radius: 8px;
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', monospace;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-word;
      margin: 16px;
    }
    .error-display::before {
      content: 'Error';
      display: block;
      font-weight: bold;
      margin-bottom: 8px;
      color: #ff8a8a;
    }
    #error-container { display: none; }
    ${safeCss}
  </style>
</head>
<body>
  <div id="root"></div>
  <div id="error-container"></div>
  <script>
    // Wait for Babel to load, then transform and execute code manually
    // This allows us to catch both transformation and runtime errors
    function executeWithBabel() {
      // Destructure React hooks for convenience
      var useState = React.useState;
      var useEffect = React.useEffect;
      var useCallback = React.useCallback;
      var useMemo = React.useMemo;
      var useRef = React.useRef;
      var useContext = React.useContext;
      var useReducer = React.useReducer;
      var createContext = React.createContext;
      var forwardRef = React.forwardRef;
      var memo = React.memo;
      var lazy = React.lazy;
      var Suspense = React.Suspense;
      var Fragment = React.Fragment;

      // Framer motion shortcuts
      var motion = window.FramerMotion ? window.FramerMotion.motion : undefined;
      var AnimatePresence = window.FramerMotion ? window.FramerMotion.AnimatePresence : undefined;

      // Error boundary - catches React render errors
      class ErrorBoundary extends React.Component {
        constructor(props) {
          super(props);
          this.state = { hasError: false, error: null };
        }
        static getDerivedStateFromError(error) {
          return { hasError: true, error };
        }
        componentDidCatch(error, errorInfo) {
          var errorMsg = 'React Render Error: ' + (error.message || String(error));
          var errorStack = error.stack || (errorInfo ? errorInfo.componentStack : undefined);
          reportErrorToParent(errorMsg, errorStack);
        }
        render() {
          if (this.state.hasError) {
            return React.createElement('div', { className: 'error-display' },
              this.state.error?.message || String(this.state.error)
            );
          }
          return this.props.children;
        }
      }
      window.ErrorBoundary = ErrorBoundary;

      // Transform and execute code with error handling
      function transformAndExecute(code, name) {
        try {
          var transformed = Babel.transform(code, {
            presets: ['react', 'typescript'],
            filename: name + '.tsx'
          });
          eval(transformed.code);
        } catch (err) {
          var errorMsg = name + ' error: ' + (err.message || String(err));
          console.error(errorMsg, err);
          reportErrorToParent(errorMsg, err.stack);
          showError(errorMsg);
          throw err; // Re-throw to stop execution
        }
      }

      // Module code
      var moduleCode = ${JSON.stringify(moduleCode)};

      // Execute modules
      for (var i = 0; i < moduleCode.length; i++) {
        if (moduleCode[i].trim()) {
          transformAndExecute(moduleCode[i], 'Module ' + (i + 1));
        }
      }

      // Entry file code
      var entryCode = ${JSON.stringify(entryCode)};

      // Execute entry file
      if (entryCode.trim()) {
        transformAndExecute(entryCode, 'Entry file');
      }
    }

    // Run after DOM is ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', executeWithBabel);
    } else {
      executeWithBabel();
    }
  <\/script>
</body>
</html>`;
}

// LivePreview component
export function LivePreview({ entryFile, allFiles, isLoading, previewMode = 'desktop', ideaId }: LivePreviewProps): ReactElement {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeKey, setIframeKey] = useState(0);
  const [preloadBundle, setPreloadBundle] = useState<string | null>(null);
  const [preloadError, setPreloadError] = useState<string | null>(null);

  // Listen for error messages from the iframe
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      // Only handle panel-error messages
      if (event.data?.type !== 'panel-error') return;

      const { message, source, line, column, stack } = event.data;

      // Report the error to the main process for logging and AI feedback
      window.electronAPI.panelErrors.report(
        ideaId,
        message,
        source,
        line,
        column,
        stack
      ).catch((err) => {
        console.error('[LivePreview] Failed to report panel error:', err);
      });
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [ideaId]);

  // Clear previous errors when files change (new render attempt)
  useEffect(() => {
    if (entryFile) {
      window.electronAPI.panelErrors.clear(ideaId).catch(() => {});
    }
  }, [entryFile, allFiles, ideaId]);

  // Load the preload bundle on mount
  useEffect(() => {
    async function loadPreloadBundle() {
      try {
        const result = await window.electronAPI.sandbox.getPreload();
        if (result.success && result.content) {
          setPreloadBundle(result.content);
          setPreloadError(null);
        } else {
          setPreloadError(result.error || 'Failed to load sandbox preload bundle');
        }
      } catch (error) {
        setPreloadError(error instanceof Error ? error.message : 'Unknown error loading preload');
      }
    }
    loadPreloadBundle();
  }, []);

  // Generate iframe content when files or preload bundle change
  useEffect(() => {
    if (!entryFile || !preloadBundle) return;

    // Get non-entry TSX/TS files (modules)
    const moduleFiles = allFiles.filter(f =>
      !f.isEntryFile &&
      (f.fileType === 'tsx' || f.fileType === 'ts')
    );

    // Transform module files
    const moduleCode = moduleFiles.map(f => transformModuleFile(f.content, f.filePath));

    // Transform entry file
    const entryCode = transformEntryFile(entryFile.content);

    // Extract CSS
    const css = extractCss(allFiles);

    // Generate HTML with all modules
    const html = generateIframeHtml(moduleCode, entryCode, css, preloadBundle);

    if (iframeRef.current) {
      iframeRef.current.srcdoc = html;
    }

    setIframeKey(k => k + 1);
  }, [entryFile, allFiles, preloadBundle]);

  // Show loading state
  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-blue-300/60">
        <svg className="w-8 h-8 animate-spin text-sky-400 mb-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>Building preview...</span>
      </div>
    );
  }

  // Show preload bundle loading state
  if (!preloadBundle && !preloadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-blue-300/60">
        <svg className="w-8 h-8 animate-spin text-sky-400 mb-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>Loading packages...</span>
      </div>
    );
  }

  // Show preload error
  if (preloadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-red-400/80 p-4">
        <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <span className="font-medium mb-1">Failed to load packages</span>
        <span className="text-sm text-red-400/60 text-center">{preloadError}</span>
      </div>
    );
  }

  // Show empty state if no entry file
  if (!entryFile) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-blue-300/60">
        <svg className="w-12 h-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
        </svg>
        <span>No app to preview</span>
        <span className="text-sm mt-1 text-blue-300/40">Ask the AI to build something</span>
      </div>
    );
  }

  // Get non-entry TSX/TS files (modules)
  const moduleFiles = allFiles.filter(f =>
    !f.isEntryFile &&
    (f.fileType === 'tsx' || f.fileType === 'ts')
  );

  // Transform module files
  const moduleCode = moduleFiles.map(f => transformModuleFile(f.content, f.filePath));

  // Transform entry file
  const entryCode = transformEntryFile(entryFile.content);

  // Extract CSS
  const css = extractCss(allFiles);

  // Generate HTML with all modules
  // preloadBundle is guaranteed to be non-null here due to early returns above
  const html = generateIframeHtml(moduleCode, entryCode, css, preloadBundle!);

  // Phone mode: constrained to phone dimensions, centered
  if (previewMode === 'phone') {
    return (
      <div className="h-full flex items-center justify-center bg-[#0a1628] rounded-lg">
        <div
          className="relative rounded-[2rem] border-4 border-gray-800 bg-gray-900 shadow-xl overflow-hidden"
          style={{ width: PHONE_WIDTH + 24, height: PHONE_HEIGHT + 48 }}
        >
          {/* Phone notch */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-24 h-6 bg-gray-800 rounded-b-xl z-10" />
          {/* Phone screen */}
          <div className="absolute inset-3 top-6 bottom-6 rounded-lg overflow-hidden">
            <iframe
              key={iframeKey}
              ref={iframeRef}
              srcDoc={html}
              className="w-full h-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin"
              title="App Preview"
            />
          </div>
          {/* Home indicator */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-32 h-1 bg-gray-600 rounded-full" />
        </div>
      </div>
    );
  }

  // Desktop/fullscreen mode: fills available space
  return (
    <div className="h-full flex flex-col">
      <iframe
        key={iframeKey}
        ref={iframeRef}
        srcDoc={html}
        className="flex-1 w-full border-0 rounded-lg bg-white"
        sandbox="allow-scripts allow-same-origin"
        title="App Preview"
      />
    </div>
  );
}
