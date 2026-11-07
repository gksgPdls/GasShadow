"""상태 안정화 후처리 (모델과 분리).

1분마다 나오는 모델 결과가 매번 흔들리지 않도록, 같은 forecast_state가 n_confirm회 연속일 때만
공개 상태를 바꾼다. 상향(STABLE→WATCH/IMMINENT)과 하향(→STABLE) 모두 연속 확인을 적용한다.
현재 법정 기준 초과는 연속 확인 없이 규칙층이 즉시 경보하며, 이 클래스는 그 경로를 건드리지 않는다
(update()의 legal_exceeded=True는 규칙 경보를 그대로 통과시키고 내부 카운터를 초기화한다).
"""
from __future__ import annotations

from .inference import OUTPUT_FIELDS, unavailable

RANK = {"STABLE": 0, "WATCH": 1, "IMMINENT": 2}


class StateStabilizer:
    def __init__(self, n_confirm: int = 2):
        assert 1 <= n_confirm <= 3
        self.n_confirm = n_confirm
        self.reset()

    def reset(self):
        self.published: dict | None = None   # 마지막으로 공개한 모델 결과
        self.candidate_state: str | None = None
        self.candidate_count = 0

    def update(self, result: dict, legal_exceeded: bool = False) -> dict:
        """모델 결과 하나를 받아 공개할 결과를 돌려준다.

        - legal_exceeded: 규칙층 판정. 참이면 안정화 대상이 아니므로 모델 결과(UNAVAILABLE)를 그대로 돌려주고 초기화.
        - UNAVAILABLE: 그대로 공개하고 후보 카운터를 초기화(예측 공백을 이전 상태로 메우지 않음).
        - 공개 상태와 같은 상태: 즉시 공개(가스·시간·확률은 최신값으로 갱신).
        - 다른 상태: n_confirm회 연속일 때만 전환. 그 전까지는 이전 공개 상태를 유지하되 확률은 최신값.
        """
        assert set(result.keys()) == set(OUTPUT_FIELDS)
        if legal_exceeded:
            self.reset()
            return unavailable()
        if result["prediction_status"] != "PREDICTED":
            self.candidate_state, self.candidate_count = None, 0
            self.published = None
            return dict(result)
        s = result["forecast_state"]
        if self.published is None or self.published["forecast_state"] == s:
            self.published = dict(result)
            self.candidate_state, self.candidate_count = None, 0
            return dict(result)
        if self.candidate_state == s:
            self.candidate_count += 1
        else:
            self.candidate_state, self.candidate_count = s, 1
        if self.candidate_count >= self.n_confirm:
            self.published = dict(result)
            self.candidate_state, self.candidate_count = None, 0
            return dict(result)
        held = dict(self.published)
        held["risk_probability_30m"] = result["risk_probability_30m"]
        return held
