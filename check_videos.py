"""
Checks whether YouTube videos embedded in session files are publicly playable,
using YouTube's oEmbed endpoint (no API key required).

Updates each session file with a `video_available` boolean.
Skips files on network error so a transient failure doesn't mark videos as dead.

Run standalone:  python check_videos.py
Also called by:  .github/workflows/check-videos.yml  (daily cron)
"""

import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

SESSIONS_DIR = Path("sessions")
SKIP_FILES   = {"sessions-list.json", "tracks-list.json"}
REQUEST_DELAY = 0.4   # seconds between requests — be polite to YouTube
TIMEOUT       = 10    # seconds per request


def extract_youtube_id(url: str) -> str | None:
    if not url:
        return None
    patterns = [
        r"youtu\.be/([A-Za-z0-9_-]{11})",
        r"youtube\.com/(?:.*[?&]v=|embed/)([A-Za-z0-9_-]{11})",
    ]
    for pattern in patterns:
        m = re.search(pattern, url)
        if m:
            return m.group(1)
    return None


def check_oembed(video_id: str) -> bool | None:
    """
    Returns True  — video is public and embeddable
    Returns False — video is private, deleted, or embedding is blocked (HTTP 4xx)
    Returns None  — network/timeout error; caller should skip updating the file
    """
    url = (
        "https://www.youtube.com/oembed"
        f"?url=https://www.youtube.com/watch?v={video_id}&format=json"
    )
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return resp.status == 200
    except urllib.error.HTTPError:
        # 401 = embedding disabled, 404 = not found / private — both unplayable
        return False
    except Exception as e:
        print(f"  Network error for {video_id}: {e}")
        return None


def check_all_sessions() -> None:
    session_files = sorted(
        f for f in SESSIONS_DIR.glob("*.json") if f.name not in SKIP_FILES
    )
    print(f"Checking {len(session_files)} session file(s)…\n")

    updated = 0
    skipped = 0

    for filepath in session_files:
        try:
            data = json.loads(filepath.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[SKIP] {filepath.name}: cannot read — {e}")
            skipped += 1
            continue

        video_url = (data.get("video_url") or "").strip()
        video_id  = extract_youtube_id(video_url)

        if not video_id:
            new_status = False
        else:
            result = check_oembed(video_id)
            if result is None:
                print(f"[SKIP] {filepath.name}: network error — not updating")
                skipped += 1
                time.sleep(REQUEST_DELAY)
                continue
            new_status = result
            time.sleep(REQUEST_DELAY)

        current_status = data.get("video_available")

        if current_status == new_status:
            print(f"[OK]   {filepath.name}: {'available' if new_status else 'unavailable'} (unchanged)")
            continue

        data["video_available"] = new_status
        filepath.write_text(
            json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8"
        )
        label = "available" if new_status else "UNAVAILABLE"
        print(f"[UPD]  {filepath.name}: → {label}")
        updated += 1

    print(f"\nDone — {updated} updated, {skipped} skipped, "
          f"{len(session_files) - updated - skipped} unchanged.")


if __name__ == "__main__":
    check_all_sessions()
