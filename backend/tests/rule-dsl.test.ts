/**
 * 规则 DSL 单元测试：tokenizer / parser / evaluator
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluate,
  evaluateBoolean,
  expressionDependencies,
} from '../src/shared/rule-dsl';

test('比较运算与布尔组合', () => {
  const ctx = { a: 10, b: 5, flag: true };
  assert.equal(evaluateBoolean('a > b AND flag', ctx), true);
  assert.equal(evaluateBoolean('a < b OR flag', ctx), true);
  assert.equal(evaluateBoolean('NOT flag', ctx), false);
  assert.equal(evaluateBoolean('a >= 10 && b < 5', ctx), false);
  assert.equal(evaluateBoolean('a == 10 || b == 0', ctx), true);
});

test('算术表达式', () => {
  const ctx = { x: 3, y: 4 };
  assert.equal(evaluate('x + y * 2', ctx), 11);
  assert.equal(evaluate('(x + y) * 2', ctx), 14);
  assert.equal(evaluate('x / y', ctx), 0.75);
});

test('路径访问：嵌套对象与数组下标', () => {
  const ctx = {
    proposed: [{ serviceScore: 82, nested: { deep: 1 } }],
    obj: { name: '测试', 'with-dash': 9 },
  };
  assert.equal(evaluate('proposed[0].serviceScore', ctx), 82);
  assert.equal(evaluate('proposed[0].nested.deep', ctx), 1);
  assert.equal(evaluate("obj['with-dash']", ctx), 9);
  assert.equal(evaluate('obj.name', ctx), '测试');
});

test('白名单函数', () => {
  const ctx = { a: 5, b: 10, list: [1, 2, 3], s: 'hello' };
  assert.equal(evaluate('coalesce(a, 0)', ctx), 5);
  assert.equal(evaluate('clamp(a, 0, 3)', ctx), 3);
  assert.equal(evaluate('in(2, list)', ctx), true);
  assert.equal(evaluate('contains(s, "ell")', ctx), true);
  assert.equal(evaluate('max(a, b)', ctx), 10);
});

test('依赖枚举', () => {
  const deps = expressionDependencies('proposed[0].serviceScore > threshold AND risk < 50');
  assert.ok(deps.includes('proposed.0.serviceScore') || deps.includes('proposed[0].serviceScore'));
  assert.ok(deps.some((d) => d.includes('threshold')));
  assert.ok(deps.some((d) => d.includes('risk')));
});

test('非法表达式应报错', () => {
  assert.throws(() => evaluate('dangerous(); //()', {}));
  assert.throws(() => evaluate('__proto__', {}));
  assert.throws(() => evaluateBoolean('eval("1")', {}));
});
