"""학습: 윈도우 생성 → 후보 모델 학습(train) → validation으로 선택·임계값 결정 → 저장.

실행: python -m src.train [--quick]
산출: artifacts/models/*.joblib, artifacts/preprocessors/*.joblib, artifacts/model_config.json,
      reports/validation_metrics.json, reports/feature_importance.csv, reports/data_audit.md
test 분할은 여기서 전혀 쓰지 않는다.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import time

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, HistGradientBoostingRegressor, RandomForestClassifier, RandomForestRegressor
from sklearn.inspection import permutation_importance
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss
from sklearn.preprocessing import StandardScaler

from .data_loader import ID_COLUMNS, LABEL_COLUMNS, audit, check_schema, load_metadata, load_timeseries
from .evaluate import MIN_RECALL, choose_threshold, classification_metrics, gas_metrics, time_metrics, tradeoff_table
from .features import FEATURE_NAMES, HORIZONS_MIN, MAX_FILL_SAMPLES, MIN_VALID_RATIO, MIN_VALID_ROWS, WINDOW_ROWS
from .rules import APPROACH_BAND, GASES, THRESHOLDS
from .window_builder import STRIDE_ROWS, build_windows, feature_matrix

ROOT = pathlib.Path(__file__).resolve().parent.parent
ARTIFACTS, REPORTS = ROOT / "artifacts", ROOT / "reports"
SEED = 20261031


def candidates_clf(quick: bool, seed: int = SEED) -> dict:
    n_rf = 100 if quick else 300
    return {
        "LogisticRegression": ("scale", LogisticRegression(max_iter=2000, C=0.5, class_weight="balanced", random_state=seed)),
        "RandomForest": (None, RandomForestClassifier(n_estimators=n_rf, min_samples_leaf=5, class_weight="balanced_subsample", n_jobs=-1, random_state=seed)),
        "HistGradientBoosting": (None, HistGradientBoostingClassifier(max_iter=150 if quick else 400, learning_rate=0.05, max_leaf_nodes=31,
                                                                       l2_regularization=1.0, class_weight="balanced", random_state=seed)),
    }


def candidates_multiclass(quick: bool, seed: int = SEED) -> dict:
    return {
        "LogisticRegression": ("scale", LogisticRegression(max_iter=3000, C=0.5, class_weight="balanced", random_state=seed)),
        "RandomForest": (None, RandomForestClassifier(n_estimators=100 if quick else 300, min_samples_leaf=3, class_weight="balanced_subsample", n_jobs=-1, random_state=seed)),
        "HistGradientBoosting": (None, HistGradientBoostingClassifier(max_iter=150 if quick else 400, learning_rate=0.05, class_weight="balanced", random_state=seed)),
    }


def candidates_reg(quick: bool, seed: int = SEED) -> dict:
    return {
        "RandomForest": (None, RandomForestRegressor(n_estimators=100 if quick else 300, min_samples_leaf=5, n_jobs=-1, random_state=seed)),
        "HistGradientBoosting": (None, HistGradientBoostingRegressor(max_iter=150 if quick else 500, learning_rate=0.05, loss="absolute_error", random_state=seed)),
    }


SIMPLICITY = {"LogisticRegression": 0, "HistGradientBoosting": 1, "RandomForest": 2}


def select_simplest_within(res: dict, metric: str, higher_better: bool, tol: float) -> str:
    """지표가 최고인 모델을 고르되, 더 단순한 모델이 최고값의 tol 이내면 단순한 쪽을 택한다."""
    vals = {n: res[n].get(metric, -np.inf if higher_better else np.inf) for n in res}
    best_v = max(vals.values()) if higher_better else min(vals.values())
    ok = [n for n, v in vals.items() if ((best_v - v) if higher_better else (v - best_v)) <= tol]
    return min(ok, key=lambda n: SIMPLICITY.get(n, 9))


def fit_one(spec, Xtr, ytr):
    pre, model = spec
    scaler = None
    if pre == "scale":
        scaler = StandardScaler().fit(Xtr)        # train에만 적합
        Xtr = scaler.transform(Xtr)
    model.fit(Xtr, ytr)
    return scaler, model


def apply(scaler, X):
    return scaler.transform(X) if scaler is not None else X


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--quick", action="store_true", help="후보 모델 축소(빠른 확인용)")
    ap.add_argument("--windows-cache", default=None, help="윈도우 테이블 pickle 경로(있으면 재사용)")
    a = ap.parse_args(argv)
    t0 = time.time()
    (ARTIFACTS / "models").mkdir(parents=True, exist_ok=True); (ARTIFACTS / "preprocessors").mkdir(parents=True, exist_ok=True); REPORTS.mkdir(exist_ok=True)

    ts, meta = load_timeseries(), load_metadata()
    issues = check_schema(ts, meta)
    audit(ts, meta, REPORTS / "data_audit.md")
    if issues:
        raise SystemExit("데이터가 문서와 다릅니다. 먼저 보고하십시오:\n" + "\n".join(issues))

    cache = pathlib.Path(a.windows_cache) if a.windows_cache else None
    if cache and cache.exists():
        win = pd.read_pickle(cache)
    else:
        win = build_windows(ts, splits=["train", "validation"])
        if cache:
            win.to_pickle(cache)
    tr, va = win[win.split == "train"].reset_index(drop=True), win[win.split == "validation"].reset_index(drop=True)
    assert set(tr.scenario_id) & set(va.scenario_id) == set()
    Xtr, Xva = feature_matrix(tr), feature_matrix(va)
    print(f"windows train={len(tr)} validation={len(va)} features={Xtr.shape[1]} ({time.time() - t0:.0f}s)")

    val_report = {"candidates": {}, "selected": {}, "thresholds": {}, "n_windows": {"train": int(len(tr)), "validation": int(len(va))}}
    chosen = {}

    # 1·2. 60분/30분 위험 분류 (PR-AUC로 선택 → validation으로 확률 보정 → 보정 확률에서 임계값 결정)
    calibrators = {}
    for key, ycol in (("risk60", "y_risk60"), ("risk30", "y_risk30")):
        res, fitted = {}, {}
        yva = va[ycol].to_numpy()
        for name, spec in candidates_clf(a.quick).items():
            t1 = time.time()
            sc, m = fit_one(spec, Xtr, tr[ycol].to_numpy())
            p = m.predict_proba(apply(sc, Xva))[:, 1]
            thr, rule = choose_threshold(yva, p)
            met = classification_metrics(yva, p, thr); met["threshold_rule"] = rule; met["fit_seconds"] = round(time.time() - t1, 1)
            met["tradeoff"] = tradeoff_table(yva, p)
            res[name] = met; fitted[name] = (sc, m, p)
            print(f"[{key}] {name}: PR-AUC={met.get('pr_auc', 0):.3f} ROC={met.get('roc_auc', 0):.3f} F1={met['f1']:.3f} R={met['recall']:.3f} P={met['precision']:.3f} Brier={met.get('brier', 0):.3f} thr={thr:.3f} ({met['fit_seconds']}s)")
        best = select_simplest_within(res, "pr_auc", higher_better=True, tol=0.01)
        sc, m, p_raw = fitted[best]
        # 확률 보정: class_weight='balanced' 모델의 확률은 양성 쪽으로 부풀려지므로 validation에서 등장(isotonic) 보정.
        # 보정 전후 Brier를 기록하고, 보정이 Brier를 낮출 때만 쓴다. (test는 쓰지 않음)
        cal = IsotonicRegression(out_of_bounds="clip", y_min=0.0, y_max=1.0).fit(p_raw, yva)
        p_cal = cal.predict(p_raw)
        brier_raw, brier_cal = brier_score_loss(yva, p_raw), brier_score_loss(yva, p_cal)
        use_cal = brier_cal < brier_raw
        p_final = p_cal if use_cal else p_raw
        thr, rule = choose_threshold(yva, p_final)
        met = classification_metrics(yva, p_final, thr); met["threshold_rule"] = rule; met["tradeoff"] = tradeoff_table(yva, p_final)
        res[best + " (선택, 보정 후)" if use_cal else best + " (선택, 보정 안 함)"] = met
        val_report["candidates"][key] = res; val_report["selected"][key] = best
        val_report["calibration"] = val_report.get("calibration", {})
        val_report["calibration"][key] = {"method": "isotonic on validation" if use_cal else "none", "brier_raw": float(brier_raw), "brier_calibrated": float(brier_cal), "used": bool(use_cal),
                                          "note": "보정기는 validation으로 적합했고 임계값도 같은 validation의 보정 확률에서 정했다(둘 다 validation 사용, test 미사용)."}
        chosen[key] = (sc, m, float(thr), rule)
        calibrators[key] = cal if use_cal else None
        val_report["thresholds"][key] = {"value": float(thr), "rule": rule}
        print(f"[{key}] 선택 {best}: Brier raw={brier_raw:.3f} cal={brier_cal:.3f} use_cal={use_cal} thr={thr:.4f} R={met['recall']:.3f} P={met['precision']:.3f}")

    # 보조 분석: window_len_min(에피소드 시작 후 경과 시간의 대용) 제외 시 30분 모델 성능 — 합성 데이터 구조 의존도 확인
    from sklearn.base import clone
    keep = [i for i, f in enumerate(FEATURE_NAMES) if f != "window_len_min"]
    spec = candidates_clf(a.quick)[val_report["selected"]["risk30"]]
    sc_ab, m_ab = fit_one((spec[0], clone(spec[1])), Xtr[:, keep], tr.y_risk30.to_numpy())
    p_ab = m_ab.predict_proba(apply(sc_ab, Xva[:, keep]))[:, 1]
    thr_ab, _ = choose_threshold(va.y_risk30.to_numpy(), p_ab)
    val_report["ablation_without_window_len_min"] = {k: v for k, v in classification_metrics(va.y_risk30.to_numpy(), p_ab, thr_ab).items() if k in ("pr_auc", "roc_auc", "f1", "recall", "precision", "threshold")}
    print("[ablation] risk30 without window_len_min:", val_report["ablation_without_window_len_min"])

    # 3. 위험 가스 다중분류 (60분 내 초과가 있는 윈도우만; macro F1로 선택)
    mg = tr.y_risk60.to_numpy() == 1; mgv = va.y_risk60.to_numpy() == 1
    res, fitted = {}, {}
    for name, spec in candidates_multiclass(a.quick).items():
        t1 = time.time()
        sc, m = fit_one(spec, Xtr[mg], tr.y_gas.to_numpy()[mg].astype(str))
        pg = m.predict(apply(sc, Xva[mgv]))
        met = gas_metrics(va.y_gas.to_numpy()[mgv], pg); met["macro_f1"] = met["macro_f1_gases_only"]; met["fit_seconds"] = round(time.time() - t1, 1)
        res[name] = met; fitted[name] = (sc, m)
        print(f"[gas] {name}: acc={met['accuracy']:.3f} macroF1={met['macro_f1']:.3f} ({met['fit_seconds']}s)")
    best = select_simplest_within(res, "macro_f1", higher_better=True, tol=0.01)
    val_report["candidates"]["gas"] = res; val_report["selected"]["gas"] = best; chosen["gas"] = fitted[best]

    # 4. 도달시간 회귀 (0 < mtt ≤ 60 윈도우만; MAE로 선택)
    mt = ~np.isnan(tr.y_mtt.to_numpy()); mtv = ~np.isnan(va.y_mtt.to_numpy())
    res, fitted = {}, {}
    for name, spec in candidates_reg(a.quick).items():
        t1 = time.time()
        sc, m = fit_one(spec, Xtr[mt], tr.y_mtt.to_numpy()[mt])
        pt = np.clip(m.predict(apply(sc, Xva[mtv])), 0, 60)
        met = time_metrics(va.y_mtt.to_numpy()[mtv], pt); met["fit_seconds"] = round(time.time() - t1, 1)
        res[name] = met; fitted[name] = (sc, m)
        print(f"[time] {name}: MAE={met['mae']:.2f} medAE={met['median_ae']:.2f} ±10={met['within_10min']:.3f} ({met['fit_seconds']}s)")
    best = select_simplest_within(res, "mae", higher_better=False, tol=0.25)
    val_report["candidates"]["time"] = res; val_report["selected"]["time"] = best; chosen["time"] = fitted[best]
    val_report["selection_rule"] = ("분류: validation PR-AUC 최대 모델. 단, 더 단순한 모델(LogisticRegression < HistGradientBoosting < RandomForest 순)이 "
                                    "최대값의 0.01 이내면 단순한 쪽을 택한다. 가스: macro F1(5가스) 같은 규칙. 시간: MAE 최소, 0.25분 이내면 단순한 쪽.")

    # 저장
    names = {"risk60": "risk60_classifier", "risk30": "risk30_classifier", "gas": "gas_classifier", "time": "time_regressor"}
    for key, fname in names.items():
        sc, m = chosen[key][0], chosen[key][1]
        joblib.dump(m, ARTIFACTS / "models" / f"{fname}.joblib")
        p = ARTIFACTS / "preprocessors" / f"{key}_scaler.joblib"
        if sc is not None:
            joblib.dump(sc, p)
        elif p.exists():
            p.unlink()
    for key in ("risk60", "risk30"):
        p = ARTIFACTS / "preprocessors" / f"{key}_calibrator.joblib"
        if calibrators.get(key) is not None:
            joblib.dump(calibrators[key], p)
        elif p.exists():
            p.unlink()
    config = {
        "feature_names": FEATURE_NAMES, "n_features": len(FEATURE_NAMES),
        "selected": val_report["selected"],
        "calibration": {k: v["method"] for k, v in val_report["calibration"].items()},
        "threshold_30m": chosen["risk30"][2], "threshold_30m_rule": chosen["risk30"][3],
        "threshold_60m": chosen["risk60"][2], "threshold_60m_rule": chosen["risk60"][3],
        "gas_classes": sorted(GASES),
        "window": {"sample_interval_s": 15, "max_rows": WINDOW_ROWS, "min_valid_rows": MIN_VALID_ROWS, "min_valid_ratio": MIN_VALID_RATIO,
                   "max_fill_samples": MAX_FILL_SAMPLES, "stride_rows": STRIDE_ROWS, "horizons_min": HORIZONS_MIN, "prediction_horizon_min": 60, "imminent_min": 30},
        "thresholds": THRESHOLDS, "approach_band": APPROACH_BAND,
        "forbidden_feature_sources": ID_COLUMNS + LABEL_COLUMNS + ["ptw_id", "zone_id", "random_seed", "timestamp(절대시각)"],
        "n_windows": val_report["n_windows"], "random_seed": SEED, "quick": a.quick,
        "data_source": "합성데이터_간소화/output/gas_timeseries.csv (SYNTHETIC)",
        "trained_at": pd.Timestamp.now().isoformat(timespec="seconds"),
    }
    with open(ARTIFACTS / "model_config.json", "w", encoding="utf-8") as f:
        json.dump(config, f, ensure_ascii=False, indent=1)
    with open(REPORTS / "validation_metrics.json", "w", encoding="utf-8") as f:
        json.dump(val_report, f, ensure_ascii=False, indent=1)

    # 특성 중요도(선택된 30분 모델, validation 부분표본, 순열 중요도)
    sc, m = chosen["risk30"][0], chosen["risk30"][1]
    rng = np.random.default_rng(SEED)
    idx = rng.choice(len(va), size=min(4000, len(va)), replace=False)
    pi = permutation_importance(m, apply(sc, Xva[idx]), va.y_risk30.to_numpy()[idx], scoring="average_precision", n_repeats=3, random_state=SEED, n_jobs=-1)
    fi = pd.DataFrame({"feature": FEATURE_NAMES, "importance_mean": pi.importances_mean, "importance_std": pi.importances_std}).sort_values("importance_mean", ascending=False)
    fi.to_csv(REPORTS / "feature_importance.csv", index=False, encoding="utf-8-sig")
    print(fi.head(15).to_string(index=False))
    print(f"done in {time.time() - t0:.0f}s; selected={val_report['selected']} thr30={config['threshold_30m']:.4f} thr60={config['threshold_60m']:.4f}")


if __name__ == "__main__":
    main()
