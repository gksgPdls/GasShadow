"""누수: 정답·식별 컬럼이 특성에 없고, 정답을 바꿔도 특성이 안 변하며, 40분 밖 데이터는 입력에 들어가지 않는다."""
import numpy as np
import pandas as pd

from src.data_loader import ID_COLUMNS, LABEL_COLUMNS, META_FORBIDDEN
from src.features import FEATURE_NAMES, WINDOW_ROWS, compute_feature_frame, features_for_window
from src.window_builder import assert_no_leakage, build_windows
from tests.conftest import window_at


def test_feature_names_have_no_label_or_id():
    forbidden = set(ID_COLUMNS) | set(LABEL_COLUMNS) | set(META_FORBIDDEN) | {"timestamp"}
    for f in FEATURE_NAMES:
        assert f not in forbidden
        for b in forbidden:
            assert not f.startswith(b + "_"), f
    assert_no_leakage(pd.DataFrame(columns=FEATURE_NAMES))


def test_features_unchanged_when_labels_scrambled(risk_episode):
    ep = risk_episode.copy()
    a = compute_feature_frame(ep)[FEATURE_NAMES]
    rng = np.random.default_rng(0)
    ep2 = ep.copy()
    ep2["legal_state"] = rng.permutation(ep2["legal_state"].to_numpy())
    ep2["threshold_gas"] = rng.permutation(ep2["threshold_gas"].to_numpy())
    ep2["minutes_to_threshold"] = rng.permutation(ep2["minutes_to_threshold"].to_numpy())
    ep2["scenario_id"] = "XXXX"; ep2["sensor_id"] = "GS-999"; ep2["split"] = "test"
    b = compute_feature_frame(ep2)[FEATURE_NAMES]
    pd.testing.assert_frame_equal(a, b)


def test_absolute_time_not_a_feature(risk_episode):
    ep = risk_episode.copy()
    a = compute_feature_frame(ep)[FEATURE_NAMES]
    ep["timestamp"] = ep["timestamp"] + pd.Timedelta(days=400)
    b = compute_feature_frame(ep)[FEATURE_NAMES]
    pd.testing.assert_frame_equal(a, b)


def test_no_data_older_than_40_minutes(risk_episode):
    ep = risk_episode
    row = 200
    w_full = window_at(ep, row, n=row + 1)            # 처음부터 row까지 전부
    w_40 = window_at(ep, row, n=WINDOW_ROWS)         # 최근 160행
    assert len(w_full) > WINDOW_ROWS
    # 160행보다 오래된 값을 크게 바꿔도 특성이 같아야 한다
    w_mod = w_full.copy()
    w_mod.loc[: len(w_full) - WINDOW_ROWS - 1, ["o2_pct", "co_ppm", "lel_pct", "h2s_ppm", "co2_pct"]] += 100.0
    f_full = features_for_window(w_full)[FEATURE_NAMES]
    f_mod = features_for_window(w_mod)[FEATURE_NAMES]
    f_40 = features_for_window(w_40)[FEATURE_NAMES]
    np.testing.assert_allclose(f_full.to_numpy(float), f_mod.to_numpy(float))
    np.testing.assert_allclose(f_full.to_numpy(float), f_40.to_numpy(float))


def test_training_windows_only_use_allowed_columns(ts):
    sids = ts[ts.split == "train"].scenario_id.unique()[:5]
    sub = ts[ts.scenario_id.isin(sids)]
    win = build_windows(sub)
    assert set(FEATURE_NAMES) <= set(win.columns)
    assert not ({"legal_state", "threshold_gas", "minutes_to_threshold", "ptw_id", "zone_id", "random_seed"} & set(FEATURE_NAMES))
    # 기준 시점 조건
    assert (win["legal_state_now"].isin(["NORMAL", "APPROACH"])).all()
    assert (win["quality_flag_now"] == "OK").all()
    assert (win["window_len_min"] >= 10).all()
