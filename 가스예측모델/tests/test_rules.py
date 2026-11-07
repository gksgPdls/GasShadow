"""규칙층: 법정 기준 감지, 모델이 규칙 결과를 해제·완화하지 못함."""
import numpy as np

from src.inference import OUTPUT_FIELDS, unavailable
from src.rules import evaluate_rules, exceeded_gases, legal_state
from tests.conftest import window_at

BASE = {"o2_pct": 20.9, "lel_pct": 0.0, "co_ppm": 1.0, "h2s_ppm": 0.1, "co2_pct": 0.05}


def test_each_threshold_detected():
    assert exceeded_gases(BASE) == []
    assert exceeded_gases({**BASE, "o2_pct": 17.9}) == ["O2"]
    assert exceeded_gases({**BASE, "o2_pct": 23.5}) == ["O2"]
    assert exceeded_gases({**BASE, "o2_pct": 23.4}) == []
    assert exceeded_gases({**BASE, "lel_pct": 10.0}) == ["LEL"]
    assert exceeded_gases({**BASE, "co_ppm": 30.0}) == ["CO"]
    assert exceeded_gases({**BASE, "co_ppm": 29.0}) == []
    assert exceeded_gases({**BASE, "h2s_ppm": 10.0}) == ["H2S"]
    assert exceeded_gases({**BASE, "co2_pct": 1.5}) == ["CO2"]
    assert exceeded_gases({**BASE, "co_ppm": 50, "h2s_ppm": 12}) == ["CO", "H2S"]


def test_legal_state_bands():
    assert legal_state(BASE) == "NORMAL"
    assert legal_state({**BASE, "co_ppm": 24.0}) == "APPROACH"     # 30-6=24 이상 30 미만
    assert legal_state({**BASE, "co_ppm": 23.0}) == "NORMAL"
    assert legal_state({**BASE, "o2_pct": 18.3}) == "APPROACH"
    assert legal_state({**BASE, "o2_pct": 18.5}) == "NORMAL"
    assert legal_state({**BASE, "o2_pct": 23.0}) == "APPROACH"
    assert legal_state({**BASE, "co_ppm": 31.0}) == "EXCEEDED"
    assert legal_state({**BASE, "co_ppm": np.nan}) == "UNAVAILABLE"


def test_legal_state_matches_dataset(ts):
    sub = ts[ts.quality_flag == "OK"].sample(5000, random_state=0)
    calc = [legal_state(r) for r in sub[["o2_pct", "lel_pct", "co_ppm", "h2s_ppm", "co2_pct"]].to_dict("records")]
    assert (np.array(calc) == sub["legal_state"].to_numpy()).all()


def test_evaluate_rules_ignores_bad_quality():
    r = evaluate_rules({**BASE, "co_ppm": 500.0, "quality_flag": "SENSOR_ERROR"})
    assert r["legal_exceeded"] is False and r["legal_state"] == "UNAVAILABLE"
    r = evaluate_rules({**BASE, "co_ppm": 500.0, "quality_flag": "OK"})
    assert r["legal_exceeded"] is True and r["exceeded_gases"] == ["CO"]


def test_rule_layer_detects_current_exceed_and_model_cannot_override(predictor, risk_episode):
    ep = risk_episode
    ex = int(np.where(ep.legal_state.to_numpy() == "EXCEEDED")[0][0])
    w = window_at(ep, ex)
    res = predictor.assess(w)
    assert res["rule"]["legal_exceeded"] is True
    assert len(res["rule"]["exceeded_gases"]) >= 1
    assert res["model"] == unavailable()               # 모델은 호출되지 않음(UNAVAILABLE)
    assert predictor.predict_window(w)["prediction_status"] == "UNAVAILABLE"
    # 초과 직전 윈도우: 규칙층은 초과 아님, 모델은 예측
    w2 = window_at(ep, ex - 1)
    res2 = predictor.assess(w2)
    assert res2["rule"]["legal_exceeded"] is False
    assert set(res2["model"].keys()) == set(OUTPUT_FIELDS)


def test_model_output_never_lowers_rule_alarm(predictor, risk_episode):
    """규칙층 판정은 모델 결과와 무관하게 유지된다: 같은 입력에서 규칙 결과는 모델 호출 전후 동일."""
    ep = risk_episode
    ex = int(np.where(ep.legal_state.to_numpy() == "EXCEEDED")[0][0])
    w = window_at(ep, ex)
    before = evaluate_rules(w.iloc[-1].to_dict())
    _ = predictor.predict_window(w)
    after = evaluate_rules(w.iloc[-1].to_dict())
    assert before == after and after["legal_exceeded"] is True
