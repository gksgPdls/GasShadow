// MN-01 블록 현황의 3D 보기: 건조 공정 흐름(yard3d.js) 위에 블록을 놓고, 블록 안 밀폐구역과 작업 장비를 그린다.
//
// 블록: 외판·내저판(반투명, 맨홀·개구부 구멍), 안쪽 플로어·거더(맨홀이 줄지어 뚫린 칸막이), 밀폐구역(상태 색 부피),
//       정반 지주, 족장·난간, 선행의장 이후 배관
// 장비 (작업 허가가 있는 구역마다):
//   - 송풍기 + 주름 덕트. 덕트 끝은 구역 바닥까지 (현장 사진, 회의 시나리오 "덕트 끝은 탱크 바닥")
//     송풍기 대수와 정지 시각은 data.js의 vent (BK-01 예시: WBT No.3 (S) 2대 중 1대 09:04 정지 의심)
//   - 사다리 출입구, 호스 (현장 사진)
//   - 구역 안 하단에 붙여 둔 가스 측정기, 불빛 = 구역 상태 (decisions #5 탈부착식 상시 측정 전제)
//   - 출입현황판 (현장 사진): 작업 중인 구획 바로 앞(외판 바깥)에 세운다. 왼쪽 질식 위험 표지 + 오른쪽 출입증(이름표) 거는 자리.
//     작업자가 들어가면 출입증이 걸리고 나오면 빠진다. 누르면 opts.onBoard(zoneId)로 왼쪽에 작업자 현황을 연다
// 사람: 작업자는 허가서 인원만큼 허가 구역 안을 돌아다니고 가끔 출입구로 나와 쉬었다 들어간다. 감시인은 출입현황판 옆.
//   측정요원·관리감독자는 관제 화면의 사람 목록(출동·도착)을 따라 큰길로 이동한다. 위치는 모두 연출용 합성 (위치 추적 아님)
// 상태 판정은 lib/sim.ts가 하고, 여기서는 update()로 받은 상태·시각을 그림에만 반영한다.
// 가시성: 외판·칸막이는 아주 옅게, 밀폐구역은 상태 색 부피 + 같은 색 테두리선으로 또렷하게 그린다.
// 공장 지붕·크레인 같은 위쪽 구조물은 기본 숨김이고 [구조물 보기]로 켠다 (yard3d.js).
// 블록 형상·크기·장비 배치는 설명용 가정이다 (실제 도면 아님). 1 단위 ≈ 5 m.
import * as T from "three";
import { BLOCKS, ZONES } from "../data/scenario";
import { KIT, buildYard } from "./yard3d.js";
import { buildBlock, BOARD_W, BOARD_H } from "./blockgeo.js";
import { crewOf } from "../data/crew";

// host: React가 비워 둔 div. 캔버스·이름표·공정 바로가기·블록 패널을 모두 여기에 만든다.
// opts.onSelect(id | null): 블록 선택이 바뀔 때 · opts.onZone(zoneId): 3D에서 밀폐구역 부피를 눌렀을 때
// opts.onBoard(zoneId): 밀폐구역 안 출입현황판을 눌렀을 때 · opts.onCrew(zoneId, ns, started): 현황판에 걸린 출입증(작업자 번호)이나 작업 시작 여부가 바뀔 때
// opts.onTodo(text): 아직 없는 화면 버튼을 눌렀을 때 · opts.panel === false: 블록 패널을 띄우지 않음 (React가 대신 보여줌)
// WebGL을 못 쓰면 null을 돌려준다.
export function mountBlock3D(host, opts = {}) {
  if (!hasWebGL()) return null;
  const { V, lineMat, meshMat, Inst, canvasTex } = KIT;
  // 사람 (미터): 몸통 캡슐 + 안전모. 키 약 1.75 m
  const workerBodyGeo = new T.CapsuleGeometry(0.2, 1.15, 4, 10);
  workerBodyGeo.translate(0, 0.775, 0);
  const helmetGeo = new T.SphereGeometry(0.16, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  helmetGeo.translate(0, 1.56, 0);

  const css = getComputedStyle(document.documentElement);
  const cssColor = (name) => new T.Color(css.getPropertyValue(name).trim());
  const STATUS_COLOR = {
    legal: cssColor("--legal"),
    unauth: cssColor("--unauth"),
    missing: cssColor("--missing"),
    warn: cssColor("--warn"),
    ok: cssColor("--ok"),
    idle: new T.Color("#9aa1ab"),
  };
  const STATUS_OPACITY = { legal: 0.62, unauth: 0.62, missing: 0.55, warn: 0.55, ok: 0.24, idle: 0.07 };
  const EDGE_OPACITY = { legal: 1, unauth: 1, missing: 1, warn: 1, ok: 0.8, idle: 0.55 };
  const SHELL_OPACITY = 0.1, TOP_OPACITY = 0.03;
  const RANK = { legal: 0, unauth: 1, missing: 2, warn: 3, ok: 4, idle: 5 };
  const PULSE = { legal: true, unauth: true };
  const HOT_WORK = /용접|절단|그라인딩/;
  const fmtTime = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;

  // ---------- 장면 ----------
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  host.prepend(renderer.domElement);
  const scene = new T.Scene();
  scene.fog = new T.Fog(0xe9edf1, 1500, 3200);
  const camera = new T.PerspectiveCamera(30, 3, 0.1, 2000);
  scene.add(new T.HemisphereLight(0xffffff, 0xaab3bc, 0.9));
  const sun = new T.DirectionalLight(0xffffff, 0.55);
  sun.position.set(-20, 40, 25);
  scene.add(sun);
  const Y = buildYard(scene);

  // ---------- 블록 (blockgeo.js): 실제 치수(미터) · 안쪽 칸막이 · 구획마다 감시 ----------
  // 블록 자리: 공정 안 구역(area) · 베이(bay). 구역 순서는 yard3d.js STAGES.areas (작업 단계 순서)
  // 블록이 하는 작업(허가 작업)에 맞춰 단계를 고른 가정값이다
  const LAYOUT = {
    // 2.7 대조립: 0 배재 · 1 취부 · 2 용접 · 3 사상·검사
    "B-S22": { area: 1, bay: 1 }, "B-A51": { area: 2, bay: 0 }, "B-C41": { area: 3, bay: 1 }, "B-D27": { area: 3, bay: 0 },
    // 2.8 선행의장: 0 의장품 조립 · 1 의장품 취부 · 2 의장품 용접 · 3 쉘터
    // 시연 사건 블록(B-D23)은 앞줄(bay 1)에: 확대했을 때 뒤로 공장이 보이게 (원래 자리였던 B-E13과 맞바꿈)
    "B-D25": { area: 0, bay: 1 }, "B-D21": { area: 1, bay: 0 }, "B-D23": { area: 2, bay: 1 }, "B-E13": { area: 2, bay: 0 }, "B-P12": { area: 3, bay: 1 },
    // 2.9 선행도장 셀: 0·1 블라스팅 · 2·3·4 도장
    "B-S35": { area: 0 }, "B-S31": { area: 2 }, "B-E11": { area: 3 }, "B-F01": { area: 4 },
    // 3.1 PE: 0 세팅 · 1 취부 · 2 용접 · 3 사상·검사 · 4 탑재 대기
    "B-S32": { area: 0, bay: 0 }, "B-G05": { area: 2, bay: 1 },
    // 3.3 도크: 이번 호선 선체의 기관실 구간
    "B-E21": { u: -0.64 },
  };
  // 작업자가 들어가는 시각·쉬는 시간 (현장 이벤트 TIMELINE과 맞춘 연출용 가정). 없으면 처음부터 안에 있음
  const PRESENCE = {
    "Z-F01-FPT": { from: 9 * 60 + 1 },
    "Z-D23-WBT3S": { from: 8 * 60 + 45 },
    "Z-D23-PD3": { from: 9 * 60 + 9 }, // 승인 전 허가서(0491)로 들어감
    "Z-C41-CD3": { from: 9 * 60 + 3 },
    "Z-A51-APT": { from: 9 * 60 + 16 },
    "Z-D21-PD2": { from: 9 * 60 + 45 },
    "Z-D25-WBT4P": { breaks: [[9 * 60 + 22, 9 * 60 + 28]] },
  };

  // ---------- 공용 재질·모양 (미터) ----------
  const ductTex = canvasTex(64, 8, (c, w, h) => {
    c.fillStyle = "#3d4247"; c.fillRect(0, 0, w, h);
    c.fillStyle = "#6b7178";
    for (let x = 0; x < w; x += 8) c.fillRect(x, 0, 3, h);
  });
  ductTex.wrapS = ductTex.wrapT = T.RepeatWrapping;
  const mats = {
    SHELL: SHELL_OPACITY, TOP: TOP_OPACITY,
    frameFill: meshMat(0x8d98a4, 0.05, { depthWrite: false }),
    frameLine: lineMat(0x39424d, 0.18),
    rim: lineMat(0x1f252b, 0.3),
    rail: lineMat(0xd9a400, 0.9),
    ladder: lineMat(0xe5c100),
    scaff: lineMat(0x8a8f96, 0.45),
    pole: lineMat(0xd9a400),
    sensor: meshMat(0x2b2e33),
    ledGeo: new T.SphereGeometry(0.05, 10, 8),
    ductTex,
    blower: meshMat(0xf0c419),
    exhaust: meshMat(0x5b8fc9),
    dark: meshMat(0x444444),
    blade: meshMat(0x333333),
    hoses: [meshMat(0xe3b51c), meshMat(0xb8322a), meshMat(0x26292c)],
    lampGeo: new T.SphereGeometry(0.12, 10, 8),
    lamp: new T.MeshBasicMaterial({ color: 0xfff1b8 }),
  };
  // 받침·족장 발판 (InstancedMesh, 미터)
  const jackGeo = new T.CylinderGeometry(0.06, 0.16, 1, 8);
  jackGeo.translate(0, 0.5, 0);
  const capGeo = new T.CylinderGeometry(0.12, 0.12, 0.1, 8);
  const stoolGeo = new T.BoxGeometry(0.3, 1, 0.3); // 도장 셀 받침대 (각관)
  stoolGeo.translate(0, 0.5, 0);
  const plankGeo = new T.BoxGeometry(1.75, 0.05, 0.6);
  const inst = {
    jacks: new Inst(jackGeo, meshMat(0xb3b8be)), // 정반 지주 (무채색: 감시 대상이 아니라 눈에 띄지 않게)
    caps: new Inst(capGeo, meshMat(0x9aa0a6)),
    stools: new Inst(stoolGeo, meshMat(0x8b949e)),
    planks: new Inst(plankGeo, meshMat(0xb9bec4, 0.55, { depthWrite: false })),
  };

  const blowers = []; // { fan, points, curve, N, zone, stopAt, label, pos, block }
  const boards = []; // 출입현황판 { zone, group, face, tex, def, key }
  const occupied = new Set(); // 감시 블록이 차지한 자리 (나머지는 yard3d가 풍경 블록으로 채움)
  const anchors = {}; // 구역 id → 사람이 서고 드나드는 자리 (world)

  const blocks = BLOCKS.map((b) => {
    const at = LAYOUT[b.id] || {};
    occupied.add(`${b.stage}:${at.area ?? 0}:${at.bay ?? 0}`);
    const group = new T.Group();
    group.position.copy(Y.slot(b.stage, at));
    scene.add(group);
    group.updateMatrixWorld(true);
    // 승인 전 허가서로 들어간 칸(entry)은 사람·출입현황판·호스를 허가 칸처럼 그리고 unapproved로 표시 (송풍기·감시인은 없음)
    const zoneDefs = ZONES.filter((z) => z.block === b.id).map((z) =>
      !z.permit && z.entry ? { ...z, permit: { no: z.entry.no, task: z.entry.task, workers: z.entry.workers }, unapproved: true } : z,
    );
    const r = buildBlock({ group, sup: Y.supOf(b.stage), mats, inst, drawBoard, hot: (task) => HOT_WORK.test(task) }, b, zoneDefs);
    Object.assign(anchors, r.anchors);
    boards.push(...r.boards);
    r.blowers.forEach((bl) => {
      // 3D 위 '송풍기 정지 의심' 빨간 표시는 띄우지 않는다 (송풍기 상태는 구역 상세·에이전트 분석에서 본다)
      bl.label = null;
      blowers.push(bl);
    });
    const tag = document.createElement("button");
    tag.className = "b3-tag";
    tag.dataset.block = b.id;
    host.appendChild(tag);
    return { def: b, group, shellMat: r.shellMat, topMat: r.topMat, edgeMat: r.edgeMat, zones: r.zones, top: r.top, size: r.size, pick: [r.shellMesh, r.topMesh], tag, status: "idle" };
  });
  [inst.jacks, inst.caps, inst.stools, inst.planks].forEach((i) => i.build(scene));
  Y.fillBackground(occupied);
  const pickables = blocks.flatMap((b) => [...b.zones.map((z) => z.mesh), ...b.pick]);

  // ---------- 사람 ----------
  // 모두 InstancedMesh 하나(몸통)·하나(안전모)로 그리고 매 프레임 위치만 바꾼다. 색 = 역할
  const ROLE = {
    worker: { body: 0xd0742c, helmet: 0xf5f5f0, label: "작업자" },
    watch: { body: 0x2f5f9a, helmet: 0xf0c419, label: "감시인" },
    measurer: { body: 0x6f9f2a, helmet: 0xffffff, label: "측정요원" },
    super: { body: 0x1f2a44, helmet: 0xd63a4a, label: "관리감독자" },
  };
  const MAXP = 200;
  const bodyIM = new T.InstancedMesh(workerBodyGeo, new T.MeshLambertMaterial({ color: 0xffffff }), MAXP);
  const helmIM = new T.InstancedMesh(helmetGeo, new T.MeshLambertMaterial({ color: 0xffffff }), MAXP);
  [bodyIM, helmIM].forEach((m) => { m.instanceMatrix.setUsage(T.DynamicDrawUsage); m.count = 0; m.frustumCulled = false; scene.add(m); });
  const people = []; // { role, zone, pos, yaw, route, ri, wait, mode, n, ... }
  const sparkGeo = new T.SphereGeometry(0.16, 8, 6);
  const rnd = (a, b) => a + Math.random() * (b - a);
  function addPerson(p) {
    const i = people.length;
    if (i >= MAXP) return null;
    Object.assign(p, { i, yaw: p.yaw || 0, route: [], ri: 0, wait: p.wait || 0, speed: 1 });
    const c = ROLE[p.role];
    bodyIM.setColorAt(i, new T.Color(c.body));
    helmIM.setColorAt(i, new T.Color(c.helmet));
    bodyIM.instanceColor.needsUpdate = helmIM.instanceColor.needsUpdate = true;
    people.push(p);
    return p;
  }
  const zoneOf = (id) => blocks.flatMap((b) => b.zones).find((z) => z.def.id === id);
  // 작업자가 안에 있어야 하는가: 허가 시간 안 · 쉬는 시간 아님 · 법정 초과(대피) 아님
  function shouldBeIn(a) {
    const pr = PRESENCE[a.def.id] || {};
    const from = a.def.workStart ?? pr.from ?? -Infinity;
    if (simT < from) return false;
    if ((pr.breaks || []).some(([t0, t1]) => simT >= t0 && simT < t1)) return false;
    const z = zoneOf(a.def.id);
    return !(z && z.status === "legal");
  }
  Object.values(anchors).forEach((a) => {
    if (!a.def.permit) return;
    if (!a.def.unapproved) addPerson({ role: "watch", zone: a.def.id, pos: a.watch.clone(), yaw: 0.4 });
    for (let k2 = 0; k2 < a.def.permit.workers; k2++) {
      const w = addPerson({ role: "worker", zone: a.def.id, n: k2 + 1, mode: "init", pos: a.stand(k2), breakIn: rnd(15, 45) });
      if (a.hot && k2 === 0) {
        w.spark = new T.Mesh(sparkGeo, new T.MeshBasicMaterial({ color: 0xcfe9ff, transparent: true, blending: T.AdditiveBlending, depthWrite: false }));
        scene.add(w.spark);
      }
    }
  });
  const go = (p, pts, speed = 1) => { p.route = pts.map((v) => v.clone()); p.ri = 0; p.speed = speed; };
  // 작업자 한 명의 다음 행동 (경로를 다 걸었을 때)
  function nextWorker(p, dt) {
    const a = anchors[p.zone];
    const want = shouldBeIn(a);
    if (p.mode === "init") {
      // 처음: 안에 있어야 하면 바로 안 아무 곳, 아니면 출입현황판 앞
      if (want) { p.pos.copy(a.inside()); p.mode = "in"; } else { p.pos.copy(a.stand(p.n - 1)); p.mode = "out"; }
      return;
    }
    if (p.mode === "in") {
      const evac = zoneOf(p.zone)?.status === "legal";
      const others = people.filter((q) => q.zone === p.zone && q.role === "worker" && q !== p && q.mode !== "in").length;
      p.breakIn -= dt;
      if (!want || (p.breakIn <= 0 && others === 0)) {
        // 밖으로: 출입구까지 간 뒤 들어온 길을 거꾸로
        go(p, [...a.entry.slice().reverse(), a.stand(p.n - 1)], evac ? 2.2 : 1);
        p.mode = "exiting";
        p.breakIn = rnd(25, 60);
        p.rest = want ? rnd(5, 10) : 0;
        return;
      }
      go(p, [a.inside()], 0.55);
      p.wait = rnd(0.8, 3.5);
      return;
    }
    if (p.mode === "exiting") { p.mode = "out"; p.wait = p.rest || 0; return; }
    if (p.mode === "out") {
      if (want) { go(p, [...a.entry, a.inside()]); p.mode = "entering"; }
      else p.wait = 1;
      return;
    }
    if (p.mode === "entering") { p.mode = "in"; p.wait = rnd(0.5, 2); }
  }
  // 측정요원·관리감독자: 관제 화면의 사람 목록을 따라 (출동 중이면 도착 시각에 맞춰 큰길로 이동)
  const staff = new Map(); // id → person
  function syncStaff(list) {
    (list || []).forEach((s0) => {
      let p = staff.get(s0.id);
      const role = s0.role === "측정요원" ? "measurer" : "super";
      if (!p) {
        if (role === "super" && s0.status === "대기") return;
        p = addPerson({ role, pos: role === "measurer" ? Y.base(s0.area) : V(0, 0, Y.ROAD_Z), staff: true });
        if (!p) return;
        staff.set(s0.id, p);
      }
      p.info = s0;
      const a = s0.zoneId ? anchors[s0.zoneId] : null;
      const spot = a ? a.stand(role === "measurer" ? 5 : 6) : null;
      if (s0.status === "출동 중" && spot) {
        if (p.trip?.zone !== s0.zoneId) {
          const from = p.pos.clone();
          const t0 = Math.min(simT, (s0.arriveAt ?? simT + 5) - 5);
          const route = [from, V(from.x, 0, Y.ROAD_Z), V(spot.x, 0, Y.ROAD_Z), spot];
          p.trip = { zone: s0.zoneId, route, t0, t1: s0.arriveAt ?? simT + 5 };
        }
        p.hidden = false;
      } else if (s0.status === "현장 도착" && spot) {
        p.trip = null;
        p.goal = spot;
        p.hidden = false;
      } else {
        p.trip = null;
        p.goal = role === "measurer" ? Y.base(s0.area).add(V(staffIndex(s0.id) * 1.2, 0, 0)) : null;
        p.hidden = role === "super";
      }
    });
  }
  const staffIndex = (id) => [...staff.keys()].indexOf(id);
  function along(route, f) {
    const segs = [];
    let total = 0;
    for (let k2 = 0; k2 < route.length - 1; k2++) { const L = route[k2].distanceTo(route[k2 + 1]); segs.push(L); total += L; }
    let d = Math.max(0, Math.min(1, f)) * total;
    for (let k2 = 0; k2 < segs.length; k2++) {
      if (d <= segs[k2] || k2 === segs.length - 1) return route[k2].clone().lerp(route[k2 + 1], segs[k2] ? Math.min(1, d / segs[k2]) : 1);
      d -= segs[k2];
    }
    return route[route.length - 1].clone();
  }
  const pm = new T.Matrix4(), pq = new T.Quaternion(), UP = V(0, 1, 0), ONE = V(1, 1, 1), HIDE = V(0, -999, 0);
  function stepPeople(dt, now) {
    people.forEach((p) => {
      if (p.staff) {
        if (p.trip) {
          const tgt = along(p.trip.route, (simT - p.trip.t0) / Math.max(0.1, p.trip.t1 - p.trip.t0));
          const d = tgt.clone().sub(p.pos);
          if (d.lengthSq() > 1e-6) p.yaw = Math.atan2(d.x, d.z);
          p.pos.lerp(tgt, Math.min(1, dt * 3));
        } else if (p.goal) {
          const d = p.goal.clone().sub(p.pos);
          if (d.length() > 0.05) { p.yaw = Math.atan2(d.x, d.z); p.pos.addScaledVector(d.normalize(), Math.min(d.length(), dt * 1.3)); }
        }
        return;
      }
      if (p.role === "watch") { p.yaw = 0.4 + 0.5 * Math.sin(now / 3000 + p.i); return; }
      if (p.wait > 0) { p.wait -= dt; return; }
      if (p.ri < p.route.length) {
        const tgt = p.route[p.ri];
        const d = tgt.clone().sub(p.pos);
        const climb = Math.abs(d.y) > Math.hypot(d.x, d.z);
        const v = (climb ? 0.4 : 1.1) * p.speed; // m/s (걷기 · 사다리)
        const L = d.length();
        if (L <= v * dt) { p.pos.copy(tgt); p.ri++; }
        else {
          p.pos.addScaledVector(d, (v * dt) / L);
          if (!climb) p.yaw = Math.atan2(d.x, d.z);
        }
        return;
      }
      nextWorker(p, dt);
    });
    // 행렬 갱신: 걷는 중이면 살짝 위아래로
    people.forEach((p) => {
      const moving = !p.staff && p.role === "worker" && p.ri < p.route.length && p.wait <= 0;
      const bob = moving ? Math.abs(Math.sin(now / 160 + p.i)) * 0.04 : 0;
      pq.setFromAxisAngle(UP, p.yaw);
      pm.compose(p.hidden ? HIDE : V(p.pos.x, p.pos.y + bob, p.pos.z), pq, ONE);
      bodyIM.setMatrixAt(p.i, pm);
      helmIM.setMatrixAt(p.i, pm);
      if (p.spark) {
        const on = p.mode === "in" && p.wait > 0 && zoneOf(p.zone)?.status !== "legal";
        p.spark.visible = on;
        if (on) {
          p.spark.position.set(p.pos.x + Math.sin(p.yaw) * 0.45, p.pos.y + 0.9, p.pos.z + Math.cos(p.yaw) * 0.45);
          p.spark.material.opacity = Math.random() < 0.55 ? 0.3 + Math.random() * 0.7 : 0;
          p.spark.scale.setScalar(0.6 + Math.random() * 0.8);
        }
      }
    });
    bodyIM.count = helmIM.count = people.length;
    bodyIM.instanceMatrix.needsUpdate = helmIM.instanceMatrix.needsUpdate = true;
  }
  function personText(p) {
    const r = ROLE[p.role].label;
    if (p.staff) {
      const s0 = p.info || {};
      const where = s0.zoneId ? zoneOf(s0.zoneId)?.def.name : null;
      const st = s0.status === "출동 중" ? `→ ${where} 이동 중${s0.arriveAt ? ` · ${fmtTime(s0.arriveAt)} 도착 예정` : ""}` : s0.status === "현장 도착" ? `${where} 현장 도착` : "대기";
      return { title: `${r} ${s0.name || ""}`, rows: [st, s0.role === "측정요원" ? `담당 ${s0.area}` : ""] };
    }
    const a = anchors[p.zone];
    const pm0 = a.def.permit;
    const where = { in: "구역 안 작업 중", entering: "출입구로 들어가는 중", exiting: "밖으로 나오는 중", out: "출입현황판 앞 대기", init: "" }[p.mode] || "";
    if (p.role === "watch") return { title: `${r} · ${a.def.name}`, rows: [`${pm0.task} · ${pm0.no}`, "출입구 밖에서 출입·환기 확인"] };
    const inNow = people.filter((q) => q.zone === p.zone && q.role === "worker" && q.mode === "in").length;
    if (a.def.unapproved) return { title: `${r} ${p.n}/${pm0.workers} · ${a.def.name}`, rows: [`미승인 · ${pm0.no}`, where, `허가 0명 · 지금 안 ${inNow}명`] };
    return { title: `${r} ${p.n}/${pm0.workers} · ${a.def.name}`, rows: [`${pm0.task} · ${pm0.no}`, where, `허가 인원 ${pm0.workers}명 · 지금 안 ${inNow}명`] };
  }

  // 출입현황판 그림 (현장 사진를 줄인 것): 왼쪽 질식 위험 표지 · 오른쪽 출입증이 매달리는 집게 (번호 1–8)
  // tags: 지금 걸린 출입증의 작업자 번호 (들어가는 중 · 안 · 나오는 중)
  function drawBoard(c, def, tags) {
    const W = BOARD_W, H = BOARD_H, L = 300; // L: 왼쪽 표지 폭
    const RED = "#d63a4a";
    c.fillStyle = RED; c.fillRect(0, 0, W, H);
    // 왼쪽: 질식 위험공간 표지
    c.fillStyle = "#ffffff"; c.fillRect(12, 12, L - 24, H - 24);
    c.textAlign = "center";
    c.fillStyle = "#1d1d1f"; c.font = "bold 40px sans-serif"; c.fillText("질식 위험공간", L / 2, 66);
    c.font = "bold 22px sans-serif"; c.fillText("“관계자외 출입금지”", L / 2, 104);
    c.beginPath(); c.ellipse(L / 2, 186, 100, 54, 0, 0, Math.PI * 2); c.fillStyle = RED; c.fill();
    c.fillStyle = "#ffe14d"; c.font = "bold 54px sans-serif"; c.fillText("위험", L / 2, 205);
    c.fillStyle = "#1d1d1f"; c.font = "bold 18px sans-serif";
    ["출입전 산소·유해가스 측정", "작업전·작업중 지속 환기", "구조 시 송기마스크 착용"].forEach((t, i) => c.fillText(t, L / 2, 282 + i * 32));
    // 오른쪽: 출입현황판 · 걸이 막대 두 줄에 집게 4개씩(4×2). 작업자는 자기 자리(작업자 번호 순)에 출입증을 건다
    // 번호·인원 글씨는 쓰지 않고, 현장 사진처럼 비닐 케이스에 넣은 출입증이 살짝 기울어 매달린다
    const X = L + 6, RW = W - X - 12, sw = RW / 4;
    c.fillStyle = "#ffffff"; c.font = "bold 30px sans-serif"; c.fillText("밀폐공간 출입현황판", X + RW / 2, 46);
    c.font = "17px sans-serif"; c.fillText(def.unapproved ? `미승인 · ${def.permit.no}` : `${def.permit.task} · ${def.permit.no}`, X + RW / 2, 74);
    const crew = crewOf(def.id);
    const ROWS = [96, 244]; // 걸이 막대 높이
    ROWS.forEach((ry) => {
      c.fillStyle = "#8e959e"; c.fillRect(X + 8, ry, RW - 16, 6); // 걸이 막대
      c.fillStyle = "#b9bfc6"; c.fillRect(X + 8, ry, RW - 16, 2);
    });
    for (let k = 0; k < 8; k++) {
      const cx = X + sw * ((k % 4) + 0.5), ry = ROWS[Math.floor(k / 4)];
      const n = tags.includes(k + 1) ? k + 1 : undefined;
      if (n !== undefined) {
        const m = crew.find((x) => x.n === n);
        const cw = 58, ch = 122;
        c.save();
        c.translate(cx, ry + 20);
        c.rotate((((n * 37) % 7) - 3) * (Math.PI / 180));
        c.shadowColor = "rgba(0,0,0,0.35)"; c.shadowBlur = 8; c.shadowOffsetY = 4;
        c.fillStyle = "#eef4fa"; c.fillRect(-cw / 2, 0, cw, ch); // 비닐 케이스
        c.shadowColor = "transparent";
        c.strokeStyle = "#9fb3c8"; c.lineWidth = 2; c.strokeRect(-cw / 2, 0, cw, ch);
        c.fillStyle = "#ffffff"; c.fillRect(-cw / 2 + 4, 5, cw - 8, ch - 9); // 출입증
        c.fillStyle = RED; c.fillRect(-cw / 2 + 4, 5, cw - 8, 16);
        c.fillStyle = "#ffffff"; c.font = "bold 11px sans-serif"; c.fillText("출입증", 0, 17);
        c.fillStyle = "#d5dae1"; c.fillRect(-16, 26, 32, 38); // 사진 자리 (안전모 쓴 작업자)
        c.fillStyle = "#6b7480"; c.beginPath(); c.ellipse(0, 64, 13, 11, 0, Math.PI, 0); c.fill();
        c.fillStyle = "#a9b1ba"; c.beginPath(); c.arc(0, 45, 7, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#f2c230"; c.beginPath(); c.arc(0, 42, 8, Math.PI, 0); c.fill(); c.fillRect(-10, 41, 20, 3);
        c.fillStyle = "#1d1d1f"; c.font = "bold 14px sans-serif"; c.fillText(m ? m.name : "", 0, 82);
        c.fillStyle = "#c4c9d0"; [91, 99, 107].forEach((y) => c.fillRect(-19, y, 38, 3)); // 소속·회사·연락처 줄
        c.restore();
      }
      // 집게 (출입증이 없어도 보인다)
      c.fillStyle = "#8e959e"; c.fillRect(cx - 8, ry - 2, 16, 26);
      c.fillStyle = "#c9ced4"; c.fillRect(cx - 6, ry, 12, 20);
      c.strokeStyle = "#6c737b"; c.lineWidth = 1.5; c.beginPath(); c.arc(cx, ry + 5, 3, 0, Math.PI * 2); c.stroke();
    }
    c.textAlign = "start";
  }

  // 출입현황판: 작업 시작 전에는 숨기고, 걸린 출입증이 바뀌면 그림을 다시 그리고 React에 알린다
  const TAGGED = new Set(["entering", "in", "exiting"]);
  function updateBoards() {
    boards.forEach((bd) => {
      const pr = PRESENCE[bd.zone] || {};
      bd.group.visible = simT >= (bd.def.workStart ?? pr.from ?? -Infinity);
      const ns = people.filter((p) => p.zone === bd.zone && p.role === "worker" && TAGGED.has(p.mode)).map((p) => p.n).sort((a, b) => a - b);
      const key = ns.join(",");
      if (key === bd.key && bd.group.visible === bd.shown) return;
      if (key !== bd.key) {
        const c = bd.tex.image.getContext("2d");
        c.clearRect(0, 0, BOARD_W, BOARD_H);
        drawBoard(c, bd.def, ns);
        bd.tex.needsUpdate = true;
      }
      bd.key = key;
      bd.shown = bd.group.visible;
      opts.onCrew?.(bd.zone, ns, bd.shown);
    });
  }

  // ---------- 이름표 ----------
  // 공정 이름은 3D 바닥 글씨로 쓴다 (yard3d.js floorText). 떠 있는 이름표는 두지 않는다
  const stageLabels = [];
  const extraLabels = [].map((l) => { // 3D 위 안내 글씨는 최소한만 (공정 이름표 · 문제 칸 이름표만 남김)
    const el = document.createElement("span");
    el.className = "b3-place";
    el.textContent = l.text;
    host.appendChild(el);
    return { ...l, el };
  });

  // 공정 바로가기
  const bar = document.createElement("div");
  bar.className = "b3-bar";
  const stageBar = document.createElement("div");
  stageBar.className = "seg";
  const toolBar = document.createElement("div");
  toolBar.className = "seg";
  bar.append(stageBar, toolBar);
  host.appendChild(bar);
  function renderStageBar() {
    // 누르면 그 공정으로 카메라가 날아간다: 고른 곳·마우스 올린 곳에 화살표
    const go = `<svg class="go" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const btns = [`<button data-goto="all" class="${focus === "all" ? "on" : ""}" title="조선소 전체 보기">전체${go}</button>`];
    Y.STAGES.forEach((st) => {
      const bs = blocks.filter((b) => b.def.stage === st.key);
      btns.push(`<button data-goto="${st.key}" class="${focus === st.key ? "on" : ""}" title="${st.name}(으)로 이동">${st.name}${bs.length ? ` <span class="n">${bs.length}</span>` : ""}${go}</button>`);
    });
    stageBar.innerHTML = btns.join("");
    toolBar.innerHTML = `<button data-struct class="${showStruct ? "on" : ""}" title="공장 기둥·벽·지붕·크레인">구조물 보기</button>`;
  }

  // ---------- 카메라 조작 ----------
  // 조선소 전체 (공장 줄 + 도크, 도크 위에 공장 줄을 붙여 놓은 배치). 정면(az 0)에서 똑바로, 위에서 내려다보게.
  // 거리 r은 화면 가로세로 비율에 맞춰 resize()에서 정한다: 조선소 가로 폭이 화면 폭에 거의 꽉 차게 (빈 바닥이 덜 보이게)
  const HOME = { az: 0, el: 1.26, r: 780, target: V(118, -15, -55) }; // 미터
  const homeR = (aspect) => Math.min(950, Math.max(620, 1350 / aspect));
  let homed = false;
  const cam = { az: HOME.az, el: HOME.el, r: HOME.r, target: HOME.target.clone() };
  const camGoal = { az: cam.az, el: cam.el, r: cam.r, target: cam.target.clone() };
  // 화면 가운데 옮기기 (px, +면 내용이 왼쪽으로): 구역 확대 때는 오른쪽 에이전트 창(420px + 여백)을 피하고,
  // 왼쪽 구역 상세가 3D를 덮고 있으면(setInsets) 그만큼 반대로. 둘 다 있으면 그 사이 가운데
  // 왼쪽 창이 없을 때도 왼쪽 위 알람 배너가 일부를 가리므로 BANNER_PX만큼은 왼쪽이 덮인 것으로 본다
  const RIGHT_PX = 460, BANNER_PX = 220;
  let zoneFocus = false, leftInset = 0, shiftCur = 0;
  const shiftGoal = () => ((zoneFocus ? RIGHT_PX : 0) - (leftInset || (zoneFocus ? BANNER_PX : 0))) / 2;
  let drag = null;
  const canvas = renderer.domElement;
  canvas.addEventListener("pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: 0, pan: e.button === 2 || e.shiftKey };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("pointermove", (e) => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      drag.x = e.clientX; drag.y = e.clientY;
      if (drag.pan) {
        // 오른쪽 버튼(또는 Shift) 끌기 = 화면 이동
        const s = cam.r * 0.0016;
        const right = V(Math.cos(cam.az), 0, -Math.sin(cam.az));
        const fwd = V(-Math.sin(cam.az), 0, -Math.cos(cam.az));
        camGoal.target.addScaledVector(right, -dx * s).addScaledVector(fwd, dy * s);
        cam.target.copy(camGoal.target);
      } else {
        camGoal.az -= dx * 0.007;
        camGoal.el = Math.min(1.45, Math.max(0.1, camGoal.el + dy * 0.005));
        cam.az = camGoal.az; cam.el = camGoal.el;
      }
      hideTip();
    } else {
      hover(e);
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    if (drag && drag.moved < 5 && !drag.pan) {
      const hit = pick(e);
      if (hit && hit.block) {
        select(hit.block);
        if (hit.board) opts.onBoard?.(hit.zone);
        else if (hit.zone) opts.onZone?.(hit.zone);
      } else if (!hit && selected) select(null);
    }
    drag = null;
  });
  canvas.addEventListener("pointerleave", hideTip);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    camGoal.r = Math.min(1600, Math.max(2, camGoal.r * Math.exp(e.deltaY * 0.0012)));
  }, { passive: false });

  const ray = new T.Raycaster();
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    const p = new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(p, camera);
    // 출입현황판이 가장 먼저 (구역 부피·사람보다 앞에서 눌리게)
    const bh = ray.intersectObjects(boards.filter((bd) => bd.group.visible).map((bd) => bd.face), false)[0];
    if (bh) return bh.object.userData;
    // 그다음 사람 (작게 보여서 가까이 볼 때만)
    if (cam.r < 200 && people.length) {
      bodyIM.computeBoundingSphere?.(); // three 0.149의 InstancedMesh에는 없다 (없으면 인스턴스마다 따로 검사됨)
      const ph = ray.intersectObject(bodyIM, false).find((h) => h.instanceId !== undefined && !people[h.instanceId]?.hidden);
      if (ph) {
        const person = people[ph.instanceId];
        const zid = person.zone || person.info?.zoneId;
        const z = zid ? zoneOf(zid) : null;
        return { person, block: z ? z.mesh.userData.block : null, zone: zid || null };
      }
    }
    const hits = ray.intersectObjects(pickables, false);
    if (!hits.length) return null;
    // 선택한 블록 우선, 아니면 가장 앞 블록. 그 블록 안에서는 구역 부피를 외판보다 먼저
    const blockId = selected && hits.some((h) => h.object.userData.block === selected) ? selected : hits[0].object.userData.block;
    const mine = hits.filter((h) => h.object.userData.block === blockId);
    return (mine.find((h) => h.object.userData.zone) || mine[0]).object.userData;
  }

  const tip = document.createElement("div");
  tip.className = "b3-tip";
  tip.hidden = true;
  host.appendChild(tip);
  function hideTip() { tip.hidden = true; canvas.style.cursor = "grab"; }
  function hover(e) {
    const hit = pick(e);
    if (!hit) return hideTip();
    canvas.style.cursor = "pointer";
    if (hit.person) {
      const t0 = personText(hit.person);
      tip.innerHTML = `<b>${t0.title}</b>${t0.rows.filter(Boolean).map((r0) => `<small>${r0}</small>`).join("")}`;
      placeTip(e);
      tip.hidden = false;
      return;
    }
    if (hit.board) {
      const bd = boards.find((x) => x.zone === hit.zone);
      const n = bd.key ? bd.key.split(",").length : 0;
      tip.innerHTML = `<b>출입현황판 · ${bd.def.name}</b><small>${bd.def.unapproved ? `미승인 · ${bd.def.permit.no}` : `${bd.def.permit.task} · ${bd.def.permit.no}`}</small><small>출입증 ${n}명 걸림 (허가 ${bd.def.unapproved ? 0 : bd.def.permit.workers}명)</small><small>누르면 작업자 현황</small>`;
      placeTip(e);
      tip.hidden = false;
      return;
    }
    const b = blocks.find((x) => x.def.id === hit.block);
    const z = hit.zone ? b.zones.find((x) => x.def.id === hit.zone) : null;
    const st = z ? z.status : b.status;
    const stage = Y.stageOf(b.def.stage);
    const rows = z
      ? [z.def.unapproved ? `미승인 · ${z.def.permit.task} · ${z.def.permit.no}` : z.def.permit ? `${z.def.permit.task} · ${z.def.permit.no}` : z.status === "unauth" ? "오늘 허가 없음 → 가스 감지 (무허가 작업 의심)" : "오늘 허가 없음", ventText(z.def), z.def.permit ? `허가 ${z.def.unapproved ? 0 : z.def.permit.workers}명 · 지금 안 ${people.filter((q) => q.zone === z.def.id && q.role === "worker" && q.mode === "in").length}명 · 측정기 ${z.def.sensor}` : `측정기 ${z.def.sensor}`]
      : [b.def.loc];
    tip.innerHTML = `<b>${b.def.name}${z ? " · " + z.def.name : ""}</b><span class="st s-${st}">${LABEL[st] || ""}</span>${rows.map((r) => `<small>${r}</small>`).join("")}<small>공정: ${stage.name}</small>`;
    placeTip(e);
    tip.hidden = false;
  }
  // 설명 상자를 마우스 옆에. 페이지 전체를 줄여 보이게 한 경우(index.html zoom)에도 맞도록
  // 화면 좌표를 3D 칸 안의 CSS px로 바꾼다 (잰 폭 ÷ 원래 폭 = 줄인 비율)
  function placeTip(e) {
    const r = host.getBoundingClientRect();
    const k = r.width / host.offsetWidth || 1;
    tip.style.left = `${Math.min((e.clientX - r.left) / k + 14, host.offsetWidth - 270)}px`;
    tip.style.top = `${Math.min((e.clientY - r.top) / k + 14, host.offsetHeight - 110)}px`;
  }
  function ventText(def) {
    const n = def.vent ? def.vent.blowers : def.permit && !def.unapproved ? 1 : 0;
    if (!n) return "송풍기 없음 (자연 환기)";
    const stopped = def.vent && def.vent.stopAt !== undefined && simT >= def.vent.stopAt;
    return stopped ? `송풍기 ${n}대 중 1대 정지 의심 (${fmtTime(def.vent.stopAt)}) · 현장 확인` : `송풍기 ${n}대 가동`;
  }

  // ---------- 선택 ----------
  let selected = null;
  let focus = "all";
  let showStruct = false; // 위쪽 구조물 (기본 숨김)
  const panel = document.createElement("div");
  panel.className = "b3-panel";
  panel.hidden = true;
  host.appendChild(panel);
  // silent: 화면(React)에 알리지 않는다 = 왼쪽 구역 상세를 열지 않고 3D만 움직인다
  function select(id, zoneId, silent = false) {
    selected = id;
    if (!silent) opts.onSelect?.(id);
    const b = blocks.find((x) => x.def.id === id);
    const bd = zoneId && boards.find((x) => x.zone === zoneId);
    zoneFocus = !!(b && bd);
    if (b && bd) {
      // 구역을 고른 경우: 그 구역 출입현황판 앞면이 보이는 쪽에서 조금 비스듬히 위에서.
      // 현황판과 밀폐구역(출입 경로 끝 = 구역 안)의 가운데를 보고, 구역 전체가 들어오게 한 발 물러선다
      const p = bd.face.getWorldPosition(V(0, 0, 0));
      const n = bd.face.getWorldDirection(V(0, 0, 0)); // 판 앞면이 향하는 쪽
      const inner = anchors[zoneId]?.entry?.at(-1);
      camGoal.target.copy(inner ? p.clone().lerp(inner, 0.5) : p);
      camGoal.az = Math.atan2(n.x, n.z) + 0.45;
      camGoal.el = 0.34; // 옆에서 보듯 조금 낮게: 주변 블록·공장도 보이게
      camGoal.r = 34;
    } else if (b) {
      // 블록 앞면(장비·출입구 쪽)을 비스듬히 옆에서: 층으로 나뉜 구획이 보이게
      camGoal.target.copy(b.group.position).add(V(0, b.size.H * 0.45, 0));
      camGoal.r = Math.max(b.size.L, b.size.B, b.size.H * 1.4) * 1.7 + 8;
      camGoal.el = b.size.H > 6 ? 0.32 : 0.48;
      camGoal.az = -0.55;
    }
    renderPanel();
  }
  function goto(key) {
    focus = key;
    zoneFocus = false;
    selected = null;
    opts.onSelect?.(null);
    Y.showStructures(showStruct, key);
    renderPanel();
    if (key === "all") {
      Object.assign(camGoal, { az: HOME.az, el: HOME.el, r: HOME.r });
      camGoal.target.copy(HOME.target);
    } else {
      const f = Y.focusOf(Y.stageOf(key));
      camGoal.target.copy(f.target);
      Object.assign(camGoal, { az: -0.25, el: f.el, r: f.r });
    }
    renderStageBar();
  }
  function renderPanel() {
    const b = blocks.find((x) => x.def.id === selected);
    panel.hidden = !b || opts.panel === false;
    if (panel.hidden) return;
    const stage = Y.stageOf(b.def.stage);
    panel.innerHTML = `
      <div class="b3-panel-head"><b>${b.def.name}</b><span class="st s-${b.status}">${LABEL[b.status] || ""}</span></div>
      <div class="muted">${b.def.loc || ""}</div>
      <div class="muted">공정: ${stage.name}</div>
      <ul>${b.zones.map((z) => `<li><i class="sq s-${z.status}"></i><span>${z.def.name}<small>${z.def.unapproved ? `미승인 · ${z.def.permit.task} · 출입 ${z.def.permit.workers}명` : z.def.permit ? `${z.def.permit.task} · 작업 ${z.def.permit.workers}명` : "작업 없음"}</small><small>${ventText(z.def)}</small><small>측정기 ${z.def.sensor} (구역 안 하단)</small></span><em class="st s-${z.status}">${LABEL[z.status] || ""}</em></li>`).join("")}</ul>
      <div class="b3-panel-foot">
        <button class="btn ghost" data-b3-close>닫기</button>
        <button class="btn" data-todo="BK-01 ${b.def.id}">블록 상세 →</button>
      </div>`;
  }
  panel.addEventListener("click", (e) => { if (e.target.closest("[data-b3-close]")) select(null); });
  function onHostClick(e) {
    const todo = e.target.closest("[data-todo]");
    if (todo) return opts.onTodo?.(todo.dataset.todo);
    const t = e.target.closest(".b3-tag");
    if (t) return select(t.dataset.block === selected ? null : t.dataset.block);
    if (e.target.closest("[data-struct]")) {
      showStruct = !showStruct;
      Y.showStructures(showStruct, focus);
      return renderStageBar();
    }
    const s = e.target.closest("[data-stage]");
    if (s) return goto(s.dataset.stage);
    const g = e.target.closest("[data-goto]");
    if (g) goto(g.dataset.goto);
  }
  host.addEventListener("click", onHostClick);

  // ---------- 상태 반영 (React가 매 렌더마다 호출) ----------
  let LABEL = {};
  let simT = 0;
  function update(list, labels, t, staffList) {
    LABEL = labels;
    if (t !== undefined) simT = t;
    syncStaff(staffList);
    const byId = new Map(list.map((x) => [x.id, x.status]));
    blocks.forEach((b) => {
      b.zones.forEach((z) => { z.status = byId.get(z.def.id) || "idle"; });
      b.status = b.zones.reduce((w, z) => (RANK[z.status] < RANK[w] ? z.status : w), "idle");
      b.tag.className = `b3-tag s-${b.status}${b.def.id === selected ? " sel" : ""}`;
      // 이름표: 블록 전체가 아니라 문제가 생긴 칸을 말한다
      const worst = b.zones.reduce((w, z) => (!w || RANK[z.status] < RANK[w.status] ? z : w), null);
      const bad = worst && RANK[worst.status] <= RANK.warn;
      b.tag.innerHTML = bad ? `<b>${worst.def.name}</b> ${LABEL[worst.status] || ""}` : `<b>${b.def.name}</b>`;
      b.tag.title = `${b.def.name} · ${b.def.loc}`;
    });
    blowers.forEach((bl) => {
      if (bl.label) bl.label.textContent = `송풍기 정지 의심 ${fmtTime(bl.stopAt)} · 현장 확인`;
    });
    renderStageBar();
    if (selected) renderPanel();
  }

  // ---------- 말풍선 (블록 위에 잠깐 띄우는 이벤트 문장) ----------
  const bubbles = [];
  function say(blockId, text, tone = "info", ms = 7000) {
    const b = blocks.find((x) => x.def.id === blockId);
    if (!b) return;
    const el = document.createElement("div");
    el.className = `b3-say t-${tone}`;
    el.textContent = text;
    host.appendChild(el);
    bubbles.push({ el, b, until: performance.now() + ms });
    // 한 블록에는 2개까지만 쌓는다
    const same = bubbles.filter((x) => x.b === b);
    if (same.length > 2) {
      same[0].el.remove();
      bubbles.splice(bubbles.indexOf(same[0]), 1);
    }
  }

  // ---------- 그리기 ----------
  const tmp = new T.Vector3();
  const IDLE_EDGE = new T.Color(0x5b6472);
  const LED_OFF = new T.Color(0x333333);
  let last = performance.now();
  let raf = 0;
  let disposed = false;
  function frame(now) {
    if (disposed) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // 화면이 숨겨져 있어도(다른 탭) 사람과 출입현황판은 계속 움직인다 (작업자 관리가 같은 값을 본다). 그리기만 쉰다
    stepPeople(dt, now);
    updateBoards();
    if (!host.offsetParent) return;
    Y.tick(dt, now);

    const pulse = 0.5 + 0.5 * Math.sin(now / 260);
    blocks.forEach((b) => {
      const dim = selected && selected !== b.def.id ? 0.35 : 1;
      b.zones.forEach((z) => {
        const c = STATUS_COLOR[z.status];
        z.mat.color.copy(c);
        let op = STATUS_OPACITY[z.status];
        // 문제 구역(법정 초과·결측·경계)은 자체 발광을 더해 조명과 상관없이 색이 또렷하게
        if (PULSE[z.status]) {
          op = 0.5 + 0.3 * pulse;
          z.mat.emissive.copy(c).multiplyScalar(0.3 + 0.35 * pulse);
        } else if (z.status === "missing" || z.status === "warn") {
          z.mat.emissive.copy(c).multiplyScalar(0.3);
        } else {
          z.mat.emissive.setRGB(0, 0, 0);
        }
        z.mat.opacity = op * dim;
        z.edgeMat.color.copy(z.status === "idle" ? IDLE_EDGE : c);
        z.edgeMat.opacity = EDGE_OPACITY[z.status] * dim;
        // 측정기 불빛: 결측이면 꺼짐, 법정 초과면 빠르게 깜박임
        const blink = PULSE[z.status] ? Math.sin(now / 90) > 0 : Math.sin(now / 500) > -0.6;
        z.leds.forEach((l) => l.material.color.copy(z.status === "missing" || !blink ? LED_OFF : c));
      });
      b.edgeMat.opacity = 0.6 * dim;
      b.shellMat.opacity = SHELL_OPACITY * dim;
      b.topMat.opacity = TOP_OPACITY * dim;
    });
    blowers.forEach((bl) => {
      const running = bl.stopAt === null || simT < bl.stopAt;
      if (running) bl.fan.rotation.x += dt * 18;
      bl.points.visible = running;
      if (running) {
        const p = bl.points.geometry.attributes.position;
        for (let i = 0; i < bl.N; i++) {
          const v = bl.curve.getPointAt((now / 2600 + i / bl.N) % 1);
          p.setXYZ(i, v.x, v.y, v.z);
        }
        p.needsUpdate = true;
      }
    });

    const k = Math.min(1, dt * 4.5);
    cam.r += (camGoal.r - cam.r) * k;
    cam.az += (camGoal.az - cam.az) * k;
    cam.el += (camGoal.el - cam.el) * k;
    cam.target.lerp(camGoal.target, k);
    // 화면 가운데를 shift px만큼 왼쪽으로: 보는 점을 카메라 오른쪽으로 그만큼(그 거리에서의 화면 폭 비율로) 옮긴다
    shiftCur += (shiftGoal() - shiftCur) * k;
    const vw = 2 * cam.r * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect;
    const sh = host.clientWidth ? (vw * shiftCur) / host.clientWidth : 0;
    const look = cam.target.clone().add(V(Math.cos(cam.az) * sh, 0, -Math.sin(cam.az) * sh));
    camera.position.set(
      look.x + cam.r * Math.cos(cam.el) * Math.sin(cam.az),
      look.y + cam.r * Math.sin(cam.el),
      look.z + cam.r * Math.cos(cam.el) * Math.cos(cam.az)
    );
    camera.lookAt(look);
    renderer.render(scene, camera);

    // 이름표: 공정 이름표 먼저 자리를 잡고, 블록 이름표는 상태 나쁜 것부터, 겹치면 위로 올린다
    const w = host.clientWidth, h = host.clientHeight;
    const toScreen = (v) => {
      tmp.copy(v).project(camera);
      return { x: ((tmp.x + 1) / 2) * w, y: ((1 - tmp.y) / 2) * h, z: tmp.z };
    };
    const far = cam.r > 450, near = cam.r < 150;
    Y.showFloorText(cam.r > 70);
    host.classList.toggle("far", far);
    // 공정 바로가기 줄 밑으로 들어가는 이름표는 숨긴다 (다른 공정을 가까이 볼 때 화면 위 끝에 몰림)
    const barX1 = bar.offsetLeft + toolBar.offsetLeft + toolBar.offsetWidth + 4, barY1 = bar.offsetTop + bar.offsetHeight + 4;
    const underBar = (x0, y0) => x0 < barX1 && y0 < barY1;
    const taken = [];
    stageLabels.forEach(({ el, pos }) => {
      const p = toScreen(pos);
      el.style.display = p.z < 1 && !(selected && cam.r < 70) ? "" : "none";
      if (el.style.display) return;
      const tw = el.offsetWidth, th = el.offsetHeight;
      if (underBar(p.x, p.y - th)) { el.style.display = "none"; return; }
      el.style.transform = `translate(${p.x}px,${p.y - th}px)`;
      taken.push({ x0: p.x, x1: p.x + tw, y0: p.y - th, y1: p.y });
    });
    blocks
      .map((b) => ({ b, ...toScreen(V(b.group.position.x, b.group.position.y + b.top, b.group.position.z)) }))
      .sort((p, q) => RANK[p.b.status] - RANK[q.b.status] || p.z - q.z)
      .forEach(({ b, x, y, z }) => {
        const el = b.tag;
        // 문제 있는 블록과 고른 블록만 이름표 (최소한만)
        const quiet = RANK[b.status] > RANK.warn && selected !== b.def.id;
        el.style.display = z < 1 && !quiet ? "" : "none";
        if (el.style.display) return;
        const tw = el.offsetWidth, th = el.offsetHeight;
        for (let i = 0; i < 8; i++) {
          const hit = taken.find((r) => x - tw / 2 < r.x1 && x + tw / 2 > r.x0 && y - th < r.y1 && y > r.y0);
          if (!hit) break;
          y = hit.y0 - 2;
        }
        if (underBar(x - tw / 2, y - th)) { el.style.display = "none"; return; }
        taken.push({ x0: x - tw / 2, x1: x + tw / 2, y0: y - th, y1: y });
        el.style.transform = `translate(${x - tw / 2}px,${y - th}px)`;
        el.style.opacity = selected && selected !== b.def.id ? 0.45 : 1;
      });
    blowers.forEach((bl) => {
      if (!bl.label) return;
      const stopped = simT >= bl.stopAt;
      const p = toScreen(bl.pos);
      const show = stopped && p.z < 1 && (near || selected === bl.block);
      bl.label.style.display = show ? "" : "none";
      if (show) bl.label.style.transform = `translate(-50%,-100%) translate(${p.x}px,${p.y}px)`;
    });
    // 말풍선: 블록 이름표 위로, 새것이 블록에 가깝게
    const nowMs = performance.now();
    for (let i = bubbles.length - 1; i >= 0; i--) {
      if (nowMs > bubbles[i].until) {
        bubbles[i].el.remove();
        bubbles.splice(i, 1);
      }
    }
    const stacked = new Map();
    [...bubbles].reverse().forEach(({ el, b, until }) => {
      const p = toScreen(V(b.group.position.x, b.group.position.y + b.top, b.group.position.z));
      const off = stacked.get(b) || 0;
      el.style.display = p.z < 1 ? "" : "none";
      const x = Math.min(w - el.offsetWidth / 2 - 8, Math.max(el.offsetWidth / 2 + 8, p.x));
      el.style.transform = `translate(-50%,-100%) translate(${x}px,${Math.max(el.offsetHeight + 8, p.y - 34 - off)}px)`;
      el.classList.toggle("fading", until - nowMs < 700);
      stacked.set(b, off + el.offsetHeight + 8);
    });
    extraLabels.forEach(({ el, pos, when }) => {
      const p = toScreen(pos);
      el.style.display = p.z < 1 && !far && !(selected && cam.r < 70) && (!when || when()) && !underBar(p.x - el.offsetWidth / 2, p.y - el.offsetHeight) ? "" : "none";
      el.style.transform = `translate(-50%,-100%) translate(${p.x}px,${p.y}px)`;
    });
  }

  function resize() {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // 전체 보기 거리: 화면 비율에 맞춘다. 처음엔 바로 그 거리에서 시작(다가가는 움직임 없이), 그 뒤엔 전체 보기 중일 때만 따라간다
    HOME.r = homeR(w / h);
    if (!homed) {
      homed = true;
      if (focus === "all" && !selected) cam.r = camGoal.r = HOME.r;
    } else if (focus === "all" && !selected) camGoal.r = HOME.r;
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  renderStageBar();
  // ?stage=outfit 처럼 공정을, ?block=B-D23 처럼 블록을 골라 시작할 수 있다 (데모·스크린샷용)
  const qs = new URLSearchParams(location.search);
  const startStage = qs.get("stage"), startBlock = qs.get("block");
  if (startStage && (startStage === "all" || Y.stageOf(startStage))) goto(startStage);
  if (startBlock && blocks.some((b) => b.def.id === startBlock)) select(startBlock);
  if (startStage || startBlock) {
    Object.assign(cam, { az: camGoal.az, el: camGoal.el, r: camGoal.r });
    cam.target.copy(camGoal.target);
  }
  raf = requestAnimationFrame(frame);

  // React가 화면을 내릴 때 (개발 모드 StrictMode는 한 번 내렸다 다시 올린다)
  function dispose() {
    disposed = true;
    cancelAnimationFrame(raf);
    ro.disconnect();
    host.removeEventListener("click", onHostClick);
    scene.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      mats.forEach((m) => {
        if (m.map) m.map.dispose();
        m.dispose();
      });
    });
    renderer.dispose();
    renderer.forceContextLoss();
    host.replaceChildren();
  }

  /** 3D를 덮는 왼쪽 창 폭(px). 그만큼 보이는 가운데를 오른쪽으로 부드럽게 옮긴다 */
  function setInsets(left) {
    leftInset = left || 0;
  }
  return { update, select, goto, say, setInsets, dispose };
}

function hasWebGL() {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    return false;
  }
}
