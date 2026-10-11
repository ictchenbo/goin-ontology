/**
 * 数据导入页：CSV/JSON 摄取、字段映射、拒绝队列
 */
import React, { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Table, TBody, TD, TH, THeader, TR } from '@/components/ui/Table';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { formatTime } from '@/lib/utils';

interface IngestJob {
  id: string;
  status: string;
  filename?: string;
  sourceType?: string;
  totalRows?: number;
  acceptedRows?: number;
  rejectedRows?: number;
  createdAt?: string;
  errors?: Array<{ rowIndex?: number; message: string }>;
}

interface RejectedRow {
  id?: string;
  rowIndex?: number;
  row_index?: number;
  error?: string;
  raw?: Record<string, unknown>;
  rawJson?: Record<string, unknown>;
}
type IngestType = { typeKey: string; displayName: string; state: string };

export function IngestPage() {
  const { hasRole } = useAuth();
  const [jobs, setJobs] = useState<IngestJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [rejectedJobId, setRejectedJobId] = useState<string | null>(null);
  const [rejectedRows, setRejectedRows] = useState<RejectedRow[]>([]);
  const [sourceName, setSourceName] = useState('demo-source');
  const [targetType, setTargetType] = useState('Supplier');
  const [types, setTypes] = useState<IngestType[]>([]);
  const [matchKeys, setMatchKeys] = useState('code');
  const [format, setFormat] = useState('csv');
  const [content, setContent] = useState(
    'code,name,status\nSUP-001,华东供应,qualified\nSUP-002,西部供应,pending'
  );
  const [fieldMap, setFieldMap] = useState('{"code":"code","name":"name","status":"status"}');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<{ items?: IngestJob[] } | IngestJob[]>('/ingest/jobs');
      setJobs(Array.isArray(r) ? r : r.items || []);
    } catch (e) {
      setError((e as ApiError)?.message || '加载导入记录失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    void api.get<{ items: IngestType[] }>('/ontology/types').then((result) => {
      const published = result.items.filter((item) => item.state === 'published');
      setTypes(published);
      if (!published.some((item) => item.typeKey === targetType)) setTargetType(published[0]?.typeKey ?? '');
    }).catch((failure: ApiError) => setError(failure.message || '加载对象类型失败'));
  }, []);
  useEffect(() => {
    if (!targetType) return;
    void api.get<{ publishedDefinition: { properties: Array<{ name: string; required?: boolean }> } }>(
      `/ontology/types/${encodeURIComponent(targetType)}`).then((type) => {
      const names = type.publishedDefinition.properties.map((property) => property.name);
      setFieldMap(JSON.stringify(Object.fromEntries(names.map((name) => [name, name])), null, 2));
      setMatchKeys(names.find((name) => /^(id|code)$|(?:Id|Code|_id|_code)$/.test(name)) ?? '');
      setContent((current) => current ? current : format === 'json' ? '[\n  {}\n]' : names.join(',') + '\n');
    }).catch((failure: ApiError) => setError(failure.message || '加载类型属性失败'));
  }, [targetType]);

  /**
   * 提交导入：
   * 1) 先按格式解析内容（CSV 直接传文本，JSON 解析为 rows 数组）
   * 2) 创建任务（带 mapping：typeKey + fieldMap + matchKeys）
   * 3) 立即调用 /apply 落库，避免任务停留在 pending
   */
  async function handleSubmit() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      // 解析字段映射
      let fieldMapObj: Record<string, string>;
      try {
        fieldMapObj = JSON.parse(fieldMap || '{}');
      } catch {
        setError('字段映射 JSON 格式错误');
        return;
      }
      if (!content || !content.trim()) {
        setError('数据内容不能为空');
        return;
      }
      if (!targetType) { setError('请选择目标类型'); return; }
      const keys = matchKeys.split(',').map((key) => key.trim()).filter(Boolean);
      if (keys.some((key) => !fieldMapObj[key])) {
        setError('匹配键必须是字段映射中的源字段名'); return;
      }

      // 按格式构造请求体：CSV 传 csv 文本，JSON 解析为 rows 数组
      const body: Record<string, unknown> = {
        filename: sourceName || 'upload',
        mapping: {
          typeKey: targetType,
          fieldMap: fieldMapObj,
          matchKeys: keys,
          sourceKey: sourceName || 'upload',
        },
      };
      if (format === 'csv') {
        body.csv = content;
      } else {
        try {
          const parsed = JSON.parse(content);
          if (!Array.isArray(parsed)) throw new Error('not-array');
          body.rows = parsed;
        } catch {
          setError('JSON 内容必须是对象数组，例如 [{...},{...}]');
          return;
        }
      }

      // 创建任务
      const created = await api.post<{ id?: string; jobId?: string }>('/ingest/jobs', body);
      const jobId = created?.id || created?.jobId;
      if (!jobId) {
        setError('导入任务创建失败：未返回任务 ID');
        return;
      }

      // 立即执行导入（写入对象实例）
      try {
        const result = await api.post<{ accepted?: number; rejected?: number; applied?: number }>(
          `/ingest/jobs/${jobId}/apply`,
          {}
        );
        const ok = result?.accepted ?? 0;
        const bad = result?.rejected ?? 0;
        setInfo(`导入完成：接受 ${ok} 行，拒绝 ${bad} 行`);
      } catch (e) {
        setError(`任务已创建（${jobId}），但执行失败：${(e as ApiError)?.message || '未知错误'}`);
      }

      setContent('');
      await load();
    } catch (e) {
      setError((e as ApiError)?.message || '导入失败');
    } finally {
      setBusy(false);
    }
  }

  const canIngest = hasRole('analyst', 'intel', 'admin');

  /** 查看拒绝队列：展示被拒行及原因，便于修正后重导 */
  async function loadRejected(jobId: string) {
    if (rejectedJobId === jobId) {
      setRejectedJobId(null);
      setRejectedRows([]);
      return;
    }
    setError(null);
    try {
      const r = await api.get<{ items?: RejectedRow[] } | RejectedRow[]>(`/ingest/jobs/${jobId}/rejected`);
      const items = Array.isArray(r) ? r : r.items || [];
      setRejectedRows(items);
      setRejectedJobId(jobId);
    } catch (e) {
      setError((e as ApiError)?.message || '加载拒绝队列失败');
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">数据导入</h1>
        <p className="text-muted-foreground">
          支持 CSV/JSON，按 matchKeys 匹配已有对象进行更新；失败行进入拒绝队列。
        </p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {info && <Alert variant="success">{info}</Alert>}

      {canIngest && (
        <Card>
          <CardHeader>
            <CardTitle>新建导入任务</CardTitle>
            <CardDescription>粘贴 CSV 文本或 JSON 数组，配置字段映射后提交。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="sourceName">来源名称</Label>
                <Input id="sourceName" value={sourceName} onChange={(e) => setSourceName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="targetType">目标类型</Label>
                <Select id="targetType" value={targetType} onChange={(e) => {
                  setTargetType(e.target.value); setContent('');
                }}>
                  {!types.length && <option value="">暂无已发布类型</option>}
                  {types.map((type) => <option key={type.typeKey} value={type.typeKey}>
                    {type.displayName} ({type.typeKey})</option>)}
                </Select>
              </div>
              <div>
                <Label htmlFor="format">格式</Label>
                <Select id="format" value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="csv">CSV</option>
                  <option value="json">JSON</option>
                </Select>
              </div>
            </div>
            <div><Label htmlFor="matchKeys">匹配键（源字段名，逗号分隔；留空则仅按来源记录去重）</Label>
              <Input id="matchKeys" value={matchKeys} onChange={(event) => setMatchKeys(event.target.value)}
                placeholder="例如 readingId" /></div>
            <div>
              <Label htmlFor="content">数据内容</Label>
              <Textarea
                id="content"
                rows={6}
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label htmlFor="fieldMap">字段映射 JSON</Label>
              <Textarea
                id="fieldMap"
                rows={3}
                value={fieldMap}
                onChange={(e) => setFieldMap(e.target.value)}
                className="font-mono text-xs"
              />
            </div>
            <Button onClick={handleSubmit} disabled={busy}>
              {busy ? '提交中…' : '提交导入'}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>导入任务</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">加载中…</p>
          ) : jobs.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">暂无导入任务</p>
          ) : (
            <Table>
              <THeader>
                <TR>
                  <TH>来源</TH>
                  <TH>状态</TH>
                  <TH>总行</TH>
                  <TH>接受</TH>
                  <TH>拒绝</TH>
                  <TH>时间</TH>
                  <TH>操作</TH>
                </TR>
              </THeader>
              <TBody>
                {jobs.map((j) => (
                  <TR key={j.id}>
                    <TD>{j.filename || j.id}</TD>
                    <TD>
                      <Badge variant={statusVariant(j.status)}>{j.status}</Badge>
                    </TD>
                    <TD>{j.totalRows ?? '—'}</TD>
                    <TD>{j.acceptedRows ?? '—'}</TD>
                    <TD className="text-destructive">{j.rejectedRows ?? 0}</TD>
                    <TD className="text-xs text-muted-foreground">{formatTime(j.createdAt)}</TD>
                    <TD>
                      {(j.rejectedRows ?? 0) > 0 && (
                        <Button size="sm" variant="outline" onClick={() => loadRejected(j.id)}>
                          {rejectedJobId === j.id ? '收起拒绝队列' : '查看拒绝队列'}
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {rejectedJobId && (
        <Card>
          <CardHeader>
            <CardTitle>拒绝队列 · {rejectedJobId}</CardTitle>
            <CardDescription>校验失败的行不会落库，可修正数据后重新导入。</CardDescription>
          </CardHeader>
          <CardContent>
            {rejectedRows.length === 0 ? (
              <p className="text-muted-foreground">无拒绝行</p>
            ) : (
              <Table>
                <THeader>
                  <TR>
                    <TH>行号</TH>
                    <TH>原始数据</TH>
                    <TH>原因</TH>
                  </TR>
                </THeader>
                <TBody>
                  {rejectedRows.map((r, i) => (
                    <TR key={r.id || i}>
                      <TD>{r.rowIndex ?? r.row_index ?? i + 1}</TD>
                      <TD className="max-w-[320px] font-mono text-xs">
                        {JSON.stringify(r.raw || r.rawJson || {})}
                      </TD>
                      <TD className="text-xs text-destructive">{r.error || '—'}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
