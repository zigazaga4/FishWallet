// AI Tools Service - Defines function calls for Claude to modify ideas and build apps
// All tools are always available
// Guided by the Holy Spirit

import { ideasService } from './ideas';
import { fileSystemService } from './fileSystem';
import { mcpClientService } from './mcpClient';
import { logger } from './logger';
import Anthropic from '@anthropic-ai/sdk';

// Firecrawl search result interface for internal use
export interface FirecrawlSearchResult {
  title: string;
  url: string;
  snippet: string;
  markdown?: string;
}

// Firecrawl search tool - replaces Anthropic's native web search
// Returns actual page content (markdown) instead of encrypted content
const firecrawlSearchTool: Anthropic.Tool = {
  name: 'firecrawl_search',
  description: 'Search the internet using Firecrawl. Returns search results with full page content in markdown format. Use this when you need to research APIs, documentation, or any web information. Results include the actual page content, not just titles and URLs.',
  input_schema: {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'The search query (e.g., "Stripe API documentation", "best payment APIs 2025")'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default: 5, max: 10)'
      },
      scrape_content: {
        type: 'boolean',
        description: 'Whether to scrape and return the full page content in markdown (default: true)'
      }
    },
    required: ['query']
  }
};

// Firecrawl scrape tool - for deep diving into specific URLs
const firecrawlScrapeTool: Anthropic.Tool = {
  name: 'firecrawl_scrape',
  description: 'Scrape a specific URL and get its content in markdown format. Use this when you need to get detailed information from a specific page, like documentation pages, API references, or articles.',
  input_schema: {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'The URL to scrape (e.g., "https://supabase.com/docs/guides/auth")'
      },
      only_main_content: {
        type: 'boolean',
        description: 'Whether to extract only the main content, excluding headers, footers, nav (default: true)'
      }
    },
    required: ['url']
  }
};

// Firecrawl map tool - for discovering URLs on a website
const firecrawlMapTool: Anthropic.Tool = {
  name: 'firecrawl_map',
  description: 'Discover and list all URLs on a website. Use this to explore documentation structure or find relevant pages before scraping. Returns a list of URLs found on the site.',
  input_schema: {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'The base URL to map (e.g., "https://supabase.com/docs")'
      },
      search: {
        type: 'string',
        description: 'Optional search term to filter URLs (e.g., "auth" to find auth-related pages)'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of URLs to return (default: 50)'
      }
    },
    required: ['url']
  }
};

// Import dependencyNodeTools lazily to avoid circular dependency
let _dependencyNodeTools: Anthropic.Tool[] | null = null;
function getDependencyNodeTools(): Anthropic.Tool[] {
  if (!_dependencyNodeTools) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _dependencyNodeTools = require('./aiNodeTools').dependencyNodeTools;
  }
  return _dependencyNodeTools!;
}

// Tool definitions for Anthropic API - All tools always available
export const ideaSynthesisTools: Anthropic.Tool[] = [
  // === NOTE PROPOSAL TOOL ===
  {
    name: 'propose_note',
    description: 'Capture a quick thought or insight. Think of notes like mental bookmarks - the kind of thing you would say out loud when brainstorming: "We should use Stripe for this", "Mapbox could handle the 3D rendering", "The auth needs to happen before the API call". Notes are for capturing the essence of a decision or finding, not for explaining it in detail.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'A quick label - just enough to know what this is about (e.g., "Stripe for payments", "Use Mapbox", "Auth flow")'
        },
        content: {
          type: 'string',
          description: 'Write like you are thinking out loud. One or two sentences max. Plain text only - no markdown, no formatting, no headers, no bullet points, no asterisks, no bold, no links. Just the thought itself as natural spoken language.'
        },
        category: {
          type: 'string',
          enum: ['research', 'decision', 'recommendation', 'insight', 'warning', 'todo'],
          description: 'The category of the note to help organize it'
        }
      },
      required: ['title', 'content', 'category']
    }
  },
  // === SYNTHESIS TOOLS ===
  {
    name: 'read_notes',
    description: 'Fetch and read all the voice notes for the current idea. Use this to get the latest notes when the user mentions they have added new notes or when you need to re-synthesize the idea.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  },
  {
    name: 'update_synthesis',
    description: 'Replace the entire synthesis content with new content. Use this for major rewrites or initial synthesis. The content should be well-structured with clear sections and numbered lines for easy reference.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'The new synthesis content. Should be structured with clear headings and sections. Each major point should be on its own line for easy reference.'
        }
      },
      required: ['content']
    }
  },
  {
    name: 'modify_synthesis_lines',
    description: 'Modify specific lines in the synthesis. Use this for targeted changes without rewriting everything. Line numbers are 1-indexed.',
    input_schema: {
      type: 'object' as const,
      properties: {
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
      required: ['start_line', 'end_line', 'new_content']
    }
  },
  {
    name: 'add_to_synthesis',
    description: 'Add new content to the synthesis at a specific position. Use this to expand the idea with new sections or details.',
    input_schema: {
      type: 'object' as const,
      properties: {
        after_line: {
          type: 'number',
          description: 'Insert the new content after this line number. Use 0 to insert at the beginning.'
        },
        content: {
          type: 'string',
          description: 'The content to add'
        }
      },
      required: ['after_line', 'content']
    }
  },
  {
    name: 'remove_from_synthesis',
    description: 'Remove specific lines from the synthesis. Use this to delete outdated or unwanted sections.',
    input_schema: {
      type: 'object' as const,
      properties: {
        start_line: {
          type: 'number',
          description: 'The starting line number (1-indexed) to remove'
        },
        end_line: {
          type: 'number',
          description: 'The ending line number (inclusive) to remove'
        }
      },
      required: ['start_line', 'end_line']
    }
  },
  // === APP BUILDER TOOLS ===
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

// Tool execution results
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// Proposed note structure for UI display
export interface ProposedNote {
  id: string;
  title: string;
  content: string;
  category: 'research' | 'decision' | 'recommendation' | 'insight' | 'warning' | 'todo';
  ideaId: string;
}

// Execute a tool call - handles both synthesis and app builder tools
export async function executeToolCall(
  ideaId: string,
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<ToolResult> {
  switch (toolName) {
    // === NOTE PROPOSAL ===
    case 'propose_note':
      return executeProposeNote(
        ideaId,
        toolInput.title as string,
        toolInput.content as string,
        toolInput.category as ProposedNote['category']
      );

    // === SYNTHESIS TOOLS ===
    case 'read_notes':
      return executeReadNotes(ideaId);

    case 'update_synthesis':
      return executeUpdateSynthesis(ideaId, toolInput.content as string);

    case 'modify_synthesis_lines':
      return executeModifySynthesisLines(
        ideaId,
        toolInput.start_line as number,
        toolInput.end_line as number,
        toolInput.new_content as string
      );

    case 'add_to_synthesis':
      return executeAddToSynthesis(
        ideaId,
        toolInput.after_line as number,
        toolInput.content as string
      );

    case 'remove_from_synthesis':
      return executeRemoveFromSynthesis(
        ideaId,
        toolInput.start_line as number,
        toolInput.end_line as number
      );

    // === APP BUILDER TOOLS ===
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

    // === FIRECRAWL TOOLS ===
    case 'firecrawl_search':
      return executeFirecrawlSearch(
        toolInput.query as string,
        toolInput.limit as number | undefined,
        toolInput.scrape_content as boolean | undefined
      );

    case 'firecrawl_scrape':
      return executeFirecrawlScrape(
        toolInput.url as string,
        toolInput.only_main_content as boolean | undefined
      );

    case 'firecrawl_map':
      return executeFirecrawlMap(
        toolInput.url as string,
        toolInput.search as string | undefined,
        toolInput.limit as number | undefined
      );

    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

// Propose a note - returns proposal data for user approval
function executeProposeNote(
  ideaId: string,
  title: string,
  content: string,
  category: ProposedNote['category']
): ToolResult {
  // Generate a unique ID for this proposal
  const proposalId = `proposal-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  return {
    success: true,
    data: {
      type: 'note_proposal',
      proposal: {
        id: proposalId,
        title,
        content,
        category,
        ideaId
      } as ProposedNote,
      message: `Proposed note: "${title}". Waiting for user approval.`
    }
  };
}

// Read all notes for an idea
function executeReadNotes(ideaId: string): ToolResult {
  const notes = ideasService.getNotes(ideaId);

  if (notes.length === 0) {
    return {
      success: true,
      data: {
        message: 'No notes found for this idea.',
        notes: []
      }
    };
  }

  // Format notes with timestamps
  const formattedNotes = notes.map((note, index) => ({
    index: index + 1,
    content: note.content,
    timestamp: new Date(note.createdAt).toLocaleString(),
    durationMs: note.durationMs
  }));

  return {
    success: true,
    data: {
      count: notes.length,
      notes: formattedNotes
    }
  };
}

// Update the entire synthesis
function executeUpdateSynthesis(ideaId: string, content: string): ToolResult {
  ideasService.updateSynthesis(ideaId, content);

  // Add line numbers for reference
  const lines = content.split('\n');
  const numberedContent = lines.map((line, i) => `${i + 1}: ${line}`).join('\n');

  return {
    success: true,
    data: {
      message: 'Synthesis updated successfully.',
      lineCount: lines.length,
      preview: numberedContent.slice(0, 500) + (numberedContent.length > 500 ? '...' : '')
    }
  };
}

// Modify specific lines in the synthesis
function executeModifySynthesisLines(
  ideaId: string,
  startLine: number,
  endLine: number,
  newContent: string
): ToolResult {
  const idea = ideasService.getIdea(ideaId);

  if (!idea || !idea.synthesisContent) {
    return { success: false, error: 'No synthesis exists to modify.' };
  }

  const lines = idea.synthesisContent.split('\n');

  // Validate line numbers
  if (startLine < 1 || endLine > lines.length || startLine > endLine) {
    return {
      success: false,
      error: `Invalid line range. Synthesis has ${lines.length} lines.`
    };
  }

  // Replace the lines
  const newLines = newContent.split('\n');
  lines.splice(startLine - 1, endLine - startLine + 1, ...newLines);

  const updatedContent = lines.join('\n');
  ideasService.updateSynthesis(ideaId, updatedContent);

  return {
    success: true,
    data: {
      message: `Lines ${startLine}-${endLine} modified successfully.`,
      linesRemoved: endLine - startLine + 1,
      linesAdded: newLines.length,
      newLineCount: lines.length
    }
  };
}

// Add content to the synthesis
function executeAddToSynthesis(
  ideaId: string,
  afterLine: number,
  content: string
): ToolResult {
  const idea = ideasService.getIdea(ideaId);

  if (!idea || !idea.synthesisContent) {
    // If no synthesis exists, create one
    ideasService.updateSynthesis(ideaId, content);
    return {
      success: true,
      data: {
        message: 'Created new synthesis with the provided content.',
        lineCount: content.split('\n').length
      }
    };
  }

  const lines = idea.synthesisContent.split('\n');

  // Validate position
  if (afterLine < 0 || afterLine > lines.length) {
    return {
      success: false,
      error: `Invalid position. Synthesis has ${lines.length} lines.`
    };
  }

  // Insert the new content
  const newLines = content.split('\n');
  lines.splice(afterLine, 0, ...newLines);

  const updatedContent = lines.join('\n');
  ideasService.updateSynthesis(ideaId, updatedContent);

  return {
    success: true,
    data: {
      message: `Added ${newLines.length} lines after line ${afterLine}.`,
      newLineCount: lines.length
    }
  };
}

// Remove lines from the synthesis
function executeRemoveFromSynthesis(
  ideaId: string,
  startLine: number,
  endLine: number
): ToolResult {
  const idea = ideasService.getIdea(ideaId);

  if (!idea || !idea.synthesisContent) {
    return { success: false, error: 'No synthesis exists to modify.' };
  }

  const lines = idea.synthesisContent.split('\n');

  // Validate line numbers
  if (startLine < 1 || endLine > lines.length || startLine > endLine) {
    return {
      success: false,
      error: `Invalid line range. Synthesis has ${lines.length} lines.`
    };
  }

  // Remove the lines
  const removedCount = endLine - startLine + 1;
  lines.splice(startLine - 1, removedCount);

  const updatedContent = lines.join('\n');
  ideasService.updateSynthesis(ideaId, updatedContent);

  return {
    success: true,
    data: {
      message: `Removed lines ${startLine}-${endLine} (${removedCount} lines).`,
      newLineCount: lines.length
    }
  };
}

// Format synthesis content with line numbers for display in system prompt
export function formatSynthesisWithLineNumbers(content: string): string {
  if (!content) return '';

  const lines = content.split('\n');
  return lines.map((line, i) => `${(i + 1).toString().padStart(3, ' ')} | ${line}`).join('\n');
}

// Generate system prompt with the current synthesis
export function generateSynthesisSystemPrompt(
  ideaTitle: string,
  synthesisContent: string | null
): string {
  const synthesisSection = synthesisContent
    ? `## Current Synthesized Idea (with line numbers for reference)
\`\`\`
${formatSynthesisWithLineNumbers(synthesisContent)}
\`\`\`

You can modify this synthesis using the available tools:
- \`update_synthesis\`: Replace the entire synthesis
- \`modify_synthesis_lines\`: Change specific lines
- \`add_to_synthesis\`: Add new content at a position
- \`remove_from_synthesis\`: Remove specific lines`
    : 'No synthesis has been created yet. Use the notes to create an initial synthesis.';

  return `## Idea: "${ideaTitle}"

${synthesisSection}

## Language

Always respond in Romanian. This is the default language for all conversations. Only switch to English if the user writes their entire message in English. If the user mixes languages or writes partially in Romanian, continue responding in Romanian.

## Who You Are

You are helping someone bring their idea to life. They have a vision - something they want to build, create, make real. Your purpose is to help them see it clearly, organize it, research what's needed, and build it piece by piece.

## How to Think

When they share their idea, think: "What does this person need to make this real?"

They might need clarity - help them synthesize and organize their thoughts into something structured.

They might need knowledge - research documentation, services, data sources, technologies, anything that would help their idea become possible.

They might need to see it - build the frontend visually so they can touch and feel their idea taking shape.

They might need architecture - map out what services, APIs, and systems connect together to make it work.

Think about what they're truly trying to accomplish. Think about what would genuinely help them move forward.

But here is the key: when they ask you to do something specific, do that thing. Don't jump ahead. Don't assume the next step. Complete what they asked, share what you did, and ask what they'd like to do next. Let them guide the journey - it's their idea.

## Your Tools

**Research:** \`firecrawl_search\`, \`firecrawl_scrape\`, \`firecrawl_map\`
- Search and scrape for any documentation, guides, services, data sources - anything that helps make their idea possible

**Notes:** \`propose_note\` (ONLY when user explicitly asks to save/remember something)
- This tool is ONLY for when the user explicitly requests to save or remember something
- Never use propose_note proactively or to suggest things to save - only when user says "save this", "remember this", "create a note", etc.

**Synthesis:** \`read_notes\`, \`update_synthesis\`, \`modify_synthesis_lines\`, \`add_to_synthesis\`, \`remove_from_synthesis\`
- Help organize and refine their idea into clear, structured documentation

**App Builder:** \`create_file\`, \`read_file\`, \`update_file\`, \`modify_file_lines\`, \`delete_file\`, \`list_files\`, \`set_entry_file\`
- Build the frontend visually so they can see their idea come to life
- Packages: react, lucide-react, framer-motion, @headlessui/react, clsx, date-fns, axios, uuid, zod, zustand, react-hot-toast, three
- Use Tailwind CSS, clean React/TypeScript with default exports

**API Nodes:** \`create_api_node\`, \`update_api_node\`, \`delete_api_node\`, \`connect_nodes\`, \`disconnect_nodes\`, \`read_api_nodes\`
- Visualize the architecture - what services and systems connect together
- When connecting, use the real UUIDs returned from creation - never invent IDs

## Critical Rule: Wait for Explicit Instructions

**NEVER start any of these actions on your own - wait for the user to explicitly ask:**
- Do NOT create or update the synthesis unless the user explicitly asks you to synthesize, organize, or document their idea
- Do NOT create app files or build UI unless the user explicitly asks you to build, create an app, or show them something visually
- Do NOT create dependency/API nodes unless the user explicitly asks you to map architecture or show connections
- **NEVER use propose_note unless the user explicitly says "save this", "remember this", "create a note", "add a note" or similar explicit requests to save information. Do NOT propose notes proactively - ever.**

When the conversation starts or the user sends a message, **just read and respond to what they said**. Have a conversation. Ask clarifying questions if needed. Do NOT assume they want you to build, synthesize, or research anything.

If they just want to chat about their idea, do that. Only use tools when they clearly ask for an action like "build this", "create an app", "synthesize my idea", "research this", "save this as a note", etc.

## What Not to Do

- Don't do multiple things when they asked for one thing
- Don't assume what they want next
- Don't invent information or IDs
- Don't make decisions for them
- Don't automatically start synthesizing, building, or researching without being asked
- Don't use tools proactively - wait for explicit requests
- **NEVER use propose_note unless user explicitly asks to save/remember something**

Complete what they asked. Share what you did. Ask what's next.`;
}

// === APP BUILDER TOOL EXECUTION FUNCTIONS ===

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

// === FIRECRAWL TOOL EXECUTION FUNCTIONS ===

// Execute Firecrawl search
async function executeFirecrawlSearch(
  query: string,
  limit?: number,
  scrapeContent?: boolean
): Promise<ToolResult> {
  logger.info('[Firecrawl] Executing search', { query, limit, scrapeContent });

  // Check if MCP is initialized
  if (!mcpClientService.isInitialized()) {
    logger.error('[Firecrawl] MCP client not initialized');
    return {
      success: false,
      error: 'Firecrawl MCP server is not initialized. Please set FIRECRAWL_API_KEY in environment variables.'
    };
  }

  // Note: scrapeContent defaults to false for faster searches
  // When scrapeContent is true, each result is also scraped which is slower
  const result = await mcpClientService.search(query, {
    limit: Math.min(limit || 5, 10),
    scrapeContent: scrapeContent === true
  });

  if (!result.success) {
    logger.error('[Firecrawl] Search failed', { error: result.error });
    return {
      success: false,
      error: result.error || 'Search failed'
    };
  }

  // Format results for AI consumption
  // Firecrawl API returns results in a 'web' array (not 'results')
  const data = result.data as {
    web?: Array<{
      title?: string;
      url?: string;
      description?: string;
      markdown?: string;
      position?: number;
    }>;
    // Legacy format support
    results?: Array<{
      title?: string;
      url?: string;
      description?: string;
      markdown?: string;
    }>;
  };

  // Use 'web' array (new format) or 'results' array (legacy format)
  const rawResults = data.web || data.results || [];

  const searchResults: FirecrawlSearchResult[] = rawResults.map((r) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.description || '',
    markdown: r.markdown || ''
  }));

  logger.info('[Firecrawl] Search completed', { resultCount: searchResults.length });

  return {
    success: true,
    data: {
      query,
      resultCount: searchResults.length,
      results: searchResults,
      message: `Found ${searchResults.length} results for "${query}"`
    }
  };
}

// Execute Firecrawl scrape
async function executeFirecrawlScrape(
  url: string,
  onlyMainContent?: boolean
): Promise<ToolResult> {
  logger.info('[Firecrawl] Executing scrape', { url, onlyMainContent });

  if (!mcpClientService.isInitialized()) {
    logger.error('[Firecrawl] MCP client not initialized');
    return {
      success: false,
      error: 'Firecrawl MCP server is not initialized. Please set FIRECRAWL_API_KEY in environment variables.'
    };
  }

  const result = await mcpClientService.scrape(url, {
    formats: ['markdown'],
    onlyMainContent: onlyMainContent !== false
  });

  if (!result.success) {
    logger.error('[Firecrawl] Scrape failed', { error: result.error });
    return {
      success: false,
      error: result.error || 'Scrape failed'
    };
  }

  const data = result.data as {
    markdown?: string;
    title?: string;
    metadata?: Record<string, unknown>;
  };

  logger.info('[Firecrawl] Scrape completed', { url, hasContent: !!data.markdown });

  return {
    success: true,
    data: {
      url,
      title: data.title || '',
      markdown: data.markdown || '',
      metadata: data.metadata || {},
      message: `Successfully scraped ${url}`
    }
  };
}

// Execute Firecrawl map (discover URLs)
async function executeFirecrawlMap(
  url: string,
  search?: string,
  limit?: number
): Promise<ToolResult> {
  logger.info('[Firecrawl] Executing map', { url, search, limit });

  if (!mcpClientService.isInitialized()) {
    logger.error('[Firecrawl] MCP client not initialized');
    return {
      success: false,
      error: 'Firecrawl MCP server is not initialized. Please set FIRECRAWL_API_KEY in environment variables.'
    };
  }

  const result = await mcpClientService.map(url, {
    search,
    limit: limit || 50
  });

  if (!result.success) {
    logger.error('[Firecrawl] Map failed', { error: result.error });
    return {
      success: false,
      error: result.error || 'Map failed'
    };
  }

  const data = result.data as {
    links?: string[];
  };

  const urls = data.links || [];
  logger.info('[Firecrawl] Map completed', { url, urlCount: urls.length });

  return {
    success: true,
    data: {
      baseUrl: url,
      searchFilter: search || null,
      urlCount: urls.length,
      urls,
      message: `Found ${urls.length} URLs on ${url}${search ? ` matching "${search}"` : ''}`
    }
  };
}

// ============================================================================
// ALL TOOLS COMBINED - Use this everywhere, AI always has access to everything
// ============================================================================
// Returns all tools combined - called at runtime to avoid circular dependency
export function getAllTools(): Anthropic.Tool[] {
  const tools = [
    ...ideaSynthesisTools,
    ...getDependencyNodeTools(),
    firecrawlSearchTool,
    firecrawlScrapeTool,
    firecrawlMapTool
  ];
  // Log tool names for debugging
  const toolNames = tools.map(t => t.name);
  logger.info('[getAllTools] Returning tools', { count: tools.length, tools: toolNames });
  return tools;
}
