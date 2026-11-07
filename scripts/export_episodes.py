"""관제 시연용 위험 구역 에피소드 뽑기 (SYNTHETIC).

5가스 위험예측 모델의 시험(test) 에피소드 중 3개를 골라, 재생기(src/server/replayer)와
화면(src/dashboard)이 같이 읽는 JSON으로 저장한다.

  .venv/bin/python scripts/export_episodes.py        # 저장소 루트에서

고른 기준 (2026-11-02 모델로 1분마다 예측해 확인):
- 작업 종류가 구역의 허가 작업과 같다 (화기 · 도장/세척)
- 법정 초과가 있고, AI가 경고하는 동안 예상 가스가 실제 초과 가스와 모두 같다
- 센서 결측 행이 없다
- 첫 경고(측정 10분 뒤)부터 법정 초과까지 서버와 같은 방식(10초 샘플 보간)으로 30초마다 예측해도 모두 IMMINENT다
  · 초과가 늦게 오는 에피소드(S0042 42분, S0943 30분)와 S0747은 중간에 STABLE로 돌아가서 뺐다
"""
from __future__ import annotations

import json
import pathlib

import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[1]
DATA = ROOT / "합성데이터_간소화" / "output"
OUT = ROOT / "src" / "dashboard" / "src" / "data" / "episodes.json"

# 에피소드 → (구역, 측정 시작 시각 '자정 이후 분'). 측정기는 작업 전 측정 때 붙인다
PICK = {
    "S0136": ("Z-D23-WBT3S", 8 * 60 + 52),  # 도장/세척 · LEL
    "S1153": ("Z-C41-CD3", 9 * 60 + 5),     # 화기 · CO
    "S0406": ("Z-A51-APT", 9 * 60 + 30),    # 화기 · CO
}
COLS = {"o2_pct": "O2", "lel_pct": "LEL", "co_ppm": "CO", "h2s_ppm": "H2S", "co2_pct": "CO2"}


def main():
    ts = pd.read_csv(DATA / "gas_timeseries.csv", parse_dates=["timestamp"])
    meta = pd.read_csv(DATA / "scenario_metadata.csv", parse_dates=["task_start", "task_end"]).set_index("scenario_id")
    out = {
        "note": "SYNTHETIC — 합성데이터_간소화 시험(test) 에피소드. scripts/export_episodes.py 로 만든다",
        "episodes": {},
    }
    for sid, (zone, measure_from) in PICK.items():
        ep = ts[ts["scenario_id"] == sid].sort_values("timestamp").reset_index(drop=True)
        assert (ep["quality_flag"] == "OK").all(), f"{sid}: 결측 행이 있다"
        t0 = ep["timestamp"].iloc[0]
        m = meta.loc[sid]
        rel = lambda x: round((x - t0).total_seconds() / 60, 2)  # noqa: E731
        exceed = ep.index[ep["legal_state"] == "EXCEEDED"]
        out["episodes"][sid] = {
            "zone": zone,
            "task_type": ep["task_type"].iloc[0],
            "measure_from": measure_from,
            # 아래 시각은 모두 측정 시작부터 잰 분
            "work_start": rel(m["task_start"]),
            "work_end": rel(m["task_end"]),
            "first_exceed": rel(ep["timestamp"].iloc[exceed[0]]) if len(exceed) else None,
            "t": [rel(x) for x in ep["timestamp"]],
            **{g: [round(float(v), 3) for v in ep[c]] for c, g in COLS.items()},
        }
        print(f"{sid} → {zone} 측정 {measure_from // 60:02d}:{measure_from % 60:02d}, "
              f"작업 시작 +{out['episodes'][sid]['work_start']}분, 첫 초과 +{out['episodes'][sid]['first_exceed']}분, {len(ep)}행")
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print("저장:", OUT.relative_to(ROOT), f"{OUT.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
