"""메인 서버 (FastAPI, :8000). 규칙 판정 · 경보 · 저장 · 화면 실시간 전달. AI 서버가 꺼져 있어도 여기까지는 동작한다.

흐름
  재생기(또는 현장 MQTT 수신기) ─POST /api/ingest─▶ 여기 ─저장▶ PostgreSQL
                                                     ├─규칙 판정 → 법정 초과면 경보 → AI 서버 /recommend (② 조치 추천)
                                                     ├─1분마다 AI 서버 /predict (① 위험 예측)
                                                     └─WebSocket /ws ▶ React 화면
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from ..common.config import AI_URL
from ..common.db import init_db, pool
from . import rules

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
log = logging.getLogger("main")

HISTORY_MIN = 60
PREDICT_EVERY_MIN = 1.0


# ── 환기 강화(꺼져 있던 송풍기 가동) 효과 (시연용 가정값, 화면 sim.ts ventAdjust와 같은 식) ─────
# 누른 뒤 VENT_MIN분에 걸쳐 평상시 값보다 높던(산소는 낮던) 부분이 VENT_KEEP 비율까지 줄어든다
VENT_MIN = 12
VENT_KEEP = 0.25
VENT_BASE = {"O2": 20.9, "LEL": 0.3, "CO": 2.0, "H2S": 0.1, "CO2": 0.06}


def vent_adjust(vals: dict, dt: float) -> dict:
    if dt < 0:
        return vals
    f = 1 - (1 - VENT_KEEP) * min(1.0, dt / VENT_MIN)
    return {g: VENT_BASE[g] + (v - VENT_BASE[g]) * f if g in VENT_BASE else v for g, v in vals.items()}


# ── 상태 (한 번의 시연 = run 하나) ──────────────────────────────
class Zone:
    def __init__(self, meta: dict):
        self.meta = meta  # id, block, name, sensor, permit, task_type, vent, sensorLostAt
        self.history: list[tuple[float, dict]] = []
        self.last_recv: float | None = None
        self.alarm_id: int | None = None
        self.alarmed = False
        self.acked = False
        self.vent_at: float | None = None  # 환기 강화(꺼진 송풍기 가동) 시작 시각 (분)


class State:
    def __init__(self):
        self.run_id = ""
        self.t = 0.0
        self.zones: dict[str, Zone] = {}
        self.control = {"playing": True, "speed": 10, "outage": False, "reset": 0}
        self.predictions: dict[str, dict] = {}
        self.recommendations: dict[int, dict] = {}  # alarm_id → AI 추천 + 결정
        self.last_predict_t = -1e9
        self.predicting = False
        self.ai_ok: bool | None = None

    def assess(self, z: Zone) -> dict:
        return rules.assess(z.history, z.last_recv, z.meta.get("sensorLostAt"), bool(z.meta.get("permit")), self.t,
                            z.meta.get("measureFrom"))


S = State()
clients: set[WebSocket] = set()


async def broadcast(msg: dict):
    dead = []
    for ws in clients:
        try:
            await ws.send_json(msg)
        except Exception:
            dead.append(ws)
    for ws in dead:
        clients.discard(ws)


def db_exec(sql: str, args: tuple = (), fetch: bool = False):
    p = pool()
    if p is None:
        return None
    with p.connection() as c:
        cur = c.execute(sql, args)
        return cur.fetchone() if fetch else None


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    yield


app = FastAPI(title="Gas Shadow 메인 서버", lifespan=lifespan)


# ── 입력 ────────────────────────────────────────────────────
class RunStart(BaseModel):
    run_id: str | None = None
    t: float
    zones: list[dict]


class Reading(BaseModel):
    zone_id: str
    t: float
    O2: float
    LEL: float
    CO: float
    H2S: float
    CO2: float


class Ingest(BaseModel):
    run_id: str
    t: float
    readings: list[Reading]
    quiet: bool = False  # 시작 전 이력 채우기: 경보·AI 호출 없이 저장만


@app.post("/api/run")
async def start_run(body: RunStart):
    """재생기가 새 시연을 시작할 때 구역 정보를 보낸다 (현장에서는 허가서·센서 등록 정보)"""
    S.run_id = body.run_id or uuid.uuid4().hex[:8]
    S.t = body.t
    S.zones = {m["id"]: Zone(m) for m in body.zones}
    S.predictions, S.recommendations = {}, {}
    S.last_predict_t = -1e9
    # 화면에 알리는 'reset'은 시작 전 이력(quiet ingest)을 다 채운 뒤에 보낸다 (빈 이력을 받아가지 않게)
    log.info("새 시연 %s · 구역 %d개", S.run_id, len(S.zones))
    return {"run_id": S.run_id}


@app.post("/api/ingest")
async def ingest(body: Ingest):
    if body.run_id != S.run_id:
        raise HTTPException(409, "run_id가 다릅니다. /api/run 부터 다시 시작하세요")
    S.t = body.t
    rows = []
    for r in body.readings:
        z = S.zones.get(r.zone_id)
        if not z:
            continue
        vals = {g: getattr(r, g) for g in rules.GASES}
        if z.vent_at is not None and r.t >= z.vent_at:
            vals = vent_adjust(vals, r.t - z.vent_at)
            for g, v in vals.items():
                setattr(r, g, v)  # 화면에 보내는 값도 환기 효과를 반영한 값
        z.history.append((r.t, vals))
        z.last_recv = r.t
        while z.history and z.history[0][0] < r.t - HISTORY_MIN:
            z.history.pop(0)
        rows.append((S.run_id, r.zone_id, r.t, vals["O2"], vals["LEL"], vals["CO"], vals["H2S"], vals["CO2"]))
    p = pool()
    if p is not None and rows:
        with p.connection() as c, c.cursor() as cur:
            cur.executemany(
                "INSERT INTO readings (run_id, zone_id, t_min, o2, lel, co, h2s, co2) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)", rows)

    assess = {zid: S.assess(z) for zid, z in S.zones.items()}
    if body.quiet:  # 시작 전 이력 채우기 끝 → 화면에 새 시연을 알린다 (경보·예측은 하지 않음)
        await broadcast({"type": "reset", "run_id": S.run_id})
        return {"control": S.control}
    for zid, a in assess.items():
        z = S.zones[zid]
        if a["status"] == "legal" and not z.alarmed:
            await raise_alarm(z, a)
    if S.t - S.last_predict_t >= PREDICT_EVERY_MIN and not S.predicting:
        S.last_predict_t = S.t
        asyncio.create_task(run_predictions())

    await broadcast({
        "type": "tick", "run_id": S.run_id, "t": S.t,
        "readings": [r.model_dump() for r in body.readings],
        "assess": assess,
    })
    return {"control": S.control}


# ── 규칙층 경보 → ② 조치 추천 시작 ─────────────────────────────
async def raise_alarm(z: Zone, a: dict):
    z.alarmed = True
    row = db_exec("INSERT INTO alarms (run_id, zone_id, t_min, gas, value) VALUES (%s,%s,%s,%s,%s) RETURNING id",
                  (S.run_id, z.meta["id"], S.t, a["gas"], a["value"]), fetch=True)
    z.alarm_id = row[0] if row else int(S.t * 1000)
    log.info("경보 %s %s %s=%.2f", z.alarm_id, z.meta["name"], a["gas"], a["value"])
    S.recommendations[z.alarm_id] = {"alarm_id": z.alarm_id, "zone_id": z.meta["id"], "status": "running"}
    await broadcast({"type": "recommendation", "rec": S.recommendations[z.alarm_id]})
    asyncio.create_task(request_recommendation(z, a))


def zone_context(z: Zone, a: dict) -> dict:
    """② 1단계 '상황 모으기': AI 서버가 추천을 쓸 때 필요한 지금 상황 (작업 · 가스 추세 · 환기 · 인원)"""
    gases = {}
    if z.history:
        cur = z.history[-1][1]
        for g in rules.GASES:
            s = rules.slope(z.history, g, S.t)
            gases[g] = {"value": round(cur[g], 3), "slope_per_min": round(s, 4), "unit": rules.LIMITS[g]["unit"],
                        "severity": round(rules.severity(g, cur[g]), 2)}
    m = z.meta
    # 환기는 현장 데이터(meta["vent"])가 있을 때만 쓴다. 없는데 '가동'으로 채우면 LLM이 사실로 믿고 조치를 쓴다
    # (지금 시나리오 site.json 에는 환기 데이터가 없다)
    vent = m.get("vent")
    if vent:
        vent_text = (f"송풍기 {vent['blowers']}대 중 1대 정지 의심" if S.t >= vent["stopAt"]
                     else f"송풍기 {vent['blowers']}대 가동")
    else:
        vent_text = "환기 정보 없음 (송풍기 가동 여부를 알 수 없음)"
    permit = m.get("permit") or {}
    return {
        "alarm_id": z.alarm_id, "zone_id": m["id"], "zone_name": m["name"], "block": m["block"],
        "t_min": S.t, "task": permit.get("task"), "task_type": m.get("task_type"), "permit_no": permit.get("no"),
        "workers": permit.get("workers", 0), "ventilation": vent_text,
        "trigger": {"gas": a["gas"], "value": round(a["value"], 3), "unit": rules.LIMITS[a["gas"]]["unit"]},
        "gases": gases, "events": [e["text"] for e in m.get("events", []) if e["t"] <= S.t],
        "prediction": S.predictions.get(m["id"]),
    }


async def request_recommendation(z: Zone, a: dict):
    try:
        async with httpx.AsyncClient(timeout=90) as c:
            r = await c.post(f"{AI_URL}/recommend", json=zone_context(z, a))
            r.raise_for_status()
            rec = r.json()
        S.ai_ok = True
    except Exception as e:  # AI 서버가 없어도 경보·규칙은 그대로
        log.warning("AI 추천 실패: %s", e)
        S.ai_ok = False
        rec = {"alarm_id": z.alarm_id, "zone_id": z.meta["id"], "status": "unavailable",
               "error": "AI 서버에 연결할 수 없습니다. 규칙 경보와 기본 대응(작업 중지·대피·환기)을 따르세요."}
    S.recommendations[z.alarm_id] = rec
    await broadcast({"type": "recommendation", "rec": rec})


# ── ① 위험 예측 (1분마다) ────────────────────────────────────
def task_state(meta: dict, t: float) -> str:
    """모델 입력 작업 상태: 작업 시각이 있으면 작업 전·중·후로 나누고, 없으면 허가 유무로 정한다"""
    start, end = meta.get("workStart"), meta.get("workEnd")
    if start is not None:
        return "PRE_WORK" if t < start else "RECOVERY" if end is not None and t > end else "WORK"
    return "WORK" if meta.get("permit") else "PRE_WORK"


async def run_predictions():
    S.predicting = True
    try:
        payload = {"t": S.t, "zones": []}
        for zid, z in S.zones.items():
            if not z.history or z.last_recv is None or S.t - z.last_recv > rules.MISSING_AFTER_MIN:
                continue
            if not z.meta.get("permit"):
                continue  # 허가 작업이 없는 구역(작업자 없음)은 예측하지 않는다. 예측 한 번이 빨라져 배속 시연에서도 1~2분마다 갱신된다
            payload["zones"].append({
                "zone_id": zid, "task_type": z.meta.get("task_type", "NONE"),
                "task_state": task_state(z.meta, S.t),
                "samples": [{"t": t, **v} for t, v in z.history if t >= S.t - 40],
            })
        async with httpx.AsyncClient(timeout=20) as c:
            r = await c.post(f"{AI_URL}/predict", json=payload)
            r.raise_for_status()
            S.predictions = r.json()["predictions"]
        S.ai_ok = True
        await broadcast({"type": "predictions", "t": S.t, "predictions": S.predictions})
    except Exception as e:
        if S.ai_ok is not False:
            log.warning("AI 예측 실패: %s", e)
        S.ai_ok = False
        await broadcast({"type": "ai_status", "ok": False})
    finally:
        S.predicting = False


# ── 화면에서 오는 요청 ─────────────────────────────────────────
@app.get("/api/state")
def state():
    return {
        "run_id": S.run_id, "t": S.t, "control": S.control, "ai_ok": S.ai_ok,
        "zones": {zid: {"history": [{"t": t, **v} for t, v in z.history], "lastRecv": z.last_recv,
                        "assess": S.assess(z), "alarm_id": z.alarm_id, "acked": z.acked}
                  for zid, z in S.zones.items()},
        "predictions": S.predictions,
        "recommendations": list(S.recommendations.values()),
    }


@app.post("/api/control")
async def control(body: dict):
    for k in ("playing", "speed", "outage"):
        if k in body:
            S.control[k] = body[k]
    if body.get("reset"):
        S.control["reset"] += 1  # 재생기가 다음 응답에서 보고 처음부터 다시 보낸다
    await broadcast({"type": "control", "control": S.control})
    return S.control


@app.post("/api/vent/{zone_id}")
async def vent(zone_id: str):
    """경계 단계 조치: 꺼져 있던 송풍기 가동(환기 강화). 이후 들어오는 그 구역 측정값에 환기 효과를 적용한다"""
    z = S.zones.get(zone_id)
    if not z:
        raise HTTPException(404)
    if z.vent_at is None:
        z.vent_at = S.t
    return {"ok": True, "vent_at": z.vent_at}


@app.post("/api/ack/{zone_id}")
async def ack(zone_id: str):
    z = S.zones.get(zone_id)
    if not z:
        raise HTTPException(404)
    z.acked = True
    if z.alarm_id:
        db_exec("UPDATE alarms SET acked = true WHERE id = %s", (z.alarm_id,))
    return {"ok": True}


class Decision(BaseModel):
    decision: str  # approved · edited
    final_steps: list[str]
    approver: str = "안전관리자"
    note: str | None = None


@app.post("/api/recommendations/{alarm_id}/decision")
async def decide(alarm_id: int, body: Decision):
    """② 4단계 관리자 승인 → AI 서버가 멈춰 기다리던 LangGraph를 이어서 5단계(기록 저장)까지 진행"""
    async with httpx.AsyncClient(timeout=30) as c:
        r = await c.post(f"{AI_URL}/recommend/{alarm_id}/resume", json=body.model_dump())
        if r.status_code >= 400:
            raise HTTPException(r.status_code, r.text)
        rec = r.json()
    S.recommendations[alarm_id] = rec
    await broadcast({"type": "recommendation", "rec": rec})
    return rec


class AgentChat(BaseModel):
    question: str
    context: str


@app.post("/api/agent/chat")
async def agent_chat(body: AgentChat):
    """안전 에이전트 자유 질문 → AI 서버 /chat. AI 서버가 없으면 answer=None"""
    try:
        async with httpx.AsyncClient(timeout=70) as c:
            r = await c.post(f"{AI_URL}/chat", json=body.model_dump())
            r.raise_for_status()
            return r.json()
    except Exception as e:
        log.warning("에이전트 대화 실패: %s", e)
        return {"answer": None}


@app.websocket("/ws")
async def ws(sock: WebSocket):
    await sock.accept()
    clients.add(sock)
    try:
        while True:
            await sock.receive_text()  # 화면은 보내는 게 없다. 연결 유지용
    except WebSocketDisconnect:
        clients.discard(sock)


@app.get("/health")
def health():
    return {"ok": True, "db": pool() is not None, "ai_ok": S.ai_ok}
