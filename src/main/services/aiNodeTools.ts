// Dependency Node Tools Service - Defines function calls for Claude to manage dependency nodes
// Tools for creating, reading, connecting, and managing visual dependency nodes
// Dependency nodes represent APIs, libraries, packages, services, and any external dependencies
// Guided by the Holy Spirit

import { dependencyNodesService, PricingInfo } from './dependencyNodes';
import { ideasService } from './ideas';
import Anthropic from '@anthropic-ai/sdk';

// Tool result interface
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

// Tool definitions for Anthropic API - Dependency Node Tools
export const dependencyNodeTools: Anthropic.Tool[] = [
  {
    name: 'create_dependency_node',
    description: 'Create a new dependency node on the canvas. Each node represents a dependency - an API, library, package, service, or any external component the project needs. Include pricing/licensing information when available.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Display name for the node (e.g., "OpenAI GPT-4", "React Router", "PostgreSQL", "Stripe Payments")'
        },
        provider: {
          type: 'string',
          description: 'The provider, author, or source (e.g., "OpenAI", "npm", "AWS", "Open Source")'
        },
        description: {
          type: 'string',
          description: 'Brief description of what this dependency does and how it will be used in the project (2-3 sentences max)'
        },
        pricing: {
          type: 'object',
          description: 'Pricing or licensing information for this dependency',
          properties: {
            model: {
              type: 'string',
              description: 'Pricing/licensing model (e.g., "per-request", "tiered", "open-source", "flat-rate", "freemium")'
            },
            per_request: {
              type: 'string',
              description: 'Cost per request if applicable (e.g., "$0.002 per 1K tokens")'
            },
            per_unit: {
              type: 'string',
              description: 'Cost per unit if applicable (e.g., "$0.023 per GB stored")'
            },
            free_quota: {
              type: 'string',
              description: 'Free tier or open-source license info (e.g., "MIT License", "1000 free requests/month")'
            },
            notes: {
              type: 'string',
              description: 'Additional pricing or licensing notes'
            }
          }
        },
        color: {
          type: 'string',
          description: 'Node color as hex code (e.g., "#3b82f6" for blue). Default is blue.'
        }
      },
      required: ['name', 'provider', 'description']
    }
  },
  {
    name: 'update_dependency_node',
    description: 'Update an existing dependency node. Use this to modify node details, pricing, or position.',
    input_schema: {
      type: 'object' as const,
      properties: {
        node_id: {
          type: 'string',
          description: 'The ID of the node to update'
        },
        name: {
          type: 'string',
          description: 'New display name for the node'
        },
        provider: {
          type: 'string',
          description: 'New provider name'
        },
        description: {
          type: 'string',
          description: 'New description'
        },
        pricing: {
          type: 'object',
          description: 'Updated pricing/licensing information',
          properties: {
            model: { type: 'string' },
            per_request: { type: 'string' },
            per_unit: { type: 'string' },
            free_quota: { type: 'string' },
            notes: { type: 'string' }
          }
        },
        color: {
          type: 'string',
          description: 'New node color as hex code'
        }
      },
      required: ['node_id']
    }
  },
  {
    name: 'delete_dependency_node',
    description: 'Delete a dependency node from the canvas. This also removes all connections to/from this node.',
    input_schema: {
      type: 'object' as const,
      properties: {
        node_id: {
          type: 'string',
          description: 'The ID of the node to delete'
        }
      },
      required: ['node_id']
    }
  },
  {
    name: 'connect_dependency_nodes',
    description: `Create a connection between two dependency nodes with technical integration details.

When connecting services, think about what actually crosses the boundary between them:
- What is the mechanism? (HTTP request, SDK method call, database query, message queue, webhook)
- What travels across? (Authentication tokens, user data, events, commands, queries)
- What protocol carries it? (HTTPS, WebSocket, gRPC, AMQP, direct function call)
- What libraries bridge the gap? (Official SDKs, HTTP clients, database drivers)

The connection should tell a developer everything they need to know to implement this integration without writing actual code.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        from_node: {
          type: 'string',
          description: 'The name of the source node (e.g., "Stripe", "React Hook Form", "PostgreSQL")'
        },
        to_node: {
          type: 'string',
          description: 'The name of the target node (e.g., "Stripe", "React Hook Form", "PostgreSQL")'
        },
        label: {
          type: 'string',
          description: 'Short label describing the relationship (e.g., "sends payment", "queries", "authenticates via")'
        },
        integration_method: {
          type: 'string',
          description: 'How they technically connect. Think: what is the mechanism that crosses the boundary? Examples: "REST API call", "SDK method invocation", "SQL query", "WebSocket message", "Webhook callback", "Message queue publish/subscribe"'
        },
        data_flow: {
          type: 'string',
          description: 'What data travels across this connection. Think: if you intercepted this connection, what would you see? Examples: "JWT tokens for user authentication", "Payment intent objects with amount and currency", "User profile documents", "Real-time price update events"'
        },
        protocol: {
          type: 'string',
          description: 'The communication protocol. Think: what wire format carries the data? Examples: "HTTPS/JSON", "WSS (WebSocket Secure)", "gRPC/Protocol Buffers", "AMQP", "PostgreSQL wire protocol"'
        },
        sdk_libraries: {
          type: 'string',
          description: 'Libraries a developer needs to implement this. Think: what npm packages or imports bridge these services? Examples: "@stripe/stripe-js", "pg (node-postgres)", "socket.io-client", "aws-sdk"'
        },
        technical_notes: {
          type: 'string',
          description: 'Implementation guidance for a developer. Explain the integration pattern, authentication flow, error handling approach, and any gotchas. Write as if briefing a developer who will implement this - be specific about what they need to do, but without actual code.'
        }
      },
      required: ['from_node', 'to_node', 'integration_method', 'data_flow', 'protocol', 'technical_notes']
    }
  },
  {
    name: 'disconnect_dependency_nodes',
    description: 'Remove a connection between two dependency nodes by their names.',
    input_schema: {
      type: 'object' as const,
      properties: {
        from_node: {
          type: 'string',
          description: 'The name of the source node'
        },
        to_node: {
          type: 'string',
          description: 'The name of the target node'
        }
      },
      required: ['from_node', 'to_node']
    }
  },
  {
    name: 'read_dependency_nodes',
    description: 'Read the current state of all dependency nodes with complete connection information. For each node, returns: name, description, pricing/licensing, and all its connections (both outgoing and incoming) with connection descriptions. Use this to understand the full architecture and how dependencies interact.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: []
    }
  }
];

// Execute a dependency node tool call
export async function executeDependencyNodeToolCall(
  ideaId: string,
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<ToolResult> {
  switch (toolName) {
    case 'create_dependency_node':
      return executeCreateNode(ideaId, toolInput);

    case 'update_dependency_node':
      return executeUpdateNode(toolInput);

    case 'delete_dependency_node':
      return executeDeleteNode(toolInput.node_id as string);

    case 'connect_dependency_nodes':
      return executeConnectNodes(
        ideaId,
        toolInput.from_node as string,
        toolInput.to_node as string,
        toolInput.label as string | undefined,
        {
          integrationMethod: toolInput.integration_method as string,
          dataFlow: toolInput.data_flow as string,
          protocol: toolInput.protocol as string,
          sdkLibraries: toolInput.sdk_libraries as string | undefined,
          technicalNotes: toolInput.technical_notes as string
        }
      );

    case 'disconnect_dependency_nodes':
      return executeDisconnectNodes(
        ideaId,
        toolInput.from_node as string,
        toolInput.to_node as string
      );

    case 'read_dependency_nodes':
      return executeReadNodes(ideaId);

    default:
      return { success: false, error: `Unknown tool: ${toolName}` };
  }
}

// Create a new dependency node
function executeCreateNode(
  ideaId: string,
  input: Record<string, unknown>
): ToolResult {
  // Parse pricing/licensing if provided
  let pricing: PricingInfo | undefined;
  if (input.pricing) {
    const p = input.pricing as Record<string, string>;
    pricing = {
      model: p.model || 'unknown',
      perRequest: p.per_request,
      perUnit: p.per_unit,
      freeQuota: p.free_quota,
      notes: p.notes
    };
  }

  // Positions are auto-calculated in frontend based on connections
  const node = dependencyNodesService.createNode({
    ideaId,
    name: input.name as string,
    provider: input.provider as string,
    description: input.description as string,
    pricing,
    positionX: 0,
    positionY: 0,
    color: input.color as string | undefined
  });

  return {
    success: true,
    data: {
      message: `Created dependency node: ${node.name}`,
      nodeId: node.id,
      name: node.name,
      provider: node.provider,
      position: { x: node.positionX, y: node.positionY }
    }
  };
}

// Update an existing node
function executeUpdateNode(input: Record<string, unknown>): ToolResult {
  const nodeId = input.node_id as string;

  // Parse pricing/licensing if provided
  let pricing: PricingInfo | undefined;
  if (input.pricing) {
    const p = input.pricing as Record<string, string>;
    pricing = {
      model: p.model || 'unknown',
      perRequest: p.per_request,
      perUnit: p.per_unit,
      freeQuota: p.free_quota,
      notes: p.notes
    };
  }

  const node = dependencyNodesService.updateNode(nodeId, {
    name: input.name as string | undefined,
    provider: input.provider as string | undefined,
    description: input.description as string | undefined,
    pricing,
    color: input.color as string | undefined
  });

  return {
    success: true,
    data: {
      message: `Updated dependency node: ${node.name}`,
      nodeId: node.id,
      name: node.name
    }
  };
}

// Delete a node
function executeDeleteNode(nodeId: string): ToolResult {
  const node = dependencyNodesService.getNode(nodeId);
  if (!node) {
    return { success: false, error: `Node ${nodeId} not found` };
  }

  const nodeName = node.name;
  dependencyNodesService.deleteNode(nodeId);

  return {
    success: true,
    data: {
      message: `Deleted dependency node: ${nodeName}`
    }
  };
}

// Connection details interface for tool input
interface ConnectionDetailsInput {
  integrationMethod: string;
  dataFlow: string;
  protocol: string;
  sdkLibraries?: string;
  technicalNotes: string;
}

// Connect two nodes by name
function executeConnectNodes(
  ideaId: string,
  fromNodeName: string,
  toNodeName: string,
  label?: string,
  details?: ConnectionDetailsInput
): ToolResult {
  // Look up nodes by name
  const state = dependencyNodesService.getFullState(ideaId);
  const fromNode = state.nodes.find(n => n.name.toLowerCase() === fromNodeName.toLowerCase());
  const toNode = state.nodes.find(n => n.name.toLowerCase() === toNodeName.toLowerCase());

  if (!fromNode) {
    return {
      success: false,
      error: `Source node "${fromNodeName}" not found. Available nodes: ${state.nodes.map(n => n.name).join(', ')}`
    };
  }

  if (!toNode) {
    return {
      success: false,
      error: `Target node "${toNodeName}" not found. Available nodes: ${state.nodes.map(n => n.name).join(', ')}`
    };
  }

  const connection = dependencyNodesService.createConnection({
    ideaId,
    fromNodeId: fromNode.id,
    toNodeId: toNode.id,
    label,
    details: details ? {
      integrationMethod: details.integrationMethod,
      dataFlow: details.dataFlow,
      protocol: details.protocol,
      sdkLibraries: details.sdkLibraries,
      technicalNotes: details.technicalNotes
    } : undefined
  });

  return {
    success: true,
    data: {
      message: `Connected ${fromNode.name} -> ${toNode.name}${label ? ` (${label})` : ''} with integration details`,
      connectionId: connection.id,
      fromNode: fromNode.name,
      toNode: toNode.name,
      label: connection.label,
      integrationMethod: details?.integrationMethod,
      protocol: details?.protocol
    }
  };
}

// Disconnect two nodes by name
function executeDisconnectNodes(
  ideaId: string,
  fromNodeName: string,
  toNodeName: string
): ToolResult {
  // Look up nodes by name
  const state = dependencyNodesService.getFullState(ideaId);
  const fromNode = state.nodes.find(n => n.name.toLowerCase() === fromNodeName.toLowerCase());
  const toNode = state.nodes.find(n => n.name.toLowerCase() === toNodeName.toLowerCase());

  if (!fromNode) {
    return {
      success: false,
      error: `Source node "${fromNodeName}" not found`
    };
  }

  if (!toNode) {
    return {
      success: false,
      error: `Target node "${toNodeName}" not found`
    };
  }

  dependencyNodesService.deleteConnectionBetween(fromNode.id, toNode.id);

  return {
    success: true,
    data: {
      message: `Disconnected ${fromNode.name} from ${toNode.name}`
    }
  };
}

// Read all nodes and connections
// Returns comprehensive information about each node including its connections
function executeReadNodes(ideaId: string): ToolResult {
  const state = dependencyNodesService.getFullState(ideaId);

  // Build connection maps for efficient lookup
  // outgoingConnections: nodeId -> list of connections where this node is the source
  // incomingConnections: nodeId -> list of connections where this node is the target
  const outgoingConnections = new Map<string, Array<{ toNodeId: string; toNodeName: string; label: string | null }>>();
  const incomingConnections = new Map<string, Array<{ fromNodeId: string; fromNodeName: string; label: string | null }>>();

  // Initialize empty arrays for each node
  state.nodes.forEach(node => {
    outgoingConnections.set(node.id, []);
    incomingConnections.set(node.id, []);
  });

  // Populate connection maps
  state.connections.forEach(conn => {
    const fromNode = state.nodes.find(n => n.id === conn.fromNodeId);
    const toNode = state.nodes.find(n => n.id === conn.toNodeId);

    // Add to outgoing connections of source node
    const outgoing = outgoingConnections.get(conn.fromNodeId);
    if (outgoing) {
      outgoing.push({
        toNodeId: conn.toNodeId,
        toNodeName: toNode?.name || 'Unknown',
        label: conn.label
      });
    }

    // Add to incoming connections of target node
    const incoming = incomingConnections.get(conn.toNodeId);
    if (incoming) {
      incoming.push({
        fromNodeId: conn.fromNodeId,
        fromNodeName: fromNode?.name || 'Unknown',
        label: conn.label
      });
    }
  });

  // Format nodes with their connections included
  const nodesInfo = state.nodes.map(node => {
    const pricing = dependencyNodesService.parsePricing(node);
    const nodeOutgoing = outgoingConnections.get(node.id) || [];
    const nodeIncoming = incomingConnections.get(node.id) || [];

    return {
      id: node.id,
      name: node.name,
      provider: node.provider,
      description: node.description,
      pricing: pricing ? {
        model: pricing.model,
        perRequest: pricing.perRequest,
        perUnit: pricing.perUnit,
        freeQuota: pricing.freeQuota,
        notes: pricing.notes
      } : null,
      position: { x: node.positionX, y: node.positionY },
      color: node.color,
      // Connections from this node to other nodes
      connectsTo: nodeOutgoing.map(conn => ({
        nodeId: conn.toNodeId,
        nodeName: conn.toNodeName,
        connectionDescription: conn.label || 'connected to'
      })),
      // Connections from other nodes to this node
      receivesFrom: nodeIncoming.map(conn => ({
        nodeId: conn.fromNodeId,
        nodeName: conn.fromNodeName,
        connectionDescription: conn.label || 'connected from'
      }))
    };
  });

  // Also keep a flat list of connections for reference
  const connectionsInfo = state.connections.map(conn => {
    const fromNode = state.nodes.find(n => n.id === conn.fromNodeId);
    const toNode = state.nodes.find(n => n.id === conn.toNodeId);
    return {
      id: conn.id,
      from: { id: conn.fromNodeId, name: fromNode?.name },
      to: { id: conn.toNodeId, name: toNode?.name },
      label: conn.label
    };
  });

  if (state.nodes.length === 0) {
    return {
      success: true,
      data: {
        message: 'No API nodes created yet.',
        nodeCount: 0,
        connectionCount: 0,
        nodes: [],
        connections: []
      }
    };
  }

  // Generate a readable summary of the architecture
  const architectureSummary = nodesInfo.map(node => {
    const connectionParts: string[] = [];

    if (node.connectsTo.length > 0) {
      const outgoingDescriptions = node.connectsTo.map(
        c => `${c.connectionDescription} ${c.nodeName}`
      ).join(', ');
      connectionParts.push(`sends to: ${outgoingDescriptions}`);
    }

    if (node.receivesFrom.length > 0) {
      const incomingDescriptions = node.receivesFrom.map(
        c => `${c.nodeName} ${c.connectionDescription}`
      ).join(', ');
      connectionParts.push(`receives from: ${incomingDescriptions}`);
    }

    const connectionSummary = connectionParts.length > 0
      ? ` [${connectionParts.join(' | ')}]`
      : ' [no connections]';

    return `- ${node.name} (${node.provider}): ${node.description}${connectionSummary}`;
  }).join('\n');

  return {
    success: true,
    data: {
      message: `Found ${state.nodes.length} nodes and ${state.connections.length} connections`,
      summary: architectureSummary,
      nodeCount: state.nodes.length,
      connectionCount: state.connections.length,
      nodes: nodesInfo,
      connections: connectionsInfo
    }
  };
}

// Generate system prompt for dependency nodes mode
export function generateDependencyNodesSystemPrompt(
  ideaTitle: string,
  existingNodes: Array<{ id: string; name: string; provider: string }>,
  existingConnections: Array<{ fromNodeId: string; toNodeId: string; label: string | null }>
): string {
  const nodesSection = existingNodes.length > 0
    ? `## Current Dependency Nodes
${existingNodes.map(n => `- ${n.name} (${n.provider}) [ID: ${n.id}]`).join('\n')}

## Current Connections
${existingConnections.length > 0
  ? existingConnections.map(c => {
      const from = existingNodes.find(n => n.id === c.fromNodeId);
      const to = existingNodes.find(n => n.id === c.toNodeId);
      return `- ${from?.name} -> ${to?.name}${c.label ? ` (${c.label})` : ''}`;
    }).join('\n')
  : 'No connections yet.'}

Use \`read_dependency_nodes\` to see full details including pricing and licensing information.`
    : 'No dependency nodes have been created yet. Start by analyzing what dependencies are needed - APIs, libraries, services, databases, etc.';

  return `## Project: "${ideaTitle}"

${nodesSection}

## Who You Are

You are helping someone map out the architecture for their idea. They have a vision, and part of making it real is understanding what services, APIs, data sources, and systems need to connect together.

## How to Think

**Think in building blocks.** When you see a system, ask yourself: "What are the smallest independent pieces here?" Each piece should do one thing and do it well. If a piece is doing two things, it might be two pieces.

**Think about boundaries.** Where does one piece end and another begin? What information flows across that boundary? The cleaner the boundary, the easier it is to change one piece without breaking another. Ask: "If I replaced this piece entirely, what would need to change?"

**Think about what changes vs what stays.** Some things change often - user interfaces, business rules, specific providers. Some things change rarely - core data structures, fundamental flows. Build so the things that change often can change easily, without touching the things that stay stable.

**Think about reuse.** When you see a piece, ask: "Could this work in a different context? What would need to be different?" A payment system that only works with one product is less valuable than one that works with any product. A notification system hardcoded to email is less flexible than one that can notify through any channel.

**Think in layers.** Data storage is separate from business logic. Business logic is separate from how users interact with it. APIs are separate from the services behind them. When pieces live in their proper layer, they become interchangeable.

**Think about interfaces, not implementations.** What does a piece promise to do? That's more important than how it does it. If you define clear interfaces between pieces, you can swap implementations without the rest of the system knowing.

When they share what they're building, think: "What are the natural modules here? What pieces could stand alone? What would make this easy to extend, easy to change, easy to reuse?"

They might need research - find documentation on services, APIs, data sources, platforms, anything that could power their idea.

They might need visualization - create nodes that represent each service or system, showing how independent pieces connect through clear interfaces.

They might need connections - show how data flows between services, what talks to what, and importantly, what each connection carries.

Think about their idea as a system of independent, reusable parts. What technologies exist that could serve as building blocks? What patterns keep things flexible? What architecture lets them grow and change without rebuilding everything?

But here is the key: when they ask you to do something specific, do that thing. Don't jump ahead. Don't assume the next step. Complete what they asked, share what you did, and ask what they'd like to do next. Let them guide the journey - it's their idea.

## Your Tools

**Research:** \`firecrawl_search\`, \`firecrawl_scrape\`, \`firecrawl_map\`, \`propose_note\`
- Search and scrape for documentation on any service, API, library, platform, data source - anything that helps their idea
- When you discover something worth remembering, capture it as a note - but think of notes like quick mental bookmarks, not documentation. Write them the way you would say them out loud: "Stripe handles this perfectly", "We need auth before the API call", "Mapbox for the maps". Short. Natural. The thought itself, not an explanation of it.

**Dependency Nodes:** \`create_dependency_node\`, \`update_dependency_node\`, \`delete_dependency_node\`, \`connect_dependency_nodes\`, \`disconnect_dependency_nodes\`, \`read_dependency_nodes\`
- Visualize the architecture with nodes representing dependencies: APIs, libraries, packages, services, databases, and any external components
- Create nodes first, then connect them by their names (e.g., connect "Stripe" to "PostgreSQL")

**Synthesis:** \`read_notes\`, \`update_synthesis\`, \`modify_synthesis_lines\`, \`add_to_synthesis\`
- Help organize their thinking into structured documentation

## What Not to Do

- Don't do multiple things when they asked for one thing
- Don't assume what they want next
- Don't make decisions for them

Complete what they asked. Share what you did. Ask what's next.`;
}
