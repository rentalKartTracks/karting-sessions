import os
import json
from datetime import timedelta

# --- Configuration (Adjust this based on where you run the script!) ---
# Assuming you run this script from the parent folder of the 'sessions' directory:
SESSIONS_DIR = "sessions"
OUTPUT_FILE = os.path.join(SESSIONS_DIR, "sessions-list.json")
# If you run it from INSIDE the 'sessions' directory, use:
# SESSIONS_DIR = "."
# OUTPUT_FILE = os.path.join(SESSIONS_DIR, "sessions-list.json")

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
            # Handle raw seconds string if necessary, but MM:SS.mmm is standard
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
    
    # Format as MM:SS.mmm (e.g., 00:45.478)
    return f"{minutes:02d}:{remaining_seconds:06.3f}"


def process_session_file(filepath):
    """Reads a single session file, calculates summary stats, and returns the summary object."""
    # Ensure file reading uses utf-8 encoding for special characters
    with open(filepath, 'r', encoding='utf-8') as f:
        try:
            session_data = json.load(f)
        except json.JSONDecodeError as e:
            print(f"Error decoding JSON in {filepath}: {e}")
            return None

    session_id = session_data.get("session_id")
    laps = session_data.get("laps", [])
    
    if not session_id:
        print(f"Warning: Session file {filepath} is missing 'session_id'. Skipping.")
        return None

    # 1. Calculate Valid Lap Times
    valid_lap_times_seconds = []
    for lap_entry in laps:
        time_str = lap_entry.get("time")
        seconds = parse_time_to_seconds(time_str)
        if seconds is not None and seconds > 0: # Ensure lap time is positive
            valid_lap_times_seconds.append(seconds)

    total_valid_laps = len(valid_lap_times_seconds)
    
    # 2. Calculate Average Lap Time
    average_lap_time_str = None
    if total_valid_laps > 0:
        total_time_seconds = sum(valid_lap_times_seconds)
        average_seconds = total_time_seconds / total_valid_laps
        average_lap_time_str = format_seconds_to_time(average_seconds)

    # 3. CALCULATE FASTEST LAP (This overwrites the fastest_lap from the file for accuracy)
    fastest_lap_str = None
    if valid_lap_times_seconds:
        fastest_lap_seconds = min(valid_lap_times_seconds)
        fastest_lap_str = format_seconds_to_time(fastest_lap_seconds)

    # 4. Compile the Summary Data
    summary = {
        "id": session_id,
        "driver": session_data.get("driver"),
        "track": session_data.get("track"),
        "session_date": session_data.get("session_date"),
        "kart": session_data.get("kart"),
        
        # Use the newly CALCULATED fastest lap
        "fastest_lap": fastest_lap_str, 
        "laps_count": total_valid_laps,
        "average_lap": average_lap_time_str
    }
    
    return summary

def generate_sessions_list():
    """Main function to scan files and generate sessions-list.json."""
    if not os.path.isdir(SESSIONS_DIR):
        print(f"Error: Directory '{SESSIONS_DIR}' not found. Check SESSIONS_DIR configuration.")
        return

    all_sessions_summary = []
    
    print(f"Scanning directory: {SESSIONS_DIR}")
    
    # Iterate over all files in the sessions directory
    for filename in os.listdir(SESSIONS_DIR):
        if filename.endswith(".json") and filename != "sessions-list.json":
            filepath = os.path.join(SESSIONS_DIR, filename)
            print(f"Processing {filename}...")
            
            summary = process_session_file(filepath)
            
            if summary:
                # The 'id' key already matches 'session_id' now, no need to pop/rename
                all_sessions_summary.append(summary)

    # Wrap the list in the required JSON structure
    final_output = {
        "sessions": all_sessions_summary
    }

    # Write the final JSON file: ensure_ascii=False fixes special characters (UTF-8)
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as outfile:
        json.dump(final_output, outfile, indent=4, ensure_ascii=False)
        
    print("\n" + "="*50)
    print(f"SUCCESS: Created {OUTPUT_FILE}")
    print(f"Total sessions indexed: {len(all_sessions_summary)}")
    print("="*50)

# --- Execute Script ---
if __name__ == "__main__":
    generate_sessions_list()