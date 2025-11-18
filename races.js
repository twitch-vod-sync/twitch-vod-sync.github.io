(() => {

// For now, I have just integrated with racetime.gg. If we need more integration, we might need auth.
window.getRacetimeRaceDetails = function(raceId) {
  // e.g. 'https://racetime.gg/dk64r/wonderful-krossbones-7951/data'
  return fetch('https://racetime.gg/' + raceId + '/data')
  .then(r => {
    if (r.status != 200) return Promise.reject('HTTP request failed: ' + r.status)
    return r.json()
  })
  .then(r => {
    return {
      'startTime': new Date(r.started_at).getTime(),
      'channels': r.entrants.map(e => e.user.twitch_name),
      'url': 'https://racetime.gg/' + raceId, // Original race URL for query param caching purposes
    }
  })
}

window.loadRaceVideos = async function(race, count) {
  var raceVideos = []
  for (var i = 0; i < race.channels.length; i++) {
    try {
      var channelVideos = await getTwitchChannelVideos(race.channels[i])
    } catch (ex) {
      // This can fail (e.g. if a channel doesn't save VODs). If that happens, just continue to the next entrant.
      console.warn(ex)
      continue
    }

    console.log('Loaded', channelVideos.length, 'race videos for channel', race.channels[i])

    for (var video of channelVideos) {
      if (video.startTime <= race.startTime && race.startTime <= video.endTime) {
        raceVideos.push(video)
        break
      }
    }
    
    if (raceVideos.length >= count) break // Found enough videos to fill the display, we can stop iterating
  }
  
  return raceVideos
}
})();