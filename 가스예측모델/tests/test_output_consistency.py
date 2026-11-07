"""출력 정합성: STABLE/WATCH/IMMINENT와 시간·가스의 관계, UNAVAILABLE의 null, JSON 필드, 안정화 후처리."""
import json

import numpy as np
import pandas as pd

from src.inference import OUTPUT_FIELDS, combine_outputs, unavailable
from src.stabilization import StateStabilizer


def _assert_consistent(df: pd.DataFrame):
    for _, r in df.iterrows():
        s, g, t = r["forecast_state"], r["predicted_threshold_gas"], r["predicted_minutes_to_threshold"]
        assert r["prediction_status"] == "PREDICTED"
        assert 0 <= r["risk_probability_30m"] <= 1
        if s == "STABLE":
            assert g == "NONE" and pd.isna(t)
        elif s == "WATCH":
            assert g in ("O2", "LEL", "CO", "H2S", "CO2") and 30 < t <= 60
        elif s == "IMMINENT":
            assert g in ("O2", "LEL", "CO", "H2S", "CO2") and 0 <= t <= 30
        else:
            raise AssertionError(s)


def test_combine_outputs_random_inputs():
    rng = np.random.default_rng(1)
    n = 5000
    p30, p60 = rng.random(n), rng.random(n)
    gas = rng.choice(["O2", "LEL", "CO", "H2S", "CO2"], n)
    mtt = rng.uniform(-10, 90, n)       # 범위 밖 값도 넣어 본다
    out = combine_outputs(p30, p60, gas, mtt, thr30=0.4, thr60=0.3)
    _assert_consistent(out)
    # 규칙: p30>=thr30 → IMMINENT, 둘 다 낮고 → STABLE
    assert (out.loc[p30 >= 0.4, "forecast_state"] == "IMMINENT").all()
    assert (out.loc[(p30 < 0.4) & (p60 < 0.3), "forecast_state"] == "STABLE").all()
    # 60분 위험이지만 회귀가 30분 이하 → IMMINENT, 30 초과 → WATCH
    m = (p30 < 0.4) & (p60 >= 0.3)
    assert (out.loc[m & (mtt <= 30), "forecast_state"] == "IMMINENT").all()
    assert (out.loc[m & (mtt > 30), "forecast_state"] == "WATCH").all()


def test_test_predictions_file_consistent():
    import pathlib
    p = pathlib.Path(__file__).resolve().parent.parent / "reports" / "test_predictions.csv"
    df = pd.read_csv(p)
    _assert_consistent(df[["prediction_status", "forecast_state", "predicted_threshold_gas", "predicted_minutes_to_threshold", "risk_probability_30m"]])


def test_unavailable_all_null():
    u = unavailable()
    assert list(u.keys()) == OUTPUT_FIELDS
    assert u["prediction_status"] == "UNAVAILABLE"
    assert all(u[k] is None for k in OUTPUT_FIELDS[1:])
    assert json.loads(json.dumps(u)) == u


def test_json_schema_exact_fields(predictor, risk_episode):
    from tests.conftest import window_at
    r = predictor.predict_window(window_at(risk_episode, 150))
    assert list(r.keys()) == ["prediction_status", "forecast_state", "predicted_threshold_gas", "predicted_minutes_to_threshold", "risk_probability_30m"]


def _res(state, gas="CO", t=20.0, p=0.7):
    if state == "STABLE":
        return {"prediction_status": "PREDICTED", "forecast_state": "STABLE", "predicted_threshold_gas": "NONE", "predicted_minutes_to_threshold": None, "risk_probability_30m": p}
    return {"prediction_status": "PREDICTED", "forecast_state": state, "predicted_threshold_gas": gas, "predicted_minutes_to_threshold": t, "risk_probability_30m": p}


def test_stabilizer_requires_consecutive_confirmation():
    st = StateStabilizer(n_confirm=2)
    assert st.update(_res("STABLE"))["forecast_state"] == "STABLE"
    assert st.update(_res("IMMINENT"))["forecast_state"] == "STABLE"      # 1회: 유지
    assert st.update(_res("IMMINENT"))["forecast_state"] == "IMMINENT"    # 2회 연속: 전환
    assert st.update(_res("STABLE"))["forecast_state"] == "IMMINENT"      # 복귀도 연속 확인
    assert st.update(_res("WATCH"))["forecast_state"] == "IMMINENT"       # 다른 상태가 끼면 카운터 초기화
    assert st.update(_res("STABLE"))["forecast_state"] == "IMMINENT"
    assert st.update(_res("STABLE"))["forecast_state"] == "STABLE"
    # 유지 중에도 확률은 최신값
    st.update(_res("IMMINENT", p=0.9))
    held = st.update(_res("IMMINENT", p=0.95))
    assert held["forecast_state"] == "IMMINENT"


def test_stabilizer_passes_unavailable_and_rule_alarm():
    st = StateStabilizer(n_confirm=3)
    st.update(_res("IMMINENT")); st.update(_res("IMMINENT")); st.update(_res("IMMINENT"))
    assert st.update(unavailable()) == unavailable()                        # 예측 불가를 이전 상태로 메우지 않음
    assert st.update(_res("STABLE"), legal_exceeded=True) == unavailable()  # 규칙 경보 경로: 모델 결과 무시
    out = st.update(_res("WATCH"))
    assert out["forecast_state"] == "WATCH"                                 # 초기화 후 첫 결과는 바로 공개
    assert list(out.keys()) == OUTPUT_FIELDS
