"""추론: 스키마, 값 범위, 저장 모델 재로딩 동일성, 학습 경로와 추론 경로의 특성 일치, 모듈 함수."""
import json

import numpy as np
import pandas as pd

from src import inference
from src.features import FEATURE_NAMES, compute_feature_frame
from src.inference import OUTPUT_FIELDS, GasRiskPredictor, explain_values
from tests.conftest import window_at


def _check_schema(r: dict):
    assert list(r.keys()) == OUTPUT_FIELDS
    assert r["prediction_status"] in ("PREDICTED", "UNAVAILABLE")
    json.dumps(r)   # JSON 직렬화 가능


def test_predicted_output_schema_and_ranges(predictor, risk_episode):
    ex = int(np.where(risk_episode.legal_state.to_numpy() == "EXCEEDED")[0][0])
    r = predictor.predict_window(window_at(risk_episode, ex - 40))
    _check_schema(r)
    assert r["prediction_status"] == "PREDICTED"
    assert r["forecast_state"] in ("STABLE", "WATCH", "IMMINENT")
    assert r["predicted_threshold_gas"] in ("O2", "LEL", "CO", "H2S", "CO2", "NONE")
    assert 0.0 <= r["risk_probability_30m"] <= 1.0
    if r["predicted_minutes_to_threshold"] is not None:
        assert 0.0 <= r["predicted_minutes_to_threshold"] <= 60.0


def test_reloaded_model_gives_identical_result(predictor, risk_episode, normal_episode):
    other = GasRiskPredictor()
    for ep, row in ((risk_episode, 150), (normal_episode, 199)):
        w = window_at(ep, row)
        assert predictor.predict_window(w) == other.predict_window(w)


def test_module_level_predict_window(risk_episode):
    r = inference.predict_window(window_at(risk_episode, 120))
    _check_schema(r)


def test_training_path_and_inference_path_features_match(risk_episode):
    full = compute_feature_frame(risk_episode)
    for row in (60, 159, 200, 250):
        a = full.iloc[row][FEATURE_NAMES].to_numpy(float)
        b = inference.features_for_window(window_at(risk_episode, row))[FEATURE_NAMES].to_numpy(float)
        np.testing.assert_allclose(a, b, rtol=1e-9, atol=1e-9)


def test_batch_and_single_paths_agree(predictor, risk_episode):
    full = compute_feature_frame(risk_episode)
    ex = int(np.where(risk_episode.legal_state.to_numpy() == "EXCEEDED")[0][0])
    rows = [ex - 70, ex - 40, ex - 10]
    batch = predictor.predict_features(full.iloc[rows][FEATURE_NAMES].astype(float))
    for k, row in enumerate(rows):
        single = predictor.predict_window(window_at(risk_episode, row))
        assert single["forecast_state"] == batch.iloc[k]["forecast_state"]
        assert single["predicted_threshold_gas"] == batch.iloc[k]["predicted_threshold_gas"]
        assert abs(single["risk_probability_30m"] - batch.iloc[k]["risk_probability_30m"]) < 1e-9


def test_explain_values_not_in_output(predictor, risk_episode):
    ex = int(np.where(risk_episode.legal_state.to_numpy() == "EXCEEDED")[0][0])
    w = window_at(risk_episode, ex - 20)
    r = predictor.predict_window(w)
    e = explain_values(w, r)
    assert list(r.keys()) == OUTPUT_FIELDS
    if r["predicted_threshold_gas"] != "NONE":
        assert e is not None and set(e) == {"gas", "current_value", "slope_10m_per_min", "threshold", "distance_to_threshold", "predicted_minutes_to_threshold", "task_type"}
    else:
        assert e is None


def test_input_validation(predictor, risk_episode):
    w = window_at(risk_episode, 120)
    assert predictor.predict_window(w.drop(columns=["co_ppm"]))["prediction_status"] == "UNAVAILABLE"
    assert predictor.predict_window(w.iloc[::-1])["prediction_status"] == "UNAVAILABLE"          # 역순
    assert predictor.predict_window(pd.DataFrame(columns=w.columns))["prediction_status"] == "UNAVAILABLE"
    bad = w.copy(); bad.loc[bad.index[-1], "co_ppm"] = 5000.0                                     # 허용 범위 밖
    assert predictor.predict_window(bad)["prediction_status"] == "UNAVAILABLE"
    assert predictor.predict_window(w, now=w["timestamp"].iloc[-1] + pd.Timedelta(hours=1))["prediction_status"] == "UNAVAILABLE"  # 최신 데이터가 오래됨
