"""에피소드 계획과 가스 곡선 생성 (물리 모델 없음).

한 에피소드 = 작업 종류 + 상황(kind) + 시간 구조(PRE_WORK/WORK/RECOVERY) + 가스별 곡선 + 센서 이상.
가스 곡선 = 배경값 + 정점 × 모양(t). 모양: 시작 시각부터 1−exp(−Δt/τ_rise)로 완만히 상승 → 유지 → exp(−Δt/τ_decay)로 점진 감소.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

GASES = ["O2", "LEL", "CO", "H2S", "CO2"]
COL = {"O2": "o2_pct", "LEL": "lel_pct", "CO": "co_ppm", "H2S": "h2s_ppm", "CO2": "co2_pct"}
KIND_NORMAL, KIND_MILD = "NORMAL", "MILD_CHANGE"
KIND_APPROACH, KIND_EXCEED = "APPROACH", "EXCEED"
KIND_REC_WORK, KIND_REC_AFTER = "RECOVERY_IN_WORK", "RECOVERY_AFTER_WORK"
FAULT_NONE, FAULT_SHORT, FAULT_COMM, FAULT_ERROR, FAULT_BEFORE = "NONE", "SHORT_MISSING", "COMM_LOSS", "SENSOR_ERROR", "MISSING_BEFORE_DANGER"


@dataclass
class Spec:
    index: int
    task_type: str
    kind: str            # NORMAL / MILD_CHANGE / APPROACH / EXCEED / RECOVERY_IN_WORK / RECOVERY_AFTER_WORK
    gas: str | None      # 위험 가스 (NORMAL/MILD는 None 또는 완만 변화 가스)
    fault: str = FAULT_NONE


@dataclass
class Episode:
    spec: Spec
    seed: int
    n: int
    t_s: np.ndarray
    task_state: np.ndarray
    task_start_s: int | None
    task_end_s: int | None
    values: dict = field(default_factory=dict)   # gas → float array (NaN = 결측)
    quality: np.ndarray = None
    sensor_id: str = ""
    zone_id: str = ""
    ptw_id: str = ""


def _u(rng, r):
    return float(rng.uniform(r[0], r[1]))


def _thr(cfg):
    t = cfg["thresholds"]
    return {"O2_low": t["o2_low_pct"], "O2_high": t["o2_high_pct"], "CO": t["co_ppm"], "H2S": t["h2s_ppm"], "CO2": t["co2_pct"], "LEL": t["lel_pct"]}


def build_specs(cfg: dict, rng: np.random.Generator) -> list[Spec]:
    """설정의 개수대로 에피소드 명세 목록을 만든다(결정적: rng 시드에 따름)."""
    ep = cfg["episodes"]
    tasks = list(cfg["task_types"])
    danger_tasks = [t for t in tasks if t != "NONE"]
    w = cfg["task_gas_weight"]

    def pick_task_for_gas(g):
        ws = np.array([float(w[t].get(g, 1.0)) for t in danger_tasks]); ws /= ws.sum()
        return str(rng.choice(danger_tasks, p=ws))

    specs: list[Spec] = []
    for t in tasks:
        for _ in range(int(ep["normal_per_task"])):
            specs.append(Spec(0, t, KIND_NORMAL, None))
    for _ in range(int(ep["mild_change"])):
        g = str(rng.choice(GASES)); specs.append(Spec(0, pick_task_for_gas(g), KIND_MILD, g))
    for g in GASES:
        for _ in range(int(ep["approach_per_gas"])):
            specs.append(Spec(0, pick_task_for_gas(g), KIND_APPROACH, g))
        for _ in range(int(ep["exceed_per_gas"])):
            specs.append(Spec(0, pick_task_for_gas(g), KIND_EXCEED, g))
    for _ in range(int(ep["recovery_in_work"])):
        g = str(rng.choice(GASES)); specs.append(Spec(0, pick_task_for_gas(g), KIND_REC_WORK, g))
    for _ in range(int(ep["recovery_after_work"])):
        g = str(rng.choice(GASES)); specs.append(Spec(0, pick_task_for_gas(g), KIND_REC_AFTER, g))
    p_d = float(ep["sensor_overlay_on_danger_prob"])
    for fault, key in [(FAULT_SHORT, "sensor_short_missing"), (FAULT_COMM, "sensor_comm_loss"), (FAULT_ERROR, "sensor_error")]:
        for _ in range(int(ep[key])):
            if rng.random() < p_d:
                g = str(rng.choice(GASES)); kind = str(rng.choice([KIND_APPROACH, KIND_EXCEED]))
                specs.append(Spec(0, pick_task_for_gas(g), kind, g, fault))
            else:
                t = str(rng.choice(tasks)); specs.append(Spec(0, t, KIND_NORMAL, None, fault))
    for _ in range(int(ep["missing_before_danger"])):
        g = str(rng.choice(GASES)); specs.append(Spec(0, pick_task_for_gas(g), KIND_EXCEED, g, FAULT_BEFORE))
    # 작업 종류별 최소 수 보충(정상 에피소드)
    counts = pd.Series([s.task_type for s in specs]).value_counts()
    for t in tasks:
        for _ in range(max(0, int(ep["min_per_task"]) - int(counts.get(t, 0)))):
            specs.append(Spec(0, t, KIND_NORMAL, None))
    order = rng.permutation(len(specs))
    specs = [specs[i] for i in order]
    for i, s in enumerate(specs):
        s.index = i
    return specs


def _shape(t_min: np.ndarray, t0: float, tau_r: float, t1: float, tau_d: float) -> np.ndarray:
    """0→1 완만 상승(t0부터, τ_r) → t1까지 유지 → 지수 감소(τ_d). 값 범위 [0,1], 연속."""
    s = np.zeros_like(t_min)
    rise = (t_min >= t0) & (t_min < t1)
    s[rise] = 1.0 - np.exp(-(t_min[rise] - t0) / tau_r)
    level_at_t1 = 1.0 - math.exp(-max(t1 - t0, 0.0) / tau_r)
    dec = t_min >= t1
    s[dec] = level_at_t1 * np.exp(-(t_min[dec] - t1) / tau_d)
    return s


def generate_episode(cfg: dict, spec: Spec, seed: int) -> Episode:
    rng = np.random.default_rng(seed)
    tm = cfg["time"]; step = int(tm["sample_interval_s"])
    thr = _thr(cfg); band = cfg["approach_band"]; bg = cfg["background"]; cv = cfg["curve"]

    # ---------- 시간 구조 ----------
    if spec.task_type == "NONE":
        total_min = _u(rng, tm["none_episode_min"]); pre_min = total_min; work_min = 0.0; rec_min = 0.0
        ts_s = None; te_s = None
    else:
        pre_min = _u(rng, tm["pre_work_min"]); work_min = _u(rng, tm["work_min"]); rec_min = _u(rng, tm["recovery_min"])
        total_min = min(pre_min + work_min + rec_min, float(tm["total_max_min"]))
        rec_min = total_min - pre_min - work_min
        ts_s = int(round(pre_min * 60 / step) * step); te_s = int(round((pre_min + work_min) * 60 / step) * step)
    n = int(total_min * 60 / step) + 1
    t_s = np.arange(n) * step
    t_min = t_s / 60.0
    if ts_s is None:
        state = np.array(["PRE_WORK"] * n, dtype=object)
    else:
        state = np.where(t_s < ts_s, "PRE_WORK", np.where(t_s < te_s, "WORK", "RECOVERY")).astype(object)

    # ---------- 배경 ----------
    base = {g: _u(rng, bg[COL[g]]) for g in GASES}
    clean = {g: np.full(n, base[g]) for g in GASES}

    # ---------- 위험·변화 곡선 ----------
    def add_excursion(g: str, peak_value: float, t0: float, tau_r: float, t1: float, tau_d: float):
        amp = peak_value - base[g]
        clean[g] += amp * _shape(t_min, t0, tau_r, t1, tau_d)

    def choose_peak(g: str, kind: str) -> float:
        if g == "O2":
            high = rng.random() < float(cfg["o2_high_fraction"])
            key = "o2_high" if high else "o2_low"
        else:
            key = g.lower()
        table = cfg["approach_peak"] if kind == KIND_APPROACH else cfg["exceed_peak"]
        return _u(rng, table[key])

    def mild_peak(g: str) -> float:
        f = _u(rng, cfg["mild_fraction_of_gap"])
        if g == "O2":
            if rng.random() < float(cfg["o2_high_fraction"]):
                edge = thr["O2_high"] - band["o2_pct"]; return base[g] + f * (edge - base[g])
            edge = thr["O2_low"] + band["o2_pct"]; return base[g] - f * (base[g] - edge)
        edge = thr[g] - band[COL[g]]
        return base[g] + f * (edge - base[g])

    if spec.task_type != "NONE" and spec.kind != KIND_NORMAL:
        work_start_min = ts_s / 60.0; work_end_min = te_s / 60.0
        t0 = work_start_min + min(_u(rng, cv["onset_after_start_min"]), 0.45 * work_min)
        tau_r = _u(rng, cv["rise_tau_min"]); tau_d = _u(rng, cv["decay_tau_min"])
        if spec.kind == KIND_MILD:
            t1 = t0 + 3 * tau_r + _u(rng, cv["hold_min"])
            add_excursion(spec.gas, mild_peak(spec.gas), t0, tau_r, t1, tau_d)
        elif spec.kind in (KIND_APPROACH, KIND_EXCEED):
            t1 = t0 + 3 * tau_r + _u(rng, cv["hold_min"])
            add_excursion(spec.gas, choose_peak(spec.gas, spec.kind), t0, tau_r, t1, tau_d)
        elif spec.kind == KIND_REC_WORK:
            # 작업 중 초과 → 짧게 유지 → 작업 중에 정상으로 회복
            tau_r = min(tau_r, 8.0); t1 = t0 + 3 * tau_r + _u(rng, cv["recover_in_work_hold_min"])
            tau_d = min(tau_d, 8.0)
            t1 = min(t1, work_end_min - 15.0) if work_end_min - 15.0 > t0 + 3 else t1
            add_excursion(spec.gas, choose_peak(spec.gas, KIND_EXCEED), t0, tau_r, t1, tau_d)
        elif spec.kind == KIND_REC_AFTER:
            # 작업 중 상승(경계 또는 초과), 작업 종료 시점부터 점진 감소
            kind = str(rng.choice([KIND_APPROACH, KIND_EXCEED]))
            tau_r = min(tau_r, max(3.0, (work_end_min - t0) / 3.0))
            add_excursion(spec.gas, choose_peak(spec.gas, kind), t0, tau_r, work_end_min, tau_d)
        # 다른 가스 1~2개의 완만한 동반 변화
        if rng.random() < float(cv["secondary_drift_prob"]):
            others = [g for g in GASES if g != spec.gas]
            for g in rng.choice(others, size=int(rng.integers(1, 3)), replace=False):
                tr = _u(rng, cv["rise_tau_min"]); td = _u(rng, cv["decay_tau_min"])
                tt0 = t0 + _u(rng, [0, 10]); tt1 = tt0 + 3 * tr + _u(rng, [3, 20])
                add_excursion(str(g), mild_peak(str(g)), tt0, tr, tt1, td)

    # ---------- 잡음 · 해상도 ----------
    vals = {}
    for g in GASES:
        v = clean[g] + rng.normal(0.0, float(cfg["noise_sd"][COL[g]]), size=n)
        r = float(cfg["resolution"][COL[g]])
        v = np.round(v / r) * r
        if g == "O2":
            v = np.clip(v, 0.0, 25.0)
        else:
            v = np.maximum(v, 0.0)
        vals[g] = v
    quality = np.array(["OK"] * n, dtype=object)

    # ---------- 센서 이상 ----------
    sf = cfg["sensor_faults"]
    missing = np.zeros(n, dtype=bool)
    if spec.fault == FAULT_SHORT:
        k = int(rng.integers(sf["short_missing"]["count"][0], sf["short_missing"]["count"][1] + 1))
        for _ in range(k):
            L = int(rng.integers(sf["short_missing"]["samples"][0], sf["short_missing"]["samples"][1] + 1))
            s0 = int(rng.integers(1, max(2, n - L)))
            missing[s0:s0 + L] = True; quality[s0:s0 + L] = "MISSING"
    elif spec.fault == FAULT_COMM:
        d = int(_u(rng, sf["comm_loss_min"]) * 60 / step)
        s0 = int(rng.integers(max(1, n // 6), max(2, n - d - 1)))
        missing[s0:s0 + d] = True; quality[s0:s0 + d] = "COMM_LOSS"
    elif spec.fault == FAULT_ERROR:
        k = int(rng.integers(sf["sensor_error"]["count"][0], sf["sensor_error"]["count"][1] + 1))
        for _ in range(k):
            L = int(rng.integers(sf["sensor_error"]["samples"][0], sf["sensor_error"]["samples"][1] + 1))
            s0 = int(rng.integers(1, max(2, n - L)))
            g = str(rng.choice(GASES)); mag = _u(rng, sf["sensor_error_magnitude"][COL[g]]) * (1 if rng.random() < 0.5 else -1)
            vals[g][s0:s0 + L] = np.maximum(vals[g][s0:s0 + L] + mag, 0.0)
            quality[s0:s0 + L] = "SENSOR_ERROR"
    elif spec.fault == FAULT_BEFORE:
        # 첫 초과 시점 직전부터 통신 두절
        ex = np.zeros(n, dtype=bool)
        for g in GASES:
            ex |= _exceed(g, vals[g], thr)
        if ex.any():
            i0 = int(np.argmax(ex)); lead = int(_u(rng, sf["missing_before_danger"]["lead_min"]) * 60 / step)
            d = int(_u(rng, sf["missing_before_danger"]["duration_min"]) * 60 / step)
            s0 = max(1, i0 - lead)
        else:
            d = int(_u(rng, sf["missing_before_danger"]["duration_min"]) * 60 / step); s0 = int(rng.integers(1, max(2, n - d)))
        missing[s0:s0 + d] = True; quality[s0:s0 + d] = "COMM_LOSS"
    for g in GASES:
        vals[g][missing] = np.nan

    ep = Episode(spec, seed, n, t_s, state, ts_s, te_s, vals, quality,
                 sensor_id=f"GS-{int(rng.integers(1, 80)):03d}",
                 zone_id=f"Z-{int(rng.integers(1, 40)):03d}",
                 ptw_id=f"PTW-{int(rng.integers(1000, 9999))}")
    return ep


def _exceed(g: str, v: np.ndarray, thr: dict) -> np.ndarray:
    v = np.nan_to_num(v, nan=(20.9 if g == "O2" else 0.0))
    if g == "O2":
        return (v < thr["O2_low"]) | (v >= thr["O2_high"])
    return v >= thr[g]


def _approach(g: str, v: np.ndarray, thr: dict, band: dict) -> np.ndarray:
    v = np.nan_to_num(v, nan=(20.9 if g == "O2" else 0.0))
    if g == "O2":
        b = band["o2_pct"]
        return ((v >= thr["O2_low"]) & (v < thr["O2_low"] + b)) | ((v < thr["O2_high"]) & (v >= thr["O2_high"] - b))
    b = band[COL[g]]
    return (v < thr[g]) & (v >= thr[g] - b)


def label_episode(cfg: dict, ep: Episode) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """legal_state, threshold_gas, minutes_to_threshold (측정값 기준)."""
    thr = _thr(cfg); band = cfg["approach_band"]
    step = int(cfg["time"]["sample_interval_s"]); H = float(cfg["time"]["prediction_horizon_min"])
    n = ep.n
    missing = np.isnan(ep.values["O2"])
    ex = {g: _exceed(g, ep.values[g], thr) & ~missing for g in GASES}
    ap = np.zeros(n, dtype=bool)
    any_ex = np.zeros(n, dtype=bool)
    for g in GASES:
        any_ex |= ex[g]; ap |= _approach(g, ep.values[g], thr, band)
    state = np.where(missing, "UNAVAILABLE", np.where(any_ex, "EXCEEDED", np.where(ap, "APPROACH", "NORMAL"))).astype(object)
    # 다음 초과 시점(가스별)
    nxt = {}
    for g in GASES:
        a = np.full(n, -1, dtype=np.int64); last = -1
        for i in range(n - 1, -1, -1):
            if ex[g][i]:
                last = i
            a[i] = last
        nxt[g] = a
    mtt = np.full(n, np.nan); tgas = np.array([""] * n, dtype=object)
    hmax = H * 60 / step
    for i in range(n):
        if missing[i]:
            continue
        best = None
        for g in GASES:
            j = nxt[g][i]
            if j >= 0 and (j - i) <= hmax and (best is None or j < best[0]):
                best = (j, g)
        if best is not None:
            mtt[i] = (best[0] - i) * step / 60.0; tgas[i] = best[1]
    return state, tgas, mtt
