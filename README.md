# 🏎️ Karting Telemetry Dashboard

A comprehensive telemetry tracking system for karting sessions with advanced filtering, performance trends, and personal best tracking.

## 📋 Features

- **Session Management**: Track and view all your karting sessions
- **Personal Bests**: Automatic PB tracking per driver per track
- **Track Records**: See the fastest lap across all drivers
- **Performance Trends**: Track improvement/decline over your last 3 sessions
- **Advanced Filtering**: Search, filter by track, date ranges, and more
- **Responsive Design**: Works on desktop, tablet, and mobile devices
- **Interactive Legend**: Built-in help system explaining all badges and trends

## 🚀 Running Locally

### Prerequisites

To run this application locally, you need:
- **Python 3** installed on your system
- All session JSON files in the `sessions/` directory
- Generated `sessions-list.json` file

### Step 1: Generate Sessions List

First, ensure you have all your individual session JSON files in the `sessions/` directory, then generate the summary file:

```bash
# Navigate to the sessions directory
cd sessions

# Run the generator script
python generate_list.py
```

This will create `sessions-list.json` which contains the summary of all sessions.

### Step 2: Start Local Web Server

**Important**: You cannot simply open `index.html` directly in your browser due to CORS restrictions when fetching JSON files. You must run a local web server.

Navigate back to your project root directory and start a web server:

```bash
# Navigate to project root (where index.html is located)
cd ..

# Start Python's built-in web server
python -m http.server 8000
```

You should see output like:
```
Serving HTTP on 0.0.0.0 port 8000 (http://0.0.0.0:8000/) ...
```

### Step 3: Open in Browser

Open your web browser and navigate to:
```
http://localhost:8000
```

You should now see the Karting Telemetry Dashboard with all your sessions loaded!

## 🔧 Alternative Web Servers

If you prefer different tools, here are other options:

### Using Node.js (http-server)
```bash
# Install globally (one time)
npm install -g http-server

# Run from project root
http-server -p 8000
```

### Using VS Code Live Server
1. Install the "Live Server" extension
2. Right-click `index.html`
3. Select "Open with Live Server"

### Using PHP
```bash
php -S localhost:8000
```

## 📁 Project Structure

```
karting-telemetry/
├── index.html              # Main dashboard
├── session.html            # Individual session viewer (if exists)
├── README.md              # This file
└── sessions/
    ├── generate_list.py   # Session list generator
    ├── sessions-list.json # Generated summary file
    ├── session-001.json   # Individual session files
    ├── session-002.json
    └── ...
```

## 🎯 Understanding Badges & Trends

Click the **"?" button** (bottom-right corner) in the dashboard to see detailed explanations of:

- **⭐ PB (Personal Best)**: Your fastest lap on a specific track
- **🎯 Track PB**: The fastest lap by any driver on that track
- **📈 Improving**: Performance trending faster (>1% improvement)
- **📉 Declining**: Performance trending slower (>1% decline)
- **➡️ Stable**: Consistent performance (within ±1%)

### How Trends Work

Trends are calculated **per driver** by comparing each session to the average of your previous 3 sessions on the same track and configuration. You need at least 2 previous sessions on the same track for a trend to appear.

## 🐛 Troubleshooting

### "Failed to load sessions" Error
- Check that `sessions/sessions-list.json` exists
- Run `python generate_list.py` in the sessions directory
- Verify the JSON file is valid (use JSONLint.com)

### Blank Page or No Data
- Open browser console (F12) to see JavaScript errors
- Ensure you're running a web server (not opening file directly)
- Check that `sessions-list.json` is in the correct location

### Sessions Not Updating
- Re-run `python generate_list.py` after adding new session files
- Hard refresh your browser (Ctrl+F5 or Cmd+Shift+R)

## ⚙️ Configuration Setup

The `generate_list.py` script expects all individual session JSON files (`*.json`) to reside within the **same directory** as the script (the `sessions/` folder).

Open `generate_list.py` and ensure the configuration section looks like this:

```python
# --- Configuration ---
# SESSIONS_DIR = "." tells the script to look for files in the current directory.
SESSIONS_DIR = "." 
OUTPUT_FILE = os.path.join(SESSIONS_DIR, "sessions-list.json")
```

## 📊 Session Data Format

Each session JSON file should contain:

```json
{
  "id": "session-001",
  "driver": "Driver Name",
  "track": {
    "name": "Track Name",
    "configuration": "Full Track"
  },
  "session_date": "2024-01-15",
  "fastest_lap": "1:23.456",
  "kart": "Kart #12",
  "laps_count": 15,
  "average_lap": "1:25.123"
}
```

## 🔄 Workflow

1. Add new session JSON files to `sessions/` directory
2. Run `python generate_list.py` in the sessions directory
3. Start web server: `python -m http.server 8000`
4. Open `http://localhost:8000` in your browser
5. View and analyze your sessions!

## 📱 Mobile Support

The dashboard is fully responsive and works great on mobile devices. All features including filtering, sorting, and the legend are optimized for touch interfaces.

## 🎨 Browser Compatibility

Tested and working on:
- Chrome/Edge (recommended)
- Firefox
- Safari
- Mobile browsers (iOS Safari, Chrome Mobile)

---

**Happy Racing! 🏁**