// MCP Tool Server for Claude Agent SDK
// Exposes FishWallet tools as an in-process MCP server
// The server runs inside the Electron main process where better-sqlite3 works

import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { EventEmitter } from 'events';
import { executeToolCall, ToolResult } from './aiTools';
import { executeDependencyNodeToolCall } from './aiNodeTools';
import { logger } from './logger';

// Event emitted for every tool call (used for snapshot tracking & side effects)
export interface ToolCallEvent {
  toolName: string;
  result: ToolResult;
}

// Convert ToolResult to MCP CallToolResult format
function toMcp(result: ToolResult) {
  return {
    content: [{
      type: 'text' as const,
      text: JSON.stringify(result.success ? result.data : { error: result.error })
    }]
  };
}

// Create the MCP server with all FishWallet tools for a given idea
export function createFishWalletMcpServer(ideaId: string) {
  const events = new EventEmitter();

  // Helper: wrap a synthesis/app tool
  const s = (name: string) =>
    async (args: Record<string, unknown>) => {
      const result = await executeToolCall(ideaId, name, args);
      events.emit('toolCall', { toolName: name, result } as ToolCallEvent);
      return toMcp(result);
    };

  // Helper: wrap a dependency node tool
  const n = (name: string) =>
    async (args: Record<string, unknown>) => {
      const result = await executeDependencyNodeToolCall(ideaId, name, args);
      events.emit('toolCall', { toolName: name, result } as ToolCallEvent);
      return toMcp(result);
    };

  const allTools = [
    // ─── NOTE PROPOSAL ───
    tool('propose_note', 'Capture a quick thought or insight as a note for the user to approve.', {
      title: z.string(),
      content: z.string(),
      category: z.enum(['research', 'decision', 'recommendation', 'insight', 'warning', 'todo'])
    }, s('propose_note')),

    // ─── SYNTHESIS TOOLS ───
    tool('read_notes', 'Fetch and read all voice notes for the current idea.', {}, s('read_notes')),

    tool('update_synthesis', 'Replace the entire synthesis content with new content.', {
      content: z.string()
    }, s('update_synthesis')),

    tool('modify_synthesis_lines', 'Modify specific lines in the synthesis. Line numbers are 1-indexed.', {
      start_line: z.number(),
      end_line: z.number(),
      new_content: z.string()
    }, s('modify_synthesis_lines')),

    tool('add_to_synthesis', 'Add new content to the synthesis at a specific position.', {
      after_line: z.number(),
      content: z.string()
    }, s('add_to_synthesis')),

    tool('remove_from_synthesis', 'Remove specific lines from the synthesis.', {
      start_line: z.number(),
      end_line: z.number()
    }, s('remove_from_synthesis')),

    // ─── CROSS-PROJECT EXPLORATION ───
    tool('explore_projects', 'List all projects or read a specific project\'s synthesis and nodes.', {
      project_id: z.string().optional()
    }, s('explore_projects')),

    // ─── VERSION SNAPSHOTS ───
    tool('list_version_snapshots', 'List all version snapshots for this idea.', {}, s('list_version_snapshots')),

    tool('read_version_snapshot', 'Read data from a past version snapshot.', {
      version_number: z.number(),
      scope: z.enum(['all', 'synthesis', 'app', 'dependencies'])
    }, s('read_version_snapshot')),

    // ─── DEPENDENCY NODE TOOLS ───
    tool('create_dependency_node', 'Create a new dependency node (API, library, service, etc.).', {
      name: z.string(),
      provider: z.string(),
      description: z.string(),
      pricing: z.object({
        model: z.string().optional(),
        per_request: z.string().optional(),
        per_unit: z.string().optional(),
        free_quota: z.string().optional(),
        notes: z.string().optional()
      }).optional(),
      color: z.string().optional()
    }, n('create_dependency_node')),

    tool('update_dependency_node', 'Update an existing dependency node by ID or name.', {
      node_id: z.string().optional(),
      node_name: z.string().optional(),
      name: z.string().optional(),
      provider: z.string().optional(),
      description: z.string().optional(),
      pricing: z.object({
        model: z.string().optional(),
        per_request: z.string().optional(),
        per_unit: z.string().optional(),
        free_quota: z.string().optional(),
        notes: z.string().optional()
      }).optional(),
      color: z.string().optional()
    }, n('update_dependency_node')),

    tool('delete_dependency_node', 'Delete a dependency node and all its connections.', {
      node_id: z.string()
    }, n('delete_dependency_node')),

    tool('connect_dependency_nodes', 'Create a connection between two dependency nodes with integration details.', {
      from_node: z.string(),
      to_node: z.string(),
      label: z.string().optional(),
      integration_method: z.string(),
      data_flow: z.string(),
      protocol: z.string(),
      sdk_libraries: z.string().optional(),
      technical_notes: z.string()
    }, n('connect_dependency_nodes')),

    tool('disconnect_dependency_nodes', 'Remove a connection between two dependency nodes.', {
      from_node: z.string(),
      to_node: z.string()
    }, n('disconnect_dependency_nodes')),

    tool('read_dependency_nodes', 'Read all dependency nodes with their connections and details.', {}, n('read_dependency_nodes'))
  ];

  logger.info('[MCP] Creating FishWallet MCP server', {
    ideaId,
    toolCount: allTools.length,
    tools: allTools.map(t => t.name)
  });

  const server = createSdkMcpServer({
    name: 'fishwallet-tools',
    version: '1.0.0',
    tools: allTools
  });

  return { server, events };
}


// Tools that modify project state (used for snapshot tracking)
export const MODIFYING_TOOLS = new Set([
  'update_synthesis', 'modify_synthesis_lines', 'add_to_synthesis', 'remove_from_synthesis',
  'create_dependency_node', 'update_dependency_node', 'delete_dependency_node',
  'connect_dependency_nodes', 'disconnect_dependency_nodes'
]);
