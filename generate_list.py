import json
import os
import re
import urllib.request
from collections import Counter, defaultdict
from datetime import timedelta
from pathlib import Path
from typing import Optional, Dict, List, Any

# --- Configuration ---
SESSIONS_DIR = Path("sessions")
OUTPUT_FILE = SESSIONS_DIR / "sessions-list.json"
TRACKS_OUTPUT_FILE = SESSIONS_DIR / "tracks-list.json"

# Canonical-name maps (populated per run from all source files). They collapse
# accidental spelling variants — trailing-period, stray dots, emoji prefixes,
# casing — so e.g. "Ignas M" folds into "Ignas M.". Populated in
# generate_sessions_list() before any session is processed.
DRIVER_CANON: Dict[str, str] = {}
TRACK_CANON: Dict[str, str] = {}


def _norm_key(name: Optional[str]) -> str:
    """Normalize a name to a comparison key: lowercase, keep only letters/digits
    (drops spaces, punctuation and emoji, keeps Latin diacritics like ž/ė/ń)."""
    if not name:
        return ""
    return re.sub(r"[^0-9a-zÀ-ɏ]+", "", str(name).lower())


def build_canonical_map(names: List[Optional[str]]) -> Dict[str, str]:
    """Group raw names by their normalized key and map every variant to the
    most common spelling (ties broken toward the longer string, which keeps the
    more complete form such as the one with a trailing period). Names that
    normalize differently are never merged, so distinct people/tracks are safe."""
    groups: Dict[str, Counter] = defaultdict(Counter)
    for n in names:
        if n:
            groups[_norm_key(n)][n] += 1
    canon: Dict[str, str] = {}
    for counter in groups.values():
        best = max(counter.items(), key=lambda kv: (kv[1], len(kv[0])))[0]
        for raw in counter:
            canon[raw] = best
    return canon

STATIC_TRACKS = {
    "Speedway": {
        "id": "speedway",
        "lat": 54.7974894630313,
        "lng": 24.56925536425135,
        "mapsLink": "https://maps.app.goo.gl/oYmMNt3N2fXehzVf9",
        "color": "#4ab8e8",
        "note": "Outdoor circuit · Elektrėnai",
        "outdoor": True
    },
    "Plytinės Kartodromas": {
        "id": "plytines",
        "lat": 54.724858099752225,
        "lng": 25.349237826984915,
        "mapsLink": "https://maps.app.goo.gl/AmF51NGm8bysceeN9",
        "color": "#a84ae8",
        "note": "Professional karting circuit",
        "outdoor": True
    },
    "Vilko Kartodromas": {
        "id": "vilko",
        "lat": 54.88831631453673,
        "lng": 23.922075279103808,
        "mapsLink": "https://maps.app.goo.gl/9erykKE9f58EYZ9TA",
        "color": "#e84a4a",
        "note": "Technical indoor circuit",
        "outdoor": False
    },
    "Kartlandas Max": {
        "id": "kartlandas_max",
        "lat": 54.65066751187685,
        "lng": 25.219812673115587,
        "mapsLink": "https://maps.app.goo.gl/ZuopMfesFBDBQPQN7",
        "color": "#e87a4a",
        "note": "Technical indoor circuit",
        "outdoor": False
    },
    "Kartlandas Kaunas": {
        "id": "kartlandas",
        "lat": 54.91482127742085,
        "lng": 23.84298728162076,
        "mapsLink": "https://maps.app.goo.gl/7Q9SbwwcmwyNqUH56",
        "color": "#e8c84a",
        "note": "High-speed Kaunas circuit",
        "outdoor": False
    },
    "GOKARTING CENTER KRAKOW": {
        "id": "gokarting_center_krakow",
        "lat": 50.02719152362129,
        "lng": 20.050499873015085,
        "mapsLink": "https://maps.app.goo.gl/fbAaPCaugyx4FDjYA",
        "color": "#4a4ae8",
        "note": "Major Polish venue",
        "outdoor": False
    },
    "Sporta komplekss 333": {
        "id": "sporta_komplekss_333",
        "lat": 56.9501887,
        "lng": 24.4123719,
        "mapsLink": "https://goo.gl/maps/kZR3mou2NyC9NFx26",
        "color": "#4ae8a0",
        "note": "Outdoor circuit · Latvia",
        "outdoor": True
    },
    "Serbentų kartodromas": {
        "id": "serbentu",
        "lat": 55.9140472,
        "lng": 23.3348808,
        "mapsLink": "https://maps.app.goo.gl/8BmeaARd6nH8iZQ88",
        "color": "#4adee8",
        "note": "Outdoor circuit · Šiauliai",
        "outdoor": True
    },
    "Balčiūnų": {
        "id": "balciunu",
        "lat": 55.8984413,
        "lng": 23.3544845,
        "mapsLink": "https://maps.app.goo.gl/TW61veC3NJhRTdWq6",
        "color": "#e84ac8",
        "note": "Outdoor circuit · Šiauliai",
        "outdoor": True
    },
    "Anykščių kartodromas": {
        "id": "anyksciu",
        "lat": 55.518791,
        "lng": 25.069384,
        "mapsLink": "https://maps.app.goo.gl/2J7pGZfQs3f174tR8",
        "color": "#8ce84a",
        "note": "Outdoor circuit · Anykščiai",
        "outdoor": True
    },
    "Smalininkų kartodromas": {
        "id": "smalininku",
        "lat": 55.0787157,
        "lng": 22.5838659,
        "mapsLink": "https://maps.app.goo.gl/959ZMAV6acyt6uEr8",
        "color": "#e8a84a",
        "note": "Outdoor circuit · Smalininkai",
        "outdoor": True
    },
    "E1GOKART Gdańsk": {
        "id": "e1gokart_gdansk",
        "lat": 54.3683641,
        "lng": 18.4725776,
        "mapsLink": "https://maps.app.goo.gl/CVJR4ztgxxvVeGDv8",
        "color": "#4a8ce8",
        "note": "Indoor circuit · Gdańsk",
        "outdoor": False
    },
    "Tor Półwysep": {
        "id": "tor_polwysep",
        "lat": 54.7891707,
        "lng": 18.4248715,
        "mapsLink": "https://maps.app.goo.gl/rAMgznAK6mQx8Nwf6",
        "color": "#b84ae8",
        "note": "Outdoor circuit · Władysławowo",
        "outdoor": True
    },
    "KartCenter Sopot": {
        "id": "kartcenter_sopot",
        "lat": 54.4339595,
        "lng": 18.5635584,
        "mapsLink": "https://maps.app.goo.gl/AXFPcDj5CWT7rPX27",
        "color": "#e8e84a",
        "note": "Karting · Gdańsk area",
        "outdoor": False
    },
    "KartCenter Gdańsk Gokarty": {
        "id": "kartcenter_gdansk",
        "lat": 54.352628,
        "lng": 18.5928151,
        "mapsLink": "https://maps.app.goo.gl/RUBF4Y86mvd37qu67",
        "color": "#5ab0e8",
        "note": "Karting · Gdańsk",
        "outdoor": False
    },
    "Race Time": {
        "id": "race_time",
        "lat": 55.9084559,
        "lng": 21.0999881,
        "mapsLink": "https://maps.app.goo.gl/dRBrDVFfcDvgQaCo6",
        "color": "#4ae8c8",
        "note": "Outdoor circuit · Klaipėda",
        "outdoor": True
    },
    "Rudskogen Motorsenter": {
        "id": "rudskogen",
        "lat": 59.3679798,
        "lng": 11.2620216,
        "mapsLink": "https://maps.app.goo.gl/BHE3Yt1iVqcHmGkv7",
        "color": "#e85a5a",
        "note": "Motorsport circuit · Norway",
        "outdoor": True
    },
    "Karting Salou": {
        "id": "karting_salou",
        "lat": 41.092111,
        "lng": 1.1296976,
        "mapsLink": "https://maps.app.goo.gl/H4DpdF6T1XHRE6239",
        "color": "#e89a4a",
        "note": "Outdoor circuit · Spain",
        "outdoor": True
    },
    "Awix Racing Arena": {
        "id": "awix_racing_arena",
        "lat": 53.0184783,
        "lng": 18.5440845,
        "mapsLink": "https://maps.app.goo.gl/ybcsyhCrN3D1E2XbA",
        "color": "#9a4ae8",
        "note": "Karting · Bydgoszcz",
        "outdoor": False
    },
    "Blāzma": {
        "id": "blāzma",
        "lat": 55.84813,
        "lng": 26.53592,
        "mapsLink": "https://www.google.com/maps/search/?api=1&query=55.84813,26.53592",
        "color": "#4a6ae8",
        "note": "Outdoor circuit · Daugavpils, Latvia",
        "outdoor": True
    }
}

# --- Weather Fetch ---

def fetch_weather(lat: float, lng: float, date: str) -> Optional[Dict]:
    """
    Fetch historical daily weather from Open-Meteo for a given location and date.
    Returns a dict with temp_max, temp_min, wind_speed_max, precipitation, weather_code
    or None if the fetch fails.
    Free API, no key required.
    """
    url = (
        f"https://archive-api.open-meteo.com/v1/archive"
        f"?latitude={lat}&longitude={lng}"
        f"&start_date={date}&end_date={date}"
        f"&daily=temperature_2m_max,temperature_2m_min,wind_speed_10m_max,"
        f"precipitation_sum,weather_code"
        f"&wind_speed_unit=kmh&timezone=auto"
    )
    try:
        with urllib.request.urlopen(url, timeout=8) as resp:
            data = json.loads(resp.read().decode())
        daily = data.get("daily", {})
        if not daily.get("time"):
            return None
        return {
            "temp_max": daily["temperature_2m_max"][0],
            "temp_min": daily["temperature_2m_min"][0],
            "wind_kmh": daily["wind_speed_10m_max"][0],
            "rain_mm": daily["precipitation_sum"][0],
            "wmo_code": daily["weather_code"][0],
        }
    except Exception as e:
        print(f"  [weather] fetch failed for {date} at ({lat},{lng}): {e}")
        return None


WMO_DESCRIPTIONS = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Fog", 48: "Icy fog",
    51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    61: "Light rain", 63: "Rain", 65: "Heavy rain",
    71: "Light snow", 73: "Snow", 75: "Heavy snow",
    77: "Snow grains",
    80: "Light showers", 81: "Showers", 82: "Heavy showers",
    85: "Snow showers", 86: "Heavy snow showers",
    95: "Thunderstorm", 96: "Thunderstorm w/ hail", 99: "Thunderstorm w/ heavy hail",
}

def wmo_to_description(code: Optional[int]) -> str:
    if code is None:
        return "Unknown"
    return WMO_DESCRIPTIONS.get(int(code), f"Code {code}")

# --- Helper Functions ---

def parse_time_to_seconds(time_str: Optional[Any]) -> Optional[float]:
    """
    Converts a time string (MM:SS.mmm) or float to a total number of seconds.
    """
    if not time_str:
        return None
        
    if isinstance(time_str, (int, float)):
        return float(time_str)
        
    if isinstance(time_str, str) and time_str.strip() == "":
        return None
        
    try:
        parts = str(time_str).split(':')
        if len(parts) == 2:
            minutes = float(parts[0])
            seconds = float(parts[1])
            return (minutes * 60) + seconds
        elif len(parts) == 1:
            return float(parts[0])
        return None
    except ValueError:
        return None

def format_seconds_to_time(seconds: Optional[float]) -> Optional[str]:
    """
    Converts a total number of seconds back to a MM:SS.mmm string.
    """
    if seconds is None:
        return None
    
    td = timedelta(seconds=seconds)
    total_seconds = td.total_seconds()
    
    minutes = int(total_seconds // 60)
    remaining_seconds = total_seconds % 60
    
    return f"{minutes:02d}:{remaining_seconds:06.3f}"


def process_session_file(filepath: Path) -> Optional[Dict[str, Any]]:
    """
    Reads a session file and calculates summary metrics.
    """
    try:
        text = filepath.read_text(encoding='utf-8')
        session_data = json.loads(text)
    except (json.JSONDecodeError, OSError) as e:
        print(f"Error reading {filepath}: {e}")
        return None

    session_id = session_data.get("session_id")
    laps = session_data.get("laps", [])
    
    if not session_id:
        return None

    # Calculate Valid Lap Times in seconds
    valid_lap_times_seconds: List[float] = []
    for lap_entry in laps:
        time_val = lap_entry.get("time")
        seconds = parse_time_to_seconds(time_val)
        if seconds is not None and seconds > 0:
            valid_lap_times_seconds.append(seconds)

    total_valid_laps = len(valid_lap_times_seconds)
    
    # Pre-compute metrics
    fastest_lap_s: Optional[float] = None
    fastest_lap_str: Optional[str] = None
    average_lap_s: Optional[float] = None
    average_lap_str: Optional[str] = None

    if valid_lap_times_seconds:
        fastest_lap_s = min(valid_lap_times_seconds)
        average_lap_s = sum(valid_lap_times_seconds) / total_valid_laps
        
        fastest_lap_str = format_seconds_to_time(fastest_lap_s)
        average_lap_str = format_seconds_to_time(average_lap_s)

    # Compile the Summary Data — canonicalize driver/track names so spelling
    # slips don't fragment the aggregates.
    driver_name = session_data.get("driver")
    driver_name = DRIVER_CANON.get(driver_name, driver_name)

    track_data = session_data.get("track", {})
    raw_track_name = track_data.get("name") if isinstance(track_data, dict) else str(track_data)
    track_name = TRACK_CANON.get(raw_track_name, raw_track_name)
    if isinstance(track_data, dict) and track_data.get("name") != track_name:
        track_data = {**track_data, "name": track_name}
    static_info = STATIC_TRACKS.get(track_name, {})
    session_date = session_data.get("session_date")

    # Fetch weather only for outdoor tracks with a valid date
    weather = None
    if static_info.get("outdoor") and session_date:
        print(f"  [weather] fetching for {track_name} on {session_date}…")
        w = fetch_weather(static_info["lat"], static_info["lng"], session_date)
        if w:
            weather = {
                "temp_max": w["temp_max"],
                "temp_min": w["temp_min"],
                "wind_kmh": w["wind_kmh"],
                "rain_mm": w["rain_mm"],
                "condition": wmo_to_description(w["wmo_code"]),
            }

    summary = {
        "id": session_id,
        "driver": driver_name,
        "track": track_data,
        "session_date": session_date,
        "kart": session_data.get("kart"),
        "has_video": bool(session_data.get("video_url", "").strip()),
        "weather": weather,

        # Display strings
        "fastest_lap": fastest_lap_str,
        "average_lap": average_lap_str,

        # Numeric derived metrics
        "fastest_lap_s": fastest_lap_s,
        "average_lap_s": average_lap_s,
        "laps_count": total_valid_laps
    }
    
    return summary

def generate_sessions_list() -> None:
    """Main function to scan sessions directory and generate the index."""
    if not SESSIONS_DIR.is_dir():
        print(f"Error: Directory '{SESSIONS_DIR}' not found.")
        return

    # Pre-scan all source files to learn the canonical spelling of every driver
    # and track name (majority vote), so the processing pass can fold variants.
    raw_drivers: List[Optional[str]] = []
    raw_tracks: List[Optional[str]] = []
    for filepath in SESSIONS_DIR.glob("*.json"):
        if filepath.name in ["sessions-list.json", "tracks-list.json"]:
            continue
        try:
            d = json.loads(filepath.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        raw_drivers.append(d.get("driver"))
        td = d.get("track")
        raw_tracks.append(td.get("name") if isinstance(td, dict) else td)
    DRIVER_CANON.clear(); DRIVER_CANON.update(build_canonical_map(raw_drivers))
    TRACK_CANON.clear(); TRACK_CANON.update(build_canonical_map(raw_tracks))
    folded = {k: v for k, v in {**DRIVER_CANON, **TRACK_CANON}.items() if k != v}
    if folded:
        print(f"  [canonical] folded {len(folded)} name variant(s): " +
              ", ".join(f"{k!r}->{v!r}" for k, v in folded.items()))

    all_sessions_summary: List[Dict[str, Any]] = []
    tracks_aggregation: Dict[str, Any] = {}
    
    # Use pathlib to glob json files
    try:
        for filepath in SESSIONS_DIR.glob("*.json"):
            if filepath.name in ["sessions-list.json", "tracks-list.json"]:
                continue
                
            summary = process_session_file(filepath)
            if summary:
                all_sessions_summary.append(summary)

                # --- Track Aggregation ---
                track_data = summary.get("track")
                if not track_data:
                    continue
                    
                track_name = track_data.get("name") if isinstance(track_data, dict) else str(track_data)
                
                if track_name not in tracks_aggregation:
                    static_info = STATIC_TRACKS.get(track_name, {})
                    tracks_aggregation[track_name] = {
                        "id": static_info.get("id", track_name.lower().replace(" ", "_")),
                        "name": track_name,
                        "lat": static_info.get("lat", 0),
                        "lng": static_info.get("lng", 0),
                        "mapsLink": static_info.get("mapsLink", track_data.get("maps_link") if isinstance(track_data, dict) else ""),
                        "color": static_info.get("color", "#aaaaaa"),
                        "note": static_info.get("note", "Generated circuit"),
                        "configs": set(),
                        "sessions": 0,
                        "bestLap": None,
                        "bestLap_s": float('inf'),
                        "bestDriver": None
                    }
                
                t_agg = tracks_aggregation[track_name]
                t_agg["sessions"] += 1
                
                config_name = track_data.get("configuration") if isinstance(track_data, dict) else None
                if config_name:
                    t_agg["configs"].add(config_name)
                    
                fastest_lap_s = summary.get("fastest_lap_s")
                if fastest_lap_s is not None and fastest_lap_s < t_agg["bestLap_s"]:
                    t_agg["bestLap_s"] = fastest_lap_s
                    t_agg["bestLap"] = summary.get("fastest_lap")
                    t_agg["bestDriver"] = summary.get("driver")

    except Exception as e:
        print(f"Error scanning directory: {e}")
        return

    # Convert sets to lists and remove internal sorting keys
    final_tracks_list = []
    for t_val in tracks_aggregation.values():
        t_val["configs"] = sorted(t_val["configs"])
        if t_val["bestLap_s"] == float('inf'):
            t_val["bestLap_s"] = None
        else:
            del t_val["bestLap_s"]
        final_tracks_list.append(t_val)

    final_output = {
        "sessions": all_sessions_summary
    }

    try:
        with OUTPUT_FILE.open('w', encoding='utf-8') as outfile:
            json.dump(final_output, outfile, indent=4, ensure_ascii=False)
        print(f"SUCCESS: Created {OUTPUT_FILE} with {len(all_sessions_summary)} sessions.")
        
        with TRACKS_OUTPUT_FILE.open('w', encoding='utf-8') as outfile:
            json.dump(final_tracks_list, outfile, indent=4, ensure_ascii=False)
        print(f"SUCCESS: Created {TRACKS_OUTPUT_FILE} with {len(final_tracks_list)} tracks.")
        
    except OSError as e:
        print(f"Error writing output file: {e}")

if __name__ == "__main__":
    generate_sessions_list()