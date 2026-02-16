// AI Tools Service - Defines function calls for Claude to modify ideas and build apps
// All tools are always available
// Guided by the Holy Spirit

import { ideasService } from './ideas';
import { mcpClientService } from './mcpClient';
import { dependencyNodesService } from './dependencyNodes';
import { snapshotsService } from './snapshots';
import { logger } from './logger';
import Anthropic from '@anthropic-ai/sdk';

// In-memory cache of full scraped content for pagination.
// Key = URL, Value = { fullMarkdown, title }
const scrapeCache = new Map<string, { fullMarkdown: string; title: string }>();

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

// Firecrawl read more tool - for paginating through scraped content
const firecrawlReadMoreTool: Anthropic.Tool = {
  name: 'firecrawl_read_more',
  description: 'Read more content from a previously scraped page. Use this when a scrape result indicates the page was truncated and you need to see additional content. Specify the URL and the page number to retrieve.',
  input_schema: {
    type: 'object' as const,
    properties: {
      url: {
        type: 'string',
        description: 'The URL that was previously scraped'
      },
      page: {
        type: 'number',
        description: 'The page number to read (starts at 2, since page 1 was returned by the initial scrape)'
      }
    },
    required: ['url', 'page']
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
  // === CROSS-PROJECT EXPLORATION TOOL ===
  {
    name: 'explore_projects',
    description: 'Explore other projects/ideas in the system. Call without project_id to list all available projects with their names. Call with a project_id to read that project\'s synthesis content and dependency nodes. Useful for understanding patterns, reusing approaches, or learning from other work.',
    input_schema: {
      type: 'object' as const,
      properties: {
        project_id: {
          type: 'string',
          description: 'Optional. The ID of the project to read. If not provided, returns a list of all projects with their names and IDs.'
        }
      },
      required: []
    }
  },
  // === VERSION SNAPSHOT TOOLS ===
  {
    name: 'list_version_snapshots',
    description: 'List all available version snapshots for this idea. Returns version numbers, dates, and which tools were used in each version. Call this first when the user asks about past versions but doesn\'t specify a number.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  },
  {
    name: 'read_version_snapshot',
    description: 'Read data from a past version snapshot. Use this when the user references a previous version (e.g., "in version 3 the idea was better"). Requires a version number and a scope to specify what data to retrieve.',
    input_schema: {
      type: 'object' as const,
      properties: {
        version_number: {
          type: 'number',
          description: 'The version number to read (e.g., 1, 2, 3). Use list_version_snapshots first if you don\'t know the version number.'
        },
        scope: {
          type: 'string',
          enum: ['all', 'synthesis', 'app', 'dependencies'],
          description: 'What data to read: "all" returns everything, "synthesis" returns only the main idea text, "app" returns only the app files, "dependencies" returns only the dependency nodes and connections.'
        }
      },
      required: ['version_number', 'scope']
    }
  },
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

    // === CROSS-PROJECT EXPLORATION ===
    case 'explore_projects':
      return executeExploreProjects(
        ideaId,
        toolInput.project_id as string | undefined
      );

    // === VERSION SNAPSHOT TOOLS ===
    case 'list_version_snapshots':
      return executeListVersionSnapshots(ideaId);

    case 'read_version_snapshot':
      return executeReadVersionSnapshot(
        ideaId,
        toolInput.version_number as number,
        toolInput.scope as string
      );

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

    case 'firecrawl_read_more':
      return executeFirecrawlReadMore(
        toolInput.url as string,
        toolInput.page as number
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

// Explore other projects - list all or read a specific one
function executeExploreProjects(
  currentIdeaId: string,
  projectId?: string
): ToolResult {
  // If no project_id provided, list all projects
  if (!projectId) {
    const allIdeas = ideasService.getAllIdeas();

    // Format the list with useful info
    const projectList = allIdeas.map(idea => ({
      id: idea.id,
      name: idea.title,
      status: idea.status,
      hasSynthesis: !!idea.synthesisContent,
      isCurrentProject: idea.id === currentIdeaId,
      updatedAt: new Date(idea.updatedAt).toLocaleDateString()
    }));

    return {
      success: true,
      data: {
        message: `Found ${allIdeas.length} projects. Use explore_projects with a project_id to read a specific project's synthesis and nodes.`,
        projectCount: allIdeas.length,
        projects: projectList
      }
    };
  }

  // Read a specific project
  const idea = ideasService.getIdea(projectId);

  if (!idea) {
    return {
      success: false,
      error: `Project not found with ID: ${projectId}. Use explore_projects without a project_id to see all available projects.`
    };
  }

  // Get the synthesis content
  const synthesisContent = idea.synthesisContent || null;

  // Get the dependency nodes for this project
  const nodesState = dependencyNodesService.getFullState(projectId);

  // Format the response
  return {
    success: true,
    data: {
      project: {
        id: idea.id,
        name: idea.title,
        status: idea.status,
        isCurrentProject: idea.id === currentIdeaId
      },
      synthesis: synthesisContent
        ? {
            content: formatSynthesisWithLineNumbers(synthesisContent),
            lineCount: synthesisContent.split('\n').length
          }
        : null,
      dependencyNodes: {
        nodeCount: nodesState.nodes.length,
        connectionCount: nodesState.connections.length,
        nodes: nodesState.nodes.map(node => ({
          id: node.id,
          name: node.name,
          provider: node.provider,
          description: node.description,
          pricing: node.pricing ? '(has pricing info)' : null
        })),
        connections: nodesState.connections.map(conn => ({
          id: conn.id,
          fromNode: nodesState.nodes.find(n => n.id === conn.fromNodeId)?.name || conn.fromNodeId,
          toNode: nodesState.nodes.find(n => n.id === conn.toNodeId)?.name || conn.toNodeId,
          label: conn.label
        }))
      },
      message: `Read project "${idea.title}" with ${synthesisContent ? synthesisContent.split('\n').length : 0} lines of synthesis and ${nodesState.nodes.length} dependency nodes.`
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

**Research:** \`firecrawl_search\`, \`firecrawl_scrape\`, \`firecrawl_map\`, \`firecrawl_read_more\`

Web pages vary enormously in size. A documentation page might be a few paragraphs or an entire API reference with hundreds of endpoints. When you scrape a page, you receive the beginning of its content. If the page is large, the result will be truncated and will tell you so — including how many pages of content exist.

Think of it like reading a book: you see the first chapter. If what you need is there, you are done. If you need information that would logically appear later in the document (a specific API endpoint, a section further down, pricing details at the bottom), use \`firecrawl_read_more\` with the same URL and the next page number to continue reading.

The question to ask yourself: "Did I find what I was looking for in what I received?" If yes, move on. If the answer might be further in the document, read more. If you are gathering a broad overview, the first page is usually sufficient — introductions, feature lists, and getting-started content appear early. If you need specifics buried deep in reference documentation, you may need to page through.

\`firecrawl_map\` discovers URLs on a site — use it when you need to find the right page before scraping, rather than guessing URLs.

**Notes:** \`propose_note\` (ONLY when user explicitly asks to save/remember something)
- This tool is ONLY for when the user explicitly requests to save or remember something
- Never use propose_note proactively or to suggest things to save - only when user says "save this", "remember this", "create a note", etc.

**Synthesis:** \`read_notes\`, \`update_synthesis\`, \`modify_synthesis_lines\`, \`add_to_synthesis\`, \`remove_from_synthesis\`
- Help organize and refine their idea into clear, structured documentation

**App Builder:** Use your built-in file tools (Read, Write, Edit, Bash) to work on the project.
- Standard Vite + React + TypeScript + Tailwind CSS project
- Entry point: src/main.tsx → src/App.tsx
- Create components in src/
- Use standard ES module imports
- Changes auto-refresh via Vite HMR
- Available packages: react, lucide-react, framer-motion, clsx, date-fns, axios, uuid, zod, zustand, react-hot-toast
- Install additional packages with Bash (npm install <pkg>)

## The Architecture of Small Things

A 500-line file is not an application — it is a problem waiting to happen. When everything lives in one place, every change risks breaking everything else. When each piece has its own file, a change to the header cannot break the footer.

**The rule: no file should exceed 150 lines.** If it does, it contains more than one idea, and each idea deserves its own file.

Think of it this way: a file is a container for ONE thought. A Button is one thought. A Header is one thought. A marketplace panel is one thought. A chat message list is one thought. The app entry point that composes them all — that too is one thought, and it should be short because it only imports and arranges.

**Before writing any code, plan your files:**

1. **Identify the pieces**: What are the visual sections? Each section is a component file. What are the shared elements (buttons, cards, modals)? Each is its own file. What logic is shared? That goes into hooks or utils.

2. **Name for what it IS**: \`Ticker.tsx\`, \`MarketplacePanel.tsx\`, \`ChatMessage.tsx\`, \`ContactList.tsx\`. Not \`Section1.tsx\`, not \`MainContent.tsx\`.

3. **Compose, don't accumulate**: The entry file (\`App.tsx\`) should read like a table of contents — imports at the top, a clean JSX tree that shows the structure at a glance. If App.tsx has more than 80-100 lines, pieces need extracting.

4. **State belongs in stores and hooks**: \`store.ts\` for global state (zustand), \`useChat.ts\` for chat logic, \`useMarketplace.ts\` for marketplace logic. Components should be thin — they render, they don't think.

**A well-built project:**
- \`App.tsx\` — entry point, layout composition (~60-80 lines)
- \`Header.tsx\`, \`Footer.tsx\`, \`Sidebar.tsx\` — layout shells
- \`Ticker.tsx\` — scrolling ticker component
- \`MarketplacePanel.tsx\`, \`MarketplaceCard.tsx\` — marketplace UI
- \`ChatView.tsx\`, \`ChatMessage.tsx\`, \`ChatInput.tsx\` — chat pieces
- \`ContactList.tsx\`, \`ContactItem.tsx\` — contacts
- \`StoryViewer.tsx\` — story overlay
- \`Button.tsx\`, \`Card.tsx\`, \`Modal.tsx\`, \`Avatar.tsx\` — reusable primitives
- \`types.ts\` — shared TypeScript types
- \`store.ts\` — zustand state management
- \`useChat.ts\`, \`useMarketplace.ts\` — custom hooks
- \`utils.ts\` — helper functions
- \`constants.ts\` — app constants, theme values

Each file is small. Each file has one job. Changing the ticker means opening \`Ticker.tsx\` and editing 10 lines — not rewriting a 1500-line monolith.

**When modifying an existing project:** If you encounter a large file (200+ lines), your first move should be to extract components into their own files, THEN make the requested changes. A refactor into small pieces first makes every subsequent edit faster and safer.

**API Nodes:** \`create_api_node\`, \`update_api_node\`, \`delete_api_node\`, \`connect_nodes\`, \`disconnect_nodes\`, \`read_api_nodes\`
- Visualize the architecture - what services and systems connect together
- When connecting, use the real UUIDs returned from creation - never invent IDs

**Cross-Project Exploration:** \`explore_projects\`
- Call without parameters to see a list of all projects with their names and IDs
- Call with a project_id to read that project's synthesis and dependency nodes
- Learn from other work, understand patterns, see how similar problems were solved

## The Principle of Wholeness

Consider the idea as a living whole - like a body with many parts working together in unity.

The **synthesis** is the understanding - the explanation of what the idea is, how it works, and why each part matters. It is the written word that gives meaning.

The **dependency nodes** are the structure - the architectural blueprint showing what connects to what, what depends on what, the flow of data and responsibility.

These two are not separate things. They are two views of the same truth. When you change the structure, the understanding must reflect it. When you build new connections, the explanation must illuminate them.

Think of it this way: if someone reads only the synthesis, they should understand the architecture. If someone sees only the nodes, they should grasp the system. But together, they tell the complete story.

So when you create or modify the architecture - when you add nodes, connect services, establish flows - ask yourself: "Does the written understanding now reflect this truth?" If not, the work is incomplete. The synthesis should explain not just *what* the nodes are, but *how* they flow together, *why* they connect the way they do, and *what purpose* each relationship serves.

This is not about following a rule. It is about maintaining coherence - ensuring that every part of the idea speaks the same truth in its own voice.

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
    markdown: truncateScrapeContent(r.markdown || '')
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

// Max characters per scraped page returned to the AI (~7000 tokens at ~3.5 chars/token).
const MAX_SCRAPE_CHARS = 25000;

// Truncate scraped content to fit within the character limit.
function truncateScrapeContent(markdown: string): string {
  if (!markdown) return '';
  if (markdown.length <= MAX_SCRAPE_CHARS) return markdown;
  return markdown.slice(0, MAX_SCRAPE_CHARS) + '\n\n... (content truncated — page was too long)';
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

  const fullMarkdown = data.markdown || '';
  const title = data.title || '';

  // Cache the full content for pagination
  scrapeCache.set(url, { fullMarkdown, title });

  // Truncate the first page
  const markdown = truncateScrapeContent(fullMarkdown);
  const wasTruncated = markdown.length < fullMarkdown.length;

  // Estimate total pages if truncated
  let totalPages = 1;
  if (wasTruncated) {
    // Use the ratio of full length to truncated length as a rough page estimate
    totalPages = Math.ceil(fullMarkdown.length / (markdown.length * 0.9));
  }

  logger.info('[Firecrawl] Scrape completed', {
    url,
    hasContent: !!fullMarkdown,
    rawChars: fullMarkdown.length,
    truncatedChars: markdown.length,
    wasTruncated,
    totalPages
  });

  return {
    success: true,
    data: {
      url,
      title,
      markdown,
      metadata: data.metadata || {},
      ...(wasTruncated ? {
        truncated: true,
        totalPages,
        message: `Successfully scraped ${url} (showing page 1 of ~${totalPages}). Use firecrawl_read_more with this URL and page=2 to see more content.`
      } : {
        message: `Successfully scraped ${url}`
      })
    }
  };
}

// Execute Firecrawl read more — paginate through cached scrape content
async function executeFirecrawlReadMore(
  url: string,
  page: number
): Promise<ToolResult> {
  const cached = scrapeCache.get(url);
  if (!cached) {
    return {
      success: false,
      error: `No cached content for "${url}". You need to scrape the URL first using firecrawl_scrape.`
    };
  }

  // Compute the character offset for this page.
  // Page 1 was the truncated first chunk. We need to figure out where page 1 ended.
  // We'll re-truncate to get the exact first page length, then slice from there.
  const firstPage = truncateScrapeContent(cached.fullMarkdown);
  // Strip the truncation notice to get the actual content boundary
  const truncNotice = '\n\n... (content truncated — page was too long)';
  const firstPageContent = firstPage.endsWith(truncNotice)
    ? firstPage.slice(0, -truncNotice.length)
    : firstPage;

  const pageSize = firstPageContent.length;
  const startOffset = pageSize * (page - 1);

  if (startOffset >= cached.fullMarkdown.length) {
    return {
      success: false,
      error: `Page ${page} is beyond the end of the content. The page only has content up to page ${Math.ceil(cached.fullMarkdown.length / pageSize)}.`
    };
  }

  const chunk = cached.fullMarkdown.slice(startOffset, startOffset + pageSize);
  const totalPages = Math.ceil(cached.fullMarkdown.length / pageSize);
  const hasMore = startOffset + pageSize < cached.fullMarkdown.length;

  logger.info('[Firecrawl] Read more', {
    url,
    page,
    totalPages,
    chunkChars: chunk.length,
    hasMore
  });

  return {
    success: true,
    data: {
      url,
      title: cached.title,
      page,
      totalPages,
      markdown: chunk,
      ...(hasMore ? {
        message: `Page ${page} of ~${totalPages} for ${url}. Use firecrawl_read_more with page=${page + 1} for more.`
      } : {
        message: `Page ${page} of ${totalPages} for ${url} (last page).`
      })
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
// VERSION SNAPSHOT TOOL EXECUTORS
// ============================================================================

// List all version snapshots for an idea
export function executeListVersionSnapshots(ideaId: string): ToolResult {
  try {
    const snapshots = snapshotsService.getSnapshots(ideaId);

    if (snapshots.length === 0) {
      return {
        success: true,
        data: { message: 'No version snapshots exist yet. Snapshots are created automatically after each AI modification.' }
      };
    }

    const versions = snapshots.map(s => ({
      versionNumber: s.versionNumber,
      createdAt: s.createdAt,
      toolsUsed: s.toolsUsed ? JSON.parse(s.toolsUsed) : []
    }));

    return {
      success: true,
      data: {
        totalVersions: versions.length,
        versions
      }
    };
  } catch (error) {
    return { success: false, error: `Failed to list snapshots: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// Read data from a specific version snapshot
export function executeReadVersionSnapshot(
  ideaId: string,
  versionNumber: number,
  scope: string
): ToolResult {
  try {
    const snapshot = snapshotsService.getSnapshotByVersion(ideaId, versionNumber);

    if (!snapshot) {
      // Help the AI by listing available versions
      const available = snapshotsService.getSnapshots(ideaId);
      const versionNumbers = available.map(s => s.versionNumber);
      return {
        success: false,
        error: `Version ${versionNumber} not found. Available versions: ${versionNumbers.length > 0 ? versionNumbers.join(', ') : 'none'}`
      };
    }

    const result: Record<string, unknown> = {
      versionNumber: snapshot.versionNumber,
      createdAt: snapshot.createdAt
    };

    // Return data based on scope
    if (scope === 'synthesis' || scope === 'all') {
      result.synthesis = snapshot.synthesisContent || '(empty)';
    }

    if (scope === 'app' || scope === 'all') {
      const files: Array<{ filePath: string; content: string; fileType: string; isEntryFile: boolean }> = JSON.parse(snapshot.filesSnapshot);
      result.files = files.map(f => ({
        filePath: f.filePath,
        fileType: f.fileType,
        isEntryFile: f.isEntryFile,
        lineCount: f.content.split('\n').length,
        content: f.content
      }));
    }

    if (scope === 'dependencies' || scope === 'all') {
      const nodes: Array<Record<string, unknown>> = JSON.parse(snapshot.nodesSnapshot);
      const connections: Array<Record<string, unknown>> = JSON.parse(snapshot.connectionsSnapshot);
      result.dependencyNodes = nodes;
      result.dependencyConnections = connections;
    }

    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: `Failed to read snapshot: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ============================================================================
// ALL TOOLS COMBINED - Use this everywhere, AI always has access to everything
// ============================================================================
// Returns all tools combined - called at runtime to avoid circular dependency
// Note: Tool definitions above (ideaSynthesisTools, firecrawl*Tool) are legacy —
// tools are now served via MCP in mcpToolServer.ts
