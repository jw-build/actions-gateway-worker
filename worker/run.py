#!/usr/bin/env python3
"""
Worker 入口：接收 action / env / request_id，执行对应逻辑。
由 GitHub Actions workflow 注入环境变量后调用。
"""
import os
import sys

ACTION = os.environ.get("ACTION", "")
ENV = os.environ.get("ENV", "")
REQUEST_ID = os.environ.get("REQUEST_ID", "")

ALLOWED_ACTIONS = {"ping", "deploy", "rollback"}
ALLOWED_ENVS = {"dev", "staging", "prod"}


def main():
    if ACTION not in ALLOWED_ACTIONS:
        print(f"ERROR: action not allowed: {ACTION}", file=sys.stderr)
        sys.exit(1)
    if ENV not in ALLOWED_ENVS:
        print(f"ERROR: env not allowed: {ENV}", file=sys.stderr)
        sys.exit(1)

    print(f"worker run: action={ACTION} env={ENV} request_id={REQUEST_ID}")

    if ACTION == "ping":
        print("pong")
    elif ACTION == "deploy":
        # 在这里写实际部署逻辑，例如调用 API、执行脚本等
        print(f"[worker] deploy to {ENV} (request_id={REQUEST_ID})")
    elif ACTION == "rollback":
        print(f"[worker] rollback on {ENV} (request_id={REQUEST_ID})")


if __name__ == "__main__":
    main()
