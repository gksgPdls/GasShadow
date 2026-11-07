"""【AI ②-3】 LLM 이 찾은 판례를 근거로 조치 순서와 이유를 쓴다 (OpenAI 또는 OpenRouter, common/config.py).

키가 없거나 호출이 실패하면 가장 비슷한 판례의 조치를 그대로 옮긴 대체 추천을 만든다
(화면에 'LLM 미사용'으로 표시). 사내 모델로 바꾸려면 .env 의 URL·모델만 바꾸면 된다 (OpenAI 호환 API).

LLM 에 나가는 것: 지금 상황(구역 이름·작업·가스 값·추세·환기·인원)과 판례집에서 찾은 합성 판례.
멘토 자료(사내 자료)는 판례집에 넣지 않았으므로 외부로 나가지 않는다.
"""
from __future__ import annotations

import json
import logging
import re

import httpx

from ..common.config import LLM_API_KEY, LLM_MODEL, LLM_PROVIDER, LLM_READY, LLM_URL

log = logging.getLogger("llm")
# 조치 추천은 최대 2번 쓴다(graph.py MAX_WRITES). 메인 서버가 90초 기다리므로 한 번에 40초를 넘기지 않게 한다
RECOMMEND_TIMEOUT_S = 40
CHAT_TIMEOUT_S = 50


def _complete(system: str, user: str, timeout: float, schema: dict | None = None) -> str:
    """Chat Completions 한 번. 실패하면 예외 (부르는 쪽이 대체 동작으로 넘어간다).
    schema 가 있으면 OpenAI 에는 JSON 스키마 출력(response_format)으로 모양을 강제한다"""
    body: dict = {"model": LLM_MODEL, "temperature": 0.2,
                  "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
    if schema and LLM_PROVIDER == "openai":
        body["response_format"] = {"type": "json_schema", "json_schema": {"name": "answer", "strict": True, "schema": schema}}
    headers = {"Authorization": f"Bearer {LLM_API_KEY}"}
    if LLM_PROVIDER == "openrouter":
        headers["X-Title"] = "Gas Shadow"
    r = httpx.post(LLM_URL, timeout=timeout, headers=headers, json=body)
    # 모델에 따라 받지 않는 설정이 있다 → 그 설정만 빼고 다시 (스키마를 빼도 아래 검사·JSON 찾기는 그대로)
    for opt in ("temperature", "response_format"):
        if r.status_code == 400 and opt in r.text and opt in body:
            log.info("%s 를 받지 않는 모델 → 빼고 다시", opt)
            body.pop(opt)
            r = httpx.post(LLM_URL, timeout=timeout, headers=headers, json=body)
    if r.status_code >= 400:
        raise RuntimeError(f"{LLM_PROVIDER} HTTP {r.status_code}: {r.text[:300]}")
    return r.json()["choices"][0]["message"]["content"]


# 조치 추천 시스템 프롬프트 (초안 v2, 2026-11-02). 바꾸면 PROMPT_VERSION 도 올린다 → 추천 결과에 같이 남는다
PROMPT_VERSION = "rec-v2"
SYSTEM = """너는 조선소 밀폐공간 가스 안전 관제실의 조치 추천 보조자다. 결정은 안전관리자가 한다.
규칙 엔진이 이미 법정 기준 초과 경보를 냈다. 이 판정을 바꾸거나 의심하지 않는다.

[입력의 뜻]
- [지금 상황]: 지금 측정된 사실. 지금 상황에 대한 사실은 여기서만 가져온다.
- [비슷한 처리 기록]: 다른 날·다른 구역의 기록. 조건이 지금과 다를 수 있다.

[규칙]
1. 첫 단계는 작업 중지와 작업자 대피(인원 확인 포함)다.
2. 기록의 조치는 그 기록의 상황이 지금 상황과 맞을 때만 가져온다.
   지금 상황에 정보가 없으면 그 조치 대신 '확인' 단계로 쓴다. (예: 송풍기 상태를 모르면 '재가동'이 아니라 '송풍기 가동 상태 확인')
3. 각 단계에 이유와 근거를 단다. 기록에서 가져오면 case_ids에 번호, 일반 원칙이면 빈 배열.
4. [지금 상황]과 기록에 없는 수치·법 조문·장비·사람을 쓰지 않는다. 기록의 수치를 쓸 때는 "기록 #n 기준"이라고 밝힌다.
5. 마지막 단계는 "기준 아래로 내려간 것을 재측정으로 확인한 뒤 관리감독자 승인을 받아 재입장"이다.
6. cautions에는 이 상황에서만 해당하는 것을 쓴다: 지금 정보가 없어 확인해야 할 것, 기록과 지금 상황이 다른 점.
   어느 상황에나 맞는 일반론은 쓰지 않는다.
7. 한국어. 단계는 3~6개, 한 단계는 한 문장.

JSON 하나만 출력한다:
{"summary": "상황 한 문장", "steps": [{"action": "할 일", "reason": "이유", "case_ids": [1]}], "cautions": ["주의 한 줄"]}"""

# 규칙 5의 문장. LLM이 다르게 써도 코드가 마지막 단계를 이 문장으로 맞춘다 (normalize_draft)
REENTRY_ACTION = "기준 아래로 내려간 것을 재측정으로 확인한 뒤 관리감독자 승인을 받아 재입장"
REENTRY_REASON = "다시 들어가기 전 조건 (고정 문장)"

# 조치 추천 JSON 모양 (OpenAI strict 스키마: 모든 칸 필수, 다른 칸 없음)
REC_SCHEMA = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "steps": {"type": "array", "items": {
            "type": "object",
            "properties": {"action": {"type": "string"}, "reason": {"type": "string"},
                           "case_ids": {"type": "array", "items": {"type": "integer"}}},
            "required": ["action", "reason", "case_ids"], "additionalProperties": False}},
        "cautions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "steps", "cautions"],
    "additionalProperties": False,
}


def normalize_draft(draft: dict) -> dict:
    """규칙 5를 코드로 지킨다: 재입장 조건을 말하는 단계는 빼고, 마지막에 고정 문장을 붙인다.
    '재입장 금지'·'출입 통제'처럼 막는 단계는 남긴다"""
    def is_reentry(a: str) -> bool:
        return bool(re.search(r"재입장|재진입|작업 재개", a)) and not re.search(r"금지|통제|막", a)

    steps = draft.get("steps")
    if not isinstance(steps, list):
        return draft  # 모양이 틀린 답은 check() 가 잡아 다시 쓰게 한다
    steps = [st for st in steps if not (isinstance(st, dict) and is_reentry(str(st.get("action", ""))))]
    steps.append({"action": REENTRY_ACTION, "reason": REENTRY_REASON, "case_ids": []})
    return {**draft, "steps": steps}


_NUM = re.compile(r"\d+(?:\.\d+)?")


def unsupported_numbers(draft: dict, source: str) -> list[str]:
    """추천 글에 나온 숫자 중 입력(지금 상황 + 기록)에 없는 것. 입력 값을 반올림해 쓴 것은 있는 것으로 본다"""
    have = [float(x) for x in _NUM.findall(source)]
    texts = [draft.get("summary", ""), *draft.get("cautions", [])]
    texts += [t for st in draft.get("steps", []) for t in (st.get("action", ""), st.get("reason", ""))]
    out = []
    for tok in _NUM.findall(" ".join(texts)):
        d = len(tok.split(".")[1]) if "." in tok else 0
        x = float(tok)
        if not any(abs(round(y, d) - x) < 1e-9 for y in have) and tok not in out:
            out.append(tok)
    return out


def build_prompt(ctx: dict, cases: list[dict], feedback: str | None) -> str:
    g = ctx["trigger"]
    lines = [
        f"[지금 상황] {ctx['zone_name']} ({ctx['block']}) · 작업: {ctx.get('task') or '없음'} · 내부 인원 {ctx.get('workers', 0)}명",
        f"경보: {g['gas']} {g['value']} {g['unit']} (법정 기준 초과, 규칙층 판정)",
        f"환기: {ctx.get('ventilation')}",
        "가스 현재값·분당 기울기: " + ", ".join(
            f"{k} {v['value']}{v['unit']} ({v['slope_per_min']:+}/분)" for k, v in ctx.get("gases", {}).items()),
    ]
    if ctx.get("events"):
        lines.append("현장 이벤트: " + " / ".join(ctx["events"]))
    lines.append("\n[비슷한 처리 기록]")
    for c in cases:
        lines.append(f"- 기록 #{c['id']} (유사도 {c['similarity']:.2f}) {c['title']}\n  상황: {c['situation']}\n  조치: {c['actions']}\n  결과: {c.get('outcome') or '-'}")
    if not cases:
        lines.append("- 없음")
    if feedback:
        lines.append(f"\n[이전 답의 문제 — 고쳐서 다시 써라] {feedback}")
    return "\n".join(lines)


def call_llm(ctx: dict, cases: list[dict], feedback: str | None) -> dict | None:
    if not LLM_READY:
        return None
    try:
        text = _complete(SYSTEM, build_prompt(ctx, cases, feedback), RECOMMEND_TIMEOUT_S, schema=REC_SCHEMA)
        m = re.search(r"\{.*\}", text, re.S)
        draft = json.loads(m.group(0)) if m else None
        return normalize_draft(draft) if isinstance(draft, dict) else None
    except Exception as e:
        log.warning("LLM 호출 실패 → 대체 추천: %s", e)
        return None


GAS_LABEL = {"O2": "O₂", "LEL": "LEL", "CO": "CO", "H2S": "H₂S", "CO2": "CO₂"}


def fmt_value(gas: str, v: float) -> str:
    """화면과 같은 자릿수 (CO 정수, CO₂ 소수 둘째, 나머지 소수 첫째)"""
    return f"{v:.0f}" if gas == "CO" else f"{v:.2f}" if gas == "CO2" else f"{v:.1f}"


def fallback(ctx: dict, cases: list[dict], why: str | None = None) -> dict:
    """LLM 없이: 가장 비슷한 판례의 조치를 단계로 나눠 그대로 보여준다. why = 화면에 보일 'LLM을 못 쓴 이유'"""
    if why is None:
        why = "LLM 호출이 실패해서" if LLM_READY else "LLM이 연결되지 않아"
    g = ctx["trigger"]
    top = cases[0] if cases else None
    steps = [{"action": "작업 즉시 중지, 작업자 대피 및 인원 확인", "reason": "법정 기준 초과 경보에 바로 하는 조치", "case_ids": []}]
    if top:
        for part in re.split(r"\s*\d\)\s*", top["actions"]):
            part = part.strip()
            # 첫 단계(중지·대피)와 마지막 단계(재입장)는 아래에서 고정 문장으로 넣는다
            if part and not re.search(r"중지|대피|재입장|재개", part):
                steps.append({"action": part, "reason": "비슷한 처리 기록에서 한 조치", "case_ids": [top["id"]]})
    steps = steps[:5] + [{"action": REENTRY_ACTION, "reason": REENTRY_REASON, "case_ids": []}]  # 재입장은 항상 마지막
    return {"summary": f"{GAS_LABEL.get(g['gas'], g['gas'])} {fmt_value(g['gas'], g['value'])} {g['unit']} · 법정 기준 초과",
            "steps": steps, "cautions": [f"{why} 가장 비슷한 처리 기록의 조치를 그대로 옮겼어요"]}


CHAT_SYSTEM = """너는 조선소 밀폐공간 가스 안전 관제실의 안전 에이전트다. 안전관리자의 질문에 답한다.
- 아래 [지금 상황]에 있는 값만 근거로 쓴다. 없는 수치·법 조문·사람을 지어내지 않는다. 모르면 모른다고 한다.
- 작업 중지·재입장 같은 결정은 관리자가 한다. 너는 확인할 점과 선택지를 짧게 제안한다.
- 한국어, 3~6문장 안쪽, 쉬운 말."""


def chat(question: str, context: str) -> str | None:
    """【AI ②-3 재사용】 안전 에이전트 자유 질문. 키가 없거나 실패하면 None"""
    if not LLM_READY:
        return None
    try:
        return _complete(CHAT_SYSTEM, f"[지금 상황]\n{context}\n\n[질문]\n{question}", CHAT_TIMEOUT_S).strip()
    except Exception as e:
        log.warning("에이전트 대화 실패: %s", e)
        return None
