var FEATURES = {
  'HIDE_ENDING_TIMES': true,
  'MAX_PLAYERS': 6,
}

var MIN_PLAYERS = 2
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

  // Auto-update the timeline cursor and label so they stay up to date with the current videos
  window.setInterval(() => {
    var timestamp = getAveragePlayerTimestamp()
    if (timestamp == null) return // No videos are ready, leave the cursor where it is

    var [timelineStart, timelineEnd] = getTimelineBounds()

    var cursor = document.getElementById('timelineCursor')
    var perc = 100.0 * (timestamp - timelineStart) / (timelineEnd - timelineStart)
    if (cursor != null) cursor.setAttribute('x', perc + '%')

    var label = document.getElementById('timelineCurrent')
    if (label != null) label.innerText = new Date(timestamp).toLocaleString(TIMELINE_DATE_FORMAT)

    // This is also a convenient moment to check if any players are waiting to start because we seeked before their starttime.
    for (var player of players.values()) {
      if (player.state === BEFORE_START && timestamp >= player.startTime) {
        player.state = PLAYING
        player.play()
      }
    }
  }, 100)

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
      
    } else if (event.key == 'a') {
      // On the first press, bring all videos into 'async mode', where they can be adjusted freely.
      // We need to start by aligning all videos based on their current time.
      if (!anyVideoInAsync) {
        console.log('vodsync', 'Entering async mode')
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
        var largestOffset = -ASYNC_ALIGN
        for (var player of players.values()) {
          if (player.offset > largestOffset) largestOffset = player.offset
        }

        // Normalize offsets then save to the URL (to allow sharing)
        var params = new URLSearchParams(window.location.search);
        for (var [playerId, player] of players.entries()) {
          player.offset -= largestOffset
          params.set(playerId + 'offset', player.offset)
        }
        history.pushState(null, null, '?' + params.toString())

        reloadTimeline() // Reload now that the videos have comparable timers

        console.log('vodsync', 'Resuming all players after async alignment')
        for (var player of players.values()) {
          player.state = PLAYING
          player.play()
        }
      }
    } else {
      // Spacebar pauses (if anyone is playing) or plays (if everyone is paused)
      // Left and right seek based on the location of the first video (assuming any video is loaded)
      if (firstPlayingVideo != null) {
        if (event.key == ' ') firstPlayingVideo.pause()
        if (event.key == 'ArrowLeft')  seekPlayersTo(firstPlayingVideo.getCurrentTimestamp() - 10000, PLAYING)
        if (event.key == 'ArrowRight') {
          console.log('vodsync', 'arrowright', firstPlayingVideo.state, firstPlayingVideo.getCurrentTimestamp()) // TODO: I've been seeing bugs where the right arrow isn't always stepping forwards.
          seekPlayersTo(firstPlayingVideo.getCurrentTimestamp() + 10000, PLAYING)
        }
      } else if (firstPausedVideo != null) {
        if (event.key == ' ') firstPausedVideo.play()
        if (event.key == 'ArrowLeft')  seekPlayersTo(firstPausedVideo.getCurrentTimestamp() - 10000, PAUSED)
        if (event.key == 'ArrowRight') seekPlayersTo(firstPausedVideo.getCurrentTimestamp() + 10000, PAUSED)
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

  // If the form is still visible after 5 seconds, show a "help" hint about how to interact with this app.
  setTimeout(() => {
    if (form.style.display == 'none') return // Already interacted & input a video

    var help = document.createElement('div')
    newPlayer.appendChild(help)
    help.style = 'padding: 10px'
    help.className = 'body-text'
    help.innerText = 'Enter a Twitch video url to watch in sync with the others. More details in '

    var readme = document.createElement('a')
    help.appendChild(readme)
    readme.href = 'https://github.com/twitch-vod-sync/twitch-vod-sync.github.io/?tab=readme-ov-file#twitch-vod-sync'
    readme.target = '_blank'
    readme.innerText = 'the readme'
  }, 10000)

  resizePlayers()
}

function removePlayer() {
  var playersDiv = document.getElementById('players')

  // If the last player div is empty, and there's >2 players, remove the div
  var player = playersDiv.childNodes[playersDiv.childElementCount - 1]
  if (playersDiv.childElementCount > MIN_PLAYERS && !players.has(player.id)) {
    player.remove()
    resizePlayers()
    
  } else {
    // If there's two players showing, delete the first one instead
    if (!players.has(player.id)) player = playersDiv.childNodes[0]

    // Untrack the player and update the timeline
    players.delete(player.id)
    reloadTimeline()

    // Update displayed query params to remove this video
    var params = new URLSearchParams(window.location.search);
    params.delete(player.id)
    params.delete(player.id + 'offset')
    history.pushState(null, null, '?' + params.toString())

    // Remove and re-add the div to show the video picker form
    player.remove()
    addPlayer()
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

  // We only care about the width of each player (for flex purposes), not the number of rows -- flexbox will do that for us.

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
        loadVideo(form, bestVideo)
        return
      }

      // TODO: Show video picker here (works for both 'first video' and 'no overlap but I wanted async' cases.
      return Promise.reject('Could not find any videos which overlap the current timeline')
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
  var help = form.parentElement.getElementsByTagName('div')[1]
  if (help != null) help.style.display = 'none'

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
  reloadTimeline() // Note: This will get called several times in a row if we're loading multiple videos from query params. Whatever.

  twitchPlayer.addEventListener('ready', () => {
    var playerId = div.id
    var thisPlayer = players.get(playerId)
    console.log('vodsync', playerId, 'has loaded')

    // Only hook events once the player has loaded, so we don't have to worry about events in the LOADING state.
    thisPlayer.player.addEventListener('seek', (eventData) => twitchEvent('seek', playerId, eventData))
    thisPlayer.player.addEventListener('play', () => twitchEvent('play', playerId))
    thisPlayer.player.addEventListener('pause', () => twitchEvent('pause', playerId))
    thisPlayer.player.addEventListener('ended', () => twitchEvent('ended', playerId))

    // I did not end up using the 'playing' event -- for the most part, twitch pauses videos when the buffer runs out,
    // which is a sufficient signal to sync up the videos again (although they don't start playing automatically again).

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
      console.log('vodsync', playerId, 'loaded while another video was async, putting it into async too')
      thisPlayer.state = ASYNC
    } else if (anyVideoIsPlaying) {
      console.log('vodsync', playerId, 'loaded while another video was playing, syncing to others and starting')
      var timestamp = getAveragePlayerTimestamp()
      thisPlayer.seekTo(timestamp, PLAYING)
    } else if (anyVideoIsPaused) {
      console.log('vodsync', playerId, 'loaded while all other videos were paused, resyncing playhead')
      // Try to line up with the other videos' sync point if possible, but if it's out of range we probably were just manually loaded later,
      // and should pick a sync time that works for all videos.
      var timestamp = getAveragePlayerTimestamp()
      if (timestamp < thisPlayer.startTime) timestamp = thisPlayer.startTime
      seekPlayersTo(timestamp, PAUSED)
    } else if (!anyVideoStillLoading) {
      // If nobody is playing or paused, and everyone is done loading (we're last to load), then sync all videos to the earliest timestamp.
      var earliestSync = 0
      for (var player of players.values()) {
        if (player.startTime > earliestSync) earliestSync = player.startTime
      }
      console.log('vodsync', playerId, 'was last to load, syncing all videos to', earliestSync)
      seekPlayersTo(earliestSync, PAUSED)
    }
  })
}

// TODO: make some kind of github report like Presently does
// https://github.com/jbzdarkid/Presently/blob/master/settings.js#L79
var eventLog = []
function twitchEvent(event, playerId, data) {
  var thisPlayer = players.get(playerId)
  eventLog.push([new Date().getTime(), event, playerId, thisPlayer.state])

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
      case SEEKING_START:
        thisPlayer.state = BEFORE_START
        break

      case ASYNC: // If the videos are async'd and the user seeks, update the video's offset to match the seek.
        var timestamp = thisPlayer.startTime + Math.floor(data.position * 1000) // Note that the seek position comes from the javascript event's data
        thisPlayer.offset += (ASYNC_ALIGN - timestamp)
        break

      // All other states indicate the user manually seeking the video.
      case PLAYING:
      case PAUSED:
      case READY: // If we're still waiting for some other video to load (but this one is ready), treat it like PAUSED.
      case BEFORE_START: // If we're waiting to start it's kinda like we're paused at 0.
        console.log('vodsync', 'User has manually seeked', playerId, 'seeking all other players')
        var timestamp = thisPlayer.startTime + Math.floor(data.position * 1000) // Note that the seek position comes from the javascript event's data
        seekPlayersTo(timestamp, (thisPlayer.state === PLAYING ? PLAYING : PAUSED))
        break

      case RESTARTING:
      case AFTER_END:
        console.log('vodsync', playerId, 'had an unhandled event', event, 'while in state', STATE_STRINGS[thisPlayer.state])
        break
    }
  } else if (event == 'play') {
    switch (thisPlayer.state) {
      case PAUSED: // If the user manually starts a fully paused video, sync all other videos to it.
      case READY: // A manual play on a 'ready' video (before other players have loaded)
      case BEFORE_START: // If the user attempts to play a video that's waiting at the start, just sync everyone to this.
        console.log('vodsync', 'User has manually started', playerId, 'starting all players')
        var timestamp = thisPlayer.getCurrentTimestamp()
        seekPlayersTo(timestamp, PLAYING)
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

      case RESTARTING: // We want ended videos to sit somewhere near the end mark, for clarity.
        console.log('vodsync', 'Finished restarting the video after it ended, seeking to a safe end point and pausing')
        thisPlayer.seekToEnd()
        break

      case ASYNC: // No action needed. The user is likely resuming the video so they can watch and sync it up.
        break

      case SEEKING_PLAY:
      case PLAYING:
        break // Already in the correct state.

      case SEEKING_START:
      case AFTER_END:
        console.log('vodsync', playerId, 'had an unhandled event', event, 'while in state', STATE_STRINGS[thisPlayer.state])
        break
    }
  } else if (event == 'pause') {
    switch (thisPlayer.state) {
      case SEEKING_PLAY:
      case PLAYING:
        console.log('vodsync', 'User has manually paused', playerId, 'while it was playing, pausing all other players')
        // When the user clicks outside of the player's buffer, twitch issues 'pause', 'seek', and then 'play' events.
        // Unfortunately, the first of these events (pause) looks identical to the user just pausing the player.
        // Therefore, we just pause all videos on the first 'pause' event, which will cause twitch to only issue a 'seek' and not a 'play'.
        // This results in all videos doing a SEEKING_PAUSE, which is fairly close to the user's intent anyways.
        for (var player of players.values()) {
          if (player.state === SEEKING_PLAY) player.state = SEEKING_PAUSE
          if (player.state === PLAYING)      player.state = PAUSED
          player.pause()
        }
        break

      case ASYNC: // Either the automatic pause at the start of asyncing, or the user manually paused the video to align it.
        var pausedTimestamp = thisPlayer.getCurrentTimestamp()
        thisPlayer.offset += (ASYNC_ALIGN - pausedTimestamp)
        break

      case SEEKING_PAUSE:
      case PAUSED:
        break // Already in the correct state.

      case READY:
      case SEEKING_START:
      case BEFORE_START:
      case RESTARTING:
      case AFTER_END:
        console.log('vodsync', playerId, 'had an unhandled event', event, 'while in state', STATE_STRINGS[thisPlayer.state])
        break
    }
  } else if (event == 'ended') {
    switch (thisPlayer.state) {
      case PLAYING: // If the player naturally plays past the end, trigger the AFTER_END state by seeking.
      case SEEKING_PLAY: // Other states are possible by seeking (if the video is short enough)
      case PAUSED:
      case SEEKING_PAUSE:
      case AFTER_END:
        // Once a video as ended, 'play' is the only way to interact with it automatically.
        console.log('vodsync', 'restarting', playerId)
        thisPlayer.state = RESTARTING
        thisPlayer.play() // This play command will trigger a seek to the beginning first, then a play.
        break

      case BEFORE_START: // If the user seeks to the end of this video while we're waiting to start, treat it like a normal seek event.
        seekPlayersTo(thisPlayer.endTime, PAUSED)
        break

      case ASYNC: // If this happens while asyncing, just restart the player (but don't change state). The user is responsible here anyways.
        thisPlayer.play()
        break

      case READY:
      case SEEKING_START:
      case RESTARTING:
      case AFTER_END:
        console.log('vodsync', playerId, 'had an unhandled event', event, 'while in state', STATE_STRINGS[thisPlayer.state])
        break
    }
  }
}

function seekPlayersTo(timestamp, targetState) {
  for (var player of players.values()) player.seekTo(timestamp, targetState)
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

var TIMELINE_COLORS = ['#aaf', '#faa', '#afa', '#aff', '#faf', '#ffa']
var TIMELINE_DATE_FORMAT = new Intl.DateTimeFormat({}, {'dateStyle': 'short', 'timeStyle': 'short'})
function reloadTimeline() {
  var timeline = document.getElementById('timeline')
  if (timeline != null) timeline.remove()
  if (players.size === 0) {
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

