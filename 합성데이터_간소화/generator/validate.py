"""검증: python -m generator.validate [--out output] [--config config/default.yaml]. 실패 시 종료코드 1."""
from __future__ import annotations

import argparse
import pathlib
import sys

import numpy as np
import pandas as pd

from .episodes import COL, GASES, build_specs, generate_episode, label_episode, _exceed, _approach, _thr
from .generate import COLUMNS, META_COLUMNS, episode_seed, load_config, scenario_id

FORBIDDEN = ["sensor_position", "sensor_zone", "lel_calibration_gas", "calibration_date", "parameter_source", "generator_version",
             "active_arc_count", "hotwork_count", "shield_gas_type", "shield_gas_flow", "wire_type", "volume_m3", "airflow_m3_min",
             "duct_position", "t90_profile_id", "t90_o2_s", "t90_lel_s", "t90_co_s", "t90_h2s_s", "t90_co2_s", "fault_code",
             "o2_true_pct", "lel_true_pct", "co_true_ppm", "h2s_true_ppm", "co2_true_pct", "true_legal_state", "judgement",
             "future_cross_10m", "future_cross_30m"]
GAS_COLS = [COL[g] for g in GASES]


class Check:
    def __init__(self): self.rows = []
    def add(self, name, ok, detail=""):
        self.rows.append({"check": name, "result": "PASS" if ok else "FAIL", "detail": str(detail)}); return ok
    @property
    def all_ok(self): return all(r["result"] == "PASS" for r in self.rows)




def run_checks(cfg: dict, ts: pd.DataFrame, meta: pd.DataFrame, repro_n: int = 4):
    C = Check()
    thr = _thr(cfg); band = cfg["approach_band"]; step = int(cfg["time"]["sample_interval_s"]); H = float(cfg["time"]["prediction_horizon_min"])
    min_task = int(cfg["episodes"]["min_per_task"])
    # 1. 컬럼 정확히 일치
    C.add("메인 시계열 컬럼이 지정된 16개와 정확히 일치", list(ts.columns) == COLUMNS, f"{list(ts.columns)}")
    C.add("금지된 컬럼 없음", not any(c in ts.columns for c in FORBIDDEN))
    C.add("메타데이터 컬럼이 지정된 6개와 정확히 일치", list(meta.columns) == META_COLUMNS, f"{list(meta.columns)}")
    # 3. 5가스 컬럼 존재
    C.add("모든 행에 5가스 컬럼 존재", all(c in ts.columns for c in GAS_COLS))
    # 4. 타임스탬프 정렬
    tsd = pd.to_datetime(ts["timestamp"])
    C.add("에피소드별 타임스탬프 단조 증가", bool(ts.assign(_t=tsd).groupby("scenario_id")["_t"].apply(lambda s: (s.diff().dropna() > pd.Timedelta(0)).all()).all()))
    # 5. 작업 종류별 ≥ min
    cnt = ts.groupby("scenario_id")["task_type"].first().value_counts()
    short = {k: int(v) for k, v in cnt.items() if v < min_task}
    all_tasks = set(cfg["task_types"]); missing_tasks = all_tasks - set(cnt.index)
    C.add(f"작업 종류별 에피소드 ≥ {min_task} (12종 모두)", not short and not missing_tasks, f"부족 {short}, 없음 {missing_tasks}" if (short or missing_tasks) else cnt.to_dict())
    # 6. 가스별 정상·경계·초과 사례(에피소드 단위)
    per_gas = {}
    valid = ts[ts["quality_flag"].isin(["OK"])]
    for g in GASES:
        v = valid[COL[g]].values
        exm = _exceed(g, v, thr); apm = _approach(g, v, thr, band)
        s = valid["scenario_id"].values
        ex_eps = set(s[exm]); ap_eps = set(s[apm]) - ex_eps
        all_eps = set(ts["scenario_id"]); normal_eps = all_eps - ex_eps - ap_eps
        per_gas[g] = {"normal": len(normal_eps), "approach": len(ap_eps), "exceed": len(ex_eps)}
    ok6 = all(v["normal"] >= 50 and v["approach"] >= 50 and v["exceed"] >= 50 for v in per_gas.values())
    C.add("각 가스별 정상·경계·초과 에피소드 ≥ 50", ok6, str(per_gas))
    # 7. legal_state ↔ 5가스 기준
    miss = ts[GAS_COLS].isna().any(axis=1)
    all_miss = ts[GAS_COLS].isna().all(axis=1)
    C.add("결측은 5가스 모두 빈칸(부분 결측 없음)", bool((miss == all_miss).all()))
    any_ex = np.zeros(len(ts), dtype=bool); any_ap = np.zeros(len(ts), dtype=bool)
    for g in GASES:
        v = ts[COL[g]].values
        any_ex |= _exceed(g, v, thr) & ~miss.values; any_ap |= _approach(g, v, thr, band) & ~miss.values
    expected = np.where(miss, "UNAVAILABLE", np.where(any_ex, "EXCEEDED", np.where(any_ap, "APPROACH", "NORMAL")))
    C.add("legal_state가 5가스 기준·경계 범위와 일치", bool((ts["legal_state"].values == expected).all()), f"불일치 {(ts['legal_state'].values != expected).sum()}")
    # 8. minutes_to_threshold ↔ 실제 이후 초과
    bad = 0; n_chk = 0; bad_gas = 0
    hmax = H * 60 / step
    for sid, g in ts.groupby("scenario_id", sort=False):
        g = g.reset_index(drop=True)
        exg = {gas: (_exceed(gas, g[COL[gas]].values, thr) & g[COL[gas]].notna().values) for gas in GASES}
        anyx = np.zeros(len(g), dtype=bool)
        for gas in GASES: anyx |= exg[gas]
        m = g["minutes_to_threshold"].values; tg = g["threshold_gas"].fillna("").values; mis = g[GAS_COLS].isna().all(axis=1).values
        for i in range(len(g)):
            n_chk += 1
            if mis[i]:
                if not (np.isnan(m[i]) and tg[i] == ""): bad += 1
                continue
            fut = np.where(anyx[i:])[0]
            if len(fut) and fut[0] <= hmax:
                exp = fut[0] * step / 60.0
                if np.isnan(m[i]) or abs(m[i] - exp) > 1e-6: bad += 1
                j = i + fut[0]
                if not exg.get(tg[i], np.zeros(len(g), dtype=bool))[j]: bad_gas += 1
            else:
                if not (np.isnan(m[i]) and tg[i] == ""): bad += 1
    C.add("minutes_to_threshold가 실제 이후 최초 초과 시점과 일치(초과 중 0, 없으면 빈칸, 결측 빈칸)", bad == 0, f"불일치 {bad}/{n_chk}")
    C.add("threshold_gas가 그 시점에 실제로 초과하는 가스", bad_gas == 0, f"불일치 {bad_gas}")
    # 9. 결측 0 채움 없음 / UNAVAILABLE
    mrows = ts[ts["quality_flag"].isin(["MISSING", "COMM_LOSS"])]
    C.add("MISSING·COMM_LOSS 행의 5가스가 모두 빈칸(0 채움 없음)", bool(mrows[GAS_COLS].isna().all().all()), f"행 {len(mrows)}")
    C.add("MISSING·COMM_LOSS 행 legal_state=UNAVAILABLE", bool((mrows["legal_state"] == "UNAVAILABLE").all()))
    C.add("UNAVAILABLE은 결측 행에만", bool((ts.loc[ts["legal_state"] == "UNAVAILABLE", "quality_flag"].isin(["MISSING", "COMM_LOSS"])).all()))
    # 10. source_type
    C.add("모든 행 source_type=SYNTHETIC", bool((ts["source_type"] == cfg["source_type"]).all()))
    # 11. 재현성: 메타의 random_seed로 에피소드 재생성
    specs = build_specs(cfg, np.random.default_rng(np.random.SeedSequence([int(cfg["random_seed"]), 1])))
    spec_by = {scenario_id(s.index): s for s in specs}
    rep_ok = True; det = []
    for _, r in meta.iloc[:: max(1, len(meta) // repro_n)][:repro_n].iterrows():
        sid = r["scenario_id"]; s = spec_by[sid]
        same = episode_seed(int(cfg["random_seed"]), s.index) == int(r["random_seed"])
        ep = generate_episode(cfg, s, int(r["random_seed"]))
        state, tgas, mtt = label_episode(cfg, ep)
        orig = ts[ts.scenario_id == sid].reset_index(drop=True)
        same &= len(orig) == ep.n
        if same:
            for g in GASES:
                same &= bool(np.allclose(np.nan_to_num(orig[COL[g]].values, nan=-1), np.nan_to_num(ep.values[g], nan=-1), atol=1e-9))
            same &= bool((orig["legal_state"].values == state).all())
        rep_ok &= same; det.append(f"{sid}:{'same' if same else 'DIFF'}")
    C.add("동일 난수 시드로 동일 에피소드 재생성", rep_ok, "; ".join(det))
    # 12. 분할
    sp = ts.groupby("scenario_id")["split"].nunique()
    C.add("같은 scenario_id가 한 분할에만", bool((sp == 1).all()), ts.groupby("scenario_id")["split"].first().value_counts().to_dict())
    C.add("split 값이 train/validation/test", bool(ts["split"].isin(["train", "validation", "test"]).all()))
    # 13. 물리 범위·연속성
    C.add("음수 없음, O2 ≤ 25%", bool((ts[GAS_COLS].min().min() >= 0) and (ts["o2_pct"].max() <= 25.0)))
    # 작업 시작·종료 시점 급변 없음: 상태 전환 전후 값 차이가 잡음 범위(5σ) 이내 (SENSOR_ERROR 행 제외)
    jump_bad = 0; jump_n = 0
    for sid, g in ts.groupby("scenario_id", sort=False):
        g = g.reset_index(drop=True)
        chg = np.where(g["task_state"].values[1:] != g["task_state"].values[:-1])[0]
        for i in chg:
            a, b = g.iloc[i], g.iloc[i + 1]
            if a["quality_flag"] != "OK" or b["quality_flag"] != "OK": continue
            jump_n += 1
            for gas in GASES:
                if abs(a[COL[gas]] - b[COL[gas]]) > 8 * float(cfg["noise_sd"][COL[gas]]) + float(cfg["resolution"][COL[gas]]):
                    jump_bad += 1; break
    C.add("작업 시작·종료 시점에 값이 튀지 않음(전환 전후 차이 ≤ 8σ+해상도, 두 독립 잡음의 차이 기준)", jump_bad == 0, f"{jump_bad}/{jump_n}")
    # 14. 특정 작업↔가스 일대일 아님: 위험 작업 종류마다 초과 가스가 2종 이상, 모든 작업 종류에 정상 에피소드 존재
    first_gas = ts[(ts["legal_state"] == "EXCEEDED") & (ts["quality_flag"] == "OK")].groupby("scenario_id").apply(
        lambda g: next(gas for gas in GASES if (_exceed(gas, g[COL[gas]].values, thr) & g[COL[gas]].notna().values).any()), include_groups=False)
    task_of = ts.groupby("scenario_id")["task_type"].first()
    gas_div = first_gas.groupby(task_of.loc[first_gas.index]).nunique()
    normal_eps = ts[ts["quality_flag"] != "SENSOR_ERROR"].groupby("scenario_id").apply(lambda g: (g["legal_state"].isin(["NORMAL", "UNAVAILABLE"])).all(), include_groups=False)
    normal_by_task = normal_eps.groupby(task_of).sum()
    ok14 = bool((gas_div[gas_div.index != "NONE"] >= 2).all()) and bool((normal_by_task >= 10).all()) and ("NONE" not in gas_div.index)
    C.add("작업↔가스 일대일 아님(위험 작업마다 초과 가스 2종 이상), 모든 작업에 정상 에피소드 ≥10, NONE은 초과 없음", ok14,
          f"초과 가스 종류 수 {gas_div.to_dict()}, 정상 에피소드 {normal_by_task.to_dict()}")
    stats = {"n_episodes": int(ts["scenario_id"].nunique()), "n_rows": int(len(ts)), "per_task": cnt.to_dict(), "per_gas": per_gas,
             "quality": ts["quality_flag"].value_counts().to_dict(), "legal": ts["legal_state"].value_counts().to_dict(),
             "split": ts.groupby("scenario_id")["split"].first().value_counts().to_dict(),
             "missing_eps": int(ts[ts["quality_flag"].isin(["MISSING", "COMM_LOSS"])]["scenario_id"].nunique()),
             "comm_loss_eps": int(ts[ts["quality_flag"] == "COMM_LOSS"]["scenario_id"].nunique()),
             "short_missing_eps": int(ts[ts["quality_flag"] == "MISSING"]["scenario_id"].nunique()),
             "sensor_error_eps": int(ts[ts["quality_flag"] == "SENSOR_ERROR"]["scenario_id"].nunique()),
             "duration_min": ts.groupby("scenario_id").size().mul(step / 60).describe().round(1).to_dict(),
             "threshold_gas_rows": ts["threshold_gas"].fillna("").replace("", "(none)").value_counts().to_dict(),
             "exceed_gas_by_task": first_gas.groupby(task_of.loc[first_gas.index]).value_counts().unstack(fill_value=0).to_dict("index")}
    return C, stats


def write_report(path: pathlib.Path, C: Check, stats: dict, cfg: dict):
    L = ["# 합성 데이터 검증 보고서 (간소화 생성기)\n",
         f"난수 시드 {cfg['random_seed']} · 저장 간격 {cfg['time']['sample_interval_s']}초 · 예측 범위 {cfg['time']['prediction_horizon_min']}분 · 모든 행 `source_type=SYNTHETIC`\n",
         "**이 보고서는 합성 데이터가 지정된 컬럼·기준·라벨 정의를 지켰는지 확인한 것이다. 실제 사고 빈도나 현장 정확도를 뜻하지 않는다.**\n",
         "## 자동 검증\n", "| # | 항목 | 결과 | 상세 |\n|---|---|---|---|"]
    for i, r in enumerate(C.rows, 1):
        L.append(f"| {i} | {r['check']} | {r['result']} | {r['detail']} |")
    L.append(f"\n전체: **{'PASS' if C.all_ok else 'FAIL'}** ({sum(r['result']=='PASS' for r in C.rows)}/{len(C.rows)})\n")
    L += ["## 통계\n", f"- 에피소드 {stats['n_episodes']}개, 행 {stats['n_rows']}개",
          f"- 에피소드 길이(분): {stats['duration_min']}",
          "\n### 작업 종류별 에피소드\n", "| 작업 | 수 |\n|---|---|"]
    L += [f"| {k} | {v} |" for k, v in sorted(stats["per_task"].items())]
    L += ["\n### 가스별 정상·경계·초과 에피소드(측정값 기준, 에피소드 안 최악 상태)\n", "| 가스 | 정상 | 경계 접근 | 초과 |\n|---|---|---|---|"]
    L += [f"| {g} | {v['normal']} | {v['approach']} | {v['exceed']} |" for g, v in stats["per_gas"].items()]
    L += ["\n### 작업 종류 × 최초 초과 가스(에피소드)\n", "| 작업 | " + " | ".join(GASES) + " |", "|---|" + "---|" * len(GASES)]
    for t, d in sorted(stats["exceed_gas_by_task"].items()):
        L.append(f"| {t} | " + " | ".join(str(d.get(g, 0)) for g in GASES) + " |")
    L += [f"\n- legal_state(행): {stats['legal']}", f"- quality_flag(행): {stats['quality']}",
          f"- 결측·통신 두절 에피소드: {stats['missing_eps']} (단기 결측 {stats['short_missing_eps']}, 통신 두절 {stats['comm_loss_eps']}), 이상값 에피소드 {stats['sensor_error_eps']}",
          f"- threshold_gas(행): {stats['threshold_gas_rows']}", f"- 분할(에피소드): {stats['split']}",
          "\n## 한계\n",
          "- 곡선은 '완만한 상승 → 유지 → 점진 감소' 패턴을 작업 종류·상황별 가중치로 배정한 것이며, 발생률·체적·환기 같은 물리량을 쓰지 않았다. 상승 속도·정점·유지 시간은 설정 파일의 범위에서 뽑은 가정값이다.",
          "- 작업 종류와 가스의 관계는 약한 가중치(HOT_WORK→CO, PAINTING_CLEANING→LEL, FLUID_SUPPLY·COMMISSIONING→O₂·CO₂·H₂S)만 적용했다. 모든 작업에 정상 에피소드가 있고, 모든 위험 작업에서 2종 이상의 가스가 초과한다.",
          "- 상황 비율(가스별 경계 62·초과 60개씩 등)은 학습·기능 검증용 균형 세트이며 실제 발생 빈도가 아니다.",
          "- SENSOR_ERROR 행의 값은 일시적 이상값이다. legal_state·minutes_to_threshold는 측정값 그대로 계산되므로, 소비자는 quality_flag로 이 행을 걸러야 한다.",
          "- 이 데이터로 학습·평가한 결과는 '합성 시나리오에서 기능을 확인했다'로만 표현해야 한다."]
    path.write_text("\n".join(L) + "\n", encoding="utf-8")


def main(argv=None):
    ap = argparse.ArgumentParser(); ap.add_argument("--config", default=None); ap.add_argument("--out", default=None); ap.add_argument("--report", default=None)
    a = ap.parse_args(argv)
    cfg = load_config(a.config)
    root = pathlib.Path(__file__).resolve().parent.parent
    out = pathlib.Path(a.out) if a.out else root / cfg["output"]["dir"]
    ts = pd.read_csv(out / "gas_timeseries.csv", keep_default_na=True, na_values=[""], dtype={"threshold_gas": str})
    ts["threshold_gas"] = ts["threshold_gas"].fillna("")
    meta = pd.read_csv(out / "scenario_metadata.csv", keep_default_na=False)
    C, stats = run_checks(cfg, ts, meta)
    write_report(pathlib.Path(a.report) if a.report else root / "validation_report.md", C, stats, cfg)
    for r in C.rows:
        print(f"[{r['result']}] {r['check']} — {r['detail'][:200]}")
    print("ALL PASS" if C.all_ok else "SOME CHECKS FAILED")
    return 0 if C.all_ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
