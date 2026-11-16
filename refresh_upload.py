"""Cache the latest public channel upload for GitHub Pages."""
import json
import re
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

CHANNEL = "UC5MWw8FaexlnJsrlTPiQPwA"
FEED = f"https://www.youtube.com/feeds/videos.xml?channel_id={CHANNEL}"
NS = {"a": "http://www.w3.org/2005/Atom", "yt": "http://www.youtube.com/xml/schemas/2015"}


def newest_upload(xml):
    entries = ET.fromstring(xml).findall("a:entry", NS)
    entry = max(entries, key=lambda e: e.findtext("a:published", "", NS))
    video_id = entry.findtext("yt:videoId", "", NS)
    title = entry.findtext("a:title", "", NS).strip()
    if (entry.findtext("yt:channelId", "", NS) != CHANNEL
            or not re.fullmatch(r"[\w-]{11}", video_id, re.ASCII) or not title):
        raise ValueError("Invalid channel upload")
    published = date.fromisoformat(entry.findtext("a:published", "", NS)[:10])
    return {"id": video_id, "title": title, "published": published.isoformat()}


if __name__ == "__main__":
    with urllib.request.urlopen(FEED, timeout=20) as response:
        upload = newest_upload(response.read())
    path = Path("latest-video.json")
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(upload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)
