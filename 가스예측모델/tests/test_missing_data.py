"""결측·품질 이상: 10분 미만, 최신 행 MISSING/COMM_LOSS/SENSOR_ERROR, 가스 결측, 유효 비율 < 0.8 → UNAVAILABLE.
짧은 결측은 보간, 긴 통신 두절은 보간하지 않음. 0으로 채우지 않음."""
import numpy as np
import pandas as pd

from src.features import MAX_FILL_SAMPLES, clean_series
from src.inference import unavailable
from src.rules import GAS_COLS
from tests.conftest import window_at


def test_less_than_10_minutes_is_unavailable(predictor, normal_episode):
    assert predictor.predict_window(window_at(normal_episode, 199, n=39)) == unavailable()
    assert predictor.predict_window(window_at(normal_episode, 199, n=40))["prediction_status"] == "PREDICTED"


def test_latest_row_bad_quality_is_unavailable(predictor, normal_episode):
    for flag in ("MISSING", "COMM_LOSS", "SENSOR_ERROR"):
        w = window_at(normal_episode, 199)
        w.loc[w.index[-1], "quality_flag"] = flag
        if flag != "SENSOR_ERROR":
            w.loc[w.index[-1], GAS_COLS] = np.nan
        assert predictor.predict_window(w) == unavailable(), flag


def test_latest_gas_missing_is_unavailable(predictor, normal_episode):
    w = window_at(normal_episode, 199)
    w.loc[w.index[-1], "h2s_ppm"] = np.nan      # quality_flag는 OK인데 값이 비어 있는 경우
    assert predictor.predict_window(w) == unavailable()


def test_low_valid_ratio_is_unavailable(predictor, normal_episode):
    w = window_at(normal_episode, 199)              # 160행
    w.loc[w.index[10:50], "quality_flag"] = "COMM_LOSS"   # 40행(25%) 결측 → 유효 75%
    w.loc[w.index[10:50], GAS_COLS] = np.nan
    assert predictor.predict_window(w) == unavailable()
    w2 = window_at(normal_episode, 199)
    w2.loc[w2.index[10:30], "quality_flag"] = "COMM_LOSS"   # 20행(12.5%) → 유효 87.5%: 예측 가능
    w2.loc[w2.index[10:30], GAS_COLS] = np.nan
    assert predictor.predict_window(w2)["prediction_status"] == "PREDICTED"


def test_short_gap_interpolated_long_gap_not(normal_episode):
    w = window_at(normal_episode, 199)
    w.loc[w.index[50:50 + MAX_FILL_SAMPLES], ["quality_flag"]] = "MISSING"
    w.loc[w.index[50:50 + MAX_FILL_SAMPLES], GAS_COLS] = np.nan
    w.loc[w.index[100:120], ["quality_flag"]] = "COMM_LOSS"
    w.loc[w.index[100:120], GAS_COLS] = np.nan
    cleaned, valid = clean_series(w)
    assert not cleaned.iloc[50:50 + MAX_FILL_SAMPLES].isna().any().any()        # 짧은 결측: 보간됨
    assert cleaned.iloc[100:120].isna().all().all()                            # 긴 두절: NaN 유지
    assert (cleaned.iloc[100:120].fillna(-1) == 0).sum().sum() == 0            # 0으로 채우지 않음
    assert not valid[50:53].any() and not valid[100:120].any()


def test_sensor_error_values_are_not_used(normal_episode):
    w = window_at(normal_episode, 199)
    w.loc[w.index[80], "quality_flag"] = "SENSOR_ERROR"
    w.loc[w.index[80], "co_ppm"] = 900.0
    cleaned, valid = clean_series(w)
    assert not valid[80]
    assert cleaned["co_ppm"].iloc[80] < 100       # 이상값이 그대로 들어가지 않고 이웃값으로 보간됨(1샘플)
    assert cleaned["co_ppm"].max() < 100
