// 哈希工具：用于审计 before/after 与来源记录去重
import crypto from 'crypto';

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function stableHash(value: unknown): string {
  return sha256(stableStringify(value));
}

// 稳定序列化：对象键排序，保证同一对象哈希一致
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function shortHash(value: unknown): string {
  return stableHash(value).slice(0, 16);
}
