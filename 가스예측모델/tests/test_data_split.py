"""분할: 같은 scenario_id가 여러 split에 없고, 저장된 split 값만 쓰며, 전처리기는 train에만 적합."""
import json

import joblib

from src.data_loader import SPLITS, check_schema
from src.inference import ARTIFACTS


def test_scenario_in_single_split(ts):
    n = ts.groupby("scenario_id")["split"].nunique()
    assert (n == 1).all()
    assert set(ts["split"].unique()) == set(SPLITS)


def test_split_counts_match_documentation(ts):
    c = ts.groupby("split")["scenario_id"].nunique().to_dict()
    assert c == {"train": 880, "validation": 188, "test": 191}


def test_schema_matches_documentation(ts, meta):
    assert check_schema(ts, meta) == []


def test_preprocessors_fit_on_train_only():
    """StandardScaler가 본 표본 수 = train 윈도우 수 (validation·test 미포함)."""
    cfg = json.load(open(ARTIFACTS / "model_config.json", encoding="utf-8"))
    n_train = cfg["n_windows"]["train"]
    for key in ("risk60", "risk30", "gas"):
        p = ARTIFACTS / "preprocessors" / f"{key}_scaler.joblib"
        if p.exists():
            sc = joblib.load(p)
            assert sc.n_samples_seen_ <= n_train, f"{key} scaler가 train보다 많은 표본을 봄"
            if key != "gas":
                assert sc.n_samples_seen_ == n_train
