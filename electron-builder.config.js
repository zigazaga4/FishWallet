// Electron Builder Configuration
// Guided by the Holy Spirit

/**
 * @type {import('electron-builder').Configuration}
 */
const config = {
  appId: 'com.fishwallet.app',
  productName: 'FishWallet',

  // Directories configuration
  directories: {
    output: 'release',
    buildResources: 'build-resources'
  },

  // Files to include in the app
  // Be careful: don't exclude folders that exist inside node_modules
  files: [
    '**/*',
    '!release/**',
    '!src/**',
    '!resources/**',
    '!build-resources/**',
    '!scripts/**',
    '!logs/**',
    '!**/*.ts',
    '!**/*.tsx',
    '!**/*.map',
    '!tsconfig*.json',
    '!vite*.config.*',
    '!tailwind.config.*',
    '!electron-builder.config.js',
    '!**/node_modules/*/{CHANGELOG.md,README.md,README,readme.md,readme}',
    '!**/node_modules/*/{test,__tests__,tests,powered-test,example,examples}',
    '!**/node_modules/**/*.d.ts',
    '!**/node_modules/.bin'
  ],

  // Extra resources to bundle (MCP server)
  extraResources: [
    {
      from: 'resources/firecrawl-mcp-server',
      to: 'firecrawl-mcp-server',
      filter: ['**/*']
    }
  ],

  // ASAR packaging disabled - @anthropic-ai/sdk has dynamic requires that don't work with ASAR
  // TODO: Re-enable ASAR once module issues are resolved
  asar: false,

  // Linux configuration
  linux: {
    target: [
      {
        target: 'AppImage',
        arch: ['x64']
      },
      {
        target: 'deb',
        arch: ['x64']
      }
    ],
    category: 'Utility',
    maintainer: 'FishWallet Team'
    // icon: 'build-resources/icon.png' // Add icon later
  },

  // Windows configuration
  win: {
    target: [
      {
        target: 'nsis',
        arch: ['x64']
      }
    ]
    // icon: 'build-resources/icon.ico' // Add icon later
  },

  // NSIS installer configuration for Windows
  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true
    // installerIcon: 'build-resources/icon.ico', // Add icons later
    // uninstallerIcon: 'build-resources/icon.ico'
  },

  // macOS configuration
  // Note: Build macOS on actual macOS (dmg-license requires darwin)
  mac: {
    target: [
      {
        target: 'dmg',
        arch: ['x64', 'arm64']
      }
    ],
    category: 'public.app-category.utilities'
    // icon: 'build-resources/icon.icns' // Add icon later
  },

  // DMG configuration for macOS
  dmg: {
    contents: [
      {
        x: 130,
        y: 220
      },
      {
        x: 410,
        y: 220,
        type: 'link',
        path: '/Applications'
      }
    ]
  },

  // Native module handling for cross-compilation
  // better-sqlite3 has prebuilt binaries via prebuild-install
  // These settings ensure prebuilds are downloaded for the target platform
  npmRebuild: true,              // Run npm rebuild to trigger prebuild-install
  buildDependenciesFromSource: false,  // Use prebuilt binaries, don't compile
  nodeGypRebuild: false,         // Don't use node-gyp (would compile from source)

  // Publish configuration (disabled for now)
  publish: null
};

module.exports = config;
