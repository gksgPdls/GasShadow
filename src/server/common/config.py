"""서버 공통 설정. 모두 환경 변수로 바꿀 수 있다 (src/server/.env 를 읽는다)."""
from __future__ import annotations

import os
import pathlib

ROOT = pathlib.Path(__file__).resolve().parents[3]  # 저장소 루트
SERVER_DIR = ROOT / "src" / "server"


def _load_env_file() -> None:
    # python-dotenv 없이 KEY=VALUE 한 줄씩만 읽는다. 이미 있는 환경 변수는 덮어쓰지 않는다
    p = SERVER_DIR / ".env"
    if not p.exists():
        return
    for line in p.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"'))


_load_env_file()

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql://localhost:5434/gas_shadow")
MAIN_URL = os.environ.get("MAIN_URL", "http://127.0.0.1:8000")
AI_URL = os.environ.get("AI_URL", "http://127.0.0.1:8001")

# LLM: OpenAI 호환 Chat Completions API 하나로 부른다. 키가 없으면 AI 서버는 판례를 그대로 보여주는 대체 추천을 만든다
#  - OPENAI_API_KEY 가 있으면 OpenAI. 모델은 OPENAI_MODEL 로 꼭 정한다 (기본값 없음)
#  - 없으면 OPENROUTER_API_KEY (예전 설정 그대로)
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_MODEL = os.environ.get("OPENAI_MODEL", "")
OPENAI_URL = os.environ.get("OPENAI_URL", "https://api.openai.com/v1/chat/completions")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENROUTER_MODEL = os.environ.get("OPENROUTER_MODEL", "anthropic/claude-sonnet-5.5")
OPENROUTER_URL = os.environ.get("OPENROUTER_URL", "https://openrouter.ai/api/v1/chat/completions")

if OPENAI_API_KEY:
    LLM_PROVIDER, LLM_API_KEY, LLM_MODEL, LLM_URL = "openai", OPENAI_API_KEY, OPENAI_MODEL, OPENAI_URL
elif OPENROUTER_API_KEY:
    LLM_PROVIDER, LLM_API_KEY, LLM_MODEL, LLM_URL = "openrouter", OPENROUTER_API_KEY, OPENROUTER_MODEL, OPENROUTER_URL
else:
    LLM_PROVIDER, LLM_API_KEY, LLM_MODEL, LLM_URL = None, "", "", ""
LLM_READY = bool(LLM_API_KEY and LLM_MODEL)

MODEL_DIR = ROOT / "가스예측모델"
