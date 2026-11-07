"""실행: python -m generator.generate [--config config/default.yaml] [--out output] [--seed N]"""
from __future__ import annotations

import argparse
import datetime as dt_
import pathlib
import sys

import numpy as np
import pandas as pd
import yaml

from .episodes import COL, GASES, build_specs, generate_episode, label_episode

COLUMNS = ["scenario_id", "timestamp", "sensor_id", "task_type", "task_state",
           "o2_pct", "lel_pct", "co_ppm", "h2s_ppm", "co2_pct",
           "quality_flag", "legal_state", "threshold_gas", "minutes_to_threshold", "source_type", "split"]
META_COLUMNS = ["scenario_id", "ptw_id", "zone_id", "task_start", "task_end", "random_seed"]


def load_config(path=None) -> dict:
    if path is None:
        path = pathlib.Path(__file__).resolve().parent.parent / "config" / "default.yaml"
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


def episode_seed(global_seed: int, index: int) -> int:
    return int(np.random.SeedSequence([int(global_seed), int(index)]).generate_state(1)[0])


def scenario_id(index: int) -> str:
    return f"S{index:04d}"


def assign_splits(specs, cfg, rng) -> dict[int, str]:
    sp = cfg["episodes"]["split"]
    out = {}
    by_task: dict[str, list[int]] = {}
    for s in specs:
        by_task.setdefault(s.task_type, []).append(s.index)
    for t, idxs in by_task.items():
        idxs = sorted(idxs); perm = rng.permutation(len(idxs)); n = len(idxs)
        n_tr = int(round(n * sp["train"])); n_va = int(round(n * sp["validation"]))
        for j, pi in enumerate(perm):
            out[idxs[pi]] = "train" if j < n_tr else ("validation" if j < n_tr + n_va else "test")
    return out


def build_dataset(cfg: dict, verbose: bool = True):
    gseed = int(cfg["random_seed"])
    specs = build_specs(cfg, np.random.default_rng(np.random.SeedSequence([gseed, 1])))
    split = assign_splits(specs, cfg, np.random.default_rng(np.random.SeedSequence([gseed, 2])))
    base = dt_.datetime.fromisoformat(str(cfg["time"]["base_datetime"]))
    spacing = float(cfg["time"]["episode_spacing_h"])
    frames, metas = [], []
    for s in specs:
        seed = episode_seed(gseed, s.index)
        ep = generate_episode(cfg, s, seed)
        state, tgas, mtt = label_episode(cfg, ep)
        start = base + dt_.timedelta(hours=spacing * s.index)
        sid = scenario_id(s.index)
        df = pd.DataFrame({
            "scenario_id": sid,
            "timestamp": [(start + dt_.timedelta(seconds=int(t))).isoformat() for t in ep.t_s],
            "sensor_id": ep.sensor_id, "task_type": s.task_type, "task_state": ep.task_state,
            **{COL[g]: ep.values[g] for g in GASES},
            "quality_flag": ep.quality, "legal_state": state, "threshold_gas": tgas,
            "minutes_to_threshold": np.round(mtt, 2), "source_type": cfg["source_type"], "split": split[s.index],
        })[COLUMNS]
        frames.append(df)
        metas.append({"scenario_id": sid, "ptw_id": ep.ptw_id, "zone_id": ep.zone_id,
                      "task_start": (start + dt_.timedelta(seconds=ep.task_start_s)).isoformat() if ep.task_start_s is not None else "",
                      "task_end": (start + dt_.timedelta(seconds=ep.task_end_s)).isoformat() if ep.task_end_s is not None else "",
                      "random_seed": seed})
    ts = pd.concat(frames, ignore_index=True)
    # 표시 해상도 자릿수로 반올림(부동소수 표기 정리)
    for g in GASES:
        r = float(cfg["resolution"][COL[g]]); dec = max(0, int(round(-np.log10(r))))
        ts[COL[g]] = ts[COL[g]].round(dec)
    meta = pd.DataFrame(metas)[META_COLUMNS]
    if verbose:
        print(f"episodes={len(metas)} rows={len(ts)}")
    return ts, meta, specs


def make_sample(ts: pd.DataFrame, specs, cfg: dict) -> pd.DataFrame:
    """열람용 샘플: 작업 종류마다 정상 1개 + 위험 1개, 여기에 가스별 경계·초과와 센서 이상 종류별 에피소드를 더한다."""
    chosen: list[int] = []
    by_task: dict[str, list] = {}
    for s in specs:
        by_task.setdefault(s.task_type, []).append(s)
    for t, lst in by_task.items():
        normal = [s for s in lst if s.kind == "NORMAL" and s.fault == "NONE"]
        danger = [s for s in lst if s.kind in ("APPROACH", "EXCEED", "RECOVERY_IN_WORK", "RECOVERY_AFTER_WORK") and s.fault == "NONE"]
        chosen += [x.index for x in (normal[:1] + danger[:1])]
    for g in GASES:
        for kind in ("APPROACH", "EXCEED"):
            c = [s for s in specs if s.kind == kind and s.gas == g and s.fault == "NONE"]
            if c: chosen.append(c[0].index)
    for f in ("SHORT_MISSING", "COMM_LOSS", "SENSOR_ERROR", "MISSING_BEFORE_DANGER"):
        c = [s for s in specs if s.fault == f]
        if c: chosen.append(c[0].index)
    for kind in ("MILD_CHANGE", "RECOVERY_IN_WORK", "RECOVERY_AFTER_WORK"):
        c = [s for s in specs if s.kind == kind]
        if c: chosen.append(c[0].index)
    ids = [scenario_id(i) for i in sorted(set(chosen))]
    return ts[ts.scenario_id.isin(ids)].head(int(cfg["output"]["sample_rows"]))


def run(cfg: dict, out_dir: pathlib.Path, verbose: bool = True):
    out_dir.mkdir(parents=True, exist_ok=True)
    ts, meta, specs = build_dataset(cfg, verbose)
    ts.to_csv(out_dir / "gas_timeseries.csv", index=False)
    meta.to_csv(out_dir / "scenario_metadata.csv", index=False)
    make_sample(ts, specs, cfg).to_csv(out_dir / "gas_timeseries_sample.csv", index=False)
    with open(out_dir / "config_used.yaml", "w", encoding="utf-8") as f:
        yaml.safe_dump(cfg, f, allow_unicode=True, sort_keys=False)
    return ts, meta, specs


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=None); ap.add_argument("--out", default=None); ap.add_argument("--seed", type=int, default=None)
    a = ap.parse_args(argv)
    cfg = load_config(a.config)
    if a.seed is not None:
        cfg["random_seed"] = a.seed
    out = pathlib.Path(a.out) if a.out else pathlib.Path(__file__).resolve().parent.parent / cfg["output"]["dir"]
    run(cfg, out)


if __name__ == "__main__":
    main(sys.argv[1:])
