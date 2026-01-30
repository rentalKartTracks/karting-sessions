import json
from datetime import timedelta
from pathlib import Path
from typing import Optional, Dict, List, Union, Any

# --- Configuration ---
SESSIONS_DIR = Path("sessions")
OUTPUT_FILE = SESSIONS_DIR / "sessions-list.json"

# --- Helper Functions ---

def parse_time_to_seconds(time_str: Optional[Union[str, float]]) -> Optional[float]:
    """
    Converts a time string (MM:SS.mmm) or float to a total number of seconds.
    
    Args:
        time_str: The time string (e.g., "1:23.456") or a generic number.
        
    Returns:
        The total seconds as a float, or None if invalid.
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
    
    Args:
        seconds: The total seconds.
        
    Returns:
        Formatted time string or None.
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
    
    Args:
        filepath: Path object pointing to the JSON file.
        
    Returns:
        A dictionary compliant with the sessions-list schema, or None on error.
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
    
    # Use pathlib to glob json files
    for filepath in SESSIONS_DIR.glob("*.json"):
        if filepath.name == "sessions-list.json":
            continue
            
        summary = process_session_file(filepath)
        if summary:
            all_sessions_summary.append(summary)

    final_output = {
        "sessions": all_sessions_summary
    }

    try:
        with OUTPUT_FILE.open('w', encoding='utf-8') as outfile:
            json.dump(final_output, outfile, indent=4, ensure_ascii=False)
        print(f"SUCCESS: Created {OUTPUT_FILE} with {len(all_sessions_summary)} sessions.")
    except OSError as e:
        print(f"Error writing output file: {e}")

if __name__ == "__main__":
    generate_sessions_list()

# --- Helper Functions ---

def parse_time_to_seconds(time_str):
    """Converts a time string (MM:SS.mmm) to a total number of seconds (float)."""
    if not time_str or time_str.strip() == "":
        return None
    try:
        parts = time_str.split(':')
        if len(parts) == 2:
            minutes = float(parts[0])
            seconds = float(parts[1])
            return (minutes * 60) + seconds
        elif len(parts) == 1:
            return float(parts[0])
        return None
    except ValueError:
        return None

def format_seconds_to_time(seconds):
    """Converts a total number of seconds (float) back to a MM:SS.mmm string."""
    if seconds is None:
        return None
    
    td = timedelta(seconds=seconds)
    total_seconds = td.total_seconds()
    
    minutes = int(total_seconds // 60)
    remaining_seconds = total_seconds % 60
    
    return f"{minutes:02d}:{remaining_seconds:06.3f}"


def process_session_file(filepath):
    """Reads a session file and calculates summary stats including numeric derived metrics."""
    with open(filepath, 'r', encoding='utf-8') as f:
        try:
            session_data = json.load(f)
        except json.JSONDecodeError as e:
            print(f"Error decoding JSON in {filepath}: {e}")
            return None

    session_id = session_data.get("session_id")
    laps = session_data.get("laps", [])
    
    if not session_id:
        return None

    # Calculate Valid Lap Times in seconds
    valid_lap_times_seconds = []
    for lap_entry in laps:
        time_str = lap_entry.get("time")
        seconds = parse_time_to_seconds(time_str)
        if seconds is not None and seconds > 0:
            valid_lap_times_seconds.append(seconds)

    total_valid_laps = len(valid_lap_times_seconds)
    
    # Pre-compute metrics (Numeric and String)
    fastest_lap_s = None
    fastest_lap_str = None
    average_lap_s = None
    average_lap_str = None

    if valid_lap_times_seconds:
        # Numeric values for sorting and logic
        fastest_lap_s = min(valid_lap_times_seconds)
        average_lap_s = sum(valid_lap_times_seconds) / total_valid_laps
        
        # Formatted strings for display
        fastest_lap_str = format_seconds_to_time(fastest_lap_s)
        average_lap_str = format_seconds_to_time(average_lap_s)

    # Compile the Summary Data with derived numeric metrics
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

def generate_sessions_list():
    """Main function to scan files and generate sessions-list.json."""
    if not os.path.isdir(SESSIONS_DIR):
        print(f"Error: Directory '{SESSIONS_DIR}' not found.")
        return

    all_sessions_summary = []
    
    for filename in os.listdir(SESSIONS_DIR):
        if filename.endswith(".json") and filename != "sessions-list.json":
            filepath = os.path.join(SESSIONS_DIR, filename)
            summary = process_session_file(filepath)
            if summary:
                all_sessions_summary.append(summary)

    final_output = {
        "sessions": all_sessions_summary
    }

    with open(OUTPUT_FILE, 'w', encoding='utf-8') as outfile:
        json.dump(final_output, outfile, indent=4, ensure_ascii=False)
        
    print(f"SUCCESS: Created {OUTPUT_FILE} with {len(all_sessions_summary)} sessions.")

if __name__ == "__main__":
    generate_sessions_list()