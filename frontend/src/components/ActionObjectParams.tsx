import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { ObjectPicker } from '@/components/ObjectPicker';

type ActionDefinition = {
  paramsSchema?: {
    properties?: Record<string, { type?: string; format?: string; refType?: string }>;
    required?: string[];
  };
  approvalPolicy?: {
    legalAuthorityParam?: string;
    requiredAuthorityType?: string;
    relatedObjectParam?: string;
    relatedObjectType?: string;
  };
  writeSet?: Array<Record<string, unknown>>;
};

function objectFields(definition: ActionDefinition, params: Record<string, unknown>) {
  const schema = definition.paramsSchema ?? {};
  const policy = definition.approvalPolicy ?? {};
  const keys = new Set(Object.keys(schema.properties ?? {}).filter((key) =>
    key === 'objectId' || key.endsWith('ObjectId') ||
    schema.properties?.[key]?.format === 'object-id' || !!schema.properties?.[key]?.refType));
  if (Object.prototype.hasOwnProperty.call(params, 'objectId') ||
    JSON.stringify(definition.writeSet ?? []).includes('params.objectId')) keys.add('objectId');
  if (policy.legalAuthorityParam) keys.add(policy.legalAuthorityParam);
  if (policy.relatedObjectParam) keys.add(policy.relatedObjectParam);
  return [...keys].map((key) => ({
    key,
    label: key === 'objectId' ? '目标对象' : key === policy.legalAuthorityParam ? '法定授权对象'
      : key === policy.relatedObjectParam ? '关联对象' : key,
    typeKey: key === policy.legalAuthorityParam ? policy.requiredAuthorityType
      : key === policy.relatedObjectParam ? policy.relatedObjectType
        : schema.properties?.[key]?.refType,
    required: schema.required?.includes(key) ?? false,
  }));
}

export function ActionObjectParams({ actionKey, params, onChange, targetTypeKey, disabled = false }: {
  actionKey: string;
  params: Record<string, unknown>;
  onChange: (key: string, objectId: string) => void;
  targetTypeKey?: string;
  disabled?: boolean;
}) {
  const [definition, setDefinition] = useState<ActionDefinition | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setDefinition(null);
    setError('');
    if (!actionKey) return;
    let active = true;
    api.get<ActionDefinition>(`/action-types/${encodeURIComponent(actionKey)}`)
      .then((result) => { if (active) setDefinition(result); })
      .catch((failure: ApiError) => { if (active) setError(failure.message || '读取 Action 定义失败'); });
    return () => { active = false; };
  }, [actionKey]);

  if (!actionKey) return null;
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!definition) return <p className="text-sm text-muted-foreground">正在读取对象参数…</p>;
  const fields = objectFields(definition, params);
  if (!fields.length) return null;
  return <div className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2">
    {fields.map((field) => <ObjectPicker key={`${actionKey}-${field.key}`}
      label={`${field.label}（${field.key}）${field.required ? ' *' : ''}`}
      value={typeof params[field.key] === 'string' ? params[field.key] as string : ''}
      onChange={(objectId) => onChange(field.key, objectId)}
      typeKey={field.typeKey || (field.key === 'objectId' ? targetTypeKey : undefined)}
      disabled={disabled} />)}
  </div>;
}
