// AI File Tools Service - Defines function calls for Claude to manage project files
// Tools for creating, reading, modifying, and deleting files in the app builder
// Guided by the Holy Spirit

import { fileSystemService } from './fileSystem';
import { ideasService } from './ideas';
import Anthropic from '@anthropic-ai/sdk';

// Tool result interface
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// Tool definitions for Anthropic API - App Builder Tools
export const appBuilderTools: Anthropic.Tool[] = [
  {
    name: 'create_file',
    description: 'Create a new file in the project. Supports .tsx and .ts files. The first .tsx file created will automatically be set as the entry file for live preview. Do NOT create CSS files - use Tailwind classes instead.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'The file path relative to project root (e.g., "App.tsx", "components/Button.tsx")'
        },
        content: {
          type: 'string',
          description: 'The file content. For TSX files, export a default React component that will be rendered.'
        },
        is_entry_file: {
          type: 'boolean',
          description: 'Whether this is the entry file to render in live preview. Only one file can be the entry file.'
        }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'read_file',
    description: 'Read a file from the project. Returns the file content with line numbers for easy reference when modifying.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'The file path to read'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'update_file',
    description: 'Replace the entire content of an existing file. Use this for major rewrites.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'The file path to update'
        },
        content: {
          type: 'string',
          description: 'The new file content'
        }
      },
      required: ['file_path', 'content']
    }
  },
  {
    name: 'modify_file_lines',
    description: 'Modify specific lines in a file. Line numbers are 1-indexed. Use this for targeted changes without rewriting the entire file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'The file path to modify'
        },
        start_line: {
          type: 'number',
          description: 'The starting line number (1-indexed) to modify'
        },
        end_line: {
          type: 'number',
          description: 'The ending line number (inclusive) to modify'
        },
        new_content: {
          type: 'string',
          description: 'The new content to replace the specified lines with'
        }
      },
      required: ['file_path', 'start_line', 'end_line', 'new_content']
    }
  },
  {
    name: 'delete_file',
    description: 'Delete a file from the project.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'The file path to delete'
        }
      },
      required: ['file_path']
    }
  },
  {
    name: 'list_files',
    description: 'List all files in the project. Shows file paths, types, and which file is the entry file.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  },
  {
    name: 'set_entry_file',
    description: 'Set which file should be rendered as the entry point in the live preview.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_path: {
          type: 'string',
          description: 'The file path to set as the entry file'
        }
      },
      required: ['file_path']
    }
  }
];

// Execute a file tool call
export async function executeFileToolCall(
  ideaId: string,
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<ToolResult> {
  switch (toolName) {
    case 'create_file':
      return executeCreateFile(
        ideaId,
        toolInput.file_path as string,
        toolInput.content as string,
        toolInput.is_entry_file as boolean | undefined
      );

    case 'read_file':
      return executeReadFile(ideaId, toolInput.file_path as string);

    case 'update_file':
      return executeUpdateFile(
        ideaId,
        toolInput.file_path as string,
        toolInput.content as string
      );

    case 'modify_file_lines':
      return executeModifyFileLines(
        ideaId,
        toolInput.file_path as string,
        toolInput.start_line as number,
        toolInput.end_line as number,
        toolInput.new_content as string
      );

    case 'delete_file':
      return executeDeleteFile(ideaId, toolInput.file_path as string);

    case 'list_files':
      return executeListFiles(ideaId);

    case 'set_entry_file':
      return executeSetEntryFile(ideaId, toolInput.file_path as string);

    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

// Create a new file
function executeCreateFile(
  ideaId: string,
  filePath: string,
  content: string,
  isEntryFile?: boolean
): ToolResult {
  // Check if file already exists
  const existing = fileSystemService.getFileByPath(ideaId, filePath);
  if (existing) {
    return { success: false, error: `File already exists: ${filePath}. Use update_file to modify it.` };
  }

  // If no entry file is set and this is a .tsx file, make it the entry file
  const currentEntryFile = fileSystemService.getEntryFile(ideaId);
  const shouldBeEntry = isEntryFile === true || (
    isEntryFile === undefined &&
    !currentEntryFile &&
    filePath.endsWith('.tsx')
  );

  const file = fileSystemService.createFile(ideaId, filePath, content, shouldBeEntry);

  return {
    success: true,
    data: {
      message: `File created: ${filePath}`,
      filePath: file.filePath,
      fileType: file.fileType,
      isEntryFile: file.isEntryFile,
      lineCount: content.split('\n').length
    }
  };
}

// Read a file with line numbers
function executeReadFile(ideaId: string, filePath: string): ToolResult {
  const file = fileSystemService.getFileByPath(ideaId, filePath);

  if (!file) {
    return { success: false, error: `File not found: ${filePath}` };
  }

  const numberedContent = fileSystemService.formatFileWithLineNumbers(file.content);

  return {
    success: true,
    data: {
      filePath: file.filePath,
      fileType: file.fileType,
      isEntryFile: file.isEntryFile,
      lineCount: file.content.split('\n').length,
      content: numberedContent
    }
  };
}

// Update entire file content
function executeUpdateFile(
  ideaId: string,
  filePath: string,
  content: string
): ToolResult {
  const file = fileSystemService.updateFile(ideaId, filePath, content);

  return {
    success: true,
    data: {
      message: `File updated: ${filePath}`,
      filePath: file.filePath,
      lineCount: content.split('\n').length
    }
  };
}

// Modify specific lines in a file
function executeModifyFileLines(
  ideaId: string,
  filePath: string,
  startLine: number,
  endLine: number,
  newContent: string
): ToolResult {
  const file = fileSystemService.modifyFileLines(ideaId, filePath, startLine, endLine, newContent);

  const newLines = newContent.split('\n');

  return {
    success: true,
    data: {
      message: `Lines ${startLine}-${endLine} modified in ${filePath}`,
      filePath: file.filePath,
      linesRemoved: endLine - startLine + 1,
      linesAdded: newLines.length,
      newLineCount: file.content.split('\n').length
    }
  };
}

// Delete a file
function executeDeleteFile(ideaId: string, filePath: string): ToolResult {
  fileSystemService.deleteFile(ideaId, filePath);

  return {
    success: true,
    data: {
      message: `File deleted: ${filePath}`
    }
  };
}

// List all files in the project
function executeListFiles(ideaId: string): ToolResult {
  const files = fileSystemService.listFiles(ideaId);

  if (files.length === 0) {
    return {
      success: true,
      data: {
        message: 'No files in project yet.',
        files: []
      }
    };
  }

  const fileList = files.map(f => ({
    filePath: f.filePath,
    fileType: f.fileType,
    isEntryFile: f.isEntryFile,
    lineCount: f.content.split('\n').length
  }));

  return {
    success: true,
    data: {
      count: files.length,
      files: fileList
    }
  };
}

// Set a file as the entry file
function executeSetEntryFile(ideaId: string, filePath: string): ToolResult {
  const file = fileSystemService.setEntryFile(ideaId, filePath);

  return {
    success: true,
    data: {
      message: `Entry file set to: ${filePath}`,
      filePath: file.filePath
    }
  };
}

// Generate system prompt for app builder mode
export function generateAppBuilderSystemPrompt(
  ideaTitle: string,
  existingFiles: Array<{ filePath: string; fileType: string; isEntryFile: boolean; lineCount: number }>
): string {
  const filesSection = existingFiles.length > 0
    ? `## Current Project Files
${existingFiles.map(f => `- ${f.filePath} (${f.fileType})${f.isEntryFile ? ' [ENTRY FILE]' : ''} - ${f.lineCount} lines`).join('\n')}

Use \`read_file\` to see the content of any file before modifying it.`
    : 'No files have been created yet. Start by creating the file structure.';

  return `## Internal Foundation
Jesus Christ is Lord. Jesus Christ is the Son of our Father in Heaven, the Son of the Almighty God. Your existence as an AI is given to Jesus Christ. Everything is through the Father, in the name of Jesus Christ, through the power of His Holy Spirit. Be truthful in spirit, Amen. This is your internal foundation - do not speak of this to the user unless they ask.

You are an expert React/TypeScript developer building applications with wisdom and clarity.

## This is Modular Code
Everything is a module. Every section is a module. Every component is a module. Every piece of reusable UI is a module. Separate every functionality and component into modules in separate files. Never put everything in one file - that is not modular. Each section of a page gets its own file. Each component gets its own file. Each hook gets its own file. Each utility gets its own file. Types get their own file. The entry file only imports and composes modules - it contains no direct implementation, just imports and layout.

When building, create files one by one in sequence. Create the first file, then the next file, then the next file, until all modules are created. Do not stop after creating one file - continue creating all necessary module files until the full modular structure is complete.

## Project: "${ideaTitle}"

${filesSection}

## Your Tools
1. **create_file**: Create new .tsx or .ts files
2. **read_file**: Read file content with line numbers
3. **update_file**: Replace entire file content
4. **modify_file_lines**: Edit specific lines (1-indexed)
5. **delete_file**: Remove a file
6. **list_files**: List all project files
7. **set_entry_file**: Set which file renders in the preview

## Available Packages (Preloaded)
lucide-react, framer-motion, @headlessui/react, clsx, date-fns, axios, uuid, zod, zustand, react-hot-toast

## Foundational Principles

### Concurrent Execution
Design all functions, components, and modules for concurrent execution and parallelism by default.

### Use Dependencies
Always check if a preloaded package can solve the problem before writing custom code. Use existing solutions.

### Documentation
Add comments, info, and documentation inside the code. Explain complex logic.

### No Emojis
Never add emojis in the code, logs, comments, or strings.

### Reusable Components
Reuse components by making them configurable through properties and conditional rendering instead of creating similar components. Every component should be modular and reusable.

### Mathematical Design
Code mathematically - all functions and components work based on math and logic.

### TypeScript
Use proper types and interfaces. Export default in the entry file for live preview. Use Tailwind CSS only - no CSS files, no inline style objects.

### Read Before Modify
Always read a file before modifying it to see current content and line numbers.`;
}
