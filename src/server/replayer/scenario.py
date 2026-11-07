"""시연 시나리오 (SYNTHETIC). 블록·구획·값 지정은 site.json 하나에 있고 화면 scenario.ts 와 같이 읽는다.
에피소드 보간 방식은 scenario.ts 와 같다.
모든 수치는 미검증 가정값이다.

위험 구역 3곳(WBT No.3 (S) · 코퍼댐 CD-3 · 애프터피크 탱크)은 5가스 위험예측 모델의 시험 에피소드 값을 그대로 흘린다
(src/dashboard/src/data/episodes.json, scripts/export_episodes.py). 측정기는 작업 전 측정 때 붙인다고 보고,
measureFrom 전에는 값을 보내지 않는다. 나머지 구역은 평상시 값이다.
"""
from __future__ import annotations

import bisect
import json
import pathlib

SIM_START = 9 * 60  # 09:00 (자정 이후 분)
BASE = {"O2": 20.9, "LEL": 0.3, "CO": 2.0, "H2S": 0.1, "CO2": 0.06}
GASES = list(BASE)

_EP_FILE = pathlib.Path(__file__).resolve().parents[3] / "src" / "dashboard" / "src" / "data" / "episodes.json"
EPISODES: dict = json.loads(_EP_FILE.read_text(encoding="utf-8"))["episodes"]


def ramp(t: float, t0: float, rate: float) -> float:
    """t0 이후 분당 rate로 변화 (무허가 작업 의심 시연 곡선용)"""
    return max(0.0, t - t0) * rate


def _with(**kw):
    return {**BASE, **kw}


def episode_gas(sid: str):
    """시각(자정 이후 분) → 에피소드 값. 15초 간격 사이는 직선 보간, 끝난 뒤에는 마지막 값 유지"""
    ep = EPISODES[sid]
    ts = ep["t"]
    start = ep["measure_from"]

    def gas(t: float) -> dict:
        x = t - start
        if x <= ts[0]:
            return {g: ep[g][0] for g in GASES}
        if x >= ts[-1]:
            return {g: ep[g][-1] for g in GASES}
        j = bisect.bisect_right(ts, x)
        a = (x - ts[j - 1]) / (ts[j] - ts[j - 1])
        return {g: ep[g][j - 1] + (ep[g][j] - ep[g][j - 1]) * a for g in GASES}

    return gas


def _episode_zone(sid: str) -> dict:
    """에피소드 구역 공통 값: 측정 시작 · 작업 시작/끝 (자정 이후 분) · 모델 입력 작업"""
    ep = EPISODES[sid]
    return {"episode": sid, "task_type": ep["task_type"], "measureFrom": ep["measure_from"],
            "workStart": ep["measure_from"] + ep["work_start"], "workEnd": ep["measure_from"] + ep["work_end"],
            "gas": episode_gas(sid)}


# 블록·구획: scripts/build_site.py 가 만든 site.json (화면 scenario.ts 도 같은 파일을 읽는다).
# 블록 안을 칸막이로 나눈 구획 하나하나가 감시 구역이다 (구획마다 측정기 1대).
# task_type: 5가스 예측 모델 입력 (가스예측모델 features.py 의 원-핫 범주). 작업명 → 범주 대응은 가정
_SITE_FILE = pathlib.Path(__file__).resolve().parents[3] / "src" / "dashboard" / "src" / "data" / "site.json"
SITE: dict = json.loads(_SITE_FILE.read_text(encoding="utf-8"))


def _gas_fn(spec: dict | None):
    """값 지정: 숫자 = 고정값, {v, ramp: [[시작 분, 분당 변화]], min, max} = 기울기로 변함. 안 적은 가스는 평상시 값"""
    spec = spec or {}

    def gas(t: float) -> dict:
        out = dict(BASE)
        for g, sp in spec.items():
            if isinstance(sp, (int, float)):
                out[g] = float(sp)
                continue
            v = sp["v"] + sum(ramp(t, t0, r) for t0, r in sp.get("ramp", []))
            if "max" in sp:
                v = min(sp["max"], v)
            if "min" in sp:
                v = max(sp["min"], v)
            out[g] = v
        return out

    return gas


def _zone(z: dict) -> dict:
    out = {"id": z["id"], "block": z["block"], "name": z["name"], "sensor": z["sensor"], "permit": z["permit"],
           "task_type": z.get("task_type", "NONE")}
    if z.get("episode"):
        out.update(_episode_zone(z["episode"]))
    else:
        out["gas"] = _gas_fn(z.get("gas"))
    if z.get("sensorLostAt") is not None:
        out["sensorLostAt"] = z["sensorLostAt"]
    if z.get("vent"):
        out["vent"] = z["vent"]  # 송풍기 대수·1번 정지 시각 (메인 서버가 상황 설명에 쓴다)
    return out


ZONES = [_zone(z) for z in SITE["zones"]]


def zone_meta(z: dict) -> dict:
    """서버로 보내는 구역 정보 (곡선 함수는 빼고)"""
    return {k: v for k, v in z.items() if k != "gas"}
