## 🏎️ Karting Sessions Data Generator

This utility script (`python .\generate_list.py`) is used to automatically scan all individual session JSON files within the project directory and compile them into a single summary file, `sessions-list.json`.

The `sessions-list.json` file is required by the main dashboard (`index.html`) for quick filtering, sorting, and displaying summary statistics without having to load hundreds of detailed session files.

### Prerequisites

To run this script, you need to have **Python 3** installed on your system.

1.  **Check Python:** Open your terminal (PowerShell or Command Prompt) and run:
    ```bash
    python --version
    ```
    If you see a version number (e.g., `Python 3.10.0`), you are ready.

### ⚙️ Configuration Setup

Before running the script, ensure the internal configuration is set correctly based on your file structure.

The script expects all individual session JSON files (`*.json`) and the `generate_list.py` script to reside within the **same directory** (e.g., the `sessions/` folder).

Open `generate_list.py` and ensure the configuration section looks like this:

```python
# --- Configuration ---
# SESSIONS_DIR = "." tells the script to look for files in the current directory.
SESSIONS_DIR = "." 
OUTPUT_FILE = os.path.join(SESSIONS_DIR, "sessions-list.json")