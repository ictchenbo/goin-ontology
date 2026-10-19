// 美国军力公开资料样例：仅记录官方已公开的平台、设施与历史事件。
// 机型对象限定到所列部队或基地；关系中的“配备”表示公开的型号能力，不表示某日挂载状态。
export const sources = {
  hillWing: {
    title: '388th Fighter Wing',
    url: 'https://www.af.mil/About-Us/Fact-Sheets/Display/Article/1464092/388th-fighter-wing/',
    publisher: 'U.S. Air Force',
  },
  hillArrival: {
    title: 'First operational F-35As arrive at Hill AFB',
    url: 'https://www.hill.af.mil/News/Article-Display/Article/838054/first-operational-f-35as-arrive-at-hill-afb/',
    publisher: 'U.S. Air Force',
  },
  langleyWing: {
    title: '1st Fighter Wing',
    url: 'https://www.jble.af.mil/About-Us/Units/Langley-AFB/1st-Fighter-Wing/',
    publisher: 'Joint Base Langley-Eustis',
  },
  langleyTakeoff: {
    title: '1st Fighter Wing deploys to United Arab Emirates',
    url: 'https://www.jble.af.mil/News/Article-Display/Article/2933196/1st-fighter-wing-deploys-to-united-arab-emirates/',
    publisher: 'Joint Base Langley-Eustis',
  },
  whitemanHistory: {
    title: 'Whiteman Air Force Base history',
    url: 'https://www.whiteman.af.mil/About/Fact-Sheets/Display/Article/323964/whiteman-air-force-base/',
    publisher: 'U.S. Air Force',
  },
  whitemanB2: {
    title: 'B-2 Spirit',
    url: 'https://www.whiteman.af.mil/About/Fact-Sheets/Display/Article/886024/b-2-spirit/',
    publisher: 'U.S. Air Force',
  },
  norfolkFacility: {
    title: 'Norfolk Naval Station',
    url: 'https://www.navfac.navy.mil/Divisions/Environmental/Products-and-Services/Environmental-Restoration/Mid-Atlantic/Norfolk-NS/',
    publisher: 'Naval Facilities Engineering Systems Command',
  },
  rotaFacility: {
    title: 'Naval Station Rota',
    url: 'https://cnreurafcent.cnic.navy.mil/installations/navsta-rota/',
    publisher: 'U.S. Navy',
  },
  fordReturn: {
    title: 'Gerald R. Ford Carrier Strike Group Returns from Historic Deployment',
    url: 'https://www.navy.mil/Press-Office/News-Stories/Article/3648681/gerald-r-ford-carrier-strike-group-returns-from-historic-deployment/',
    publisher: 'U.S. Navy',
  },
  mcfaulReturn: {
    title: 'USS McFaul Returns Home from 8-month Deployment',
    url: 'https://www.navy.mil/Press-Office/News-Stories/Article/3634915/uss-mcfaul-returns-home-from-8-month-deployment/',
    publisher: 'U.S. Navy',
  },
  burkeHistory: {
    title: 'USS Arleigh Burke (DDG 51) History',
    url: 'https://www.surflant.usff.navy.mil/Organization/Operational-Forces/Destroyers/USS-Arleigh-Burke-DDG-51/About-Us/History/',
    publisher: 'U.S. Navy',
  },
  burkeDeparture: {
    title: 'USS Arleigh Burke Prepares for Home Port Shift to Rota',
    url: 'https://www.navy.mil/Press-Office/News-Stories/Article/2552745/uss-arleigh-burke-prepares-for-home-port-shift-to-rota/',
    publisher: 'U.S. Navy',
  },
  amraam: {
    title: 'AIM-120 Advanced Medium Range Air-to-Air Missile',
    url: 'https://www.acc.af.mil/Portals/92/Docs/Fact%20Sheets%20-%202020%20Update/Facts%20Sheets%202022%20Final/AIM-120_final.pdf',
    publisher: 'Air Combat Command',
  },
  f22: {
    title: 'F-22 Raptor',
    url: 'https://www.af.mil/About-Us/Fact-Sheets/Display/Article/104506/f-22-raptor/About-Us/f-22-raptor/',
    publisher: 'U.S. Air Force',
  },
  fordRam: {
    title: 'Gerald R. Ford Successfully Completes Combat Systems Ship’s Qualification Trials',
    url: 'https://www.navy.mil/Press-Office/News-Stories/Article/2584336/gerald-r-ford-successfully-completes-combat-systems-ships-qualification-trials/',
    publisher: 'U.S. Navy',
  },
} as const;

export type SourceKey = keyof typeof sources;

export interface SampleObject {
  key: string;
  typeKey: string;
  title: string;
  payload: Record<string, unknown>;
  source: SourceKey;
  claim: string;
}

export const objects: SampleObject[] = [
  { key: 'hill-base', typeKey: 'MilitaryBase', title: '希尔空军基地（Hill AFB）',
    payload: { name: '希尔空军基地', baseClass: 'air', region: '美国犹他州' }, source: 'hillWing',
    claim: '美国空军第388战斗机联队驻希尔空军基地。' },
  { key: 'langley-base', typeKey: 'MilitaryBase', title: '兰利空军基地（JBLE-Langley）',
    payload: { name: '兰利空军基地', baseClass: 'air', region: '美国弗吉尼亚州' }, source: 'langleyWing',
    claim: '第1战斗机联队在兰利-尤斯蒂斯联合基地运行 F-22。' },
  { key: 'whiteman-base', typeKey: 'MilitaryBase', title: '怀特曼空军基地（Whiteman AFB）',
    payload: { name: '怀特曼空军基地', baseClass: 'air', region: '美国密苏里州' }, source: 'whitemanB2',
    claim: '怀特曼空军基地是 B-2 的作战基地。' },
  { key: 'norfolk-base', typeKey: 'MilitaryBase', title: '诺福克海军基地（Naval Station Norfolk）',
    payload: { name: '诺福克海军基地', baseClass: 'naval', region: '美国弗吉尼亚州' }, source: 'norfolkFacility',
    claim: '诺福克海军基地设有舰艇码头和港区设施。' },
  { key: 'rota-base', typeKey: 'MilitaryBase', title: '罗塔海军基地（Naval Station Rota）',
    payload: { name: '罗塔海军基地', baseClass: 'naval', region: '西班牙加的斯省' }, source: 'rotaFacility',
    claim: '罗塔海军基地提供港口和航空设施。' },
  { key: 'hill-airfield', typeKey: 'MilitaryAirfield', title: '希尔空军基地机场',
    payload: { name: '希尔空军基地机场', region: '美国犹他州' }, source: 'hillArrival',
    claim: 'F-35A 于 2015 年 9 月 2 日抵达希尔空军基地机场。' },
  { key: 'langley-airfield', typeKey: 'MilitaryAirfield', title: '兰利空军基地机场',
    payload: { name: '兰利空军基地机场', region: '美国弗吉尼亚州' }, source: 'langleyTakeoff',
    claim: 'F-22 于 2022 年 2 月 10 日从兰利-尤斯蒂斯联合基地起飞。' },
  { key: 'whiteman-airfield', typeKey: 'MilitaryAirfield', title: '怀特曼空军基地机场',
    payload: { name: '怀特曼空军基地机场', region: '美国密苏里州' }, source: 'whitemanHistory',
    claim: '首架作战型 B-2 于 1993 年 12 月 17 日降落怀特曼基地跑道。' },
  { key: 'norfolk-port', typeKey: 'MilitaryPort', title: '诺福克海军基地港区',
    payload: { name: '诺福克海军基地港区', region: '美国弗吉尼亚州' }, source: 'norfolkFacility',
    claim: '诺福克海军基地西部滨水区设有舰艇码头。' },
  { key: 'rota-port', typeKey: 'MilitaryPort', title: '罗塔海军基地港区',
    payload: { name: '罗塔海军基地港区', region: '西班牙加的斯省' }, source: 'rotaFacility',
    claim: '罗塔海军基地设有支持美国和北约舰艇的码头。' },
  { key: 'f35-hill', typeKey: 'MilitaryAircraft', title: 'F-35A“闪电 II”（第388战斗机联队）',
    payload: { name: 'F-35A Lightning II（第388战斗机联队）', aircraftClass: 'fighter' }, source: 'hillWing',
    claim: '第388战斗机联队在希尔空军基地运用 F-35A。' },
  { key: 'f22-langley', typeKey: 'MilitaryAircraft', title: 'F-22“猛禽”（第1战斗机联队）',
    payload: { name: 'F-22 Raptor（第1战斗机联队）', aircraftClass: 'fighter' }, source: 'langleyWing',
    claim: '第1战斗机联队在兰利-尤斯蒂斯联合基地运用 F-22。' },
  { key: 'b2-missouri', typeKey: 'MilitaryAircraft', title: 'B-2“密苏里精神”号',
    payload: { name: 'B-2 Spirit of Missouri', aircraftClass: 'bomber' }, source: 'whitemanHistory',
    claim: 'B-2“密苏里精神”号于 1993 年 12 月 17 日抵达怀特曼空军基地。' },
  { key: 'ford', typeKey: 'Warship', title: '“杰拉尔德·R·福特”号航空母舰（CVN-78）',
    payload: { name: 'USS Gerald R. Ford (CVN 78)', shipClass: 'carrier' }, source: 'fordReturn',
    claim: '“福特”号航空母舰于 2024 年 1 月 17 日返回母港诺福克海军基地。' },
  { key: 'mcfaul', typeKey: 'Warship', title: '“麦克福尔”号驱逐舰（DDG-74）',
    payload: { name: 'USS McFaul (DDG 74)', shipClass: 'destroyer' }, source: 'mcfaulReturn',
    claim: '“麦克福尔”号驱逐舰于 2024 年 1 月 4 日返回母港诺福克海军基地。' },
  { key: 'burke', typeKey: 'Warship', title: '“阿利·伯克”号驱逐舰（DDG-51）',
    payload: { name: 'USS Arleigh Burke (DDG 51)', shipClass: 'destroyer' }, source: 'burkeHistory',
    claim: '“阿利·伯克”号驱逐舰的母港为西班牙罗塔海军基地。' },
  { key: 'aim120', typeKey: 'WeaponSystem', title: 'AIM-120 AMRAAM 空空导弹',
    payload: { name: 'AIM-120 AMRAAM', equipmentClass: 'missile', operatingDomain: 'air' }, source: 'amraam',
    claim: 'AIM-120 为美国空军公开列明的空空导弹，适配 F-35 和 F-22。' },
  { key: 'gbu32', typeKey: 'WeaponSystem', title: 'GBU-32 JDAM 制导炸弹',
    payload: { name: 'GBU-32 JDAM', equipmentClass: 'other', operatingDomain: 'air' }, source: 'f22',
    claim: '美国空军 F-22 资料列出 GBU-32 JDAM 空对地挂载。' },
  { key: 'tomahawk', typeKey: 'WeaponSystem', title: '“战斧”巡航导弹（Tomahawk）',
    payload: { name: 'Tomahawk cruise missile', equipmentClass: 'missile', operatingDomain: 'sea' }, source: 'burkeHistory',
    claim: '美国海军舰史记载“阿利·伯克”号使用“战斧”巡航导弹。' },
  { key: 'ram', typeKey: 'WeaponSystem', title: 'RIM-116 RAM 舰载防空导弹',
    payload: { name: 'RIM-116 RAM', equipmentClass: 'air_defense', operatingDomain: 'sea' }, source: 'fordRam',
    claim: '“福特”号在舰艇作战系统资格试验中发射 RIM-116 导弹。' },
  { key: 'f35-arrival', typeKey: 'AircraftActivity', title: '首批作战型 F-35A 抵达希尔基地（2015-09-02）',
    payload: { name: '首批作战型 F-35A 抵达希尔基地', eventKind: 'landing', occurredAt: '2015-09-02',
      summary: '美国空军首批两架作战型 F-35A 抵达希尔空军基地；日期精度为日。', confidence: 1 },
    source: 'hillArrival', claim: '官方报道首批两架作战型 F-35A 于 2015 年 9 月 2 日抵达希尔基地。' },
  { key: 'f22-takeoff', typeKey: 'AircraftActivity', title: '第1联队 F-22 从兰利起飞（2022-02-10）',
    payload: { name: '第1联队 F-22 从兰利起飞', eventKind: 'takeoff', occurredAt: '2022-02-10',
      summary: '第1战斗机联队 F-22 从兰利-尤斯蒂斯联合基地起飞；日期精度为日。', confidence: 1 },
    source: 'langleyTakeoff', claim: '官方报道 F-22 于 2022 年 2 月 10 日从兰利-尤斯蒂斯联合基地起飞。' },
  { key: 'b2-arrival', typeKey: 'AircraftActivity', title: 'B-2“密苏里精神”号抵达怀特曼（1993-12-17）',
    payload: { name: 'B-2“密苏里精神”号抵达怀特曼', eventKind: 'landing', occurredAt: '1993-12-17',
      summary: '首架作战型 B-2“密苏里精神”号在怀特曼空军基地降落；日期精度为日。', confidence: 1 },
    source: 'whitemanHistory', claim: '官方基地史记载首架作战型 B-2 于 1993 年 12 月 17 日降落。' },
  { key: 'ford-return', typeKey: 'WarshipActivity', title: '“福特”号返回诺福克（2024-01-17）',
    payload: { name: '“福特”号返回诺福克', eventKind: 'arrival', occurredAt: '2024-01-17',
      summary: '“福特”号航空母舰结束部署后返回诺福克海军基地；日期精度为日。', confidence: 1 },
    source: 'fordReturn', claim: '美国海军报道“福特”号于 2024 年 1 月 17 日返回诺福克。' },
  { key: 'mcfaul-return', typeKey: 'WarshipActivity', title: '“麦克福尔”号返回诺福克（2024-01-04）',
    payload: { name: '“麦克福尔”号返回诺福克', eventKind: 'arrival', occurredAt: '2024-01-04',
      summary: '“麦克福尔”号驱逐舰结束部署后返回诺福克海军基地；日期精度为日。', confidence: 1 },
    source: 'mcfaulReturn', claim: '美国海军报道“麦克福尔”号于 2024 年 1 月 4 日返回诺福克。' },
  { key: 'burke-departure', typeKey: 'WarshipActivity', title: '“阿利·伯克”号驶离诺福克转港（2021-03-26）',
    payload: { name: '“阿利·伯克”号驶离诺福克转港', eventKind: 'departure', occurredAt: '2021-03-26',
      summary: '“阿利·伯克”号从诺福克启程，开始转移母港至西班牙罗塔；日期精度为日。', confidence: 1 },
    source: 'burkeDeparture', claim: '美国海军报道该舰于 2021 年 3 月 26 日驶离诺福克并开始转港。' },
];

export interface SampleLink {
  linkKey: string;
  from: string;
  to: string;
  source: SourceKey;
  note?: string;
}

export const links: SampleLink[] = [
  { linkKey: 'airfield_part_of_base', from: 'hill-airfield', to: 'hill-base', source: 'hillArrival' },
  { linkKey: 'airfield_part_of_base', from: 'langley-airfield', to: 'langley-base', source: 'langleyTakeoff' },
  { linkKey: 'airfield_part_of_base', from: 'whiteman-airfield', to: 'whiteman-base', source: 'whitemanHistory' },
  { linkKey: 'port_part_of_base', from: 'norfolk-port', to: 'norfolk-base', source: 'norfolkFacility' },
  { linkKey: 'port_part_of_base', from: 'rota-port', to: 'rota-base', source: 'rotaFacility' },
  { linkKey: 'aircraft_based_at_airfield', from: 'f35-hill', to: 'hill-airfield', source: 'hillWing', note: '第388战斗机联队的 F-35A 机群' },
  { linkKey: 'aircraft_based_at_airfield', from: 'f22-langley', to: 'langley-airfield', source: 'langleyWing', note: '第1战斗机联队的 F-22 机群' },
  { linkKey: 'aircraft_based_at_airfield', from: 'b2-missouri', to: 'whiteman-airfield', source: 'whitemanHistory', note: '1993 年抵达的“密苏里精神”号' },
  { linkKey: 'warship_homeported_at_port', from: 'ford', to: 'norfolk-port', source: 'fordReturn', note: '按 2024 年公开报道' },
  { linkKey: 'warship_homeported_at_port', from: 'mcfaul', to: 'norfolk-port', source: 'mcfaulReturn', note: '按 2024 年公开报道' },
  { linkKey: 'warship_homeported_at_port', from: 'burke', to: 'rota-port', source: 'burkeHistory', note: '按美国海军舰史公开资料' },
  { linkKey: 'aircraft_uses_weapon', from: 'f35-hill', to: 'aim120', source: 'amraam', note: '机型适配能力，不代表某架飞机某日实际挂载' },
  { linkKey: 'aircraft_uses_weapon', from: 'f22-langley', to: 'aim120', source: 'amraam', note: '机型适配能力，不代表某架飞机某日实际挂载' },
  { linkKey: 'aircraft_uses_weapon', from: 'f22-langley', to: 'gbu32', source: 'f22', note: '机型适配能力，不代表某架飞机某日实际挂载' },
  { linkKey: 'warship_uses_weapon', from: 'burke', to: 'tomahawk', source: 'burkeHistory', note: '舰史记载的历史使用' },
  { linkKey: 'warship_uses_weapon', from: 'ford', to: 'ram', source: 'fordRam', note: '2021 年舰艇系统试验记录' },
  { linkKey: 'aircraft_activity_involves_aircraft', from: 'f35-arrival', to: 'f35-hill', source: 'hillArrival' },
  { linkKey: 'aircraft_activity_at_airfield', from: 'f35-arrival', to: 'hill-airfield', source: 'hillArrival' },
  { linkKey: 'aircraft_activity_involves_aircraft', from: 'f22-takeoff', to: 'f22-langley', source: 'langleyTakeoff' },
  { linkKey: 'aircraft_activity_at_airfield', from: 'f22-takeoff', to: 'langley-airfield', source: 'langleyTakeoff' },
  { linkKey: 'aircraft_activity_involves_aircraft', from: 'b2-arrival', to: 'b2-missouri', source: 'whitemanHistory' },
  { linkKey: 'aircraft_activity_at_airfield', from: 'b2-arrival', to: 'whiteman-airfield', source: 'whitemanHistory' },
  { linkKey: 'warship_activity_involves_warship', from: 'ford-return', to: 'ford', source: 'fordReturn' },
  { linkKey: 'warship_activity_at_port', from: 'ford-return', to: 'norfolk-port', source: 'fordReturn' },
  { linkKey: 'warship_activity_involves_warship', from: 'mcfaul-return', to: 'mcfaul', source: 'mcfaulReturn' },
  { linkKey: 'warship_activity_at_port', from: 'mcfaul-return', to: 'norfolk-port', source: 'mcfaulReturn' },
  { linkKey: 'warship_activity_involves_warship', from: 'burke-departure', to: 'burke', source: 'burkeDeparture' },
  { linkKey: 'warship_activity_at_port', from: 'burke-departure', to: 'norfolk-port', source: 'burkeDeparture' },
];
