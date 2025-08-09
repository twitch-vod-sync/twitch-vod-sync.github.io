(() => {

// Generate a client ID here: https://dev.twitch.tv/docs/authentication/register-app/
// Note: Must be a public client to include the localhost:3000 url.
// Note: This is not the same ID as used by tests. The tests use a confidential client for auth purposes.
// Include these redirect URLs:
// - https://twitch-vod-sync.github.io (for production)
// - http://localhost:3000 (for local development)
var CLIENT_ID = 'm0bgzop0z8m62bacx50hxh6v0rkiwe'
window.overrideTwitchClientId = function(clientId) { CLIENT_ID = clientId }

function getHeaders() {
  return {
    'headers': {
      'Client-ID': CLIENT_ID,
      'Authorization': 'Bearer ' + window.localStorage.getItem('twitchAuthToken'),
    }
  }
}

window.showTwitchRedirect = function() {
  var authPrefs = window.localStorage.getItem('authPrefs')
  if (authPrefs == 'autoRedirect') {
    doTwitchRedirect()
    return
  }

  document.getElementById('twitchRedirect').style.display = null
  document.getElementById('players').style.display = 'none'
  document.getElementById('timeline').style.display = 'none'
}

window.doTwitchRedirect = function(event) {
  if (event != null) {
    event.preventDefault()
    var authPrefs = event.target.elements['authPrefs'].value
    window.localStorage.setItem('authPrefs', authPrefs)

    if (authPrefs == 'disableAuth') {
      window.location.reload()
      return
    }
  }

  // If there's somehow already query params, stop -- we're probably looping.
  if (window.localStorage.getItem('queryParams') != null) {
    console.log('Attempting to do twitch redirect but there are already cached queryParams. Not taking another redirect action.')

    // Show the UX manually, just in case something's broken. If we're in the middle of a redirect *anyways*, this won't do anything. I hope.
    document.getElementById('twitchRedirect').style.display = null
    document.getElementById('players').style.display = 'none'
    document.getElementById('timeline').style.display = 'none'
    return
  }

  // Otherwise, stash the query params before redirecting, as twitch only allows the base URL as a redirect.
  if (window.location.search != null && window.location.search.length > 1) {
    console.log('Stashing queryParams before twitch redirect:', window.location.search)
    window.localStorage.setItem('queryParams', window.location.search)
  }

  // Note that this encodes the current hostname so that we can return to where we came from (e.g. dev vs production)
  window.location.href =
    'https://id.twitch.tv/oauth2/authorize' +
    '?client_id=' + CLIENT_ID +
    '&redirect_uri=' + encodeURIComponent(window.location.origin) +
    '&response_type=token' +
    '&scope='
}

// Twitch durations look like 1h2m3s *or* 4m5s *or* 6s
const TWITCH_DURATION_MATCH = /(([0-9]+)h)?(([0-9]+)m)?([0-9]+)s/
function parseVideo(videoDetails) {
  m = videoDetails.duration.match(TWITCH_DURATION_MATCH)
  if (m == null) throw Error('Internal error: Twitch duration was unparseable: ' + videoDetails.duration)
  var millis = 0
  if (m[5] != null) millis += Number(m[5])           * 1000 // Seconds
  if (m[4] != null) millis += Number(m[4])      * 60 * 1000 // Minutes
  if (m[2] != null) millis += Number(m[2]) * 60 * 60 * 1000 // Hours

  var parts = videoDetails.thumbnail_url.split('/')
  var hash = parts[4]
  var unique = parts[5]

  var thumbnail_url = `https://static-sdn.jtvnw.net/cf_vods/${hash}/${unique}/thumb/thumb0-640x320.jpg`
  var hover_url = `https://${hash}.cloudfront.net/${unique}/storyboards/${videoDetails.id}-strip-0.jpg`
  var scrub_url = `https://${hash}.cloudfront.net/${unique}/storyboards/${videoDetails.id}-low-0.jpg`

  return {
    'id': videoDetails.id,
    'streamer': videoDetails.user_name,
    'title': videoDetails.title,
    'preview': thumbnail_url, // Twitch-provided thumbnail
    'preview_hover': hover_url, // 'animated' preview when hovering on the past broadcasts page
    'preview_scrub': scrub_url, // low-quality preview images when scrubbing the timeline on a vod page
    'startTime': new Date(videoDetails.created_at).getTime(),
    'endTime': new Date(videoDetails.created_at).getTime() + millis,
  }
}

window.getTwitchVideosDetails = function(videoIds) {
  // See https://dev.twitch.tv/docs/api/reference/#get-videos
  return fetch('https://api.twitch.tv/helix/videos?id=' + videoIds.join('&id='), getHeaders())
  .then(r => {
    if (r.status == 401) showTwitchRedirect()
    if (r.status != 200) return Promise.reject('HTTP request failed: ' + r.status)
    return r.json()
  })
  .then(r => {
    if (r.data.length === 0) return Promise.reject('Could not load any of these twitch videos:' + videoIds.join(', '))
    return r.data.map(video => parseVideo(video))
  })
}

window.getTwitchChannelVideos = function(channelName) {
  // See https://dev.twitch.tv/docs/api/reference/#get-users
  return fetch('https://api.twitch.tv/helix/users?login=' + channelName, getHeaders())
  .then(r => {
    if (r.status == 401) showTwitchRedirect()
    if (r.status != 200) return Promise.reject('HTTP request failed: ' + r.status)
    return r.json()
  })
  .then(r => {
    if (r.data.length === 0) return Promise.reject('Could not load twitch channel ' + channelName)
    var channelId = r.data[0].id
    // See https://dev.twitch.tv/docs/api/reference/#get-videos
    return fetch('https://api.twitch.tv/helix/videos?type=archive&sort=time&user_id=' + channelId, getHeaders())
  })
  .then(r => {
    if (r.status == 401) showTwitchRedirect()
    if (r.status != 200) return Promise.reject('HTTP request failed: ' + r.status)
    return r.json()
  })
  .then(r => {
    if (r.data.length === 0) return Promise.reject('Did not find any videos for twitch channel ' + channelName)
    return r.data.map(video => parseVideo(video))
  })
}
})()
