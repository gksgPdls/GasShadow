"""관제 시연용 블록·구획 데이터 만들기 (SYNTHETIC) → src/dashboard/src/data/site.json

블록 하나 안을 칸막이(플로어·거더·스트링거·데크)로 나눈 칸(구획)을 모두 그리되, 측정기는
오늘 작업이 있는 칸과 그 칸에 맞닿은 칸(인접 공간)에만 붙인다 (OSHA 1915.12(a) 공간 + 인접 공간 측정, 결정 #32).
측정기가 있는 칸만 감시 구역(zones)이고, 나머지 칸은 3D에 윤곽만 그린다 (blocks[].comps).
화면(src/dashboard/src/data/scenario.ts)과 서버 재생기(src/server/replayer/scenario.py)가 이 JSON을 같이 읽는다.

  python3 scripts/build_site.py          # 저장소 루트에서

좌표는 블록 기준 미터: x = 선박 길이 방향(가운데 0), y = 바닥 0에서 위, z = 폭 방향(가운데 0, +z가 장비·출입현황판 쪽 앞면).
치수 근거와 가정은 src/dashboard/README.md '3D 근거와 가정' 표. 블록 치수·칸막이 간격·구획 이름·작업 배정은 모두 설명용 가정이다.
"""
from __future__ import annotations

import json
import pathlib

OUT = pathlib.Path(__file__).resolve().parents[1] / "src" / "dashboard" / "src" / "data" / "site.json"
FRAME = 0.86  # 늑골 간격 (m). Panamax 벌커 실선 860 mm (Intercargo 제출 논문 Table 1) — VLGC 값은 못 찾아 가정

# ---------- 블록 종류별 칸막이 ----------
# 단면(z, y) 다각형 · 가로 칸막이 x(플로어·웹) · 세로 칸막이 z(거더) · 수평 칸막이 y(스트링거·데크)
# 감시 구획 경계 = 세로 칸막이(zs) · 수평 칸막이(ys) 전부 + 가로 칸막이 중 수밀(wt_x)인 것.
# wt_*: 수밀 칸막이 (맨홀 없음). 나머지 칸막이에는 맨홀이 뚫려 있어 이웃 칸과 이어진다 (현장 사진).
# 플로어·웹(xs)은 3.2 m마다 있지만 구획을 더 잘게 나누지는 않는다 (구획 하나 = 길이 약 10 m)
def rect(z0, z1, y0, y1):
    return [[z0, y0], [z1, y0], [z1, y1], [z0, y1]]


def steps(a, b, d):
    n = round((b - a) / d)
    return [round(a + (b - a) * i / n, 3) for i in range(n + 1)]


# 근거(결정 #31): 플로어 간격 실선 약 2.6 m · CSR-BC "3.5 m 또는 4 frame 이하", 거더 간격 4~5 m, 이중저 높이 1.7~2.4 m(벌커 실선),
# 선측 스트링거 간격 6 m 이하(IMO MSC.133(76)). VLGC는 이중저 + 단일 선측 + 호퍼·톱사이드 (BV VLGC 논문) → 이중선체 블록은 두지 않는다
F3 = round(3 * FRAME, 3)  # 플로어 간격 = 3 프레임 (2.58 m)
F4 = round(4 * FRAME, 3)  # 웹 간격 = 4 프레임 (3.44 m)
KINDS = {
    # 이중저: 길이 24프레임(20.64 m) · 폭 15 · 높이 2.4. 플로어 3프레임마다, 거더 3줄(파이프덕트 벽 · 사이드 거더 2, 간격 4.4 m)
    "db": dict(L=24 * FRAME, section=rect(-7.5, 7.5, 0, 2.4), xs=steps(-12 * FRAME, 12 * FRAME, F3), wt_x=[0.0],
               zs=[-6.3, -1.9, 2.5], wt_z=[-6.3], ys=[], access="bottom"),
    # PE장 그랜드 블록: 이중저 3개를 이은 것 (72프레임)
    "grand": dict(L=36 * FRAME, section=rect(-7.5, 7.5, 0, 2.4), xs=steps(-18 * FRAME, 18 * FRAME, F3), wt_x=[-6 * FRAME, 6 * FRAME],
                  zs=[-6.3, -1.9, 2.5], wt_z=[-6.3], ys=[], access="bottom"),
    # 기관실 이중저: 높이 3.0 (탱크가 칸칸이, 거더 전부 수밀)
    "er": dict(L=18 * FRAME, section=rect(-8.0, 8.0, 0, 3.0), xs=steps(-9 * FRAME, 9 * FRAME, F3), wt_x=[0.0],
               zs=[-4.0, 0.0, 4.0], wt_z=[-4.0, 0.0, 4.0], ys=[], access="bottom"),
    # 호퍼 탱크(빌지 호퍼, 밸러스트): 바닥 외판 · 선측 외판 · 비스듬한 호퍼판으로 둘러싸임. 웹 4프레임마다, 수평 스트링거 1개
    "hopper": dict(L=24 * FRAME, section=[[-4.0, 0], [4.0, 0], [4.0, 7.2], [-4.0, 1.6]], xs=steps(-12 * FRAME, 12 * FRAME, F4 * 0.75), wt_x=[0.0],
                   zs=[], wt_z=[], ys=[3.6], wt_y=[3.6], access="front"),
    # 코퍼댐(화물창 사이 이중 격벽): 두 격벽 사이 1.6 m, 높이 12, 폭 15. 수평 스트링거 3 m마다, 가운데 세로 웹
    "cofferdam": dict(L=1.6, section=rect(-7.5, 7.5, 0, 12.0), xs=[-0.8, 0.8], wt_x=[],
                      zs=[0.0], wt_z=[0.0], ys=[3.0, 6.0, 9.0], wt_y=[3.0, 6.0, 9.0], access="front"),
    # 톱사이드 탱크: 단면 삼각형(폭 7 · 높이 4.5). 웹 4프레임마다, 수평 스트링거 1개
    "topside": dict(L=24 * FRAME, section=[[-3.5, 0], [-3.5, 4.5], [3.5, 4.5]], xs=steps(-12 * FRAME, 12 * FRAME, F4 * 0.75), wt_x=[-4 * FRAME, 4 * FRAME],
                    zs=[], wt_z=[], ys=[2.25], wt_y=[2.25], access="top"),
    # 파이프덕트 블록: 폭 2.4 · 높이 2.4
    "duct": dict(L=24 * FRAME, section=rect(-1.2, 1.2, 0, 2.4), xs=steps(-12 * FRAME, 12 * FRAME, F3), wt_x=[0.0],
                 zs=[], wt_z=[], ys=[], access="bottom"),
    # 선수(포어피크·체인로커): 데크 2층, 가운데 세로 격벽
    "bow": dict(L=16 * FRAME, section=rect(-6.0, 6.0, 0, 12.0), xs=steps(-8 * FRAME, 8 * FRAME, F4), wt_x=[],
                zs=[0.0], wt_z=[0.0], ys=[4.0, 8.0], wt_y=[4.0, 8.0], access="front", warp="bow"),
    # 선미(애프터피크·스턴튜브): 데크 2층, 가운데 세로 격벽
    "stern": dict(L=16 * FRAME, section=rect(-7.0, 7.0, 0, 10.0), xs=steps(-8 * FRAME, 8 * FRAME, F4), wt_x=[],
                  zs=[0.0], wt_z=[0.0], ys=[3.4, 6.8], wt_y=[3.4, 6.8], access="front", warp="stern"),
}


def cells(kind):
    """구획 상자 목록 [x0, x1, z0, z1, y0, y1] (x → z → y 순서)"""
    k = KINDS[kind]
    zs_all = [p[0] for p in k["section"]]
    ys_all = [p[1] for p in k["section"]]
    xb = [k["xs"][0], *k["wt_x"], k["xs"][-1]]
    zb = [min(zs_all), *k["zs"], max(zs_all)]
    yb = [min(ys_all), *k["ys"], max(ys_all)]
    out = []
    for i in range(len(xb) - 1):
        for j in range(len(zb) - 1):
            for m in range(len(yb) - 1):
                out.append([xb[i], xb[i + 1], zb[j], zb[j + 1], yb[m], yb[m + 1]])
    return out


# ---------- 이름 ----------
# 화면 이름은 쉬운 말, 현장 약어(No.3 WBT(S) 등)는 보조 설명에 둔다.
# 탱크 약어는 현장 자료에도 쓰인다 (예: "NO.1 화물창" · "No.3 C.O.Tank(P)"), 'n번 칸' 번호는 우리가 붙인 것
SIDE = {"(P)": "좌현", "(S)": "우현", "P": "좌현", "S": "우현"}


def plain(tank: str) -> str:
    import re
    m = re.match(r"WBT No\.(\d) \((P|S)\)( 호퍼)?$", tank)
    if m:
        return f"{m.group(1)}번 밸러스트탱크({SIDE[m.group(2)]}){' 호퍼' if m.group(3) else ''}"
    m = re.match(r"TST No\.(\d) \((P|S)\)$", tank)
    if m:
        return f"{m.group(1)}번 톱사이드탱크({SIDE[m.group(2)]})"
    m = re.match(r"파이프덕트 PD-(\d)$", tank)
    if m:
        return f"파이프덕트 {m.group(1)}"
    m = re.match(r"체인로커 \((P|S)\)$", tank)
    if m:
        return f"체인로커({SIDE[m.group(1)]})"
    return {
        "연료유 탱크 FOT No.1 (P)": "1번 연료유탱크(좌현)", "연료유 서비스 탱크": "연료유 서비스탱크", "연료유 침전 탱크": "연료유 침전탱크",
        "포어피크 탱크": "선수 탱크", "애프터피크 탱크": "선미 탱크", "스턴튜브 구역": "선미관 구역", "조타기실 하부 보이드": "조타기실 아래 빈 공간",
        "보이드 E11-V1": "빈 공간", "보이드": "빈 공간", "윤활유 탱크 LOT": "윤활유탱크", "윤활유 저장 탱크": "윤활유 저장탱크",
        "청수 탱크": "청수탱크", "기관실 이중저 탱크": "기관실 이중저탱크",
    }.get(tank, tank)


def where(part: str) -> str:
    """위치 설명: 선수쪽 → 앞쪽, 선미쪽 → 뒤쪽, P/S → 좌현/우현"""
    out = []
    for w in (x.strip() for x in part.split("·")):
        if not w:
            continue
        w = w.replace("선수쪽", "앞쪽").replace("선미쪽", "뒤쪽")
        w = " ".join(SIDE.get(t, t) for t in w.split(" "))
        out.append(w)
    return " · ".join(out)


# ---------- 블록 ----------
# names: 구획 이름 (cells() 순서). 같은 탱크는 "탱크 이름 n구획"으로 붙인다
# frame: 블록 선미쪽 끝 프레임 번호
def db_names(tank, duct):
    # x 선미쪽 반 → (파이프덕트, 안쪽, 가운데, 바깥쪽 = z 작은 쪽부터) → 선수쪽 반
    # z: -7.5~-6.3 이 파이프덕트 (가운데선 쪽), 이후 바깥쪽으로
    seq = []
    for half in ("선미쪽", "선수쪽"):
        seq += [(duct, f"{half}"), (tank, f"{half} · 안쪽"), (tank, f"{half} · 가운데"), (tank, f"{half} · 바깥쪽")]
    return seq


BLOCKS = [
    # 대조립
    dict(id="B-S22", name="호퍼 S22", loc="No.5 화물창 호퍼 탱크 (P)", stage="assembly", kind="hopper", frame=110,
         names=[("WBT No.5 (P) 호퍼", f"{h} · {lv}") for h in ("선미쪽", "선수쪽") for lv in ("아래", "위")]),
    dict(id="B-A51", name="선미 A51", loc="애프터피크 · 스턴튜브", stage="assembly", kind="stern", frame=0,
         names=[("애프터피크 탱크", "P · 1층"), ("애프터피크 탱크", "P · 2층"), ("조타기실 하부 보이드", "P · 3층"),
                ("스턴튜브 구역", "S · 1층"), ("애프터피크 탱크", "S · 2층"), ("조타기실 하부 보이드", "S · 3층")]),
    dict(id="B-C41", name="코퍼댐 C41", loc="No.3·No.4 화물창 사이", stage="assembly", kind="cofferdam", frame=98,
         names=[("코퍼댐", f"{s} · {lv}층") for s in ("P", "S") for lv in (1, 2, 3, 4)]),
    # 대조립에서는 블록을 뒤집어 만든다 (삼성중공업 블로그 "중조립 블록을 뒤집어서(Turn Over)") → 바닥 외판이 위, 출입구도 위
    dict(id="B-D27", name="이중저 D27", loc="No.5 화물창 하부 (S) · 뒤집어 조립 중", stage="assembly", kind="db", frame=134, access="top",
         names=db_names("WBT No.6 (S)", "파이프덕트 PD-6")),
    # 선행의장
    dict(id="B-D25", name="이중저 D25", loc="No.4 화물창 하부 (P)", stage="outfit", kind="db", frame=110,
         names=db_names("WBT No.4 (P)", "파이프덕트 PD-5")),
    dict(id="B-D21", name="이중저 D21", loc="No.2 화물창 하부 (P)", stage="outfit", kind="db", frame=62,
         names=db_names("WBT No.2 (P)", "파이프덕트 PD-2")),
    dict(id="B-D23", name="이중저 D23", loc="No.3 화물창 하부 (S)", stage="outfit", kind="db", frame=86,
         names=db_names("WBT No.3 (S)", "파이프덕트 PD-3")),
    dict(id="B-E13", name="기관실 이중저 E13", loc="기관실 앞쪽 탱크", stage="outfit", kind="er", frame=24,
         names=[("윤활유 탱크 LOT", "선미쪽 · P"), ("윤활유 저장 탱크", "선미쪽 · P 안쪽"), ("빌지 웰", "선미쪽 · S 안쪽"), ("보이드", "선미쪽 · S"),
                ("윤활유 탱크 LOT", "선수쪽 · P"), ("윤활유 저장 탱크", "선수쪽 · P 안쪽"), ("코퍼댐", "선수쪽 · S 안쪽"), ("보이드", "선수쪽 · S")]),
    dict(id="B-P12", name="파이프덕트 P12", loc="No.1·No.2 화물창 하부 가운데", stage="outfit", kind="duct", frame=38,
         names=[("파이프덕트 PD-4", "선미쪽"), ("파이프덕트 PD-4", "선수쪽")]),
    # 선행도장
    dict(id="B-S35", name="톱사이드 S35", loc="No.5 화물창 위 (S)", stage="paint", kind="topside", frame=110,
         names=[("TST No.5 (S)", f"{h} · {lv}") for h in ("선미쪽", "가운데", "선수쪽") for lv in ("아래", "위")]),
    dict(id="B-S31", name="톱사이드 S31", loc="No.3 화물창 위 (P)", stage="paint", kind="topside", frame=86,
         names=[("TST No.3 (P)", f"{h} · {lv}") for h in ("선미쪽", "가운데", "선수쪽") for lv in ("아래", "위")]),
    dict(id="B-E11", name="기관실 하부 E11", loc="기관실 연료유 탱크", stage="paint", kind="er", frame=8,
         names=[("연료유 탱크 FOT No.1 (P)", "선미쪽"), ("연료유 서비스 탱크", "선미쪽"), ("연료유 침전 탱크", "선미쪽"), ("보이드 E11-V1", "선미쪽"),
                ("연료유 탱크 FOT No.1 (P)", "선수쪽"), ("연료유 서비스 탱크", "선수쪽"), ("코퍼댐", "선수쪽"), ("보이드 E11-V1", "선수쪽")]),
    dict(id="B-F01", name="선수 F01", loc="포어피크 · 체인로커", stage="paint", kind="bow", frame=270,
         names=[("포어피크 탱크", "P · 1층"), ("포어피크 탱크", "P · 2층"), ("체인로커 (P)", "3층"),
                ("포어피크 탱크", "S · 1층"), ("포어피크 탱크", "S · 2층"), ("체인로커 (S)", "3층")]),
    # PE장
    dict(id="B-S32", name="톱사이드 S32", loc="No.3 화물창 위 (S)", stage="pe", kind="topside", frame=86,
         names=[("TST No.3 (S)", f"{h} · {lv}") for h in ("선미쪽", "가운데", "선수쪽") for lv in ("아래", "위")]),
    dict(id="B-G05", name="그랜드 블록 G05", loc="이중저 3개를 합침 (No.1 화물창 S)", stage="pe", kind="grand", frame=14 + 30,
         names=[(t, f"{h} · {p}") for h in ("선미쪽", "가운데", "선수쪽")
                for t, p in (("파이프덕트 PD-1", ""), ("WBT No.1 (S)", "안쪽"), ("WBT No.1 (S)", "가운데"), ("WBT No.1 (S)", "바깥쪽"))]),
    # 도크 탑재
    dict(id="B-E21", name="기관실 E21", loc="도크에서 탑재 이음 용접 중", stage="erect", kind="er", frame=4,
         names=[("기관실 이중저 탱크", "선미쪽 · P"), ("청수 탱크", "선미쪽 · P 안쪽"), ("빌지 웰", "선미쪽 · S 안쪽"), ("기관실 이중저 탱크", "선미쪽 · S"),
                ("기관실 이중저 탱크", "선수쪽 · P"), ("청수 탱크", "선수쪽 · P 안쪽"), ("보이드", "선수쪽 · S 안쪽"), ("기관실 이중저 탱크", "선수쪽 · S")]),
]

# ---------- 오늘 작업이 있는 구획 (허가서 하나 = 구획 하나) 과 기존 구역 ID ----------
# (블록, 구획 번호 0부터) → 구역 정보. 기존 ID를 그대로 써서 작업허가·모델 에피소드·현장 이벤트와 이어지게 한다
WORK = {
    ("B-D21", 3): dict(id="Z-D21-WBT2P", sensor="GS-017", permit=dict(no="PTW-2541-0417", task="아르곤 용접", workers=2),
                       task_type="HOT_WORK", gas={"O2": 20.6}),
    ("B-D21", 0): dict(id="Z-D21-PD2", sensor="GS-018", permit=dict(no="PTW-2541-0418", task="배관 서포트 취부 용접", workers=2),
                       task_type="HOT_WORK", gas={"CO": 3}),
    # 도장 칸(안쪽)과 파이프덕트 칸이 맞닿아 있다 → 파이프덕트 칸에도 측정기 (인접 공간)
    # [시연 사건 1 · 경계] 도장 칸. 송풍기 2대 중 1번이 08:50(530분)에 멈추고 2번은 대기 → 가동 0대.
    # 그때부터 도장 증기(LEL)가 쌓여 08:59쯤 경계(5)를 넘는다 → 시연 시작(09:00)부터 경계 배너. 09:03까지 오르다 7에서 멈춘다 (법정 10 전).
    # 송풍기를 켜면 약 5분 뒤 5 아래로 (sim.ts ventAdjust)
    ("B-D23", 5): dict(id="Z-D23-WBT3S", sensor="GS-009", permit=dict(no="PTW-2541-0421", task="도장 터치업", workers=3),
                       task_type="PAINTING_CLEANING", gas={"LEL": {"v": 0.6, "ramp": [[530, 0.5]], "max": 7}},
                       vent={"blowers": 2, "stopAt": 530}),
    # [시연 사건 2 · 무허가 의심] 오늘 허가 없는 칸(도장 칸의 인접 칸이라 측정기가 있음).
    # 전날 접수된 PTW-2541-0491(배관 관통부 취부 용접·그라인딩, 2명)이 승인되지 않았는데 09:09에 들어가 09:11부터 CO(화기 흔적)가 오른다.
    # 사건 1(옆 도장 칸)이 풀린 뒤(송풍기를 09:03쯤 켜면 09:08쯤 정상)에 오르게 했다. 09:14쯤 무허가 판정(CO 8), 최대 12 ppm (경계 20 아래)
    # entry: 미승인 출입 (3D 출입현황판·작업자 관리에만 쓴다. permit 은 비워 둬서 무허가 판정은 그대로)
    ("B-D23", 4): dict(id="Z-D23-PD3", sensor="GS-022", permit=None, task_type="NONE",
                       gas={"CO": {"v": 2, "ramp": [[551, 2.0]], "max": 12}, "O2": {"v": 20.9, "ramp": [[551, -0.05]], "min": 20.7}},
                       entry=dict(no="PTW-2541-0491", task="배관 관통부 취부 용접·그라인딩", workers=2, team="의장 6반", **{"from": 549})),
    ("B-D25", 2): dict(id="Z-D25-WBT4P", sensor="GS-030", permit=dict(no="PTW-2541-0425", task="배관 내부 청소·검사", workers=4),
                       task_type="OTHER", gas={"O2": 20.8}),
    ("B-S31", 2): dict(id="Z-S31-TST3P", sensor="GS-031", permit=dict(no="PTW-2541-0431", task="용제 세척(신너)", workers=3),
                       task_type="PAINTING_CLEANING", gas={"LEL": 1.1}),
    # 시연: 사건 2개 외 구역은 정상값 (모델 시험 에피소드 대신 고정값)
    ("B-C41", 1): dict(id="Z-C41-CD3", sensor="GS-005", permit=dict(no="PTW-2541-0441", task="절단·그라인딩", workers=4),
                       task_type="HOT_WORK", gas={"CO": 3}),
    ("B-E11", 0): dict(id="Z-E11-FOT1", sensor="GS-041", permit=dict(no="PTW-2541-0451", task="용제 세척", workers=4),
                       task_type="PAINTING_CLEANING", gas={"CO2": 0.35}),
    ("B-P12", 0): dict(id="Z-P12-PD4", sensor="GS-027", permit=dict(no="PTW-2541-0461", task="아르곤 용접", workers=2),
                       task_type="HOT_WORK", gas={"O2": 20.6}),
    ("B-F01", 0): dict(id="Z-F01-FPT", sensor="GS-051", permit=dict(no="PTW-2541-0471", task="내부 도장 터치업", workers=3),
                       task_type="PAINTING_CLEANING", gas={"LEL": 1.4}),
    ("B-A51", 0): dict(id="Z-A51-APT", sensor="GS-061", permit=dict(no="PTW-2541-0481", task="보강재 용접", workers=3),
                       task_type="HOT_WORK", gas={"CO": 4}),
    ("B-S22", 1): dict(id="Z-S22-WBT5P", sensor="GS-071", permit=dict(no="PTW-2541-0445", task="론지 취부 용접", workers=5),
                       task_type="HOT_WORK", gas={"CO": 4}),
    ("B-D27", 6): dict(id="Z-D27-WBT6S", sensor="GS-073", permit=dict(no="PTW-2541-0447", task="사상 그라인딩", workers=3),
                       task_type="HOT_WORK", gas={"CO": 3}),
    ("B-E13", 0): dict(id="Z-E13-LOT", sensor="GS-075", permit=dict(no="PTW-2541-0455", task="배관 취부 용접", workers=4),
                       task_type="HOT_WORK", gas={"CO": 3}),
    ("B-S35", 3): dict(id="Z-S35-TST5S", sensor="GS-077", permit=dict(no="PTW-2541-0435", task="블라스팅", workers=5),
                       task_type="OTHER", gas={"O2": 20.8}),
    ("B-G05", 7): dict(id="Z-G05-WBT1S", sensor="GS-078", permit=dict(no="PTW-2541-0485", task="블록 이음 용접", workers=6),
                       task_type="HOT_WORK", gas={"CO": 5}),
    ("B-E21", 0): dict(id="Z-E21-ERDB", sensor="GS-080", permit=dict(no="PTW-2541-0495", task="탑재 이음 용접", workers=5),
                       task_type="HOT_WORK", gas={"CO": 4, "O2": 20.7}),
}


def touching(a, b, eps=1e-6):
    """두 칸이 면을 맞대는가 (두 축은 겹치고 한 축은 맞닿음)"""
    ov = [min(a[2 * i + 1], b[2 * i + 1]) - max(a[2 * i], b[2 * i]) for i in range(3)]
    return sum(1 for v in ov if v > eps) == 2 and sum(1 for v in ov if abs(v) <= eps) == 1


def main():
    blocks, zones = [], []
    sensor_no = 101
    for b in BLOCKS:
        k = KINDS[b["kind"]]
        boxes = cells(b["kind"])
        assert len(boxes) == len(b["names"]), (b["id"], len(boxes), len(b["names"]))
        work = {i for i in range(len(boxes)) if (b["id"], i) in WORK and WORK[(b["id"], i)].get("permit")}
        watched = {i for i in range(len(boxes)) if (b["id"], i) in WORK}
        # 작업 칸에 맞닿은 칸 = 인접 공간 → 측정기
        adj = {j for i in work for j in range(len(boxes)) if j != i and touching(boxes[i], boxes[j])}
        comps = []
        seen: dict[str, int] = {}
        for i, (box, (tank, part)) in enumerate(zip(boxes, b["names"])):
            seen[tank] = seen.get(tank, 0) + 1
            same = sum(1 for t, _ in b["names"] if t == tank)
            name = f"{plain(tank)} {seen[tank]}번 칸" if same > 1 else plain(tank)
            x0, x1 = box[0], box[1]
            f0 = b["frame"] + round((x0 + k["L"] / 2) / FRAME)
            f1 = b["frame"] + round((x1 + k["L"] / 2) / FRAME)
            sub = " · ".join(p for p in (where(part), tank, f"Fr.{f0}–{f1}") if p)
            zid = None
            w = WORK.get((b["id"], i))
            if w:
                z = {"id": w["id"], "sensor": w["sensor"], "permit": w.get("permit"), "task_type": w.get("task_type", "NONE"),
                     "role": "work" if w.get("permit") else "adjacent"}
                for key in ("gas", "episode", "sensorLostAt", "vent", "entry"):
                    if key in w:
                        z[key] = w[key]
            elif i in adj:
                z = {"id": f"Z-{b['id'][2:]}-{i + 1:02d}", "sensor": f"GS-{sensor_no}", "permit": None, "task_type": "NONE", "role": "adjacent"}
                sensor_no += 1
            else:
                z = None
            if z:
                zid = z["id"]
                if z["role"] == "adjacent":
                    near = [boxes[j] for j in work if touching(boxes[i], boxes[j])]
                    z["adjacentTo"] = [zones_id for j, zones_id in ((j, WORK[(b["id"], j)]["id"]) for j in work) if touching(boxes[i], boxes[j])]
                    del near
                zones.append({"block": b["id"], "name": name, "sub": sub, "box": box, **z})
            comps.append({"name": name, "sub": sub, "box": box, "zone": zid})
        del watched
        blocks.append({
            "id": b["id"], "name": b["name"], "loc": b["loc"], "stage": b["stage"], "kind": b["kind"],
            "L": k["L"], "section": k["section"], "xs": k["xs"], "wt_x": k["wt_x"], "zs": k["zs"], "wt_z": k["wt_z"],
            "ys": k["ys"], "wt_y": k.get("wt_y", []), "access": b.get("access", k["access"]), "warp": k.get("warp"), "frame": b["frame"],
            "comps": comps,
        })
    ids = [z["id"] for z in zones]
    assert len(ids) == len(set(ids)), "구역 ID 중복"
    assert len({z["sensor"] for z in zones}) == len(zones), "측정기 ID 중복"
    data = {
        "_note": "SYNTHETIC — scripts/build_site.py 로 만든다. 블록 치수·칸막이·칸 이름·작업 배정은 설명용 가정",
        "frame_m": FRAME, "blocks": blocks, "zones": zones,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    n = sum(len(b["comps"]) for b in blocks)
    print(f"블록 {len(blocks)}개 · 칸 {n}개 · 측정기(감시 구역) {len(zones)}개 → {OUT}")


if __name__ == "__main__":
    main()
