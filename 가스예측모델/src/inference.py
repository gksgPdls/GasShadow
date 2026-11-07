"""추론: 저장된 모델을 불러와 최근 시계열 하나(또는 특성 배치)에서 최종 5개 출력을 만든다.

result = predict_window(recent_data)

recent_data: 하나의 센서·작업 구역에서 시간순으로 정렬된 최근 최대 40분 DataFrame.
             필수 컬럼: timestamp, task_type, task_state, o2_pct, lel_pct, co_ppm, h2s_ppm, co2_pct, quality_flag
반환: {"prediction_status", "forecast_state", "predicted_threshold_gas", "predicted_minutes_to_threshold", "risk_probability_30m"}

현재 법정 기준 초과는 규칙층(rules.evaluate_rules)이 담당한다. assess()는 규칙 결과와 모델 결과를 함께 돌려주며,
모델 결과는 규칙 결과를 바꾸지 못한다.
"""
from __future__ import annotations

import json
import pathlib

import joblib
import numpy as np
import pandas as pd

from .features import (FEATURE_NAMES, MIN_VALID_RATIO, MIN_VALID_ROWS, SAMPLE_INTERVAL_S, WINDOW_ROWS,
                       features_for_window)
from .rules import GASES, GAS_COL, GAS_COLS, THRESHOLDS, evaluate_rules

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT / "artifacts"
OUTPUT_FIELDS = ["prediction_status", "forecast_state", "predicted_threshold_gas",
                 "predicted_minutes_to_threshold", "risk_probability_30m"]
REQUIRED_COLUMNS = ["timestamp", "task_type", "task_state", "o2_pct", "lel_pct", "co_ppm", "h2s_ppm", "co2_pct", "quality_flag"]
HORIZON_MIN = 60.0
IMMINENT_MIN = 30.0


def unavailable() -> dict:
    return {"prediction_status": "UNAVAILABLE", "forecast_state": None, "predicted_threshold_gas": None,
            "predicted_minutes_to_threshold": None, "risk_probability_30m": None}


def combine_outputs(p30: np.ndarray, p60: np.ndarray, gas_pred: np.ndarray, mtt_pred: np.ndarray,
                    thr30: float, thr60: float) -> pd.DataFrame:
    """내부 모델 결과 → 최종 출력(배치). 모순 보정 규칙:

    1. risk60 = (p60 >= thr60) or (p30 >= thr30)   # 30분 위험이면 60분 위험도 참
    2. risk60이 아니면 STABLE, 가스 NONE, 시간 null.
    3. risk60이면 가스 = 가스 모델 예측, 시간 = 회귀 예측을 [0, 60]으로 자른 값.
    4. p30 >= thr30 이면 IMMINENT이고 시간은 30 이하로 자른다.
       p30 < thr30 이어도 회귀 시간이 30 이하이면 IMMINENT(시간 우선).
       그 외 WATCH이고 시간은 (30, 60] 범위로 보정한다(30 이하로 나오면 30.1).
    5. risk_probability_30m은 항상 p30.
    """
    n = len(p30)
    risk30 = p30 >= thr30
    risk60 = (p60 >= thr60) | risk30
    mtt = np.clip(np.asarray(mtt_pred, dtype=float), 0.0, HORIZON_MIN)
    state = np.where(~risk60, "STABLE", np.where(risk30 | (mtt <= IMMINENT_MIN), "IMMINENT", "WATCH"))
    t = mtt.copy()
    t = np.where(state == "IMMINENT", np.minimum(t, IMMINENT_MIN), t)
    t = np.where(state == "WATCH", np.maximum(t, IMMINENT_MIN + 0.1), t)
    gas = np.where(state == "STABLE", "NONE", gas_pred)
    out = pd.DataFrame({
        "prediction_status": ["PREDICTED"] * n,
        "forecast_state": state,
        "predicted_threshold_gas": gas,
        "predicted_minutes_to_threshold": np.where(state == "STABLE", np.nan, np.round(t, 1)),
        "risk_probability_30m": np.round(np.asarray(p30, dtype=float), 4),
    })
    return out


class GasRiskPredictor:
    """저장된 모델 묶음. 외부에서는 predict_window() 하나로 호출한다."""

    def __init__(self, artifacts_dir: str | pathlib.Path = ARTIFACTS):
        d = pathlib.Path(artifacts_dir)
        with open(d / "model_config.json", encoding="utf-8") as f:
            self.config = json.load(f)
        self.feature_names = self.config["feature_names"]
        assert self.feature_names == FEATURE_NAMES, "저장된 특성 목록이 코드와 다름"
        self.thr30 = float(self.config["threshold_30m"])
        self.thr60 = float(self.config["threshold_60m"])
        self.gas_classes = self.config["gas_classes"]
        m = d / "models"
        self.m60 = joblib.load(m / "risk60_classifier.joblib")
        self.m30 = joblib.load(m / "risk30_classifier.joblib")
        self.mgas = joblib.load(m / "gas_classifier.joblib")
        self.mtime = joblib.load(m / "time_regressor.joblib")
        pre = d / "preprocessors"
        self.scalers, self.calibrators = {}, {}
        for k in ("risk60", "risk30", "gas", "time"):
            p = pre / f"{k}_scaler.joblib"
            self.scalers[k] = joblib.load(p) if p.exists() else None
        for k in ("risk60", "risk30"):
            p = pre / f"{k}_calibrator.joblib"
            self.calibrators[k] = joblib.load(p) if p.exists() else None

    def _proba(self, key: str, model, feats: pd.DataFrame) -> np.ndarray:
        p = model.predict_proba(self._X(feats, key))[:, 1]
        cal = self.calibrators.get(key)
        return np.clip(cal.predict(p), 0.0, 1.0) if cal is not None else p

    def _X(self, feats: pd.DataFrame, key: str) -> np.ndarray:
        X = feats[self.feature_names].to_numpy(dtype=float)
        s = self.scalers.get(key)
        return s.transform(X) if s is not None else X

    def predict_features(self, feats: pd.DataFrame, with_internals: bool = False) -> pd.DataFrame:
        """특성 배치 → 최종 출력 배치. (적격성 검사는 호출자가 수행)"""
        p60 = self._proba("risk60", self.m60, feats)
        p30 = self._proba("risk30", self.m30, feats)
        gas = self.mgas.predict(self._X(feats, "gas"))      # 문자열 라벨(O2/LEL/CO/H2S/CO2)
        mtt = self.mtime.predict(self._X(feats, "time"))
        out = combine_outputs(p30, p60, np.asarray(gas).astype(str), mtt, self.thr30, self.thr60)
        out.index = feats.index
        if with_internals:
            out["_p60"] = p60; out["_p30"] = p30; out["_gas_raw"] = np.asarray(gas).astype(str); out["_mtt_raw"] = mtt
        return out

    # ---- 단일 윈도우 추론 ----
    def check_window(self, recent: pd.DataFrame, now=None) -> tuple[str | None, pd.DataFrame | None]:
        """입력 검사. (문제 사유, 정리된 DataFrame). 사유가 None이면 예측 가능."""
        if recent is None or len(recent) == 0:
            return "empty", None
        missing_cols = [c for c in REQUIRED_COLUMNS if c not in recent.columns]
        if missing_cols:
            return f"missing_columns:{missing_cols}", None
        df = recent.copy()
        df["timestamp"] = pd.to_datetime(df["timestamp"])
        if not df["timestamp"].is_monotonic_increasing:
            return "not_sorted", None
        if df["timestamp"].duplicated().any():
            return "duplicate_timestamps", None
        df = df.iloc[-WINDOW_ROWS:].reset_index(drop=True)      # 40분 초과 과거는 버린다
        if now is not None:
            age = (pd.Timestamp(now) - df["timestamp"].iloc[-1]).total_seconds()
            if age > 2 * 60:
                return "latest_too_old", None
        span_rows = len(df)
        if span_rows < MIN_VALID_ROWS:
            return "less_than_10_minutes", None
        rule = evaluate_rules(df.iloc[-1].to_dict())
        if rule["quality_flag"] != "OK":
            return f"latest_quality_{rule['quality_flag']}", None
        if rule["gas_missing"]:
            return "latest_gas_missing", None
        if rule["out_of_range"]:
            return f"out_of_range:{rule['out_of_range']}", None
        if rule["legal_exceeded"]:
            return "legal_exceeded", None
        return None, df

    def predict_window(self, recent: pd.DataFrame, now=None) -> dict:
        reason, df = self.check_window(recent, now)
        if reason is not None:
            return unavailable()
        feat = features_for_window(df)
        if feat["_valid_count"] < MIN_VALID_ROWS or feat["valid_ratio"] < MIN_VALID_RATIO or feat["_is_valid_now"] <= 0:
            return unavailable()
        out = self.predict_features(feat[self.feature_names].to_frame().T.astype(float)).iloc[0]
        t = out["predicted_minutes_to_threshold"]
        return {
            "prediction_status": "PREDICTED",
            "forecast_state": str(out["forecast_state"]),
            "predicted_threshold_gas": str(out["predicted_threshold_gas"]),
            "predicted_minutes_to_threshold": None if pd.isna(t) else float(t),
            "risk_probability_30m": float(out["risk_probability_30m"]),
        }

    def assess(self, recent: pd.DataFrame, now=None) -> dict:
        """규칙층 + 모델. 규칙층이 법정 초과를 판정하면 모델은 호출하지 않는다."""
        rule = evaluate_rules(recent.iloc[-1].to_dict()) if len(recent) else {"legal_exceeded": False}
        if rule.get("legal_exceeded"):
            return {"rule": rule, "model": unavailable()}
        return {"rule": rule, "model": self.predict_window(recent, now)}


def explain_values(recent: pd.DataFrame, result: dict) -> dict | None:
    """설명 문구용 보조값(모델 출력에는 포함하지 않음)."""
    if result.get("prediction_status") != "PREDICTED" or result.get("predicted_threshold_gas") in (None, "NONE"):
        return None
    df = recent.copy()
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    feat = features_for_window(df.iloc[-WINDOW_ROWS:].reset_index(drop=True))
    g = result["predicted_threshold_gas"]
    c = GAS_COL[g]
    cur = float(feat[f"{c}_cur"])
    if g == "O2":
        thr = THRESHOLDS["O2_LOW"] if feat["o2_pct_dist_low"] <= feat["o2_pct_dist_high"] else THRESHOLDS["O2_HIGH"]
    else:
        thr = THRESHOLDS[g]
    return {
        "gas": g,
        "current_value": cur,
        "slope_10m_per_min": float(feat[f"{c}_slope_10m"]),
        "threshold": thr,
        "distance_to_threshold": float(feat[f"{c}_dist_thr"]),
        "predicted_minutes_to_threshold": result["predicted_minutes_to_threshold"],
        "task_type": str(df["task_type"].iloc[-1]),
    }


def load_predictor(artifacts_dir: str | pathlib.Path = ARTIFACTS) -> GasRiskPredictor:
    return GasRiskPredictor(artifacts_dir)


def predict_window(recent: pd.DataFrame, now=None) -> dict:
    """모듈 수준 편의 함수(모델은 첫 호출 때 한 번 로드)."""
    global _DEFAULT
    try:
        _DEFAULT
    except NameError:
        _DEFAULT = load_predictor()
    return _DEFAULT.predict_window(recent, now)


if __name__ == "__main__":
    import argparse, sys
    from .data_loader import load_timeseries
    ap = argparse.ArgumentParser(description="단일 시나리오 추론 예시")
    ap.add_argument("--scenario", default=None, help="scenario_id (기본: test 분할의 첫 위험 시나리오)")
    ap.add_argument("--row", type=int, default=None, help="기준 행 번호(기본: 첫 초과 20분 전)")
    a = ap.parse_args()
    ts = load_timeseries()
    if a.scenario is None:
        cand = ts[(ts.split == "test") & (ts.minutes_to_threshold > 0)]
        a.scenario = cand.scenario_id.iloc[0]
    ep = ts[ts.scenario_id == a.scenario].reset_index(drop=True)
    if a.row is None:
        ex = np.where(ep.legal_state.to_numpy() == "EXCEEDED")[0]
        a.row = int(ex[0] - 80) if len(ex) else len(ep) - 1
    recent = ep.loc[max(0, a.row - WINDOW_ROWS + 1):a.row, REQUIRED_COLUMNS]
    pred = load_predictor()
    res = pred.assess(recent)
    print(json.dumps({"scenario_id": a.scenario, "row": a.row, "true_minutes_to_threshold": None if pd.isna(ep.minutes_to_threshold[a.row]) else float(ep.minutes_to_threshold[a.row]),
                      "true_threshold_gas": ep.threshold_gas[a.row] or "NONE"}, ensure_ascii=False))
    print(json.dumps(res["rule"], ensure_ascii=False))
    print(json.dumps(res["model"], ensure_ascii=False))
    print(json.dumps(explain_values(recent, res["model"]), ensure_ascii=False))
