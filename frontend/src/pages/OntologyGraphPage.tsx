/** 按当前应用领域的对象类型与关系定义绘制本体概念图。 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { api, type ApiError } from '@/lib/api';
import { getCurrentDomain } from '@/lib/domain';

type ObjectType = {
  typeKey: string; displayName: string; category: string; state: string;
};
type LinkDef = {
  linkKey: string; displayName: string; fromType: string; toType: string;
  cardinality: string; state: string;
};
type GraphNode = {
  id: string; key: string; label: string; kind: 'type' | 'link';
  state: string; category?: string; x: number; y: number;
};
type GraphEdge = { from: string; to: string; linkKey: string };
type Graph = { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number };

const TYPE_WIDTH = 188;
const LINK_WIDTH = 226;
const NODE_HEIGHT = 58;
const GRAPH_WIDTH = 950;
const ROW_HEIGHT = 76;

function graphError(error: unknown): string {
  return (error as ApiError)?.message || (error instanceof Error ? error.message : '加载关系图失败');
}

function buildGraph(types: ObjectType[], links: LinkDef[]): Graph {
  const sortedLinks = [...links].sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-CN'));
  const scores = new Map<string, { total: number; count: number; outgoing: number; incoming: number }>();
  types.forEach((type) => scores.set(type.typeKey, { total: 0, count: 0, outgoing: 0, incoming: 0 }));
  sortedLinks.forEach((link, index) => {
    const from = scores.get(link.fromType);
    const to = scores.get(link.toType);
    if (from) { from.total += index; from.count++; from.outgoing++; }
    if (to) { to.total += index; to.count++; to.incoming++; }
  });
  const orderedTypes = [...types].sort((a, b) => {
    const left = scores.get(a.typeKey)!;
    const right = scores.get(b.typeKey)!;
    return (left.count ? left.total / left.count : Number.MAX_SAFE_INTEGER) -
      (right.count ? right.total / right.count : Number.MAX_SAFE_INTEGER) ||
      a.displayName.localeCompare(b.displayName, 'zh-CN');
  });
  const sourceTypes: ObjectType[] = [];
  const targetTypes: ObjectType[] = [];
  orderedTypes.forEach((type) => {
    const score = scores.get(type.typeKey)!;
    if (score.outgoing > score.incoming || (score.outgoing === score.incoming && sourceTypes.length <= targetTypes.length)) {
      sourceTypes.push(type);
    } else targetTypes.push(type);
  });
  const rows = Math.max(6, sortedLinks.length, sourceTypes.length, targetTypes.length);
  const height = 120 + rows * ROW_HEIGHT;
  const atRow = (index: number, count: number) => 60 + (index + 1) * (height - 120) / (count + 1);
  const typeNode = (type: ObjectType, x: number, y: number): GraphNode => ({
    id: `type:${type.typeKey}`, key: type.typeKey, label: type.displayName,
    kind: 'type', state: type.state, category: type.category, x, y,
  });
  const nodes: GraphNode[] = [
    ...sourceTypes.map((type, index) => typeNode(type, 125, atRow(index, sourceTypes.length))),
    ...targetTypes.map((type, index) => typeNode(type, 825, atRow(index, targetTypes.length))),
    ...sortedLinks.map((link, index): GraphNode => ({
      id: `link:${link.linkKey}`, key: link.linkKey, label: link.displayName,
      kind: 'link', state: link.state, x: 475, y: atRow(index, sortedLinks.length),
    })),
  ];
  const edges = sortedLinks.flatMap((link): GraphEdge[] => [
    { from: `type:${link.fromType}`, to: `link:${link.linkKey}`, linkKey: link.linkKey },
    { from: `link:${link.linkKey}`, to: `type:${link.toType}`, linkKey: link.linkKey },
  ]);
  return { nodes, edges, width: GRAPH_WIDTH, height };
}

function edgePath(from: GraphNode, to: GraphNode): string {
  const fromSide = Math.sign(to.x - from.x);
  const toSide = Math.sign(from.x - to.x);
  const startX = from.x + fromSide * (from.kind === 'link' ? LINK_WIDTH : TYPE_WIDTH) / 2;
  const endX = to.x + toSide * (to.kind === 'link' ? LINK_WIDTH : TYPE_WIDTH) / 2;
  const controlX = (startX + endX) / 2;
  return `M ${startX} ${from.y} C ${controlX} ${from.y}, ${controlX} ${to.y}, ${endX} ${to.y}`;
}

function GraphCanvas({ graph, selectedId, onSelect }: {
  graph: Graph; selectedId: string; onSelect: (id: string) => void;
}) {
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const selectedLinks = new Set(graph.edges.filter((edge) =>
    edge.from === selectedId || edge.to === selectedId).map((edge) => edge.linkKey));
  if (selectedId.startsWith('link:')) selectedLinks.add(selectedId.slice(5));
  const activeNodes = new Set(graph.edges.filter((edge) => selectedLinks.has(edge.linkKey))
    .flatMap((edge) => [edge.from, edge.to]));
  activeNodes.add(selectedId);
  return <div className="max-h-[72vh] overflow-auto rounded-lg border border-border bg-muted/30">
    <svg width={graph.width} height={graph.height} viewBox={`0 0 ${graph.width} ${graph.height}`}
      aria-label="当前领域的本体对象类型与关系定义图" className="block">
      <defs><marker id="ontology-graph-arrow" markerWidth="9" markerHeight="9" refX="8" refY="4.5"
        orient="auto" markerUnits="userSpaceOnUse">
        <path d="M 0 0 L 9 4.5 L 0 9 z" fill="hsl(var(--muted-foreground))" />
      </marker></defs>
      {graph.edges.map((edge) => {
        const from = nodeById.get(edge.from);
        const to = nodeById.get(edge.to);
        if (!from || !to) return null;
        const active = selectedLinks.has(edge.linkKey);
        return <path key={`${edge.linkKey}:${edge.from}:${edge.to}`} d={edgePath(from, to)} fill="none"
          stroke={active ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))'}
          strokeWidth={active ? 2.5 : 1.5} opacity={selectedId && !active ? 0.15 : 0.55}
          markerEnd="url(#ontology-graph-arrow)" />;
      })}
      {graph.nodes.map((node) => {
        const isLink = node.kind === 'link';
        const width = isLink ? LINK_WIDTH : TYPE_WIDTH;
        const faded = selectedId && !activeNodes.has(node.id);
        const maxLength = isLink ? 15 : 13;
        const caption = node.label.length > maxLength ? `${node.label.slice(0, maxLength - 1)}…` : node.label;
        return <g key={node.id} role="button" tabIndex={0}
          aria-label={`${isLink ? '关系' : '对象类型'}：${node.label}`}
          onClick={() => onSelect(node.id)}
          onFocus={() => onSelect(node.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(node.id); }
          }}
          className="cursor-pointer outline-none" opacity={faded ? 0.35 : 1}>
          <title>{node.label} · {node.key}</title>
          <rect x={node.x - width / 2} y={node.y - NODE_HEIGHT / 2} width={width} height={NODE_HEIGHT}
            rx="11" fill={isLink ? 'hsl(var(--primary) / 0.12)' : 'hsl(var(--card))'}
            stroke={selectedId === node.id ? 'hsl(var(--primary))' : 'hsl(var(--border))'}
            strokeWidth={selectedId === node.id ? 3 : 1.5}
            strokeDasharray={node.state === 'draft' ? '5 3' : undefined} />
          <text x={node.x} y={node.y - 3} textAnchor="middle" dominantBaseline="middle"
            fill="hsl(var(--foreground))" fontSize="14" fontWeight="600">{caption}</text>
          <text x={node.x} y={node.y + 17} textAnchor="middle" dominantBaseline="middle"
            fill="hsl(var(--muted-foreground))" fontSize="11">{isLink ? '关系定义' : node.category === 'event' ? '事件类型' : '对象类型'}</text>
        </g>;
      })}
    </svg>
  </div>;
}

export function OntologyGraphPage() {
  const [domain, setDomain] = useState(getCurrentDomain);
  const [types, setTypes] = useState<ObjectType[]>([]);
  const [links, setLinks] = useState<LinkDef[]>([]);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const onDomainChange = () => setDomain(getCurrentDomain());
    window.addEventListener('domain-change', onDomainChange);
    return () => window.removeEventListener('domain-change', onDomainChange);
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setTypes([]); setLinks([]); setSelectedId('');
    Promise.all([
      api.get<{ items: ObjectType[] }>('/ontology/types'),
      api.get<{ items: LinkDef[] }>('/ontology/links'),
    ]).then(([typeResult, linkResult]) => {
      if (!active) return;
      setTypes(typeResult.items);
      setLinks(linkResult.items);
    }).catch((failure) => { if (active) setError(graphError(failure)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [domain?.id, refreshKey]);

  const visible = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    const typeByKey = new Map(types.map((type) => [type.typeKey, type]));
    const validLinks = links.filter((link) => typeByKey.has(link.fromType) && typeByKey.has(link.toType));
    if (!term) return { types, links: validLinks };
    const typeMatches = new Set(types.filter((type) =>
      `${type.displayName} ${type.typeKey}`.toLocaleLowerCase().includes(term)).map((type) => type.typeKey));
    const relatedLinks = validLinks.filter((link) =>
      `${link.displayName} ${link.linkKey}`.toLocaleLowerCase().includes(term) ||
      typeMatches.has(link.fromType) || typeMatches.has(link.toType));
    const relatedTypes = new Set(relatedLinks.flatMap((link) => [link.fromType, link.toType]));
    return { types: types.filter((type) => typeMatches.has(type.typeKey) || relatedTypes.has(type.typeKey)),
      links: relatedLinks };
  }, [types, links, query]);
  const graph = useMemo(() => buildGraph(visible.types, visible.links), [visible]);
  const selected = graph.nodes.find((node) => node.id === selectedId);
  const selectedLink = selected?.kind === 'link' ? links.find((link) => link.linkKey === selected.key) : undefined;
  const typeByKey = new Map(types.map((type) => [type.typeKey, type]));
  const relatedCount = selected?.kind === 'type' ? links.filter((link) =>
    link.fromType === selected.key || link.toType === selected.key).length : 0;

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><Link to="/ontology/types" className="text-sm text-primary hover:underline">← 返回本体模型管理</Link>
        <h1 className="mt-2 text-2xl font-bold">概念关系图</h1>
        <p className="mt-1 text-sm text-muted-foreground">{domain?.displayName ?? '当前领域'} · 对象类型 → 关系定义 → 对象类型</p></div>
      <Button variant="outline" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading}>刷新</Button>
    </div>
    {error && <Alert variant="error">{error}</Alert>}
    <Card><CardContent className="space-y-4 pt-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-sm space-y-1">
          <label htmlFor="ontology-graph-search" className="text-sm font-medium">搜索概念</label>
          <Input id="ontology-graph-search" value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="对象类型、关系名称或标识" />
        </div>
        <p className="text-sm text-muted-foreground">{visible.types.length} 个对象类型 · {visible.links.length} 个关系定义</p>
      </div>
      {loading ? <p role="status" className="py-12 text-center text-sm text-muted-foreground">正在加载当前领域的概念关系…</p>
        : graph.nodes.length ? <div className="space-y-3">
          <aside className="min-h-16 rounded-lg border border-border bg-card px-4 py-3 text-sm" aria-label="所选概念详情">
            {selected ? <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <div><span className="text-xs text-muted-foreground">{selected.kind === 'link' ? '关系定义' : '对象类型'}</span>
                <h2 className="font-semibold">{selected.label}</h2></div>
              <span className="break-all font-mono text-xs text-muted-foreground">{selected.key}</span>
              <span>状态：{selected.state === 'published' ? '已发布' : '草稿'}</span>
              {selectedLink ? <span>{typeByKey.get(selectedLink.fromType)?.displayName ?? selectedLink.fromType}
                {' → '}{typeByKey.get(selectedLink.toType)?.displayName ?? selectedLink.toType} · {selectedLink.cardinality}</span>
                : <span>关联关系：{relatedCount} 个</span>}
              <Link className="font-medium text-primary hover:underline"
                to={`/ontology/${selected.kind === 'link' ? 'links' : 'types'}/${encodeURIComponent(selected.key)}`}>查看定义详情 →</Link>
            </div> : <p className="text-muted-foreground">选择节点，查看名称、状态和关联定义。虚线边框表示草稿。</p>}
          </aside>
          <GraphCanvas graph={graph} selectedId={selectedId} onSelect={setSelectedId} />
        </div> : <p className="py-12 text-center text-sm text-muted-foreground">
          {query ? '没有匹配的概念或关系' : '当前领域还没有对象类型'}</p>}
    </CardContent></Card>
  </div>;
}
