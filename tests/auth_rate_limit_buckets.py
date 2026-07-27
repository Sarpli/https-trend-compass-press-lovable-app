#!/usr/bin/env python3
"""Integration tests: concurrent auth-gate bursts confirm per-IP and
per-email buckets combine correctly.

Signin limits (see src/routes/api/public/auth/gate.ts):
  - auth_signin:ip       10 / 60s
  - auth_signin:ip_hour  60 / 3600s
  - auth_signin:email    5  / 300s

Scenarios:
  1. Same IP, many DIFFERENT emails, fired CONCURRENTLY -> per-IP bucket
     (10/min) trips 429 with valid Retry-After even though each email is
     well under 5/5min.
  2. Different IPs, SAME email, fired CONCURRENTLY -> per-email bucket
     (5/5min) trips 429 even though each IP has only sent 1-2 requests.
  3. Under-cap concurrent traffic (mixed IPs + emails, each bucket safe)
     returns 200 for every request.

Exit: 0 pass, 1 fail.

    python3 tests/auth_rate_limit_buckets.py
"""
import concurrent.futures as cf
import json
import os
import sys
import time
import urllib.request
import urllib.error
import uuid

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")


def post_gate(mode: str, email: str, ip: str) -> tuple[int, dict, str]:
    body = json.dumps({"mode": mode, "email": email}).encode()
    last_exc: Exception | None = None
    for attempt in range(4):
        req = urllib.request.Request(
            f"{BASE_URL}/api/public/auth/gate",
            method="POST",
            data=body,
            headers={"Content-Type": "application/json", "x-forwarded-for": ip},
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                return r.status, dict(r.headers), r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            return e.code, dict(e.headers), e.read().decode("utf-8", "replace")
        except (ConnectionResetError, urllib.error.URLError, OSError) as e:
            last_exc = e
            time.sleep(0.15 * (attempt + 1))
    raise last_exc  # type: ignore[misc]


def run_concurrent(calls: list[tuple[str, str, str]]) -> list[tuple[int, dict, str]]:
    with cf.ThreadPoolExecutor(max_workers=min(32, len(calls))) as ex:
        futs = [ex.submit(post_gate, m, e, ip) for (m, e, ip) in calls]
        return [f.result() for f in futs]


def check_retry_after(results: list[tuple[int, dict, str]], label: str, errors: list[str]) -> None:
    r429 = [r for r in results if r[0] == 429]
    if not r429:
        errors.append(f"{label}: expected 429 in results, got codes {[r[0] for r in results]}")
        return
    _, headers, body = r429[0]
    retry = headers.get("Retry-After") or headers.get("retry-after")
    if not retry or not retry.isdigit() or int(retry) < 1:
        errors.append(f"{label}: bad Retry-After header {retry!r}")
    try:
        parsed = json.loads(body)
    except Exception:
        errors.append(f"{label}: 429 body not JSON: {body[:120]}")
        return
    if parsed.get("error") != "rate_limited":
        errors.append(f"{label}: 429 body error != 'rate_limited': {parsed!r}")
    if not isinstance(parsed.get("retry_after_seconds"), int) or parsed["retry_after_seconds"] < 1:
        errors.append(f"{label}: retry_after_seconds invalid: {parsed!r}")


def scenario_ip_bucket_across_emails(errors: list[str]) -> None:
    """Same IP + 20 different emails, concurrent. Per-email use is 1
    apiece (well under 5). Per-IP bucket is 10/min so 20 concurrent
    requests MUST include multiple 429s."""
    ip = f"198.51.100.{uuid.uuid4().int % 254 + 1}"
    calls = [
        ("signin", f"ip-share-{uuid.uuid4().hex[:8]}@example.test", ip)
        for _ in range(20)
    ]
    results = run_concurrent(calls)
    codes = [r[0] for r in results]
    ok = codes.count(200)
    limited = codes.count(429)
    print(f"  shared-IP-varied-email: 200={ok} 429={limited}")
    # Bucket is 10/min: at most 10 successes; the rest must be 429.
    if ok > 10:
        errors.append(f"shared-IP-varied-email: >10 successes ({ok}) — per-IP bucket leaked")
    if limited < 1:
        errors.append(f"shared-IP-varied-email: expected 429s, got none ({codes})")
    check_retry_after(results, "shared-IP-varied-email", errors)


def scenario_email_bucket_across_ips(errors: list[str]) -> None:
    """Same email + 12 unique IPs concurrent. Each IP only sends 1
    request (way under 10/min). Per-email bucket 5/5min MUST fire."""
    email = f"shared-{uuid.uuid4().hex[:8]}@example.test"
    calls = [
        ("signin", email, f"198.51.101.{i + 1}")
        for i in range(12)
    ]
    results = run_concurrent(calls)
    codes = [r[0] for r in results]
    ok = codes.count(200)
    limited = codes.count(429)
    print(f"  shared-email-varied-IP:  200={ok} 429={limited}")
    if ok > 5:
        errors.append(f"shared-email-varied-IP: >5 successes ({ok}) — per-email bucket leaked")
    if limited < 1:
        errors.append(f"shared-email-varied-IP: expected 429s, got none ({codes})")
    check_retry_after(results, "shared-email-varied-IP", errors)


def scenario_under_cap_all_ok(errors: list[str]) -> None:
    """4 unique IPs, 4 unique emails, one call each. No bucket exceeded
    -> every call must return 200."""
    calls = [
        ("signin", f"safe-{i}-{uuid.uuid4().hex[:6]}@example.test",
         f"198.51.102.{i + 1}")
        for i in range(4)
    ]
    results = run_concurrent(calls)
    codes = [r[0] for r in results]
    print(f"  under-cap:               codes={codes}")
    if any(c != 200 for c in codes):
        errors.append(f"under-cap: expected all 200, got {codes}")


def main() -> int:
    errors: list[str] = []
    print("== auth_rate_limit_buckets ==")
    scenario_under_cap_all_ok(errors)
    scenario_ip_bucket_across_emails(errors)
    scenario_email_bucket_across_ips(errors)

    if errors:
        print("FAIL")
        for e in errors:
            print(" -", e)
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
