// 블록 하나를 실제 치수(미터)로 그린다: 외판(출입 개구부) · 안쪽 칸막이(플로어·거더·스트링거, 맨홀) · 감시 구획 부피 ·
// 구획마다 측정기 · 받침(정반 지주) · 족장 · 작업 구획의 송풍기·덕트·사다리·출입현황판.
// 블록 기준 좌표: x 길이 방향(가운데 0) · y 바닥 0부터 위 · z 폭 방향(가운데 0), +z 가 앞면(통로 쪽).
//
// 근거 (src/dashboard/README.md '3D 근거와 가정'):
//   - 블록 안이 칸막이로 나뉘고 칸끼리 타원 맨홀로 이어짐, 덕트·호스가 맨홀을 지나감: 현장 사진
//   - 바닥 외판 개구부 하나로 덕트와 사다리가 같이 들어가고 송풍기는 바닥에 놓은 이동식: 현장 사진
//   - 블록 안 위쪽 족장·작업등·바닥 론지(보강재): 현장 사진
//   - 촘촘한 정반 지주 위의 블록과 그 아래를 걷는 사람: 현장 사진 · 교육 자료 사진
// 맨홀 0.6 × 0.8 m · 덕트 지름 0.3 m · 사람 키 1.75 m 처럼 사람 크기 물건은 실제 크기로 둔다.
// 환기: 덕트 끝은 작업자 주변·바닥 쪽 (KOSHA H-80 9.1·9.5, HSE L101 106), 덕트 15 m 이하 (H-80 9.2),
//   도장·세척 구획은 급기에 더해 바닥에서 뽑는 배기 덕트 (KOSHA G-117 7항). 측정은 구획마다 (OSHA 1915.12 인접 공간 포함)
// 블록 치수·칸막이 간격·구획 나눔은 site.json (scripts/build_site.py) 의 가정값이다.
import * as T from "three";
import { KIT } from "./yard3d.js";

const { V, lineMat, meshMat, box, Lines, merge, canvasTex } = KIT;

// 맨홀: 세로 칸막이(플로어·거더·웹) 600 × 800 mm, 바닥에서 600 mm 이내 · 수평 칸막이 600 × 600 mm (SOLAS II-1/3-6)
export const MANHOLE = { w: 0.6, h: 0.8, bottom: 0.4, flat: 0.6 };
const DUCT_R = 0.15; // 12인치(약 300 mm) 이동식 송풍기 덕트 (업계 사양 2차 출처)
export const BOARD_W = 800, BOARD_H = 400; // 출입현황판 그림 크기 (px)

// ---------- 다각형 도구 (단면 z, y) ----------
// 반평면 a·z + b·y <= c 로 자르기 (Sutherland–Hodgman)
function clipHalf(poly, a, b, c) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const fp = a * p[0] + b * p[1] - c, fq = a * q[0] + b * q[1] - c;
    if (fp <= 1e-9) out.push(p);
    if ((fp < -1e-9 && fq > 1e-9) || (fp > 1e-9 && fq < -1e-9)) {
      const t = fp / (fp - fq);
      out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return out;
}
export function clipBox(poly, z0, z1, y0, y1) {
  let p = poly;
  p = clipHalf(p, 1, 0, z1);
  p = clipHalf(p, -1, 0, -z0);
  p = clipHalf(p, 0, 1, y1);
  p = clipHalf(p, 0, -1, -y0);
  return p;
}
export function bounds(poly) {
  const zs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  return { z0: Math.min(...zs), z1: Math.max(...zs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
// 단면 안에서 z 위치의 [바닥 y, 천장 y]
export function yRange(poly, z) {
  const ys = [];
  for (let i = 0; i < poly.length; i++) {
    const [z0, y0] = poly[i], [z1, y1] = poly[(i + 1) % poly.length];
    if (Math.abs(z1 - z0) < 1e-9) { if (Math.abs(z - z0) < 1e-6) ys.push(y0, y1); continue; }
    const t = (z - z0) / (z1 - z0);
    if (t >= -1e-6 && t <= 1 + 1e-6) ys.push(y0 + (y1 - y0) * t);
  }
  return ys.length ? [Math.min(...ys), Math.max(...ys)] : [0, 0];
}
// 단면 안에서 y 높이의 [z 최소, z 최대]
function zRange(poly, y) {
  const zs = [];
  for (let i = 0; i < poly.length; i++) {
    const [z0, y0] = poly[i], [z1, y1] = poly[(i + 1) % poly.length];
    if (Math.abs(y1 - y0) < 1e-9) { if (Math.abs(y - y0) < 1e-6) zs.push(z0, z1); continue; }
    const t = (y - y0) / (y1 - y0);
    if (t >= -1e-6 && t <= 1 + 1e-6) zs.push(z0 + (z1 - z0) * t);
  }
  return zs.length ? [Math.min(...zs), Math.max(...zs)] : [0, 0];
}
const centroid = (poly) => poly.reduce((a, [z, y]) => [a[0] + z / poly.length, a[1] + y / poly.length], [0, 0]);

// 선수·선미 블록: 끝으로 갈수록 폭이 좁아지고 바닥이 올라간다
function warpOf(kind, L, H) {
  if (kind === "bow") return (x, y, z) => {
    const t = Math.min(1, Math.max(0, (x + L / 2) / L));
    return [x, y + 0.32 * H * t * t * (1 - y / H), z * (1 - 0.7 * Math.pow(t, 1.4))];
  };
  if (kind === "stern") return (x, y, z) => {
    const t = Math.min(1, Math.max(0, (L / 2 - x) / L));
    return [x, y + 0.34 * H * Math.pow(t, 1.6) * (1 - y / H), z * (1 - 0.42 * Math.pow(t, 1.5))];
  };
  return null;
}

// 판: p0에서 U 방향 lu, W 방향 lw. holes = [{u, w, ru, rw}] 타원 구멍 (맨홀·개구부)
function plateGeo(p0, U, W, lu, lw, holes, rims, warp) {
  const sh = new T.Shape([new T.Vector2(0, 0), new T.Vector2(lu, 0), new T.Vector2(lu, lw), new T.Vector2(0, lw)]);
  const map = (u, w) => {
    const v = p0.clone().addScaledVector(U, u).addScaledVector(W, w);
    return warp ? V(...warp(v.x, v.y, v.z)) : v;
  };
  holes.forEach((h) => {
    const p = new T.Path();
    p.absellipse(h.u, h.w, h.ru, h.rw, 0, Math.PI * 2, false);
    sh.holes.push(p);
    const ring = [];
    for (let k = 0; k <= 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      ring.push(map(h.u + h.ru * Math.cos(a), h.w + h.rw * Math.sin(a)));
    }
    rims.poly(ring);
  });
  const g = new T.ShapeGeometry(sh, 12);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = map(pos.getX(i), pos.getY(i));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}
// x 위치의 단면 판 (플로어·웹). holes는 (z, y) 기준
function sectionGeo(poly, x, holes, rims, warp) {
  const sh = new T.Shape(poly.map(([z, y]) => new T.Vector2(z, y)));
  const toV = (z, y) => (warp ? V(...warp(x, y, z)) : V(x, y, z));
  holes.forEach((h) => {
    const p = new T.Path();
    p.absellipse(h.z, h.y, h.rz, h.ry, 0, Math.PI * 2, false);
    sh.holes.push(p);
    const ring = [];
    for (let k = 0; k <= 20; k++) {
      const a = (k / 20) * Math.PI * 2;
      ring.push(toV(h.z + h.rz * Math.cos(a), h.y + h.ry * Math.sin(a)));
    }
    rims.poly(ring);
  });
  const g = new T.ShapeGeometry(sh, 12);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const v = toV(pos.getX(i), pos.getY(i));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  return g;
}
function prismGeo(poly, x0, x1, warp, segs = 1) {
  const shape = new T.Shape(poly.map(([z, y]) => new T.Vector2(z, y)));
  const g = new T.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, steps: segs });
  g.applyMatrix4(new T.Matrix4().set(0, 0, 1, x0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
  if (warp) {
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const [x, y, z] = warp(p.getX(i), p.getY(i), p.getZ(i));
      p.setXYZ(i, x, y, z);
    }
  }
  g.computeVertexNormals();
  return g;
}

// 칸 사이 경계 목록 (단면 바깥 경계 + 칸막이)
const edges = (lo, inner, hi) => [lo, ...inner.filter((v) => v > lo + 1e-6 && v < hi - 1e-6), hi];

// ---------- 블록 하나 ----------
// ctx: { group(블록 기준 좌표의 Group, world 위치는 밖에서), sup(받침 높이 m, 땅 = y -sup), stage, mats, inst, drawBoard, hot(task) }
// zoneDefs: 이 블록의 구역(구획) 정의 (box 포함). 돌려주는 것: { zones, anchors, blowers, shellMat, topMat, edgeMat, top }
export function buildBlock(ctx, b, zoneDefs) {
  const S = b.shape;
  const { group, sup, mats, inst } = ctx;
  const bb = bounds(S.section);
  const H = bb.y1 - bb.y0;
  const X0 = -S.L / 2, X1 = S.L / 2;
  const warp = warpOf(S.warp, S.L, H);
  const W3 = (x, y, z) => (warp ? V(...warp(x, y, z)) : V(x, y, z));
  // 땅(y<0) 쪽 점은 x·z만 휘게
  const Wg = (x, y, z) => {
    if (!warp || y >= 0) return W3(x, y, z);
    const [wx, , wz] = warp(x, 0, z);
    return V(wx, y, wz);
  };
  const toWorld = (v) => v.clone().applyMatrix4(group.matrixWorld);
  group.updateMatrixWorld(true);
  const g = -sup; // 땅 높이 (블록 기준)
  const rims = new Lines();
  const frameL = new Lines();
  const zb = edges(bb.z0, S.zs, bb.z1), yb = edges(bb.y0, S.ys, bb.y1);
  const xsInner = S.xs.filter((x) => x > X0 + 1e-6 && x < X1 - 1e-6);
  const wtx = new Set(S.wt_x.map((v) => v.toFixed(3)));
  const wtz = new Set(S.wt_z.map((v) => v.toFixed(3)));

  // 칸 정보 + 작업 칸의 출입면. def = 감시 구역 정의 (측정기가 없는 칸은 null)
  const byId = new Map(zoneDefs.map((d) => [d.id, d]));
  const comps = S.comps.map((c) => {
    const def = c.zone ? byId.get(c.zone) || null : null;
    const [x0, x1, z0, z1, y0, y1] = c.box;
    const poly = clipBox(S.section, z0, z1, y0, y1);
    let face = S.access;
    if (face === "front") face = z1 >= bb.z1 - 1e-6 ? "front" : z0 <= bb.z0 + 1e-6 ? "back" : "front";
    return { def, comp: c, x0, x1, z0, z1, y0, y1, poly, xc: (x0 + x1) / 2, zc: (z0 + z1) / 2, face };
  });
  const sideOf = (face) => (face === "back" ? -1 : 1);

  // ---- 외판: 면마다 판, 출입 개구부(타원)는 작업 구획 + 모든 바닥/위 구획 ----
  const outer = [], topPlates = [];
  for (let i = 0; i < S.section.length; i++) {
    const a = S.section[i], c = S.section[(i + 1) % S.section.length];
    const dy = c[1] - a[1], dz = c[0] - a[0], len = Math.hypot(dy, dz);
    const Wd = V(0, dy / len, dz / len);
    const p0 = V(X0, a[1], a[0]);
    const horiz = Math.abs(dy) < 1e-9, vert = Math.abs(dz) < 1e-9;
    const face = horiz ? (Math.abs(a[1] - bb.y1) < 1e-6 ? "top" : "bottom") : vert ? (Math.abs(a[0] - bb.z1) < 1e-6 ? "front" : "back") : "slope";
    const holes = [];
    comps.forEach((cp) => {
      const want = cp.face === face && (cp.def?.permit || face === "bottom" || face === "top");
      if (!want) return;
      if (horiz) {
        const w = ((cp.zc - a[0]) / dz) * len;
        if (w > 0.5 && w < len - 0.5) holes.push({ u: cp.xc - X0, w, ru: 0.4, rw: 0.3 });
      } else if (vert) {
        const yOpen = cp.y0 + 0.95;
        const w = ((yOpen - a[1]) / dy) * len;
        if (w > 0.5 && w < len - 0.5) holes.push({ u: cp.xc - X0, w, ru: 0.3, rw: 0.4 });
      }
    });
    (face === "top" ? topPlates : outer).push(plateGeo(p0, V(1, 0, 0), Wd, S.L, len, holes, rims, warp));
  }
  const tint = b.stage === "paint" ? 0xe7dccb : 0xd6dde6;
  const shellMat = meshMat(tint, mats.SHELL, { depthWrite: false });
  const topMat = meshMat(tint, mats.TOP, { depthWrite: false });
  const shellMesh = new T.Mesh(merge(outer), shellMat);
  const topMesh = new T.Mesh(merge(topPlates), topMat);
  shellMesh.userData = topMesh.userData = { block: b.id };
  shellMesh.renderOrder = topMesh.renderOrder = 2;
  group.add(shellMesh, topMesh);
  const edgeMat = lineMat(0x4b5563, 0.6);
  group.add(new T.LineSegments(new T.EdgesGeometry(prismGeo(S.section, X0, X1, warp, 1), 20), edgeMat));

  // ---- 안쪽 칸막이 ----
  const inner = [];
  // 가로(플로어·웹): 칸마다 맨홀 하나 (수밀이면 없음)
  const cellHoles = () => {
    const hs = [];
    for (let i = 0; i < zb.length - 1; i++) for (let j = 0; j < yb.length - 1; j++) {
      const cell = clipBox(S.section, zb[i], zb[i + 1], yb[j], yb[j + 1]);
      if (cell.length < 3) continue;
      const cb = bounds(cell);
      if (cb.z1 - cb.z0 < MANHOLE.w + 0.3 || cb.y1 - cb.y0 < MANHOLE.h + 0.3) continue;
      const [cz] = centroid(cell);
      const yc = cb.y0 + MANHOLE.bottom + MANHOLE.h / 2;
      if (yc + MANHOLE.h / 2 > yRange(S.section, cz)[1] - 0.1) continue;
      hs.push({ z: cz, y: yc, rz: MANHOLE.w / 2, ry: MANHOLE.h / 2 });
    }
    return hs;
  };
  xsInner.forEach((x) => {
    const wt = wtx.has(x.toFixed(3));
    inner.push(sectionGeo(S.section, x, wt ? [] : cellHoles(), rims, warp));
    frameL.poly(S.section.map(([z, y]) => W3(x, y, z)), true);
  });
  [X0, X1].forEach((x) => frameL.poly(S.section.map(([z, y]) => W3(x, y, z)), true)); // 블록 끝 (다음 블록과 이어 붙는 쪽, 열림)
  // 세로(거더): 플로어 칸마다 맨홀
  const xb = [X0, ...xsInner, X1];
  S.zs.forEach((z) => {
    const [ylo, yhi] = yRange(S.section, z);
    const holes = [];
    if (!wtz.has(z.toFixed(3))) {
      for (let i = 0; i < xb.length - 1; i++) for (let j = 0; j < yb.length - 1; j++) {
        const y0 = Math.max(ylo, yb[j]), y1 = Math.min(yhi, yb[j + 1]);
        if (y1 - y0 < MANHOLE.h + 0.3) continue;
        holes.push({ u: (xb[i] + xb[i + 1]) / 2 - X0, w: y0 + MANHOLE.bottom + MANHOLE.h / 2 - ylo, ru: MANHOLE.w / 2, rw: MANHOLE.h / 2 });
      }
    }
    inner.push(plateGeo(V(X0, ylo, z), V(1, 0, 0), V(0, 1, 0), S.L, yhi - ylo, holes, rims, warp));
    frameL.poly([W3(X0, ylo, z), W3(X1, ylo, z), W3(X1, yhi, z), W3(X0, yhi, z)], true);
  });
  // 수평(스트링거·데크): 구획마다 위아래로 오가는 맨홀 하나 + 사다리
  const ladderL = new Lines();
  const ladder = (p, q, side, w = 0.42) => {
    [-w / 2, w / 2].forEach((d) => ladderL.seg(Wg(p.x + side.x * d, p.y, p.z + side.z * d), Wg(q.x + side.x * d, q.y, q.z + side.z * d)));
    const L = p.distanceTo(q);
    for (let s = 0.3; s < L; s += 0.3) {
      const r = p.clone().lerp(q, s / L);
      ladderL.seg(Wg(r.x - side.x * w / 2, r.y, r.z - side.z * w / 2), Wg(r.x + side.x * w / 2, r.y, r.z + side.z * w / 2));
    }
  };
  S.ys.forEach((y) => {
    const [zlo, zhi] = zRange(S.section, y);
    const holes = [];
    const xseg = [X0, ...S.wt_x, X1];
    for (let i = 0; i < xseg.length - 1; i++) for (let j = 0; j < zb.length - 1; j++) {
      const z0 = Math.max(zlo, zb[j]), z1 = Math.min(zhi, zb[j + 1]);
      if (z1 - z0 < MANHOLE.w + 0.3) continue;
      const hx = xseg[i] + 1.2, hz = (z0 + z1) / 2;
      holes.push({ u: hx - X0, w: hz - zlo, ru: MANHOLE.flat / 2, rw: MANHOLE.flat / 2 });
      // 아래 층 바닥에서 이 맨홀까지 세로 사다리
      const below = yb.filter((v) => v < y - 1e-6).pop() ?? bb.y0;
      ladder(V(hx - 0.25, Math.max(below, yRange(S.section, hz)[0]), hz), V(hx - 0.25, y + 1.0, hz), V(0, 0, 1));
    }
    inner.push(plateGeo(V(X0, y, zlo), V(1, 0, 0), V(0, 0, 1), S.L, zhi - zlo, holes, rims, warp));
  });
  // 바닥 론지(보강재) 선 (현장 사진): 평평한 바닥이면 0.8 m 간격
  const flatBottom = S.section.filter(([, y]) => Math.abs(y - bb.y0) < 1e-6).length >= 2;
  if (flatBottom) {
    const [zlo, zhi] = zRange(S.section, bb.y0 + 1e-3);
    for (let z = zlo + 0.8; z < zhi - 0.3; z += 0.8) frameL.seg(W3(X0, bb.y0 + 0.15, z), W3(X1, bb.y0 + 0.15, z));
    if (H < 4) for (let z = zlo + 0.8; z < zhi - 0.3; z += 0.8) frameL.seg(W3(X0, bb.y1 - 0.15, z), W3(X1, bb.y1 - 0.15, z));
  }
  const innerMesh = new T.Mesh(merge(inner), mats.frameFill);
  group.add(innerMesh);
  frameL.build(group, mats.frameLine);

  // ---- 칸 부피: 측정기가 있는 칸만 상태 색 + 측정기. 없는 칸은 옅은 윤곽만 (감시 대상 아님) ----
  const plainEdge = lineMat(0x9aa3ad, 0.28);
  const zones = [];
  comps.forEach((cp) => {
    const inset = 0.14;
    const poly = clipBox(S.section, cp.z0 + inset, cp.z1 - inset, cp.y0 + inset, cp.y1 - inset);
    const geo = prismGeo(poly.length >= 3 ? poly : cp.poly, cp.x0 + inset, cp.x1 - inset, warp, 4);
    if (!cp.def) {
      group.add(new T.LineSegments(new T.EdgesGeometry(geo, 25), plainEdge));
      return;
    }
    const mat = meshMat(0x9aa1ab, 0.1, { depthWrite: false, emissive: 0x000000 });
    const mesh = new T.Mesh(geo, mat);
    mesh.renderOrder = 1;
    mesh.userData = { block: b.id, zone: cp.def.id };
    group.add(mesh);
    const zEdgeMat = lineMat(0x6b7280, 0.4);
    const zEdge = new T.LineSegments(new T.EdgesGeometry(geo, 25), zEdgeMat);
    zEdge.renderOrder = 3;
    group.add(zEdge);
    // 측정기: 구획 안 아래쪽, 앞면 쪽 칸막이에 붙임 (구획마다 1대, decisions #5 탈부착식 전제)
    const fy = Math.max(cp.y0, yRange(S.section, cp.zc)[0]);
    const dz = cp.zc + (cp.z1 - cp.z0) * 0.3;
    const dpos = Wg(cp.x0 + 0.5, fy + 0.45, Math.min(dz, yRange(S.section, dz)[1] > fy + 0.6 ? dz : cp.zc));
    box(group, 0.1, 0.18, 0.07, mats.sensor, dpos.x, dpos.y, dpos.z);
    const led = new T.Mesh(mats.ledGeo, new T.MeshBasicMaterial({ color: 0x999999 }));
    led.position.set(dpos.x, dpos.y + 0.13, dpos.z);
    group.add(led);
    cp.zone = { def: cp.def, cp, mesh, mat, edgeMat: zEdgeMat, status: "idle", leds: [led] };
    zones.push(cp.zone);
  });

  // ---- 받침: 정반 지주(초록 잭, 노란 캡) / 도장공장은 받침대 / 도크는 반목 위 ----
  if (b.stage !== "erect") {
    const zsup = [];
    for (let z = bb.z0 + 0.8; z <= bb.z1 - 0.79; z += Math.max(1.6, (bb.z1 - bb.z0 - 1.6) / Math.max(1, Math.round((bb.z1 - bb.z0) / 2.6)))) zsup.push(z);
    if (!zsup.length) zsup.push((bb.z0 + bb.z1) / 2);
    for (let x = X0 + 0.8; x <= X1 - 0.79; x += 2.4) zsup.forEach((z) => {
      const bot = W3(x, yRange(S.section, z)[0], z);
      const p = toWorld(V(bot.x, g, bot.z));
      const h = bot.y - g;
      if (b.stage === "paint") inst.stools.add(p.x, p.y, p.z, 0, 1, h);
      else { inst.jacks.add(p.x, p.y, p.z, 0, 1, h); inst.caps.add(p.x, p.y + h, p.z); }
    });
  }

  // ---- 족장 (높은 블록): 앞·뒤 면을 따라 기둥 · 2 m마다 발판 · 난간 ----
  if (H > 4) {
    const sc = new Lines();
    [bb.z1 + 0.9, bb.z0 - 0.9].forEach((zOff) => {
      for (let x = X0 - 0.3; x <= X1 + 0.31; x += 1.8) sc.seg(Wg(x, g, zOff), Wg(x, bb.y1 + 1.1, zOff));
      for (let y = 2; y <= bb.y1 + 0.05; y += 2) {
        sc.seg(Wg(X0 - 0.3, y + 1.0, zOff), Wg(X1 + 0.3, y + 1.0, zOff)); // 난간
        for (let x = X0; x < X1 - 0.9; x += 1.8) {
          const p = toWorld(Wg(x + 0.9, y, zOff - Math.sign(zOff) * 0.3));
          inst.planks.add(p.x, p.y, p.z);
        }
      }
    });
    sc.build(group, mats.scaff);
  }
  // 윗면 난간 (블록 위 작업 발판 둘레)
  const topZ = S.section.filter(([, y]) => Math.abs(y - bb.y1) < 1e-6).map(([z]) => z);
  if (topZ.length >= 2) {
    const tz0 = Math.min(...topZ), tz1 = Math.max(...topZ);
    const rail = new Lines();
    const perim = [[X0, tz0], [X1, tz0], [X1, tz1], [X0, tz1], [X0, tz0]];
    for (let i = 0; i < 4; i++) {
      const [xa, za] = perim[i], [xc2, zc2] = perim[i + 1];
      const L = Math.hypot(xc2 - xa, zc2 - za), n = Math.max(1, Math.round(L / 1.8));
      for (let k = 0; k <= n; k++) rail.seg(W3(xa + ((xc2 - xa) * k) / n, bb.y1, za + ((zc2 - za) * k) / n), W3(xa + ((xc2 - xa) * k) / n, bb.y1 + 1.0, za + ((zc2 - za) * k) / n));
      [0.5, 1.0].forEach((h) => rail.seg(W3(xa, bb.y1 + h, za), W3(xc2, bb.y1 + h, zc2)));
    }
    rail.build(group, mats.rail);
  }

  // ---- 작업 구획 장비: 송풍기 + 덕트, 사다리, 호스, 작업등, 출입현황판 · 사람이 드나드는 길 ----
  const anchors = {};
  const blowers = [];
  const boards = []; // { zone, group, face, tex, def, key }
  comps.forEach((cp) => {
    const def = cp.def;
    if (!def) return; // 측정기 없는 칸: 사람·장비 없음
    const s = sideOf(cp.face);
    const zFace = s > 0 ? bb.z1 : bb.z0;
    const scaff = H > 4 ? 1.6 : 0;
    const zOut = zFace + s * (2.4 + scaff); // 장비를 두는 바깥 땅
    const fy = Math.max(cp.y0, yRange(S.section, cp.zc)[0]); // 구획 바닥
    const R = (x, y, z) => toWorld(Wg(x, y, z));
    const inside = () => {
      for (let k = 0; k < 10; k++) {
        const x = cp.x0 + 0.6 + Math.random() * Math.max(0.01, cp.x1 - cp.x0 - 1.2);
        const z = cp.z0 + 0.45 + Math.random() * Math.max(0.01, cp.z1 - cp.z0 - 0.9);
        const [ylo, yhi] = yRange(S.section, z);
        const y = Math.max(cp.y0, ylo);
        if (Math.min(cp.y1, yhi) - y > 1.85 || k === 9) return R(x, y + 0.01, z);
      }
    };
    if (!def.permit) {
      anchors[def.id] = { def, block: b.id, stand: (i) => R(cp.xc + 0.6 * i, g, zOut) };
      return;
    }
    const xc = cp.xc;
    let entry, duct, lad;
    if (cp.face === "bottom") {
      // 바닥 외판 개구부: 덕트와 사다리가 같은 개구부로 (현장 사진)
      entry = [R(xc - 1.4, g, zOut - 0.6), R(xc - 0.15, g, bb.z1 + 0.6), R(xc - 0.15, g, cp.zc + 0.45), R(xc - 0.15, cp.y0 + 0.02, cp.zc + 0.05), R(xc - 0.8, fy + 0.01, cp.zc)];
      duct = [V(xc + 1.25, g + 0.32, zOut + 0.5), V(xc + 0.6, g + 0.25, zOut - 0.2), V(xc + 0.18, g + 0.25, bb.z1 + 0.4), V(xc + 0.18, g + 0.3, cp.zc + 1.0), V(xc + 0.18, -0.4, cp.zc), V(xc + 0.18, fy + 0.3, cp.zc), V(xc + 1.6, fy + 0.3, cp.zc - 0.2), V(xc + 2.6, fy + 0.25, cp.zc - 0.4)];
      lad = [V(xc - 0.15, g, cp.zc + 0.5), V(xc - 0.15, fy + 0.5, cp.zc)];
    } else if (cp.face === "top") {
      const ty = bb.y1;
      entry = [R(xc - 1.4, g, zOut - 0.6), R(xc - 0.6, g, bb.z1 + 0.45), R(xc - 0.6, ty + 0.01, bb.z1 + 0.45), R(xc - 0.15, ty + 0.01, Math.min(cp.zc + 0.6, bb.z1 - 0.5)), R(xc - 0.15, ty + 0.01, cp.zc), R(xc - 0.15, fy + 0.01, cp.zc), R(xc - 0.9, fy + 0.01, cp.zc)];
      duct = [V(xc + 1.25, g + 0.32, zOut + 0.5), V(xc + 0.5, g + 0.3, zOut - 0.4), V(xc + 0.25, g + 0.4, bb.z1 + 0.5), V(xc + 0.25, ty + 0.5, bb.z1 + 0.5), V(xc + 0.25, ty + 0.55, cp.zc + 0.4), V(xc + 0.18, ty - 0.2, cp.zc), V(xc + 0.18, fy + 0.3, cp.zc), V(xc + 1.6, fy + 0.3, cp.zc)];
      lad = [V(xc - 0.6, g, bb.z1 + 0.42), V(xc - 0.6, ty + 0.9, bb.z1 + 0.42)];
    } else {
      // 옆면 개구부: 족장 사다리로 구획 높이까지 올라가 들어간다
      const oy = cp.y0 + 0.95; // 개구부 가운데 높이
      const zl = zFace + s * 0.55; // 족장 안쪽 줄
      entry = [R(xc - 1.4, g, zOut - s * 0.6), R(xc - 0.6, g, zl), R(xc - 0.6, cp.y0 + 0.02, zl), R(xc, cp.y0 + 0.02, zl), R(xc, fy + 0.01, zFace - s * 0.7), R(xc - 0.8, fy + 0.01, zFace - s * Math.min(1.6, (cp.z1 - cp.z0) * 0.6))];
      duct = [V(xc + 1.25, g + 0.32, zOut + s * 0.5), V(xc + 0.6, g + 0.3, zOut - s * 0.3), V(xc + 0.2, g + 0.4, zFace + s * 1.25), V(xc + 0.2, oy, zFace + s * 1.25), V(xc + 0.18, oy, zFace - s * 0.3), V(xc + 0.18, fy + 0.3, zFace - s * 0.9), V(xc + 1.6, fy + 0.3, zFace - s * Math.min(1.6, (cp.z1 - cp.z0) * 0.6))];
      lad = [V(xc - 0.6, g, zl), V(xc - 0.6, cp.y0 + 1.0, zl)];
    }
    // 송풍기 (바닥 이동식) + 주름 덕트. 승인 전 출입(unapproved)은 환기 설비 없이 들어간 것으로 본다
    if (!def.unapproved) {
    const curve = new T.CatmullRomCurve3(duct.map((p) => Wg(p.x, p.y, p.z)), false, "centripetal");
    const tex = mats.ductTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(Math.round(curve.getLength() / 0.12), 1);
    group.add(new T.Mesh(new T.TubeGeometry(curve, 120, DUCT_R, 10, false), meshMat(0xffffff, 1, { map: tex })));
    const bg = new T.Group();
    bg.position.copy(Wg(xc + 1.6, g + 0.32, zOut + s * 0.5));
    const housing = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 0.62, 18, 1, true), mats.blower);
    housing.rotation.z = Math.PI / 2;
    bg.add(housing);
    box(bg, 0.66, 0.06, 0.36, mats.dark, 0, -0.22, 0);
    const fan = new T.Group();
    for (let k = 0; k < 3; k++) {
      const bl = box(fan, 0.03, 0.34, 0.09, mats.blade, 0, 0, 0);
      bl.rotation.x = (k * Math.PI * 2) / 3;
    }
    fan.position.x = 0.1;
    bg.add(fan);
    group.add(bg);
    const N = 14;
    const pg = new T.BufferGeometry();
    pg.setAttribute("position", new T.Float32BufferAttribute(new Float32Array(N * 3), 3));
    const points = new T.Points(pg, new T.PointsMaterial({ color: 0xd9f0ff, size: 0.18, transparent: true, opacity: 0.9, depthWrite: false }));
    group.add(points);
    const stopAt = def.vent && def.vent.stopAt !== undefined ? def.vent.stopAt : null;
    blowers.push({ fan, points, curve, N, zone: cp.zone, stopAt, pos: toWorld(Wg(xc + 1.6, g + 1.2, zOut)), block: b.id });
    // 도장·세척 구획: 바닥에서 뽑는 배기 덕트 (급기보다 조금 적게, KOSHA G-117) — 들어온 길 옆을 따라 밖 배기팬으로
    if (/도장|세척|신너|페인트/.test(def.permit.task)) {
      const ex = duct.map((p, k) => p.clone().add(V(-0.55, k >= duct.length - 2 ? -0.12 : 0, 0)));
      ex[ex.length - 1] = V(xc - 2.2, fy + 0.18, ex[ex.length - 1].z);
      ex[0] = V(xc + 0.3, g + 0.32, zOut + s * 1.4);
      const c3 = new T.CatmullRomCurve3(ex.map((p) => Wg(p.x, p.y, p.z)), false, "centripetal");
      const t3 = mats.ductTex.clone();
      t3.needsUpdate = true;
      t3.repeat.set(Math.round(c3.getLength() / 0.12), 1);
      group.add(new T.Mesh(new T.TubeGeometry(c3, 120, DUCT_R, 10, false), meshMat(0xbfd3ea, 1, { map: t3 })));
      const ef = new T.Mesh(new T.CylinderGeometry(0.2, 0.2, 0.62, 18, 1, true), mats.exhaust);
      ef.rotation.z = Math.PI / 2;
      ef.position.copy(Wg(xc - 0.1, g + 0.32, zOut + s * 1.4));
      group.add(ef);
    }
    }
    // 사다리
    ladder(lad[0], lad[1], V(1, 0, 0));
    // 호스 (용접·절단이면 산소·가스·전기 3가닥, 그 밖은 1가닥): 바닥 릴 → 출입구 → 안
    const hoseN = ctx.hot(def.permit.task) ? 3 : 1;
    for (let h = 0; h < hoseN; h++) {
      const o = (h - 1) * 0.06;
      const pts = entry.map((p) => p.clone().sub(group.position)); // 블록 기준으로 (회전 없음)
      pts[0] = V(xc - 2.6 + o, g + 0.05, zOut + s * 0.4);
      const c2 = new T.CatmullRomCurve3(pts.map((p, k) => p.clone().add(V(o + 0.12, k ? 0.04 : 0, 0))), false, "centripetal");
      group.add(new T.Mesh(new T.TubeGeometry(c2, 80, 0.025, 5, false), mats.hoses[h % 3]));
    }
    // 작업등 (현장 사진)
    const lamp = new T.Mesh(mats.lampGeo, mats.lamp);
    lamp.position.copy(Wg(cp.xc - 1.0, Math.min(cp.y1, yRange(S.section, cp.zc)[1]) - 0.35, cp.zc));
    group.add(lamp);
    // 출입현황판 (현장 사진): 작업 구획 바로 앞, 외판 바깥에 구획 바닥 높이로 세운다 (구획 부피와 겹치지 않아 따로 눌린다).
    // 덕트·사다리를 피해 구획 오른쪽에 두고, 기둥은 땅까지. 오른쪽 칸은 작업자가 들어갈 때 거는 출입증 자리이고
    // 그림은 block3d.js drawBoard가 출입증이 바뀔 때마다 다시 그린다
    const bh = 1.4, bw = bh * (BOARD_W / BOARD_H); // 멀리서도 보이게 실제(약 1.2 m)보다 조금 크게
    const by = Math.max(fy, g) + 0.35; // 판 아래 끝
    const bp = Wg(xc + 0.6 + bw / 2, by, zFace + s * 0.45);
    const boardTex = canvasTex(BOARD_W, BOARD_H, (c) => ctx.drawBoard(c, def, []));
    const board = new T.Group();
    const face = new T.Mesh(new T.PlaneGeometry(bw, bh), new T.MeshBasicMaterial({ map: boardTex, side: T.DoubleSide }));
    face.position.set(bp.x, bp.y + bh / 2, bp.z);
    if (s < 0) face.rotation.y = Math.PI;
    face.renderOrder = 4;
    face.userData = { block: b.id, zone: def.id, board: true };
    const pole = new Lines();
    [-bw / 2 + 0.06, bw / 2 - 0.06].forEach((dx) => pole.seg(V(bp.x + dx, g, bp.z - s * 0.01), V(bp.x + dx, bp.y + bh + 0.05, bp.z - s * 0.01)));
    pole.build(board, mats.pole);
    board.add(face);
    group.add(board);
    boards.push({ zone: def.id, group: board, face, tex: boardTex, def, key: null });
    anchors[def.id] = {
      def, block: b.id, entry, inside,
      stand: (i) => R(xc - 2.4 + 0.6 * (i % 4) - 0.9, g, zOut + s * (0.9 + 0.55 * Math.floor(i / 4))),
      watch: R(xc - 1.3, g, zOut - s * 0.4),
      hot: ctx.hot(def.permit.task),
    };
  });

  ladderL.build(group, mats.ladder);
  rims.build(group, mats.rim);
  return { zones, anchors, blowers, boards, shellMat, topMat, edgeMat, shellMesh, topMesh, top: bb.y1 + 1.2, size: { L: S.L, H, B: bb.z1 - bb.z0 } };
}
