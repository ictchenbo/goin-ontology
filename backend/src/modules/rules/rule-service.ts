// 规则服务：派生指标、约束、触发器；表达式使用受限 DSL
import { getDb, nowIso } from '../../db/database';
import { AppError } from '../../shared/errors';
import { evaluate, evaluateBoolean, expressionDependencies } from '../../shared/rule-dsl';
import { writeAudit } from '../audit/audit-service';

export type RuleKind = 'derived_metric' | 'constraint' | 'trigger' | 'score_normalizer';

export interface RuleDef {
  ruleKey: string;
  name: string;
  kind: RuleKind;
  description?: string;
  expression: string;
  inputDeps?: string[];
  outputType?: string;
  scopeType?: string;
  testCases?: Array<{ input: Record<string, unknown>; expected: unknown }>;
}

export function upsertRule(input: RuleDef, actor: string) {
  const db = getDb();
  // 校验表达式可解析并枚举依赖
  let deps = input.inputDeps ?? [];
  try {
    deps = expressionDependencies(input.expression);
  } catch (e: any) {
    throw new AppError('VALIDATION_ERROR', `规则表达式无法解析: ${e.message}`);
  }
  // 测试样例必须通过
  for (const tc of input.testCases ?? []) {
    let actual: unknown;
    try {
      actual = input.kind === 'constraint' || input.kind === 'trigger'
        ? evaluateBoolean(input.expression, tc.input)
        : evaluate(input.expression, tc.input);
    } catch (e: any) {
      throw new AppError('VALIDATION_ERROR', `测试样例执行失败: ${e.message}`);
    }
    if (JSON.stringify(actual) !== JSON.stringify(tc.expected)) {
      throw new AppError('VALIDATION_ERROR',
        `测试样例不符: 表达式=${input.expression}, 输入=${JSON.stringify(tc.input)}, 期望=${JSON.stringify(tc.expected)}, 实际=${JSON.stringify(actual)}`);
    }
  }
  const existing = db.prepare('SELECT version FROM rule_def WHERE rule_key = ?').get(input.ruleKey) as any;
  const now = nowIso();
  const version = existing ? existing.version + 1 : 1;
  if (existing) {
    db.prepare(`UPDATE rule_def SET name=?, kind=?, description=?, expression=?, input_deps=?,
      output_type=?, scope_type=?, version=?, state='published', test_cases=?, updated_at=?
      WHERE rule_key=?`).run(
      input.name, input.kind, input.description ?? '', input.expression, JSON.stringify(deps),
      input.outputType ?? 'number', input.scopeType ?? '', version, JSON.stringify(input.testCases ?? []), now,
      input.ruleKey
    );
  } else {
    db.prepare(`INSERT INTO rule_def
      (rule_key, name, kind, description, expression, input_deps, output_type, scope_type, version, state, test_cases, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?, 'published', ?,?,?)`).run(
      input.ruleKey, input.name, input.kind, input.description ?? '', input.expression,
      JSON.stringify(deps), input.outputType ?? 'number', input.scopeType ?? '', version,
      JSON.stringify(input.testCases ?? []), now, now
    );
  }
  writeAudit({
    actor, eventType: 'rule.upserted', resourceType: 'rule_def', resourceId: input.ruleKey,
    after: { expression: input.expression, version },
  });
  return getRule(input.ruleKey);
}

export function getRule(ruleKey: string) {
  const row = getDb().prepare('SELECT * FROM rule_def WHERE rule_key = ?').get(ruleKey) as any;
  if (!row) throw new AppError('NOT_FOUND', `规则不存在: ${ruleKey}`);
  return mapRule(row);
}

export function listRules(kind?: string, scopeType?: string) {
  const db = getDb();
  let sql = 'SELECT * FROM rule_def WHERE 1=1';
  const params: unknown[] = [];
  if (kind) { sql += ' AND kind = ?'; params.push(kind); }
  if (scopeType) { sql += ' AND scope_type = ?'; params.push(scopeType); }
  sql += ' ORDER BY kind, rule_key';
  return (db.prepare(sql).all(...params) as any[]).map(mapRule);
}

function mapRule(r: any) {
  return {
    ruleKey: r.rule_key,
    name: r.name,
    kind: r.kind,
    description: r.description,
    expression: r.expression,
    inputDeps: JSON.parse(r.input_deps || '[]'),
    outputType: r.output_type,
    scopeType: r.scope_type,
    version: r.version,
    state: r.state,
    testCases: JSON.parse(r.test_cases || '[]'),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function deleteRule(ruleKey: string, actor: string) {
  getDb().prepare('DELETE FROM rule_def WHERE rule_key = ?').run(ruleKey);
  writeAudit({ actor, eventType: 'rule.deleted', resourceType: 'rule_def', resourceId: ruleKey });
}

// 对上下文批量执行派生指标规则
export function computeDerivedMetrics(ctx: Record<string, unknown>, scopeType?: string) {
  const rules = listRules('derived_metric', scopeType);
  const metrics: Record<string, unknown> = {};
  const errors: Record<string, string> = {};
  for (const r of rules) {
    try {
      metrics[r.ruleKey] = evaluate(r.expression, { ...ctx, metrics });
    } catch (e: any) {
      errors[r.ruleKey] = e.message;
      metrics[r.ruleKey] = null;
    }
  }
  return { metrics, errors };
}

export interface ConstraintCheck {
  constraintKey: string;
  name: string;
  severity: 'hard' | 'soft';
  passed: boolean;
  message: string;
  detail?: unknown;
}

// 执行约束列表（decision_type.constraints 或 rule_def）
export function checkConstraints(
  constraints: Array<{ key: string; name: string; severity: 'hard' | 'soft'; expression: string; message?: string }>,
  ctx: Record<string, unknown>
): ConstraintCheck[] {
  return constraints.map((c) => {
    try {
      const passed = evaluateBoolean(c.expression, ctx);
      return {
        constraintKey: c.key,
        name: c.name,
        severity: c.severity,
        passed,
        message: passed ? '' : (c.message || `约束未满足: ${c.name}`),
      };
    } catch (e: any) {
      return {
        constraintKey: c.key,
        name: c.name,
        severity: c.severity,
        passed: false,
        message: `约束计算失败: ${e.message}`,
      };
    }
  });
}

// 触发器评估：返回命中的触发器
export function evaluateTriggers(ctx: Record<string, unknown>) {
  const rules = listRules('trigger');
  const hits: Array<{ ruleKey: string; name: string; expression: string }> = [];
  for (const r of rules) {
    try {
      if (evaluateBoolean(r.expression, ctx)) {
        hits.push({ ruleKey: r.ruleKey, name: r.name, expression: r.expression });
      }
    } catch { /* 触发器失败不影响主流程 */ }
  }
  return hits;
}
