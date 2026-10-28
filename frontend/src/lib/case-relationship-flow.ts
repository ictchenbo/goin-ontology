export interface FlowObject {
  objectId: string;
  typeKey?: string;
  title?: string;
  isRoot?: boolean;
  payload?: Record<string, unknown>;
}

export interface FlowLink {
  id?: string;
  from: string;
  to: string;
  linkKey: string;
  linkDisplay?: string;
}

export function publicSafetyRelationshipFlow(objects: FlowObject[], links: FlowLink[]) {
  const byId = new Map(objects.map((object) => [object.objectId, object]));
  const root = objects.find((object) => object.isRoot && object.typeKey === 'ObservedEvent');
  if (!root) return null;
  const firstSource = links.find((link) => link.linkKey === 'event_from_source' && link.from === root.objectId);
  const initialCaseLink = links.find((link) => link.linkKey === 'case_has_event'
    && link.to === root.objectId && byId.get(link.from)?.typeKey === 'SafetyCase');
  if (!firstSource || !initialCaseLink) return null;

  const caseId = initialCaseLink.from;
  const flow: FlowLink[] = [
    { ...firstSource, from: firstSource.to, to: root.objectId, linkDisplay: '从来源提取事件' },
    { ...initialCaseLink, from: root.objectId, to: caseId, linkDisplay: '形成公共安全个案' },
  ];

  // 指标作为观察事件的旁支；这里只显示依赖，不声明指标已由规则核实。
  for (const link of links.filter((item) => item.linkKey === 'indicator_based_on_event'
    && item.to === root.objectId)) {
    flow.push({ ...link, from: root.objectId, to: link.from, linkDisplay: '提取线索指标' });
  }

  const patrolEvent = links.filter((link) => link.linkKey === 'case_has_event'
    && link.from === caseId && link.to !== root.objectId)
    .map((link) => byId.get(link.to))
    .find((object) => object?.typeKey === 'ObservedEvent'
      && links.some((link) => link.linkKey === 'event_from_source' && link.from === object.objectId
        && byId.get(link.to)?.payload?.channel === 'patrol'));
  const patrolSourceLink = patrolEvent && links.find((link) => link.linkKey === 'event_from_source'
    && link.from === patrolEvent.objectId);
  if (!patrolSourceLink) return { links: flow, notice: '' };

  const patrolTaskLink = links.find((link) => link.linkKey === 'task_for_case'
    && link.to === caseId && byId.get(link.from)?.typeKey === 'FollowUpTask'
    && byId.get(link.from)?.title?.includes('巡逻')
    && links.some((item) => item.linkKey === 'task_produces_source'
      && item.from === link.from && item.to === patrolSourceLink.to));
  const taskSourceLink = patrolTaskLink && links.find((link) => link.linkKey === 'task_produces_source'
    && link.from === patrolTaskLink.from && link.to === patrolSourceLink.to);
  if (patrolTaskLink && taskSourceLink) {
    flow.push({ ...patrolTaskLink, from: caseId, to: patrolTaskLink.from,
      linkDisplay: '安排巡逻核查' });
    flow.push({ ...taskSourceLink, linkDisplay: '形成巡逻记录' });
  }
  flow.push({ ...patrolSourceLink, from: patrolSourceLink.to, to: patrolEvent!.objectId,
    linkDisplay: '从记录提取结果' });
  return {
    links: flow,
    notice: patrolTaskLink ? '' : '当前快照未记录巡逻安排任务；重新执行 Orient 后可查看完整流程。',
  };
}
