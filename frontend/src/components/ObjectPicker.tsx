import { useEffect, useId, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select } from '@/components/ui/Input';

export type ObjectOption = { objectId: string; title: string; typeKey: string };

export function ObjectPicker({ label, value, onChange, typeKey, disabled = false, excludeIds = [] }: {
  label: string;
  value: string;
  onChange: (objectId: string) => void;
  typeKey?: string;
  disabled?: boolean;
  excludeIds?: string[];
}) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [items, setItems] = useState<ObjectOption[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<ObjectOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const pageSize = 25;

  useEffect(() => { setOffset(0); }, [query, typeKey]);
  useEffect(() => {
    if (disabled) return;
    let active = true;
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String(offset) });
      if (typeKey) params.set('typeKey', typeKey);
      if (query.trim()) params.set('text', query.trim());
      setLoading(true);
      api.get<{ items: ObjectOption[]; total: number }>(`/objects?${params}`)
        .then((result) => {
          if (!active) return;
          setItems(result.items);
          setTotal(result.total);
          setError('');
        })
        .catch((failure: ApiError) => { if (active) setError(failure.message || '对象搜索失败'); })
        .finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [query, offset, typeKey, disabled]);

  useEffect(() => {
    if (!value) { setSelected(null); return; }
    const found = items.find((item) => item.objectId === value);
    if (found) { setSelected(found); return; }
    if (selected?.objectId === value) return;
    let active = true;
    api.get<ObjectOption>(`/objects/${encodeURIComponent(value)}`)
      .then((item) => { if (active) setSelected(item); })
      .catch(() => { if (active) setSelected({ objectId: value, title: value, typeKey: '' }); });
    return () => { active = false; };
  }, [value, items, selected?.objectId]);

  const options = selected && !items.some((item) => item.objectId === selected.objectId)
    ? [selected, ...items] : items;
  return <div className="space-y-1">
    <Label htmlFor={disabled ? `${id}-select` : `${id}-search`}>{label}</Label>
    {!disabled && <Input id={`${id}-search`} value={query} onChange={(event) => setQuery(event.target.value)}
      placeholder="按名称或属性搜索对象" aria-label={`搜索${label}`} />}
    <Select id={`${id}-select`} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}
      aria-label={label}>
      <option value="">请选择对象</option>
      {options.map((item) => <option key={item.objectId} value={item.objectId}
        disabled={excludeIds.includes(item.objectId)}>
        {item.title} · {item.typeKey || '对象'} · {item.objectId}
      </option>)}
    </Select>
    {!disabled && <div className="flex items-center justify-between text-xs text-muted-foreground">
      <span>{error || (loading ? '正在搜索…' : `${total} 个匹配对象`)}</span>
      <span className="flex items-center gap-1">
        <Button size="sm" variant="outline" disabled={offset === 0 || loading}
          onClick={() => setOffset(Math.max(0, offset - pageSize))}>上一页</Button>
        <Button size="sm" variant="outline" disabled={offset + pageSize >= total || loading}
          onClick={() => setOffset(offset + pageSize)}>下一页</Button>
      </span>
    </div>}
  </div>;
}
