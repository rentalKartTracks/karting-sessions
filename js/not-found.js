// Keep the recovery link current without loading a third-party player.
fetch('/latest-video.json')
  .then(response => {
    if (!response.ok) throw new Error('Latest upload unavailable');
    return response.json();
  })
  .then(video => {
    if (/^[A-Za-z0-9_-]{11}$/.test(video.id || '')) {
      document.getElementById('latest-ride').href = 'https://www.youtube.com/watch?v=' + video.id;
    }
  })
  .catch(() => { /* The channel videos link remains available. */ });
