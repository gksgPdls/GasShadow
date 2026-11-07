"""【AI ①】 5가스 위험예측 — 가스예측모델/ 의 학습된 scikit-learn 모델을 그대로 불러 쓴다.

센서는 10초마다 오지만 모델은 15초 간격으로 학습됐다 → 15초 격자로 선형 보간해서 넣는다.
모델은 '앞으로 60분 안에 어떤 가스가 언제 기준을 넘을지'만 말한다. 지금 초과 여부는 규칙층(메인 서버)이 판정한다.
"""
from __future__ import annotations

import importlib.util
import sys

import numpy as np
import pandas as pd

from ..common.config import MODEL_DIR

GAS_TO_COL = {"O2": "o2_pct", "LEL": "lel_pct", "CO": "co_ppm", "H2S": "h2s_ppm", "CO2": "co2_pct"}
DAY0 = pd.Timestamp("2026-10-30")  # 시연 날짜 (시각 자체는 모델 특성이 아니다)


def _load_model_package():
    # 가스예측모델/src 는 패키지 이름이 'src'라서 저장소의 src 와 겹친다 → 'gasmodel' 이라는 이름으로 불러온다
    if "gasmodel" in sys.modules:
        return sys.modules["gasmodel"]
    pkg_dir = MODEL_DIR / "src"
    spec = importlib.util.spec_from_file_location("gasmodel", pkg_dir / "__init__.py",
                                                  submodule_search_locations=[str(pkg_dir)])
    mod = importlib.util.module_from_spec(spec)
    sys.modules["gasmodel"] = mod
    spec.loader.exec_module(mod)
    return mod


class Predictor:
    def __init__(self):
        _load_model_package()
        from gasmodel.inference import GasRiskPredictor  # type: ignore
        from gasmodel.stabilization import StateStabilizer  # type: ignore
        self.model = GasRiskPredictor(MODEL_DIR / "artifacts")
        # 모델 README 7절의 후처리: 같은 상태가 2번 연속일 때만 바꾼다 (한 번 튀는 예측을 화면에 내지 않는다)
        self._Stabilizer = StateStabilizer
        self.stabilizers: dict[str, object] = {}
        self.last_t = float("-inf")

    def predict_batch(self, t: float, zones: list[tuple[str, str, str, list[dict]]]) -> dict[str, dict]:
        """(구역, 작업 종류, 작업 상태, 최근 40분 샘플) 여러 개 → 구역별 안정화된 예측. 시각이 뒤로 가면 새 시연으로 보고 초기화"""
        if t < self.last_t:
            self.stabilizers = {}
        self.last_t = t
        out = {}
        for zone_id, task_type, task_state, samples in zones:
            try:
                raw = self.predict_zone(task_type, task_state, samples)
            except Exception:  # 한 구역 실패가 전체를 막지 않게
                raw = self._unavailable("error")
            st = self.stabilizers.setdefault(zone_id, self._Stabilizer(n_confirm=2))
            out[zone_id] = st.update(raw)
        return out

    def predict_zone(self, task_type: str, task_state: str, samples: list[dict]) -> dict:
        if len(samples) < 2:
            return self._unavailable("samples")
        t = np.array([s["t"] for s in samples], dtype=float)
        grid = np.arange(t[-1], t[0] - 1e-9, -0.25)[::-1]  # 15초 = 0.25분, 최신 시각에 맞춘 격자
        df = pd.DataFrame({"timestamp": DAY0 + pd.to_timedelta(grid, unit="m")})
        for g, col in GAS_TO_COL.items():
            df[col] = np.interp(grid, t, [s[g] for s in samples])
        df["task_type"] = task_type
        df["task_state"] = task_state
        df["quality_flag"] = "OK"
        out = self.model.predict_window(df)
        return out

    @staticmethod
    def _unavailable(_: str) -> dict:
        return {"prediction_status": "UNAVAILABLE", "forecast_state": None, "predicted_threshold_gas": None,
                "predicted_minutes_to_threshold": None, "risk_probability_30m": None}
