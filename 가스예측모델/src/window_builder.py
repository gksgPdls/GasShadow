"""학습 윈도우(표본) 생성.

기준 시점(anchor) 조건:
  quality_flag == OK, legal_state in {NORMAL, APPROACH}, 5가스 모두 존재,
  최근 유효 데이터 ≥ 10분(40행), 유효 비율 ≥ 0.8.
기준 시점은 1분(4행) 간격으로 뽑는다(예측을 1분마다 수행한다는 가정).

정답:
  y_risk30 = 1 if 0 < minutes_to_threshold <= 30
  y_risk60 = 1 if 0 < minutes_to_threshold <= 60
  y_gas    = threshold_gas (없으면 NONE)
  y_mtt    = minutes_to_threshold (없으면 NaN; 0인 행은 EXCEEDED라 기준 시점에서 이미 제외)
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .data_loader import ID_COLUMNS, LABEL_COLUMNS
from .features import FEATURE_NAMES, MIN_VALID_ROWS, compute_feature_frame, eligibility

STRIDE_ROWS = 4
META_KEEP = ["scenario_id", "split", "timestamp", "task_type", "task_state", "row_in_episode"]
LABEL_KEEP = ["y_risk30", "y_risk60", "y_gas", "y_mtt", "legal_state_now"]


def make_labels(df: pd.DataFrame) -> pd.DataFrame:
    mtt = df["minutes_to_threshold"].to_numpy(dtype=float)
    has = ~np.isnan(mtt)
    gas = df["threshold_gas"].astype(str).replace({"nan": "", "<NA>": ""}).to_numpy()
    return pd.DataFrame({
        "y_risk30": (has & (mtt > 0) & (mtt <= 30)).astype(int),
        "y_risk60": (has & (mtt > 0) & (mtt <= 60)).astype(int),
        "y_gas": np.where(has & (mtt > 0), gas, "NONE"),
        "y_mtt": np.where(has & (mtt > 0), mtt, np.nan),
        "legal_state_now": df["legal_state"].astype(str).to_numpy(),
    }, index=df.index)


def build_windows(ts: pd.DataFrame, stride: int = STRIDE_ROWS, splits: list[str] | None = None,
                  all_anchors: bool = False) -> pd.DataFrame:
    """특성 + 정답 + 메타 열을 가진 표본 테이블. 특성 열은 FEATURE_NAMES, 나머지는 메타·정답.

    all_anchors=True면 적격성(eligible)과 무관하게 1분 간격의 모든 시점을 돌려준다(UNAVAILABLE 비율 평가용).
    """
    parts = []
    for sid, ep in ts.groupby("scenario_id", sort=True):
        if splits is not None and ep["split"].iloc[0] not in splits:
            continue
        ep = ep.sort_values("timestamp").reset_index(drop=True)
        feat = compute_feature_frame(ep)
        lab = make_labels(ep)
        elig = eligibility(feat) & ep["quality_flag"].eq("OK").to_numpy() & ep["legal_state"].isin(["NORMAL", "APPROACH"]).to_numpy()
        if all_anchors:
            idx = np.arange(stride - 1, len(ep), stride)          # 1분째부터 모든 시점(UNAVAILABLE 비율 평가용)
        else:
            idx = np.arange(MIN_VALID_ROWS - 1, len(ep), stride)  # 10분째부터
            idx = idx[elig[idx]]
        if len(idx) == 0:
            continue
        part = feat.iloc[idx][FEATURE_NAMES].copy()
        part["eligible"] = elig[idx]
        for c in LABEL_KEEP:
            part[c] = lab[c].to_numpy()[idx]
        part["quality_flag_now"] = ep["quality_flag"].to_numpy()[idx]
        part["scenario_id"] = sid
        part["split"] = ep["split"].iloc[0]
        part["timestamp"] = ep["timestamp"].to_numpy()[idx]
        part["task_type"] = ep["task_type"].to_numpy()[idx]
        part["task_state"] = ep["task_state"].to_numpy()[idx]
        part["row_in_episode"] = idx
        parts.append(part)
    out = pd.concat(parts, ignore_index=True)
    assert_no_leakage(out)
    return out


def feature_matrix(windows: pd.DataFrame) -> np.ndarray:
    return windows[FEATURE_NAMES].to_numpy(dtype=float)


def assert_no_leakage(windows: pd.DataFrame) -> None:
    """특성 이름에 정답·식별 컬럼이 없는지 확인."""
    forbidden = set(ID_COLUMNS) | set(LABEL_COLUMNS) | {"ptw_id", "zone_id", "random_seed", "timestamp"}
    bad = [f for f in FEATURE_NAMES if f in forbidden or any(f.startswith(b + "_") for b in forbidden)]
    if bad:
        raise ValueError(f"금지된 컬럼이 특성에 포함됨: {bad}")
