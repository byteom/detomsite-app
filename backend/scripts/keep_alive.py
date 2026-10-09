"""
Keep-alive ping for the deployed backend.

Hybrid deploy: backend on Render (free tier sleeps after ~15 minutes without
inbound traffic, wake costs ~30-60s), portals on Vercel (no sleep).

Point an external scheduler (cron-job.org) at <render-url>/health every
3 minutes — each hit counts as inbound traffic, so the backend stays well
inside the 15-minute idle cutoff and feels always-on. 3 minutes (not 5)
gives margin for 1-2 missed pings.

Usage: HEALTH_URL=https://<your-backend>.onrender.com/health python keep_alive.py
Set HEALTH_URL in the scheduler's environment. FALLBACK below is only a
default when HEALTH_URL is unset.
"""
import os
import time
import urllib.request

HEALTH_URL = (os.environ.get("HEALTH_URL") or "").strip()
# Render backend default (hybrid deploy). Override with HEALTH_URL env var.
# Vercel backend (no sleep, no pinger needed): https://detomsite-backend.vercel.app/health
FALLBACK = "https://detomsite-backend.onrender.com/health"
TIMEOUT = 25  # generous: allows for a cold-start wake (~1 min max, 3 attempts)
RETRIES = 3


def ping(url: str) -> bool:
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT) as response:
            return response.status < 400
    except Exception as exc:  # noqa: BLE001 - any network error just means retry
        print(f"keep-alive: ping error -> {exc}")
        return False


def main() -> int:
    url = HEALTH_URL or FALLBACK
    print(f"keep-alive: pinging {url}")
    for attempt in range(1, RETRIES + 1):
        if ping(url):
            print("keep-alive: backend is awake")
            return 0
        print(f"keep-alive: attempt {attempt}/{RETRIES} failed, waiting 10s...")
        time.sleep(10)
    print("keep-alive: backend unreachable after all attempts")
    return 1


if __name__ == "__main__": 
    raise SystemExit(main())
