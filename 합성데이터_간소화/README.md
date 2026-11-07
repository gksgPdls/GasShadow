# 조선소 밀폐구역 5가스 합성 시계열 생성기 (간소화)

작업허가서로 관리되는 여러 작업 종류를 대상으로, **현장에서 받을 수 있는 정보(작업 종류·작업 상태·5가스 측정값·측정 품질)**만으로
상태 판정·위험 가스 식별·기준 도달시간 예측·결측 처리를 학습·검증할 수 있는 합성 데이터를 만든다.

- 물리 모델(용접기 수, 유량, 체적, 풍량, 덕트 위치, 센서 높이, T90, 교정가스, 참농도)은 **쓰지 않는다**. 데이터 컬럼에도 없다.
- 모든 행은 `source_type=SYNTHETIC`이다. **실측이 아니며, 상황 비율은 학습·기능 검증용 균형 세트이지 실제 발생 빈도가 아니다.**
- 기존 `합성데이터/` 폴더와는 독립이며 수정하지 않았다.

## 생성 방식

1. 에피소드 명세: 작업 종류(12종) × 상황(정상 / 완만한 변화 / 경계 접근 / 기준 초과 / 작업 중 회복 / 작업 후 회복) × 센서 이상(없음 / 단기 결측 / 통신 두절 / 이상값 / 위험 직전 결측).
2. 시간 구조: PRE_WORK(5–15분) → WORK(20–85분) → RECOVERY(5–25분), 총 30–120분. `NONE`은 작업 없이 30–60분 배경.
3. 가스 곡선: 배경값 + 정점 × 모양(t). 모양은 시작 시각부터 `1−exp(−Δt/τ_rise)`로 완만히 올라가 유지한 뒤 `exp(−Δt/τ_decay)`로 점진 감소. 작업 시작·종료 시점에 값이 튀지 않는다.
   - 경계 접근: 정점이 경계 범위 안(기준에서 잡음 여유를 둔 구간)
   - 기준 초과: 정점이 기준 너머, 일정 시간 유지 후 감소
   - 작업 중 회복: 초과 후 작업 중에 정상으로 돌아옴 / 작업 후 회복: 작업 종료 시점부터 감소
   - 위험 에피소드의 절반에서는 다른 가스 1–2개도 완만히 함께 변한다(한 가스만 움직이는 패턴 방지)
4. 잡음·해상도: 가스별 측정 잡음과 표시 해상도 반올림.
5. 센서 이상: MISSING(1–3샘플 × 1–3회), COMM_LOSS(5–30분), SENSOR_ERROR(1–2샘플 이상값), 위험 직전 결측(첫 초과 1–6분 전부터 3–15분 통신 두절). 결측은 5가스 모두 빈칸이며 0으로 채우지 않는다.
6. 라벨(측정값 기준): `legal_state`, `threshold_gas`, `minutes_to_threshold`.

### 작업 종류와 가스의 약한 관계

위험 상황을 어느 작업에 배정할지 가중치로만 정한다. 작업만 보고 가스가 정해지지 않는다.

| 작업 | 상대적으로 높은 가스 |
|---|---|
| HOT_WORK | CO |
| PAINTING_CLEANING | LEL |
| FLUID_SUPPLY, COMMISSIONING | O₂, CO₂, H₂S |
| ELECTRICAL, RADIOGRAPHY, SCAFFOLDING, PRESSURE_TEST, BARGE_WORK, HEAVY_LIFTING, OTHER | 대부분 정상, 일부 환경 이상(모든 가스 가능) |
| NONE | 정상 배경·센서 점검만(위험 없음) |

모든 작업 종류에 정상 에피소드가 있고, 모든 위험 작업 종류에서 5가스 모두 초과 사례가 있다(검증 보고서의 작업×가스 표).

### 기준과 라벨

- 기준: O₂ <18 또는 ≥23.5 %, CO ≥30 ppm, H₂S ≥10 ppm, CO₂ ≥1.5 %, LEL ≥10 %LEL. `lel_pct`는 교정가스를 반영하지 않은 표준화 %LEL.
- 경계 접근 범위(설정 가능): O₂ 0.5 %p, CO 6 ppm, H₂S 2 ppm, CO₂ 0.3 %p, LEL 2 %LEL.
- `legal_state`: 결측이면 UNAVAILABLE, 하나라도 초과면 EXCEEDED, 경계 범위면 APPROACH, 그 외 NORMAL.
- `minutes_to_threshold`: 현재 이후 60분(설정 가능) 안에서 가장 먼저 기준을 초과하는 시점까지 남은 분. 현재 초과 중이면 0, 범위 안에 초과가 없으면 빈칸, 결측이면 빈칸. `threshold_gas`는 그 초과 가스(O2/LEL/CO/H2S/CO2), 없으면 빈칸.
- SENSOR_ERROR 행은 값이 들어 있으므로 라벨도 값 그대로 계산된다. 학습·평가 시 `quality_flag`로 걸러서 쓴다.

## 실행

```bash
cd 합성데이터_간소화
python3 -m generator.generate            # config/default.yaml → output/ (약 10초)
python3 -m generator.generate --seed 7 --out /tmp/x
python3 -m generator.validate            # 검증 → validation_report.md (실패 시 종료코드 1)
python3 tests/run_tests.py               # 테스트 (pytest 없이)
pytest tests/
```

필요 패키지: numpy, pandas, pyyaml.

같은 `random_seed`면 같은 데이터가 나온다. 에피소드 하나는 `scenario_metadata.csv`의 `random_seed`와 설정으로 다시 만들 수 있다(검증 16번 항목이 이를 확인).

## 산출물

```
합성데이터_간소화/
  generator/  episodes.py(명세·곡선·센서이상·라벨) generate.py(생성·저장) validate.py(검증·보고서)
  config/default.yaml          # 개수·기준·경계 범위·곡선 시간상수·잡음·센서 이상 설정
  output/
    gas_timeseries.csv         # 16개 컬럼, 1,259 에피소드, 380,917행
    gas_timeseries_sample.csv  # 작업 종류 12종 × 정상/위험 + 가스별 경계·초과 + 센서 이상 4종 (약 1만 행)
    scenario_metadata.csv      # 6개 컬럼
    config_used.yaml           # 생성에 쓴 설정 사본
  tests/test_generator.py  tests/run_tests.py
  README.md  data_dictionary.md  validation_report.md
```

## 한계

- 곡선은 설명 가능한 단순 패턴이다. 실제 가스 거동(발생원·환기·공간)을 재현하지 않으며, 상승 속도·정점·유지 시간은 설정 범위에서 뽑은 가정이다.
- 작업과 가스의 관계는 약한 가중치일 뿐이다. 현장 자료가 생기면 가중치와 정점 범위를 그 분포로 바꿔야 한다.
- 센서 한 대의 값이 공간 전체를 대표하는지는 이 데이터가 말해주지 않는다.
- 상황 비율은 균형 세트다. 현장 빈도로 재샘플링한 검증 세트가 따로 필요하다.
- 이 데이터로 얻은 성능은 "합성 시나리오에서 기능을 확인했다"로만 표현한다.
