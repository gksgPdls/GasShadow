# 데이터 사전

모든 행은 합성 데이터(`source_type=SYNTHETIC`)다.

## `output/gas_timeseries.csv` (16개 컬럼, 1행 = 측정기 1대의 1회 표시값)

| 컬럼 | 형 | 단위 | 정의 |
|---|---|---|---|
| scenario_id | str | | 하나의 연속 작업 상황 ID (`S0000` ~). 메타데이터·분할의 키 |
| timestamp | ISO datetime | | 측정 시각(가상). 15초 간격(`time.sample_interval_s`) |
| sensor_id | str | | 가상 측정기 ID (`GS-001` ~ `GS-079`) |
| task_type | str | | HOT_WORK / PAINTING_CLEANING / ELECTRICAL / RADIOGRAPHY / COMMISSIONING / SCAFFOLDING / FLUID_SUPPLY / PRESSURE_TEST / BARGE_WORK / HEAVY_LIFTING / OTHER / NONE |
| task_state | str | | PRE_WORK / WORK / RECOVERY. `NONE`은 전체가 PRE_WORK |
| o2_pct | float | % | 산소. 해상도 0.1 |
| lel_pct | float | %LEL | 표준화된 가연성가스(교정가스 미반영). 해상도 1 |
| co_ppm | float | ppm | 일산화탄소. 해상도 1 |
| h2s_ppm | float | ppm | 황화수소. 해상도 0.1 |
| co2_pct | float | % | 이산화탄소. 해상도 0.01 |
| quality_flag | str | | OK / MISSING(단기 결측) / COMM_LOSS(통신 두절) / SENSOR_ERROR(일시적 이상값). MISSING·COMM_LOSS 행은 5가스가 모두 빈칸 |
| legal_state | str | | NORMAL / APPROACH / EXCEEDED / UNAVAILABLE. 5가스 측정값으로 계산 |
| threshold_gas | str | | 앞으로 가장 먼저 기준을 초과하는 가스: O2 / LEL / CO / H2S / CO2. 예측 범위 안에 초과가 없거나 결측이면 빈칸 |
| minutes_to_threshold | float | min | 현재 이후 예측 범위(60분) 안에서 가장 먼저 기준을 초과하는 시점까지 남은 시간. 현재 초과 중이면 0, 없으면 빈칸, 결측이면 빈칸 |
| source_type | str | | SYNTHETIC |
| split | str | | train / validation / test (`scenario_id` 단위, 작업 종류별 층화 70/15/15) |

기준: O₂ <18 또는 ≥23.5 %, CO ≥30 ppm, H₂S ≥10 ppm, CO₂ ≥1.5 %, LEL ≥10 %LEL.
경계 접근: 기준까지 O₂ 0.5 %p, CO 6 ppm, H₂S 2 ppm, CO₂ 0.3 %p, LEL 2 %LEL 이내 (`config.approach_band`).

가스별 초과 여부, 10/30분 내 초과 여부, 가스별 도달시간은 컬럼으로 두지 않았다. 5가스 값과 기준, `minutes_to_threshold`에서 계산한다.

## `output/scenario_metadata.csv` (6개 컬럼, 1행 = 에피소드)

| 컬럼 | 정의 |
|---|---|
| scenario_id | 에피소드 ID |
| ptw_id | 가상 작업허가서 ID |
| zone_id | 가상 밀폐구역 ID |
| task_start | 작업 시작 시각(ISO). `NONE`은 빈칸 |
| task_end | 작업 종료 시각(ISO). `NONE`은 빈칸 |
| random_seed | 에피소드 재생성용 정수 시드(전역 시드와 에피소드 번호에서 유도) |

## `output/gas_timeseries_sample.csv`

전체와 같은 16개 컬럼. 작업 종류 12종마다 정상 1개·위험 1개, 가스별 경계·초과 1개씩, 센서 이상 4종, 완만한 변화·회복 유형을 포함한 열람용 발췌.
