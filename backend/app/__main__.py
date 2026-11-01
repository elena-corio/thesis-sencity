"""Run the API locally: python -m app (from backend/).

Access logs are off, so no request path or client address is written anywhere.
"""
import argparse

import uvicorn


def main():
    p = argparse.ArgumentParser(prog="python -m app")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--reload", action="store_true", help="restart on code changes")
    args = p.parse_args()
    print(f"SenCity API on http://127.0.0.1:{args.port} (Ctrl+C to stop)")
    uvicorn.run("app.main:app", host="127.0.0.1", port=args.port, reload=args.reload,
                access_log=False, log_level="warning")


if __name__ == "__main__":
    main()
