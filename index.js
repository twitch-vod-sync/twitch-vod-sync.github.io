var FEATURES = {
  'HIDE_ENDING_TIMES': true,
  'MAX_PLAYERS': 6,
}

var MIN_PLAYERS = 1
var ASYNC_ALIGN = 1500000000000 // An arbitrary timestamp where we align videos while async-ing. Still considerably lower than Number.MAX_SAFE_INTEGER.
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

  for (var i = 0; i < FEATURES.MAX_PLAYERS; i++) {
    // Copy the loop variable to avoid javascript lambda-in-loop bug
    ;((i) => {
      if (params.has('player' + i)) {
        var playerElem = document.getElementById('player' + i)
        while (playerElem == null) {
          window.addPlayer()
          playerElem = document.getElementById('player' + i)
        }

        players.set(playerElem.id, new Player())
        var form = playerElem.getElementsByTagName('form')[0]
        var videoId = params.get('player' + i)
        getVideoDetails(videoId)
        .then(videoDetails => loadVideo(form, videoDetails))
        .catch(r => {
          var error = playerElem.getElementsByTagName('div')[0]
          error.innerText = 'Could not process video "' + videoId + '":\n' + r
          error.style.display = null
        })
      }
    })(i)
  }

  window.addEventListener('resize', resizePlayers)

  // Auto-update the timeline cursor so it moves properly while the video is playing
  window.setInterval(() => {
    var timestamp = latestSeekTarget
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

    for (var player of players.values()) {
      if (player.state == BEFORE_START && timestamp >= player.startTime) {
        player.play()
      }
    }
  }, 100)

  // Handle space, left, and right as global listeners, in case you don't actually have a stream selected
  // Each of these just calls an event (play, pause, seek) on one of the players, so it'll fall through into the default handler.
  document.addEventListener('keydown', (event) => {
    var firstPlayingVideo = null
    var firstPausedVideo = null
    var anyVideoInAsync = false
    for (var player of players.values()) {
      if (player.state == PLAYING || player.state == SEEKING_PLAY) {
        if (firstPlayingVideo == null) firstPlayingVideo = player
      } else if (player.state == PAUSED || player.state == SEEKING_PAUSE) {
        if (firstPausedVideo == null) firstPausedVideo = player
      } else if (player.state == ASYNC) {
        anyVideoInAsync = true
      }
    }

    // Spacebar pauses (if anyone is playing) or plays (if everyone is paused)
    // Left and right seek based on the location of the first video (assuming any video is loaded)
    if (firstPlayingVideo != null) {
      if (event.key == ' ') firstPlayingVideo.pause()
      if (event.key == 'ArrowLeft')  seekPlayersTo(firstPlayingVideo.getCurrentTimestamp() - 10000, 'play')
      if (event.key == 'ArrowRight') seekPlayersTo(firstPlayingVideo.getCurrentTimestamp() + 10000, 'play')
    } else if (firstPausedVideo != null) {
      if (event.key == ' ') firstPausedVideo.play()
      if (event.key == 'ArrowLeft')  seekPlayersTo(firstPausedVideo.getCurrentTimestamp() - 10000, 'pause')
      if (event.key == 'ArrowRight') seekPlayersTo(firstPausedVideo.getCurrentTimestamp() + 10000, 'pause')
    }

    if (event.key == 'a') {
      // On the first press, bring all videos into 'async mode', where they can be adjusted freely.
      // We need to start by aligning all videos based on their current time.
      if (!anyVideoInAsync) {
        for (var player of players.values()) {
          player.state = ASYNC
          player.pause()

          // Initially align all videos to ASYNC_ALIGN, then the user can manually adjust relative to a known startpoint.
          var pausedTimestamp = player.getCurrentTimestamp()
          player.offset += (ASYNC_ALIGN - pausedTimestamp)
        }
        // The videos will now respond to 'seek' and 'pause' events and adjust their offsets accordingly.

      // Once the user hits 'a' again, we normalize the offsets so that the earliest video is at the "true" time,
      // so that the timeline shows something reasonable.
      } else {
        var largestOffset = -ASYNC_ALIGN
        for (var player of players.values()) {
          if (player.offset > largestOffset) largestOffset = player.offset
        }

        // Normalize offsets then save to the URL
        var params = new URLSearchParams(window.location.search);
        for (var [playerId, player] of players.entries()) {
          player.offset += largestOffset
          params.set(playerId + 'offset', player.offset)
        }
        history.pushState(null, null, '?' + params.toString())

        console.log('vodsync', 'Resuming all players after async alignment')
        for (var player of players.values()) {
          player.state = PLAYING
          player.play()
        }

        // TODO: Somehow this is showing 2009. Oops.
        reloadTimeline() // Reload now that the videos have comparable timers
      }
    }
  })
}

function addPlayer() {
  var playersDiv = document.getElementById('players')
  if (playersDiv.childElementCount >= FEATURES.MAX_PLAYERS) return

  var newPlayer = document.createElement('div')
  newPlayer.id = 'player' + playersDiv.childElementCount
  playersDiv.appendChild(newPlayer)
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
  var playersDiv = document.getElementById('players')

  var lastPlayer = playersDiv.childNodes[playersDiv.childElementCount - 1]
  if (players.has(lastPlayer.id)) {
    players.delete(lastPlayer.id)
    reloadTimeline()

    // Update displayed query params to remove this video
    var params = new URLSearchParams(window.location.search);
    params.delete(lastPlayer.id)
    params.delete(lastPlayer.id + 'offset')
    history.pushState(null, null, '?' + params.toString())

    lastPlayer.remove()
    addPlayer() // If there was a video, the '-' button just resets it back to the picker
  } else if (playersDiv.childElementCount > MIN_PLAYERS) {
    lastPlayer.remove() // Otherwise, it removes the entire box
    resizePlayers()
  }
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

  // We actually care about the width of each player (for flex purposes), not the number of rows -- flexbox will do that for us.

  var playersDiv = document.getElementById('players')
  for (var playerElem of playersDiv.childNodes) {
    playerElem.style.flexBasis = 100 / perColumn + '%' // Note: I'm using integer division here so that we don't have float rounding issues.
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

var players = new Map()
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
  var twitchPlayer = new Twitch.Player(div.id, options)
  players.set(div.id, new Player(videoDetails, twitchPlayer))
  if (params.has(div.id + 'offset')) {
    players.get(div.id).offset = parseInt(params.get(div.id + 'offset'))
  }
  reloadTimeline() // Note: This will get called several times in a row in loadVideo. Whatever.

  twitchPlayer.addEventListener('ready', () => {
    var playerId = div.id
    var thisPlayer = players.get(playerId)
    console.log('vodsync', playerId, 'has loaded')

    // Only hook events once the player has loaded, so we don't have to worry about interactions during loading.
    thisPlayer.player.addEventListener('seek', (eventData) => twitchEvent('seek', playerId, eventData))
    thisPlayer.player.addEventListener('play', () => twitchEvent('play', playerId))
    thisPlayer.player.addEventListener('pause', () => twitchEvent('pause', playerId))
    thisPlayer.player.addEventListener('ended', () => twitchEvent('ended', playerId))

    // TODO: Consider doing another last-past-the-post sync up when we get a 'playing' event?
    // thisPlayer.player.addEventListener('playing', () => twitchEvent('playing', playerId))
    // TODO: Test video buffering, somehow.

    // Check to see if we're the last player to load (from initial load)
    thisPlayer.state = READY

    var anyVideoStillLoading = false
    var anyVideoIsPlaying = false
    var anyVideoIsPaused = false
    for (var player of players.values()) {
      if (player == thisPlayer) continue
      if (player.state == LOADING) anyVideoStillLoading = true
      if (player.state == PLAYING || player.state == SEEKING_PLAY)  anyVideoIsPlaying = true
      if (player.state == PAUSED  || player.state == SEEKING_PAUSE) anyVideoIsPaused = true
      // If there is a video BEFORE_START (or AFTER_END) at this point, treat it like READY,
      // so that we resync all videos to a shared, valid startpoint
    }

    if (anyVideoIsPlaying) {
      console.log('vodsync', playerId, 'loaded while another video was playing, syncing to others and starting')
      var timestamp = latestSeekTarget
      thisPlayer.seekTo(timestamp, 'play')
    } else if (anyVideoIsPaused) {
      console.log('vodsync', playerId, 'loaded while all other videos were paused, resyncing playhead')
      // Try to line up with the other videos' sync point if possible, but if it's out of range we probably were just manually loaded later,
      // and should pick a sync time that works for all videos.
      var timestamp = latestSeekTarget
      if (timestamp < thisPlayer.startTime) timestamp = thisPlayer.startTime
      seekPlayersTo(timestamp, 'pause')
    } else if (!anyVideoStillLoading) {
      // If nobody is playing or paused, and everyone is done loading (we're last to load), then sync all videos to the earliest timestamp.
      var earliestSync = 0
      for (var player of players.values()) {
        if (player.startTime > earliestSync) earliestSync = player.startTime
      }
      console.log('vodsync', playerId, 'was last to load, syncing all videos to', earliestSync)
      seekPlayersTo(earliestSync, 'pause')
    }
  })
}

function twitchEvent(event, playerId, data) {
  var thisPlayer = players.get(playerId)
  var stateStr = 'loading,ready,seeking_play,playing,seeking_pause,paused,before_start,after_end'.split(',')[thisPlayer.state]
  console.log('vodsync', 'raw', playerId, stateStr, event)

  if (event == 'seek') {
    switch (thisPlayer.state) {
      // These two states are expected to have a seek event based on automatic seeking actions,
      // so even though it could be a user action we ignore it since it's unlikely.
      case SEEKING_PAUSE:
        thisPlayer.state = PAUSED
        break
      case SEEKING_PLAY:
        thisPlayer.state = PLAYING
        break
      case BEFORE_START: // Also set by automation (and followed by a seek event)
      case AFTER_END: // Also set by automation (and followed by a seek event)
        break

      case ASYNC: // If the videos are async'd and the user seeks, update the video's offset to match the seek.
        var seekTimestamp = thisPlayer.startTime + Math.floor(data.position * 1000)
        thisPlayer.offset += (ASYNC_ALIGN - seekTimestamp)
        break

      // All other states indicate the user manually seeking the video.
      case PLAYING:
      case PAUSED:
      case READY: // If we're still waiting for some other video to load (but this one is ready), treat it like PAUSED.
        console.log('vodsync', 'User has manually seeked', playerId, 'seeking all other players')
        var targetDuration = data.position // Note that the seek position comes from the javascript event's data
        var timestamp = thisPlayer.startTime + Math.floor(targetDuration * 1000)
        seekPlayersTo(timestamp, (thisPlayer.state == PLAYING ? 'play' : 'pause'))
        break
    }
  } else if (event == 'play') {
    switch (thisPlayer.state) {
      case PAUSED: // If the user manually starts a fully paused video, sync all other videos to it.
      case READY: // A manual play on a 'ready' video (before other players have loaded)
      case BEFORE_START: // If the user attempts to play a video that's waiting at the start, just sync everyone to this. (TODO: more testing needed)
        console.log('vodsync', 'User has manually started', playerId, 'starting all players')
        var timestamp = thisPlayer.getCurrentTimestamp()
        seekPlayersTo(timestamp, 'play')
        break

      case SEEKING_PAUSE: // However, if the video is currently seeking, we don't know its seek target, so we just swap to SEEKING_PLAY
        console.log('vodsync', 'User has manually started', playerId, 'while it was seeking_paused, switching to seeking_play')
        for (var player of players.values()) {
          // Most commonly, all other videos will also be SEEKING_PAUSE (as part of the seekTo).
          if (player.state == SEEKING_PAUSE) {
            player.state = SEEKING_PLAY
            player.play()

          // It is possible that some of them have finished seeking (and are in PAUSED)
          // or that we are loading into a paused state, in which case all other videos are PAUSED.
          // In either case, resume those videos as they are already at the right spot.
          } else if (player.state == PAUSED) {
            player.state = PLAYING
            player.play()
          }

          // If a video seeked already and found BEFORE_START or AFTER_END, no further action is needed.
        }
        break

      case AFTER_END: // Indicates that we've restarted playback after reaching the end of the video.
        var durationSeconds = (timestamp - thisPlayer.startTime) / 1000.0 // TODO: What
        thisPlayer.pause()
        break

      case ASYNC: // No action needed. The user is likely resuming the video so they can watch and sync it up.
        break

      case SEEKING_PLAY: // Unexpected (?) but no action needed.
      case PLAYING: // Should be impossible.
        console.log('vodsync', 'Unhandled case', playerId, event, thisPlayer.state)
        break
    }
  } else if (event == 'pause') {
    switch (thisPlayer.state) {
      case SEEKING_PLAY:
      case PLAYING:
        console.log('vodsync', 'User has manually paused', playerId, 'while it was playing, pausing all other players')
        // When the user clicks outside of the player's buffer, twitch issues 'pause', 'seek', and then 'play' events.
        // Unfortunately, the first of these events (pause) looks identical to the user just pausing the player.
        // As a result, we just pause all videos, which will cause twitch to only issue a 'seek', not a 'play'.
        // This results in all videos doing a SEEKING_PAUSE, which is fairly close to the user's intent anyways.
        for (var player of players.values()) {
          if (player.state == SEEKING_PLAY) player.state = SEEKING_PAUSE
          if (player.state == PLAYING)      player.state = PAUSED
          player.pause()
        }
        break

      case ASYNC: // Either the automatic pause at the start of asyncing, or the user manually paused the video to align it.
        var pausedTimestamp = thisPlayer.getCurrentTimestamp()
        thisPlayer.offset += (ASYNC_ALIGN - pausedTimestamp)
        break

      // Should be impossible in all other cases, since the player is already paused.
      case READY:
      case SEEKING_PAUSE:
      case PAUSED:
      case AFTER_END: // Fired when the player is automatically paused after reaching end of VOD
      case BEFORE_START:
        console.log('vodsync', 'Unhandled case', playerId, event, thisPlayer.state)
        break
    }
  } else if (event == 'ended') {
    switch (thisPlayer.state) {
      case PLAYING: // I *think* this is the only valid case, but SEEKING_PLAY might also be possible?
        thisPlayer.seekTo(thisPlayer.endTime, 'pause')
        break

      case ASYNC:
      case READY:
      case SEEKING_PAUSE:
      case PAUSED:
      case SEEKING_PLAY:
      case BEFORE_START:
      case AFTER_END:
        console.log('vodsync', 'Unhandled case', playerId, event, thisPlayer.state)
        break
    }
  }
}

var latestSeekTarget = null
function seekPlayersTo(timestamp, playOrPause) {
  latestSeekTarget = timestamp
  for (var player of players.values()) player.seekTo(timestamp, playOrPause)
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

var TIMELINE_COLORS = ['#aaf', '#faa', '#afa', '#aff', '#faf', '#ffa']
var TIMELINE_DATE_FORMAT = new Intl.DateTimeFormat({}, {'dateStyle': 'short', 'timeStyle': 'short'})
function reloadTimeline() {
  var timeline = document.getElementById('timeline')
  if (timeline != null) timeline.remove()
  if (players.size == 0) {
    document.title = 'Twitch VOD Sync'
    return // If there are no active videos, there's no need to show a timeline
  }

  var streamers = []
  for (var i = 0; i < FEATURES.MAX_PLAYERS; i++) {
    if (!players.has('player' + i)) continue
    var streamer = players.get('player' + i).streamer
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
  var rowHeight = 100.0 / players.size
  for (var i = 0; i < FEATURES.MAX_PLAYERS; i++) {
    if (!players.has('player' + i)) continue
    var videoDetails = players.get('player' + i)

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

