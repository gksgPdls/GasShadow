"""실행: pytest tests/  또는  python tests/run_tests.py"""
from __future__ import annotations

import pathlib
import sys
import tempfile

import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from generator.episodes import GASES, COL, Spec, generate_episode, label_episode  # noqa: E402
from generator.generate import COLUMNS, load_config, run  # noqa: E402
from generator.validate import run_checks  # noqa: E402


def _small_cfg():
    cfg = load_config(); cfg["random_seed"] = 99
    cfg["episodes"].update({"normal_per_task": 4, "mild_change": 6, "approach_per_gas": 6, "exceed_per_gas": 6, "recovery_in_work": 5,
                            "recovery_after_work": 5, "sensor_short_missing": 5, "sensor_comm_loss": 5, "sensor_error": 5,
                            "missing_before_danger": 5, "min_per_task": 4})
    return cfg


def test_columns_and_validation_small():
    cfg = _small_cfg()
    with tempfile.TemporaryDirectory() as d:
        ts, meta, specs = run(cfg, pathlib.Path(d), verbose=False)
        assert list(ts.columns) == COLUMNS
        ts2 = pd.read_csv(pathlib.Path(d) / "gas_timeseries.csv", dtype={"threshold_gas": str}); ts2["threshold_gas"] = ts2["threshold_gas"].fillna("")
        meta2 = pd.read_csv(pathlib.Path(d) / "scenario_metadata.csv", keep_default_na=False)
        cfg["episodes"]["min_per_task"] = 4
        C, stats = run_checks(cfg, ts2, meta2, repro_n=2)
        # 소규모 실행에서는 '가스별 ≥50' 항목만 수치상 실패할 수 있다
        failed = [r for r in C.rows if r["result"] == "FAIL" and "≥ 50" not in r["check"] and "≥10" not in r["check"]]
        assert not failed, failed


def test_same_seed_reproduces():
    cfg = _small_cfg()
    with tempfile.TemporaryDirectory() as d1, tempfile.TemporaryDirectory() as d2:
        a, _, _ = run(cfg, pathlib.Path(d1), verbose=False)
        b, _, _ = run(cfg, pathlib.Path(d2), verbose=False)
        pd.testing.assert_frame_equal(a, b)


def test_missing_is_blank_and_unavailable():
    cfg = load_config()
    ep = generate_episode(cfg, Spec(0, "ELECTRICAL", "NORMAL", None, "COMM_LOSS"), 5)
    state, tgas, mtt = label_episode(cfg, ep)
    m = ep.quality == "COMM_LOSS"
    assert m.sum() > 0
    for g in GASES:
        assert np.isnan(ep.values[g][m]).all()
    assert (state[m] == "UNAVAILABLE").all() and np.isnan(mtt[m]).all() and (tgas[m] == "").all()


def test_exceed_curve_is_gradual_and_recovers():
    cfg = load_config()
    ep = generate_episode(cfg, Spec(0, "HOT_WORK", "EXCEED", "CO"), 11)
    v = ep.values["CO"]
    assert v.max() >= cfg["thresholds"]["co_ppm"]
    # 한 샘플(15초) 사이 변화가 정점의 30%를 넘지 않는다(급변 없음)
    assert np.nanmax(np.abs(np.diff(v))) < 0.3 * v.max() + 2
    # 작업 종료 후 회복 유형: 종료 시점보다 에피소드 끝이 낮다(점진 감소)
    ep2 = generate_episode(cfg, Spec(0, "HOT_WORK", "RECOVERY_AFTER_WORK", "CO"), 12)
    v2 = ep2.values["CO"]; i_end = int(ep2.task_end_s // cfg["time"]["sample_interval_s"])
    assert v2[-5:].mean() < v2[i_end - 2:i_end + 3].mean()


def test_normal_episode_stays_normal():
    cfg = load_config()
    ep = generate_episode(cfg, Spec(0, "SCAFFOLDING", "NORMAL", None), 3)
    state, _, mtt = label_episode(cfg, ep)
    assert (state == "NORMAL").all() and np.isnan(mtt).all()
