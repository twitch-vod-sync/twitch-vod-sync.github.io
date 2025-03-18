var headers = {
  'headers': {
    'Client-ID': 'm0bgzop0z8m62bacx50hxh6v0rkiwe',
  }
}

function setTwitchTokenHeader(token) {
  headers['headers']['Authorization'] = 'Bearer ' + token
}

function doTwitchRedirect() {
  if (window.localStorage.getItem('autoRedirect') != 'true') {
    // TODO: Ask for user consent here
  }

  // If we need to do auth, stash the query params before redirecting, as twitch only allows the base URL as a redirect.
  if (window.location.query != null && window.location.query.length > 1) {
    // TODO: If there's already a query -> loop detected (?)
    window.localStorage.setItem('queryParams', window.location.query)
  }

  // Note that this encodes the current URL so that we can return to where we came from (e.g. dev vs production)
  var authUrl =
    'https://id.twitch.tv/oauth2/authorize' +
    '?client_id=' + headers['headers']['Client-ID'] +
    '&redirect_uri=' + encodeURIComponent(window.location.origin) +
    '&response_type=token' +
    '&scope='

  // May be null if the checkbox didn't render; i.e. we are already auto-redirecting
  var autoRedirect = document.getElementById('autoRedirect')
  if (autoRedirect !== null && autoRedirect.checked) {
    window.localStorage.setItem('autoRedirect', 'true')
  }

  window.location.href = authUrl
}

// Twitch durations look like 1h2m3s *or* 4m5s *or* 6s
const TWITCH_DURATION_MATCH = /(([0-9]+)h)?(([0-9]+)m)?([0-9]+)s/
function parseVideo(videoDetails) {
  m = videoDetails.duration.match(TWITCH_DURATION_MATCH)
  if (m == null) throw Error('Internal error: Twitch duration was unparseable: ' + videoDetails.duration)
  var millis = 0
  millis += Number(m[2]) * 60 * 60 * 1000 // Hours
  millis += Number(m[4]) * 60 * 1000 // Minutes
  millis += Number(m[5]) * 1000 // Seconds

  return {
    'id': videoDetails.id,
    'streamer': videoDetails.user_name,
    'startTime': new Date(videoDetails.created_at).getTime(),
    'endTime': new Date(videoDetails.created_at).getTime() + millis,
  }
}

function getVideoDetails(videoId) {
  return fetch('https://api.twitch.tv/helix/videos?id=' + videoId, headers)
  .then(r => {
    if (r.status != 200) return Promise.reject('HTTP request failed') // TODO: Redo auth here on 401?
    return r.json()
  })
  .then(r => {
    if (r.data.length == 0) return Promise.reject('Could not load video')
    return parseVideo(r.data[0])
  })
}

function getChannelId(channelName) {
  return fetch('https://api.twitch.tv/helix/users?login=' + channelName, headers)
  .then(r => {
    if (r.status != 200) return Promise.reject('HTTP request failed') // TODO: Redo auth here on 401?
    return r.json()
  })
  .then(r => {
    if (r.data.length == 0) return Promise.reject('Could not load channel')
    return r.data[0].id
  })
}

function getChannelVideos(channelId) {
  return fetch('https://api.twitch.tv/helix/videos?type=archive&sort=time&user_id=' + channelId, headers)
  .then(r => {
    if (r.status != 200) return Promise.reject('HTTP request failed') // TODO: Redo auth here?
    return r.json()
  })
  .then(r => {
    if (r.data.length == 0) return Promise.reject('Did not find any videos for this channel')
    return r.data.map(video => parseVideo(video))
  })
}
