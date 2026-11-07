"""pytest 없이 실행: python tests/run_tests.py"""
import pathlib
import sys
import traceback

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import test_generator as T  # noqa: E402

tests = [getattr(T, n) for n in dir(T) if n.startswith("test_")]
failed = 0
for t in tests:
    try:
        t(); print(f"PASS {t.__name__}")
    except Exception:
        failed += 1; print(f"FAIL {t.__name__}"); traceback.print_exc()
print(f"{len(tests) - failed}/{len(tests)} passed")
sys.exit(1 if failed else 0)
