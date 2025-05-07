(() => { // namespace to keep our own copy of 'headers'

// For now, I have just integrated with racetime.gg. If we need more integration, we might need more auth.
var headers = {
  'User-Agent': 'TwitchVodSync/2.0 (https://github.com/twitch-vod-sync/twitch-vod-sync.github.io; https://github.com/twitch-vod-sync/twitch-vod-sync.github.io/issues)',
}

window.getRaceDetails = function(raceId) {
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
    }
  })
}

window.loadRaceVideos = async function(race, count) {
  var raceVideos = []
  for (var i = 0; i < count && i < race.channels.length; i++) {
    var channelVideos = await getChannelVideos(race.channels[i])
    for (var video of channelVideos) {
      if (video.startTime <= race.startTime && race.startTime <= video.endTime) {
        raceVideos.push(video)
        break
      }
    }
  }
  
  return raceVideos
}
})();