"""평가 지표와 test 세트 최종 평가.

실행: python -m src.evaluate   → reports/test_metrics.json, evaluation_report.md, baseline_comparison.csv,
                                 test_predictions.csv
test는 최종 평가에 한 번만 쓴다. 이 모듈은 모델·임계값을 바꾸지 않는다.
"""
from __future__ import annotations

import json
import pathlib

import numpy as np
import pandas as pd
from sklearn.metrics import (average_precision_score, brier_score_loss, confusion_matrix, f1_score,
                             precision_recall_fscore_support, precision_score, recall_score, roc_auc_score)

from .baseline import LinearTrendBaseline
from .data_loader import load_timeseries
from .features import FEATURE_NAMES
from .inference import GasRiskPredictor
from .rules import GASES
from .window_builder import build_windows

ROOT = pathlib.Path(__file__).resolve().parent.parent
REPORTS = ROOT / "reports"
GAS_CLASSES = GASES + ["NONE"]


# ---------- 기본 지표 ----------
def classification_metrics(y: np.ndarray, p: np.ndarray, thr: float) -> dict:
    y = np.asarray(y).astype(int); p = np.asarray(p, dtype=float)
    pred = (p >= thr).astype(int)
    cm = confusion_matrix(y, pred, labels=[0, 1])
    out = {"threshold": float(thr), "n": int(len(y)), "positives": int(y.sum()),
           "precision": float(precision_score(y, pred, zero_division=0)),
           "recall": float(recall_score(y, pred, zero_division=0)),
           "f1": float(f1_score(y, pred, zero_division=0)),
           "confusion_matrix": {"tn": int(cm[0, 0]), "fp": int(cm[0, 1]), "fn": int(cm[1, 0]), "tp": int(cm[1, 1])},
           "false_negatives": int(cm[1, 0]), "false_positives": int(cm[0, 1])}
    if 0 < y.sum() < len(y):
        out["pr_auc"] = float(average_precision_score(y, p))
        out["roc_auc"] = float(roc_auc_score(y, p))
        out["brier"] = float(brier_score_loss(y, np.clip(p, 0, 1)))
    return out


MIN_RECALL = 0.80


def tradeoff_table(y: np.ndarray, p: np.ndarray, targets=(0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.6, 0.5)) -> list[dict]:
    """목표 Recall별 Precision·임계값·경보 비율(임계값 선택 근거 기록용)."""
    from sklearn.metrics import precision_recall_curve
    y = np.asarray(y).astype(int); p = np.asarray(p, dtype=float)
    pr, rc, th = precision_recall_curve(y, p)
    rows = []
    for tg in targets:
        i = np.where(rc >= tg)[0][-1]
        t = float(th[min(i, len(th) - 1)])
        rows.append({"target_recall": tg, "recall": float(rc[i]), "precision": float(pr[i]), "threshold": t,
                     "flagged_fraction": float((p >= t).mean()), "f1": float(2 * pr[i] * rc[i] / max(pr[i] + rc[i], 1e-9))})
    return rows


def choose_threshold(y: np.ndarray, p: np.ndarray, min_recall: float = MIN_RECALL) -> tuple[float, str]:
    """validation에서 임계값 결정: Recall ≥ min_recall을 만족하는 임계값 중 F1 최대.
    만족하는 것이 없으면 F1 최대. (모든 것을 위험으로 보는 극단은 F1이 낮아 선택되지 않는다)
    min_recall=0.80: 0.90으로 올리면 validation에서 전체 윈도우의 40% 이상이 경보가 되어(정밀도 0.26)
    '모든 상황을 위험으로 보는' 쪽에 가까워지므로 0.80으로 정했다(근거 표는 validation_metrics.json의 tradeoff)."""
    y = np.asarray(y).astype(int); p = np.asarray(p, dtype=float)
    cands = np.unique(np.round(np.quantile(p, np.linspace(0.01, 0.99, 197)), 4))
    best, best_f1, rule = None, -1.0, ""
    for t in cands:
        pred = p >= t
        r = recall_score(y, pred, zero_division=0); f = f1_score(y, pred, zero_division=0)
        if r >= min_recall and f > best_f1:
            best, best_f1 = float(t), f
    if best is not None:
        return best, f"recall>={min_recall} 조건에서 F1 최대 (F1={best_f1:.3f})"
    for t in cands:
        f = f1_score(y, p >= t, zero_division=0)
        if f > best_f1:
            best, best_f1 = float(t), f
    return best, f"recall>={min_recall} 달성 불가 → F1 최대 (F1={best_f1:.3f})"


def gas_metrics(y_gas: np.ndarray, pred_gas: np.ndarray) -> dict:
    y = np.asarray(y_gas).astype(str); p = np.asarray(pred_gas).astype(str)
    pr, rc, f1, sup = precision_recall_fscore_support(y, p, labels=GAS_CLASSES, zero_division=0)
    cm = confusion_matrix(y, p, labels=GAS_CLASSES)
    present = [g for g, s in zip(GAS_CLASSES, sup) if s > 0]
    return {"n": int(len(y)), "accuracy": float((y == p).mean()),
            "macro_f1_all": float(f1_score(y, p, labels=GAS_CLASSES, average="macro", zero_division=0)),
            "macro_f1_gases_only": float(f1_score(y, p, labels=GASES, average="macro", zero_division=0)),
            "none_share": float((y == "NONE").mean()),
            "per_class": {g: {"precision": float(pr[i]), "recall": float(rc[i]), "f1": float(f1[i]), "support": int(sup[i])}
                          for i, g in enumerate(GAS_CLASSES)},
            "confusion_matrix": {"labels": GAS_CLASSES, "rows_true_cols_pred": cm.tolist()}, "classes_present": present}


def time_metrics(y_mtt: np.ndarray, pred_mtt: np.ndarray) -> dict:
    y = np.asarray(y_mtt, dtype=float); p = np.asarray(pred_mtt, dtype=float)
    m = ~np.isnan(y)
    y, p = y[m], p[m]
    cov = ~np.isnan(p)
    out = {"n_true": int(len(y)), "n_predicted": int(cov.sum()), "coverage": float(cov.mean()) if len(y) else 0.0}
    if cov.sum():
        e = p[cov] - y[cov]; a = np.abs(e)
        out.update({"mae": float(a.mean()), "median_ae": float(np.median(a)), "rmse": float(np.sqrt((e ** 2).mean())),
                    "within_5min": float((a <= 5).mean()), "within_10min": float((a <= 10).mean()), "bias": float(e.mean())})
    return out


def true_state(y_mtt: np.ndarray) -> np.ndarray:
    y = np.asarray(y_mtt, dtype=float)
    return np.where(np.isnan(y) | (y > 60), "STABLE", np.where(y <= 30, "IMMINENT", "WATCH"))


# ---------- 추가 평가 ----------
def lead_times(ts: pd.DataFrame, win: pd.DataFrame, out: pd.DataFrame, states=("WATCH", "IMMINENT")) -> dict:
    """에피소드별 선행시간: 첫 초과 전 60분 안에서 처음 비-STABLE 예측이 나온 시점부터 첫 초과까지(분).
    예측이 없으면 0(놓침)으로 센다."""
    leads, detected = [], 0
    pred_state = out["forecast_state"].to_numpy().astype(str)
    for sid, ep in ts.groupby("scenario_id"):
        ex = ep.index[ep["legal_state"] == "EXCEEDED"]
        if len(ex) == 0:
            continue
        t_ex = ep.loc[ex[0], "timestamp"]
        m = (win["scenario_id"] == sid).to_numpy()
        if not m.any():
            leads.append(0.0); continue
        tw = win.loc[m, "timestamp"]
        before = (tw < t_ex) & (tw >= t_ex - pd.Timedelta(minutes=60))
        flagged = before.to_numpy() & np.isin(pred_state[m], states)
        if flagged.any():
            first = tw.to_numpy()[flagged][0]
            leads.append(float((t_ex - pd.Timestamp(first)).total_seconds() / 60)); detected += 1
        else:
            leads.append(0.0)
    leads = np.asarray(leads)
    return {"episodes_with_exceed": int(len(leads)), "detected_before_exceed": int(detected),
            "mean_lead_min_all": float(leads.mean()) if len(leads) else None,
            "mean_lead_min_detected": float(leads[leads > 0].mean()) if detected else None,
            "median_lead_min_detected": float(np.median(leads[leads > 0])) if detected else None}


def false_alarm_rates(ts: pd.DataFrame, win: pd.DataFrame, out: pd.DataFrame) -> dict:
    """정상 작업(에피소드 전체에서 한 번도 EXCEEDED가 없는 작업)에서의 오경보율."""
    never = ts.groupby("scenario_id")["legal_state"].apply(lambda s: not (s == "EXCEEDED").any())
    normal_ids = set(never[never].index)
    m = win["scenario_id"].isin(normal_ids).to_numpy()
    st = out["forecast_state"].to_numpy().astype(str)
    alarm = np.isin(st, ["WATCH", "IMMINENT"])
    ep_alarm = pd.Series(alarm[m]).groupby(win.loc[m, "scenario_id"].to_numpy()).any()
    return {"normal_episodes": int(len(normal_ids)), "windows_in_normal_episodes": int(m.sum()),
            "window_false_alarm_rate": float(alarm[m].mean()) if m.any() else None,
            "window_imminent_false_alarm_rate": float((st[m] == "IMMINENT").mean()) if m.any() else None,
            "episode_false_alarm_rate": float(ep_alarm.mean()) if len(ep_alarm) else None,
            "window_false_alarm_rate_y60_negative": float(alarm[(win["y_risk60"] == 0).to_numpy()].mean())}


def grouped_metrics(win: pd.DataFrame, out: pd.DataFrame, thr: float, by: str) -> dict:
    res = {}
    for k, idx in win.groupby(by).indices.items():
        sub, o = win.iloc[idx], out.iloc[idx]
        r = {"n": int(len(sub))}
        if sub["y_risk30"].sum() > 0:
            r["risk30"] = {k2: v for k2, v in classification_metrics(sub["y_risk30"], o["risk_probability_30m"], thr).items()
                           if k2 in ("precision", "recall", "f1", "positives", "false_negatives", "false_positives")}
        else:
            r["risk30"] = {"positives": 0, "false_positives": int((o["risk_probability_30m"] >= thr).sum())}
        r["gas_macro_f1"] = float(f1_score(sub["y_gas"].astype(str), o["predicted_threshold_gas"].astype(str), labels=GAS_CLASSES, average="macro", zero_division=0))
        r["time"] = {k2: v for k2, v in time_metrics(sub["y_mtt"], o["predicted_minutes_to_threshold"]).items() if k2 in ("n_true", "mae", "within_10min")}
        res[str(k)] = r
    return res


def per_gas_time(win: pd.DataFrame, out: pd.DataFrame) -> dict:
    res = {}
    for g in GASES:
        m = (win["y_gas"] == g).to_numpy()
        res[g] = {k: v for k, v in time_metrics(win.loc[m, "y_mtt"], out.loc[m, "predicted_minutes_to_threshold"]).items() if k in ("n_true", "n_predicted", "mae", "median_ae", "within_5min", "within_10min")}
    return res


def state_metrics(win: pd.DataFrame, out: pd.DataFrame) -> dict:
    ts_ = true_state(win["y_mtt"].to_numpy()); ps = out["forecast_state"].to_numpy().astype(str)
    labels = ["STABLE", "WATCH", "IMMINENT"]
    pr, rc, f1, sup = precision_recall_fscore_support(ts_, ps, labels=labels, zero_division=0)
    cm = confusion_matrix(ts_, ps, labels=labels)
    return {"accuracy": float((ts_ == ps).mean()),
            "per_state": {s: {"precision": float(pr[i]), "recall": float(rc[i]), "f1": float(f1[i]), "support": int(sup[i])} for i, s in enumerate(labels)},
            "confusion_matrix": {"labels": labels, "rows_true_cols_pred": cm.tolist()}}


def recall_by_true_mtt(win: pd.DataFrame, out: pd.DataFrame, thr: float) -> dict:
    """정답 도달시간 구간별 30분 위험 Recall(얼마나 일찍 잡는지)."""
    mtt = win["y_mtt"].to_numpy(dtype=float); p = out["risk_probability_30m"].to_numpy(dtype=float)
    res = {}
    for lo, hi in [(0, 5), (5, 10), (10, 15), (15, 20), (20, 25), (25, 30)]:
        m = (mtt > lo) & (mtt <= hi)
        res[f"{lo}-{hi}min"] = {"n": int(m.sum()), "recall": float((p[m] >= thr).mean()) if m.any() else None}
    return res


def trend_visibility(win: pd.DataFrame) -> np.ndarray:
    """30분 양성 중 '기준 시점에 추세가 보이는' 표본: 위험 가스의 10분 변화량이 40분 표준편차의 2배를 넘는 경우."""
    from .rules import GAS_COL
    gs = win["y_gas"].astype(str).to_numpy()
    vis = np.zeros(len(win), bool)
    for g, c in GAS_COL.items():
        vis |= (gs == g) & (np.abs(win[f"{c}_delta_10m"].to_numpy()) >= 2 * np.maximum(win[f"{c}_std_40m"].to_numpy(), 1e-6))
    return vis


def recall_by_trend(win: pd.DataFrame, out: pd.DataFrame, thr: float) -> dict:
    y = win["y_risk30"].to_numpy() == 1; p = out["risk_probability_30m"].to_numpy(dtype=float) >= thr
    vis = trend_visibility(win)
    return {"positives_trend_visible": int((y & vis).sum()), "positives_trend_not_visible": int((y & ~vis).sum()),
            "recall_trend_visible": float(p[y & vis].mean()) if (y & vis).any() else None,
            "recall_trend_not_visible": float(p[y & ~vis].mean()) if (y & ~vis).any() else None}


def full_metrics(win: pd.DataFrame, out: pd.DataFrame, thr: float, ts: pd.DataFrame | None = None) -> dict:
    res = {"n_windows": int(len(win)),
           "recall_by_true_mtt": recall_by_true_mtt(win, out, thr),
           "recall_by_trend_visibility": recall_by_trend(win, out, thr),
           "risk30": classification_metrics(win["y_risk30"], out["risk_probability_30m"], thr),
           "risk60_from_state": classification_metrics(win["y_risk60"], (out["forecast_state"] != "STABLE").astype(float), 0.5),
           "gas": gas_metrics(win["y_gas"], out["predicted_threshold_gas"]),
           "time": time_metrics(win["y_mtt"], out["predicted_minutes_to_threshold"]),
           "time_per_gas": per_gas_time(win, out),
           "forecast_state": state_metrics(win, out),
           "by_task_type": grouped_metrics(win, out, thr, "task_type"),
           "by_task_state": grouped_metrics(win, out, thr, "task_state")}
    if ts is not None:
        sub_ts = ts[ts["scenario_id"].isin(win["scenario_id"].unique())]
        res["false_alarm"] = false_alarm_rates(sub_ts, win, out)
        res["lead_time"] = lead_times(sub_ts, win, out)
        res["lead_time_imminent_only"] = lead_times(sub_ts, win, out, states=("IMMINENT",))
    return res


# ---------- 보고서 ----------
def _f(x, d=3):
    return "-" if x is None or (isinstance(x, float) and np.isnan(x)) else f"{x:.{d}f}"


def comparison_row(name: str, m: dict) -> dict:
    return {"모델": name,
            "30분 위험 Recall": round(m["risk30"]["recall"], 3), "30분 위험 Precision": round(m["risk30"]["precision"], 3),
            "30분 위험 F1": round(m["risk30"]["f1"], 3), "30분 위험 PR-AUC": round(m["risk30"].get("pr_auc", float("nan")), 3),
            "위험 가스 Macro F1": round(m["gas"]["macro_f1_all"], 3), "위험 가스 Macro F1(가스만)": round(m["gas"]["macro_f1_gases_only"], 3),
            "도달시간 MAE": round(m["time"].get("mae", float("nan")), 2), "도달시간 ±10분 비율": round(m["time"].get("within_10min", float("nan")), 3),
            "오경보율(정상작업 윈도우)": round(m["false_alarm"]["window_false_alarm_rate"], 4),
            "오경보율(정상작업 에피소드)": round(m["false_alarm"]["episode_false_alarm_rate"], 3),
            "평균 선행시간(분, 전체)": round(m["lead_time"]["mean_lead_min_all"], 1),
            "평균 선행시간(분, 탐지분)": round(m["lead_time"]["mean_lead_min_detected"] or float("nan"), 1),
            "초과 전 탐지 비율": round(m["lead_time"]["detected_before_exceed"] / max(1, m["lead_time"]["episodes_with_exceed"]), 3)}


def write_report(cfg: dict, val: dict, test_model: dict, test_base: dict, comp: pd.DataFrame, unavailable: dict, path: pathlib.Path):
    r30, g, t = test_model["risk30"], test_model["gas"], test_model["time"]
    b30 = test_base["risk30"]
    L = ["# 평가 보고서 (test 세트, 1회 평가)", "",
         "**학습·평가 데이터는 모두 합성 데이터다. 아래 수치는 합성 시나리오에서 기능을 확인한 것이며 현장 정확도를 뜻하지 않는다.**", "",
         "## 선택한 모델", "",
         f"- 60분 위험 분류: {cfg['selected']['risk60']} / 30분 위험 분류: {cfg['selected']['risk30']} / 위험 가스: {cfg['selected']['gas']} / 도달시간 회귀: {cfg['selected']['time']}",
         f"- 확률 임계값(validation에서 결정): 30분 {cfg['threshold_30m']:.4f} ({cfg['threshold_30m_rule']}), 60분 {cfg['threshold_60m']:.4f} ({cfg['threshold_60m_rule']})",
         f"- 특성 수 {len(cfg['feature_names'])}, 학습 윈도우 train {cfg['n_windows']['train']:,} / validation {cfg['n_windows']['validation']:,} / test {test_model['n_windows']:,}",
         "", "## 기준선 비교 (같은 test 윈도우)", "", comp.to_markdown(index=False), "",
         "## 30분 내 초과 예측 (최종 모델)", "",
         f"- Precision {_f(r30['precision'])} / Recall {_f(r30['recall'])} / F1 {_f(r30['f1'])} / PR-AUC {_f(r30.get('pr_auc'))} / ROC-AUC {_f(r30.get('roc_auc'))} / Brier {_f(r30.get('brier'), 4)}",
         f"- Confusion matrix: TN {r30['confusion_matrix']['tn']:,} FP {r30['confusion_matrix']['fp']:,} FN {r30['confusion_matrix']['fn']:,} TP {r30['confusion_matrix']['tp']:,} (양성 {r30['positives']:,} / {r30['n']:,})",
         f"- 기준선: Precision {_f(b30['precision'])} / Recall {_f(b30['recall'])} / F1 {_f(b30['f1'])} / FN {b30['false_negatives']:,} / FP {b30['false_positives']:,}",
         "", "## 위험 가스 예측 (최종 모델)", "",
         f"- Accuracy {_f(g['accuracy'])} / Macro F1(NONE 포함) {_f(g['macro_f1_all'])} / Macro F1(5가스만) {_f(g['macro_f1_gases_only'])} / NONE 비율 {_f(g['none_share'])}",
         "", "| 가스 | Precision | Recall | F1 | support |", "|---|---|---|---|---|"]
    L += [f"| {k} | {_f(v['precision'])} | {_f(v['recall'])} | {_f(v['f1'])} | {v['support']:,} |" for k, v in g["per_class"].items()]
    cm = g["confusion_matrix"]
    L += ["", "Confusion matrix (행=정답, 열=예측, 순서 " + "/".join(cm["labels"]) + "):", "", "```"] + [" ".join(f"{x:6d}" for x in row) for row in cm["rows_true_cols_pred"]] + ["```", ""]
    L += ["## 기준 도달시간 예측 (최종 모델, 정답이 있는 윈도우)", "",
          f"- 정답 있는 윈도우 {t['n_true']:,}, 시간 예측 산출 {t['n_predicted']:,} (coverage {_f(t['coverage'])})",
          f"- MAE {_f(t.get('mae'), 2)}분 / Median AE {_f(t.get('median_ae'), 2)}분 / RMSE {_f(t.get('rmse'), 2)}분 / ±5분 {_f(t.get('within_5min'))} / ±10분 {_f(t.get('within_10min'))} / 편향 {_f(t.get('bias'), 2)}분",
          "", "| 가스 | n | MAE | Median AE | ±5분 | ±10분 |", "|---|---|---|---|---|---|"]
    L += [f"| {k} | {v['n_true']} | {_f(v.get('mae'), 2)} | {_f(v.get('median_ae'), 2)} | {_f(v.get('within_5min'))} | {_f(v.get('within_10min'))} |" for k, v in test_model["time_per_gas"].items()]
    fs = test_model["forecast_state"]
    L += ["", "## STABLE / WATCH / IMMINENT (정답은 실제 minutes_to_threshold로 정의)", "", f"- 정확도 {_f(fs['accuracy'])}", "",
          "| 상태 | Precision | Recall | F1 | support |", "|---|---|---|---|---|"]
    L += [f"| {k} | {_f(v['precision'])} | {_f(v['recall'])} | {_f(v['f1'])} | {v['support']:,} |" for k, v in fs["per_state"].items()]
    L += ["", "## 작업 종류별", "", "| 작업 | n | 30분 Recall | 30분 Precision | FN | FP | 가스 Macro F1 | 시간 MAE |", "|---|---|---|---|---|---|---|---|"]
    for k, v in test_model["by_task_type"].items():
        r = v["risk30"]
        L.append(f"| {k} | {v['n']:,} | {_f(r.get('recall'))} | {_f(r.get('precision'))} | {r.get('false_negatives', 0)} | {r.get('false_positives', 0)} | {_f(v['gas_macro_f1'])} | {_f(v['time'].get('mae'), 2)} |")
    L += ["", "## 작업 상태별", "", "| 상태 | n | 30분 Recall | 30분 Precision | FN | FP | 가스 Macro F1 | 시간 MAE |", "|---|---|---|---|---|---|---|---|"]
    for k, v in test_model["by_task_state"].items():
        r = v["risk30"]
        L.append(f"| {k} | {v['n']:,} | {_f(r.get('recall'))} | {_f(r.get('precision'))} | {r.get('false_negatives', 0)} | {r.get('false_positives', 0)} | {_f(v['gas_macro_f1'])} | {_f(v['time'].get('mae'), 2)} |")
    rb, rt = test_model["recall_by_true_mtt"], test_model["recall_by_trend_visibility"]
    L += ["", "## 얼마나 일찍 잡는가 (정답 도달시간 구간별 30분 위험 Recall, 최종 모델)", "",
          "| 정답 도달시간 | n | Recall |", "|---|---|---|"]
    L += [f"| {k} | {v['n']} | {_f(v['recall'])} |" for k, v in rb.items()]
    L += ["", f"- 30분 양성 중 기준 시점에 추세가 보이는 표본(위험 가스 10분 변화량 ≥ 2×40분 표준편차) {rt['positives_trend_visible']:,}개: Recall {_f(rt['recall_trend_visible'])}",
          f"- 추세가 아직 보이지 않는 표본 {rt['positives_trend_not_visible']:,}개: Recall {_f(rt['recall_trend_not_visible'])} (이 표본은 가스값만으로는 맞힐 수 없고 작업 종류·경과 시간 사전확률로만 맞힌다)"]
    fa, lt, lti = test_model["false_alarm"], test_model["lead_time"], test_model["lead_time_imminent_only"]
    L += ["", "## 정상 작업 오경보율·선행시간·UNAVAILABLE", "",
          f"- 정상 작업(초과가 한 번도 없는 에피소드) {fa['normal_episodes']}개, 윈도우 {fa['windows_in_normal_episodes']:,}: WATCH/IMMINENT 오경보율 {_f(fa['window_false_alarm_rate'], 4)}, IMMINENT만 {_f(fa['window_imminent_false_alarm_rate'], 4)}, 에피소드 단위(한 번이라도 경보) {_f(fa['episode_false_alarm_rate'])}",
          f"- 60분 내 초과가 없는 모든 윈도우 기준 오경보율 {_f(fa['window_false_alarm_rate_y60_negative'], 4)}",
          f"- 초과 에피소드 {lt['episodes_with_exceed']}개 중 초과 전 WATCH/IMMINENT 탐지 {lt['detected_before_exceed']}개, 평균 선행시간 전체 {_f(lt['mean_lead_min_all'], 1)}분 / 탐지분 {_f(lt['mean_lead_min_detected'], 1)}분 (중앙값 {_f(lt['median_lead_min_detected'], 1)}분)",
          f"- IMMINENT 기준: 탐지 {lti['detected_before_exceed']}개, 평균 선행시간 전체 {_f(lti['mean_lead_min_all'], 1)}분 / 탐지분 {_f(lti['mean_lead_min_detected'], 1)}분",
          f"- UNAVAILABLE 처리: test 1분 간격 기준 시점 {unavailable['anchors_total']:,}개 중 {unavailable['unavailable']:,}개 ({_f(unavailable['unavailable_rate'])}) — 사유: {unavailable['reasons']}",
          "", "## 상태 안정화 후처리 효과 (test, 에피소드별 시간순 적용)", "",
          "| 연속 확인 횟수 | IMMINENT Recall | IMMINENT Precision | 정상작업 윈도우 오경보율 | 정상작업 에피소드 오경보율 | 평균 선행시간(전체) | 초과 전 탐지 |", "|---|---|---|---|---|---|---|"]
    for k, v in test_model["stabilization"].items():
        L.append(f"| {k} | {_f(v['risk30_from_state']['recall'])} | {_f(v['risk30_from_state']['precision'])} | {_f(v['false_alarm']['window_false_alarm_rate'], 4)} | {_f(v['false_alarm']['episode_false_alarm_rate'])} | {_f(v['lead_time']['mean_lead_min_all'], 1)} | {v['lead_time']['detected_before_exceed']}/{v['lead_time']['episodes_with_exceed']} |")
    L += ["", "## validation 요약(모델 선택 근거)", ""]
    for key in ("risk30", "risk60"):
        c = val.get("calibration", {}).get(key)
        if c:
            L.append(f"- {key} 확률 보정: {c['method']} (validation Brier {_f(c['brier_raw'])} → {_f(c['brier_calibrated'])}, 적용 {c['used']})")
    tr_ = val["candidates"]["risk30"].get(val["selected"]["risk30"], {}).get("tradeoff")
    if tr_:
        L += ["", "30분 모델(선택 모델, 보정 전) validation Recall–Precision 절충표(임계값 선택 근거):", "",
              "| 목표 Recall | Recall | Precision | 임계값 | 경보 비율 | F1 |", "|---|---|---|---|---|---|"]
        L += [f"| {r['target_recall']} | {_f(r['recall'])} | {_f(r['precision'])} | {_f(r['threshold'], 3)} | {_f(r['flagged_fraction'])} | {_f(r['f1'])} |" for r in tr_]
        L.append("")
    for task, cands in val["candidates"].items():
        L.append(f"- {task}: " + "; ".join(f"{n} → {', '.join(f'{k}={_f(v)}' for k, v in m.items() if isinstance(v, (int, float)) and k in ('pr_auc', 'roc_auc', 'brier', 'f1', 'recall', 'macro_f1', 'mae', 'within_10min'))}" for n, m in cands.items()) + f" → 선택 {val['selected'][task]}")
    L += ["", "## 해석", "",
          f"- 최종 모델은 기준선보다 30분 위험 Recall({_f(b30['recall'])}→{_f(r30['recall'])}), F1({_f(b30['f1'])}→{_f(r30['f1'])}), 선행시간에서 분명히 낫다. 도달시간 MAE와 정상작업 윈도우 오경보율은 비슷하다.",
          f"- 정밀도 {_f(r30['precision'])}, 정상 작업 윈도우 오경보율 {_f(fa['window_false_alarm_rate'])}, 정상 에피소드의 {_f(fa['episode_false_alarm_rate'])}에서 한 번 이상 경보가 난다. 안정화 후처리는 흔들림만 줄이고 에피소드 단위 오경보는 줄이지 못한다.",
          f"- 30분 양성의 {_f(rt['positives_trend_not_visible'] / max(1, rt['positives_trend_visible'] + rt['positives_trend_not_visible']))}는 기준 시점에 추세가 보이지 않아 가스값으로는 맞힐 수 없고, 모델은 작업 종류·경과 시간 사전확률로 맞힌다. 이 데이터로 입증된 것은 '합성 시나리오에서 기능이 동작한다'까지이며, 가스 추세 기반 조기 경보의 실제 가능성은 현장 상승 속도를 확인해야 한다.", ""]
    path.write_text("\n".join(L) + "\n", encoding="utf-8")


def stabilized_outputs(win: pd.DataFrame, out: pd.DataFrame, n_confirm: int) -> pd.DataFrame:
    """에피소드별 시간순으로 StateStabilizer를 적용한 공개 결과(적격 윈도우 열만 순서대로 사용)."""
    from .stabilization import StateStabilizer
    res = out.copy()
    cols = ["prediction_status", "forecast_state", "predicted_threshold_gas", "predicted_minutes_to_threshold", "risk_probability_30m"]
    for sid, idx in win.groupby("scenario_id").indices.items():
        order = idx[np.argsort(win["row_in_episode"].to_numpy()[idx])]
        st = StateStabilizer(n_confirm)
        for i in order:
            r = {c: out.iloc[i][c] for c in cols}
            r["predicted_minutes_to_threshold"] = None if pd.isna(r["predicted_minutes_to_threshold"]) else float(r["predicted_minutes_to_threshold"])
            r["risk_probability_30m"] = float(r["risk_probability_30m"])
            pub = st.update(r)
            for c in cols:
                res.iat[i, res.columns.get_loc(c)] = pub[c] if pub[c] is not None else (np.nan if c == "predicted_minutes_to_threshold" else pub[c])
    return res


def stabilization_effect(ts: pd.DataFrame, win: pd.DataFrame, out: pd.DataFrame, thr: float) -> dict:
    sub_ts = ts[ts["scenario_id"].isin(win["scenario_id"].unique())]
    res = {}
    for n in (1, 2, 3):
        o = out if n == 1 else stabilized_outputs(win, out, n)
        res[f"n_confirm={n}"] = {"risk30_from_state": {k: v for k, v in classification_metrics(win["y_risk30"], (o["forecast_state"] == "IMMINENT").astype(float), 0.5).items() if k in ("precision", "recall", "f1")},
                                 "false_alarm": false_alarm_rates(sub_ts, win, o), "lead_time": lead_times(sub_ts, win, o)}
    return res


def unavailable_rate(ts: pd.DataFrame, predictor: GasRiskPredictor) -> dict:
    """test 1분 간격 모든 기준 시점에서 UNAVAILABLE 사유별 비율(법정 초과 포함)."""
    allw = build_windows(ts, splits=["test"], all_anchors=True)
    reasons = {}
    q = allw["quality_flag_now"].astype(str).to_numpy(); ls = allw["legal_state_now"].astype(str).to_numpy()
    vr = allw["valid_ratio"].to_numpy(); wl = allw["window_len_min"].to_numpy()
    r = np.full(len(allw), "PREDICTED", dtype=object)
    r[(q == "OK") & (ls == "EXCEEDED")] = "legal_exceeded(rule)"
    r[q == "SENSOR_ERROR"] = "latest_SENSOR_ERROR"
    r[q == "MISSING"] = "latest_MISSING"
    r[q == "COMM_LOSS"] = "latest_COMM_LOSS"
    r[(r == "PREDICTED") & (wl < 10)] = "less_than_10_minutes"
    r[(r == "PREDICTED") & (vr < 0.8)] = "valid_ratio<0.8"
    r[(r == "PREDICTED") & ~allw["eligible"].to_numpy()] = "insufficient_valid_history"
    cnt = pd.Series(r).value_counts().to_dict()
    n_un = sum(v for k, v in cnt.items() if k != "PREDICTED")
    return {"anchors_total": int(len(allw)), "unavailable": int(n_un), "unavailable_rate": float(n_un / len(allw)),
            "reasons": {k: int(v) for k, v in cnt.items() if k != "PREDICTED"}}


def main():
    REPORTS.mkdir(exist_ok=True)
    ts = load_timeseries()
    pred = GasRiskPredictor()
    cfg = pred.config
    with open(REPORTS / "validation_metrics.json", encoding="utf-8") as f:
        val = json.load(f)
    win = build_windows(ts, splits=["test"]).reset_index(drop=True)
    out = pred.predict_features(win, with_internals=True)
    base = LinearTrendBaseline(10).predict_frame(win)
    base5 = LinearTrendBaseline(5).predict_frame(win)
    m_model = full_metrics(win, out, pred.thr30, ts)
    m_base = full_metrics(win, base, 0.5, ts)
    m_base5 = full_metrics(win, base5, 0.5, ts)
    unav = unavailable_rate(ts, pred)
    m_model["unavailable"] = unav
    m_model["stabilization"] = stabilization_effect(ts, win, out, pred.thr30)
    comp = pd.DataFrame([comparison_row("선형 추세 기준선(10분 기울기)", m_base), comparison_row("선형 추세 기준선(5분 기울기)", m_base5),
                         comparison_row(f"최종 모델({cfg['selected']['risk30']} 등 4단계)", m_model)])
    comp.to_csv(REPORTS / "baseline_comparison.csv", index=False, encoding="utf-8-sig")
    with open(REPORTS / "test_metrics.json", "w", encoding="utf-8") as f:
        json.dump({"model": m_model, "baseline_10m": m_base, "baseline_5m": m_base5}, f, ensure_ascii=False, indent=1)
    tp = win[["scenario_id", "timestamp", "task_type", "task_state", "y_risk30", "y_risk60", "y_gas", "y_mtt"]].copy()
    for c in ["prediction_status", "forecast_state", "predicted_threshold_gas", "predicted_minutes_to_threshold", "risk_probability_30m"]:
        tp[c] = out[c].to_numpy()
    tp["baseline_forecast_state"] = base["forecast_state"].to_numpy(); tp["baseline_gas"] = base["predicted_threshold_gas"].to_numpy()
    tp["baseline_minutes"] = base["predicted_minutes_to_threshold"].to_numpy()
    tp.to_csv(REPORTS / "test_predictions.csv", index=False)
    write_report(cfg, val, m_model, m_base, comp, unav, REPORTS / "evaluation_report.md")
    print(comp.to_string(index=False))
    print("UNAVAILABLE:", unav)


if __name__ == "__main__":
    main()
