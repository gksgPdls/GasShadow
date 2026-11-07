"""AI 서버 (FastAPI, :8001). AI 를 쓰는 곳은 이 서버 안에만 있다.

  POST /predict                  【AI ①】 5가스 위험예측 (scikit-learn, 메인 서버가 1분마다 호출)
  POST /recommend                【AI ②】 경보가 뜨면 조치 추천 시작 (LangGraph: 상황 → RAG → LLM → 승인 대기)
  POST /recommend/{id}/resume    관리자 승인/수정 → LangGraph 이어서 기록 저장
  GET  /recommend/{id}           추천 상태 보기
  POST /chat                     안전 에이전트 자유 질문 (LLM, 화면이 보낸 지금 상황만 근거)
"""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from langgraph.types import Command
from pydantic import BaseModel

from ..common.config import LLM_API_KEY, LLM_MODEL, LLM_PROVIDER, LLM_READY
from ..common.db import init_db, pool
from . import memcases
from .graph import GRAPH, view
from .llm import chat as llm_chat
from .predictor import Predictor

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
log = logging.getLogger("ai")
predictor: Predictor | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global predictor
    init_db()
    predictor = Predictor()
    p = pool()
    if p is not None:
        with p.connection() as c:
            n = c.execute("SELECT count(*) FROM cases").fetchone()[0]
        log.info("판례집 %d건", n)
        if n == 0:
            log.warning("판례집이 비었습니다: python -m src.server.ai_server.seed 를 먼저 실행하세요")
    else:
        log.info("DB 없음 → 메모리 판례집 %d건으로 RAG 검색 (승인 기록은 이 서버를 켜 둔 동안만 남음)", memcases.count())
    if LLM_READY:
        log.info("LLM: %s · %s", LLM_PROVIDER, LLM_MODEL)
    elif LLM_API_KEY:
        log.warning("LLM 키는 있는데 모델이 없습니다: src/server/.env 에 OPENAI_MODEL=... 을 넣으세요")
    else:
        log.info("LLM 키 없음 → 조치 추천은 판례 기반 대체 추천, 자유 질문은 답하지 않음")
    yield


app = FastAPI(title="Gas Shadow AI 서버", lifespan=lifespan)


class ZoneWindow(BaseModel):
    zone_id: str
    task_type: str
    task_state: str
    samples: list[dict]


class PredictReq(BaseModel):
    t: float
    zones: list[ZoneWindow]


@app.post("/predict")
def predict(req: PredictReq):
    try:
        out = predictor.predict_batch(req.t, [(z.zone_id, z.task_type, z.task_state, z.samples) for z in req.zones])
    except Exception as e:  # 예측 실패가 메인 서버를 막지 않게
        log.warning("예측 실패: %s", e)
        out = {z.zone_id: predictor._unavailable("error") for z in req.zones}
    return {"t": req.t, "predictions": out}


def _cfg(alarm_id: int) -> dict:
    return {"configurable": {"thread_id": f"alarm-{alarm_id}"}}


@app.post("/recommend")
def recommend(ctx: dict):
    alarm_id = int(ctx["alarm_id"])
    GRAPH.invoke({"ctx": ctx}, _cfg(alarm_id))  # 4단계(승인)에서 멈춘 채 돌아온다
    snap = GRAPH.get_state(_cfg(alarm_id))
    return view(alarm_id, snap.values, waiting=bool(snap.next))


class Decision(BaseModel):
    decision: str
    final_steps: list[str]
    approver: str | None = None
    note: str | None = None


@app.post("/recommend/{alarm_id}/resume")
def resume(alarm_id: int, d: Decision):
    snap = GRAPH.get_state(_cfg(alarm_id))
    if not snap.next:
        raise HTTPException(404, "승인을 기다리는 추천이 없습니다 (AI 서버를 재시작했다면 대기 상태가 사라졌습니다)")
    GRAPH.invoke(Command(resume=d.model_dump()), _cfg(alarm_id))
    snap = GRAPH.get_state(_cfg(alarm_id))
    return view(alarm_id, snap.values, waiting=bool(snap.next))


@app.get("/recommend/{alarm_id}")
def get_rec(alarm_id: int):
    snap = GRAPH.get_state(_cfg(alarm_id))
    if not snap.values:
        raise HTTPException(404)
    return view(alarm_id, snap.values, waiting=bool(snap.next))


class ChatReq(BaseModel):
    question: str
    context: str


@app.post("/chat")
def chat(req: ChatReq):
    """안전 에이전트 자유 질문 (LLM). 키가 없으면 answer=None — 화면이 안내 문구를 보여준다"""
    return {"answer": llm_chat(req.question, req.context)}


@app.get("/health")
def health():
    return {"ok": True, "db": pool() is not None, "model": predictor is not None,
            "llm": {"provider": LLM_PROVIDER, "model": LLM_MODEL or None, "ready": LLM_READY},
            "cases": "db" if pool() is not None else f"memory:{memcases.count()}"}
