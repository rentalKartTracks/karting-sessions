import json
import os
from datetime import timedelta
from pathlib import Path
from typing import Optional, Dict, List, Any

# --- Configuration ---
SESSIONS_DIR = Path("sessions")
OUTPUT_FILE = SESSIONS_DIR / "sessions-list.json"
TRACKS_OUTPUT_FILE = SESSIONS_DIR / "tracks-list.json"

STATIC_TRACKS = {
    "Speedway": {
        "id": "speedway",
        "lat": 54.7974894630313,
        "lng": 24.56925536425135,
        "mapsLink": "https://maps.app.goo.gl/oYmMNt3N2fXehzVf9",
        "color": "#4ab8e8",
        "note": "Outdoor circuit · Elektrėnai"
    },
    "Plytinės Kartodromas": {
        "id": "plytines",
        "lat": 54.6650,
        "lng": 25.2100,
        "mapsLink": "https://maps.app.goo.gl/AmF51NGm8bysceeN9",
        "color": "#a84ae8",
        "note": "Professional karting circuit"
    },
    "Vilko Kartodromas": {
        "id": "vilko",
        "lat": 54.7200,
        "lng": 25.3200,
        "mapsLink": "https://maps.app.goo.gl/9erykKE9f58EYZ9TA",
        "color": "#e84a4a",
        "note": "Technical indoor circuit"
    },
    "Kartlandas Max": {
        "id": "kartlandas_max",
        "lat": 54.6548,
        "lng": 25.2135,
        "mapsLink": "https://maps.app.goo.gl/ZuopMfesFBDBQPQN7",
        "color": "#e87a4a",
        "note": "Technical indoor circuit"
    },
    "Kartlandas Kaunas": {
        "id": "kartlandas",
        "lat": 54.8985,
        "lng": 23.9036,
        "mapsLink": "https://maps.app.goo.gl/7Q9SbwwcmwyNqUH56",
        "color": "#e8c84a",
        "note": "High-speed Kaunas circuit"
    },
    "GOKARTING CENTER KRAKOW": {
        "id": "gokarting_center_krakow",
        "lat": 50.0205,
        "lng": 20.0384,
        "mapsLink": "https://maps.app.goo.gl/fbAaPCaugyx4FDjYA",
        "color": "#4a4ae8",
        "note": "Major Polish venue"
    }
}

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

    # Compile the Summary Data
    summary = {
        "id": session_id,
        "driver": session_data.get("driver"),
        "track": session_data.get("track"),
        "session_date": session_data.get("session_date"),
        "kart": session_data.get("kart"),
        
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
        t_val["configs"] = list(t_val["configs"])
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