# 조선소 밀폐구역 실시간 5가스 위험예측 모델

## 1. 모델 목적

최근 최대 40분의 5가스 시계열(O₂·LEL·CO·H₂S·CO₂)과 작업 종류·작업 상태를 보고,
**앞으로 60분 안에 어떤 가스가 언제 법정 기준을 초과할지**를 예측한다.

모델이 하지 않는 것:

- 현재 법정 기준 초과 여부 판정 → 코드의 **규칙층**(`src/rules.py`)이 한다.
- 작업 중지·대피 결정 → 사람(안전관리자)이 한다. 모델 출력에는 조치 문구가 없다.

**학습·평가 데이터는 전부 합성 데이터다(`합성데이터_간소화`). 아래의 모든 수치는 합성 시나리오에서 기능을 확인한 것이지 현장 정확도를 입증한 것이 아니다.**

학습 원본 CSV와 생성기는 저장소 루트의 `합성데이터_간소화/`에 함께 포함돼 있다.

## 2. 입력 데이터와 컬럼

- 원본: `../합성데이터_간소화/output/gas_timeseries.csv` (1,259 에피소드, 380,917행, 15초 간격, 16개 컬럼), `scenario_metadata.csv`
- 분할: CSV의 `split` 열을 그대로 사용(train 880 / validation 188 / test 191 에피소드). 행 단위 재분할 없음.
- 모델이 쓰는 원본 컬럼: `task_type, task_state, o2_pct, lel_pct, co_ppm, h2s_ppm, co2_pct, quality_flag, timestamp`
  (`timestamp`는 정렬·간격 계산 전용. 날짜·시각 자체는 특성이 아니다 — `tests/test_no_leakage.py`가 확인)
- 입력 금지: `scenario_id, sensor_id, source_type, split`(식별), `legal_state, threshold_gas, minutes_to_threshold`(정답), `ptw_id, zone_id, random_seed`(메타)

데이터 감사 결과(`reports/data_audit.md`): 문서(데이터 사전·검증 보고서)와 실제 CSV가 모두 일치했다.

## 3. 사용한 특성 (155개, `src/features.py`)

윈도우: 최근 최대 40분 = 160개 시점. 최소 10분(40개 시점) 유효 데이터가 있어야 예측.

가스별(5가스 × 27개):

- 현재값
- 최근 5·10·20·40분의 평균, 최소, 최대, 표준편차, 변화량(현재값 − 윈도우 시작 1분 평균), 선형 기울기(단위/분)
- 법정 기준까지 거리(O₂는 하한·상한 거리 각각 + 가까운 쪽), 경계 구간까지 거리

공통:

- `task_type` 원-핫(12), `task_state` 원-핫(3)
- 윈도우 길이(분), 윈도우 유효 측정 비율, 최근 10분 결측 비율

전처리: LogisticRegression은 train에만 적합한 `StandardScaler`를 쓴다(`artifacts/preprocessors/`). 트리 모델은 스케일링 없음.

## 4. 기준선: 선형 추세 (`src/baseline.py`)

각 가스의 최근 10분(또는 5분) 기울기와 현재값·기준 거리에서 예상 교차시간 = 거리 / 기울기.
기울기가 기준 방향(O₂는 하강 또는 상승, 나머지는 상승)일 때만 계산하고, 가장 빠른 가스를 고른다.
60분 안에 교차하지 않으면 STABLE/NONE. 최종 모델과 같은 5개 출력 형식으로 변환한다.

## 5. 선택한 모델과 이유 (`src/train.py`, validation으로 선택)

| 단계 | 후보 | 선택 | 선택 근거(validation) |
|---|---|---|---|
| 60분 위험 분류 | LogisticRegression / RandomForest / HistGradientBoosting | **LogisticRegression** | PR-AUC 0.490 / 0.478 / 0.472 — 최고이면서 가장 단순 |
| 30분 위험 확률 | 위와 같음 | **LogisticRegression** | PR-AUC 0.491 / 0.488 / 0.491 — 0.01 이내면 단순한 모델 우선 |
| 위험 가스(5클래스) | 위와 같음(60분 위험 윈도우만) | **LogisticRegression** | macro F1 0.533 / 0.486 / 0.516 |
| 도달시간 회귀 | RandomForest / HistGradientBoosting | **HistGradientBoosting(absolute_error)** | MAE 6.04 / 6.39분 |

- 선택 규칙: 지표 최고 모델. 단 더 단순한 모델이 최고값의 0.01(MAE는 0.25분) 이내면 단순한 쪽. 딥러닝은 쓰지 않았다(가벼운 모델 간 차이가 작고, 성능 한계가 모델이 아니라 데이터에 있기 때문 — 9절).
- 확률 보정: `class_weight='balanced'` 때문에 부풀려진 확률을 validation에서 등장(isotonic) 보정. validation Brier 0.162 → 0.080(30분), 0.164 → 0.085(60분). test Brier 0.111.
- 확률 임계값(보정 확률 기준, validation에서 결정): **30분 0.1735, 60분 0.2267**. 규칙: *Recall ≥ 0.80을 만족하는 임계값 중 F1 최대*. Recall 0.90을 요구하면 validation 윈도우의 40% 이상이 경보가 되어(정밀도 0.26) '모든 상황을 위험으로 보는' 쪽에 가까워져 0.80으로 정했다. 목표 Recall별 절충표는 `reports/validation_metrics.json`의 `tradeoff`와 `evaluation_report.md`에 있다.
- 특성 중요도: `reports/feature_importance.csv`(30분 모델, validation 부분표본 순열 중요도).

## 6. 명령

```bash
cd 가스예측모델
pip install -r requirements.txt

python -m src.train                 # 학습 + validation 선택 + 저장 (약 4~5분; --quick 으로 축소 가능)
python -m src.evaluate              # test 평가 1회 → reports/
python -m src.inference             # 단일 시나리오 추론 예시 (--scenario S0042 --row 89)
python -m pytest tests/             # 자동 테스트 34개
```

`src.train`은 `--windows-cache 경로.pkl`로 윈도우 테이블을 재사용할 수 있다.
저장된 모델은 scikit-learn 1.9.1, numpy 2.5, pandas 3.0에서 만들었다. 다른 버전에서 joblib 로드 경고가 나면 `python -m src.train`으로 다시 학습하면 된다(같은 시드라 결과가 재현된다).

## 7. 추론 예시

```python
import pandas as pd
from src.inference import GasRiskPredictor, explain_values
from src.stabilization import StateStabilizer

predictor = GasRiskPredictor()            # artifacts/ 에서 모델·전처리기·임계값 로드
stabilizer = StateStabilizer(n_confirm=2) # 1분마다 호출, 같은 상태 2회 연속일 때 전환

# recent: 한 센서·구역의 시간순 최근 최대 40분 DataFrame
# 컬럼: timestamp, task_type, task_state, o2_pct, lel_pct, co_ppm, h2s_ppm, co2_pct, quality_flag
res = predictor.assess(recent)            # {"rule": 규칙층 결과, "model": 모델 5개 출력}
if res["rule"]["legal_exceeded"]:
    ...                                   # 규칙층 즉시 경보(연속 확인 없음). 모델 결과는 UNAVAILABLE
published = stabilizer.update(res["model"], legal_exceeded=res["rule"]["legal_exceeded"])
detail = explain_values(recent, res["model"])   # 설명 문구용 보조값(모델 출력에는 포함되지 않음)
```

`predict_window(recent)`만 호출해도 된다(규칙층 초과 시 UNAVAILABLE 반환). 함수 안에서 필수 컬럼, 시간순 정렬, 최신 시각(`now` 인자), 최소 10분, 최신 `quality_flag`, 가스 결측, 유효 비율, 허용 범위, 현재 법정 초과를 검사한다.

### 최종 출력 JSON

```json
{"prediction_status": "PREDICTED", "forecast_state": "IMMINENT", "predicted_threshold_gas": "H2S",
 "predicted_minutes_to_threshold": 4.8, "risk_probability_30m": 0.8889}
```

```json
{"prediction_status": "UNAVAILABLE", "forecast_state": null, "predicted_threshold_gas": null,
 "predicted_minutes_to_threshold": null, "risk_probability_30m": null}
```

- `forecast_state`: STABLE(60분 내 초과 예상 없음) / WATCH(31~60분) / IMMINENT(30분 이내)
- 정합성(코드·테스트로 보장): STABLE이면 가스 NONE·시간 null, WATCH면 30<시간≤60, IMMINENT면 0≤시간≤30, UNAVAILABLE이면 나머지 전부 null.

### 내부 결과 → 최종 상태 조합 규칙 (`inference.combine_outputs`)

1. risk60 = (p60 ≥ 임계값60) 또는 (p30 ≥ 임계값30)
2. risk60 아니면 STABLE / NONE / null
3. risk60이면 가스 = 가스 모델, 시간 = 회귀값을 [0, 60]으로 자름
4. p30 ≥ 임계값30 → IMMINENT(시간은 30 이하로), 아니어도 회귀 시간 ≤ 30 → IMMINENT, 그 외 WATCH(시간은 30 초과로 보정)
5. `risk_probability_30m`은 항상 보정된 p30

설명 문구는 시스템이 `explain_values()`의 값으로 고정 문장을 만든다. 예: "최근 10분 동안 H2S가 분당 0.9ppm씩 상승했습니다. 현재 추세와 모델 예측상 약 5분 후 10ppm 기준에 도달할 수 있습니다."

## 8. 규칙층과 모델의 역할 구분

| 상황 | 담당 | 동작 |
|---|---|---|
| 현재 측정값이 O₂<18 또는 ≥23.5 %, LEL≥10 %, CO≥30 ppm, H₂S≥10 ppm, CO₂≥1.5 % | 규칙층 | 즉시 '법정 기준 초과'. 모델 호출 안 함. 연속 확인 없음 |
| 최신 행 MISSING / COMM_LOSS / SENSOR_ERROR, 가스 결측, 10분 미만, 유효 비율 < 80 %, 허용 범위 밖 | 규칙층·입력 검사 | `UNAVAILABLE` |
| 그 외 | 모델 | 60분 내 초과 가스·시점·30분 확률 |
| 상태 흔들림 | 후처리 `StateStabilizer` | 같은 상태 n회(2~3) 연속일 때만 전환(복귀 포함). 규칙 경보는 통과 |

모델 결과는 규칙층 판정을 해제하거나 낮추지 못한다(`tests/test_rules.py`).

## 9. 결측 처리

- 현재 시점이 OK가 아니거나 가스값이 비어 있으면 예측하지 않는다.
- SENSOR_ERROR·MISSING·COMM_LOSS 행의 값은 NaN으로 바꾼다(이상값을 정상 농도로 학습하지 않음). 0으로 채우지 않는다.
- 길이 3샘플(45초) 이하의 짧은 결측만 양쪽 값으로 선형보간한다. 긴 통신 두절은 보간하지 않고 롤링 통계가 건너뛴다.
- 윈도우 유효 비율이 80 % 미만이면 UNAVAILABLE. 유효 비율·최근 결측 비율은 보조 특성.

## 10. 결과 요약 (test, 1회 평가; 자세한 표는 `reports/evaluation_report.md`)

| 모델 | 30분 Recall | 30분 Precision | 30분 F1 | 가스 Macro F1 | 도달시간 MAE | 정상작업 오경보율(윈도우/에피소드) | 평균 선행시간 |
|---|---|---|---|---|---|---|---|
| 선형 추세 기준선(10분) | 0.319 | 0.218 | 0.259 | 0.315 | 7.88분 | 0.318 / 0.575 | 8.4분 |
| 선형 추세 기준선(5분) | 0.365 | 0.246 | 0.294 | 0.334 | 7.18분 | 0.319 / 0.726 | 10.4분 |
| **최종 모델** | **0.800** | 0.368 | **0.504** | **0.406** | **7.03분** | 0.295 / 0.947 | **23.8분** |

- 머신러닝 모델은 기준선보다 30분 위험 Recall(0.32→0.80), F1(0.26→0.50), PR-AUC(0.19→0.50), 선행시간(8→24분)에서 분명히 낫다. 도달시간 MAE와 윈도우 오경보율은 비슷하다.
- 그러나 **정밀도 0.37, 정상 작업 윈도우의 29 %가 경보, 정상 에피소드의 95 %에서 최소 한 번 경보**가 난다. 좋은 결과가 아니며 아래 한계의 직접적 결과다.
- 도달시간: MAE 7.0분, 중앙값 5.2분, ±10분 이내 76 %.
- WATCH(31~60분)는 거의 예측하지 못한다(Recall 0.01). test에서 WATCH 정답 자체가 2 %뿐이다(합성 데이터의 상승이 빠름).
- UNAVAILABLE: test 1분 간격 시점 14,300개 중 31 %(법정 초과 중 2,310, 10분 미만 1,714, 통신 두절 248, 유효 비율 부족 160, 결측 13, 유효 이력 부족 8).

## 11. 모델의 한계

반드시 알아야 할 점:

- **학습·평가 데이터가 합성 데이터다.** 합성 시나리오에서 기능을 확인한 것이지 현장 정확도를 입증한 것이 아니다.
- **작업별 발생 빈도가 실제 현장 분포와 다르다.** 합성 데이터는 가스별 경계·초과 사례를 균형 있게 넣은 세트라 실제보다 위험이 훨씬 잦다. 현장에서는 양성 비율이 낮아져 정밀도가 더 떨어질 수 있다.
- **실제 현장 데이터 확보 후 재학습·재검증이 필요하다.** 특성 가중치·임계값·보정기는 모두 합성 분포에 맞춰져 있다.
- **모델은 법정 기준 초과 경보와 작업 중지 결정을 대신하지 않는다.** 초과 경보는 규칙층, 결정은 사람이 한다.

이 데이터에서 드러난 구조적 한계:

- 합성 데이터의 위험은 '배경 → 짧은 시간의 완만한 상승 → 초과'라서, 30분 양성 중 **64 %는 기준 시점에 아직 추세가 보이지 않는다**(위험 가스의 10분 변화량이 40분 표준편차의 2배 미만). 가스값만으로는 맞힐 수 없고, 모델은 작업 종류와 '에피소드 시작 후 경과 시간'(윈도우 길이 특성)이라는 사전확률로 맞힌다. 추세가 보이는 양성의 Recall은 0.90, 보이지 않는 양성은 0.64다.
- 그래서 `window_len_min`이 가장 중요한 특성 중 하나가 되었다. 이 특성을 빼면 validation PR-AUC 0.491 → 0.446. 현장에서 측정기 부착 시점부터의 경과 시간이 실제 위험과 같은 관계를 갖는다는 보장은 없다(합성 데이터의 발생 시점 분포 2~25분이 만든 패턴일 수 있다).
- 결론적으로 이 모델의 '24분 선행시간'은 대부분 "이 작업·이 시점이면 위험하더라" 수준의 사전확률이지 가스 추세를 읽은 것이 아니다. 가스 추세 기반 조기 경보가 정말 가능한지는 실제 상승 속도(분 단위인지, 수십 분 단위인지)를 현장에서 확인해야 답할 수 있다.
- 센서 한 대 값이 공간을 대표한다고 가정한다. 환기·공간·발생원 정보는 쓰지 않는다.

## 12. 폴더

```
가스예측모델/
  src/  data_loader.py window_builder.py features.py rules.py baseline.py train.py evaluate.py inference.py stabilization.py
  artifacts/  models/{risk60_classifier,risk30_classifier,gas_classifier,time_regressor}.joblib
              preprocessors/{risk60,risk30,gas}_scaler.joblib {risk60,risk30}_calibrator.joblib
              model_config.json
  reports/  data_audit.md validation_metrics.json test_metrics.json evaluation_report.md
            baseline_comparison.csv test_predictions.csv feature_importance.csv
  tests/  test_data_split.py test_no_leakage.py test_rules.py test_inference.py test_missing_data.py test_output_consistency.py
  README.md requirements.txt
```
