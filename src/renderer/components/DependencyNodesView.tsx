// DependencyNodesView - Visual canvas for dependency nodes with flow connections
// Displays nodes as cards with connections showing data flow
// Dependency nodes represent APIs, libraries, packages, services, and external dependencies
// Supports zoom, pan, and drag
// Guided by the Holy Spirit

import { useState, useRef, useCallback, useEffect, type ReactElement, type MouseEvent, type WheelEvent } from 'react';

// Pricing/licensing information structure
interface PricingInfo {
  model: string;
  tiers?: Array<{ name: string; price: string; features: string[] }>;
  perRequest?: string;
  perUnit?: string;
  freeQuota?: string;
  notes?: string;
}

// Dependency Node type
interface DependencyNode {
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

// Dependency Node Connection type
// Connection technical details structure
interface ConnectionDetails {
  integrationMethod: string;
  dataFlow: string;
  protocol: string;
  sdkLibraries?: string;
  technicalNotes: string;
}

interface DependencyNodeConnection {
  id: string;
  ideaId: string;
  fromNodeId: string;
  toNodeId: string;
  label: string | null;
  details: string | null;  // JSON string of ConnectionDetails
  createdAt: Date;
}

// Parse connection details from JSON string
function parseConnectionDetails(detailsStr: string | null): ConnectionDetails | null {
  if (!detailsStr) return null;
  try {
    return JSON.parse(detailsStr) as ConnectionDetails;
  } catch {
    return null;
  }
}

// Props for DependencyNodesView component
interface DependencyNodesViewProps {
  nodes: DependencyNode[];
  connections: DependencyNodeConnection[];
  isLoading: boolean;
  onNodePositionChange?: (nodeId: string, x: number, y: number) => void;
}

// Node dimensions
const NODE_WIDTH = 180;
const NODE_HEIGHT = 70;
const HORIZONTAL_GAP = 140;
const VERTICAL_GAP = 40;
const START_X = 80;
const START_Y = 80;

// Sugiyama-style layout algorithm for DAGs
// Minimizes edge crossings using barycenter heuristic
// Based on: Sugiyama, Tagawa, Toda (1981) - "Methods for Visual Understanding of Hierarchical Systems"
function calculateAutoLayout(
  nodes: DependencyNode[],
  connections: DependencyNodeConnection[]
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  if (nodes.length === 0) return positions;

  // Build adjacency lists (both directions)
  const successors = new Map<string, string[]>(); // outgoing edges
  const predecessors = new Map<string, string[]>(); // incoming edges

  nodes.forEach(node => {
    successors.set(node.id, []);
    predecessors.set(node.id, []);
  });

  connections.forEach(conn => {
    const succList = successors.get(conn.fromNodeId);
    if (succList && !succList.includes(conn.toNodeId)) {
      succList.push(conn.toNodeId);
    }
    const predList = predecessors.get(conn.toNodeId);
    if (predList && !predList.includes(conn.fromNodeId)) {
      predList.push(conn.fromNodeId);
    }
  });

  // STEP 1: Layer Assignment using longest path from roots
  // This ensures all edges point from left to right (lower layer to higher layer)
  const layers = new Map<string, number>();

  // Find root nodes (no incoming connections)
  const rootNodes = nodes.filter(n => {
    const preds = predecessors.get(n.id) || [];
    return preds.length === 0;
  });

  // If no roots (cyclic), pick node with most outgoing
  const startNodes = rootNodes.length > 0 ? rootNodes : [
    nodes.reduce((best, node) => {
      const bestSucc = successors.get(best.id)?.length || 0;
      const nodeSucc = successors.get(node.id)?.length || 0;
      return nodeSucc > bestSucc ? node : best;
    }, nodes[0])
  ];

  // Assign layers using BFS from roots (longest path)
  const queue: string[] = [];
  startNodes.forEach(n => {
    layers.set(n.id, 0);
    queue.push(n.id);
  });

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    const nodeLayer = layers.get(nodeId)!;
    const succs = successors.get(nodeId) || [];

    succs.forEach(succId => {
      const currentLayer = layers.get(succId);
      const newLayer = nodeLayer + 1;

      // Take the maximum layer (longest path)
      if (currentLayer === undefined || newLayer > currentLayer) {
        layers.set(succId, newLayer);
      }

      // Only add to queue if not already processed at this or higher layer
      if (!queue.includes(succId)) {
        queue.push(succId);
      }
    });
  }

  // Handle disconnected nodes - assign layer 0
  nodes.forEach(n => {
    if (!layers.has(n.id)) {
      layers.set(n.id, 0);
    }
  });

  // STEP 2: Group nodes by layer
  const layerNodes = new Map<number, string[]>();
  let maxLayer = 0;

  nodes.forEach(n => {
    const layer = layers.get(n.id) || 0;
    maxLayer = Math.max(maxLayer, layer);

    if (!layerNodes.has(layer)) {
      layerNodes.set(layer, []);
    }
    layerNodes.get(layer)!.push(n.id);
  });

  // STEP 3: Crossing Minimization using Barycenter Heuristic
  // The barycenter of a node is the average position of its neighbors in adjacent layers
  // We iterate through layers, reordering nodes to minimize crossings

  // Initialize node positions within each layer (arbitrary order)
  const nodeOrder = new Map<string, number>();
  for (let layer = 0; layer <= maxLayer; layer++) {
    const nodesInLayer = layerNodes.get(layer) || [];
    nodesInLayer.forEach((nodeId, idx) => {
      nodeOrder.set(nodeId, idx);
    });
  }

  // Barycenter heuristic - iterate multiple times for convergence
  const iterations = 4;

  for (let iter = 0; iter < iterations; iter++) {
    // Forward pass: layer 0 to maxLayer
    for (let layer = 1; layer <= maxLayer; layer++) {
      const nodesInLayer = layerNodes.get(layer) || [];
      if (nodesInLayer.length <= 1) continue;

      // Calculate barycenter for each node based on predecessors
      const barycenters: Array<{ nodeId: string; value: number }> = [];

      nodesInLayer.forEach(nodeId => {
        const preds = predecessors.get(nodeId) || [];
        if (preds.length === 0) {
          // No predecessors - keep current position
          barycenters.push({ nodeId, value: nodeOrder.get(nodeId) || 0 });
        } else {
          // Average position of predecessors
          let sum = 0;
          preds.forEach(predId => {
            sum += nodeOrder.get(predId) || 0;
          });
          barycenters.push({ nodeId, value: sum / preds.length });
        }
      });

      // Sort by barycenter
      barycenters.sort((a, b) => a.value - b.value);

      // Update order
      barycenters.forEach((item, idx) => {
        nodeOrder.set(item.nodeId, idx);
      });

      // Update layerNodes order
      layerNodes.set(layer, barycenters.map(b => b.nodeId));
    }

    // Backward pass: maxLayer to layer 0
    for (let layer = maxLayer - 1; layer >= 0; layer--) {
      const nodesInLayer = layerNodes.get(layer) || [];
      if (nodesInLayer.length <= 1) continue;

      // Calculate barycenter for each node based on successors
      const barycenters: Array<{ nodeId: string; value: number }> = [];

      nodesInLayer.forEach(nodeId => {
        const succs = successors.get(nodeId) || [];
        if (succs.length === 0) {
          barycenters.push({ nodeId, value: nodeOrder.get(nodeId) || 0 });
        } else {
          let sum = 0;
          succs.forEach(succId => {
            sum += nodeOrder.get(succId) || 0;
          });
          barycenters.push({ nodeId, value: sum / succs.length });
        }
      });

      // Sort by barycenter
      barycenters.sort((a, b) => a.value - b.value);

      // Update order
      barycenters.forEach((item, idx) => {
        nodeOrder.set(item.nodeId, idx);
      });

      // Update layerNodes order
      layerNodes.set(layer, barycenters.map(b => b.nodeId));
    }
  }

  // STEP 4: Coordinate Assignment
  // Place nodes based on layer (x) and order within layer (y)
  // Center each layer vertically

  // Find the maximum number of nodes in any layer (for spacing)
  let maxNodesInLayer = 0;
  for (let layer = 0; layer <= maxLayer; layer++) {
    const nodesInLayer = layerNodes.get(layer) || [];
    maxNodesInLayer = Math.max(maxNodesInLayer, nodesInLayer.length);
  }

  const totalHeight = maxNodesInLayer * (NODE_HEIGHT + VERTICAL_GAP);

  for (let layer = 0; layer <= maxLayer; layer++) {
    const nodesInLayer = layerNodes.get(layer) || [];
    const layerHeight = nodesInLayer.length * (NODE_HEIGHT + VERTICAL_GAP);
    const layerStartY = START_Y + (totalHeight - layerHeight) / 2;

    nodesInLayer.forEach((nodeId, idx) => {
      const x = START_X + layer * (NODE_WIDTH + HORIZONTAL_GAP);
      const y = layerStartY + idx * (NODE_HEIGHT + VERTICAL_GAP);
      positions.set(nodeId, { x, y });
    });
  }

  return positions;
}

// Parse pricing from JSON string
function parsePricing(pricingStr: string | null): PricingInfo | null {
  if (!pricingStr) return null;
  try {
    return JSON.parse(pricingStr) as PricingInfo;
  } catch {
    return null;
  }
}

// Calculate connection path between two nodes
function calculateConnectionPath(
  fromNode: DependencyNode,
  toNode: DependencyNode
): string {
  const x1 = fromNode.positionX + NODE_WIDTH;
  const y1 = fromNode.positionY + NODE_HEIGHT / 2;
  const x2 = toNode.positionX;
  const y2 = toNode.positionY + NODE_HEIGHT / 2;
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

// Node detail dialog component
function NodeDetailDialog({
  node,
  onClose
}: {
  node: DependencyNode;
  onClose: () => void;
}): ReactElement {
  const pricing = parsePricing(node.pricing);
  const nodeColor = node.color || '#3b82f6';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-[#0f172a] rounded-xl shadow-2xl border max-w-sm w-full mx-4 overflow-hidden"
        style={{ borderColor: nodeColor }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3" style={{ backgroundColor: `${nodeColor}20` }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: nodeColor }} />
              <div>
                <h2 className="text-base font-semibold text-blue-50">{node.name}</h2>
                <p className="text-xs text-blue-300">{node.provider}</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-blue-300 hover:text-blue-100 hover:bg-[#1e3a5f] rounded transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="px-4 py-3 space-y-3">
          <div>
            <h3 className="text-xs font-medium text-blue-300 mb-1">Description</h3>
            <p className="text-sm text-blue-100">{node.description}</p>
          </div>

          {pricing && (
            <div>
              <h3 className="text-xs font-medium text-blue-300 mb-1">Pricing</h3>
              <div className="bg-[#1e3a5f]/50 rounded-lg p-2 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-blue-300">Model:</span>
                  <span className="text-emerald-400 font-medium">{pricing.model}</span>
                </div>
                {pricing.perRequest && (
                  <div className="flex justify-between">
                    <span className="text-blue-300">Per Request:</span>
                    <span className="text-blue-100">{pricing.perRequest}</span>
                  </div>
                )}
                {pricing.perUnit && (
                  <div className="flex justify-between">
                    <span className="text-blue-300">Per Unit:</span>
                    <span className="text-blue-100">{pricing.perUnit}</span>
                  </div>
                )}
                {pricing.freeQuota && (
                  <div className="flex items-center gap-1 text-emerald-400">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>{pricing.freeQuota}</span>
                  </div>
                )}
                {pricing.notes && (
                  <p className="text-blue-300/80 italic pt-1 border-t border-[#1e3a5f]">{pricing.notes}</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Connection detail dialog - full technical integration details
function ConnectionDetailDialog({
  connection,
  fromNode,
  toNode,
  onClose
}: {
  connection: DependencyNodeConnection;
  fromNode: DependencyNode | undefined;
  toNode: DependencyNode | undefined;
  onClose: () => void;
}): ReactElement {
  const details = parseConnectionDetails(connection.details);
  const fromColor = fromNode?.color || '#3b82f6';
  const toColor = toNode?.color || '#3b82f6';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="bg-[#0a1628] rounded-xl shadow-2xl border border-sky-500/30 max-w-lg w-full mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-sky-900/50 to-blue-900/50 border-b border-sky-500/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {/* From node */}
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: fromColor }} />
                <span className="text-sm font-semibold text-blue-50">{fromNode?.name || 'Unknown'}</span>
              </div>
              {/* Arrow */}
              <svg className="w-5 h-5 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
              {/* To node */}
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-semibold text-blue-50">{toNode?.name || 'Unknown'}</span>
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: toColor }} />
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 text-blue-300 hover:text-blue-100 hover:bg-[#1e3a5f] rounded transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {connection.label && (
            <p className="text-sky-300 text-sm mt-2">{connection.label}</p>
          )}
        </div>

        {/* Content */}
        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {details ? (
            <>
              {/* Integration Method */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <svg className="w-4 h-4 text-sky-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <h3 className="text-sm font-medium text-sky-300">Integration Method</h3>
                </div>
                <p className="text-sm text-blue-100 pl-6">{details.integrationMethod}</p>
              </div>

              {/* Protocol */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <svg className="w-4 h-4 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />
                  </svg>
                  <h3 className="text-sm font-medium text-emerald-300">Protocol</h3>
                </div>
                <p className="text-sm text-blue-100 pl-6">{details.protocol}</p>
              </div>

              {/* Data Flow */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <svg className="w-4 h-4 text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                  <h3 className="text-sm font-medium text-amber-300">Data Flow</h3>
                </div>
                <p className="text-sm text-blue-100 pl-6">{details.dataFlow}</p>
              </div>

              {/* SDK/Libraries */}
              {details.sdkLibraries && (
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <svg className="w-4 h-4 text-violet-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    <h3 className="text-sm font-medium text-violet-300">SDK / Libraries</h3>
                  </div>
                  <p className="text-sm text-blue-100 pl-6 font-mono">{details.sdkLibraries}</p>
                </div>
              )}

              {/* Technical Notes */}
              <div>
                <div className="flex items-center gap-2 mb-1.5">
                  <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <h3 className="text-sm font-medium text-blue-300">Technical Notes</h3>
                </div>
                <div className="bg-[#112240] rounded-lg p-3 ml-6 border border-[#1e3a5f]">
                  <p className="text-sm text-blue-100 whitespace-pre-wrap">{details.technicalNotes}</p>
                </div>
              </div>
            </>
          ) : (
            <div className="text-center py-6 text-blue-300/60">
              <svg className="w-10 h-10 mx-auto mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <p className="text-sm">No technical details available</p>
              <p className="text-xs mt-1 text-blue-400/60">Ask the AI to add integration details</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#0f172a] border-t border-[#1e3a5f] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-sm text-blue-300 hover:text-blue-100 hover:bg-[#1e3a5f] rounded transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Connection tooltip component - shows connection info on hover
function ConnectionTooltip({
  connection,
  fromNode,
  toNode,
  position
}: {
  connection: DependencyNodeConnection;
  fromNode: DependencyNode | undefined;
  toNode: DependencyNode | undefined;
  position: { x: number; y: number };
}): ReactElement {
  // Determine connection description
  const connectionDescription = connection.label || 'Connected';
  const fromColor = fromNode?.color || '#3b82f6';
  const toColor = toNode?.color || '#3b82f6';

  return (
    <div
      className="absolute z-50 pointer-events-none"
      style={{
        left: position.x + 12,
        top: position.y - 40,
        transform: 'translateY(-100%)'
      }}
    >
      <div className="bg-[#0f172a] rounded-lg shadow-xl border border-blue-500/50 p-3 min-w-[200px] max-w-[280px]">
        {/* Header - Connection label */}
        <div className="flex items-center gap-2 mb-2 pb-2 border-b border-[#1e3a5f]">
          <svg className="w-4 h-4 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          <span className="text-sm font-semibold text-blue-100 truncate">{connectionDescription}</span>
        </div>

        {/* Flow visualization */}
        <div className="flex items-center gap-2">
          {/* From node */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: fromColor }} />
              <span className="text-xs font-medium text-blue-50 truncate">{fromNode?.name || 'Unknown'}</span>
            </div>
            <span className="text-[10px] text-blue-400 ml-3.5 truncate block">{fromNode?.provider || ''}</span>
          </div>

          {/* Arrow */}
          <svg className="w-5 h-5 text-blue-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>

          {/* To node */}
          <div className="flex-1 min-w-0 text-right">
            <div className="flex items-center justify-end gap-1.5">
              <span className="text-xs font-medium text-blue-50 truncate">{toNode?.name || 'Unknown'}</span>
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: toColor }} />
            </div>
            <span className="text-[10px] text-blue-400 mr-3.5 truncate block">{toNode?.provider || ''}</span>
          </div>
        </div>

        {/* Connection details if label provides more context */}
        {connection.label && (
          <div className="mt-2 pt-2 border-t border-[#1e3a5f]">
            <p className="text-[10px] text-blue-300">
              {fromNode?.name} {connection.label.toLowerCase()} {toNode?.name}
            </p>
          </div>
        )}

        {/* Click hint */}
        <p className="text-[10px] text-sky-400/70 mt-2 text-center">Click for technical details</p>
      </div>

      {/* Tooltip arrow */}
      <div
        className="absolute left-3 bottom-0 translate-y-full w-0 h-0"
        style={{
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '6px solid rgba(59, 130, 246, 0.5)'
        }}
      />
    </div>
  );
}

// Main DependencyNodesView component
export function DependencyNodesView({
  nodes,
  connections,
  isLoading,
  onNodePositionChange
}: DependencyNodesViewProps): ReactElement {
  // Canvas transform state (pan and zoom)
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // Interaction state
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [detailNodeId, setDetailNodeId] = useState<string | null>(null);
  const [detailConnectionId, setDetailConnectionId] = useState<string | null>(null);
  const [hoveredConnectionId, setHoveredConnectionId] = useState<string | null>(null);
  const [connectionTooltipPosition, setConnectionTooltipPosition] = useState<{ x: number; y: number } | null>(null);
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0, nodeX: 0, nodeY: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0, offsetX: 0, offsetY: 0 });

  const containerRef = useRef<HTMLDivElement>(null);
  const lastConnectionCount = useRef<number>(-1); // -1 means "not initialized"
  const manuallyPositioned = useRef<Set<string>>(new Set());
  const layoutInProgress = useRef<boolean>(false);
  const layoutAttemptedForNodes = useRef<Set<string>>(new Set());

  // Auto-layout effect - triggers for new nodes at (0,0) or when connections change
  useEffect(() => {
    // Don't run layout while loading
    if (isLoading) return;
    if (nodes.length === 0 || !onNodePositionChange) return;

    // Prevent concurrent layout operations
    if (layoutInProgress.current) return;

    // Check for new nodes at (0,0) that need initial layout
    const newNodesAtOrigin = nodes.filter(
      n => n.positionX === 0 && n.positionY === 0 && !layoutAttemptedForNodes.current.has(n.id)
    );

    // Check if connections changed (track by count for simplicity)
    const isFirstMount = lastConnectionCount.current === -1;
    const connectionCountChanged = !isFirstMount && connections.length !== lastConnectionCount.current;

    // Update connection count tracking
    lastConnectionCount.current = connections.length;

    // Layout if:
    // 1. There are new nodes at (0,0) that need positioning
    // 2. OR connections changed (to re-arrange based on new graph structure)
    const shouldLayout = newNodesAtOrigin.length > 0 || connectionCountChanged;

    if (!shouldLayout) return;

    // Mark all current nodes as "attempted"
    nodes.forEach(n => layoutAttemptedForNodes.current.add(n.id));
    layoutInProgress.current = true;

    // Calculate positions
    const positions = calculateAutoLayout(nodes, connections);

    // Collect position changes
    const positionChanges: Array<{ nodeId: string; x: number; y: number }> = [];

    nodes.forEach(node => {
      // Skip manually positioned nodes (unless at 0,0 or this is a connection change relayout)
      if (manuallyPositioned.current.has(node.id) && node.positionX !== 0 && node.positionY !== 0 && !connectionCountChanged) {
        return;
      }

      const pos = positions.get(node.id);
      if (pos && (node.positionX !== pos.x || node.positionY !== pos.y)) {
        positionChanges.push({ nodeId: node.id, x: pos.x, y: pos.y });
      }
    });

    // Apply changes
    if (positionChanges.length > 0) {
      setTimeout(() => {
        positionChanges.forEach(change => {
          onNodePositionChange(change.nodeId, change.x, change.y);
        });
        setTimeout(() => {
          layoutInProgress.current = false;
        }, 300);
      }, 0);
    } else {
      layoutInProgress.current = false;
    }
  }, [nodes, connections, onNodePositionChange, isLoading]);

  // Track when user manually drags a node
  const markAsManuallyPositioned = useCallback((nodeId: string) => {
    manuallyPositioned.current.add(nodeId);
  }, []);

  // Handle wheel for zoom
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.25, Math.min(2, scale * delta));
    setScale(newScale);
  }, [scale]);

  // Handle mouse down on canvas (for panning)
  const handleCanvasMouseDown = useCallback((e: MouseEvent) => {
    if (e.target === containerRef.current || (e.target as HTMLElement).tagName === 'svg') {
      setIsPanning(true);
      setPanStart({ x: e.clientX, y: e.clientY, offsetX: offset.x, offsetY: offset.y });
    }
  }, [offset]);

  // Handle mouse down on node (for dragging)
  const handleNodeMouseDown = useCallback((nodeId: string, e: MouseEvent) => {
    e.stopPropagation();
    const node = nodes.find(n => n.id === nodeId);
    if (!node) return;

    setDraggingNodeId(nodeId);
    setDragStart({
      x: e.clientX,
      y: e.clientY,
      nodeX: node.positionX,
      nodeY: node.positionY
    });
  }, [nodes]);

  // Handle mouse move
  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (draggingNodeId) {
      // Dragging a node
      const dx = (e.clientX - dragStart.x) / scale;
      const dy = (e.clientY - dragStart.y) / scale;
      const newX = Math.max(0, dragStart.nodeX + dx);
      const newY = Math.max(0, dragStart.nodeY + dy);
      onNodePositionChange?.(draggingNodeId, Math.round(newX), Math.round(newY));
    } else if (isPanning) {
      // Panning the canvas
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      setOffset({ x: panStart.offsetX + dx, y: panStart.offsetY + dy });
    }
  }, [draggingNodeId, dragStart, scale, onNodePositionChange, isPanning, panStart]);

  // Handle mouse up
  const handleMouseUp = useCallback(() => {
    // Mark node as manually positioned if user was dragging
    if (draggingNodeId) {
      markAsManuallyPositioned(draggingNodeId);
    }
    setDraggingNodeId(null);
    setIsPanning(false);
  }, [draggingNodeId, markAsManuallyPositioned]);

  // Handle double click on node
  const handleNodeDoubleClick = useCallback((nodeId: string) => {
    setDetailNodeId(nodeId);
  }, []);

  // Handle connection hover enter
  const handleConnectionMouseEnter = useCallback((
    connectionId: string,
    e: MouseEvent
  ) => {
    setHoveredConnectionId(connectionId);
    // Calculate tooltip position relative to the canvas container
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      setConnectionTooltipPosition({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    }
  }, []);

  // Handle connection hover move (update tooltip position)
  const handleConnectionMouseMove = useCallback((e: MouseEvent) => {
    if (hoveredConnectionId) {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        setConnectionTooltipPosition({
          x: e.clientX - rect.left,
          y: e.clientY - rect.top
        });
      }
    }
  }, [hoveredConnectionId]);

  // Handle connection hover leave
  const handleConnectionMouseLeave = useCallback(() => {
    setHoveredConnectionId(null);
    setConnectionTooltipPosition(null);
  }, []);

  // Reset view
  const handleResetView = useCallback(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Force re-layout all nodes
  const handleRelayout = useCallback(() => {
    if (!onNodePositionChange || nodes.length === 0) return;

    // Clear tracking to allow fresh layout
    manuallyPositioned.current.clear();
    layoutAttemptedForNodes.current.clear();

    // Calculate fresh layout
    const positions = calculateAutoLayout(nodes, connections);

    // Apply to all nodes
    nodes.forEach(node => {
      const pos = positions.get(node.id);
      if (pos) {
        onNodePositionChange(node.id, pos.x, pos.y);
      }
      // Mark as attempted after manual layout
      layoutAttemptedForNodes.current.add(node.id);
    });
  }, [nodes, connections, onNodePositionChange]);

  // Get detail node
  const detailNode = detailNodeId ? nodes.find(n => n.id === detailNodeId) : null;

  // Show loading state
  if (isLoading && nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-blue-300/60">
        <svg className="w-8 h-8 animate-spin text-sky-400 mb-3" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span>Loading nodes...</span>
      </div>
    );
  }

  // Show empty state
  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-blue-300/60">
        <svg className="w-12 h-12 mb-3 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
        </svg>
        <span>No API nodes yet</span>
        <span className="text-sm mt-1 text-blue-300/40">Ask the AI to plan your APIs</span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Controls */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setScale(s => Math.min(2, s * 1.2))}
            className="p-1.5 text-blue-300 hover:text-blue-100 hover:bg-[#1e3a5f] rounded transition-colors"
            title="Zoom in"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
            </svg>
          </button>
          <button
            onClick={() => setScale(s => Math.max(0.25, s / 1.2))}
            className="p-1.5 text-blue-300 hover:text-blue-100 hover:bg-[#1e3a5f] rounded transition-colors"
            title="Zoom out"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM7 10h6" />
            </svg>
          </button>
          <button
            onClick={handleResetView}
            className="p-1.5 text-blue-300 hover:text-blue-100 hover:bg-[#1e3a5f] rounded transition-colors"
            title="Reset view"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          </button>
          <div className="w-px h-4 bg-[#1e3a5f] mx-1" />
          <button
            onClick={handleRelayout}
            className="flex items-center gap-1.5 px-2 py-1 text-blue-300 hover:text-blue-100 hover:bg-sky-500/20 rounded transition-colors border border-transparent hover:border-sky-500/30"
            title="Auto-arrange all nodes based on connections"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
            </svg>
            <span className="text-xs">Auto-arrange</span>
          </button>
          <span className="text-xs text-blue-400 ml-2">{Math.round(scale * 100)}%</span>
        </div>
        <span className="text-xs text-blue-400">{nodes.length} nodes</span>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="flex-1 relative bg-[#0a1628] rounded-lg overflow-hidden cursor-grab active:cursor-grabbing"
        onWheel={handleWheel}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Transform container */}
        <div
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transformOrigin: '0 0',
            width: '2000px',
            height: '1500px'
          }}
        >
          {/* Grid background */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20">
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e3a5f" strokeWidth="1"/>
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />
          </svg>

          {/* Connection lines with animated flow */}
          <svg className="absolute inset-0 w-full h-full">
            <defs>
              {/* Arrow marker */}
              <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
              </marker>
              {/* Highlighted arrow marker for hover state */}
              <marker id="arrowhead-hover" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#60a5fa" />
              </marker>
              {/* Glowing dot for flow animation */}
              <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            {connections.map((conn, index) => {
              const fromNode = nodes.find(n => n.id === conn.fromNodeId);
              const toNode = nodes.find(n => n.id === conn.toNodeId);
              if (!fromNode || !toNode) return null;
              const path = calculateConnectionPath(fromNode, toNode);
              // Stagger animation start times
              const delay1 = (index * 0.3) % 2;
              const delay2 = ((index * 0.3) + 1) % 2;
              const isHovered = hoveredConnectionId === conn.id;
              return (
                <g key={conn.id} className="connection-group">
                  {/* Invisible wider path for hover detection and click */}
                  <path
                    d={path}
                    fill="none"
                    stroke="transparent"
                    strokeWidth="16"
                    className="cursor-pointer"
                    onMouseEnter={(e) => handleConnectionMouseEnter(conn.id, e as unknown as MouseEvent)}
                    onMouseMove={(e) => handleConnectionMouseMove(e as unknown as MouseEvent)}
                    onMouseLeave={handleConnectionMouseLeave}
                    onClick={() => setDetailConnectionId(conn.id)}
                  />
                  {/* Base connection line */}
                  <path
                    d={path}
                    fill="none"
                    stroke={isHovered ? '#1e4a7f' : '#1e3a5f'}
                    strokeWidth={isHovered ? 4 : 3}
                    className="pointer-events-none transition-all duration-150"
                  />
                  {/* Visible connection line */}
                  <path
                    d={path}
                    fill="none"
                    stroke={isHovered ? '#60a5fa' : '#3b82f6'}
                    strokeWidth={isHovered ? 3 : 2}
                    strokeOpacity={isHovered ? 0.9 : 0.6}
                    className="pointer-events-none transition-all duration-150"
                  />
                  {/* Animated flow dots */}
                  <circle r="4" fill="#60a5fa" filter="url(#glow)" className="pointer-events-none">
                    <animateMotion dur="2s" repeatCount="indefinite" begin={`${delay1}s`}>
                      <mpath href={`#flow-path-${conn.id}`} />
                    </animateMotion>
                  </circle>
                  <circle r="3" fill="#93c5fd" filter="url(#glow)" className="pointer-events-none">
                    <animateMotion dur="2s" repeatCount="indefinite" begin={`${delay2}s`}>
                      <mpath href={`#flow-path-${conn.id}`} />
                    </animateMotion>
                  </circle>
                  {/* Hidden path for animation reference */}
                  <path id={`flow-path-${conn.id}`} d={path} fill="none" stroke="none" className="pointer-events-none" />
                  {/* Arrow at end */}
                  <path
                    d={path}
                    fill="none"
                    stroke={isHovered ? '#60a5fa' : '#3b82f6'}
                    strokeWidth={isHovered ? 3 : 2}
                    markerEnd={isHovered ? 'url(#arrowhead-hover)' : 'url(#arrowhead)'}
                    className="pointer-events-none transition-all duration-150"
                  />
                  {/* Connection label - always visible if exists */}
                  {conn.label && (
                    <text
                      x={(fromNode.positionX + NODE_WIDTH + toNode.positionX) / 2}
                      y={(fromNode.positionY + toNode.positionY + NODE_HEIGHT) / 2 - 12}
                      fill={isHovered ? '#bfdbfe' : '#93c5fd'}
                      fontSize={isHovered ? '11' : '10'}
                      textAnchor="middle"
                      className="font-medium pointer-events-none transition-all duration-150"
                    >
                      {conn.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>

          {/* Nodes */}
          {nodes.map(node => {
            const nodeColor = node.color || '#3b82f6';
            const isHovered = hoveredNodeId === node.id;
            const pricing = parsePricing(node.pricing);

            return (
              <div
                key={node.id}
                className="absolute rounded-lg shadow-lg border transition-all cursor-move select-none"
                style={{
                  left: node.positionX,
                  top: node.positionY,
                  width: NODE_WIDTH,
                  height: NODE_HEIGHT,
                  backgroundColor: '#0f172a',
                  borderColor: isHovered ? '#60a5fa' : nodeColor,
                  borderWidth: isHovered ? 2 : 1,
                  zIndex: isHovered ? 10 : 1
                }}
                onMouseEnter={() => setHoveredNodeId(node.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
                onMouseDown={(e) => handleNodeMouseDown(node.id, e)}
                onDoubleClick={() => handleNodeDoubleClick(node.id)}
              >
                {/* Color bar */}
                <div
                  className="h-1.5 rounded-t-lg"
                  style={{ backgroundColor: nodeColor }}
                />
                {/* Content */}
                <div className="px-2 py-1">
                  <h3 className="text-xs font-semibold text-blue-50 truncate">{node.name}</h3>
                  <p className="text-[10px] text-blue-300 truncate">{node.provider}</p>
                  {pricing && (
                    <div className="flex items-center gap-1 mt-1">
                      <svg className="w-2.5 h-2.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8V7m0 8v1" />
                      </svg>
                      <span className="text-[9px] text-emerald-400 truncate">
                        {pricing.perRequest || pricing.freeQuota || pricing.model}
                      </span>
                    </div>
                  )}
                </div>
                {/* Tooltip on hover */}
                {isHovered && (
                  <div
                    className="absolute left-full ml-2 top-0 bg-[#1e3a5f] rounded-lg p-2 shadow-lg z-20 w-48"
                    style={{ pointerEvents: 'none' }}
                  >
                    <p className="text-xs text-blue-100 line-clamp-3">{node.description}</p>
                    <p className="text-[10px] text-blue-400 mt-1">Double-click for details</p>
                  </div>
                )}
                {/* Connection handles */}
                <div className="absolute w-2 h-2 rounded-full bg-blue-400" style={{ left: -4, top: NODE_HEIGHT / 2 - 4 }} />
                <div className="absolute w-2 h-2 rounded-full bg-blue-400" style={{ right: -4, top: NODE_HEIGHT / 2 - 4 }} />
              </div>
            );
          })}
        </div>

        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute top-2 right-2 flex items-center gap-2 bg-[#0f172a]/90 px-2 py-1 rounded">
            <svg className="w-3 h-3 animate-spin text-sky-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-xs text-blue-300">Updating...</span>
          </div>
        )}

        {/* Connection tooltip on hover */}
        {hoveredConnectionId && connectionTooltipPosition && (() => {
          const hoveredConnection = connections.find(c => c.id === hoveredConnectionId);
          if (!hoveredConnection) return null;
          const fromNode = nodes.find(n => n.id === hoveredConnection.fromNodeId);
          const toNode = nodes.find(n => n.id === hoveredConnection.toNodeId);
          return (
            <ConnectionTooltip
              connection={hoveredConnection}
              fromNode={fromNode}
              toNode={toNode}
              position={connectionTooltipPosition}
            />
          );
        })()}
      </div>

      {/* Detail dialog */}
      {/* Node detail dialog */}
      {detailNode && (
        <NodeDetailDialog node={detailNode} onClose={() => setDetailNodeId(null)} />
      )}

      {/* Connection detail dialog */}
      {detailConnectionId && (() => {
        const detailConnection = connections.find(c => c.id === detailConnectionId);
        if (!detailConnection) return null;
        const fromNode = nodes.find(n => n.id === detailConnection.fromNodeId);
        const toNode = nodes.find(n => n.id === detailConnection.toNodeId);
        return (
          <ConnectionDetailDialog
            connection={detailConnection}
            fromNode={fromNode}
            toNode={toNode}
            onClose={() => setDetailConnectionId(null)}
          />
        );
      })()}
    </div>
  );
}
