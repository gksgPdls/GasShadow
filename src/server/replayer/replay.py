"""시연용 센서 재생기. 현장에서는 측정기 → MQTT(Mosquitto) → 수신기가 이 역할을 한다.

10초(시연 시각)마다 구역별 5가스 값을 만들어 메인 서버 /api/ingest 로 HTTP POST 한다.
메인 서버 응답의 control(재생·속도·처음부터·통신 장애)을 따라 움직인다 — 화면의 데모 바가 이걸 바꾼다.

  python -m src.server.replayer.replay            # 저장소 루트에서
"""
from __future__ import annotations

import argparse
import logging
import time
import uuid

import httpx

from ..common.config import MAIN_URL
from .scenario import SIM_START, ZONES, zone_meta

SAMPLE_SEC = 10
TICK_S = 0.5
GASES = ["O2", "LEL", "CO", "H2S", "CO2"]
NOISE = {"O2": 0.05, "LEL": 0.15, "CO": 0.5, "H2S": 0.05, "CO2": 0.01}
log = logging.getLogger("replayer")


def noise(zi: int, si: int, gi: int) -> float:
    """(구역, 시각, 가스)마다 같은 노이즈. sim.ts 의 noise()와 같은 방식 (JS 부동소수 곱셈 때문에 값이 똑같지는 않다)"""
    m = 0xFFFFFFFF
    x = ((zi * 73856093) ^ (si * 19349663) ^ (gi * 83492791)) & m
    x = ((x ^ (x >> 13)) * 1274126177) & m
    x = x ^ (x >> 16)
    return (x / 4294967295) * 2 - 1


def sample(si: int) -> list[dict]:
    ts = si * SAMPLE_SEC / 60
    out = []
    for zi, z in enumerate(ZONES):
        lost = z.get("sensorLostAt")
        if lost is not None and ts >= lost:
            continue  # 센서 통신 두절: 이 구역 값은 오지 않는다
        if z.get("measureFrom") is not None and ts < z["measureFrom"]:
            continue  # 측정기를 아직 붙이지 않았다 (작업 전 측정 때 붙인다)
        truth = z["gas"](ts)
        if z.get("episode"):  # 모델 시험 에피소드는 이미 측정 잡음이 들어 있어 그대로 보낸다
            out.append({"zone_id": z["id"], "t": ts, **{g: max(0.0, truth[g]) for g in GASES}})
            continue
        out.append({"zone_id": z["id"], "t": ts,
                    **{g: max(0.0, truth[g] + noise(zi, si, gi) * NOISE[g]) for gi, g in enumerate(GASES)}})
    return out


def start(c: httpx.Client, t0: float) -> tuple[str, int]:
    run_id = uuid.uuid4().hex[:8]
    c.post(f"{MAIN_URL}/api/run", json={"run_id": run_id, "t": t0, "zones": [zone_meta(z) for z in ZONES]}).raise_for_status()
    # 시작 전 40분 이력을 한 번에 채운다 (추세·예측이 바로 되게). 경보·AI 호출은 하지 않음
    si = int((t0 - 40) * 60 / SAMPLE_SEC)
    end = int(t0 * 60 / SAMPLE_SEC)
    batch: list[dict] = []
    while si <= end:
        batch += sample(si)
        si += 1
    c.post(f"{MAIN_URL}/api/ingest", json={"run_id": run_id, "t": t0, "readings": batch, "quiet": True}).raise_for_status()
    log.info("시연 시작 %s · %02d:%02d", run_id, int(t0 // 60), int(t0 % 60))
    return run_id, si


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", default=f"{SIM_START // 60:02d}{SIM_START % 60:02d}", help="시작 시각 HHMM")
    args = ap.parse_args()
    t0 = int(args.start[:2]) * 60 + int(args.start[2:])
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")

    control = {"playing": True, "speed": 10, "outage": False, "reset": 0}
    with httpx.Client(timeout=10) as c:
        while True:  # 메인 서버가 늦게 떠도 기다린다
            try:
                run_id, si = start(c, t0)
                control = c.get(f"{MAIN_URL}/api/state").json()["control"]
                break
            except httpx.HTTPError as e:
                log.info("메인 서버 대기 중… (%s)", e.__class__.__name__)
                time.sleep(2)
        reset_seen = control["reset"]
        t = t0
        while True:
            time.sleep(TICK_S)
            try:
                if control["reset"] != reset_seen:
                    reset_seen = control["reset"]
                    run_id, si = start(c, t0)
                    t = t0
                if control["playing"]:
                    t += control["speed"] * TICK_S / 60
                readings: list[dict] = []
                while si * SAMPLE_SEC <= t * 60:
                    if not control["outage"]:
                        readings += sample(si)
                    si += 1
                r = c.post(f"{MAIN_URL}/api/ingest", json={"run_id": run_id, "t": t, "readings": readings})
                if r.status_code == 409:  # 메인 서버가 재시작됨
                    run_id, si = start(c, t0)
                    t = t0
                    continue
                control = r.json()["control"]
            except httpx.HTTPError as e:
                log.warning("전송 실패: %s", e.__class__.__name__)


if __name__ == "__main__":
    main()
