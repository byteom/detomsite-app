"""
Keep-alive ping for the deployed backend.

The Render free tier slept after 15 minutes without inbound traffic and woke on
the next request (cold start ~1 min). A cron service ran this script every 5
minutes against /health, which counts as inbound traffic, so the backend stayed
well inside the 15-minute idle cutoff and felt always-on (no cold-start wait for
students).

The backend now runs on Vercel (https://detomsite-backend.vercel.app), which does
not idle-sleep, so this is only needed if you move it back to a sleeping host.
Pinging the live URL keeps /health warm and is harmless otherwise.

Set HEALTH_URL in the scheduler's environment to your backend's real URL if it
differs from the default below (e.g. https://your-app.vercel.app/health).
"""
import os
import time
import urllib.request

HEALTH_URL = (os.environ.get("HEALTH_URL") or "").strip()
FALLBACK = "https://detomsite-backend.vercel.app/health"
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
