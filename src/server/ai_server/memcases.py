"""【AI ②-2 대체】 DB(PostgreSQL + pgvector)가 없을 때 쓰는 메모리 판례집. RAG 검색이 DB 없이도 돌게 한다.

- seed.py 의 합성 판례(SEED)로 시작한다. 번호는 seed.py 가 DB에 처음 넣는 순서와 같게 1번부터.
- 관리자 승인 기록(source='approved')은 AI 서버를 켜 둔 동안만 쌓이고, 다시 켜면 사라진다.
- 비슷함 = embed() 벡터의 코사인 유사도. embed()가 길이 1로 맞춰 주므로 내적이고, pgvector `1 - (a <=> b)` 와 같은 값이다.
"""
from __future__ import annotations

import threading

from .embed import embed
from .seed import SEED

_KEYS = ("id", "source", "title", "task", "gas", "situation", "actions", "outcome")
_lock = threading.Lock()
_cases: list[dict] = []


def _add(row: dict, text: str) -> int:
    vec = embed(text)
    with _lock:
        case_id = len(_cases) + 1
        _cases.append({**row, "id": case_id, "vec": vec})
    return case_id


for _s in SEED:  # seed.py main() 과 같은 글로 벡터를 만든다
    _add({"source": "seed_synthetic", **_s}, f"{_s['title']} {_s['situation']}")


def search(query: str, k: int) -> list[dict]:
    """지금 상황 글과 가장 비슷한 판례 k건 (graph.retrieve 와 같은 모양)"""
    q = embed(query)
    with _lock:
        scored = [(sum(a * b for a, b in zip(q, c["vec"])), c) for c in _cases]
    scored.sort(key=lambda x: -x[0])
    return [{**{key: c.get(key) for key in _KEYS}, "similarity": sim} for sim, c in scored[:k]]


def add_approved(*, title: str, task: str | None, gas: str, situation: str, actions: str,
                 outcome: str | None, alarm_id: int, text: str) -> int:
    """승인된 조치를 새 판례로 쌓는다 (graph.save 와 같은 내용). 새 판례 번호를 돌려준다"""
    return _add({"source": "approved", "title": title, "task": task, "gas": gas, "situation": situation,
                 "actions": actions, "outcome": outcome, "alarm_id": alarm_id}, text)


def count() -> int:
    with _lock:
        return len(_cases)
