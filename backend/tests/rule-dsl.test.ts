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

test('周岁按生日计算，并支持指定业务时区的当前日期', () => {
  assert.equal(evaluate('age_years("2000-10-11", "2026-10-10")', {}), 25);
  assert.equal(evaluate('age_years("2000-10-11", "2026-10-11")', {}), 26);
  assert.equal(evaluate('age_years("2000-02-29", "2025-02-28")', {}), 24);
  assert.equal(evaluate('age_years("2000-02-29", "2025-03-01")', {}), 25);
  assert.throws(() => evaluate('age_years("2027-01-01", "2026-01-01")', {}), /出生日期不能晚于/);
  assert.throws(() => evaluate('age_years("2024-02-30", "2026-01-01")', {}), /无效日历日期/);
  assert.throws(() => evaluate('age_years("2024-01-01Tbad", "2026-01-01")', {}), /无法解析日期/);
  assert.throws(() => evaluate('today("invalid-zone")', {}), /无效时区/);
  const expected = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => expected.find((item) => item.type === type)?.value;
  assert.equal(evaluate('today("Asia/Shanghai")', {}), `${part('year')}-${part('month')}-${part('day')}`);
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
