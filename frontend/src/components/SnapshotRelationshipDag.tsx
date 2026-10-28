import { Link } from 'react-router-dom';

interface GraphObject {
  objectId: string;
  title: string;
  typeDisplay?: string;
  isRoot?: boolean;
  redacted?: boolean;
}

interface GraphLink {
  id?: string;
  from: string;
  to: string;
  linkKey: string;
  linkDisplay?: string;
}

interface PositionedObject extends GraphObject {
  x: number;
  y: number;
}

interface PositionedLink extends GraphLink {
  x: number;
  y: number;
}

const OBJECT_WIDTH = 248;
const OBJECT_HEIGHT = 92;
const RELATION_WIDTH = 144;
const RELATION_HEIGHT = 48;
const COLUMN_GAP = 82;
const OBJECT_ROW_GAP = 132;
const RELATION_ROW_GAP = 76;
const PADDING = 30;

function buildGraph(objects: GraphObject[], links: GraphLink[]) {
  const objectById = new Map(objects.map((object) => [object.objectId, object]));
  const ids = new Set([...objectById.keys(), ...links.flatMap((link) => [link.from, link.to])]);
  const indegree = new Map([...ids].map((id) => [id, 0]));
  const outgoing = new Map([...ids].map((id) => [id, [] as string[]]));
  links.forEach((link) => {
    indegree.set(link.to, (indegree.get(link.to) ?? 0) + 1);
    outgoing.get(link.from)?.push(link.to);
  });

  // 只按快照中的有向关系分层；有环时不伪造 DAG。
  const ready = [...ids].filter((id) => indegree.get(id) === 0);
  const ordered: string[] = [];
  const depth = new Map([...ids].map((id) => [id, 0]));
  while (ready.length) {
    const id = ready.shift()!;
    ordered.push(id);
    for (const next of outgoing.get(id) ?? []) {
      depth.set(next, Math.max(depth.get(next) ?? 0, (depth.get(id) ?? 0) + 1));
      indegree.set(next, (indegree.get(next) ?? 0) - 1);
      if (indegree.get(next) === 0) ready.push(next);
    }
  }
  if (ordered.length !== ids.size) return null;

  const objectLevels = new Map<number, string[]>();
  ordered.forEach((id) => {
    const level = depth.get(id) ?? 0;
    objectLevels.set(level, [...(objectLevels.get(level) ?? []), id]);
  });
  for (const group of objectLevels.values()) {
    group.sort((a, b) => Number(Boolean(objectById.get(b)?.isRoot)) - Number(Boolean(objectById.get(a)?.isRoot))
      || ordered.indexOf(a) - ordered.indexOf(b));
  }

  const maxLevel = Math.max(0, ...depth.values());
  const columnStep = OBJECT_WIDTH + RELATION_WIDTH + COLUMN_GAP * 2;
  const positionedObjects: PositionedObject[] = [...objectLevels].flatMap(([level, group]) =>
    group.map((id, row) => ({
      objectId: id,
      title: objectById.get(id)?.redacted ? '无权查看' : objectById.get(id)?.title || '无权查看',
      typeDisplay: objectById.get(id)?.redacted ? undefined : objectById.get(id)?.typeDisplay,
      isRoot: objectById.get(id)?.redacted ? false : objectById.get(id)?.isRoot,
      redacted: objectById.get(id)?.redacted ?? !objectById.has(id),
      x: PADDING + level * columnStep,
      y: PADDING + row * OBJECT_ROW_GAP,
    })));
  const positionById = new Map(positionedObjects.map((object) => [object.objectId, object]));
  const linkLevels = new Map<number, GraphLink[]>();
  links.forEach((link) => {
    const level = depth.get(link.from) ?? 0;
    linkLevels.set(level, [...(linkLevels.get(level) ?? []), link]);
  });
  const positionedLinks: PositionedLink[] = [...linkLevels].flatMap(([level, group]) =>
    group.map((link, row) => ({
      ...link,
      x: PADDING + level * columnStep + OBJECT_WIDTH + COLUMN_GAP,
      y: PADDING + row * RELATION_ROW_GAP + (OBJECT_HEIGHT - RELATION_HEIGHT) / 2,
    })));
  const maxRows = Math.max(1, ...[...objectLevels.values()].map((group) => group.length));
  const maxRelations = Math.max(1, ...[...linkLevels.values()].map((group) => group.length));
  return {
    objects: positionedObjects,
    links: positionedLinks,
    positionById,
    width: PADDING * 2 + maxLevel * columnStep + OBJECT_WIDTH,
    height: PADDING * 2 + Math.max((maxRows - 1) * OBJECT_ROW_GAP + OBJECT_HEIGHT,
      (maxRelations - 1) * RELATION_ROW_GAP + OBJECT_HEIGHT),
  };
}

function connector(fromX: number, fromY: number, toX: number, toY: number) {
  const bend = Math.min(60, Math.max(18, (toX - fromX) / 2));
  return `M ${fromX} ${fromY} C ${fromX + bend} ${fromY}, ${toX - bend} ${toY}, ${toX} ${toY}`;
}

export function SnapshotRelationshipDag({ objects, links }: { objects: GraphObject[]; links: GraphLink[] }) {
  if (!links.length) return <p className="text-sm text-muted-foreground">快照中没有可见的对象关系。</p>;
  const graph = buildGraph(objects, links);
  if (!graph) return <p className="text-sm text-muted-foreground">快照关系中存在环，无法按 DAG 排列。</p>;

  return <div className="overflow-x-auto rounded-md border border-border bg-muted/20">
    <svg width={graph.width} height={graph.height} viewBox={`0 0 ${graph.width} ${graph.height}`}
      aria-label="快照对象关系有向无环图" className="block">
      <defs>
        <marker id="snapshot-relationship-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4"
          orient="auto" markerUnits="userSpaceOnUse">
          <path d="M 0 0 L 8 4 L 0 8 z" fill="hsl(var(--muted-foreground))" />
        </marker>
      </defs>
      {graph.links.map((relation, index) => {
        const from = graph.positionById.get(relation.from)!;
        const to = graph.positionById.get(relation.to)!;
        const fromY = from.y + OBJECT_HEIGHT / 2;
        const relationY = relation.y + RELATION_HEIGHT / 2;
        const toY = to.y + OBJECT_HEIGHT / 2;
        const lineStyle = { fill: 'none', stroke: 'hsl(var(--muted-foreground))', strokeWidth: 1.5, opacity: 0.65 };
        return <g key={relation.id ?? `${relation.linkKey}:${relation.from}:${relation.to}:${index}`}>
          <path d={connector(from.x + OBJECT_WIDTH, fromY, relation.x - 8, relationY)} {...lineStyle}
            markerEnd="url(#snapshot-relationship-arrow)" />
          <path d={connector(relation.x + RELATION_WIDTH, relationY, to.x - 8, toY)} {...lineStyle}
            markerEnd="url(#snapshot-relationship-arrow)" />
        </g>;
      })}
      {graph.links.map((relation, index) => <foreignObject
        key={relation.id ?? `${relation.linkKey}:${relation.from}:${relation.to}:${index}`}
        x={relation.x} y={relation.y} width={RELATION_WIDTH} height={RELATION_HEIGHT}>
        <div title={relation.linkDisplay || relation.linkKey}
          className="flex h-full w-full items-center justify-center rounded-full border border-primary/40 bg-card px-2 text-center text-xs font-medium leading-tight text-primary">
          {relation.linkDisplay || relation.linkKey}
        </div>
      </foreignObject>)}
      {graph.objects.map((object) => <foreignObject key={object.objectId}
        x={object.x} y={object.y} width={OBJECT_WIDTH} height={OBJECT_HEIGHT}>
        <div className={`flex h-full w-full flex-col justify-center rounded-lg border bg-card px-3 py-2 shadow-sm ${
          object.isRoot ? 'border-primary' : 'border-border'}`}>
          <span className="text-[11px] text-muted-foreground">{object.isRoot ? '触发对象' : object.typeDisplay || '关联对象'}</span>
          {object.redacted ? <span className="mt-1 text-sm font-medium">无权查看</span> :
            <Link to={`/objects/${encodeURIComponent(object.objectId)}`} title={object.title}
              className="mt-1 break-words text-sm font-semibold leading-snug text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
              {object.title}
            </Link>}
        </div>
      </foreignObject>)}
    </svg>
    <ul className="sr-only">
      {links.map((link, index) => {
        const from = graph.positionById.get(link.from)!;
        const to = graph.positionById.get(link.to)!;
        return <li key={link.id ?? `${link.linkKey}:${link.from}:${link.to}:${index}`}>
          {from.title}，{link.linkDisplay || link.linkKey}，{to.title}
        </li>;
      })}
    </ul>
  </div>;
}
