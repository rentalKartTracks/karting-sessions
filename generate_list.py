import json
import re
import hashlib
import urllib.request
from datetime import timedelta
from pathlib import Path
from typing import Optional, Dict, List, Any, Tuple

# --- Configuration ---
SESSIONS_DIR = Path("sessions")
OUTPUT_FILE = SESSIONS_DIR / "sessions-list.json"
TRACKS_OUTPUT_FILE = SESSIONS_DIR / "tracks-list.json"
GEOCACHE_FILE = SESSIONS_DIR / "tracks-geocache.json"


# --- Track Utilities ---

def track_color(track_name: str) -> str:
    """Deterministic HSL color derived from track name."""
    hue = int(hashlib.md5(track_name.encode()).hexdigest(), 16) % 360
    return f"hsl({hue}, 78%, 62%)"


def track_id(track_name: str) -> str:
    """Convert track name to a URL-safe slug."""
    slug = track_name.lower()
    slug = re.sub(r'[^\w\s-]', '', slug)
    slug = re.sub(r'[\s-]+', '_', slug.strip())
    return slug


# --- Geocoding ---

def load_geocache() -> Dict[str, Any]:
    if GEOCACHE_FILE.exists():
        try:
            return json.loads(GEOCACHE_FILE.read_text(encoding='utf-8'))
        except Exception:
            pass
    return {}


def save_geocache(cache: Dict[str, Any]) -> None:
    GEOCACHE_FILE.write_text(
        json.dumps(cache, indent=2, ensure_ascii=False), encoding='utf-8'
    )


def geocode_maps_link(maps_link: str) -> Tuple[float, float]:
    """Follow a Google Maps short URL redirect and extract lat/lng."""
    try:
        req = urllib.request.Request(
            maps_link, headers={'User-Agent': 'Mozilla/5.0'}
        )
        with urllib.request.urlopen(req, timeout=10) as r:
            final_url = r.url
        m = re.search(r'@(-?\d+\.\d+),(-?\d+\.\d+)', final_url)
        if m:
            return float(m.group(1)), float(m.group(2))
    except Exception as e:
        print(f"  Geocoding failed for {maps_link}: {e}")
    return 0, 0


def get_coords(maps_link: str, cache: Dict[str, Any]) -> Tuple[float, float]:
    """Return cached coordinates for a maps link, geocoding if not yet cached."""
    if not maps_link:
        return 0, 0
    if maps_link in cache:
        entry = cache[maps_link]
        return entry.get("lat", 0), entry.get("lng", 0)
    print(f"  Geocoding new track: {maps_link}")
    lat, lng = geocode_maps_link(maps_link)
    cache[maps_link] = {"lat": lat, "lng": lng}
    return lat, lng


# --- Session Processing ---

def parse_time_to_seconds(time_str: Optional[Any]) -> Optional[float]:
    if not time_str:
        return None
    if isinstance(time_str, (int, float)):
        return float(time_str)
    if isinstance(time_str, str) and time_str.strip() == "":
        return None
    try:
        parts = str(time_str).split(':')
        if len(parts) == 2:
            return float(parts[0]) * 60 + float(parts[1])
        elif len(parts) == 1:
            return float(parts[0])
    except ValueError:
        pass
    return None


def format_seconds_to_time(seconds: Optional[float]) -> Optional[str]:
    if seconds is None:
        return None
    td = timedelta(seconds=seconds)
    total = td.total_seconds()
    minutes = int(total // 60)
    secs = total % 60
    return f"{minutes:02d}:{secs:06.3f}"


def process_session_file(filepath: Path) -> Optional[Dict[str, Any]]:
    try:
        session_data = json.loads(filepath.read_text(encoding='utf-8'))
    except (json.JSONDecodeError, OSError) as e:
        print(f"Error reading {filepath}: {e}")
        return None

    session_id = session_data.get("session_id")
    if not session_id:
        return None

    laps = session_data.get("laps", [])
    valid_times: List[float] = []
    for lap in laps:
        s = parse_time_to_seconds(lap.get("time"))
        if s is not None and s > 0:
            valid_times.append(s)

    total_laps = len(valid_times)
    fastest_lap_s = min(valid_times) if valid_times else None
    average_lap_s = sum(valid_times) / total_laps if valid_times else None

    return {
        "id": session_id,
        "driver": session_data.get("driver"),
        "track": session_data.get("track"),
        "session_date": session_data.get("session_date"),
        "kart": session_data.get("kart"),
        "fastest_lap": format_seconds_to_time(fastest_lap_s),
        "average_lap": format_seconds_to_time(average_lap_s),
        "fastest_lap_s": fastest_lap_s,
        "average_lap_s": average_lap_s,
        "laps_count": total_laps,
        "has_video": (
            session_data["video_available"]
            if "video_available" in session_data
            else bool(session_data.get("video_url", "").strip())
        ),
    }


def generate_sessions_list() -> None:
    if not SESSIONS_DIR.is_dir():
        print(f"Error: Directory '{SESSIONS_DIR}' not found.")
        return

    geocache = load_geocache()
    all_sessions: List[Dict[str, Any]] = []
    tracks_agg: Dict[str, Any] = {}

    SKIP_FILES = {"sessions-list.json", "tracks-list.json", "tracks-geocache.json"}

    try:
        for filepath in SESSIONS_DIR.glob("*.json"):
            if filepath.name in SKIP_FILES:
                continue
            summary = process_session_file(filepath)
            if not summary:
                continue
            all_sessions.append(summary)

            track_data = summary.get("track")
            if not track_data:
                continue

            track_name = (
                track_data.get("name") if isinstance(track_data, dict) else str(track_data)
            )
            maps_link = (
                track_data.get("maps_link", "") if isinstance(track_data, dict) else ""
            )

            if track_name not in tracks_agg:
                lat, lng = get_coords(maps_link, geocache)
                tracks_agg[track_name] = {
                    "id": track_id(track_name),
                    "name": track_name,
                    "lat": lat,
                    "lng": lng,
                    "mapsLink": maps_link,
                    "color": track_color(track_name),
                    "configs": set(),
                    "sessions": 0,
                    "bestLap": None,
                    "_bestLap_s": float('inf'),
                    "bestDriver": None,
                }

            t = tracks_agg[track_name]
            t["sessions"] += 1

            config = track_data.get("configuration") if isinstance(track_data, dict) else None
            if config:
                t["configs"].add(config)

            fl_s = summary.get("fastest_lap_s")
            if fl_s is not None and fl_s < t["_bestLap_s"]:
                t["_bestLap_s"] = fl_s
                t["bestLap"] = summary.get("fastest_lap")
                t["bestDriver"] = summary.get("driver")

    except Exception as e:
        print(f"Error scanning directory: {e}")
        return

    save_geocache(geocache)

    final_tracks: List[Dict[str, Any]] = []
    for t in tracks_agg.values():
        t["configs"] = list(t["configs"])
        if t["_bestLap_s"] == float('inf'):
            t["bestLap"] = None
        del t["_bestLap_s"]
        final_tracks.append(t)

    try:
        OUTPUT_FILE.write_text(
            json.dumps({"sessions": all_sessions}, indent=4, ensure_ascii=False),
            encoding='utf-8'
        )
        print(f"SUCCESS: {OUTPUT_FILE} — {len(all_sessions)} sessions.")

        TRACKS_OUTPUT_FILE.write_text(
            json.dumps(final_tracks, indent=4, ensure_ascii=False),
            encoding='utf-8'
        )
        print(f"SUCCESS: {TRACKS_OUTPUT_FILE} — {len(final_tracks)} tracks.")

    except OSError as e:
        print(f"Error writing output: {e}")


if __name__ == "__main__":
    generate_sessions_list()
