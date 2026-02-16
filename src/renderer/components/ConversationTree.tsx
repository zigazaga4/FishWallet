import { useState, useMemo, useRef, useEffect, type ReactElement } from 'react';

// Branch type matching preload
interface Branch {
  id: string;
  ideaId: string;
  parentBranchId: string | null;
  conversationId: string | null;
  label: string;
  depth: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface ConversationTreeProps {
  ideaId: string;
  branches: Branch[];
  activeBranchId: string | null;
  onSwitchBranch: (branchId: string) => void;
  onCreateChild: (parentBranchId: string, label: string) => void;
  onDeleteBranch: (branchId: string) => void;
  onClose: () => void;
  isCreatingBranch: boolean;
}

// Layout constants
const NODE_W = 160;
const NODE_H = 56;
const H_GAP = 40;
const V_GAP = 90;

// Tree node with computed layout position
interface LayoutNode {
  branch: Branch;
  children: LayoutNode[];
  x: number;
  y: number;
  subtreeWidth: number;
}

// Build tree structure from flat branch list
function buildTree(branches: Branch[]): LayoutNode | null {
  const root = branches.find(b => b.parentBranchId === null);
  if (!root) return null;

  const childrenMap = new Map<string, Branch[]>();
  for (const b of branches) {
    if (b.parentBranchId) {
      const siblings = childrenMap.get(b.parentBranchId) || [];
      siblings.push(b);
      childrenMap.set(b.parentBranchId, siblings);
    }
  }

  function buildNode(branch: Branch): LayoutNode {
    const childBranches = childrenMap.get(branch.id) || [];
    // Sort children by creation date so ordering is stable
    childBranches.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

    const children = childBranches.map(buildNode);

    // Subtree width: sum of children's subtree widths (with gaps), or the node itself
    let subtreeWidth = NODE_W;
    if (children.length > 0) {
      subtreeWidth = children.reduce((sum, c) => sum + c.subtreeWidth, 0)
        + (children.length - 1) * H_GAP;
      // Ensure at least as wide as the node
      subtreeWidth = Math.max(subtreeWidth, NODE_W);
    }

    return { branch, children, x: 0, y: 0, subtreeWidth };
  }

  const tree = buildNode(root);

  // Assign positions: root at bottom-center, children grow upward
  function assignPositions(node: LayoutNode, centerX: number, bottomY: number): void {
    node.x = centerX - NODE_W / 2;
    node.y = bottomY;

    if (node.children.length > 0) {
      const totalChildrenWidth = node.children.reduce((s, c) => s + c.subtreeWidth, 0)
        + (node.children.length - 1) * H_GAP;
      let childX = centerX - totalChildrenWidth / 2;

      for (const child of node.children) {
        const childCenterX = childX + child.subtreeWidth / 2;
        assignPositions(child, childCenterX, bottomY - NODE_H - V_GAP);
        childX += child.subtreeWidth + H_GAP;
      }
    }
  }

  assignPositions(tree, 0, 0);

  return tree;
}

// Collect all nodes into a flat list for rendering
function collectNodes(node: LayoutNode): LayoutNode[] {
  const result: LayoutNode[] = [node];
  for (const child of node.children) {
    result.push(...collectNodes(child));
  }
  return result;
}

// Collect all edges (parent → child connections)
function collectEdges(node: LayoutNode): Array<{ from: LayoutNode; to: LayoutNode }> {
  const edges: Array<{ from: LayoutNode; to: LayoutNode }> = [];
  for (const child of node.children) {
    edges.push({ from: node, to: child });
    edges.push(...collectEdges(child));
  }
  return edges;
}

export function ConversationTree({
  branches,
  activeBranchId,
  onSwitchBranch,
  onCreateChild,
  onDeleteBranch,
  onClose,
  isCreatingBranch
}: ConversationTreeProps): ReactElement {
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [deletingBranchId, setDeletingBranchId] = useState<string | null>(null);
  const [creatingFromId, setCreatingFromId] = useState<string | null>(null);
  const [newBranchName, setNewBranchName] = useState('');
  const nameInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState<{ w: number; h: number }>({ w: 800, h: 600 });

  // Build layout
  const tree = useMemo(() => buildTree(branches), [branches]);
  const allNodes = useMemo(() => (tree ? collectNodes(tree) : []), [tree]);
  const allEdges = useMemo(() => (tree ? collectEdges(tree) : []), [tree]);

  // Compute canvas bounds from node positions
  const bounds = useMemo(() => {
    if (allNodes.length === 0) return { minX: 0, minY: 0, maxX: 800, maxY: 600 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of allNodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W);
      maxY = Math.max(maxY, n.y + NODE_H);
    }
    const padding = 80;
    return {
      minX: minX - padding,
      minY: minY - padding,
      maxX: maxX + padding,
      maxY: maxY + padding
    };
  }, [allNodes]);

  const canvasWidth = bounds.maxX - bounds.minX;
  const canvasHeight = bounds.maxY - bounds.minY;

  // Track the scroll container's size so we can anchor the root at bottom-center
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      setContainerSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    // Set initial size
    setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Offset to push tree content so the root sits at the bottom-center of the viewport
  const offsetY = Math.max(0, containerSize.h - canvasHeight);
  const offsetX = Math.max(0, (containerSize.w - canvasWidth) / 2);

  // For large trees that overflow: scroll to the root (bottom-center)
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (el && canvasHeight > containerSize.h) {
      el.scrollTop = el.scrollHeight;
      el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    }
  }, [branches, containerSize, canvasHeight]);

  return (
    <div className="fixed inset-0 z-50 bg-[#0a1628] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e3a5f]">
        <h2 className="text-lg font-light text-blue-50">Conversation Tree</h2>
        <button
          onClick={onClose}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-blue-300 hover:text-sky-400 hover:bg-[#1e3a5f] transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          <span className="text-sm">Close</span>
        </button>
      </div>

      {/* Tree canvas */}
      <div ref={scrollContainerRef} className="flex-1 relative overflow-auto">
        {/* Grid background */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20">
          <defs>
            <pattern id="tree-grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1e3a5f" strokeWidth="1"/>
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#tree-grid)" />
        </svg>

        {/* Scrollable canvas area */}
        <div
          className="relative"
          style={{
            width: Math.max(canvasWidth, 800),
            height: Math.max(canvasHeight, 600),
            minWidth: '100%',
            minHeight: '100%'
          }}
        >
          {/* SVG edges layer */}
          <svg
            className="absolute inset-0 pointer-events-none"
            width="100%"
            height="100%"
            style={{ overflow: 'visible' }}
          >
            {allEdges.map(({ from, to }) => {
              // From: parent top-center, To: child bottom-center
              // Since tree grows upward, child.y < parent.y
              const fromX = from.x + NODE_W / 2 - bounds.minX + offsetX;
              const fromY = from.y - bounds.minY + offsetY; // top of parent
              const toX = to.x + NODE_W / 2 - bounds.minX + offsetX;
              const toY = to.y + NODE_H - bounds.minY + offsetY; // bottom of child

              // Cubic bezier going upward
              const midY = (fromY + toY) / 2;

              return (
                <path
                  key={`${from.branch.id}-${to.branch.id}`}
                  d={`M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`}
                  fill="none"
                  stroke={to.branch.id === activeBranchId ? '#38bdf8' : '#1e3a5f'}
                  strokeWidth={to.branch.id === activeBranchId ? 2 : 1.5}
                  opacity={0.7}
                />
              );
            })}
          </svg>

          {/* HTML nodes layer */}
          {allNodes.map(node => {
            const isActive = node.branch.id === activeBranchId;
            const isHovered = hoveredNodeId === node.branch.id;
            const isRoot = node.branch.parentBranchId === null;

            return (
              <div
                key={node.branch.id}
                className={`absolute rounded-xl border-2 cursor-pointer transition-all duration-200 select-none
                  ${isActive
                    ? 'border-sky-400 bg-sky-900/40 shadow-[0_0_20px_rgba(56,189,248,0.25)]'
                    : 'border-[#1e3a5f] bg-[#112240]/90 hover:border-sky-500/50 hover:bg-[#152a4a]'
                  }`}
                style={{
                  left: node.x - bounds.minX + offsetX,
                  top: node.y - bounds.minY + offsetY,
                  width: NODE_W,
                  height: NODE_H
                }}
                onClick={() => {
                  if (!isActive) onSwitchBranch(node.branch.id);
                }}
                onMouseEnter={() => setHoveredNodeId(node.branch.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
              >
                {/* Node content */}
                <div className="flex flex-col items-center justify-center h-full px-3">
                  <span className={`text-sm font-medium truncate w-full text-center ${
                    isActive ? 'text-sky-300' : 'text-blue-100'
                  }`}>
                    {node.branch.label}
                  </span>
                  {isActive && (
                    <span className="text-[10px] text-sky-400/70 mt-0.5">active</span>
                  )}
                </div>

                {/* "+" button — shown on hover, top-center of node */}
                {isHovered && !isCreatingBranch && !creatingFromId && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setNewBranchName('');
                      setCreatingFromId(node.branch.id);
                    }}
                    className="absolute -top-3 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full
                               bg-emerald-500 text-white flex items-center justify-center
                               hover:bg-emerald-400 transition-colors shadow-lg
                               text-xs font-bold"
                    title="Create branch from here"
                  >
                    +
                  </button>
                )}

                {/* Delete button — shown on hover for non-root nodes */}
                {isHovered && !isRoot && !isCreatingBranch && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeletingBranchId(node.branch.id);
                    }}
                    className="absolute -top-2 -right-2 w-5 h-5 rounded-full
                               bg-red-500 text-white flex items-center justify-center
                               hover:bg-red-400 transition-colors shadow-lg"
                    title="Delete branch"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Branch naming modal */}
      {creatingFromId && !isCreatingBranch && (
        <div className="absolute inset-0 z-60 bg-[#0a1628]/80 flex items-center justify-center">
          <div className="bg-[#112240] border border-[#1e3a5f] rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-medium text-blue-50 mb-4">New Branch</h3>
            <input
              ref={nameInputRef}
              type="text"
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newBranchName.trim()) {
                  onCreateChild(creatingFromId, newBranchName.trim());
                  setCreatingFromId(null);
                }
                if (e.key === 'Escape') {
                  setCreatingFromId(null);
                }
              }}
              placeholder="Branch name..."
              autoFocus
              className="w-full px-4 py-2.5 rounded-lg bg-[#0a1628] border border-[#1e3a5f] text-blue-50
                         placeholder-blue-400/40 focus:outline-none focus:border-sky-500 text-sm"
            />
            <div className="flex justify-end gap-3 mt-5">
              <button
                onClick={() => setCreatingFromId(null)}
                className="px-4 py-2 rounded-lg text-sm text-blue-300 hover:text-blue-100 hover:bg-[#1e3a5f] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (newBranchName.trim()) {
                    onCreateChild(creatingFromId, newBranchName.trim());
                    setCreatingFromId(null);
                  }
                }}
                disabled={!newBranchName.trim()}
                className="px-4 py-2 rounded-lg text-sm bg-emerald-500 text-white hover:bg-emerald-400 transition-colors
                           disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deletingBranchId && (() => {
        const branchToDelete = branches.find(b => b.id === deletingBranchId);
        return (
          <div className="absolute inset-0 z-60 bg-[#0a1628]/80 flex items-center justify-center">
            <div className="bg-[#112240] border border-[#1e3a5f] rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
              <h3 className="text-lg font-medium text-blue-50 mb-2">Delete Branch</h3>
              <p className="text-blue-200/80 text-sm mb-6">
                Are you sure you want to delete <span className="font-medium text-blue-100">"{branchToDelete?.label || 'this branch'}"</span>?
                This will also delete all child branches and their conversations.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setDeletingBranchId(null)}
                  className="px-4 py-2 rounded-lg text-sm text-blue-300 hover:text-blue-100 hover:bg-[#1e3a5f] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onDeleteBranch(deletingBranchId);
                    setDeletingBranchId(null);
                  }}
                  className="px-4 py-2 rounded-lg text-sm bg-red-500 text-white hover:bg-red-400 transition-colors"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Loading overlay when creating branch */}
      {isCreatingBranch && (
        <div className="absolute inset-0 z-60 bg-[#0a1628]/80 flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <svg className="w-10 h-10 animate-spin text-sky-400" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sky-300 text-lg font-light">Compacting conversation...</span>
            <span className="text-blue-300/60 text-sm">Summarizing context for the new branch</span>
          </div>
        </div>
      )}
    </div>
  );
}
