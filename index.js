var FEATURES = {
  'HIDE_ENDING_TIMES': true,
}

// Player states
const LOADING       = 0
const READY         = 1
const SEEKING_PLAY  = 2
const PLAYING       = 3
const SEEKING_PAUSE = 4
const PAUSED        = 5
const BEFORE_START  = 6
const AFTER_END     = 7

var MIN_PLAYERS = 1
var MAX_PLAYERS = 4
window.onload = function() {
  // There's a small chance we didn't get a 'page closing' event fired, so if this setting is still set and we have a token,
  // delete the localstorage so we show the prompt again.
  if (window.localStorage.getItem('authPrefs') == 'neverSave' && window.localStorage.getItem('twitchAuthToken') != null) {
    window.localStorage.clear()

    // Normal lifecycle has a pagehide event fire before the window closes. While this is not guaranteed to fire on mobile,
    // (A) this app sucks on mobile and (B) I don't want to clear tokens just because you tabbed away from the page.
    // Note that we only add this listener if 'neverSave' was set on page load, otherwise we clear preferences as we do the twitch redirect,
    // and don't save the fact that the user doesn't want us to persist their token.
    window.addEventListener('pagehide', (event) => {
      if (event.persisted) return // Page is being disabled but only temporarily, no need to clean up
      if (window.localStorage.getItem('authPrefs') == 'neverSave') window.localStorage.clear()
    })
  }

  var authToken = null
  if (window.location.hash != null && window.location.hash.length > 1) {
    var params = new URLSearchParams(window.location.hash.substring(1))
    authToken = params.get('access_token')
    window.localStorage.setItem('twitchAuthToken', authToken)
    window.location.hash = ''
  } else {
    authToken = window.localStorage.getItem('twitchAuthToken')
  }

  if (authToken == null) {
    showTwitchRedirect()
    return
  }

  setTwitchTokenHeader(authToken)

  // Once auth is sorted out, load any videos from the query parameters (or the stashed parameters).
  var params = null;
  if (window.localStorage.getItem('queryParams') != null) {
    params = new URLSearchParams(window.localStorage.getItem('queryParams'))
    window.localStorage.removeItem('queryParams')
  } else {
    params = new URLSearchParams(window.location.search)
  }
  window.addPlayer()
  window.addPlayer()

  for (var i = 0; i < MAX_PLAYERS; i++) {
    // Copy the loop variable to avoid javascript lambda-in-loop bug
    ;((i) => {
      if (params.has('player' + i)) {
        var player = document.getElementById('player' + i)
        while (player == null) {
          window.addPlayer()
          player = document.getElementById('player' + i)
        }

        playerVideos.set(player.id, {'state': LOADING}) // Small placeholder to indicate that we're still loading
        var form = player.getElementsByTagName('form')[0]
        var videoId = params.get('player' + i)
        getVideoDetails(videoId)
        .then(videoDetails => loadVideo(form, videoDetails))
        .catch(r => {
          var error = player.getElementsByTagName('div')[0]
          error.innerText = 'Could not process video "' + videoId + '":\n' + r
          error.style.display = null
        })
      }
    })(i)
  }

  window.addEventListener('resize', resizePlayers)

  // Auto-update the timeline cursor so it moves properly while the video is playing
  window.setInterval(() => {
    var timestamp = getAverageVideoTimestamp()
    var cursor = document.getElementById('timelineCursor')
    var label = document.getElementById('timelineCurrent')

    if (timestamp == null) {
      if (cursor != null) cursor.style.display = 'none'
      if (label != null) label.style.display = 'none'
    } else {
      if (cursor != null) cursor.style.display = null
      if (label != null) label.style.display = null

      var [timelineStart, timelineEnd] = getTimelineBounds()
      var perc = 100.0 * (timestamp - timelineStart) / (timelineEnd - timelineStart)
      if (cursor != null) cursor.setAttribute('x', perc + '%')

      if (label) label.innerText = new Date(timestamp).toLocaleString(TIMELINE_DATE_FORMAT)
    }

    for (var video of playerVideos.values()) {
      if (video.state == BEFORE_START && timestamp >= video.startTime) {
        video.player.play()
      }
    }
  }, 100)

  // Handle space, left, and right as global listeners, in case you don't actually have a stream selected
  // Each of these just calls an event (play, pause, seek) on one of the players, so it'll fall through into the default handler.
  document.addEventListener('keydown', (event) => {
    var firstPlayingVideo = null
    var firstPausedVideo = null
    for (var otherVideo of playerVideos.values()) {
      if (otherVideo.state == PLAYING || otherVideo.state == SEEKING_PLAY) {
        if (firstPlayingVideo == null) firstPlayingVideo = otherVideo
      } else if (otherVideo.state == PAUSED || otherVideo.state == SEEKING_PAUSE) {
        if (firstPausedVideo == null) firstPausedVideo = otherVideo
      }
    }
    if (event.key == ' ') {
      if (firstPlayingVideo != null) {
        firstPlayingVideo.player.pause()
      } else if (firstPausedVideo != null) {
        firstPausedVideo.player.play()
      }
    /* TODO: Seems like the twitch player isn't updating getCurrentTime when I seek_paused. Eesh.
    } else if (event.key == 'ArrowLeft') {
      var firstVideo = firstPlayingVideo || firstPausedVideo
      if (firstVideo != null) {
        var duration = firstVideo.player.getCurrentTime()
        firstVideo.player.seek(duration - 10)
      }
    } else if (event.key == 'ArrowRight') {
      var firstVideo = firstPlayingVideo || firstPausedVideo
      if (firstVideo != null) {
        var duration = firstVideo.player.getCurrentTime()
        firstVideo.player.seek(duration + 10)
      }
    */
    }
  })
}

function addPlayer() {
  var players = document.getElementById('players')
  if (players.childElementCount >= MAX_PLAYERS) return

  var newPlayer = document.createElement('div')
  newPlayer.id = 'player' + players.childElementCount
  players.appendChild(newPlayer)
  newPlayer.style = 'flex: 1 0 50%; display: flex; flex-direction: column; justify-content: center; align-items: center'

  var form = document.createElement('form')
  newPlayer.appendChild(form)
  form.addEventListener('submit', searchVideo)

  var textInput = document.createElement('input')
  form.appendChild(textInput)
  textInput.setAttribute('type', 'text')
  textInput.setAttribute('name', 'video')
  textInput.setAttribute('placeholder', 'Twitch video URL')

  var submit = document.createElement('input')
  form.appendChild(submit)
  submit.setAttribute('type', 'submit')
  submit.setAttribute('value', 'Watch')

  var error = document.createElement('div')
  newPlayer.appendChild(error)
  error.style = 'color: red; padding: 10px; display: none'

  resizePlayers()
}

function removePlayer() {
  var players = document.getElementById('players')

  var lastPlayer = players.childNodes[players.childElementCount - 1]
  if (playerVideos.has(lastPlayer.id)) {
    playerVideos.delete(lastPlayer.id)
    reloadTimeline()

    // Update displayed query params to remove this video
    var params = new URLSearchParams(window.location.search);
    params.delete(lastPlayer.id)
    history.pushState(null, null, '?' + params.toString())

    lastPlayer.remove()
    addPlayer() // If there was a video, the '-' button just resets it back to the picker
  } else if (players.childElementCount > MIN_PLAYERS) {
    lastPlayer.remove() // Otherwise, it removes the entire box
    resizePlayers()
  }
}

function resizePlayers() {
  var players = document.getElementById('players')

  var aspectRatio = 16.0 / 9.0 // Aspect ratio of twitch videos

  // Test all row counts (full horizontal through full vertical) to determine the one which fits the most videos.
  var bestNorm = 0
  var perColumn = 1
  for (var rows = 1; rows <= players.childElementCount; rows++) {
    // Compute the maximum possible size of each player
    var cols = Math.ceil(players.childElementCount / rows)
    var width = players.clientWidth / cols
    var height = players.clientHeight / rows

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

  // We actually care about the width of each player (for flex purposes), not the number of rows -- flexbox will do that for us.

  var players = document.getElementById('players')
  for (var player of players.childNodes) {
    player.style.flexBasis = 100 / perColumn + '%' // Note: I'm using integer division here so that we don't have float rounding issues.
  }
}

const VIDEO_ID_MATCH =   /^(?:https?:\/\/(?:www\.|m\.)?twitch\.tv\/videos\/)?([0-9]+)(?:\?.*)?$/
const CHANNEL_ID_MATCH = /^(?:https?:\/\/(?:www\.|m\.)?twitch\.tv\/)?([a-zA-Z0-9]\w+)\/?(?:\?.*)?$/
function searchVideo(event) {
  event.preventDefault()

  var form = event.target
  var error = form.parentElement.getElementsByTagName('div')[0]
  error.style.display = 'none'
  error.innerText = ''

  // First, check to see if the user provided a direct video link
  var m = form.elements['video'].value.match(VIDEO_ID_MATCH)
  if (m != null) {
    getVideoDetails(m[1])
    .then(videoDetails => loadVideo(form, videoDetails))
    .catch(r => {
      error.innerText = 'Could not process video "' + m[1] + '":\n' + r
      error.style.display = null
    })
    return
  }

  // Otherwise, check to see if it's a channel (in which case we can look for a matching video)
  m = form.elements['video'].value.match(CHANNEL_ID_MATCH)
  if (m != null) {
    getChannelVideos(m[1])
    .then(videos => {
      var [timelineStart, timelineEnd] = getTimelineBounds()
      var bestVideo = null
      for (var video of videos) {
        // We are looking for two videos which have any overlap.
        // Determine which started first -- our video or the timeline.
        // Then, check to see if that video contains the timestamp of the other video's start.
        if ((timelineStart <= video.startTime && video.startTime <= timelineEnd)
          || (video.startTime <= timelineStart && timelineStart <= video.endTime)) {
          if (bestVideo == null || video.startTime < bestVideo.startTime) bestVideo = video
        }
      }

      if (bestVideo == null) return Promise.reject('Could not find any videos which overlap the current timeline')
      loadVideo(form, bestVideo)
    })
    .catch(r => {
      error.innerText = 'Could not process channel "' + m[1] + '":\n' + r
      error.style.display = null
    })
    return
  }

  error.innerText = 'Could not parse video or channel name from input'
  error.style.display = null
}

var playerVideos = new Map()
function loadVideo(form, videoDetails) {
  form.style.display = 'none'
  var div = form.parentElement

  // Update displayed query params for this new video
  var params = new URLSearchParams(window.location.search);
  params.set(div.id, videoDetails.id) 
  history.pushState(null, null, '?' + params.toString())

  var options = {
    width: '100%',
    height: '100%',
    video: videoDetails.id,
    autoplay: false,
    muted: true,
  }
  var player = new Twitch.Player(div.id, options)
  videoDetails['player'] = player
  videoDetails['state'] = LOADING
  playerVideos.set(div.id, videoDetails)
  reloadTimeline() // Note: This will get called several times in a row in loadVideo. Whatever.

  player.addEventListener('ready', () => {
    var playerId = div.id
    var video = playerVideos.get(playerId)
    console.log('vodsync', playerId, 'has loaded')

    // Only hook events once the player has loaded, so we don't have to worry about interactions during loading.
    video.player.addEventListener('seek', (eventData) => twitchEvent('seek', playerId, eventData))
    video.player.addEventListener('play', () => twitchEvent('play', playerId))
    video.player.addEventListener('pause', () => twitchEvent('pause', playerId))
    video.player.addEventListener('ended', () => twitchEvent('ended', playerId))

    // TODO: Consider doing another last-past-the-post sync up when we get a 'playing' event?
    // video.player.addEventListener('playing', () => twitchEvent('playing', playerId))
    // TODO: Test video buffering, somehow.

    // Check to see if we're the last player to load (from initial load)
    video.state = READY

    var anyVideoStillLoading = false
    var anyVideoIsPlaying = false
    var anyVideoIsPaused = false
    for (var otherVideo of playerVideos.values()) {
      if (otherVideo == video) continue
      if (otherVideo.state == LOADING) anyVideoStillLoading = true
      if (otherVideo.state == PLAYING || otherVideo.state == SEEKING_PLAY)  anyVideoIsPlaying = true
      if (otherVideo.state == PAUSED  || otherVideo.state == SEEKING_PAUSE) anyVideoIsPaused = true
      // If there is a video BEFORE_START (or AFTER_END) at this point, treat it like READY,
      // so that we resync all videos to a shared, valid startpoint
    }

    if (anyVideoIsPlaying) {
      console.log('vodsync', playerId, 'loaded while another video was playing, syncing to others and starting')
      var timestamp = getAverageVideoTimestamp()
      seekVideoTo(timestamp, 'play')
    } else if (anyVideoIsPaused) {
      console.log('vodsync', playerId, 'loaded while another video was paused, syncing to others')
      // Try to line up with the other videos' sync point if possible, but if it's out of range we probably were just manually loaded later,
      // and should pick a sync time that works for all videos.
      var timestamp = getAverageVideoTimestamp()
      if (timestamp < video.startTime) timestamp = video.startTime
      seekVideoTo(timestamp, 'pause')
    } else if (!anyVideoStillLoading) {
      // If nobody is playing or paused, and everyone is done loading (we're last to load), then sync all videos to the earliest timestamp.
      var earliestSync = Number.MIN_VALUE
      for (var otherVideo of playerVideos.values()) {
        if (otherVideo.startTime > earliestSync) earliestSync = otherVideo.startTime
      }
      console.log('vodsync', playerId, 'was last to load, syncing all videos to', earliestSync)
      seekVideosTo(earliestSync, 'pause')
    }
  })
}

function seekVideosTo(timestamp, playOrPause) {
  for (var video of playerVideos.values()) seekTo(video, timestamp, playOrPause)
}

function seekTo(video, timestamp, playOrPause) {
  if (timestamp < video.startTime) {
    var durationSeconds = 0.001
    video.state = BEFORE_START
    video.player.pause()
    video.player.seek(durationSeconds)
  } else if (timestamp >= video.endTime) {
    // Once a video has ended, 'play' is the only way to interact with it automatically.
    // After this, twitch will issue a seek to the beginning then a play command (which we handle later).
    video.state = AFTER_END // TODO: The twitch player seems to behave oddly after this event... I may need to remove and recreate the player entity. Yikes.
    video.player.play()
  } else {
    var durationSeconds = (timestamp - video.startTime) / 1000.0
    if (durationSeconds == 0) durationSeconds = 0.001 // I think seek(0) does something wrong, so.

    if (playOrPause == 'pause') {
      video.state = SEEKING_PAUSE
      video.player.pause()
      video.player.seek(durationSeconds)
    } else if (playOrPause == 'play') {
      video.state = SEEKING_PLAY
      video.player.seek(durationSeconds)
      video.player.play()
    }
  }
}

function twitchEvent(event, playerId, data) {
  var video = playerVideos.get(playerId)
  var stateStr = 'loading,ready,seeking_play,playing,seeking_pause,paused,before_start,after_end'.split(',')[video.state]
  console.log('vodsync', 'raw', playerId, stateStr, event)

  if (event == 'seek') {
    switch (video.state) {
      // These two states are expected to have a seek event based on automatic seeking actions,
      // so even though it could be a user action we ignore it since it's unlikely.
      case SEEKING_PAUSE:
        video.state = PAUSED
        break
      case SEEKING_PLAY:
        video.state = PLAYING
        break
      case BEFORE_START: // Also set by automation (and followed by a seek event)
      case AFTER_END: // Also set by automation (and followed by a seek event)
        break

      // All other states indicate the user manually seeking the video.
      case PLAYING:
      case PAUSED:
      case READY: // If we're still waiting for some other video to load (but this one is ready), treat it like PAUSED.
        console.log('vodsync', 'User has manually seeked', playerId, 'seeking all other players')
        var targetDuration = data.position // Note that the seek position comes from the javascript event's data
        var timestamp = video.startTime + Math.floor(targetDuration * 1000)
        seekVideosTo(timestamp, (video.state == PLAYING ? 'play' : 'pause'))
        break
    }
  } else if (event == 'play') {
    switch (video.state) {
      case PAUSED: // If the user manually starts a fully paused video, sync all other videos to it.
      case READY: // A manual play on a 'ready' video (before other players have loaded)
      case BEFORE_START: // If the user attempts to play a video that's waiting at the start, just sync everyone to this. (TODO: more testing needed)
        console.log('vodsync', 'User has manually started', playerId, 'starting all players')
        var currentDuration = video.player.getCurrentTime()
        var timestamp = video.startTime + Math.floor(currentDuration * 1000)
        seekVideosTo(timestamp, 'play')
        break

      case SEEKING_PAUSE: // However, if the video is currently seeking, we don't know its seek target, so we just swap to SEEKING_PLAY
        console.log('vodsync', 'User has manually started', playerId, 'while it was seeking_paused, switching to seeking_play')
        for (var otherVideo of playerVideos.values()) {
          // Most commonly, all other videos will also be SEEKING_PAUSE (as part of the seekTo).
          if (otherVideo.state == SEEKING_PAUSE) {
            otherVideo.state = SEEKING_PLAY
            otherVideo.player.play()

          // It is possible that some of them have finished seeking (and are in PAUSED)
          // or that we are loading into a paused state, in which case all other videos are PAUSED.
          // In either case, resume those videos as they are already at the right spot.
          } else if (otherVideo.state == PAUSED) {
            otherVideo.state = PLAYING
            otherVideo.player.play()
          }

          // If a video seeked already and found BEFORE_START or AFTER_END, no further action is needed.
        }
        break

      case AFTER_END: // Indicates that we've restarted playback after reaching the end of the video.
        var durationSeconds = (timestamp - video.startTime) / 1000.0
        video.player.pause()
        break

      case SEEKING_PLAY: // Unexpected (?) but no action needed.
      case PLAYING: // Should be impossible.
        console.log('vodsync', 'Unhandled case', playerId, event, video.state)
        break
    }
  } else if (event == 'pause') {
    switch (video.state) {
      case SEEKING_PLAY:
      case PLAYING:
        console.log('vodsync', 'User has manually paused', playerId, 'while it was playing, pausing all other players')
        // When the user clicks outside of the player's buffer, twitch issues 'pause', 'seek', and then 'play' events.
        // Unfortunately, the first of these events (pause) looks identical to the user just pausing the player.
        // As a result, we just pause all videos, which will cause twitch to only issue a 'seek', not a 'play'.
        // This results in all videos doing a SEEKING_PAUSE, which is fairly close to the user's intent anyways.
        for (var otherVideo of playerVideos.values()) {
          if (otherVideo.state == SEEKING_PLAY) otherVideo.state = SEEKING_PAUSE
          if (otherVideo.state == PLAYING)      otherVideo.state = PAUSED
          otherVideo.player.pause()
        }
        break

      // Should be impossible in all other cases, since the player is already paused.
      case READY:
      case SEEKING_PAUSE:
      case PAUSED:
      case AFTER_END: // Fired when the player is automatically paused after reaching end of VOD
      case BEFORE_START:
        console.log('vodsync', 'Unhandled case', playerId, event, video.state)
        break
    }
  } else if (event == 'ended') {
    switch (video.state) {
      case PLAYING: // I *think* this is the only valid case, but SEEKING_PLAY might also be possible?
        seekTo(video, video.endTime, 'pause')
        break

      case READY:
      case SEEKING_PAUSE:
      case PAUSED:
      case SEEKING_PLAY:
      case BEFORE_START:
      case AFTER_END:
        console.log('vodsync', 'Unhandled case', playerId, event, video.state)
        break
    }
  }
}

function getTimelineBounds() {
  var timelineStart = Number.MAX_VALUE
  var timelineEnd = Number.MIN_VALUE
  for (var video of playerVideos.values()) {
    if (video.startTime < timelineStart) timelineStart = video.startTime
    if (video.endTime > timelineEnd) timelineEnd = video.endTime
  }

  return [timelineStart, timelineEnd]
}

// Returns a timestamp (milliseconds since epoch) of the average of all videos.
function getAverageVideoTimestamp() {
  var sum = 0
  var count = 0
  for (var video of playerVideos.values()) {
    // We only care about the timestamp of videos which are synced.
    if (video.player != null && [SEEKING_PLAY, PLAYING, SEEKING_PAUSE, PAUSED].includes(video.state)) {
      var currentDuration = video.player.getCurrentTime()
      sum += video.startTime + Math.floor(currentDuration * 1000)
      count += 1
    }
  }

  if (count == 0) return null

  return sum / count
}

var TIMELINE_COLORS = ['#aaf', '#faa', '#afa', '#aff', '#faf', '#ffa']
var TIMELINE_DATE_FORMAT = new Intl.DateTimeFormat({}, {'dateStyle': 'short', 'timeStyle': 'short'})
function reloadTimeline() {
  var timeline = document.getElementById('timeline')
  if (timeline != null) timeline.remove()
  if (playerVideos.size == 0) {
    document.title = 'Twitch VOD Sync'
    return // If there are no active videos, there's no need to show a timeline
  }

  var streamers = []
  for (var i = 0; i < MAX_PLAYERS; i++) {
    if (!playerVideos.has('player' + i)) continue
    var streamer = playerVideos.get('player' + i).streamer
    if (streamer != null) streamers.push(streamer)
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
  add.addEventListener('pointerdown', () => addPlayer())

  var graphic = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  labels.appendChild(graphic)
  graphic.setAttribute('class', 'timeline-bg')
  graphic.style = 'position: absolute; width: 100%; height: 100%; z-index: -1'

  var [timelineStart, timelineEnd] = getTimelineBounds()
  var rowHeight = 100.0 / playerVideos.size
  for (var i = 0; i < MAX_PLAYERS; i++) {
    if (!playerVideos.has('player' + i)) continue
    var videoDetails = playerVideos.get('player' + i)

    var rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
    graphic.appendChild(rect)
    rect.setAttribute('fill', TIMELINE_COLORS[i])
    rect.setAttribute('height', rowHeight + '%')
    rect.setAttribute('y', i * rowHeight + '%')

    var start = 100.0 * (videoDetails.startTime - timelineStart) / (timelineEnd - timelineStart)
    var end = 100.0 * (videoDetails.endTime - timelineStart) / (timelineEnd - timelineStart)
    if (FEATURES.HIDE_ENDING_TIMES) end = 100.0 // Hide who won by right-justifying all video endings 
    rect.setAttribute('x', start + '%')
    rect.setAttribute('width', (end - start) + '%')
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
  endLabel.style = 'margin-right: 3px'
  endLabel.innerText = new Date(timelineEnd).toLocaleString(TIMELINE_DATE_FORMAT)
}

