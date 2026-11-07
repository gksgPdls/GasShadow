# 합성 데이터 검증 보고서 (간소화 생성기)

난수 시드 20261031 · 저장 간격 15초 · 예측 범위 60분 · 모든 행 `source_type=SYNTHETIC`

**이 보고서는 합성 데이터가 지정된 컬럼·기준·라벨 정의를 지켰는지 확인한 것이다. 실제 사고 빈도나 현장 정확도를 뜻하지 않는다.**

## 자동 검증

| # | 항목 | 결과 | 상세 |
|---|---|---|---|
| 1 | 메인 시계열 컬럼이 지정된 16개와 정확히 일치 | PASS | ['scenario_id', 'timestamp', 'sensor_id', 'task_type', 'task_state', 'o2_pct', 'lel_pct', 'co_ppm', 'h2s_ppm', 'co2_pct', 'quality_flag', 'legal_state', 'threshold_gas', 'minutes_to_threshold', 'source_type', 'split'] |
| 2 | 금지된 컬럼 없음 | PASS |  |
| 3 | 메타데이터 컬럼이 지정된 6개와 정확히 일치 | PASS | ['scenario_id', 'ptw_id', 'zone_id', 'task_start', 'task_end', 'random_seed'] |
| 4 | 모든 행에 5가스 컬럼 존재 | PASS |  |
| 5 | 에피소드별 타임스탬프 단조 증가 | PASS |  |
| 6 | 작업 종류별 에피소드 ≥ 50 (12종 모두) | PASS | {'HOT_WORK': 176, 'FLUID_SUPPLY': 155, 'COMMISSIONING': 149, 'PAINTING_CLEANING': 136, 'OTHER': 112, 'BARGE_WORK': 98, 'SCAFFOLDING': 80, 'ELECTRICAL': 78, 'HEAVY_LIFTING': 76, 'RADIOGRAPHY': 75, 'PRESSURE_TEST': 74, 'NONE': 50} |
| 7 | 각 가스별 정상·경계·초과 에피소드 ≥ 50 | PASS | {'O2': {'normal': 1108, 'approach': 62, 'exceed': 89}, 'LEL': {'normal': 1086, 'approach': 67, 'exceed': 106}, 'CO': {'normal': 1099, 'approach': 69, 'exceed': 91}, 'H2S': {'normal': 1101, 'approach': 68, 'exceed': 90}, 'CO2': {'normal': 1090, 'approach': 69, 'exceed': 100}} |
| 8 | 결측은 5가스 모두 빈칸(부분 결측 없음) | PASS |  |
| 9 | legal_state가 5가스 기준·경계 범위와 일치 | PASS | 불일치 0 |
| 10 | minutes_to_threshold가 실제 이후 최초 초과 시점과 일치(초과 중 0, 없으면 빈칸, 결측 빈칸) | PASS | 불일치 0/380917 |
| 11 | threshold_gas가 그 시점에 실제로 초과하는 가스 | PASS | 불일치 0 |
| 12 | MISSING·COMM_LOSS 행의 5가스가 모두 빈칸(0 채움 없음) | PASS | 행 5787 |
| 13 | MISSING·COMM_LOSS 행 legal_state=UNAVAILABLE | PASS |  |
| 14 | UNAVAILABLE은 결측 행에만 | PASS |  |
| 15 | 모든 행 source_type=SYNTHETIC | PASS |  |
| 16 | 동일 난수 시드로 동일 에피소드 재생성 | PASS | S0000:same; S0314:same; S0628:same; S0942:same |
| 17 | 같은 scenario_id가 한 분할에만 | PASS | {'train': 880, 'test': 191, 'validation': 188} |
| 18 | split 값이 train/validation/test | PASS |  |
| 19 | 음수 없음, O2 ≤ 25% | PASS |  |
| 20 | 작업 시작·종료 시점에 값이 튀지 않음(전환 전후 차이 ≤ 8σ+해상도, 두 독립 잡음의 차이 기준) | PASS | 0/2389 |
| 21 | 작업↔가스 일대일 아님(위험 작업마다 초과 가스 2종 이상), 모든 작업에 정상 에피소드 ≥10, NONE은 초과 없음 | PASS | 초과 가스 종류 수 {'BARGE_WORK': 5, 'COMMISSIONING': 5, 'ELECTRICAL': 5, 'FLUID_SUPPLY': 5, 'HEAVY_LIFTING': 5, 'HOT_WORK': 5, 'OTHER': 5, 'PAINTING_CLEANING': 5, 'PRESSURE_TEST': 5, 'RADIOGRAPHY': 5, 'SCAFFOLDING': 5}, 정상 에피소드 {'BARGE_WORK': 36, 'COMMISSIONING': 43, 'ELECTRICAL': 32, 'FLUID_SUPPLY': 40, 'HEAVY_LIFTING': 38, 'HOT_WORK': 40, 'NONE': 50, 'OTHER': 36, 'PAINTING_CLEANING': 32, 'PRESSURE_TEST': 32, 'RADIOGRAPHY': 32, 'SCAFFOLDING': 37} |

전체: **PASS** (21/21)

## 통계

- 에피소드 1259개, 행 380917개
- 에피소드 길이(분): {'count': 1259.0, 'mean': 75.6, 'std': 20.2, 'min': 31.5, '25%': 58.6, '50%': 76.2, '75%': 92.0, 'max': 120.2}

### 작업 종류별 에피소드

| 작업 | 수 |
|---|---|
| BARGE_WORK | 98 |
| COMMISSIONING | 149 |
| ELECTRICAL | 78 |
| FLUID_SUPPLY | 155 |
| HEAVY_LIFTING | 76 |
| HOT_WORK | 176 |
| NONE | 50 |
| OTHER | 112 |
| PAINTING_CLEANING | 136 |
| PRESSURE_TEST | 74 |
| RADIOGRAPHY | 75 |
| SCAFFOLDING | 80 |

### 가스별 정상·경계·초과 에피소드(측정값 기준, 에피소드 안 최악 상태)

| 가스 | 정상 | 경계 접근 | 초과 |
|---|---|---|---|
| O2 | 1108 | 62 | 89 |
| LEL | 1086 | 67 | 106 |
| CO | 1099 | 69 | 91 |
| H2S | 1101 | 68 | 90 |
| CO2 | 1090 | 69 | 100 |

### 작업 종류 × 최초 초과 가스(에피소드)

| 작업 | O2 | LEL | CO | H2S | CO2 |
|---|---|---|---|---|---|
| BARGE_WORK | 4 | 7 | 8 | 10 | 8 |
| COMMISSIONING | 18 | 9 | 3 | 18 | 12 |
| ELECTRICAL | 5 | 6 | 6 | 5 | 8 |
| FLUID_SUPPLY | 12 | 7 | 4 | 20 | 14 |
| HEAVY_LIFTING | 6 | 4 | 2 | 4 | 6 |
| HOT_WORK | 9 | 12 | 43 | 6 | 17 |
| OTHER | 13 | 8 | 7 | 8 | 6 |
| PAINTING_CLEANING | 5 | 38 | 7 | 7 | 12 |
| PRESSURE_TEST | 4 | 3 | 4 | 4 | 6 |
| RADIOGRAPHY | 5 | 9 | 5 | 4 | 6 |
| SCAFFOLDING | 8 | 3 | 2 | 4 | 5 |

- legal_state(행): {'NORMAL': 275788, 'EXCEEDED': 65499, 'APPROACH': 33843, 'UNAVAILABLE': 5787}
- quality_flag(행): {'OK': 375021, 'COMM_LOSS': 5593, 'MISSING': 194, 'SENSOR_ERROR': 109}
- 결측·통신 두절 에피소드: 150 (단기 결측 50, 통신 두절 100), 이상값 에피소드 50
- threshold_gas(행): {'(none)': 252847, 'LEL': 27398, 'CO2': 26892, 'H2S': 25935, 'CO': 24223, 'O2': 23622}
- 분할(에피소드): {'train': 880, 'test': 191, 'validation': 188}

## 한계

- 곡선은 '완만한 상승 → 유지 → 점진 감소' 패턴을 작업 종류·상황별 가중치로 배정한 것이며, 발생률·체적·환기 같은 물리량을 쓰지 않았다. 상승 속도·정점·유지 시간은 설정 파일의 범위에서 뽑은 가정값이다.
- 작업 종류와 가스의 관계는 약한 가중치(HOT_WORK→CO, PAINTING_CLEANING→LEL, FLUID_SUPPLY·COMMISSIONING→O₂·CO₂·H₂S)만 적용했다. 모든 작업에 정상 에피소드가 있고, 모든 위험 작업에서 2종 이상의 가스가 초과한다.
- 상황 비율(가스별 경계 62·초과 60개씩 등)은 학습·기능 검증용 균형 세트이며 실제 발생 빈도가 아니다.
- SENSOR_ERROR 행의 값은 일시적 이상값이다. legal_state·minutes_to_threshold는 측정값 그대로 계산되므로, 소비자는 quality_flag로 이 행을 걸러야 한다.
- 이 데이터로 학습·평가한 결과는 '합성 시나리오에서 기능을 확인했다'로만 표현해야 한다.
