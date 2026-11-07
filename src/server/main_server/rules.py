"""규칙 판정 (AI 아님). 화면의 src/dashboard/src/lib/sim.ts assess()와 같은 규칙을 서버로 옮겼다.

기준값은 sim.ts의 LIMITS와 같다. 와이어프레임 ZN-01 표기이며 법정 기준 원문 재확인 전(미검증), LEL 10%는 사내 가정.
"""
from __future__ import annotations

GASES = ["O2", "LEL", "CO", "H2S", "CO2"]
LIMITS = {
    "O2": {"unit": "%", "legalLow": 18.0, "legalHigh": 23.5, "warnLow": 19.5},
    "LEL": {"unit": "%LEL", "legal": 10, "warn": 5},
    "CO": {"unit": "ppm", "legal": 30, "warn": 20},
    "H2S": {"unit": "ppm", "legal": 10, "warn": 5},
    "CO2": {"unit": "%", "legal": 1.5, "warn": 1.0},
}
MISSING_AFTER_MIN = 2  # 이 시간 동안 수신이 없으면 결측
# 무허가 작업 의심 (도둑작업): 오늘 허가가 없는 구역에서 아래 값을 넘으면 "누가 안에서 작업 중"으로 본다.
# 평상시 값(O2 20.9 · LEL 0.3 · CO 2 · H2S 0.1 · CO2 0.06)과 센서 흔들림보다 확실히 큰 값으로 잡은 팀 가정 (근거 없음)
UNAUTH = {"LEL": 3.0, "CO": 8.0, "H2S": 2.0, "CO2": 0.3}
UNAUTH_O2_LOW = 20.0


def severity(g: str, v: float) -> float:
    """0 미만 = 정상, 0~1 = 경계 구간, 1 이상 = 법정 초과"""
    L = LIMITS[g]
    if g == "O2":
        if v >= L["legalHigh"]:
            return 1.0
        return (L["warnLow"] - v) / (L["warnLow"] - L["legalLow"])
    return (v - L["warn"]) / (L["legal"] - L["warn"])


def eta_to_legal(g: str, v: float, s: float) -> float | None:
    """현재 기울기가 유지되면 법정 기준까지 몇 분 남았는지 (단순 직선 연장 — AI 예측과 별개)"""
    L = LIMITS[g]
    eta = None
    if g == "O2" and s < -0.005:
        eta = (v - L["legalLow"]) / -s
    elif g != "O2" and s > 0.005:
        eta = (L["legal"] - v) / s
    return eta if eta is not None and 0 < eta < 180 else None


def slope(history: list[tuple[float, dict]], g: str, now: float) -> float:
    """최근 10분 선형 회귀 기울기(분당)"""
    pts = [(t, v[g]) for t, v in history if t >= now - 10]
    if len(pts) < 6:
        return 0.0
    n = len(pts)
    mx = sum(t for t, _ in pts) / n
    my = sum(y for _, y in pts) / n
    num = sum((t - mx) * (y - my) for t, y in pts)
    den = sum((t - mx) ** 2 for t, _ in pts)
    return num / den if den else 0.0


def unauth_gas(cur: dict) -> tuple[str, float] | None:
    """허가 없는 구역에서 작업 흔적으로 볼 가스 (평상시보다 가장 많이 벗어난 것). 없으면 None"""
    best = None
    for g, lim in UNAUTH.items():
        if cur[g] >= lim and (best is None or cur[g] / lim > best[1]):
            best = (g, cur[g] / lim)
    if cur["O2"] <= UNAUTH_O2_LOW and best is None:
        best = ("O2", 1.0)
    return (best[0], cur[best[0]]) if best else None


def assess(history: list[tuple[float, dict]], last_recv: float | None, lost_since: float | None,
           has_permit: bool, now: float, measure_from: float | None = None) -> dict:
    """구역 하나의 지금 상태: legal(법정 초과) · unauth(무허가 작업 의심) · missing(결측) · warn(경계) · ok · idle(작업 없음 · 측정 전)"""
    if last_recv is None and measure_from is not None and now < measure_from + MISSING_AFTER_MIN:
        # 측정기를 아직 붙이지 않은 구역 (작업 전). 결측이 아니다. 값은 화면 자리를 채우는 평상시 공기
        return {"status": "idle", "gas": "O2", "score": -1.0, "value": 20.9, "slope": 0.0, "eta": None, "pending": True}
    if last_recv is None or now - last_recv > MISSING_AFTER_MIN:
        since = lost_since if lost_since is not None else (last_recv if last_recv is not None else now)
        return {"status": "missing", "score": 0, "lostMin": max(0, round(now - since))}
    cur = history[-1][1]
    worst_g, worst_s = GASES[0], float("-inf")
    for g in GASES:
        sc = severity(g, cur[g])
        if sc > worst_s:
            worst_g, worst_s = g, sc
    status = "legal" if worst_s >= 1 else "warn" if worst_s >= 0 else "ok"
    unauth = None if has_permit else unauth_gas(cur)
    if unauth and status != "legal":
        status, worst_g = "unauth", unauth[0]
        worst_s = max(worst_s, severity(worst_g, cur[worst_g]))
    if status == "ok" and not has_permit:
        status = "idle"
    s = slope(history, worst_g, now)
    return {"status": status, "gas": worst_g, "score": worst_s, "value": cur[worst_g], "slope": s,
            "eta": eta_to_legal(worst_g, cur[worst_g], s), "unauth": bool(unauth)}
