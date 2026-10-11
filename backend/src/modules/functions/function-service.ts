// 自定义计算函数：仅允许安全 DSL 表达式，不执行用户提交的 JavaScript。
import { getDb, nowIso } from '../../db/database';
import { AppError } from '../../shared/errors';
import {
  evaluate, expressionDependencies, isBuiltinFunction, setCustomFunctionResolver,
} from '../../shared/rule-dsl';
import { writeAudit } from '../audit/audit-service';

export interface FunctionInput {
  functionKey: string;
  name: string;
  description?: string;
  parameters: string[];
  expression: string;
  outputType?: string;
}

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
const OUTPUT_TYPES = new Set(['number', 'string', 'boolean', 'datetime', 'json']);
const stack: string[] = [];

function mapFunction(row: any) {
  return {
    functionKey: row.function_key as string,
    name: row.name as string,
    description: row.description as string,
    parameters: JSON.parse(row.parameters_json || '[]') as string[],
    expression: row.expression as string,
    outputType: row.output_type as string,
    version: row.version as number,
    state: row.state as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function getFunction(functionKey: string) {
  const row = getDb().prepare('SELECT * FROM function_def WHERE function_key = ?').get(functionKey) as any;
  if (!row) throw new AppError('NOT_FOUND', `函数不存在: ${functionKey}`);
  return mapFunction(row);
}

export function listFunctions() {
  return (getDb().prepare('SELECT * FROM function_def ORDER BY function_key').all() as any[]).map(mapFunction);
}

function references(functionKey: string): string[] {
  const db = getDb();
  const call = new RegExp(`\\b${functionKey}\\s*\\(`, 'i');
  const refs: string[] = [];
  for (const row of db.prepare('SELECT rule_key, expression FROM rule_def').all() as any[]) {
    if (call.test(String(row.expression))) refs.push(`rule:${row.rule_key}`);
  }
  for (const row of db.prepare('SELECT action_key, preconditions FROM action_type').all() as any[]) {
    if (call.test(String(row.preconditions))) refs.push(`action:${row.action_key}`);
  }
  for (const row of db.prepare('SELECT type_key, criteria, constraints FROM decision_type').all() as any[]) {
    if (call.test(`${row.criteria} ${row.constraints}`)) refs.push(`decision:${row.type_key}`);
  }
  for (const row of db.prepare('SELECT function_key, expression FROM function_def WHERE function_key != ?').all(functionKey) as any[]) {
    if (call.test(String(row.expression))) refs.push(`function:${row.function_key}`);
  }
  return refs;
}

export function upsertFunction(input: FunctionInput, actor: string) {
  const key = input.functionKey?.trim().toLowerCase();
  const parameters = input.parameters;
  if (!key || !IDENTIFIER.test(key) || isBuiltinFunction(key)) {
    throw new AppError('VALIDATION_ERROR', '函数标识需为小写字母、数字或下划线，且不能覆盖内置函数');
  }
  if (!input.name?.trim() || !input.expression?.trim()) {
    throw new AppError('VALIDATION_ERROR', '函数名称和表达式必填');
  }
  if (!Array.isArray(parameters) || parameters.some((p) => typeof p !== 'string' || !IDENTIFIER.test(p))) {
    throw new AppError('VALIDATION_ERROR', '参数名需为小写字母、数字或下划线');
  }
  if (new Set(parameters).size !== parameters.length) throw new AppError('VALIDATION_ERROR', '参数名不能重复');
  if (!OUTPUT_TYPES.has(input.outputType ?? 'number')) throw new AppError('VALIDATION_ERROR', '输出类型不受支持');

  const dependencies = expressionDependencies(input.expression);
  const unknown = dependencies.filter((dep) => !parameters.includes(dep.split('.')[0]));
  if (unknown.length) throw new AppError('VALIDATION_ERROR', `表达式引用了未声明参数: ${unknown.join(', ')}`);

  const db = getDb();
  const existing = db.prepare('SELECT * FROM function_def WHERE function_key = ?').get(key) as any;
  if (existing) {
    const previous = JSON.parse(existing.parameters_json) as string[];
    if (JSON.stringify(previous) !== JSON.stringify(parameters) && references(key).length) {
      throw new AppError('CONFLICT', '函数已有引用，不能更改参数签名');
    }
    db.prepare(`UPDATE function_def SET name = ?, description = ?, parameters_json = ?, expression = ?,
      output_type = ?, version = version + 1, updated_at = ? WHERE function_key = ?`).run(
      input.name.trim(), input.description ?? '', JSON.stringify(parameters), input.expression.trim(),
      input.outputType ?? 'number', nowIso(), key,
    );
  } else {
    db.prepare(`INSERT INTO function_def (function_key, name, description, parameters_json, expression,
      output_type, version, state, created_at, updated_at) VALUES (?,?,?,?,?,?,1,'published',?,?)`).run(
      key, input.name.trim(), input.description ?? '', JSON.stringify(parameters), input.expression.trim(),
      input.outputType ?? 'number', nowIso(), nowIso(),
    );
  }
  writeAudit({ actor, eventType: 'function.upserted', resourceType: 'function_def', resourceId: key,
    after: { expression: input.expression, parameters } });
  return getFunction(key);
}

export function deleteFunction(functionKey: string, actor: string) {
  const before = getFunction(functionKey);
  const refs = references(functionKey);
  if (refs.length) throw new AppError('CONFLICT', `函数仍被引用: ${refs.join(', ')}`, { references: refs });
  getDb().prepare('DELETE FROM function_def WHERE function_key = ?').run(functionKey);
  writeAudit({ actor, eventType: 'function.deleted', resourceType: 'function_def', resourceId: functionKey, before });
  return { functionKey, deleted: true };
}

function resolveFunction(functionKey: string, args: unknown[]): unknown {
  const def = getFunction(functionKey);
  if (args.length !== def.parameters.length) {
    throw new AppError('VALIDATION_ERROR', `函数 ${functionKey} 需要 ${def.parameters.length} 个参数，实际 ${args.length}`);
  }
  if (stack.includes(functionKey) || stack.length >= 16) {
    throw new AppError('VALIDATION_ERROR', `函数递归调用: ${[...stack, functionKey].join(' → ')}`);
  }
  stack.push(functionKey);
  try {
    const context = Object.fromEntries(def.parameters.map((p, i) => [p, args[i]]));
    const result = evaluate(def.expression, context);
    if (def.outputType === 'number' && (typeof result !== 'number' || !Number.isFinite(result))) {
      throw new AppError('VALIDATION_ERROR', `函数 ${functionKey} 输出不是有效数值`);
    }
    if (def.outputType === 'boolean' && typeof result !== 'boolean') {
      throw new AppError('VALIDATION_ERROR', `函数 ${functionKey} 输出不是布尔值`);
    }
    if (def.outputType === 'string' && typeof result !== 'string') {
      throw new AppError('VALIDATION_ERROR', `函数 ${functionKey} 输出不是字符串`);
    }
    return result;
  } finally {
    stack.pop();
  }
}

export function evaluateFunction(functionKey: string, args: Record<string, unknown>) {
  const def = getFunction(functionKey);
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new AppError('VALIDATION_ERROR', '试算参数必须是对象');
  }
  const missing = def.parameters.filter((p) => !(p in args));
  if (missing.length) throw new AppError('VALIDATION_ERROR', `缺少参数: ${missing.join(', ')}`);
  return { functionKey, version: def.version, result: resolveFunction(functionKey, def.parameters.map((p) => args[p])) };
}

setCustomFunctionResolver(resolveFunction);
