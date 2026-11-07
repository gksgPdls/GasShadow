"""데이터 로딩·스키마 확인·감사 보고서."""
from __future__ import annotations

import pathlib

import numpy as np
import pandas as pd

from .rules import GAS_COLS

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = ROOT.parent / "합성데이터_간소화" / "output"

EXPECTED_COLUMNS = ["scenario_id", "timestamp", "sensor_id", "task_type", "task_state",
                    "o2_pct", "lel_pct", "co_ppm", "h2s_ppm", "co2_pct",
                    "quality_flag", "legal_state", "threshold_gas", "minutes_to_threshold", "source_type", "split"]
EXPECTED_META_COLUMNS = ["scenario_id", "ptw_id", "zone_id", "task_start", "task_end", "random_seed"]

TASK_TYPES = ["HOT_WORK", "PAINTING_CLEANING", "ELECTRICAL", "RADIOGRAPHY", "COMMISSIONING", "SCAFFOLDING",
              "FLUID_SUPPLY", "PRESSURE_TEST", "BARGE_WORK", "HEAVY_LIFTING", "OTHER", "NONE"]
TASK_STATES = ["PRE_WORK", "WORK", "RECOVERY"]
SPLITS = ["train", "validation", "test"]

# 모델이 사용할 수 있는 원본 컬럼(timestamp는 정렬·간격 계산 전용)
MODEL_INPUT_COLUMNS = ["task_type", "task_state", "o2_pct", "lel_pct", "co_ppm", "h2s_ppm", "co2_pct", "quality_flag", "timestamp"]
# 식별·관리용: 모델 입력 금지
ID_COLUMNS = ["scenario_id", "sensor_id", "source_type", "split"]
# 정답: 모델 입력 절대 금지
LABEL_COLUMNS = ["legal_state", "threshold_gas", "minutes_to_threshold"]
# 메타데이터: 모델 입력 금지
META_FORBIDDEN = ["ptw_id", "zone_id", "random_seed"]
SAMPLE_INTERVAL_S = 15


def load_timeseries(path: str | pathlib.Path | None = None) -> pd.DataFrame:
    p = pathlib.Path(path) if path else DEFAULT_DATA_DIR / "gas_timeseries.csv"
    df = pd.read_csv(p, dtype={"threshold_gas": "string"})
    df["threshold_gas"] = df["threshold_gas"].fillna("").astype(str)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.sort_values(["scenario_id", "timestamp"], kind="stable").reset_index(drop=True)
    return df


def load_metadata(path: str | pathlib.Path | None = None) -> pd.DataFrame:
    p = pathlib.Path(path) if path else DEFAULT_DATA_DIR / "scenario_metadata.csv"
    return pd.read_csv(p, keep_default_na=False)


def check_schema(ts: pd.DataFrame, meta: pd.DataFrame | None = None) -> list[str]:
    """문서와 다른 점을 문자열 목록으로 돌려준다(비어 있으면 일치)."""
    issues = []
    if list(ts.columns) != EXPECTED_COLUMNS:
        issues.append(f"gas_timeseries 컬럼 불일치: {list(ts.columns)}")
    if meta is not None and list(meta.columns) != EXPECTED_META_COLUMNS:
        issues.append(f"scenario_metadata 컬럼 불일치: {list(meta.columns)}")
    bad_split = set(ts["split"].unique()) - set(SPLITS)
    if bad_split:
        issues.append(f"알 수 없는 split 값: {bad_split}")
    bad_task = set(ts["task_type"].unique()) - set(TASK_TYPES)
    if bad_task:
        issues.append(f"알 수 없는 task_type: {bad_task}")
    bad_state = set(ts["task_state"].unique()) - set(TASK_STATES)
    if bad_state:
        issues.append(f"알 수 없는 task_state: {bad_state}")
    multi = ts.groupby("scenario_id")["split"].nunique()
    if (multi > 1).any():
        issues.append(f"여러 split에 속한 scenario_id: {int((multi > 1).sum())}개")
    d = ts.groupby("scenario_id")["timestamp"].diff().dt.total_seconds().dropna()
    if len(d) and not np.allclose(d.values, SAMPLE_INTERVAL_S):
        issues.append(f"측정 간격이 {SAMPLE_INTERVAL_S}초가 아닌 행 {int((d != SAMPLE_INTERVAL_S).sum())}개")
    if (ts["source_type"] != "SYNTHETIC").any():
        issues.append("source_type이 SYNTHETIC이 아닌 행 존재")
    m = ts["quality_flag"].isin(["MISSING", "COMM_LOSS"])
    if not ts.loc[m, GAS_COLS].isna().all(axis=1).all():
        issues.append("MISSING/COMM_LOSS 행에 값이 있는 가스 존재")
    if ts.loc[~m, GAS_COLS].isna().any().any():
        issues.append("OK/SENSOR_ERROR 행에 결측 가스 존재")
    return issues


def audit(ts: pd.DataFrame, meta: pd.DataFrame, out_path: str | pathlib.Path) -> str:
    issues = check_schema(ts, meta)
    L = ["# 데이터 감사 보고서", "",
         f"- 원본: `{DEFAULT_DATA_DIR}`",
         f"- 행 {len(ts):,} / 에피소드 {ts.scenario_id.nunique():,} / 메타데이터 행 {len(meta):,}",
         f"- 측정 간격 {SAMPLE_INTERVAL_S}초, 에피소드 길이(분) 최소 {ts.groupby('scenario_id').size().min() * SAMPLE_INTERVAL_S / 60:.1f} ~ 최대 {ts.groupby('scenario_id').size().max() * SAMPLE_INTERVAL_S / 60:.1f}",
         "", "## 문서와의 일치 여부", ""]
    L += ["- 불일치 없음(컬럼 16/6개, split 유일성, 15초 간격, 결측 규칙 모두 문서와 일치)"] if not issues else [f"- {i}" for i in issues]
    L += ["", "## 컬럼", "", f"- gas_timeseries: {list(ts.columns)}", f"- scenario_metadata: {list(meta.columns)}", "",
          "## 분할(에피소드)", "", str(ts.groupby("split")["scenario_id"].nunique().to_dict()), "",
          "## 분할(행)", "", str(ts["split"].value_counts().to_dict()), "",
          "## quality_flag", "", str(ts["quality_flag"].value_counts().to_dict()), "",
          "## legal_state", "", str(ts["legal_state"].value_counts().to_dict()), "",
          "## task_type(행)", "", str(ts["task_type"].value_counts().to_dict()), "",
          "## task_state(행)", "", str(ts["task_state"].value_counts().to_dict()), "",
          "## threshold_gas(행)", "", str(ts["threshold_gas"].replace("", "(none)").value_counts().to_dict()), "",
          "## 가스 값 범위(OK·SENSOR_ERROR 행)", "", ts[GAS_COLS].describe().round(3).to_markdown(), "",
          "## minutes_to_threshold", "",
          f"- 값 있는 행 {int(ts['minutes_to_threshold'].notna().sum()):,} (0 = 현재 초과 중 {int((ts['minutes_to_threshold'] == 0).sum()):,}, 0<x≤30: {int(((ts['minutes_to_threshold'] > 0) & (ts['minutes_to_threshold'] <= 30)).sum()):,}, 30<x≤60: {int(((ts['minutes_to_threshold'] > 30) & (ts['minutes_to_threshold'] <= 60)).sum()):,})",
          "", "## 모델 입력 컬럼 제한", "",
          f"- 허용: {MODEL_INPUT_COLUMNS} (timestamp는 정렬·간격 전용)",
          f"- 금지(식별): {ID_COLUMNS}", f"- 금지(정답): {LABEL_COLUMNS}", f"- 금지(메타): {META_FORBIDDEN}"]
    text = "\n".join(L) + "\n"
    pathlib.Path(out_path).write_text(text, encoding="utf-8")
    return text
