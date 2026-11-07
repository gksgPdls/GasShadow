"""규칙층: 법정 기준·경계 구간·입력 허용 범위.

모델과 분리된 결정 규칙이다. 현재 측정값이 법정 기준을 넘으면 모델 예측과 무관하게
'법정 기준 초과'로 처리하며, 모델 출력이 이를 해제하거나 낮추지 못한다.
"""
from __future__ import annotations

import math
from typing import Mapping

GASES = ["O2", "LEL", "CO", "H2S", "CO2"]
GAS_COL = {"O2": "o2_pct", "LEL": "lel_pct", "CO": "co_ppm", "H2S": "h2s_ppm", "CO2": "co2_pct"}
GAS_COLS = [GAS_COL[g] for g in GASES]

# 법정 기준 (산업안전보건기준에 관한 규칙 제618조 / KOSHA H-80-2021)
THRESHOLDS = {
    "O2_LOW": 18.0,     # O2 < 18 %
    "O2_HIGH": 23.5,    # O2 >= 23.5 %
    "LEL": 10.0,        # >= 10 %LEL
    "CO": 30.0,         # >= 30 ppm
    "H2S": 10.0,        # >= 10 ppm
    "CO2": 1.5,         # >= 1.5 %
}
# 경계 접근 범위 (기준까지 남은 거리가 이 값 이내면 APPROACH)
APPROACH_BAND = {"O2": 0.5, "LEL": 2.0, "CO": 6.0, "H2S": 2.0, "CO2": 0.3}

# 입력 허용 범위 (측정기 표시 범위를 넘는 값은 입력 오류로 간주)
PLAUSIBLE_RANGE = {
    "o2_pct": (0.0, 30.0),
    "lel_pct": (0.0, 100.0),
    "co_ppm": (0.0, 2000.0),
    "h2s_ppm": (0.0, 500.0),
    "co2_pct": (0.0, 10.0),
}

QUALITY_OK = "OK"
QUALITY_VALUES = ("OK", "MISSING", "COMM_LOSS", "SENSOR_ERROR")


def _is_nan(v) -> bool:
    try:
        return v is None or math.isnan(float(v))
    except (TypeError, ValueError):
        return True


def exceeded_gases(values: Mapping[str, float]) -> list[str]:
    """현재 측정값에서 법정 기준을 넘은 가스 목록. 결측 가스는 판단하지 않는다."""
    out = []
    o2 = values.get("o2_pct")
    if not _is_nan(o2) and (float(o2) < THRESHOLDS["O2_LOW"] or float(o2) >= THRESHOLDS["O2_HIGH"]):
        out.append("O2")
    for g in ("LEL", "CO", "H2S", "CO2"):
        v = values.get(GAS_COL[g])
        if not _is_nan(v) and float(v) >= THRESHOLDS[g]:
            out.append(g)
    return out


def distance_to_threshold(gas: str, value: float) -> float:
    """기준까지 남은 거리(양수면 아직 기준 안쪽, 0 이하면 초과). O2는 양쪽 기준 중 가까운 쪽."""
    if gas == "O2":
        return min(value - THRESHOLDS["O2_LOW"], THRESHOLDS["O2_HIGH"] - value)
    return THRESHOLDS[gas] - value


def legal_state(values: Mapping[str, float]) -> str:
    """NORMAL / APPROACH / EXCEEDED / UNAVAILABLE (5가스 중 하나라도 결측이면 UNAVAILABLE)."""
    if any(_is_nan(values.get(c)) for c in GAS_COLS):
        return "UNAVAILABLE"
    if exceeded_gases(values):
        return "EXCEEDED"
    if in_approach_band(values):
        return "APPROACH"
    return "NORMAL"


def in_approach_band(values: Mapping[str, float]) -> bool:
    """데이터 생성기와 같은 정의: 상한 기준은 thr-band ≤ v < thr, O2 하한은 18 ≤ v < 18.5, O2 상한은 23.0 ≤ v < 23.5."""
    o2 = float(values["o2_pct"]); b = APPROACH_BAND["O2"]
    if (THRESHOLDS["O2_LOW"] <= o2 < THRESHOLDS["O2_LOW"] + b) or (THRESHOLDS["O2_HIGH"] - b <= o2 < THRESHOLDS["O2_HIGH"]):
        return True
    for g in ("LEL", "CO", "H2S", "CO2"):
        v = float(values[GAS_COL[g]])
        if THRESHOLDS[g] - APPROACH_BAND[g] <= v < THRESHOLDS[g]:
            return True
    return False


def out_of_range(values: Mapping[str, float]) -> list[str]:
    """허용 범위를 크게 벗어난 가스 컬럼 목록."""
    bad = []
    for c, (lo, hi) in PLAUSIBLE_RANGE.items():
        v = values.get(c)
        if _is_nan(v):
            continue
        if float(v) < lo or float(v) > hi:
            bad.append(c)
    return bad


def evaluate_rules(latest: Mapping[str, object]) -> dict:
    """규칙층 판정. 최신 행 하나(dict 또는 Series)를 받아 모델과 독립적인 결과를 돌려준다.

    반환 예: {"legal_exceeded": True, "exceeded_gases": ["CO"], "legal_state": "EXCEEDED",
             "quality_flag": "OK", "gas_missing": False, "out_of_range": []}
    """
    q = str(latest.get("quality_flag", ""))
    vals = {c: latest.get(c) for c in GAS_COLS}
    missing = any(_is_nan(v) for v in vals.values())
    exc = exceeded_gases(vals) if (q == QUALITY_OK and not missing) else []
    return {
        "legal_exceeded": bool(exc),
        "exceeded_gases": exc,
        "legal_state": legal_state(vals) if q == QUALITY_OK else "UNAVAILABLE",
        "quality_flag": q,
        "gas_missing": missing,
        "out_of_range": out_of_range(vals),
    }
