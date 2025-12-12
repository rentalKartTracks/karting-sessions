// Read ?id=session-name from URL
const params = new URLSearchParams(window.location.search);
const sessionId = params.get("id");

// Load JSON file from /sessions/
fetch(`sessions/${sessionId}.json`)
  .then(r => r.json())
  .then(data => renderSession(data))
  .catch(err => {
    document.body.innerHTML = "<h2>Session not found.</h2>";
  });

// Render session data
function renderSession(data) {
  document.getElementById("driver").innerText = "Driver – " + data.driver;
  document.getElementById("fastest").innerText = data.fastest_lap;

  document.getElementById("track-link").innerText = data.track.name;
  document.getElementById("track-link").href = data.track.maps_link;

  document.getElementById("kart").innerText = data.kart;
  document.getElementById("date").innerText = data.session_date;

  const lapsDiv = document.getElementById("laps");

  data.laps.forEach(l => {
    const div = document.createElement("div");
    div.className = "lap";

    if (l.lap === null) {
      div.innerHTML = `<b>${l.timestamp}</b> — ${l.note}`;
    } else {
      div.innerHTML = `
        <b>${l.timestamp} Lap ${String(l.lap).padStart(2, "0")}</b>
        <div class="bar" style="width:${l.bar}%"></div>
        ${l.time} ${l.best ? "🏆" : ""}
      `;
    }
    lapsDiv.appendChild(div);
  });

  document.getElementById("ig").href = data.socials.instagram;
  document.getElementById("fb").href = data.socials.facebook;
  document.getElementById("web").href = data.socials.website;
}
