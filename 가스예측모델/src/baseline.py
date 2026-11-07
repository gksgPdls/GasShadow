"""선형 추세 기준선.

각 가스의 최근 N분 기울기(단위/분)를 구하고, 기울기가 기준 방향이면
(기준까지 거리) / 기울기 로 예상 교차시간을 계산한다. 가장 빠른 가스를 고르고,
60분 안에 교차하지 않으면 NONE. 최종 모델과 같은 5개 출력 형식으로 변환한다.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .rules import GASES, GAS_COL, THRESHOLDS

HORIZON_MIN = 60.0


class LinearTrendBaseline:
    def __init__(self, slope_minutes: int = 10, min_slope: float = 1e-6):
        assert slope_minutes in (5, 10)
        self.slope_minutes = slope_minutes
        self.min_slope = min_slope

    def crossing_times(self, feat_row) -> dict[str, float]:
        """가스별 예상 교차시간(분). 교차하지 않으면 inf."""
        out = {}
        for g in GASES:
            c = GAS_COL[g]
            cur = float(feat_row[f"{c}_cur"])
            slope = float(feat_row[f"{c}_slope_{self.slope_minutes}m"])
            t = np.inf
            if g == "O2":
                if slope < -self.min_slope:
                    t = (cur - THRESHOLDS["O2_LOW"]) / (-slope)
                elif slope > self.min_slope:
                    t = (THRESHOLDS["O2_HIGH"] - cur) / slope
            else:
                if slope > self.min_slope:
                    t = (THRESHOLDS[g] - cur) / slope
            out[g] = max(t, 0.0) if np.isfinite(t) else np.inf
        return out

    def predict_row(self, feat_row) -> dict:
        ct = self.crossing_times(feat_row)
        g = min(ct, key=ct.get)
        t = ct[g]
        if not np.isfinite(t) or t > HORIZON_MIN:
            return {"prediction_status": "PREDICTED", "forecast_state": "STABLE", "predicted_threshold_gas": "NONE",
                    "predicted_minutes_to_threshold": None, "risk_probability_30m": self._prob(t)}
        t = float(min(max(t, 0.0), HORIZON_MIN))
        state = "IMMINENT" if t <= 30 else "WATCH"
        return {"prediction_status": "PREDICTED", "forecast_state": state, "predicted_threshold_gas": g,
                "predicted_minutes_to_threshold": round(t, 1), "risk_probability_30m": self._prob(t)}

    @staticmethod
    def _prob(t: float) -> float:
        """확률 대용값(기준선은 확률 모델이 아니므로 교차시간에 따른 고정 점수)."""
        if not np.isfinite(t):
            return 0.0
        if t <= 30:
            return 1.0
        if t <= 60:
            return float(0.5 * (60 - t) / 30)
        return 0.0

    def predict_frame(self, feats: pd.DataFrame) -> pd.DataFrame:
        rows = [self.predict_row(r) for _, r in feats.iterrows()]
        return pd.DataFrame(rows, index=feats.index)
