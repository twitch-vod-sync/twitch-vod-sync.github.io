var FEATURES = {
  'HIDE_ENDING_TIMES': true,
  'SHUFFLE_RACE_VIDEOS': true,
  'DO_TWITCH_AUTH': true,
}
const MIN_PLAYERS = 2 // It's too much work to support this being dynamic, so I won't.

// An arbitrary timestamp where we align videos while async-ing. Still considerably lower than Number.MAX_SAFE_INTEGER.
// This is somewhere in 2017. It doesn't really matter; videos offsets can be positive, too.
const ASYNC_ALIGN = 1500000000000

window.onload = function() {
  // There's a small chance we didn't get a 'page closing' event fired, so if this setting is still set and we have a token,
  // delete the localstorage so we show the prompt again.
  if (window.localStorage.getItem('authPrefs') == 'neverSave' && window.localStorage.getItem('twitchAuthToken') != null) {
    console.log('Clearing localStrage onload')
    window.localStorage.clear()

    // Normal lifecycle has a pagehide event fire before the window closes. While this is not guaranteed to fire on mobile,
    // (A) this app sucks on mobile and (B) I don't want to clear tokens just because you tabbed away from the page.
    // Note that we only add this listener if 'neverSave' was set on page load, otherwise we clear preferences as we do the twitch redirect,
    // and don't save the fact that the user doesn't want us to persist their token.
    window.addEventListener('pagehide', (event) => {
      if (event.persisted) return // Page is being disabled but only temporarily, no need to clean up
      if (window.localStorage.getItem('authPrefs') == 'neverSave') {
        console.log('Clearing localStrage onhide')
        window.localStorage.clear()
      }
    })
  }

  // Check to see if the app is starting with a token (from a Twitch/Youtube redirect). If so, capture it and remove it from the URL.
  if (window.location.hash != null && window.location.hash.length > 1) {
    var params = new URLSearchParams(window.location.hash.substring(1))
    var scope = params.get('scope')
    if (scope == 'https://www.googleapis.com/auth/youtube.readonly') {
      window.localStorage.setItem('youtubeAuthToken', params.get('access_token'))
      var expires_at = new Date().getTime() + (params.get('expires_in') * 1000)
      window.localStorage.setItem('youtubeAuthTokenExpires', expires_at)
    } else if (scope == '') {
      window.localStorage.setItem('twitchAuthToken', params.get('access_token'))

      // Additional param (which won't ever come from twitch) that is used to override the client_id in tests.
      // The tests need a confidential client (to do auth server-side) but the product needs a native client (to have a localhost redirect).
      if (params.has('client_id')) window.overrideTwitchClientId(params.get('client_id'))
    }
    window.location.hash = ''
  }

  // Parse the query parameters (or the stashed parameters, if we're getting an auth callback).
  var params = null
  if (window.localStorage.getItem('queryParams') != null) {
    params = new URLSearchParams(window.localStorage.getItem('queryParams'))
    console.log('Loaded query params from storage:', params.toString())
    window.localStorage.removeItem('queryParams')
  } else {
    params = new URLSearchParams(window.location.search)
    console.log('Loaded query params from url:', params.toString())
  }

  // Check to see if we should disable Twitch auth. This can be configured manually by the user,
  // or triggered automatically because they were given a URL with all offsets specified,
  // if the URL's creator had manually disabled Twitch auth.
  // Note that we *don't* use authPrefs to track this, since that would mean loading such a URL would overwrite your settings.
  var anyVideoParams = false
  var allVideosHaveOffsets = true
  for (var [playerId, videoIds] of params.entries()) {
    if (playerId.startsWith('player')) {
      anyVideoParams = true
      if (!params.has('offset' + playerId)) {
        allVideosHaveOffsets = false
        break
      }
    }
  }
  
  if ((anyVideoParams && allVideosHaveOffsets) || window.localStorage.getItem('authPrefs') == 'disableAuth') {
    FEATURES.DO_TWITCH_AUTH = false
  }

  // We almost always need auth for Twitch, to load video details. Trigger auth if we haven't disabled it (above) or if there's no token.
  if (FEATURES.DO_TWITCH_AUTH && window.localStorage.getItem('twitchAuthToken') == null) {
    window.showTwitchRedirect()
    return
  }

  // Start with two players by default
  window.addPlayer()
  window.addPlayer()

  // Once auth is sorted out, load any videos from the query parameters
  for (var [playerId, videoIds] of params.entries()) {
    // There may be other params, this loop is only for player0, player1, etc
    if (playerId.startsWith('player') && videoIds.length > 0) {
      while (document.getElementById(playerId) == null) window.addPlayer()

      // Copy the loop variables to avoid javascript lambda-in-loop bug
      ;((playerId, videoIds) => {
        // Multi-video players should always be from the same source.
        var firstVideo = videoIds.split('-')[0]
        if (firstVideo.match(YOUTUBE_VIDEO_MATCH) != null) {
          getStubVideosDetails(videoIds.split('-'))
          .then(videos => loadVideos(playerId, videos, YOUTUBE))
          .catch(r => showText(playerId, 'Could not process youtube video "' + videoIds + '":\n' + r, /*isError*/true))
        } else if (!FEATURES.DO_TWITCH_AUTH) {
          getStubVideosDetails(videoIds.split('-'))
          .then(videos => loadVideos(playerId, videos, TWITCH))
          .catch(r => showText(playerId, 'Could not process twitch video "' + videoIds + '":\n' + r, /*isError*/true))
        } else if (firstVideo.match(TWITCH_VIDEO_MATCH) != null) {
          getTwitchVideosDetails(videoIds.split('-'))
          .then(videos => loadVideos(playerId, videos, TWITCH))
          .catch(r => showText(playerId, 'Could not process twitch video "' + videoIds + '":\n' + r, /*isError*/true))
        } else {
          showText(playerId, 'Could not parse video string "' + videoIds + '"', /*isError*/true)
        }
      })(playerId, videoIds)
    }
  }

  // Handle this after video IDs since we want to preserve videos (e.g. async alongside a race)
  if (params.has('race')) {
    var m = params.get('race').match(RACETIME_GG_MATCH)
    if (m != null) {
      getRacetimeRaceDetails(m[1])
      .then(raceDetails => loadRace(raceDetails))
    }
  }

  window.addEventListener('resize', resizePlayers)

  // This function updates the timeline cursor and label so they stay up to date with the current videos
  // It also runs any of our "live" checks, i.e. anything which needs to be updated without user action
  window.setInterval(() => refreshTimeline(), 100)

  // Handle space, left, and right as global listeners, in case you don't actually have a stream selected
  // Each of these just calls an event (play, pause, seek) on one of the players, so it'll fall through into the default handler.
  document.addEventListener('keydown', (event) => {
    if (document.activeElement.tagName == 'INPUT') return // If the user is typing, don't react to the buttons.
    // Used in a variety of key handlers. These are pretty cheap to compute so I don't mind running them even if we don't need them.
    var firstPlayingVideo = null
    var firstPausedVideo = null
    var anyVideoInAsync = false
    for (var player of players.values()) {
      if (player.state === PLAYING || player.state === SEEKING_PLAY) {
        if (firstPlayingVideo == null) firstPlayingVideo = player
      } else if (player.state === PAUSED || player.state === SEEKING_PAUSE) {
        if (firstPausedVideo == null) firstPausedVideo = player
      } else if (player.state === ASYNC) {
        anyVideoInAsync = true
      }
    }

    if (event.key == 'h') {
      FEATURES.HIDE_ENDING_TIMES = !FEATURES.HIDE_ENDING_TIMES
      reloadTimeline()

    } else if (event.key == 'q') {
      // TODO: Quality cycle
      // 1. Fetch all available qualities from all videos with player.getQualities
      // 2. Bucket/group/whatever to find the minimum supported qualities between all players
      // 3. Determine the current quality based on the average? or something.
      // 4. Increment to the next quality in the minimum list (player.setQuality)
      // idk. I'm not sure what behavior you really want here -- I think for now this can just toggle between "min" and "max"

    } else if (event.key == 'a') {
      // On the first press, bring all videos into 'async mode', where they can be adjusted freely.
      // We need to start by aligning all videos based on their current time.
      if (!anyVideoInAsync) {
        console.log('Entering async mode')
        for (var player of players.values()) {
          player.state = ASYNC
          player.pause()

          // Initially align all videos to ASYNC_ALIGN, then the user can manually adjust relative to a known startpoint.
          var pausedTimestamp = player.getCurrentTimestamp()
          player.offset += (ASYNC_ALIGN - pausedTimestamp)
        }
        // The videos will now respond to 'seek' and 'pause' events and adjust their offsets accordingly.
        // TODO: Label the timeline with ASYNC MODE since otherwise people won't know wtf happened when they push 'A'

      } else {
        // Once the user hits 'a' again, we normalize the offsets so that the earliest video is at the "true" time,
        // so that the timeline shows something reasonable.
        // If the user has enabled Twitch auth, we normalize the offsets so that the timeline shows something reasonable.
        // If the user has disabled Twitch auth, we keep all the offsets at their full value so the resulting URL implies the start times.
        // If the user was given a non-auth URL, we keep with the 'disabled Twitch' mode so they can adjust offsets without breaking the timeline.
        if (FEATURES.DO_TWITCH_AUTH) {
          var largestOffset = -ASYNC_ALIGN
          for (var player of players.values()) {
            if (player.offset > largestOffset) largestOffset = player.offset
          }

          for (var player of players.values()) {
            player.offset -= largestOffset
          }
        }

        // Save offsets into the URL (to allow sharing)
        var params = new URLSearchParams(window.location.search);
        for (var player of players.values()) {
          // When Twitch auth is disabled, we emit all offsets so that the resulting URL is coded to also not trigger auth.
          // When Twitch auth is enabled, we omit the smallest offset (there must be one) to not trigger the above.
          if (!FEATURES.DO_TWITCH_AUTH || player.offset != 0) {
            params.set('offset' + player.id, player.offset)
          }
        }
        history.pushState(null, null, '?' + params.toString())

        reloadTimeline() // Reload now that the videos have comparable start and end times

        console.log('Resuming all players after async alignment')
        for (var player of players.values()) {
          player.state = PLAYING
          player.play()
        }
      }
    } else {
      // Spacebar pauses (if anyone is playing) or plays (if everyone is paused)
      // Left and right seek based on the most recent seek (if it hasn't completed) or else the location of the first video (if any video is loaded)
      if (firstPlayingVideo != null) {
        var seekTarget = pendingSeekTimestamp > 0 ? pendingSeekTimestamp : firstPlayingVideo.getCurrentTimestamp()
        if (event.key == ' ') firstPlayingVideo.pause()
        if (event.key == 'ArrowLeft')  seekPlayersTo(seekTarget - 10000, PLAYING)
        if (event.key == 'ArrowRight') seekPlayersTo(seekTarget + 10000, PLAYING)
      } else if (firstPausedVideo != null) {
        var seekTarget = pendingSeekTimestamp > 0 ? pendingSeekTimestamp : firstPausedVideo.getCurrentTimestamp()
        if (event.key == ' ') firstPausedVideo.play()
        if (event.key == 'ArrowLeft')  seekPlayersTo(seekTarget - 10000, PAUSED)
        if (event.key == 'ArrowRight') seekPlayersTo(seekTarget + 10000, PAUSED)
      }
    }
  })
}

function addPlayer() {
  var playersDiv = document.getElementById('players')

  var newPlayer = document.createElement('div')
  newPlayer.id = 'player' + playersDiv.childElementCount
  playersDiv.appendChild(newPlayer)
  newPlayer.style = 'flex: 1 0 50%; display: flex; flex-direction: column; justify-content: center; align-items: center'

  var form = document.createElement('form')
  newPlayer.appendChild(form)
  form.id = newPlayer.id + '-form'
  form.style = 'display: flex; flex-direction: column; align-items: center'
  form.addEventListener('submit', searchVideo)

  var inputAndButton = document.createElement('div')
  form.appendChild(inputAndButton)

  var textInput = document.createElement('input')
  inputAndButton.appendChild(textInput)
  textInput.setAttribute('type', 'text')
  textInput.setAttribute('name', 'video')
  textInput.setAttribute('placeholder', 'Twitch video URL')

  var submit = document.createElement('input')
  inputAndButton.appendChild(submit)
  submit.setAttribute('type', 'submit')
  submit.setAttribute('value', 'Watch')

  var helpText = document.createElement('div')
  form.appendChild(helpText)
  helpText.style = 'padding: 10px; display: none'
  helpText.id = newPlayer.id + '-text'
  helpText.className = 'body-text'

  // If the form is still visible after 10 seconds, show a "help" hint about how to interact with this app.
  setTimeout(() => {
    if (helpText.style.display != 'none') return // Other info text is displaying
    helpText.style = 'padding: 10px'
    helpText.innerText = 'Enter a Twitch video url to watch in sync with the others. More details in '

    var readme = document.createElement('a')
    helpText.appendChild(readme)
    readme.href = 'https://github.com/twitch-vod-sync/twitch-vod-sync.github.io/?tab=readme-ov-file#twitch-vod-sync'
    readme.target = '_blank'
    readme.innerText = 'the readme'
  }, 10000)

  resizePlayers()
}

function showText(playerId, message, isError) {
  if (isError) {
    console.error(playerId, message)
    debugger;
  }
  var error = document.getElementById(playerId + '-text')
  if (message == null) {
    error.innerText = ''
    error.style.color = null
    error.style.display = 'none'
  } else {
    error.innerText = message
    error.style.color = isError ? 'red' : null
    error.style.display = null
  }
}

function removePlayer() {
  var playersDiv = document.getElementById('players')
  var playerToRemove = playersDiv.childNodes[playersDiv.childElementCount - 1]
  if (playersDiv.childElementCount <= MIN_PLAYERS) {
    // If we've already got 2 players, and the second player is empty, '-' should clear the first player instead
    var playerHasContent = players.has(playerToRemove.id) || document.getElementById(playerToRemove.id + '-form').style.display == null
    if (!playerHasContent) playerToRemove = playersDiv.childNodes[0]
  }

  // Untrack the player and update the timeline
  players.delete(playerToRemove.id)
  reloadTimeline()

  // Update displayed query params to remove this video
  var params = new URLSearchParams(window.location.search);
  params.delete(playerToRemove.id)
  params.delete('offset' + playerToRemove.id)
  history.pushState(null, null, '?' + params.toString())

  // Remove the div (which also unloads the embed)
  playerToRemove.remove()

  // Restore back up to the minimum number of players (2)
  while (playersDiv.childElementCount < MIN_PLAYERS) window.addPlayer()
}

function resizePlayers() {
  var playersDiv = document.getElementById('players')

  var aspectRatio = 16.0 / 9.0 // Aspect ratio of twitch videos

  // Test all row counts (full horizontal through full vertical) to determine the one which fits the most videos.
  var bestNorm = 0
  var perColumn = 1
  for (var rows = 1; rows <= playersDiv.childElementCount; rows++) {
    // Compute the maximum possible size of each player
    var cols = Math.ceil(playersDiv.childElementCount / rows)
    var width = playersDiv.clientWidth / cols
    var height = playersDiv.clientHeight / rows

    // In practice, one of the two dimensions will be smaller, so the other is capped.
    var actualWidth  = Math.min(width, height * aspectRatio)
    var actualHeight = Math.min(height, width / aspectRatio)

    // Evaluate the best fit based on the squared length of the diagonal
    var norm = actualWidth * actualWidth + actualHeight * actualHeight
    if (norm > bestNorm) {
      bestNorm = norm
      perColumn = cols
    }
  }

  // We only care about the width of each player (for flex purposes), not the number of rows -- flexbox will do that for us.

  var playersDiv = document.getElementById('players')
  for (var playerElem of playersDiv.childNodes) {
    playerElem.style.flexBasis = 100 / perColumn + '%' // Note: I'm using integer division here so that we don't have float rounding issues.
  }
}

const RACETIME_GG_MATCH     = /^(?:https?:\/\/)(?:www\.)?racetime\.gg\/([a-z0-9-]+\/[a-z0-9-]+)(?:\/.*)?(?:\?.*)?$/
const YOUTUBE_VIDEO_MATCH   = /^(?:https:\/\/(?:www\.)?(?:m\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/))?([0-9A-Za-z_-]{10}[048AEIMQUYcgkosw])(?:\?.*)?$/
const TWITCH_VIDEO_MATCH    = /^(?:https?:\/\/(?:www\.)?(?:m\.)?twitch\.tv\/videos\/)?([0-9]+)(?:\?.*)?$/
const TWITCH_CHANNEL_MATCH  = /^(?:https?:\/\/(?:www\.)?(?:m\.)?twitch\.tv\/)?([a-zA-Z0-9]\w+)\/?(?:\?.*)?$/
function searchVideo(event) {
  event.preventDefault()

  var form = event.target
  var formText = form.elements['video'].value
  var playerId = form.parentElement.id

  // Prevent searching again if we're already trying to load something.
  // Other text will be shown on success or failure
  if (document.getElementById(playerId + '-text').innerText.startsWith('Loading')) return

  // Clear out the video picker if we were showing one
  var videoPicker = document.getElementById(playerId + '-grid')
  if (videoPicker != null) videoPicker.remove()

  // Check to see if this is a racetime link
  var m = formText.match(RACETIME_GG_MATCH)
  if (m != null) {
    showText(playerId, 'Loading race...')
    getRacetimeRaceDetails(m[1])
    .then(raceDetails => loadRace(raceDetails))
    .catch(r => showText(playerId, 'Could not load racetime.gg race "' + m[1] + '":\n' + r, /*isError*/true))
    return
  }

  // Check to see if the user provided a direct youtube video (or youtube video id)
  m = formText.match(YOUTUBE_VIDEO_MATCH)
  if (m != null) {
    showText(playerId, 'Loading Youtube video...')
    getStubVideosDetails([m[1]])
    .then(videos => loadVideos(playerId, videos, YOUTUBE))
    .catch(r => showText(playerId, 'Could not process youtube video "' + m[1] + '":\n' + r, /*isError*/true))
    return
  }
  // Check to see if the user provided a direct twitch VOD (or VOD id)
  m = formText.match(TWITCH_VIDEO_MATCH)
  if (m != null) {
    showText(playerId, 'Loading Twitch VOD...')
    getTwitchVideosDetails([m[1]]) // TODO: How does this work if we disabled twitch auth?
    .then(videos => loadVideos(playerId, videos, TWITCH))
    .catch(r => showText(playerId, 'Could not process twitch video "' + m[1] + '":\n' + r, /*isError*/true))
    return
  }

  // Check to see if it's a channel (in which case we can look for a matching video)
  m = formText.match(TWITCH_CHANNEL_MATCH)
  if (m != null) {
    showText(playerId, 'Loading channel videos...')
    getTwitchChannelVideos(m[1])
    .then(videos => {
      var currentTimestamp = getAveragePlayerTimestamp()
      var [timelineStart, timelineEnd] = getTimelineBounds()

      var bestVideo = null
      for (var video of videos) {
        // We are looking for two videos which have any overlap.
        // Determine which started first -- our video or the timeline.
        // Then, check to see if that video contains the timestamp of the other video's start.
        if ((timelineStart <= video.startTime && video.startTime <= timelineEnd)
          || (video.startTime <= timelineStart && timelineStart <= video.endTime)) {

          // If there's a video which overlaps our current playhead, use that
          if (video.startTime <= currentTimestamp && currentTimestamp <= video.endTime) {
            bestVideo = video
            break
          // Otherwise, pick the earliest video which has overlap
          } else if (bestVideo == null || video.startTime < bestVideo.startTime) {
            bestVideo = video
          }
        }
      }

      if (bestVideo != null) {
        loadVideos(playerId, [bestVideo], TWITCH) // TODO: Load all matching videos once the player can handle multiple videos
        return
      }

      // If we have no timeline (or there was no overlap), show a video picker so the user can select what they want.
      showVideoPicker(playerId, videos)
    })
    .catch(r => showText(playerId, 'Could not process channel "' + m[1] + '":\n' + r, /*isError*/true))
    return
  }

  showText(playerId, 'Could not parse input "' + formText + '"', /*isError*/true)
}

function showVideoPicker(playerId, videos) {
  showText(playerId, 'Unable to automatically determine video. Hover the images below to see the stream title then click to load the video.')

  var videoGrid = document.createElement('div')
  document.getElementById(playerId).appendChild(videoGrid)
  videoGrid.style = 'display: flex; flex-wrap: wrap; gap: 10px; width: 980px' // Need to set a width to get 3 per line
  videoGrid.id = playerId + '-grid'

  for (var i = 0; i < 9; i++) {
    // Copy the loop variable to avoid javascript lambda-in-loop bug
    ;((i) => {
      if (videos.length <= i) return
      var videoImg = document.createElement('img')
      videoGrid.appendChild(videoImg)
      videoImg.title = videos[i].title
      videoImg.src = videos[i].preview_hover
      videoImg.style = 'width: 320px; height: 180px; object-fit: cover; object-position: top; cursor: pointer'
      videoImg.onclick = function() {
        videoGrid.remove()
        loadVideos(playerId, [videos[i]], TWITCH)
      }
    })(i)
  }
}

var players = new Map()
function loadVideos(playerId, videos, playerType) {
  document.getElementById(playerId + '-form').style.display = 'none'
  var div = document.getElementById(playerId)

  // Update displayed query params for this new video
  var params = new URLSearchParams(window.location.search)
  params.set(div.id, videos.map(v => v.id).join('-'))
  history.pushState(null, null, '?' + params.toString())

  var player = window.newPlayer(div.id, videos, playerType)
  players.set(div.id, player)
  if (params.has('offset' + div.id)) {
    player.offset = parseInt(params.get('offset' + div.id))
  }

  player.onready = (thisPlayer) => {
    console.log(thisPlayer.id, 'has loaded')
    reloadTimeline() // Note: This will get called several times in a row if we're loading multiple videos from query params. Whatever.

    // Check to see if we're the last player to load (from initial load)
    thisPlayer.state = READY

    var anyVideoStillLoading = false
    var anyVideoIsPlaying = false
    var anyVideoIsPaused = false
    var anyVideoInAsync = false
    for (var player of players.values()) {
      if (player == thisPlayer) continue
      if (player.state === LOADING) anyVideoStillLoading = true
      if (player.state === PLAYING || player.state === SEEKING_PLAY)  anyVideoIsPlaying = true
      if (player.state === PAUSED  || player.state === SEEKING_PAUSE) anyVideoIsPaused = true
      if (player.state === ASYNC) anyVideoInAsync = true
      // If there is a video BEFORE_START (or AFTER_END) at this point, treat it like READY,
      // so that we resync all videos to a shared, valid startpoint
    }

    if (anyVideoInAsync) {
      console.log(thisPlayer.id, 'loaded while another video was async, putting it into async too')
      thisPlayer.state = ASYNC
    } else if (anyVideoIsPlaying) {
      console.log(thisPlayer.id, 'loaded while another video was playing, syncing to others and starting')
      var timestamp = getAveragePlayerTimestamp()
      thisPlayer.seekTo(timestamp, PLAYING)
    } else if (anyVideoIsPaused) {
      console.log(thisPlayer.id, 'loaded while all other videos were paused, resyncing playhead')
      // Try to line up with the other videos' sync point if possible, but if it's out of range we probably were just manually loaded later,
      // and should pick a sync time that works for all videos.
      var timestamp = getAveragePlayerTimestamp()
      if (timestamp < thisPlayer.startTime) timestamp = thisPlayer.startTime
      seekPlayersTo(timestamp, PAUSED)
    } else if (!anyVideoStillLoading) {
      // If we loaded from a race, sync all videos to the race start
      var syncTo = raceStartTime || 0

      // Otherwise, sync all videos to the latest startTime (i.e. the earliest valid time for all videos).
      if (syncTo == 0) {
        for (var player of players.values()) {
          if (player.startTime > syncTo) syncTo = player.startTime
        }
      }
      console.log(thisPlayer.id, 'was last to load, syncing all videos to', syncTo)
      window.setTimeout(() => seekPlayersTo(syncTo, PAUSED), 1000)
    }
  }
}

// Mirror of getTwitchVideosDetails(videoIds), except it doesn't need Twitch auth (and so has a bunch of stub/fake data)
function getStubVideosDetails(videoIds) {
  var videosDetails = []
  for (videoId of videoIds) {
    videosDetails.push({
      'id': videoId,
      'startTime': ASYNC_ALIGN,
      'endTime': null,
    })
  }
  return Promise.resolve(videosDetails) // We need to return a promise to match the behavior of the other code.
}

var raceStartTime = null
function loadRace(raceDetails) {
  raceStartTime = raceDetails.startTime

  // We load a video from the race for each player which is visible (down to a minimum of 4).
  // This means the user can add more placeholders before loading a race to request more videos out of it.
  // However, we won't overwrite any already-loaded videos (e.g. if the user already has an async loaded up).
  var videosToLoad = Math.max(4, document.getElementById('players').childElementCount) - players.size

  // Add the race URL to the query params in case we haven't done twitch auth yet;
  // we might get redirected to twitch while loading videos and lose the race details.
  var params = new URLSearchParams(window.location.search)
  params.set('race', raceDetails.url)
  history.pushState(null, null, '?' + params.toString())

  loadRaceVideos(raceDetails, videosToLoad)
  .then(videos => {
    if (videos.length === 0) {
      console.error('Failed to load any videos from race', raceDetails.url)
      return
    }

    // Now that all the videos are loaded, drop the race from the URL.
    var params = new URLSearchParams(window.location.search)
    params.delete('race')
    history.pushState(null, null, '?' + params.toString())

    if (FEATURES.SHUFFLE_RACE_VIDEOS) {
      // Shuffle the videos so we don't know who was first by position
      // https://stackoverflow.com/a/46545530
      videos = videos
        .map(value => ({ value, sort: Math.random() }))
        .sort((a, b) => a.sort - b.sort)
        .map(({ value }) => value)
    }

    var i = 0
    while (videos.length > 0) {
      var playerId = 'player' + i
      if (!players.has(playerId)) {
        while (document.getElementById(playerId) == null) window.addPlayer()
        loadVideos(playerId, [videos.shift()], TWITCH)
      }
      i++
    }
  })
}

// TODO: make some kind of github report out of the event log, like Presently does
// I should also include the URL (which contains the videos) + all video positions at time of submission.
// https://github.com/jbzdarkid/Presently/blob/master/settings.js#L79
// I mean I could do that, but it's also totally reasonable to just use this for my tests. I'd rather have really stable code than a bug tracker.
var eventLog = []
var console_log = console.log
console.log = function(...args) {
  var logEvent = [new Date().toISOString(), ...args]
  eventLog.push(logEvent.join('\t'))
  if (location.hostname == 'localhost') console_log(logEvent.join(' ')) // Also emit to console in local testing for easier debugging
}

var pendingSeekTimestamp = 0 // Will be nonzero after a seek, returns to zero once all videos have finished seeking
function seekPlayersTo(timestamp, targetState, exceptFor) {
  console.log('Seeking all players to', timestamp, 'and state', targetState, (exceptFor != null ? 'except for ' + exceptFor.id : null))
  pendingSeekTimestamp = timestamp
  for (var player of players.values()) {
    if (player.state === LOADING) continue // We cannot seek a video that hasn't loaded yet.
    if (player.id == exceptFor) {
      player.state = targetState
      continue
    }
    player.seekTo(timestamp, targetState)
  }
}

function getTimelineBounds() {
  var timelineStart = Number.POSITIVE_INFINITY
  var timelineEnd = Number.NEGATIVE_INFINITY
  for (var player of players.values()) {
    if (player.startTime < timelineStart) timelineStart = player.startTime
    if (player.endTime > timelineEnd) timelineEnd = player.endTime
  }

  return [timelineStart, timelineEnd]
}

// In some cases, we may want to know what the current playing position is (as opposed to the most recent seek)
function getAveragePlayerTimestamp() {
  var sum = 0
  var count = 0
  for (var player of players.values()) {
    // We only care about the timestamp of videos which are synced up
    if (player.state === PLAYING || player.state === PAUSED) {
      sum += player.getCurrentTimestamp()
      count += 1
    }
  }

  if (count === 0) return null
  return sum / count
}

const TIMELINE_COLORS = ['#aaf', '#faa', '#afa', '#aff', '#faf', '#ffa']
const TIMELINE_DATE_FORMAT = new Intl.DateTimeFormat({}, {'dateStyle': 'short', 'timeStyle': 'short'})
function reloadTimeline() {
  var timeline = document.getElementById('timeline')
  if (timeline != null) timeline.remove()
  if (players.size === 0) {
    document.title = 'Twitch VOD Sync'
    return // If there are no active videos, there's no need to show a timeline
  }

  var streamers = []
  for (var player of players.values()) {
    if (player.streamer != null) streamers.push(player.streamer)
  }
  document.title = 'TVS: ' + streamers.join(' vs ')

  timeline = document.createElement('div')
  document.getElementById('app').appendChild(timeline)
  timeline.id = 'timeline'
  timeline.style = 'position: relative; display: flex'

  var remove = document.createElement('button')
  timeline.appendChild(remove)
  remove.style = 'width: 1.5em; height: 1.5em; border: 0'
  remove.innerText = '-'
  remove.addEventListener('pointerdown', () => removePlayer())

  var labels = document.createElement('div')
  timeline.appendChild(labels)
  labels.style = 'position: relative; display: flex; width: 100%; justify-content: space-between; margin: 0px 1px 0px 1px'

  var add = document.createElement('button')
  timeline.appendChild(add)
  add.style = 'width: 1.5em; height: 1.5em; border: 0'
  add.innerText = '+'
  add.addEventListener('pointerdown', () => window.addPlayer())

  var graphic = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  labels.appendChild(graphic)
  graphic.setAttribute('class', 'timeline-bg')
  graphic.style = 'position: absolute; width: 100%; height: 100%; z-index: -1'

  var [timelineStart, timelineEnd] = getTimelineBounds()
  var rowHeight = 100.0 / players.size
  var i = 0
  for (var player of players.values()) {
    var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    graphic.appendChild(rect)
    rect.setAttribute('fill', TIMELINE_COLORS[i % TIMELINE_COLORS.length])
    rect.setAttribute('height', rowHeight + '%')
    rect.setAttribute('y', i * rowHeight + '%')

    var start = 100.0 * (player.startTime - timelineStart) / (timelineEnd - timelineStart)
    var end = 100.0 * (player.endTime - timelineStart) / (timelineEnd - timelineStart)
    if (FEATURES.HIDE_ENDING_TIMES) end = 100.0 // Hide who won by right-justifying all video endings
    rect.setAttribute('x', start + '%')
    rect.setAttribute('width', (end - start) + '%')

    i++
  }

  var cursor = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  graphic.appendChild(cursor)
  cursor.id = 'timelineCursor'
  cursor.setAttribute('height', '100%')
  cursor.setAttribute('width', '2px')
  cursor.setAttribute('fill', 'black')

  var startLabel = document.createElement('div')
  labels.appendChild(startLabel)
  startLabel.style = 'margin-left: 3px'
  startLabel.innerText = new Date(timelineStart).toLocaleString(TIMELINE_DATE_FORMAT)

  var currentLabel = document.createElement('div')
  currentLabel.id = 'timelineCurrent'
  labels.appendChild(currentLabel)

  var endLabel = document.createElement('div')
  labels.appendChild(endLabel)
  endLabel.id = 'timelineEnd'
  endLabel.style = 'margin-right: 3px'
  endLabel.innerText = new Date(timelineEnd).toLocaleString(TIMELINE_DATE_FORMAT)
}

function refreshTimeline() {
  var timestamp = pendingSeekTimestamp > 0 ? pendingSeekTimestamp : getAveragePlayerTimestamp()
  if (timestamp == null) return // No videos are ready, leave the cursor where it is

  var [timelineStart, timelineEnd] = getTimelineBounds()

  var cursor = document.getElementById('timelineCursor')
  var perc = 100.0 * (timestamp - timelineStart) / (timelineEnd - timelineStart)
  if (cursor != null) cursor.setAttribute('x', perc + '%')

  var currentLabel = document.getElementById('timelineCurrent')
  if (currentLabel != null) currentLabel.innerText = new Date(timestamp).toLocaleString(TIMELINE_DATE_FORMAT)

  // With Twitch auth disabled, we only know the start times from the query params -- the end times are determined at runtime,
  // when the videos start playing. This means we need to update the timeline once the videos start playing.
  if (!FEATURES.DO_TWITCH_AUTH) {
    var endLabel = document.getElementById('timelineEnd')
    if (endLabel != null) endLabel.innerText = new Date(timelineEnd).toLocaleString(TIMELINE_DATE_FORMAT)
  }

  // This is also a convenient moment to check if any players are waiting to start because we seeked before their starttime.
  for (var player of players.values()) {
    if (player.state === BEFORE_START && timestamp >= player.startTime) {
      console.log(player.id, 'was waiting to start, and the current timestamp just passed its startpoint, so we started it')
      player.state = PLAYING
      player.play()
    }
  }
}
