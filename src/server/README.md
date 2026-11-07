# Gas Shadow 서버 (시스템 구조도 구현)

> 규칙이 판정하고, AI는 미리 알리고 조치 근거를 찾아주고, 사람이 승인한다.

구조도 원본: [docs/architecture.html](../../docs/architecture.html)

```
센서 입력 ──10초마다──▶ 메인 서버 (FastAPI :8000) ──실시간 WebSocket──▶ 화면 (React :8732)
 현장: 측정기 → MQTT        규칙 판정 · 경보 · 저장                         관제 웹 · 3D
 시연: replayer → HTTP      (AI 없이도 동작)
                               │  ▲                 ▲
                         센서 값│  │사전 경고   저장 │
                               ▼  │                 │
                     AI 서버 (FastAPI :8001) ◀──▶ PostgreSQL + pgvector (판례집, :5434)
                       ① 위험 예측 (1분마다)
                       ② 조치 추천 (경보가 뜨면, LangGraph)
```

## AI를 쓰는 곳 — 정확히 여기뿐이다

AI는 **AI 서버 안의 3곳**에만 있다. 메인 서버·재생기·화면에는 AI가 없다.
법정 기준 초과 판정과 경보는 **규칙**(`main_server/rules.py`)이 하고, AI 결과는 이 판정을 바꾸지 못한다.

| # | 어디서 | 무엇을 | 기술 | 코드 | 입력 → 출력 | AI가 없거나 실패하면 |
|---|---|---|---|---|---|---|
| **AI ①** | 위험 예측 (항상, 1분마다) | 최근 40분 5가스 추세로 **앞으로 60분 안에 어떤 가스가 언제 기준을 넘을지** 미리 알린다 | 자체 학습 scikit-learn 모델 (`가스예측모델/`) | `ai_server/predictor.py` | 구역별 최근 40분 센서 값(10초 → 15초 격자 보간) + 작업 종류 → `STABLE/WATCH/IMMINENT`, 가스, 남은 분, 30분 내 위험 확률 | 화면에 AI 예측만 안 보임. 규칙 경보는 그대로 |
| **AI ②-2** | 조치 추천 2단계 · RAG 검색 | 경보 상황과 **비슷한 과거 처리 기록(판례)** 을 판례집에서 찾는다 | pgvector 벡터 검색 (+ `embed.py` 글 → 벡터). DB가 없으면 메모리 판례집 `memcases.py`에서 같은 방식으로 찾는다 | `ai_server/graph.py` `retrieve()` · `ai_server/embed.py` · `ai_server/memcases.py` | 상황 문장(작업·가스·추세·환기·인원) → 비슷한 판례 3건 + 유사도 | DB가 없으면 합성 판례 10건 + 이번 실행 중 승인 기록에서 찾음 (AI 서버를 다시 켜면 승인 기록은 사라짐) |
| **AI ②-3** | 조치 추천 3단계 · 추천 쓰기 | 찾은 판례를 근거로 **조치 순서와 이유**를 쓴다. 단계마다 근거 판례 번호를 단다 | OpenAI 또는 OpenRouter LLM (OpenAI 호환 API, `.env`로 고른다) | `ai_server/llm.py` | 지금 상황 + 판례 3건 → `{summary, steps[{action, reason, case_ids}], cautions}` | 키가 없거나 실패하면 1위 판례의 조치를 그대로 옮긴 **대체 추천** (화면에 "LLM 미사용" 표시) |

AI가 아닌 부분 (같은 흐름 안이지만 규칙·사람이 한다):

| 단계 | 누가 | 코드 |
|---|---|---|
| 법정 기준 초과 판정 · 경보 | 규칙 | `main_server/rules.py`, `main_server/app.py` `raise_alarm()` |
| ② 조치 추천 전체 순서 진행 | LangGraph (AI 작업 순서를 짜고 진행하는 도구. 그 자체는 판단하지 않음) | `ai_server/graph.py` |
| ②-1 상황 모으기 | 메인 서버 | `main_server/app.py` `zone_context()` |
| ②-3 뒤 추천 검사 (첫 단계가 중지·대피인지, 없는 판례를 인용했는지) → 이상하면 다시 쓰게 함 (최대 2번) | 규칙 | `ai_server/graph.py` `check()` |
| ②-4 관리자 승인 · 고쳐서 승인 | **사람** — LangGraph가 `interrupt()`로 멈춰 기다린다 | 화면 `components/AiPanels.tsx` → `/api/recommendations/{id}/decision` |
| ②-5 기록 저장 → 새 판례로 쌓임 | DB | `ai_server/graph.py` `save()` |

화면에서 AI 결과가 나오는 곳 (AI 전용 색은 따로 쓰지 않고, 상태 색 규칙을 따른다 — 예측은 경계와 같은 주황):

- AI ① 예측: '주의 구역' 항목의 "예측 · …" 줄, 사전 경고 목록, 구역 상세의 [예측] 줄, 에이전트 알림 "예측 · …"
- AI ② 조치 추천: 오른쪽 **안전 에이전트** 아래쪽 카드 (근거 · 고쳐서 승인 · 승인)
- 에이전트 자유 질문: AI 서버 `/chat` (LLM, 화면이 보낸 지금 상황만 근거). LLM 키가 없으면 답하지 않고 안내만 한다

## 실행

필요: Python 3.11+, Node.js 20.19+, PostgreSQL 17 + pgvector (macOS: `brew install postgresql@17 pgvector`)

```bash
# 0) 처음 한 번
python3 -m venv .venv
.venv/bin/pip install -r src/server/requirements.txt
LC_ALL=en_US.UTF-8 /opt/homebrew/opt/postgresql@17/bin/pg_ctl -D /opt/homebrew/var/postgresql@17 -o "-p 5434" -l /opt/homebrew/var/postgresql@17/server.log start
/opt/homebrew/opt/postgresql@17/bin/createdb -p 5434 -h localhost gas_shadow
.venv/bin/python -m src.server.ai_server.seed        # 판례집에 시연용 합성 판례 10건

# 1) 터미널 4개 (저장소 루트에서)
.venv/bin/uvicorn src.server.ai_server.app:app --port 8001
.venv/bin/uvicorn src.server.main_server.app:app --port 8000
.venv/bin/python -m src.server.replayer.replay
cd src/dashboard && npm run dev                      # http://localhost:8732
```

- 컴퓨터를 재부팅했으면 DB만 다시 켠다 (`pg_ctl ... start` 줄).
- LLM을 쓰려면 `src/server/.env`에 넣는다 (git에 올라가지 않음). 바꾼 뒤 AI 서버를 다시 켠다. 켤 때 로그에 `LLM: openai · 모델명`이 나오면 연결된 것이다 (`GET :8001/health`의 `llm`에서도 보임)
  - OpenAI: `OPENAI_API_KEY=...` + `OPENAI_MODEL=...` (모델 기본값 없음, 둘 다 있어야 쓴다)
  - OpenRouter: `OPENROUTER_API_KEY=...` (모델은 `OPENROUTER_MODEL`). 두 키가 다 있으면 OpenAI를 쓴다
- DB 없이도 서버 3개는 뜬다. 센서 값·경보 저장은 건너뛰고, 판례 검색은 메모리 판례집으로 한다
- Windows: 위 명령의 `.venv/bin/` 대신 `.venv\Scripts\` (예: `.venv\Scripts\python -m uvicorn src.server.ai_server.app:app --port 8001`)
- 서버 없이 화면만 보려면 `npm run dev`만 켜거나 `http://localhost:8732/?data=local` — 예전처럼 브라우저 안 시뮬레이션으로 돈다.
- 데모 바(재생·속도·처음부터·통신 장애)는 서버 모드에서 재생기를 조종한다.

## 파일

```
src/server/
├── common/        설정(.env) · DB 연결 · schema.sql (readings · alarms · cases · action_records)
├── main_server/   app.py (수신·규칙·경보·WebSocket) · rules.py (규칙 판정)
├── ai_server/     app.py · predictor.py (AI ①) · graph.py (LangGraph ②) · llm.py (AI ②-3) · embed.py (AI ②-2) · seed.py (판례 초기값)
└── replayer/      replay.py (시연 센서) · scenario.py (화면 scenario.ts 와 같은 구역·곡선)
```

## 시연 시나리오 (오늘 관제)

위험 구역 3곳은 5가스 위험예측 모델의 **시험(test) 에피소드 값을 그대로** 흘린다. 나머지 구역은 평상시 값이다.
측정기는 작업 전 측정 때 붙인다고 보고(결정 #5 탈부착식), 측정 시작 전에는 값이 없고 '작업 없음'으로 보인다.
값은 `src/dashboard/src/data/episodes.json` 하나를 재생기와 화면이 같이 읽는다 (`scripts/export_episodes.py`로 다시 만든다).

| 구역 | 에피소드 (작업) | 측정 시작 | 작업 시작 | ✦AI 사전 경고 | 법정 초과 | 먼저 알린 시간 |
|---|---|---|---|---|---|---|
| WBT No.3 (S) | S0136 (도장/세척) | 08:52 | 09:04 | 09:03 (LEL) | 09:18 LEL | 15분 |
| 코퍼댐 CD-3 | S1153 (화기) | 09:05 | 09:16 | 09:17 (CO) | 09:31 CO | 14분 |
| 애프터피크 탱크 | S0406 (화기) | 09:30 | 09:44 | 09:41 (CO) | 09:54 CO | 13분 |

- 위 시각은 서버를 1초=1분으로 돌려 확인한 값이다 (2026-11-02). 나머지 허가 구역 6곳은 내내 `STABLE`, 경보 3건 모두 조치 추천이 붙었다.
- 고른 기준: 작업 종류가 구역 허가 작업과 같고, 경고하는 동안 예상 가스가 실제 초과 가스와 같고, 서버와 같은 방식(10초 샘플 보간)으로 30초마다 예측해도 첫 경고부터 초과까지 `STABLE`이 한 번도 없는 것. 초과가 늦은 에피소드(S0042 42분 등)는 중간에 `STABLE`로 돌아가서 뺐다.
- AI 서버는 모델 README 7절의 후처리(`StateStabilizer`, 같은 상태 2번 연속일 때만 전환)를 쓴다.
- 허가 작업이 없는 구역은 예측하지 않는다 (작업자 없음). 16구역 예측 한 번이 2.5초라 배속 시연에서 갱신이 늦어지던 것을 줄였다.
- 작업 상태(모델 입력)는 구역의 작업 시작·끝 시각으로 `PRE_WORK`·`WORK`·`RECOVERY`를 나눈다.

## 이 맥에서 돌릴 때 (참고)

- PostgreSQL 17은 이미 5432로 돌고 있어서 `src/server/.env`에 `DATABASE_URL=postgresql://localhost:5432/gas_shadow`를 넣었다 (git 제외)
- 파이썬 3.12 가상환경은 `uv venv --python 3.12 .venv` 후 `uv pip install --python .venv/bin/python -r src/server/requirements.txt`
- 대시보드 포트가 8732가 아니면 `npx vite --port 8740 --host 0.0.0.0` (프록시 설정은 그대로 메인 서버 8000으로 간다)

## 한계 · 확인 안 된 것

- **AI ① 모델은 '측정 시작 후 흐른 시간'과 작업 종류에 크게 기댄다.** 2026-11-02에 직접 돌려 본 결과
  - 처음 시연 곡선(완만한 직선 상승)에서는 기준 초과 직전까지 모두 `STABLE`이었다 (CO가 분당 0.5 ppm씩 22.8 ppm까지 올라도 30분 내 위험 0 %).
  - 모델 시험 에피소드 16개(초과 8 · 안전 8)는 **모두** 측정 10분 뒤 `IMMINENT`. 안전한 에피소드도 11~29분 경고하다가 `STABLE`로 돌아간다 (모델 README 11절과 같은 관찰).
  - 그래서 시연 시나리오를 아래 '시연 시나리오'처럼 바꿨다. **현장에서 같은 성능이 나온다는 뜻이 아니다.**
- 판례집의 판례 10건은 **시연용 합성 기록**이다. 실제 사고·처리 사례가 아니다. 멘토 자료(사내 자료)는 LLM으로 외부에 나갈 수 있어서 넣지 않았다. 법 조문도 원문 검증 전이라 넣지 않았다.
- `embed.py`는 글자 조각을 세는 가벼운 방식이라 뜻이 비슷하지만 낱말이 다른 글은 잘 못 찾는다. 문장 임베딩 모델로 바꾸면 `seed --reembed`로 다시 계산한다.
- 승인 대기 중인 추천은 AI 서버 메모리에 있다. AI 서버를 재시작하면 대기 중인 추천은 승인할 수 없다 (이미 저장된 판례는 DB에 남는다).
- 측정요원 호출·현장 이벤트·허가서 화면은 아직 브라우저 쪽 데이터다 (서버로 옮기지 않음).
- 현장 MQTT 수신기는 만들지 않았다. 재생기 자리를 MQTT 구독 → `/api/ingest` POST로 바꾸면 된다.
