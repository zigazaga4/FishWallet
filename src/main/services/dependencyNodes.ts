// Dependency Nodes Service - Manages visual dependency nodes for idea planning
// Stores nodes and their connections for flow visualization
// Dependency nodes represent APIs, libraries, packages, services, and any external dependencies
// Guided by the Holy Spirit

import { eq, and } from 'drizzle-orm';
import { getDatabase, schema } from '../db';
import { ApiNode, NewApiNode, ApiNodeConnection, NewApiNodeConnection } from '../db/schema';
import { randomUUID } from 'crypto';

// Pricing/licensing tier structure
export interface PricingTier {
  name: string;
  price: string;
  features: string[];
}

// Pricing/licensing information structure
export interface PricingInfo {
  model: string;
  tiers?: PricingTier[];
  perRequest?: string;
  perUnit?: string;
  freeQuota?: string;
  notes?: string;
}

// Dependency node type (maps from database ApiNode)
export interface DependencyNode {
  id: string;
  ideaId: string;
  name: string;
  provider: string;
  description: string;
  pricing: string | null;
  positionX: number;
  positionY: number;
  color: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// Connection technical details structure
export interface ConnectionDetails {
  integrationMethod: string;      // How they connect: "REST API", "SDK", "Database query", "WebSocket", etc.
  dataFlow: string;               // What data passes: "User authentication tokens", "Payment details", etc.
  protocol: string;               // Protocol: "HTTPS", "WSS", "gRPC", "TCP", etc.
  sdkLibraries?: string;          // Required SDKs/libraries: "@stripe/stripe-js", "pg", etc.
  technicalNotes: string;         // Explanation for developer on how to implement
}

// Dependency node connection type (maps from database ApiNodeConnection)
export interface DependencyNodeConnection {
  id: string;
  ideaId: string;
  fromNodeId: string;
  toNodeId: string;
  label: string | null;
  details: string | null;         // JSON string of ConnectionDetails
  createdAt: Date;
}

// Map database ApiNode to DependencyNode
function mapToDependencyNode(dbNode: ApiNode): DependencyNode {
  return {
    id: dbNode.id,
    ideaId: dbNode.ideaId,
    name: dbNode.name,
    provider: dbNode.apiProvider,
    description: dbNode.description,
    pricing: dbNode.pricing,
    positionX: dbNode.positionX,
    positionY: dbNode.positionY,
    color: dbNode.color,
    createdAt: dbNode.createdAt,
    updatedAt: dbNode.updatedAt
  };
}

// Map database ApiNodeConnection to DependencyNodeConnection
function mapToDependencyNodeConnection(dbConn: ApiNodeConnection): DependencyNodeConnection {
  return {
    id: dbConn.id,
    ideaId: dbConn.ideaId,
    fromNodeId: dbConn.fromNodeId,
    toNodeId: dbConn.toNodeId,
    label: dbConn.label,
    details: dbConn.details,
    createdAt: dbConn.createdAt
  };
}

// Dependency Nodes service class
export class DependencyNodesService {
  // Generate unique ID
  private generateId(): string {
    return randomUUID();
  }

  // Get current timestamp
  private now(): Date {
    return new Date();
  }

  // NODE OPERATIONS

  // Create a new dependency node
  createNode(data: {
    ideaId: string;
    name: string;
    provider: string;
    description: string;
    pricing?: PricingInfo;
    positionX?: number;
    positionY?: number;
    color?: string;
  }): DependencyNode {
    const db = getDatabase();
    const now = this.now();

    const newNode: NewApiNode = {
      id: this.generateId(),
      ideaId: data.ideaId,
      name: data.name,
      apiProvider: data.provider,
      description: data.description,
      pricing: data.pricing ? JSON.stringify(data.pricing) : null,
      positionX: data.positionX ?? 0,
      positionY: data.positionY ?? 0,
      color: data.color ?? '#3b82f6',
      createdAt: now,
      updatedAt: now
    };

    db.insert(schema.apiNodes).values(newNode).run();

    return this.getNode(newNode.id)!;
  }

  // Get a node by ID
  getNode(id: string): DependencyNode | null {
    const db = getDatabase();
    const result = db.select().from(schema.apiNodes).where(eq(schema.apiNodes.id, id)).get();
    return result ? mapToDependencyNode(result) : null;
  }

  // Get all nodes for an idea
  getNodesForIdea(ideaId: string): DependencyNode[] {
    const db = getDatabase();
    const results = db.select()
      .from(schema.apiNodes)
      .where(eq(schema.apiNodes.ideaId, ideaId))
      .all();
    return results.map(mapToDependencyNode);
  }

  // Update a node
  updateNode(id: string, data: {
    name?: string;
    provider?: string;
    description?: string;
    pricing?: PricingInfo;
    positionX?: number;
    positionY?: number;
    color?: string;
  }): DependencyNode {
    const db = getDatabase();

    const updateData: Partial<NewApiNode> = {
      updatedAt: this.now()
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.provider !== undefined) updateData.apiProvider = data.provider;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.pricing !== undefined) updateData.pricing = JSON.stringify(data.pricing);
    if (data.positionX !== undefined) updateData.positionX = data.positionX;
    if (data.positionY !== undefined) updateData.positionY = data.positionY;
    if (data.color !== undefined) updateData.color = data.color;

    db.update(schema.apiNodes)
      .set(updateData)
      .where(eq(schema.apiNodes.id, id))
      .run();

    const updated = this.getNode(id);
    if (!updated) {
      throw new Error(`Node with id ${id} not found`);
    }
    return updated;
  }

  // Update node position (for drag operations)
  updateNodePosition(id: string, positionX: number, positionY: number): DependencyNode {
    return this.updateNode(id, { positionX, positionY });
  }

  // Delete a node (connections cascade)
  deleteNode(id: string): void {
    const db = getDatabase();
    db.delete(schema.apiNodes).where(eq(schema.apiNodes.id, id)).run();
  }

  // Delete all nodes for an idea
  deleteAllNodesForIdea(ideaId: string): void {
    const db = getDatabase();
    db.delete(schema.apiNodes).where(eq(schema.apiNodes.ideaId, ideaId)).run();
  }

  // CONNECTION OPERATIONS

  // Create a connection between two nodes
  createConnection(data: {
    ideaId: string;
    fromNodeId: string;
    toNodeId: string;
    label?: string;
    details?: ConnectionDetails;
  }): DependencyNodeConnection {
    const db = getDatabase();
    const now = this.now();

    // Verify both nodes exist and belong to the same idea
    const fromNode = this.getNode(data.fromNodeId);
    const toNode = this.getNode(data.toNodeId);

    if (!fromNode) {
      throw new Error(`Source node ${data.fromNodeId} not found`);
    }
    if (!toNode) {
      throw new Error(`Target node ${data.toNodeId} not found`);
    }
    if (fromNode.ideaId !== data.ideaId || toNode.ideaId !== data.ideaId) {
      throw new Error('Both nodes must belong to the same idea');
    }

    const newConnection: NewApiNodeConnection = {
      id: this.generateId(),
      ideaId: data.ideaId,
      fromNodeId: data.fromNodeId,
      toNodeId: data.toNodeId,
      label: data.label ?? null,
      details: data.details ? JSON.stringify(data.details) : null,
      createdAt: now
    };

    db.insert(schema.apiNodeConnections).values(newConnection).run();

    return this.getConnection(newConnection.id)!;
  }

  // Get a connection by ID
  getConnection(id: string): DependencyNodeConnection | null {
    const db = getDatabase();
    const result = db.select().from(schema.apiNodeConnections).where(eq(schema.apiNodeConnections.id, id)).get();
    return result ? mapToDependencyNodeConnection(result) : null;
  }

  // Get all connections for an idea
  getConnectionsForIdea(ideaId: string): DependencyNodeConnection[] {
    const db = getDatabase();
    const results = db.select()
      .from(schema.apiNodeConnections)
      .where(eq(schema.apiNodeConnections.ideaId, ideaId))
      .all();
    return results.map(mapToDependencyNodeConnection);
  }

  // Get connections for a specific node (both incoming and outgoing)
  getConnectionsForNode(nodeId: string): { incoming: DependencyNodeConnection[]; outgoing: DependencyNodeConnection[] } {
    const db = getDatabase();

    const outgoing = db.select()
      .from(schema.apiNodeConnections)
      .where(eq(schema.apiNodeConnections.fromNodeId, nodeId))
      .all()
      .map(mapToDependencyNodeConnection);

    const incoming = db.select()
      .from(schema.apiNodeConnections)
      .where(eq(schema.apiNodeConnections.toNodeId, nodeId))
      .all()
      .map(mapToDependencyNodeConnection);

    return { incoming, outgoing };
  }

  // Update a connection (label and/or details)
  updateConnection(id: string, data: {
    label?: string;
    details?: ConnectionDetails;
  }): DependencyNodeConnection {
    const db = getDatabase();

    const updateData: Record<string, unknown> = {};
    if (data.label !== undefined) updateData.label = data.label;
    if (data.details !== undefined) updateData.details = JSON.stringify(data.details);

    if (Object.keys(updateData).length > 0) {
      db.update(schema.apiNodeConnections)
        .set(updateData)
        .where(eq(schema.apiNodeConnections.id, id))
        .run();
    }

    const updated = this.getConnection(id);
    if (!updated) {
      throw new Error(`Connection with id ${id} not found`);
    }
    return updated;
  }

  // Update a connection label (backwards compatibility)
  updateConnectionLabel(id: string, label: string): DependencyNodeConnection {
    return this.updateConnection(id, { label });
  }

  // Parse connection details from a connection
  parseConnectionDetails(connection: DependencyNodeConnection): ConnectionDetails | null {
    if (!connection.details) return null;
    try {
      return JSON.parse(connection.details) as ConnectionDetails;
    } catch {
      return null;
    }
  }

  // Delete a connection
  deleteConnection(id: string): void {
    const db = getDatabase();
    db.delete(schema.apiNodeConnections).where(eq(schema.apiNodeConnections.id, id)).run();
  }

  // Delete connection between two specific nodes
  deleteConnectionBetween(fromNodeId: string, toNodeId: string): void {
    const db = getDatabase();
    db.delete(schema.apiNodeConnections)
      .where(
        and(
          eq(schema.apiNodeConnections.fromNodeId, fromNodeId),
          eq(schema.apiNodeConnections.toNodeId, toNodeId)
        )
      )
      .run();
  }

  // COMBINED OPERATIONS

  // Get full state for an idea (nodes + connections)
  getFullState(ideaId: string): {
    nodes: DependencyNode[];
    connections: DependencyNodeConnection[];
  } {
    return {
      nodes: this.getNodesForIdea(ideaId),
      connections: this.getConnectionsForIdea(ideaId)
    };
  }

  // Parse pricing from a node
  parsePricing(node: DependencyNode): PricingInfo | null {
    if (!node.pricing) return null;
    try {
      return JSON.parse(node.pricing) as PricingInfo;
    } catch {
      return null;
    }
  }
}

// Singleton instance
export const dependencyNodesService = new DependencyNodesService();
