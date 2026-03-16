import { useEffect, useRef, useState } from 'react';
import { Network, GitBranch, Link, AlertCircle, Copy, ExternalLink, Package, ArrowDown, Shuffle, User, ArrowRight } from 'lucide-react';
import { api } from '@/api/client';

interface RelationshipNode {
  id: string;
  type: string;
  label: string;
}

interface RelationshipEdge {
  source: string;
  target: string;
  type: string;
  strength: number;
  bidirectional: boolean;
}

interface RelationshipGraphProps {
  entityType: string;
  entityId: string;
  maxDepth?: number;
}

const relationshipIcons: Record<string, any> = {
  related_to: Link,
  parent_child: GitBranch,
  depends_on: ArrowRight,
  blocks: AlertCircle,
  duplicates: Copy,
  references: ExternalLink,
  assigned_to: User,
  part_of: Package,
  follows: ArrowDown,
  similar_to: Shuffle,
};

const relationshipColors: Record<string, string> = {
  related_to: '#3B82F6',
  parent_child: '#A855F7',
  depends_on: '#F97316',
  blocks: '#EF4444',
  duplicates: '#EAB308',
  references: '#10B981',
  assigned_to: '#6366F1',
  part_of: '#14B8A6',
  follows: '#06B6D4',
  similar_to: '#6B7280',
};

export default function RelationshipGraph({ entityType, entityId, maxDepth = 2 }: RelationshipGraphProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [graph, setGraph] = useState<{ nodes: RelationshipNode[]; edges: RelationshipEdge[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  useEffect(() => {
    fetchGraph();
  }, [entityType, entityId, maxDepth]);

  useEffect(() => {
    if (graph && canvasRef.current) {
      drawGraph();
    }
  }, [graph, selectedNode, hoveredNode]);

  const fetchGraph = async () => {
    try {
      setLoading(true);
      const data = await api.get(`/relationships/${entityType}/${entityId}/graph?maxDepth=${maxDepth}`) as any;
      setGraph(data.graph);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  const drawGraph = () => {
    const canvas = canvasRef.current;
    if (!canvas || !graph) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Simple force-directed layout
    const nodePositions = new Map<string, { x: number; y: number }>();
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 3;

    // Position nodes in a circle
    graph.nodes.forEach((node, index) => {
      const angle = (index / graph.nodes.length) * 2 * Math.PI;
      const x = centerX + radius * Math.cos(angle);
      const y = centerY + radius * Math.sin(angle);
      nodePositions.set(node.id, { x, y });
    });

    // Draw edges
    graph.edges.forEach((edge) => {
      const sourcePos = nodePositions.get(edge.source);
      const targetPos = nodePositions.get(edge.target);

      if (!sourcePos || !targetPos) return;

      ctx.beginPath();
      ctx.moveTo(sourcePos.x, sourcePos.y);
      ctx.lineTo(targetPos.x, targetPos.y);

      const color = relationshipColors[edge.type] || '#6B7280';
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, edge.strength / 25);
      ctx.globalAlpha = 0.6;
      ctx.stroke();

      // Draw arrow if not bidirectional
      if (!edge.bidirectional) {
        const angle = Math.atan2(targetPos.y - sourcePos.y, targetPos.x - sourcePos.x);
        const arrowSize = 10;
        ctx.beginPath();
        ctx.moveTo(targetPos.x, targetPos.y);
        ctx.lineTo(
          targetPos.x - arrowSize * Math.cos(angle - Math.PI / 6),
          targetPos.y - arrowSize * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(
          targetPos.x - arrowSize * Math.cos(angle + Math.PI / 6),
          targetPos.y - arrowSize * Math.sin(angle + Math.PI / 6)
        );
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      }

      ctx.globalAlpha = 1;
    });

    // Draw nodes
    graph.nodes.forEach((node) => {
      const pos = nodePositions.get(node.id);
      if (!pos) return;

      const isRoot = node.id === `${entityType}:${entityId}`;
      const isSelected = selectedNode === node.id;
      const isHovered = hoveredNode === node.id;

      const nodeRadius = isRoot ? 30 : 20;

      // Draw node circle
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, nodeRadius, 0, 2 * Math.PI);
      ctx.fillStyle = isRoot ? '#3B82F6' : isSelected ? '#10B981' : isHovered ? '#6366F1' : '#E5E7EB';
      ctx.fill();
      ctx.strokeStyle = isRoot ? '#1E40AF' : '#9CA3AF';
      ctx.lineWidth = isSelected || isHovered ? 3 : 2;
      ctx.stroke();

      // Draw node label
      ctx.fillStyle = '#1F2937';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(node.type, pos.x, pos.y + nodeRadius + 15);
    });
  };

  const handleCanvasClick = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!graph || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    // Check if click is on a node
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 3;

    graph.nodes.forEach((node, index) => {
      const angle = (index / graph.nodes.length) * 2 * Math.PI;
      const nodeX = centerX + radius * Math.cos(angle);
      const nodeY = centerY + radius * Math.sin(angle);
      const nodeRadius = node.id === `${entityType}:${entityId}` ? 30 : 20;

      const distance = Math.sqrt((x - nodeX) ** 2 + (y - nodeY) ** 2);
      if (distance <= nodeRadius) {
        setSelectedNode(node.id === selectedNode ? null : node.id);
      }
    });
  };

  const handleCanvasMouseMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    if (!graph || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) / 3;

    let foundNode = false;

    graph.nodes.forEach((node, index) => {
      const angle = (index / graph.nodes.length) * 2 * Math.PI;
      const nodeX = centerX + radius * Math.cos(angle);
      const nodeY = centerY + radius * Math.sin(angle);
      const nodeRadius = node.id === `${entityType}:${entityId}` ? 30 : 20;

      const distance = Math.sqrt((x - nodeX) ** 2 + (y - nodeY) ** 2);
      if (distance <= nodeRadius) {
        setHoveredNode(node.id);
        foundNode = true;
      }
    });

    if (!foundNode) {
      setHoveredNode(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/30">
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-center">
        <Network size={48} className="mb-3 text-slate-300 dark:text-slate-600" />
        <p className="text-sm text-slate-500 dark:text-slate-400">Нет связей</p>
        <p className="text-xs text-slate-400 dark:text-slate-500">Связи между объектами появятся здесь</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <canvas
          ref={canvasRef}
          width={800}
          height={600}
          className="w-full cursor-pointer"
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMouseMove}
        />
      </div>

      {/* Legend */}
      <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
        <h3 className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">Типы связей</h3>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-5">
          {Object.entries(relationshipColors).map(([type, color]) => {
            const Icon = relationshipIcons[type] || Link;
            return (
              <div key={type} className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded" style={{ backgroundColor: color + '20' }}>
                  <Icon size={14} style={{ color }} />
                </div>
                <span className="text-xs text-slate-600 dark:text-slate-400">{type.replace(/_/g, ' ')}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs text-slate-500 dark:text-slate-400">Узлов</p>
          <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{graph.nodes.length}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs text-slate-500 dark:text-slate-400">Связей</p>
          <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{graph.edges.length}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
          <p className="text-xs text-slate-500 dark:text-slate-400">Глубина</p>
          <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{maxDepth}</p>
        </div>
      </div>
    </div>
  );
}
