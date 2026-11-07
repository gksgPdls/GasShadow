"""【AI ②】 조치 추천 — LangGraph 가 아래 순서를 진행하는 감독 역할을 한다.

  1 상황 모으기 ─▶ 2 RAG 검색 ─▶ 3 추천 쓰기 ─▶ (검사) ─▶ 4 관리자 승인 ─▶ 5 기록 저장
     (메인 서버)     (pgvector)     (LLM)        │ 이상하면 3으로      (사람, 여기서 멈춤)   (판례집에 쌓임)
                                                └ 2번까지 다시 쓰게 함

- 4단계에서 interrupt()로 멈추고, 관리자가 화면에서 승인/수정하면 /recommend/{id}/resume 이 이어서 진행한다.
- 5단계에서 승인된 조치가 새 판례(source='approved')로 저장되어 다음 RAG 검색에 쓰인다.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any, TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import interrupt

from ..common.config import LLM_MODEL, LLM_PROVIDER, LLM_READY
from ..common.db import pool
from . import llm, memcases
from .embed import embed, to_pg

log = logging.getLogger("graph")
MAX_WRITES = 2
TOP_K = 3


class RecState(TypedDict, total=False):
    ctx: dict
    query: str
    cases: list[dict]
    draft: dict
    llm_used: bool
    writes: int
    problem: str | None
    decision: dict
    saved_case_id: int | None


def situation_text(ctx: dict) -> str:
    g = ctx["trigger"]
    trend = ", ".join(f"{k} {v['slope_per_min']:+}/분" for k, v in ctx.get("gases", {}).items() if abs(v["slope_per_min"]) > 0.005)
    return (f"{ctx.get('task') or '작업 없음'} {ctx['zone_name']} {g['gas']} {g['value']}{g['unit']} 기준 초과. "
            f"추세 {trend or '변화 적음'}. {ctx.get('ventilation')}. 작업자 {ctx.get('workers', 0)}명. "
            + " ".join(ctx.get("events", [])))


# 1 상황 모으기: 메인 서버가 보낸 context(작업·가스 추세·환기·인원)를 검색용 문장으로 정리
def gather(s: RecState) -> RecState:
    return {"query": situation_text(s["ctx"]), "writes": 0, "problem": None}


# 2 RAG 검색: 판례집(PostgreSQL + pgvector)에서 지금 상황과 가장 비슷한 기록 TOP_K 건
#   DB가 없으면 메모리 판례집(memcases.py: 같은 합성 판례 + 이번 실행 중 승인 기록)에서 같은 방식으로 찾는다
def retrieve(s: RecState) -> RecState:
    p = pool()
    if p is None:
        return {"cases": memcases.search(s["query"], TOP_K)}
    with p.connection() as c:
        rows = c.execute(
            "SELECT id, source, title, task, gas, situation, actions, outcome, 1 - (embedding <=> %s::vector) AS sim "
            "FROM cases ORDER BY embedding <=> %s::vector LIMIT %s",
            (to_pg(embed(s["query"])),) * 2 + (TOP_K,)).fetchall()
    keys = ["id", "source", "title", "task", "gas", "situation", "actions", "outcome", "similarity"]
    return {"cases": [dict(zip(keys, r)) for r in rows]}


# 3 추천 쓰기: LLM이 찾은 근거로 조치 순서 + 이유
def write(s: RecState) -> RecState:
    draft = llm.call_llm(s["ctx"], s["cases"], s.get("problem"))
    used = draft is not None
    if draft is None:
        draft = llm.fallback(s["ctx"], s["cases"])
    return {"draft": draft, "llm_used": used, "writes": s.get("writes", 0) + 1}


# (검사) 추천이 이상하면 다시 쓰게 한다 — 규칙으로 확인
def check(s: RecState) -> RecState:
    d = s["draft"]
    steps = d.get("steps") or []
    ids = {c["id"] for c in s["cases"]}
    problem = None
    if not isinstance(steps, list) or not all(
            isinstance(st, dict) and isinstance(st.get("action"), str) and isinstance(st.get("case_ids", []), list)
            for st in steps):
        problem = "단계 모양이 {action, reason, case_ids} 가 아니다"
    elif not 2 <= len(steps) <= 8:
        problem = "단계 수가 2~8개가 아니다"
    elif not re.search(r"중지|대피", steps[0].get("action", "")):
        problem = "첫 단계가 작업 중지·대피가 아니다"
    elif steps[-1].get("action") != llm.REENTRY_ACTION:
        problem = "마지막 단계가 재입장 조건 문장이 아니다"
    elif any(cid not in ids for st in steps for cid in st.get("case_ids", [])):
        problem = "찾은 기록에 없는 기록 번호를 인용했다"
    # 기록을 하나도 인용하지 않은 것은 다시 쓰게 하지 않는다: 프롬프트 규칙 2(맞는 기록만 쓴다)와 부딪힌다.
    # 대신 fix_or_fallback 이 화면에 '근거로 쓴 기록 없음'을 알린다
    elif bad := llm.unsupported_numbers(d, llm.build_prompt(s["ctx"], s["cases"], None)):
        problem = f"지금 상황과 기록에 없는 숫자({', '.join(bad)})를 썼다. 입력에 있는 숫자만 쓴다"
    return {"problem": problem}


def after_check(s: RecState) -> str:
    if s["problem"] and s["writes"] < MAX_WRITES and s.get("llm_used"):
        log.info("추천 검사 실패(%s) → 다시 쓰기", s["problem"])
        return "write"
    if s["problem"]:  # 다시 써도 안 되면 판례 기반 대체 추천으로
        log.warning("추천 검사 실패(%s) → 대체 추천", s["problem"])
    return "approve"


def fix_or_fallback(s: RecState) -> RecState:
    if s["problem"]:
        why = f"LLM 답이 검사({s['problem']})를 통과하지 못해" if s.get("llm_used") else None
        return {"draft": llm.fallback(s["ctx"], s["cases"], why), "llm_used": False}
    d = s["draft"]
    if s.get("llm_used") and s["cases"] and not any(st.get("case_ids") for st in d.get("steps", [])):
        note = "근거로 쓴 처리 기록이 없어요. 찾은 기록은 아래 '근거 · 비슷한 처리 기록'에서 직접 확인하세요"
        return {"draft": {**d, "cautions": [*d.get("cautions", []), note]}}
    return {}


# 4 관리자 승인: 여기서 멈춰 기다린다 (사람)
def approve(s: RecState) -> RecState:
    decision = interrupt({"draft": s["draft"]})
    return {"decision": decision}


# 5 기록 저장: 결정 기록 + 새 판례로 쌓아 다음 RAG 검색에 쓰이게 한다
def save(s: RecState) -> RecState:
    ctx, d = s["ctx"], s["decision"]
    steps = d["final_steps"]
    p = pool()
    if p is None:  # DB 없음: 메모리 판례집에만 쌓는다 (AI 서버를 다시 켜면 사라짐)
        actions = " ".join(f"{i}) {a}" for i, a in enumerate(steps, 1))
        title = f"{ctx['zone_name']} {ctx['trigger']['gas']} 기준 초과 — 관리자 {'승인' if d['decision'] == 'approved' else '수정 승인'}"
        case_id = memcases.add_approved(title=title, task=ctx.get("task"), gas=ctx["trigger"]["gas"], situation=s["query"],
                                        actions=actions, outcome=d.get("note"), alarm_id=ctx["alarm_id"],
                                        text=f"{title} {s['query']}")
        return {"saved_case_id": case_id}
    with p.connection() as c:
        c.execute(
            "INSERT INTO action_records (alarm_id, zone_id, recommendation, decision, final_steps, approver, note) "
            "VALUES (%s,%s,%s,%s,%s,%s,%s)",
            (ctx["alarm_id"], ctx["zone_id"], json.dumps(s["draft"], ensure_ascii=False), d["decision"],
             json.dumps(steps, ensure_ascii=False), d.get("approver"), d.get("note")))
        actions = " ".join(f"{i}) {a}" for i, a in enumerate(steps, 1))
        title = f"{ctx['zone_name']} {ctx['trigger']['gas']} 기준 초과 — 관리자 {'승인' if d['decision'] == 'approved' else '수정 승인'}"
        row = c.execute(
            "INSERT INTO cases (source, title, task, gas, situation, actions, outcome, alarm_id, embedding) "
            "VALUES ('approved', %s, %s, %s, %s, %s, %s, %s, %s::vector) RETURNING id",
            (title, ctx.get("task"), ctx["trigger"]["gas"], s["query"], actions, d.get("note"), ctx["alarm_id"],
             to_pg(embed(f"{title} {s['query']}")))).fetchone()
    return {"saved_case_id": row[0]}


def build():
    g = StateGraph(RecState)
    g.add_node("gather", gather)
    g.add_node("retrieve", retrieve)
    g.add_node("write", write)
    g.add_node("check", check)
    g.add_node("fix_or_fallback", fix_or_fallback)
    g.add_node("approve", approve)
    g.add_node("save", save)
    g.add_edge(START, "gather")
    g.add_edge("gather", "retrieve")
    g.add_edge("retrieve", "write")
    g.add_edge("write", "check")
    g.add_conditional_edges("check", after_check, {"write": "write", "approve": "fix_or_fallback"})
    g.add_edge("fix_or_fallback", "approve")
    g.add_edge("approve", "save")
    g.add_edge("save", END)
    # 승인 대기 상태를 메모리에 둔다 (AI 서버를 재시작하면 대기 중인 추천은 사라진다)
    return g.compile(checkpointer=InMemorySaver())


GRAPH = build()


def view(alarm_id: int, values: dict[str, Any], waiting: bool) -> dict:
    """화면에 보낼 추천 한 벌"""
    d = values.get("decision")
    return {
        "alarm_id": alarm_id,
        "zone_id": values["ctx"]["zone_id"],
        "status": "awaiting_approval" if waiting else (d["decision"] if d else "done"),
        "summary": values.get("draft", {}).get("summary"),
        "steps": values.get("draft", {}).get("steps", []),
        "cautions": values.get("draft", {}).get("cautions", []),
        "cases": [{k: c[k] for k in ("id", "source", "title", "actions", "similarity")} for c in values.get("cases", [])],
        "llm": {"used": bool(values.get("llm_used")), "model": LLM_MODEL if values.get("llm_used") else None,
                "provider": LLM_PROVIDER, "configured": LLM_READY,
                "prompt": llm.PROMPT_VERSION if values.get("llm_used") else None},
        "writes": values.get("writes", 0),
        "final_steps": d["final_steps"] if d else None,
        "approver": d.get("approver") if d else None,
        "saved_case_id": values.get("saved_case_id"),
    }
