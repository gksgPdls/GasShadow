"""판례집 초기 데이터 넣기. 처음 한 번 실행한다 (이미 있으면 건너뜀).

  .venv/bin/python -m src.server.ai_server.seed            # 저장소 루트에서
  .venv/bin/python -m src.server.ai_server.seed --reembed  # embed.py 를 바꾼 뒤 벡터만 다시 계산

⚠️ 아래 판례는 전부 **시연용 합성 기록**이다. 실제 사고·처리 사례가 아니다.
   멘토 자료(조선소 사내 자료, 비공개)는 외부 LLM으로 나갈 수 있어서 여기에 넣지 않는다.
   법 조문은 원문 검증 전이라 넣지 않는다 (CLAUDE.md: 미검증 내용 위에 쌓지 않는다).
"""
from __future__ import annotations

import argparse

from ..common.db import init_db, pool
from .embed import embed, to_pg

SEED = [
    {"title": "선행도장 이중저 WBT, 송풍기 1대 정지로 LEL 급상승", "task": "도장 터치업", "gas": "LEL",
     "situation": "이중저 밸러스트 탱크 도장 터치업 중 송풍기 2대 중 1대 정지. LEL 분당 약 1%씩 상승해 12%LEL 도달. 작업자 3명 내부.",
     "actions": "1) 도장 작업 즉시 중지, 스프레이건·점화원 차단 2) 작업자 3명 맨홀로 대피, 인원 점검 3) 정지 송풍기 재가동 및 대기 송풍기(2번) 가동 4) 측정요원 휴대용 측정기로 상·중·하 재측정 5) LEL 5% 미만 30분 유지 확인 후 관리감독자 승인 받아 재입장",
     "outcome": "20분 후 LEL 3%LEL로 하강. 송풍기 전원 케이블 손상 확인 후 교체."},
    {"title": "도장 중 환기 덕트 꺾임으로 LEL 경계 진입", "task": "내부 도장", "gas": "LEL",
     "situation": "포어피크 탱크 내부 도장. 환기 덕트가 맨홀에서 꺾여 풍량 저하. LEL 6%LEL에서 완만히 상승 중. 작업자 2명.",
     "actions": "1) 도장 일시 중지 2) 덕트 꺾임 해소, 덕트 끝을 탱크 하부까지 연장 3) LEL 하강 추세 확인 후 작업 재개",
     "outcome": "10분 내 LEL 2%LEL로 하강, 작업 재개."},
    {"title": "아르곤 백퍼지 용접 중 산소 농도 저하", "task": "아르곤 용접", "gas": "O2",
     "situation": "이중저 탱크 배관 아르곤 백퍼지 용접. 아르곤 누출로 O2가 분당 0.04%씩 하락, 18.5%까지 떨어짐. 작업자 2명.",
     "actions": "1) 용접 중지, 아르곤 공급 밸브 잠금 2) 작업자 즉시 대피 3) 급기 송풍기로 신선 공기 공급 4) 퍼지 호스·이음부 누설 점검 5) O2 19.5% 이상 회복 확인 후 재입장",
     "outcome": "퍼지 호스 이음부 누설 확인, 교체 후 재개."},
    {"title": "파이프덕트 아르곤 체류로 산소 결핍 경계", "task": "아르곤 용접", "gas": "O2",
     "situation": "좁은 파이프덕트 아르곤 용접. 하부에 아르곤이 고여 O2 19.2%. 환기 1대.",
     "actions": "1) 작업 일시 중지 2) 배기 덕트를 하부에 설치해 고인 아르곤 배출 3) 작업자 위치를 상부로 조정 4) 재측정 후 재개",
     "outcome": "O2 20.5% 회복."},
    {"title": "코퍼댐 절단·그라인딩 중 일산화탄소 상승", "task": "절단·그라인딩", "gas": "CO",
     "situation": "코퍼댐 내부 가스 절단 및 그라인딩. 배기 부족으로 CO가 분당 0.5ppm씩 올라 28ppm. 작업자 2명.",
     "actions": "1) 절단 작업 중지, 토치 소화 2) 작업자 대피 3) 국소 배기 장치 설치, 배기 덕트를 절단 지점 가까이 4) CO 20ppm 미만 확인 후 재개 5) 절단 시간 분할 운영",
     "outcome": "CO 8ppm으로 하강, 국소 배기 상시 가동 조건으로 재개."},
    {"title": "엔진룸 하부 용접 흄 CO 경계", "task": "보강재 용접", "gas": "CO",
     "situation": "애프터피크 탱크 보강재 용접. CO 22ppm, 완만한 상승. 송풍기 1대.",
     "actions": "1) 대기 송풍기(2번) 가동 2) 용접 지점 국소 배기 3) 15분 뒤 재측정",
     "outcome": "CO 12ppm 유지."},
    {"title": "연료유 탱크 용제 세척 중 이산화탄소 상승", "task": "용제 세척", "gas": "CO2",
     "situation": "연료유 탱크 용제 세척, 인원 4명으로 증가. 환기 부족으로 CO2 1.3%까지 상승.",
     "actions": "1) 내부 인원 2명으로 축소 2) 대기 송풍기 가동, 급기·배기 위치 분리 3) CO2 1.0% 미만 확인 후 인원 복귀",
     "outcome": "CO2 0.6%로 하강."},
    {"title": "TST 신너 세척 중 LEL 상승", "task": "용제 세척(신너)", "gas": "LEL",
     "situation": "톱사이드 탱크 신너 세척. 신너 용기 뚜껑 개방 상태로 방치, LEL 8%LEL.",
     "actions": "1) 세척 중지 2) 신너 용기 밀폐 후 탱크 밖으로 반출 3) 환기 강화 4) 방폭 공구 사용 확인 5) LEL 5% 미만 확인 후 재개",
     "outcome": "LEL 1.5%LEL로 하강."},
    {"title": "이중저 오수 체류 구역 황화수소 검출", "task": "배관 내부 청소·검사", "gas": "H2S",
     "situation": "이중저 배관 내부 청소 중 슬러지 교반으로 H2S 7ppm 검출, 상승 추세. 작업자 2명.",
     "actions": "1) 청소 작업 중지 2) 작업자 대피 3) 슬러지 구역 환기, 교반 중지 4) 송기마스크 착용 조건 검토 5) H2S 5ppm 미만 확인 후 재입장",
     "outcome": "환기 40분 뒤 H2S 1ppm 미만."},
    {"title": "센서 통신 두절 구역 수동 측정 대응", "task": "아르곤 용접", "gas": "O2",
     "situation": "파이프덕트 고정식 센서 통신 두절 20분. 작업 진행 중, 최근 값 정상이었으나 확인 불가.",
     "actions": "1) 측정요원 출동, 휴대용 측정기로 즉시 측정 2) 측정 전까지 작업자 상부 대기 3) 센서 전원·통신 점검 4) 복구 전까지 30분마다 수동 측정",
     "outcome": "센서 배터리 방전 확인, 교체 후 복구."},
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reembed", action="store_true")
    args = ap.parse_args()
    if init_db() is None:
        raise SystemExit("DB에 연결할 수 없습니다 (DATABASE_URL 확인)")
    with pool().connection() as c:
        if args.reembed:
            rows = c.execute("SELECT id, title, situation FROM cases").fetchall()
            for i, title, sit in rows:
                c.execute("UPDATE cases SET embedding = %s::vector WHERE id = %s", (to_pg(embed(f"{title} {sit}")), i))
            print(f"벡터 다시 계산: {len(rows)}건")
            return
        n = c.execute("SELECT count(*) FROM cases WHERE source = 'seed_synthetic'").fetchone()[0]
        if n:
            print(f"이미 {n}건 있음 — 건너뜀")
            return
        for s in SEED:
            c.execute(
                "INSERT INTO cases (source, title, task, gas, situation, actions, outcome, embedding) "
                "VALUES ('seed_synthetic', %s, %s, %s, %s, %s, %s, %s::vector)",
                (s["title"], s["task"], s["gas"], s["situation"], s["actions"], s["outcome"],
                 to_pg(embed(f"{s['title']} {s['situation']}"))))
        print(f"합성 판례 {len(SEED)}건 저장")


if __name__ == "__main__":
    main()
