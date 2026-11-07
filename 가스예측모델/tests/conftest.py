import pathlib
import sys

import numpy as np
import pandas as pd
import pytest

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.data_loader import load_metadata, load_timeseries  # noqa: E402
from src.inference import REQUIRED_COLUMNS, GasRiskPredictor  # noqa: E402


@pytest.fixture(scope="session")
def ts() -> pd.DataFrame:
    return load_timeseries()


@pytest.fixture(scope="session")
def meta() -> pd.DataFrame:
    return load_metadata()


@pytest.fixture(scope="session")
def predictor() -> GasRiskPredictor:
    return GasRiskPredictor()


def _episode(ts, sid):
    return ts[ts.scenario_id == sid].sort_values("timestamp").reset_index(drop=True)


@pytest.fixture(scope="session")
def normal_episode(ts) -> pd.DataFrame:
    """test 분할, 센서 이상 없고 초과 없는 에피소드."""
    for sid, ep in ts[ts.split == "test"].groupby("scenario_id"):
        if (ep.quality_flag == "OK").all() and (ep.legal_state == "NORMAL").all() and len(ep) >= 200:
            return _episode(ts, sid)
    raise RuntimeError("no normal episode")


@pytest.fixture(scope="session")
def risk_episode(ts) -> pd.DataFrame:
    """test 분할, 센서 이상 없고 초과가 있는 에피소드(초과 전 구간이 20분 이상)."""
    for sid, ep in ts[ts.split == "test"].groupby("scenario_id"):
        ex = np.where(ep.legal_state.to_numpy() == "EXCEEDED")[0]
        if (ep.quality_flag == "OK").all() and len(ex) and ex[0] >= 80 + 40:
            return _episode(ts, sid)
    raise RuntimeError("no risk episode")


def window_at(ep: pd.DataFrame, row: int, n: int = 160) -> pd.DataFrame:
    """row에서 끝나는 최근 n행(입력 허용 컬럼만)."""
    return ep.loc[max(0, row - n + 1):row, REQUIRED_COLUMNS].reset_index(drop=True)
