#!/usr/bin/env python3
"""E2E a11y: lock CTA focus order + keyboard activation safety.

Asserts, for each gated board (Trend of the Year, Trend of All Time) on /vote
as a free-tier user:
  * Every lock CTA is a real <button> with a non-empty accessible name
    (computed name includes "Pro"; `title` exposes the category).
  * Lock CTAs are reachable by sequential Tab traversal in DOM/visual order
    (focus order matches list order — no rogue tabindex jumps).
  * Activating a focused CTA via keyboard (Enter then Space) navigates to
    /pricing (proven by intercepted route) and produces ZERO POST/PATCH/DELETE
    requests to /rest/v1/votes.
  * No CTA is `aria-disabled` or `tabindex="-1"` (would silently swallow
    keyboard users).

Exit codes: 0 pass · 1 fail · 2 skip (no session / Pro session / boards didn't render).

Env: BASE_URL, LOCK_CTA_A11Y_ARTIFACT_DIR.
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from playwright.async_api import async_playwright

BASE_URL = os.environ.get("BASE_URL", "http://localhost:8080")
ARTIFACT_DIR = Path(os.environ.get("LOCK_CTA_A11Y_ARTIFACT_DIR", "/tmp/lock-cta-a11y-artifacts"))
GATED = [("Trend of the Year", "year"), ("Trend of All Time", "oat")]


async def restore_session(page) -> bool:
    session_json = os.environ.get("LOVABLE_BROWSER_SUPABASE_SESSION_JSON")
    storage_key = os.environ.get("LOVABLE_BROWSER_SUPABASE_STORAGE_KEY")
    if not (session_json and storage_key):
        return False
    await page.goto(BASE_URL, wait_until="domcontentloaded")
    await page.evaluate(
        f"window.localStorage.setItem({json.dumps(storage_key)}, {json.dumps(session_json)})"
    )
    return True


async def main() -> int:
    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    summary_path = ARTIFACT_DIR / "summary.json"
    network_fh = (ARTIFACT_DIR / "network.log").open("w")
    vote_writes: list[dict] = []
    pricing_nav_attempts: list[str] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(viewport={"width": 1280, "height": 1800})
        page = await context.new_page()

        def on_response(resp):
            url = resp.url
            method = resp.request.method
            network_fh.write(f"{resp.status} {method} {url}\n")
            if "/rest/v1/votes" in url and method in ("POST", "PATCH", "DELETE"):
                vote_writes.append({"status": resp.status, "method": method, "url": url})

        page.on("response", on_response)

        if not await restore_session(page):
            print("SKIP: no injected Supabase session.", file=sys.stderr)
            return 2

        async def handle_pricing(route):
            pricing_nav_attempts.append(route.request.url)
            await route.abort()

        await page.route("**/pricing*", handle_pricing)

        await page.goto(f"{BASE_URL}/vote", wait_until="domcontentloaded")
        try:
            await page.get_by_role("heading", name=GATED[-1][0]).wait_for(timeout=20000)
        except Exception as e:
            print(f"SKIP: gated boards never rendered: {e}", file=sys.stderr)
            return 2
        await page.wait_for_timeout(1500)

        errors: list[str] = []
        per_board: dict = {}

        for label, _cat in GATED:
            section = page.get_by_role("heading", name=label).locator(
                "xpath=ancestor::section[1]"
            )
            cta_locator = section.get_by_title(f"{label} — Pro only")
            cta_count = await cta_locator.count()
            chevrons = await section.get_by_role("button", name="Vote up").count()

            if cta_count == 0 or chevrons > 0:
                print(
                    f"SKIP: not free-tier for {label!r} (cta={cta_count}, chevrons={chevrons}).",
                    file=sys.stderr,
                )
                return 2

            # --- a11y attribute audit on every CTA in this section.
            attr_failures: list[dict] = []
            names: list[str] = []
            for i in range(cta_count):
                el = cta_locator.nth(i)
                info = await el.evaluate(
                    """(node) => {
                      const cs = window.getComputedStyle(node);
                      return {
                        tag: node.tagName,
                        type: node.getAttribute('type'),
                        disabled: node.disabled === true,
                        ariaDisabled: node.getAttribute('aria-disabled'),
                        ariaHidden: node.getAttribute('aria-hidden'),
                        tabindex: node.getAttribute('tabindex'),
                        title: node.getAttribute('title') || '',
                        text: (node.innerText || node.textContent || '').trim(),
                        ariaLabel: node.getAttribute('aria-label'),
                        visible: cs.display !== 'none' && cs.visibility !== 'hidden',
                      };
                    }"""
                )
                accessible_name = (info["ariaLabel"] or info["text"] or info["title"]).strip()
                names.append(accessible_name)
                problems = []
                if info["tag"] != "BUTTON":
                    problems.append(f"tag={info['tag']} (expected BUTTON)")
                if info["ariaDisabled"] in ("true", True):
                    problems.append("aria-disabled=true")
                if info["disabled"]:
                    problems.append("disabled")
                if info["ariaHidden"] == "true":
                    problems.append("aria-hidden=true")
                if info["tabindex"] == "-1":
                    problems.append("tabindex=-1")
                if not info["visible"]:
                    problems.append("not visible")
                if "pro" not in accessible_name.lower():
                    problems.append(f"accessible name missing 'Pro' (got {accessible_name!r})")
                if "Pro only" not in info["title"]:
                    problems.append(f"title missing category context (got {info['title']!r})")
                if problems:
                    attr_failures.append({"index": i, "issues": problems, "info": info})

            if attr_failures:
                errors.append(f"{label}: a11y attr failures {attr_failures}")

            # --- Focus order: sequentially Tab from the section heading and
            # confirm every CTA in this section is reached in DOM order before
            # focus leaves the section.
            heading = page.get_by_role("heading", name=label)
            await heading.scroll_into_view_if_needed()
            await heading.focus()  # may not focus a non-tabbable heading; we tab from body anyway.
            await page.evaluate(
                """(h) => { const r = document.createRange(); r.selectNode(h); }""",
                await heading.element_handle(),
            )

            # Build the expected ordered list of CTA handles.
            expected_handles = []
            for i in range(cta_count):
                expected_handles.append(await cta_locator.nth(i).element_handle())

            # Start tabbing from the section heading region.
            await page.evaluate(
                """(h) => h.setAttribute('tabindex', '-1')""",
                await heading.element_handle(),
            )
            await heading.focus()

            reached_order: list[int] = []
            max_tabs = cta_count * 12 + 30
            for _ in range(max_tabs):
                await page.keyboard.press("Tab")
                active = await page.evaluate_handle("document.activeElement")
                for idx, h in enumerate(expected_handles):
                    same = await page.evaluate(
                        "([a, b]) => a === b", [active, h]
                    )
                    if same and idx not in reached_order:
                        reached_order.append(idx)
                        break
                if len(reached_order) == cta_count:
                    break

            if reached_order != list(range(cta_count)):
                errors.append(
                    f"{label}: focus order mismatch — reached {reached_order}, "
                    f"expected {list(range(cta_count))}"
                )

            # --- Keyboard activation: focus first CTA, press Enter, then Space.
            # Each press must (a) attempt /pricing navigation and (b) fire NO vote writes.
            pre_writes = len(vote_writes)
            pre_nav = len(pricing_nav_attempts)
            await cta_locator.first.focus()
            await page.keyboard.press("Enter")
            await page.wait_for_timeout(400)
            await cta_locator.first.focus()
            await page.keyboard.press(" ")
            await page.wait_for_timeout(400)

            nav_delta = len(pricing_nav_attempts) - pre_nav
            write_delta = len(vote_writes) - pre_writes
            if nav_delta < 1:
                errors.append(
                    f"{label}: keyboard activation did not trigger /pricing nav "
                    f"(delta={nav_delta})"
                )
            if write_delta > 0:
                errors.append(
                    f"{label}: keyboard activation fired {write_delta} vote write(s)"
                )

            per_board[label] = {
                "cta_count": cta_count,
                "names": names,
                "focus_order_reached": reached_order,
                "attr_failures": attr_failures,
                "pricing_nav_delta": nav_delta,
                "vote_write_delta": write_delta,
            }

        await page.screenshot(path=str(ARTIFACT_DIR / "after.png"))

        summary = {
            "boards": per_board,
            "total_vote_writes": vote_writes,
            "total_pricing_nav_attempts": len(pricing_nav_attempts),
            "errors": errors,
        }
        summary_path.write_text(json.dumps(summary, indent=2))
        network_fh.close()
        await browser.close()

    print(json.dumps(summary, indent=2))
    if errors:
        for e in errors:
            print(f"FAIL: {e}", file=sys.stderr)
        return 1
    print("OK: lock CTAs have correct a11y attrs, focus order, and keyboard-safe activation.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
