-- 판례집 DB. 메인 서버와 AI 서버가 같이 쓴다. 서버가 켜질 때마다 실행해도 안전하게 IF NOT EXISTS로 쓴다.
CREATE EXTENSION IF NOT EXISTS vector;

-- 센서 값 (10초마다, 구역별 한 줄). t_min = 시연 시각(자정 이후 분)
CREATE TABLE IF NOT EXISTS readings (
  id          BIGSERIAL PRIMARY KEY,
  run_id      TEXT NOT NULL,
  zone_id     TEXT NOT NULL,
  t_min       DOUBLE PRECISION NOT NULL,
  o2 DOUBLE PRECISION, lel DOUBLE PRECISION, co DOUBLE PRECISION, h2s DOUBLE PRECISION, co2 DOUBLE PRECISION,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS readings_zone_t ON readings (run_id, zone_id, t_min);

-- 규칙층 경보 (법정 기준 초과가 처음 확인된 순간 한 줄)
CREATE TABLE IF NOT EXISTS alarms (
  id         BIGSERIAL PRIMARY KEY,
  run_id     TEXT NOT NULL,
  zone_id    TEXT NOT NULL,
  t_min      DOUBLE PRECISION NOT NULL,
  gas        TEXT NOT NULL,
  value      DOUBLE PRECISION NOT NULL,
  acked      BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 판례: 비슷한 상황을 찾을 때 쓰는 과거 처리 기록. embedding = situation 글의 벡터 (ai_server/embed.py)
CREATE TABLE IF NOT EXISTS cases (
  id         BIGSERIAL PRIMARY KEY,
  source     TEXT NOT NULL,            -- seed_synthetic(시연용 합성) · approved(관리자 승인 기록)
  title      TEXT NOT NULL,
  task       TEXT,
  gas        TEXT,
  situation  TEXT NOT NULL,            -- 검색 대상 글: 작업·가스·추세·환기·인원
  actions    TEXT NOT NULL,            -- 실제로 한 조치
  outcome    TEXT,
  alarm_id   BIGINT,
  embedding  vector(512) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AI 추천과 관리자 결정 (② 조치 추천 4·5단계)
CREATE TABLE IF NOT EXISTS action_records (
  id             BIGSERIAL PRIMARY KEY,
  alarm_id       BIGINT NOT NULL,
  zone_id        TEXT NOT NULL,
  recommendation JSONB NOT NULL,
  decision       TEXT NOT NULL,        -- approved · edited
  final_steps    JSONB NOT NULL,
  approver       TEXT,
  note           TEXT,
  decided_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
