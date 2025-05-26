(() => { // namespace to keep our own copy of 'headers'

// For now, I have just integrated with racetime.gg. If we need more integration, we might need more auth.
var headers = {
}

window.getRacetimeRaceDetails = function(raceId) {
  // e.g. 'https://racetime.gg/dk64r/wonderful-krossbones-7951/data'
  return fetch('https://racetime.gg/' + raceId + '/data', {'headers': headers})
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
    // TODO: This can fail (e.g. if a channel doesn't save VODs). We should probably just continue to the next video in this case...
    var channelVideos = await getTwitchChannelVideos(race.channels[i])
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