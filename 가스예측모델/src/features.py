"""특성 생성: 최근 최대 40분(160개 시점) 시계열 → 고정 길이 특성 벡터.

학습과 추론이 같은 함수를 쓴다. 에피소드 전체에 대해 행마다 '그 행에서 끝나는 윈도우'의 특성을
롤링으로 계산하므로, 추론 시 최근 160행만 넘겨 마지막 행을 취하면 학습 때와 같은 값이 나온다.

규칙:
- SENSOR_ERROR / MISSING / COMM_LOSS 행의 가스값은 NaN으로 바꾼다(이상값을 정상 농도로 학습하지 않음).
- 길이 MAX_FILL_SAMPLES(3개=45초) 이하의 짧은 결측 구간만 선형보간한다. 긴 통신 두절은 보간하지 않는다.
- 결측을 0으로 채우지 않는다. 롤링 통계는 결측을 건너뛴다.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .data_loader import TASK_STATES, TASK_TYPES
from .rules import APPROACH_BAND, GASES, GAS_COL, GAS_COLS, THRESHOLDS

SAMPLE_INTERVAL_S = 15
WINDOW_MIN = 40                      # 최대 과거 길이(분)
WINDOW_ROWS = WINDOW_MIN * 60 // SAMPLE_INTERVAL_S   # 160
MIN_VALID_MIN = 10                   # 최소 유효 과거 길이(분)
MIN_VALID_ROWS = MIN_VALID_MIN * 60 // SAMPLE_INTERVAL_S  # 40
MIN_VALID_RATIO = 0.8
MAX_FILL_SAMPLES = 3                 # 이 길이 이하의 결측만 보간
HORIZONS_MIN = [5, 10, 20, 40]
_ROWS = {h: h * 60 // SAMPLE_INTERVAL_S for h in HORIZONS_MIN}


def _build_feature_names() -> list[str]:
    names = []
    for g in GASES:
        c = GAS_COL[g]
        names.append(f"{c}_cur")
        for h in HORIZONS_MIN:
            names += [f"{c}_mean_{h}m", f"{c}_min_{h}m", f"{c}_max_{h}m", f"{c}_std_{h}m", f"{c}_delta_{h}m", f"{c}_slope_{h}m"]
        if g == "O2":
            names += ["o2_pct_dist_low", "o2_pct_dist_high"]
        names += [f"{c}_dist_thr", f"{c}_dist_band"]
    names += [f"task_type_{t}" for t in TASK_TYPES]
    names += [f"task_state_{s}" for s in TASK_STATES]
    names += ["window_len_min", "valid_ratio", "missing_ratio_10m"]
    return names


FEATURE_NAMES: list[str] = _build_feature_names()


def _fill_short_gaps(x: np.ndarray, max_len: int) -> np.ndarray:
    """길이 max_len 이하의 NaN 구간(양쪽에 값이 있는 경우)만 선형보간."""
    x = x.astype(float).copy()
    n = len(x)
    isn = np.isnan(x)
    if not isn.any():
        return x
    i = 0
    while i < n:
        if not isn[i]:
            i += 1
            continue
        j = i
        while j < n and isn[j]:
            j += 1
        L = j - i
        if 0 < i and j < n and L <= max_len:
            x[i:j] = np.interp(np.arange(i, j), [i - 1, j], [x[i - 1], x[j]])
        i = j
    return x


def clean_series(df: pd.DataFrame) -> tuple[pd.DataFrame, np.ndarray]:
    """가스 5열을 정리한 DataFrame(NaN 처리·짧은 결측 보간)과 원본 유효 마스크를 돌려준다."""
    q = df["quality_flag"].astype(str).to_numpy()
    raw = df[GAS_COLS].to_numpy(dtype=float)
    valid = (q == "OK") & ~np.isnan(raw).any(axis=1)
    cleaned = raw.copy()
    cleaned[~valid, :] = np.nan
    out = pd.DataFrame({c: _fill_short_gaps(cleaned[:, k], MAX_FILL_SAMPLES) for k, c in enumerate(GAS_COLS)}, index=df.index)
    return out, valid


def _rolling_slope(x: np.ndarray, t: np.ndarray, w: int) -> np.ndarray:
    m = (~np.isnan(x)).astype(float)
    xf = np.where(m > 0, x, 0.0)
    s = lambda a: pd.Series(a).rolling(w, min_periods=1).sum().to_numpy()
    n, St, Sx, Stx, Stt = s(m), s(t * m), s(xf), s(t * xf), s(t * t * m)
    den = n * Stt - St * St
    num = n * Stx - St * Sx
    with np.errstate(divide="ignore", invalid="ignore"):
        slope = np.where((n >= 2) & (den > 1e-9), num / den, 0.0)
    return slope


def compute_feature_frame(df: pd.DataFrame) -> pd.DataFrame:
    """시간순 정렬된 한 센서의 시계열(에피소드 전체 또는 최근 구간)에 대해 행마다 특성을 계산한다.

    i번째 행의 특성은 행 [i-159, i] 구간만 사용한다(40분 초과 과거는 포함되지 않음).
    """
    n = len(df)
    cleaned, valid = clean_series(df)
    t = np.arange(n) * (SAMPLE_INTERVAL_S / 60.0)   # 분(상대 시각; 절대 시각은 쓰지 않음)
    F: dict[str, np.ndarray] = {}
    roll = lambda a, w, fn: getattr(pd.Series(a).rolling(w, min_periods=1), fn)().to_numpy()
    for g in GASES:
        c = GAS_COL[g]
        x = cleaned[c].to_numpy(dtype=float)
        cur = x
        F[f"{c}_cur"] = cur
        mean4 = roll(x, 4, "mean")   # 각 시점에서 끝나는 1분 평균(윈도우 시작부 기준값용)
        for h in HORIZONS_MIN:
            w = _ROWS[h]
            F[f"{c}_mean_{h}m"] = roll(x, w, "mean")
            F[f"{c}_min_{h}m"] = roll(x, w, "min")
            F[f"{c}_max_{h}m"] = roll(x, w, "max")
            F[f"{c}_std_{h}m"] = np.nan_to_num(roll(x, w, "std"), nan=0.0)
            # 변화량: 현재값 − 윈도우 시작 1분 평균(윈도우가 짧으면 시계열 시작 1분 평균)
            old = pd.Series(mean4).shift(w - 4).to_numpy()
            start_ref = np.full(n, mean4[min(3, n - 1)])
            old = np.where(np.arange(n) < w - 1, start_ref, old)
            old = np.where(np.isnan(old), F[f"{c}_mean_{h}m"], old)
            F[f"{c}_delta_{h}m"] = cur - old
            F[f"{c}_slope_{h}m"] = _rolling_slope(x, t, w)   # 단위/분
        if g == "O2":
            F["o2_pct_dist_low"] = cur - THRESHOLDS["O2_LOW"]
            F["o2_pct_dist_high"] = THRESHOLDS["O2_HIGH"] - cur
            dist = np.minimum(F["o2_pct_dist_low"], F["o2_pct_dist_high"])
        else:
            dist = THRESHOLDS[g] - cur
        F[f"{c}_dist_thr"] = dist
        F[f"{c}_dist_band"] = dist - APPROACH_BAND[g]
    tt = df["task_type"].astype(str).to_numpy()
    ts_ = df["task_state"].astype(str).to_numpy()
    for tname in TASK_TYPES:
        F[f"task_type_{tname}"] = (tt == tname).astype(float)
    for sname in TASK_STATES:
        F[f"task_state_{sname}"] = (ts_ == sname).astype(float)
    avail = np.minimum(np.arange(n) + 1, WINDOW_ROWS).astype(float)
    vcount = pd.Series(valid.astype(float)).rolling(WINDOW_ROWS, min_periods=1).sum().to_numpy()
    v10 = pd.Series(valid.astype(float)).rolling(MIN_VALID_ROWS, min_periods=1).sum().to_numpy()
    F["window_len_min"] = avail * SAMPLE_INTERVAL_S / 60.0
    F["valid_ratio"] = vcount / avail
    F["missing_ratio_10m"] = 1.0 - v10 / np.minimum(np.arange(n) + 1, MIN_VALID_ROWS)
    out = pd.DataFrame(F, index=df.index)[FEATURE_NAMES]
    # 보조 열(특성 아님): 적격성 판단용
    out["_valid_count"] = vcount
    out["_rows_available"] = avail
    out["_is_valid_now"] = valid.astype(float)
    return out


def eligibility(feat: pd.DataFrame) -> np.ndarray:
    """예측 가능 조건: 현재 행 유효, 윈도우 ≥40행, 유효 행 ≥40, 유효 비율 ≥0.8."""
    return ((feat["_is_valid_now"] > 0) & (feat["_rows_available"] >= MIN_VALID_ROWS)
            & (feat["_valid_count"] >= MIN_VALID_ROWS) & (feat["valid_ratio"] >= MIN_VALID_RATIO)).to_numpy()


def features_for_window(window: pd.DataFrame) -> pd.Series:
    """추론용: 시간순 최근 데이터(최대 160행)를 받아 마지막 행의 특성(보조 열 포함)을 돌려준다."""
    w = window.iloc[-WINDOW_ROWS:]
    return compute_feature_frame(w).iloc[-1]
