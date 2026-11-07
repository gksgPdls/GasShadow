"""【AI ②-2 의 부품】 글 → 512차원 벡터. pgvector 가 이 벡터끼리 가까운 것을 찾는다.

지금은 외부 모델을 내려받지 않는 가벼운 방식(글자 1~3자 묶음을 해시해 세는 벡터)이다.
한국어 판례 문장에서 '도장·LEL·송풍기' 같은 낱말이 겹치는 정도로 비슷함을 잰다.
뜻까지 잡는 문장 임베딩 모델(예: 다국어 sentence-transformers)로 바꾸려면 embed()만 교체하고
cases.embedding 을 다시 계산하면 된다 (ai_server/seed.py --reembed).
"""
from __future__ import annotations

import hashlib
import math
import re

DIM = 512


def _tokens(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text.lower()).strip()
    words = text.split(" ")
    toks = list(words)
    for w in words:
        w = f"^{w}$"
        for n in (2, 3):
            toks += [w[i:i + n] for i in range(len(w) - n + 1)]
    return toks


def embed(text: str) -> list[float]:
    v = [0.0] * DIM
    for tok in _tokens(text):
        h = int.from_bytes(hashlib.blake2b(tok.encode(), digest_size=8).digest(), "little")
        v[h % DIM] += 1.0 if (h >> 63) & 1 else -1.0
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def to_pg(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.5f}" for x in v) + "]"
