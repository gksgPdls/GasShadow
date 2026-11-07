// 3D 보기의 조선소 환경: 공정별 작업장(대조립·선행의장 공장, 선행도장 공장, PE장, 도크, 안벽)과 소품.
// 블록과 블록에 붙는 장비(송풍기·덕트·측정기)·사람은 block3d.js가 그린다.
//
// 참고한 자료 (README의 근거 목록과 같음)
//   - 공정 순서·밀폐구역 작업 공정: 멘토링 자료
//   - 공장 안 정반 지주·천장크레인·지붕 채광창·호스 다발: 현장 사진, 교육 자료 대조립·선행의장 사진
//   - 닫힌 도장공장(셀, 2 m 받침대, 천장 급기·바닥 배기, 매달린 작업대): Harland and Wolff paint hall 소개
//   - 옥외 PE장, 트랜스포터, 반목이 깔린 도크, 골리앗·지브 크레인: 교육 자료 PE장·운반·탑재 사진
//   - 선체 단면(이중저·호퍼·톱사이드): 현장 사진 단면도
//   - 공정 안 구역(2.7.1 배재 → 2.7.4 사상·검사, 2.9.1 Blasting · 2.9.2 Painting, 3.1.1 Setting → 3.1.4 사상·검사 …):
//     멘토링 자료 흐름도 번호와 교안 시트 사진 제목 (A·B는 같은 단계 사진 두 장이라 구역으로 나누지 않음)
// 크기·거리·배치·베이 수·셀 수는 설명용 가정이다.
// 이 파일 안은 1 단위 = 5 m로 그리고, 묶음 전체를 5배로 키워 장면(1 단위 = 1 m)에 올린다. 밖으로 돌려주는 좌표는 모두 미터.
//
// 가시성: 위를 가리는 구조물(공장 기둥·벽·지붕·천장크레인, 도장공장 칸막이·덕트·작업대, 크롤러 붐·골리앗·지브 크레인)은
// structure 묶음으로 따로 두고 기본은 숨긴다. 바닥(정반·통로)과 낮은 테두리만 남겨 블록 안 밀폐구역이 잘 보이게 한다.
// 크레인은 해당 공정(PE장·도크)을 가까이 볼 때만 나온다. 공정 바로가기 옆 [구조물 보기]로 모두 켤 수 있다.
import * as T from "three";

// ---------- 공용 도구 ----------
const V = (x, y, z) => new T.Vector3(x, y, z);
const lineMat = (color, opacity = 1) =>
  new T.LineBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
const meshMat = (color, opacity = 1, extra = {}) =>
  new T.MeshLambertMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1, side: T.DoubleSide, ...extra });
function box(parent, w, h, d, mat, x, y, z) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
// 선분을 모아 LineSegments 하나로 그린다 (그리기 호출 수를 줄이려고)
class Lines {
  constructor() { this.p = []; }
  seg(a, b) { this.p.push(a.x, a.y, a.z, b.x, b.y, b.z); }
  poly(pts, loop) {
    for (let i = 0; i < pts.length - 1; i++) this.seg(pts[i], pts[i + 1]);
    if (loop && pts.length > 2) this.seg(pts[pts.length - 1], pts[0]);
  }
  build(parent, mat) {
    if (!this.p.length) return null;
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(this.p, 3));
    const l = new T.LineSegments(g, mat);
    parent.add(l);
    return l;
  }
}
// 같은 모양을 여러 개 놓을 때 InstancedMesh로 한 번에
class Inst {
  constructor(geo, mat) { this.geo = geo; this.mat = mat; this.m = []; }
  // sy: 세로 배율만 따로 (지주 높이처럼)
  add(x, y, z, ry = 0, s = 1, sy = s) {
    const q = new T.Quaternion().setFromAxisAngle(V(0, 1, 0), ry);
    this.m.push(new T.Matrix4().compose(V(x, y, z), q, V(s, sy, s)));
  }
  build(parent) {
    if (!this.m.length) return null;
    const im = new T.InstancedMesh(this.geo, this.mat, this.m.length);
    this.m.forEach((m, i) => im.setMatrixAt(i, m));
    parent.add(im);
    return im;
  }
}
// 색인 있는 BufferGeometry 여러 개를 하나로 (position·index만)
function merge(geos) {
  const pos = [], idx = [];
  let off = 0;
  geos.forEach((g) => {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + off);
    else for (let i = 0; i < p.count; i++) idx.push(i + off);
    off += p.count;
  });
  const out = new T.BufferGeometry();
  out.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new T.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}
// 작업자: 몸통(캡슐) + 안전모(구). 색은 작업복
const workerBodyGeo = new T.CapsuleGeometry(0.055, 0.15, 3, 8);
workerBodyGeo.translate(0, 0.13, 0);
const helmetGeo = new T.SphereGeometry(0.048, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2);
helmetGeo.translate(0, 0.27, 0);

export const KIT = { V, lineMat, meshMat, box, Lines, Inst, merge, canvasTex, workerBodyGeo, helmetGeo };

// ---------- 배치 (1 단위 ≈ 5 m) ----------
// 공정마다 작업장 하나. 공장은 베이(bay) 2개이고, 베이 안을 작업 단계 순서대로 구역(area)으로 나눈다.
// 단계 이름·번호: 멘토링 자료 흐름도(2.7.1 배재 · 2.7.2 취부 …)와 교육 자료 시트 사진 제목.
// no(2.7 · 2.7.1 …)는 흐름도 목차 번호라 출처 대조용으로만 두고 화면에는 쓰지 않는다 (현장에서 부르는 이름이 아님).
// 공장 크기·베이 수·구역 길이·셀 수는 설명용 가정이다 (README 근거 표 참고).
// 구역 하나의 길이: 공장 안 6.5 (≈ 32 m, 블록 1개 + 통로) · 옥외 PE장은 큰 블록을 합치므로 8 (≈ 40 m)
const AREA_L = 6.5;
const ROW_X0 = -44; // 공장 줄 왼쪽 끝 (도크 위에 맞춰 붙여 놓는다)
const ROW_GAP = 2; // 공장 사이 통로
const BAY_W = 7; // 베이 폭 (≈ 35 m)
const SHOP_H = 6; // 처마 높이 (≈ 30 m)
const ROW_Z = -24; // 공장 줄의 가운데 z
const STAGES = [
  {
    key: "assembly", no: "2.7", name: "대조립", sub: "공장 안 정반에서 블록 완성", kind: "shop", confined: true, sup: 0.4, bays: 2,
    areas: [{ no: "2.7.1", name: "배재" }, { no: "2.7.2", name: "취부" }, { no: "2.7.3", name: "용접" }, { no: "2.7.4", name: "사상·검사" }],
  },
  {
    key: "outfit", no: "2.8", name: "선행의장", sub: "블록 상태에서 배관·의장품 설치", kind: "shop", confined: true, sup: 0.4, bays: 2,
    areas: [{ name: "의장품 조립" }, { name: "의장품 취부" }, { name: "의장품 용접" }, { name: "쉘터" }],
  },
  {
    key: "paint", no: "2.9", name: "선행도장", sub: "블라스팅·도장 셀 (닫힌 도장공장)", kind: "paintshop", confined: true, sup: 0.4, bays: 1,
    areas: [{ no: "2.9.1", name: "블라스팅 1" }, { no: "2.9.1", name: "블라스팅 2" }, { no: "2.9.2", name: "도장 1" }, { no: "2.9.2", name: "도장 2" }, { no: "2.9.2", name: "도장 3" }],
  },
  {
    key: "pe", no: "3.1", name: "PE장", sub: "옥외에서 블록 여러 개를 합침", kind: "yard", confined: false, sup: 0.35, al: 8, bays: 2,
    areas: [{ no: "3.1.1", name: "세팅" }, { no: "3.1.2", name: "취부" }, { no: "3.1.3", name: "용접" }, { no: "3.1.4", name: "사상·검사" }, { name: "탑재 대기" }],
  },
  {
    key: "erect", no: "3.3", name: "탑재 (도크)", sub: "골리앗 크레인으로 블록을 올려 배로 조립", kind: "dock", confined: false, sup: 0.3, cx: 28, bays: 0,
    areas: [{ no: "3.3.1", name: "계측·철목" }, { no: "3.3.2", name: "취부" }, { no: "3.3.3", name: "용접" }, { no: "3.3.4", name: "사상·검사" }],
  },
];
// 공장 줄: 왼쪽부터 통로 하나씩 두고 붙여 놓는다 (st.cx = 가운데, st.al = 구역 길이)
{
  let x = ROW_X0;
  STAGES.filter((st) => st.kind !== "dock").forEach((st) => {
    st.al = st.al ?? AREA_L;
    const L = st.areas.length * st.al + 2;
    st.cx = x + L / 2;
    x += L + ROW_GAP;
  });
}
const gapX = (i) => { // i번째와 i+1번째 공장 사이 통로의 x
  const row = STAGES.filter((st) => st.kind !== "dock");
  return row[i].cx + (row[i].areas.length * row[i].al + 2) / 2 + ROW_GAP / 2;
};
// 도크 128 × 18 단위 ≈ 640 m × 90 m (HD현대중공업 울산 3도크 640 m × 92 m, Lloyd's Register 조선소 표)
const DOCK = { x0: -32, x1: 96, z0: -9, z1: 9, floor: -2.6 };
const SEA_X = 96;
// 도크 안 배 2척: 앞(게이트 쪽)이 이번 호선 H-2541, 뒤가 다음 호선 (VLGC급 가정: 길이 230 m · 폭 36 m · 깊이 22 m)
const HULL = { len: 46, halfB: 3.6, depth: 4.4, db: 0.45 };
const SHIP_A = { cx: 62, name: "H-2541" };
const SHIP_B = { cx: 8, name: "H-2542" };
const ROAD_Z = -13;
const ROAD = [V(ROW_X0 - 4, 0, ROAD_Z), V(SEA_X - 6, 0, ROAD_Z)];

// 작업장의 바깥 경계 (x0..x1, z0..z1)
function stageBox(st) {
  if (st.kind === "dock") return { x0: DOCK.x0, x1: DOCK.x1, z0: DOCK.z0, z1: DOCK.z1 };
  const L = st.areas.length * st.al + 2;
  const D = st.kind === "paintshop" ? 12 : st.bays * BAY_W;
  return { x0: st.cx - L / 2, x1: st.cx + L / 2, z0: ROW_Z - D / 2, z1: ROW_Z + D / 2 };
}
// 구역 i · 베이 j의 가운데
function areaCenter(st, i, j = 0) {
  const b = stageBox(st);
  const x = b.x0 + 1 + st.al * (i + 0.5);
  if (st.kind === "paintshop") return V(x, 0, ROW_Z);
  return V(x, 0, b.z0 + BAY_W * (j + 0.5));
}

export const U = 5; // 이 파일의 1 단위 = 5 m
// 받침(정반 지주) 높이 m: 사람이 블록 아래로 지나다님 (현장 사진)
// 도장 셀은 블록 아래까지 칠하려고 2 m 받침대 위에 올린다 (Harland & Wolff 도장홀 설명, 2차 출처)
const SUP_M = { shop: 1.6, paintshop: 2.0, yard: 1.4, dock: 0 };

export function buildYard(world) {
  const scene = new T.Group(); // 5 m 단위로 그리는 묶음
  scene.scale.setScalar(U);
  world.add(scene);
  const M = (v) => v.clone().multiplyScalar(U); // 5 m 단위 → 미터
  const ticks = [];
  const stageOf = (k) => STAGES.find((s) => s.key === k);
  // 위를 가리는 구조물 묶음 (기본 숨김)
  const structure = new T.Group();
  const cranes = { pe: new T.Group(), erect: new T.Group() };
  scene.add(structure, cranes.pe, cranes.erect);

  // ---------- 땅·바다·길 ----------
  // 땅은 따로 그리지 않는다: 3D 뒤 배경(회색 한 색, yard3d.css)이 그대로 땅이 되어 흰 네모 경계가 생기지 않게
  const GZ0 = ROW_Z - 16, GZ1 = 22; // 안벽 끝 선의 위아래 끝
  const sea = new T.Mesh(new T.PlaneGeometry(160, 200), meshMat(0x7fa3bf, 0.9));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(SEA_X + 80, -0.9, -10);
  scene.add(sea);
  // 안벽 끝 선
  const quay = new Lines();
  quay.poly([V(SEA_X, 0.01, GZ0), V(SEA_X, 0.01, DOCK.z0)]);
  quay.poly([V(SEA_X, 0.01, DOCK.z1), V(SEA_X, 0.01, GZ1)]);
  quay.build(scene, lineMat(0x5f6b77));

  const roadMat = meshMat(0xa2a8ad, 1, { polygonOffset: true, polygonOffsetFactor: -1 }); // 조명(약 1.4배)을 받으면 배경 회색보다 살짝 진하게
  const dash = new Lines();
  const road = (a, b, w = 2.4) => {
    const len = a.distanceTo(b);
    const r = box(scene, len + w, 0.02, w, roadMat, (a.x + b.x) / 2, 0.01, (a.z + b.z) / 2);
    r.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
    for (let s = 0.5; s < len; s += 1.6) {
      const p = a.clone().lerp(b, s / len), q = a.clone().lerp(b, Math.min(1, (s + 0.7) / len));
      dash.seg(V(p.x, 0.03, p.z), V(q.x, 0.03, q.z));
    }
  };
  road(ROAD[0], ROAD[1]);
  road(V(-38, 0, ROAD_Z), V(-38, 0, DOCK.z1 + 3), 1.8); // 도크 서쪽으로 내려가는 길
  road(V(-38, 0, DOCK.z1 + 3), V(SEA_X - 4, 0, DOCK.z1 + 3), 1.8); // 도크 남쪽 길
  // 공장 앞에서 큰길로 나가는 진입로
  STAGES.filter((s) => s.kind !== "dock").forEach((st) => {
    const b = stageBox(st);
    road(V(st.cx, 0, b.z1 + 0.6), V(st.cx, 0, ROAD_Z - 1.2), 1.6);
  });
  dash.build(scene, lineMat(0xe0b400));
  // 흐름 화살표 (큰길 위, 대조립 → PE)
  const arrowMat = new T.MeshBasicMaterial({ color: 0xd49c00, side: T.DoubleSide });
  const arrowGeo = new T.ShapeGeometry(new T.Shape([new T.Vector2(-0.5, -0.45), new T.Vector2(0.6, 0), new T.Vector2(-0.5, 0.45), new T.Vector2(-0.22, 0)]));
  [0, 1, 2].map(gapX).concat(DOCK.x1 - 6).forEach((x) => {
    const m = new T.Mesh(arrowGeo, arrowMat);
    m.rotation.set(-Math.PI / 2, 0, 0);
    m.position.set(x, 0.04, ROAD_Z);
    scene.add(m);
  });

  // 바닥 페인트 글씨: 공장 바닥에 스텐실로 칠해 둔 공정 이름 (바탕 없이 옅은 청록 페인트, 글자 가운데 스텐실 끊김 · 닳은 자국)
  // 구역 이름(배재·쉘터 …)은 쓰지 않는다 (dff6831). 아주 가까이 보면 숨긴다 (showFloorText)
  const floorLabels = [];
  function floorPaint(text, x, y, z, h, { color = "rgba(42,102,112,0.62)", px = 100 } = {}) {
    const CH = 128, pad = 6;
    const font = `700 ${px}px "Pretendard Variable", Pretendard, "Apple SD Gothic Neo", sans-serif`;
    const spacing = Math.round(px * 0.03);
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = font;
    const CW = Math.ceil((probe.measureText(text).width + spacing * text.length) * 1.1) + pad * 2; // 웹 글꼴이 늦게 와도 들어가게 여유
    const draw = (c) => {
      c.clearRect(0, 0, CW, CH);
      c.font = font;
      c.letterSpacing = `${spacing}px`;
      c.textBaseline = "middle";
      c.fillStyle = color;
      c.fillText(text, pad, CH / 2 + 5, CW - pad * 2);
      // 스텐실 다리 (가로로 가늘게 끊긴 자리) + 닳은 자국
      c.globalCompositeOperation = "destination-out";
      c.fillRect(pad, CH / 2 + 1, CW - pad * 2, 4);
      let seed = text.length * 7919;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let k = 0; k < CW / 3; k++) {
        c.globalAlpha = 0.25 + rnd() * 0.5;
        c.fillRect(rnd() * CW, rnd() * CH, 1 + rnd() * 4, 1 + rnd() * 2);
      }
      c.globalAlpha = 1;
      c.globalCompositeOperation = "source-over";
    };
    const tex = canvasTex(CW, CH, draw);
    // 캔버스는 글꼴이 다 받아지기 전에 그리면 기본 글꼴로 나온다 → 화면 글꼴(Pretendard)이 오면 다시 그린다
    document.fonts?.load(font, text).then(() => {
      draw(tex.image.getContext("2d"));
      tex.needsUpdate = true;
    });
    const w = (h * CW) / CH;
    const m = new T.Mesh(
      new T.PlaneGeometry(w, h),
      new T.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x + w / 2, y, z);
    m.renderOrder = 1;
    scene.add(m);
    floorLabels.push(m);
  }
  STAGES.forEach((st) => {
    if (st.kind === "dock") return floorPaint(st.name, DOCK.x0 + 1.5, DOCK.floor + 0.05, DOCK.z1 - 1.6, 1.4); // 공장 이름과 같은 크기
    const b = stageBox(st);
    // 공장 안 앞쪽 바닥 (블록은 베이 뒤로 물려 놓아서 앞쪽이 비어 있다)
    floorPaint(st.name, b.x0 + 0.8, 0.06, b.z1 - 0.95, 1.4);
  });

  // ---------- 공장 공용 소품 ----------
  // 기둥·크레인은 반투명. 구조물 보기를 켰을 때도 공장 안 블록을 덜 가리게
  const steelMat = meshMat(0x8b96a1, 0.35, { depthWrite: false });
  const craneMat = meshMat(0xe8b21a, 0.6, { depthWrite: false });
  const colGeo = new T.BoxGeometry(0.3, SHOP_H, 0.4);
  colGeo.translate(0, SHOP_H / 2, 0);
  const cols = new Inst(colGeo, steelMat);
  const weldGeo = new T.BoxGeometry(0.26, 0.2, 0.18);
  weldGeo.translate(0, 0.1, 0);
  const welders = new Inst(weldGeo, meshMat(0x4f8f5a));
  const cylGeo = new T.CylinderGeometry(0.035, 0.035, 0.28, 8);
  cylGeo.translate(0, 0.14, 0);
  const cylsO = new Inst(cylGeo, meshMat(0x2f6fb5));
  const cylsR = new Inst(cylGeo, meshMat(0xb83a2e));
  const reelGeo = new T.TorusGeometry(0.11, 0.045, 6, 14);
  reelGeo.translate(0, 0.16, 0);
  const reels = new Inst(reelGeo, meshMat(0x2c2f33));
  const canGeo = new T.CylinderGeometry(0.06, 0.06, 0.1, 10);
  canGeo.translate(0, 0.05, 0);
  const cans = new Inst(canGeo, meshMat(0xd8d8d0));
  const stackGeo = new T.BoxGeometry(1.4, 0.05, 0.9); // 배재 구역에 쌓아 둔 판넬·부재
  stackGeo.translate(0, 0.025, 0);
  const stacks = new Inst(stackGeo, meshMat(0x9aa3ad));
  const areaLine = lineMat(0xd9a400, 0.85);

  // 구역 경계선(노란 점선) + 바닥 이름 (늘 보임)
  function areaMarks(g, st, b) {
    const L = new Lines();
    const n = st.areas.length;
    for (let i = 1; i < n; i++) {
      const x = b.x0 + 1 + st.al * i;
      for (let z = b.z0 + 0.3; z < b.z1 - 0.3; z += 0.8) L.seg(V(x, 0.06, z), V(x, 0.06, Math.min(b.z1 - 0.3, z + 0.45)));
    }
    L.build(g, areaLine);
    // 구역 이름(배재·쉘터·블라스팅 …)은 바닥에 쓰지 않는다. 공정 이름표(대조립·선행의장 …)만 남긴다
  }

  function buildShop(st) {
    const b = stageBox(st);
    const cx = st.cx, cz = ROW_Z;
    const W = (b.x1 - b.x0) / 2, D = (b.z1 - b.z0) / 2, H = SHOP_H;
    const g = new T.Group(); // 늘 보이는 낮은 것 (바닥·정반·통로·구역 표시)
    scene.add(g);
    const s = new T.Group(); // 기둥·벽·지붕·천장크레인 (structure)
    structure.add(s);
    box(g, 2 * W, 0.04, 2 * D, meshMat(0xd9d7ce), cx, 0.02, cz);
    // 정반 (블록이 놓이는 강판 바닥): 구역 × 베이마다 하나
    const platen = meshMat(0xb4b5ae, 1, { polygonOffset: true, polygonOffsetFactor: -2 });
    st.areas.forEach((_, i) => [0, 1].forEach((j) => {
      const c = areaCenter(st, i, j);
      box(g, st.al - 1.6, 0.02, BAY_W - 2.4, platen, c.x, 0.04, c.z - (j ? -0.3 : 0.3));
    }));
    // 가운데 통로 (교육 자료 사진의 초록 통로 + 노란 선)
    box(g, 2 * W, 0.02, 1.0, meshMat(0x7aa37a, 1, { polygonOffset: true, polygonOffsetFactor: -2 }), cx, 0.045, cz);
    areaMarks(g, st, b);
    // 건물 테두리 (늘 보임): 바닥 외곽선 + 뒤·양옆 낮은 띠
    const edge = new Lines();
    edge.poly([V(b.x0, 0.06, b.z0), V(b.x1, 0.06, b.z0), V(b.x1, 0.06, b.z1), V(b.x0, 0.06, b.z1)], true);
    edge.poly([V(b.x0, 0.45, b.z1), V(b.x0, 0.45, b.z0), V(b.x1, 0.45, b.z0), V(b.x1, 0.45, b.z1)]);
    edge.build(g, lineMat(0x6b7682, 0.75));
    const curb = meshMat(0xa7b2bd, 0.22, { depthWrite: false });
    box(g, 2 * W, 0.45, 0.04, curb, cx, 0.225, b.z0);
    box(g, 0.04, 0.45, 2 * D, curb, b.x0, 0.225, cz);
    box(g, 0.04, 0.45, 2 * D, curb, b.x1, 0.225, cz);
    // 기둥: 양쪽 벽 + 베이 사이 가운데 줄
    for (let x = b.x0; x <= b.x1 + 0.01; x += 4) [b.z0, cz, b.z1].forEach((z) => cols.add(x, 0, z));
    // 벽: 뒤·양옆 (앞은 열어서 안이 보이게)
    const wallMat = meshMat(0xa7b2bd, 0.08);
    box(s, 2 * W, H, 0.04, wallMat, cx, H / 2, b.z0);
    box(s, 0.04, H, 2 * D, wallMat, b.x0, H / 2, cz);
    box(s, 0.04, H, 2 * D, wallMat, b.x1, H / 2, cz);
    const L = new Lines();
    for (let x = b.x0; x <= b.x1; x += 0.8) L.seg(V(x, 0, b.z0), V(x, H, b.z0));
    // 지붕: 베이마다 박공 지붕 (트러스·도리)
    [[b.z0, cz], [cz, b.z1]].forEach(([za, zb]) => {
      const zm = (za + zb) / 2, ridge = H + 1.1;
      for (let x = b.x0; x <= b.x1 + 0.01; x += 4) {
        L.poly([V(x, H, za), V(x, ridge, zm), V(x, H, zb)]);
        L.seg(V(x, H - 0.4, za), V(x, H - 0.4, zb));
      }
      [[H, za], [ridge, zm], [H, zb]].forEach(([y, z]) => L.seg(V(b.x0, y, z), V(b.x1, y, z)));
      // 지붕 채광창 (현장 사진의 밝은 줄)
      const sky = box(s, 2 * W - 0.4, 0.02, 1.0, meshMat(0xffffff, 0.25), cx, H + 0.55, (za + zm) / 2);
      sky.rotation.x = Math.atan2(1.1, (zb - za) / 2);
      // 크레인 주행 레일 + 천장크레인 2기 (2중 거더, 트롤리, 훅)
      [za + 0.35, zb - 0.35].forEach((z) => box(s, 2 * W, 0.25, 0.22, steelMat, cx, H - 0.9, z));
      [-0.3, 0.25].forEach((f, i) => {
        const x = cx + f * 2 * W;
        [-0.3, 0.3].forEach((dx) => box(s, 0.22, 0.38, zb - za - 0.5, craneMat, x + dx, H - 0.6, zm));
        const tz = zm + (i ? -1.2 : 1.0);
        box(s, 0.75, 0.3, 0.6, meshMat(0x5b5f63), x, H - 0.3, tz);
        const hookY = H - 2.2 - i * 0.6;
        const hk = new Lines();
        hk.seg(V(x - 0.08, H - 0.45, tz), V(x - 0.08, hookY, tz));
        hk.seg(V(x + 0.08, H - 0.45, tz), V(x + 0.08, hookY, tz));
        hk.build(s, lineMat(0x2b2b2b));
        box(s, 0.25, 0.22, 0.2, craneMat, x, hookY - 0.1, tz);
      });
    });
    L.build(s, lineMat(0x7d8792, 0.45));
    // 바닥 소품: 용접기·가스 용기·호스 릴 (현장 사진), 배재 구역의 부재 더미
    st.areas.forEach((_, i) => {
      const c = areaCenter(st, i, 0);
      const x = c.x - st.al / 2 + 0.7, z = cz + 0.75;
      welders.add(x, 0.04, z, i);
      welders.add(x + 0.32, 0.04, z, i);
      reels.add(x + 0.15, 0.04, z - 1.4, Math.PI / 2);
      for (let k = 0; k < 3; k++) (k % 2 ? cylsR : cylsO).add(x - 0.3 - k * 0.09, 0.04, z + 0.15);
    });
    if (st.key === "assembly") {
      const c = areaCenter(st, 0, 0);
      for (let k = 0; k < 5; k++) stacks.add(c.x - 1.4 + (k % 2) * 0.3, 0.04 + k * 0.06, b.z0 + 0.9, 0, 1, 1);
    }
    if (st.key === "outfit") [[1, 0.4], [1.3, 0.5]].forEach(([dx, dz]) => cans.add(cx + dx, 0.04, cz + dz));
  }

  // 도장공장: 셀 여러 칸(칸막이), 천장 급기 덕트, 바닥 배기구, 매달린 작업대, 셀마다 문
  function buildPaintShop(st) {
    const b = stageBox(st);
    const cx = st.cx, cz = ROW_Z, H = SHOP_H;
    const g = new T.Group();
    scene.add(g);
    const s = new T.Group();
    structure.add(s);
    box(g, b.x1 - b.x0, 0.04, b.z1 - b.z0, meshMat(0xd5dadf), cx, 0.02, cz);
    const platen = meshMat(0xbfc6cc, 1, { polygonOffset: true, polygonOffsetFactor: -2 });
    st.areas.forEach((_, i) => box(g, st.al - 1.4, 0.02, b.z1 - b.z0 - 3, platen, areaCenter(st, i).x, 0.04, cz - 0.4));
    areaMarks(g, st, b);
    const edge = new Lines();
    edge.poly([V(b.x0, 0.06, b.z0), V(b.x1, 0.06, b.z0), V(b.x1, 0.06, b.z1), V(b.x0, 0.06, b.z1)], true);
    for (let i = 1; i < st.areas.length; i++) {
      const x = b.x0 + 1 + st.al * i;
      edge.seg(V(x, 0.07, b.z0), V(x, 0.07, b.z1));
    }
    edge.build(g, lineMat(0x4f6378, 0.8));
    const curb = meshMat(0x7f93a8, 0.22, { depthWrite: false });
    box(g, b.x1 - b.x0, 0.45, 0.04, curb, cx, 0.225, b.z0);
    box(g, 0.04, 0.45, b.z1 - b.z0, curb, b.x0, 0.225, cz);
    box(g, 0.04, 0.45, b.z1 - b.z0, curb, b.x1, 0.225, cz);
    for (let x = b.x0; x <= b.x1 + 0.01; x += st.al) [b.z0, b.z1].forEach((z) => cols.add(x + (x === b.x0 ? 0 : x >= b.x1 - 0.01 ? 0 : 1), 0, z));
    // 벽·칸막이·지붕
    const wall = meshMat(0x7f93a8, 0.16);
    box(s, b.x1 - b.x0, H, 0.05, wall, cx, H / 2, b.z0);
    box(s, 0.05, H, b.z1 - b.z0, wall, b.x0, H / 2, cz);
    box(s, 0.05, H, b.z1 - b.z0, wall, b.x1, H / 2, cz);
    for (let i = 1; i < st.areas.length; i++) box(s, 0.05, H, b.z1 - b.z0, wall, b.x0 + 1 + st.al * i, H / 2, cz);
    box(s, b.x1 - b.x0, H * 0.42, 0.05, wall, cx, H * 0.79, b.z1);
    const L = new Lines();
    for (let x = b.x0; x <= b.x1 + 0.01; x += 2) L.poly([V(x, H, b.z1), V(x, H + 1.2, cz), V(x, H, b.z0)]);
    [[H, b.z1], [H + 1.2, cz], [H, b.z0]].forEach(([y, z]) => L.seg(V(b.x0, y, z), V(b.x1, y, z)));
    L.build(s, lineMat(0x5d7085, 0.45));
    const duct = meshMat(0xc9ced3);
    const grille = meshMat(0x8794a1);
    const plat = meshMat(0xe2a33a);
    const hang = new Lines();
    const door = new Lines();
    st.areas.forEach((_, i) => {
      const x = areaCenter(st, i).x;
      [-2.6, 2.6].forEach((dz) => {
        const d = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, st.al - 1, 14, 1, true), duct);
        d.rotation.z = Math.PI / 2;
        d.position.set(x, H - 1.3, cz + dz);
        s.add(d);
      });
      box(g, st.al - 1, 0.16, 0.06, grille, x, 0.1, b.z0 + 0.08);
      [[-0.3], [4.6]].forEach(([dz]) => {
        const y = 1.6;
        box(s, 1.4, 0.06, 0.32, plat, x, y, cz + dz - 2);
        hang.seg(V(x - 0.6, y, cz + dz - 2), V(x - 0.6, H - 1.0, cz + dz - 2));
        hang.seg(V(x + 0.6, y, cz + dz - 2), V(x + 0.6, H - 1.0, cz + dz - 2));
      });
      const dw = st.al / 2 - 0.8;
      door.poly([V(x - dw, 0, b.z1), V(x - dw, H * 0.58, b.z1), V(x + dw, H * 0.58, b.z1), V(x + dw, 0, b.z1)]);
    });
    hang.build(s, lineMat(0x333333, 0.8));
    door.build(s, lineMat(0x3d4b5a));
  }

  // 옥외 PE장: 구역 표시, 크롤러 크레인 2대, 조명탑
  function buildPE(st) {
    const b = stageBox(st);
    const g = new T.Group();
    scene.add(g);
    box(g, b.x1 - b.x0, 0.04, b.z1 - b.z0, meshMat(0xd0cfc6), st.cx, 0.02, ROW_Z);
    const L = new Lines();
    L.poly([V(b.x0, 0.05, b.z0), V(b.x1, 0.05, b.z0), V(b.x1, 0.05, b.z1), V(b.x0, 0.05, b.z1)], true);
    L.build(g, lineMat(0xa3a39a));
    areaMarks(g, st, b);
    [[st.cx - 10, b.z0 + 1.2], [st.cx + 12, b.z0 + 1.2]].forEach(([x, z], i) => {
      const cg = new T.Group();
      cg.position.set(x, 0, z);
      scene.add(cg);
      const red = meshMat(0xc9452c);
      [-0.45, 0.45].forEach((dz) => box(cg, 1.6, 0.3, 0.32, meshMat(0x3a3d40), 0, 0.15, dz));
      box(cg, 1.0, 0.55, 0.8, red, 0, 0.6, 0);
      const bg = new T.Group(); // 붐 (PE장을 가까이 볼 때만)
      bg.position.copy(cg.position);
      cranes.pe.add(bg);
      const boom = new Lines();
      const tip = V(i ? -3.0 : 3.2, 8.5, 3.4);
      [-0.18, 0.18].forEach((d) => boom.seg(V(0.2, 0.8, d), V(tip.x, tip.y, tip.z + d)));
      for (let k = 1; k < 12; k++) {
        const p = V(0.2, 0.8, 0).lerp(tip, k / 12);
        boom.seg(V(p.x, p.y, p.z - 0.18), V(p.x, p.y, p.z + 0.18));
      }
      boom.seg(tip, V(tip.x, 2.2, tip.z));
      boom.build(bg, lineMat(0xb03a25));
      box(bg, 0.25, 0.25, 0.25, meshMat(0x333333), tip.x, 2.2, tip.z);
    });
    // 조명탑 (PE장 네 귀퉁이)
    const mast = new Lines();
    [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1]].forEach(([x, z]) => {
      mast.seg(V(x, 0, z), V(x, 7, z));
      mast.seg(V(x - 0.4, 7, z), V(x + 0.4, 7, z));
    });
    mast.build(scene, lineMat(0x6b7682, 0.7));
  }

  // ---------- 선체 (도크 안 2척 · 안벽 1척) ----------
  // parent 안에서 선체 길이 방향 = x, 가운데 = 0. erected = 이미 올린 구간 [u0, u1, 높이] (u: -1 선미 ~ 1 선수)
  function buildShip(parent, S, base, erected, opts = {}) {
    const halfBeam = (u) => {
      if (u > 0.6) return S.halfB * Math.pow(Math.cos(Math.min(1, (u - 0.6) / 0.4) * Math.PI / 2), 0.8) + 0.04;
      if (u < -0.7) return S.halfB * (1 - 0.4 * Math.pow((-0.7 - u) / 0.3, 1.5));
      return S.halfB;
    };
    const bottom = (u) => (u < -0.7 ? 1.6 * Math.pow((-0.7 - u) / 0.3, 1.6) : u > 0.75 ? 0.6 * Math.pow((u - 0.75) / 0.25, 2) : 0);
    const profile = (u, yTop = S.depth) => {
      const b = halfBeam(u), y0 = bottom(u), r = Math.min(0.9, b * 0.4);
      const half = [];
      for (let i = 0; i <= 5; i++) half.push([-b, S.depth - (S.depth - y0 - r) * (i / 5)]);
      for (let i = 1; i <= 6; i++) {
        const a = Math.PI + (Math.PI / 2) * (i / 6);
        half.push([-b + r + r * Math.cos(a), y0 + r + r * Math.sin(a)]);
      }
      for (let i = 1; i <= 4; i++) half.push([(-b + r) * (1 - i / 4), y0]);
      return half.concat(half.slice(0, -1).reverse().map(([z, y]) => [-z, y])).map(([z, y]) => [z, Math.min(y, yTop)]);
    };
    const X = (u) => (u * S.len) / 2;
    const P = (u, z, y) => V(X(u), base + y, z);
    if (opts.ghost !== false) {
      const ghost = new Lines();
      for (let i = 0; i <= 44; i++) {
        const u = -1 + i / 22;
        ghost.poly(profile(u).map(([z, y]) => P(u, z, y)));
      }
      const M = profile(0).length;
      [0, 3, 5, 8, 11, 15].forEach((j) => [j, M - 1 - j].forEach((jj) => {
        const pts = [];
        for (let i = 0; i <= 60; i++) { const u = -1 + i / 30, q = profile(u)[jj]; pts.push(P(u, q[0], q[1])); }
        ghost.poly(pts);
      }));
      [-0.42, -0.12, 0.18, 0.46].forEach((u) => ghost.poly(profile(u).map(([z, y]) => P(u, z, y))));
      ghost.build(parent, lineMat(0x5b6f86, opts.ghostOpacity ?? 0.32));
    }
    const steel = opts.mat || meshMat(0x8a96a2, 0.78, { depthWrite: false });
    const seam = new Lines();
    const inner = new Lines();
    erected.forEach(([u0, u1, top]) => {
      const pos = [], idx = [], N = 6;
      let MM = 0;
      for (let k = 0; k <= N; k++) {
        const u = u0 + ((u1 - u0) * k) / N, p = profile(u, top);
        MM = p.length;
        p.forEach(([z, y]) => pos.push(X(u), base + y, z));
      }
      for (let k = 0; k < N; k++) for (let j = 0; j < MM - 1; j++) {
        const a = k * MM + j, b = a + 1, c = a + MM, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      parent.add(new T.Mesh(g, steel));
      [u0, u1].forEach((u) => seam.poly(profile(u, top).map(([z, y]) => P(u, z, y))));
      if (opts.inner === false) return;
      // 단면 내부 구조 (화물창 구간만): 내저판 · 호퍼 · 내측 · 톱사이드 (현장 사진)
      for (let k = 0; k <= 2; k++) {
        const u = u0 + ((u1 - u0) * k) / 2;
        if (u < -0.56) { inner.seg(P(u, -S.halfB + 0.8, S.db + bottom(u)), P(u, S.halfB - 0.8, S.db + bottom(u))); continue; }
        const B = halfBeam(u), clip = (pts) => pts.filter(([, y]) => y <= top + 1e-6);
        [-1, 1].forEach((s) => {
          const pts = clip([[0, S.db], [s * (B - 1.3), S.db], [s * (B - 0.45), 1.5], [s * (B - 0.45), S.depth - 1.2], [s * (B - 1.9), S.depth]]);
          inner.poly(pts.map(([z, y]) => P(u, z, y)));
        });
      }
    });
    seam.build(parent, lineMat(0x3f4a56, 0.85));
    inner.build(parent, lineMat(0x3f4a56, 0.5));
    return { X };
  }

  // ---------- 도크 ----------
  let dockA = null; // 이번 호선 선체 좌표 (탑재 중 블록 자리 계산용)
  function buildDock() {
    const { x0, x1, z0, z1, floor } = DOCK;
    const W = x1 - x0, D = z1 - z0, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    box(scene, W, 0.05, D, meshMat(0xb7b9b3), mx, floor, mz);
    const wall = meshMat(0xc6c8c1);
    box(scene, W, -floor, 0.1, wall, mx, floor / 2, z0);
    box(scene, W, -floor, 0.1, wall, mx, floor / 2, z1);
    box(scene, 0.1, -floor, D, wall, x0, floor / 2, mz);
    box(scene, 0.5, -floor + 0.3, D, meshMat(0x6d7a86), x1 - 0.25, floor / 2 + 0.1, mz); // 도크 게이트 (바다 쪽)
    const rail = new Lines();
    [z0, z1].forEach((z) => {
      rail.seg(V(x0, 0.35, z), V(x1, 0.35, z));
      for (let x = x0; x <= x1; x += 1.5) rail.seg(V(x, 0, z), V(x, 0.35, z));
    });
    rail.build(scene, lineMat(0xd9a400));
    // 골리앗 크레인 레일 (도크 양옆)
    const gr = new Lines();
    [z0 - 1.6, z1 + 1.6].forEach((z) => gr.seg(V(x0, 0.03, z), V(x1, 0.03, z)));
    gr.build(scene, lineMat(0x4b5563, 0.7));
    // 반목 (블록 받침): 도크 바닥 전체 (교육 자료 사진)
    const keelGeo = new T.BoxGeometry(0.4, 0.3, 0.4);
    keelGeo.translate(0, 0.15, 0);
    const keel = new Inst(keelGeo, meshMat(0x8e8f88));
    for (let x = x0 + 1.5; x < x1 - 1.5; x += 1.2) [-1.6, 0, 1.6].forEach((dz) => keel.add(x, floor, mz + dz));
    keel.build(scene);
    const base = floor + 0.3;
    // 이번 호선: 선미 쪽부터 올라옴. 기관실 구간(-0.72~-0.56)은 탑재 중 블록(E21) 자리로 비워 둔다
    const ga = new T.Group();
    ga.position.set(SHIP_A.cx, 0, mz);
    scene.add(ga);
    const A = buildShip(ga, HULL, base, [[-1, -0.86, HULL.depth], [-0.86, -0.72, HULL.depth], [-0.56, -0.42, HULL.depth * 0.6], [-0.42, -0.32, 1.5], [-0.32, -0.26, 1.5]]);
    dockA = { X: (u) => SHIP_A.cx + A.X(u), z: mz, base };
    // 다음 호선: 이중저 블록 몇 개만 (용골 거치)
    const gb = new T.Group();
    gb.position.set(SHIP_B.cx, 0, mz);
    scene.add(gb);
    buildShip(gb, HULL, base, [[-0.3, -0.18, 0.6], [-0.18, -0.06, 0.6], [-0.06, 0.06, 0.6]], { ghostOpacity: 0.16 });
    // 계단탑 (도크 바닥에서 선체로)
    const tower = new Lines();
    [[dockA.X(-0.6), mz - HULL.halfB - 0.5], [SHIP_B.cx, mz - HULL.halfB - 0.5]].forEach(([tx, tz]) => {
      for (let y = 0; y <= HULL.depth + 0.6; y += 0.5) tower.poly([V(tx - 0.3, base + y, tz - 0.3), V(tx + 0.3, base + y, tz - 0.3), V(tx + 0.3, base + y, tz + 0.3), V(tx - 0.3, base + y, tz + 0.3)], true);
      [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]].forEach(([dx, dz]) => tower.seg(V(tx + dx, base - 0.3, tz + dz), V(tx + dx, base + HULL.depth + 0.6, tz + dz)));
    });
    tower.build(scene, lineMat(0xd9a400));
    // 골리앗 크레인 2기 (도크를 가로지르는 문형). 앞 크레인에 매달린 블록
    const gold = meshMat(0xd9532b, 0.55, { depthWrite: false });
    const gh = 19; // ≈ 95 m (삼성중공업 공식 블로그: 골리앗 크레인 약 100 m)
    [[dockA.X(-0.48), true], [SHIP_B.cx + 8, false]].forEach(([gx, hangs]) => {
      const gg = new T.Group();
      gg.position.set(gx, 0, 0);
      cranes.erect.add(gg);
      [z0 - 1.6, z1 + 1.6].forEach((z) => [-1.4, 1.4].forEach((dx) => {
        const leg = box(gg, 0.4, gh, 0.4, gold, dx, gh / 2, z);
        leg.rotation.x = z < mz ? 0.04 : -0.04;
      }));
      [-0.5, 0.5].forEach((dx) => box(gg, 0.45, 1.0, D + 4.4, gold, dx, gh, mz));
      box(gg, 1.6, 0.45, 1.1, meshMat(0x5b5f63), 0, gh + 0.7, mz + 0.6);
      if (!hangs) return;
      const cable = new Lines();
      cable.seg(V(-0.2, gh, mz + 0.6), V(-0.2, 3.0, mz + 0.6));
      cable.seg(V(0.2, gh, mz + 0.6), V(0.2, 3.0, mz + 0.6));
      const hangLines = cable.build(gg, lineMat(0x222222));
      const hung = new T.Group();
      gg.add(hung);
      box(hung, 3.2, 0.5, 3.0, meshMat(0x9aa3ad, 0.6, { depthWrite: false }), 0, 0, 0);
      const sling = new Lines();
      [[-1.5, -1.4], [1.5, -1.4], [-1.5, 1.4], [1.5, 1.4]].forEach(([x, z]) => sling.seg(V(x, 0.25, z), V(0, 1.4, 0)));
      sling.build(hung, lineMat(0x222222));
      hung.position.set(0, 4.4, mz + 0.6);
      ticks.push((dt, now) => {
        const y = 5.6 + 0.6 * Math.sin(now / 2600);
        hung.position.y = y;
        const p = hangLines.geometry.attributes.position;
        p.setY(1, y + 1.4); p.setY(3, y + 1.4);
        p.needsUpdate = true;
      });
    });
    // 지브 크레인 (도크 옆, 격자 탑)
    [[SHIP_A.cx + 14, z1 + 3.4, 0x2f5f8a], [SHIP_B.cx - 10, z0 - 3.4, 0x2f7a5f]].forEach(([x, z, color]) => {
      const g2 = new T.Group();
      g2.position.set(x, 0, z);
      cranes.erect.add(g2);
      const jib = new Lines();
      const c4 = [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]];
      c4.forEach(([cx4, cz4]) => jib.seg(V(cx4, 0, cz4), V(cx4, 10, cz4)));
      for (let y = 0; y < 10; y += 1) c4.forEach(([cx4, cz4], i) => {
        const [x2, z2] = c4[(i + 1) % 4];
        jib.seg(V(cx4, y, cz4), V(x2, y + 1, z2));
        jib.seg(V(cx4, y, cz4), V(x2, y, z2));
      });
      const tip = V(-6, 12.5, z > 0 ? -5 : 5);
      jib.seg(V(0, 10.4, 0), tip);
      jib.seg(V(0, 11.4, 0), tip);
      jib.seg(tip, V(tip.x, 4, tip.z));
      jib.build(g2, lineMat(color));
      box(g2, 1.0, 0.7, 1.0, meshMat(color), 0, 10.3, 0);
    });
  }

  // 안벽에 묶인 배 (3.4 의장 · 진수 후): 선체 전체 + 거주구. 감시 대상 아님 (풍경)
  function buildQuayShip() {
    const g = new T.Group();
    g.position.set(SEA_X + 4.6, 0, -30);
    g.rotation.y = Math.PI / 2;
    scene.add(g);
    const S = { ...HULL };
    const hullMat = meshMat(0xa04a3c, 0.85);
    buildShip(g, S, -2.2, [[-1, 1, S.depth]], { ghost: false, inner: false, mat: hullMat });
    const top = meshMat(0xdfe3e7, 0.9);
    box(g, 5.5, 3.2, 6.4, top, -0.84 * S.len / 2 + 1, -2.2 + S.depth + 1.6, 0); // 거주구
    box(g, 0.8, 1.6, 0.8, meshMat(0xc94a3a), -0.84 * S.len / 2 - 1, -2.2 + S.depth + 4.0, 0); // 굴뚝
    // 화물탱크 돔 (LPG선)
    [-0.4, -0.1, 0.2, 0.5].forEach((u) => {
      const d = new T.Mesh(new T.CylinderGeometry(0.7, 0.7, 0.6, 14), top);
      d.position.set((u * S.len) / 2, -2.2 + S.depth + 0.3, 0);
      g.add(d);
    });
  }

  // ---------- 트랜스포터 (큰길을 오간다) ----------
  function buildTransporter() {
    const g = new T.Group();
    scene.add(g);
    box(g, 2.8, 0.22, 1.5, meshMat(0xe07b1f), 0, 0.3, 0);
    box(g, 0.5, 0.35, 1.4, meshMat(0xc9661a), 1.5, 0.4, 0);
    const wheelGeo = new T.BoxGeometry(0.22, 0.2, 0.12);
    wheelGeo.translate(0, 0.1, 0);
    const wheels = new Inst(wheelGeo, meshMat(0x2a2a2a));
    for (let x = -1.2; x <= 1.21; x += 0.6) [-0.7, 0.7].forEach((z) => wheels.add(x, 0, z));
    wheels.build(g);
    box(g, 2.5, 0.8, 1.8, meshMat(0x9aa3ad, 0.6, { depthWrite: false }), 0, 0.82, 0);
    const a = ROAD[0], b = ROAD[1], total = a.distanceTo(b);
    let s = 30, dir = 1;
    ticks.push((dt) => {
      s += dir * dt * 3.2;
      if (s > total - 4) { s = total - 4; dir = -1; }
      if (s < 4) { s = 4; dir = 1; }
      const p = a.clone().lerp(b, s / total);
      g.position.set(p.x, 0, p.z - 0.5 * dir);
      g.rotation.y = dir < 0 ? Math.PI : 0;
    });
  }

  STAGES.forEach((st) => {
    if (st.kind === "shop") buildShop(st);
    else if (st.kind === "paintshop") buildPaintShop(st);
    else if (st.kind === "yard") buildPE(st);
    else buildDock();
  });
  buildQuayShip();
  buildTransporter();
  cols.build(structure);
  [welders, cylsO, cylsR, reels, cans, stacks].forEach((i) => i.build(scene));

  // ---------- 감시 대상이 아닌 블록 (빈 자리를 채우는 풍경) ----------
  const grey = meshMat(0x9aa3ad, 0.28, { depthWrite: false });
  const greyEdge = lineMat(0x56606b, 0.75);
  const greyFrame = lineMat(0x56606b, 0.3);
  const jackGeo = new T.CylinderGeometry(0.022, 0.06, 1, 8);
  jackGeo.translate(0, 0.5, 0);
  const bgJacks = new Inst(jackGeo, meshMat(0xb3b8be));
  // kind별 크기 [길이 x, 높이 y, 폭 z]
  const KIND = { db: [3.2, 0.5, 3.0], side: [3.2, 2.2, 1.1], panel: [3.0, 0.12, 2.6], grand: [6.0, 1.1, 3.2], deck: [3.2, 0.9, 3.0] };
  function backgroundBlock(kind, p, sup) {
    const [w, h, d] = KIND[kind];
    const y = sup + h / 2;
    const m = box(scene, w, h, d, grey, p.x, y, p.z);
    const e = new T.LineSegments(new T.EdgesGeometry(m.geometry), greyEdge);
    e.position.copy(m.position);
    scene.add(e);
    const fl = new Lines();
    for (let fx = -w / 2 + 0.5; fx < w / 2; fx += 0.5) {
      fl.poly([V(p.x + fx, y - h / 2, p.z - d / 2), V(p.x + fx, y + h / 2, p.z - d / 2), V(p.x + fx, y + h / 2, p.z + d / 2), V(p.x + fx, y - h / 2, p.z + d / 2)], true);
    }
    fl.build(scene, greyFrame);
    if (sup > 0.05) for (let jx = -w / 2 + 0.3; jx <= w / 2 - 0.29; jx += (w - 0.6) / 3) [-d / 2 + 0.3, d / 2 - 0.3].forEach((jz) => bgJacks.add(p.x + jx, 0, p.z + jz, 0, 1, sup));
  }
  // occupied: "stage:area:bay" 문자열 집합 (감시 블록이 놓인 자리)
  function fillBackground(occupied) {
    const pick = { assembly: ["panel", "db", "side", "db"], outfit: ["db", "deck", "db", "deck"], paint: ["side", "db", "deck", "side", "db"], pe: ["grand", "grand", "grand", "grand", "grand"] };
    STAGES.forEach((st) => {
      if (st.kind === "dock") return;
      const bays = st.kind === "paintshop" ? 1 : st.bays;
      st.areas.forEach((_, i) => {
        for (let j = 0; j < bays; j++) {
          if (occupied.has(`${st.key}:${i}:${j}`)) continue;
          if (st.key === "pe" && (i + j) % 3 === 1) continue; // PE장은 빈 정반도 둔다
          const kind = pick[st.key][(i + 2 * j) % pick[st.key].length];
          backgroundBlock(kind, slotU(st.key, { area: i, bay: j }), SUP_M[st.kind] / U);
        }
      });
    });
    bgJacks.build(scene);
  }

  // 블록 자리 (5 m 단위): 공정 · 구역 · 베이. 도크(erect)는 이번 호선의 선체 위치 u
  function slotU(stageKey, at = {}) {
    const st = stageOf(stageKey);
    if (st.kind === "dock") return V(dockA.X(at.u ?? -0.64), dockA.base, dockA.z);
    const c = areaCenter(st, at.area ?? 0, at.bay ?? 0);
    // 블록 앞(+z)에 장비·출입현황판이 붙으므로 블록은 베이 안에서 조금 뒤로
    return V(c.x, 0, c.z - (st.kind === "paintshop" ? 1.4 : 0.9));
  }
  // 블록 자리 (미터). y = 블록 바닥 높이 (받침 위)
  function slot(stageKey, at = {}) {
    const st = stageOf(stageKey);
    const p = M(slotU(stageKey, at));
    if (st.kind !== "dock") p.y = SUP_M[st.kind];
    return p;
  }
  // 블록 아래 받침 높이 (m). 도크는 반목 위라 블록 기준 땅(도크 바닥)까지 반목 높이
  const supOf = (stageKey) => (stageOf(stageKey).kind === "dock" ? 0.3 * U : SUP_M[stageOf(stageKey).kind]);
  // 이름표 왼쪽 아래 모서리를 둘 자리
  function labelAnchor(st) {
    const b = stageBox(st);
    // 공장은 뒤쪽(북쪽) 왼쪽 모서리 바로 위에 표지판처럼, 도크는 왼쪽 앞 모서리
    if (st.kind === "dock") return M(V(DOCK.x0 + 0.6, 0, DOCK.z1 - 0.6));
    return M(V(b.x0 + 0.4, SHOP_H * 0.15, b.z0));
  }
  function focusOf(st) {
    if (st.kind === "dock") return { target: M(V(SHIP_A.cx - 12, -0.5, 0)), r: 62 * U, el: 0.7 };
    return { target: M(V(st.cx, 0.6, ROW_Z + 1.5)), r: 46 * U, el: 0.8 };
  }
  const extraLabels = [
    { text: "운반 (트랜스포터) · 큰길", pos: V(gapX(1), 1.6, ROAD_Z) },
    { text: `${SHIP_A.name} · 이미 탑재된 블록`, pos: V(dockA.X(-0.9), 5.6, 0) },
    { text: "완성될 배 모양 (선)", pos: V(dockA.X(0.4), 5.0, 0) },
    { text: `다음 호선 ${SHIP_B.name} · 용골 거치`, pos: V(SHIP_B.cx, 1.6, 0) },
    { text: "골리앗 크레인", pos: V(dockA.X(-0.48), 20.4, DOCK.z0 - 1.6), when: () => cranes.erect.visible },
    { text: "진수 후 안벽 의장", pos: V(SEA_X + 4.6, 5.0, -30) },
    { text: "도크 게이트 → 바다", pos: V(DOCK.x1, 0.8, DOCK.z1 - 1) },
  ];

  // 구조물 보기: on이면 모두, off면 가까이 보는 공정의 크레인만
  function showStructures(on, focus) {
    structure.visible = on;
    cranes.pe.visible = on || focus === "pe";
    cranes.erect.visible = on || focus === "erect" || focus === "all";
  }
  showStructures(false, "all");

  // 측정요원 대기 자리 (A동 = 대조립·선행의장 쪽, B동 = 도장·PE 쪽 가정)
  const base = (area) => M(V(gapX(area === "B동" ? 2 : 0), 0, ROAD_Z + 2.2));

  return {
    STAGES, stageOf, slot, supOf, fillBackground, base, ROAD_Z: ROAD_Z * U,
    extraLabels: extraLabels.map((l) => ({ ...l, pos: M(l.pos) })),
    showFloorText: (on) => floorLabels.forEach((m) => { m.visible = on; }),
    labelAnchor, focusOf, showStructures,
    tick: (dt, now) => ticks.forEach((f) => f(dt, now)),
  };
}
