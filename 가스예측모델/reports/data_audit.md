# 데이터 감사 보고서

- 원본: `/home/claude/합성데이터_간소화/output`
- 행 380,917 / 에피소드 1,259 / 메타데이터 행 1,259
- 측정 간격 15초, 에피소드 길이(분) 최소 31.5 ~ 최대 120.2

## 문서와의 일치 여부

- 불일치 없음(컬럼 16/6개, split 유일성, 15초 간격, 결측 규칙 모두 문서와 일치)

## 컬럼

- gas_timeseries: ['scenario_id', 'timestamp', 'sensor_id', 'task_type', 'task_state', 'o2_pct', 'lel_pct', 'co_ppm', 'h2s_ppm', 'co2_pct', 'quality_flag', 'legal_state', 'threshold_gas', 'minutes_to_threshold', 'source_type', 'split']
- scenario_metadata: ['scenario_id', 'ptw_id', 'zone_id', 'task_start', 'task_end', 'random_seed']

## 분할(에피소드)

{'test': 191, 'train': 880, 'validation': 188}

## 분할(행)

{'train': 269036, 'test': 57495, 'validation': 54386}

## quality_flag

{'OK': 375021, 'COMM_LOSS': 5593, 'MISSING': 194, 'SENSOR_ERROR': 109}

## legal_state

{'NORMAL': 275788, 'EXCEEDED': 65499, 'APPROACH': 33843, 'UNAVAILABLE': 5787}

## task_type(행)

{'HOT_WORK': 55573, 'COMMISSIONING': 46817, 'FLUID_SUPPLY': 45127, 'PAINTING_CLEANING': 42689, 'OTHER': 34073, 'BARGE_WORK': 30009, 'ELECTRICAL': 24150, 'HEAVY_LIFTING': 24101, 'SCAFFOLDING': 23959, 'RADIOGRAPHY': 23213, 'PRESSURE_TEST': 21958, 'NONE': 9248}

## task_state(행)

{'WORK': 250521, 'RECOVERY': 72639, 'PRE_WORK': 57757}

## threshold_gas(행)

{'(none)': 252847, 'LEL': 27398, 'CO2': 26892, 'H2S': 25935, 'CO': 24223, 'O2': 23622}

## 가스 값 범위(OK·SENSOR_ERROR 행)

|       |     o2_pct |    lel_pct |     co_ppm |    h2s_ppm |    co2_pct |
|:------|-----------:|-----------:|-----------:|-----------:|-----------:|
| count | 375130     | 375130     | 375130     | 375130     | 375130     |
| mean  |     20.679 |      1.765 |      4.602 |      1.435 |      0.202 |
| std   |      0.786 |      4.552 |     13.201 |      4.586 |      0.448 |
| min   |     15.5   |      0     |      0     |      0     |      0     |
| 25%   |     20.8   |      0     |      1     |      0.1   |      0.05  |
| 50%   |     20.9   |      1     |      1     |      0.2   |      0.06  |
| 75%   |     20.9   |      1     |      2     |      0.3   |      0.08  |
| max   |     24.8   |     40     |    116     |     39.4   |      3.46  |

## minutes_to_threshold

- 값 있는 행 128,070 (0 = 현재 초과 중 65,499, 0<x≤30: 51,598, 30<x≤60: 10,973)

## 모델 입력 컬럼 제한

- 허용: ['task_type', 'task_state', 'o2_pct', 'lel_pct', 'co_ppm', 'h2s_ppm', 'co2_pct', 'quality_flag', 'timestamp'] (timestamp는 정렬·간격 전용)
- 금지(식별): ['scenario_id', 'sensor_id', 'source_type', 'split']
- 금지(정답): ['legal_state', 'threshold_gas', 'minutes_to_threshold']
- 금지(메타): ['ptw_id', 'zone_id', 'random_seed']
