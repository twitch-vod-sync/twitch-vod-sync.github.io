(() => { // namespace to keep our own copy of 'headers'

// TODO: Docs on which redirect URIs I need

// Generate a client ID here: https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow
// Note: Must be a web client to include the localhost:3000 url.
// Note: This is not the same ID as used by tests. The tests use a confidential client for auth purposes.
// Include these redirect URLs:
// - https://twitch-vod-sync.github.io (for production)
// - http://localhost:3000 (for local development)
var headers = {
  'Client-ID': '588578868528-b3q38esqc12bs70a5mnp2tr82tocoql4.apps.googleusercontent.com',
}

window.setYoutubeTokenHeader = function(token) {
  headers['Authorization'] = 'Bearer ' + token
}

window.overrideYoutubeClientId = function(clientId) {
  headers['Client-ID'] = clientId
}

window.showYoutubeRedirect = function() {
  var authPrefs = window.localStorage.getItem('authPrefs')
  if (authPrefs == 'autoRedirect') {
    doYoutubeRedirect()
    return
  }

  // TODO: Adjust some DOM element to say "youtube" instead of "twitch" here.
  document.getElementById('twitchRedirect').style.display = null // TODO: Rename me!
  document.getElementById('players').style.display = 'none'
  document.getElementById('timeline').style.display = 'none'
}

window.doYoutubeRedirect = function(event) {
  if (event != null) {
    event.preventDefault()
    var authPrefs = event.target.elements['authPrefs'].value
    window.localStorage.setItem('authPrefs', authPrefs)
  }

  // If there's somehow already query params, drop them -- we're probably looping.
  if (window.localStorage.getItem('queryParams') != null) {
    window.localStorage.removeItem('queryParams')

  // Otherwise, stash the query params before redirecting, as twitch only allows the base URL as a redirect.
  } else if (window.location.search != null && window.location.search.length > 1) {
    window.localStorage.setItem('queryParams', window.location.search)
  }

  // Note that this encodes the current hostname so that we can return to where we came from (e.g. dev vs production)
  window.location.href =
    'https://id.twitch.tv/oauth2/authorize' +
    '?client_id=' + headers['Client-ID'] +
    '&redirect_uri=' + encodeURIComponent(window.location.origin) +
    '&response_type=token' +
    '&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fyoutube.readonly' // TODO: I think this is the smallest scope we can ask for. This shows up as "View your YouTube account" which sounds nicely harmless, if it works.
}

// Youtube durations follow ISO8601, which in theory includes year-long durations.
// For my sanity, this parser only handles durations up to a maximum of days.
const YOUTUBE_DURATION_MATCH = /P(([0-9])D)?(T(([0-9]+)H)?(([0-9]+)M)?(([0-9]+)S)?)?/
function parseVideo(videoDetails) {
  m = videoDetails.contentDetails.duration.match(YOUTUBE_DURATION_MATCH)
  if (m == null) throw Error('Internal error: Youtube duration was unparseable: ' + videoDetails.contentDetails.duration)
  var millis = 0
  if (m[9] != null) millis += Number(m[9])                * 1000 // Seconds
  if (m[7] != null) millis += Number(m[7])           * 60 * 1000 // Minutes
  if (m[5] != null) millis += Number(m[5])      * 60 * 60 * 1000 // Hours
  if (m[2] != null) millis += Number(m[2]) * 24 * 60 * 60 * 1000 // Days

  return {
    'id': videoDetails.id,
    'streamer': videoDetails.snippet.channelTitle,
    'title': videoDetails.snippet.title,
    'preview': videoDetails.snippet.thumbnails.high.url, // Youtube-provided thumbnail
    'startTime': new Date(videoDetails.snippet.publishedAt).getTime(),
    'endTime': new Date(videoDetails.snippet.publishedAt).getTime() + millis,
  }
}

window.getYoutubeVideosDetails = function(videoIds) {
  // See https://developers.google.com/youtube/v3/docs/videos/list
  var url = 'https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet'
  return fetch(url + '&id=' + videoIds.join(','), {'headers': headers})
  .then(r => {
    if (r.status == 401) showYoutubeRedirect()
    if (r.status != 200) return Promise.reject('HTTP request failed: ' + r.status)
    return r.json()
  })
  .then(r => {
    if (r.items.length === 0) return Promise.reject('Could not load any of these youtube videos:' + videoIds.join(', '))
    return r.items.map(video => parseVideo(video))
  })
}

})()