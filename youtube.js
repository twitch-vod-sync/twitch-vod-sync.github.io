(() => { // namespace to keep our own copy of 'headers'

var headers = {
}
// TODO: I'll need this at some point, probably just re-use the existing UX but have some dynamic param to name the website we're going to.
/*
window.showYoutubeRedirect = function() {
  var authPrefs = window.localStorage.getItem('authPrefs')
  if (authPrefs == 'autoRedirect') {
    doYoutubeRedirect()
    return
  }

  document.getElementById('twitchRedirect').style.display = null
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
    '&scope='
}
*/

// TODO: Very hacks.
window.getYoutubeVideosDetails = function(videoIds) {
  p = new Promise((resolve, reject) => {
    resolve([{
      'id': 'DGM4Mrii96E',
      'streamer': 'jbzdarkid',
      'title': 'The Witness any% in 15:14',
      'preview': 'https://i.ytimg.com/vi/DGM4Mrii96E/hqdefault.jpg',
      'preview_hover': 'todo',
      'preview_scrub': 'todo',
      'startTime': new Date("2020-01-24T18:07:17-08:00").getTime(),
      'endTime': new Date("2020-01-24T18:07:17-08:00").getTime() + 1000000,
    }])
  })
  
  return p
}

})()