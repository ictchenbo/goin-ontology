# -*- coding: utf-8 -*-
# 三场景端到端验收：登录 → 评分 → 决策 → 审批 → 执行 → 结果 → 复盘 → 关闭
# 用法: python e2e-three-scenarios.py [API_BASE]
import json
import sys
import urllib.request
import urllib.error

BASE = (sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:13001').rstrip('/')


def req(method, path, token=None, body=None):
    url = BASE + '/api' + path
    data = json.dumps(body).encode('utf-8') if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    r.add_header('Content-Type', 'application/json')
    if token:
        r.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read().decode('utf-8')
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8')
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {'raw': raw}
    except Exception as e:
        return 0, {'error': str(e)}


def login(u, p):
    st, j = req('POST', '/auth/login', body={'username': u, 'password': p})
    return j.get('token') if st == 200 else None


results = []


def check(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS' if ok else 'FAIL') + ' | ' + name + (' | ' + str(detail) if detail else ''))


# 场景配置: (key, case_title_prefix, propose_user, approve_user, execute_user, approve_pwd, ...)
SCENARIOS = [
    {
        'key': 'supply-chain',
        'title': 'SHP-7781',
        'users': {
            'propose': ('analyst', 'analyst123'),
            'approve': ('approver', 'approver123'),
            'execute': ('operator', 'operator123'),
        },
    },
    {
        'key': 'military',
        'title': 'RPT-001',
        'users': {
            'propose': ('intel', 'intel123'),
            'approve': ('commander', 'commander123'),
            'execute': ('operator', 'operator123'),
        },
    },
    {
        'key': 'public-safety',
        'title': 'EVT-2026-001',
        'users': {
            'propose': ('analyst', 'analyst123'),
            'approve': ('safety', 'safety123'),
            'execute': ('operator', 'operator123'),
        },
    },
]

for sc in SCENARIOS:
    tag = '[' + sc['key'] + ']'
    tp = login(*sc['users']['propose'])
    ta = login(*sc['users']['approve'])
    te = login(*sc['users']['execute'])
    check(tag + ' login', bool(tp and ta and te))

    # 找样例案例（优先未关闭的：种子会为已终态样例重建新案例）
    st, cases = req('GET', '/cases?limit=50', tp)
    items = cases.get('items', cases if isinstance(cases, list) else [])
    matched = [c for c in items if sc['title'] in (c.get('title') or '')]
    case = next((c for c in matched if c.get('state') not in ('Closed', 'Cancelled')), None)
    if not case and matched:
        case = matched[0]
    if not case:
        check(tag + ' find case', False, 'no case with title prefix ' + sc['title'])
        continue
    cid = case['id']
    st, detail = req('GET', '/cases/' + cid, tp)
    check(tag + ' get case', st == 200, 'state=' + str(detail.get('state')))

    alts = detail.get('alternatives') or []
    check(tag + ' alternatives >= 3', len(alts) >= 3, 'n=' + str(len(alts)))

    # 评分
    st, sc_res = req('POST', '/cases/' + cid + '/score', tp, {'scenarioRunId': 'e2e-' + sc['key']})
    winner = (sc_res.get('winnerAlternativeId') if st < 300 else None)
    check(tag + ' score', st < 300 and bool(winner), 'st=' + str(st) + ' winner=' + str(winner))

    # 决策
    st, dec = req('POST', '/cases/' + cid + '/decision', tp, {
        'selectedAlternativeId': winner,
        'rationale': 'E2E: 综合得分最高',
    })
    check(tag + ' decision', st < 300, 'st=' + str(st) + ' state=' + str(dec.get('state')))

    # 提交审批
    st, apr = req('POST', '/cases/' + cid + '/approvals', tp, {
        'alternativeId': winner, 'comment': 'E2E 请审批',
    })
    apr_id = apr.get('id')
    check(tag + ' request approval', st < 300 and bool(apr_id), 'st=' + str(st) + ' apr=' + str(apr_id))

    # 审批列表 canApprove 应对审批人为 true
    st, aprs = req('GET', '/approvals?status=pending', ta)
    apr_items = aprs.get('items', aprs if isinstance(aprs, list) else [])
    mine = next((a for a in apr_items if a.get('id') == apr_id), None)
    check(tag + ' canApprove flag', bool(mine) and mine.get('canApprove') is True,
          str(mine.get('canApprove') if mine else 'missing'))

    # 审批
    st, dec_res = req('POST', '/approvals/' + apr_id + '/decide', ta, {
        'decision': 'approved', 'comment': 'E2E 同意',
    })
    check(tag + ' approve', st < 300, 'st=' + str(st) + ' ' + str(dec_res.get('error', ''))[:80])

    # 解析待执行动作
    st, detail = req('GET', '/cases/' + cid, tp)
    alt = next((a for a in (detail.get('alternatives') or []) if a.get('id') == winner), None)
    pa = None
    for p in (alt or {}).get('proposedActions') or []:
        if isinstance(p, dict) and p.get('actionKey'):
            pa = p
            break
    action_key = (pa or {}).get('actionKey')
    params = dict((pa or {}).get('params') or {})
    if not params.get('objectId'):
        root = detail.get('rootObjectId') or (detail.get('caseObjects') or [{}])[0].get('objectId')
        params['objectId'] = root
    check(tag + ' resolve action', bool(action_key), 'action=' + str(action_key) + ' params=' + str(params)[:100])

    # 执行
    st, ex = req('POST', '/actions/execute', te, {
        'actionKey': action_key,
        'params': params,
        'caseId': cid,
        'alternativeId': winner,
        'idempotencyKey': 'e2e-' + sc['key'] + '-' + cid,
    })
    check(tag + ' execute', st < 300, 'st=' + str(st) + ' ' + str(ex.get('error', ex.get('message', '')))[:120])

    # 结果记录
    st, out = req('POST', '/cases/' + cid + '/outcomes', te, {
        'expected': {'service': 80, 'cost': 12000},
        'actual': {'service': 75, 'cost': 12500},
        'notes': 'E2E 接近预期',
        'reviewNotes': 'E2E 复盘：偏差在可接受范围',
    })
    out_id = out.get('id')
    check(tag + ' record outcome', st < 300 and bool(out_id), 'st=' + str(st) + ' ' + str(out.get('error', ''))[:80])

    # 复盘（使用正确端点 /outcomes/:id/review）
    if out_id:
        st, rev = req('POST', '/outcomes/' + out_id + '/review', ta, {
            'reviewNotes': 'E2E 复盘完成', 'attribution': 'external',
        })
        check(tag + ' review outcome', st < 300, 'st=' + str(st) + ' ' + str(rev.get('error', ''))[:80])

    # 状态推进到 OutcomeReviewed 后关闭
    st, detail = req('GET', '/cases/' + cid, tp)
    state = detail.get('state')
    if state == 'Completed':
        st, tr = req('POST', '/cases/' + cid + '/transition', ta, {
            'toState': 'OutcomeReviewed', 'reason': 'E2E 复盘完成',
        })
        check(tag + ' transition OutcomeReviewed', st < 300, 'st=' + str(st) + ' ' + str(tr.get('error', ''))[:80])
    st, detail = req('GET', '/cases/' + cid, tp)
    state = detail.get('state')
    if state in ('OutcomeReviewed', 'Failed'):
        st, cl = req('POST', '/cases/' + cid + '/close', ta, {'reason': 'E2E 关闭'})
        check(tag + ' close', st < 300, 'st=' + str(st) + ' ' + str(cl.get('error', ''))[:80])
    else:
        check(tag + ' close', False, 'state=' + str(state))

    st, detail = req('GET', '/cases/' + cid, tp)
    check(tag + ' final state Closed', detail.get('state') == 'Closed', 'state=' + str(detail.get('state')))

print('\n===== SUMMARY =====')
fails = [r for r in results if not r[1]]
print('total=%d pass=%d fail=%d' % (len(results), len(results) - len(fails), len(fails)))
for name, ok, detail in fails:
    print('FAIL | ' + name + ' | ' + str(detail))
sys.exit(1 if fails else 0)
