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

window.getSRLRaceDetails = function(raceId) {
  // e.g. 'https://www.speedrunslive.com/api/pastresults/289423'
  return fetch('https://www.speedrunslive.com/api/pastresults/' + raceId, {'headers': headers})
  .then(r => {
    if (r.status != 200) return Promise.reject('HTTP request failed: ' + r.status)
    return r.json()
  })
  .then(async r => {
    var channels = []
    for (var entrant of r.data.entrants) {
      var channel = await getSRLTwitchChannel(entrant)
      channels.push(channel)
    }
    
    return {
      'startTime': r.data.raceDate * 1000,
      'channels': channels,
      'url': 'https://www.speedrunslive.com/races/result/' + raceId, // Original race URL for query param caching purposes
    }
  })
}

function getSRLTwitchChannel(playerName) {
  // e.g. 'https://www.speedrunslive.com/api/players/Midboss'
  return fetch('https://www.speedrunslive.com/api/players/' + playerName, {'headers': headers})
  .then(r => {
    if (r.status != 200) return Promise.reject('HTTP request failed: ' + r.status)
    return r.json()
  })
  .then(r => {
    return r.data.channel
  })
}

window.loadRaceVideos = async function(race, count) {
  var raceVideos = []
  for (var i = 0; i < race.channels.length; i++) {
    // TODO: This can fail (e.g. if a channel doesn't save VODs). We should probably just continue to the next video in this case...
    var channelVideos = await getChannelVideos(race.channels[i])
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