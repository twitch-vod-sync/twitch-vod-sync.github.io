function enumValue(name) { return Object.freeze({toString: () => name}) }

// Player types
const TWITCH = enumValue('TWITCH')
const YOUTUBE = enumValue('YOUTUBE')

// Player states
const LOADING       = enumValue('LOADING')
const READY         = enumValue('READY')
const SEEKING_PLAY  = enumValue('SEEKING_PLAY')
const PLAYING       = enumValue('PLAYING')
const SEEKING_PAUSE = enumValue('SEEKING_PAUSE')
const PAUSED        = enumValue('PAUSED')
const SEEKING_START = enumValue('SEEKING_START')
const BEFORE_START  = enumValue('BEFORE_START')
const RESTARTING    = enumValue('RESTARTING')
const SEEKING_END   = enumValue('SEEKING_END')
const AFTER_END     = enumValue('AFTER_END')
const ASYNC         = enumValue('ASYNC')

// If you seek (manually or automatically) to a timestamp within the last 10 seconds, twitch ends the video and starts auto-playing the next one.
// When a video ends, I want to leave it paused somewhere near the end screen -- so this value represents a safe point to seek to which avoids autoplay.
const VIDEO_END_BUFFER = 15000

window.newPlayer = function(divId, videos, playerType) {
  if (videos == null || videos.length === 0) throw new Exception('Invalid videos: ' + videos.toString())
  var videoDetails = videos[0] // TODO: Support multiple videos here?

  if (playerType === TWITCH)  return new TwitchPlayer(divId, videoDetails)
  throw new Exception('Unknown player type: ' + playerType.toString())
}

class Player {
  constructor(divId, videoDetails) {
    this.state = LOADING

    this.streamer = videoDetails.streamer
    this._startTime = videoDetails.startTime
    this._endTime = videoDetails.endTime
    this.offset = 0
    this.id = divId
  }

  seekToEnd() { this.seekTo(this.endTime) }
}

class TwitchPlayer extends Player {
  constructor(divId, videoDetails) {
    super(divId, videoDetails)

    var options = {
      width: '100%',
      height: '100%',
      video: videoDetails.id,
      autoplay: false,
      muted: true,
    }
    this._player = new Twitch.Player(divId, options)
    this._player.addEventListener('ready', () => this.onPlayerReady())
  }

  onPlayerReady() {
    // Only hook events once the player has loaded, so we don't have to worry about events in the LOADING state.
    this._player.addEventListener('seek', (eventData) => {
      // Twitch sends a seek event immediately after the video is ready, which isn't a seek we're expecting to process.
      if (this.state === READY && (eventData.position === 0 || eventData.position === 0.01)) return
      var seekMillis = Math.floor(eventData.position * 1000)
      this.eventSink('seek', this, seekMillis)
    })
    this._player.addEventListener('play',  () => {
      // Twitch loads the "true" video duration once it starts playing. We use that to update our end time,
      // since there's a chance that the video is a live VOD, and its duration doesn't match what the API returned.
      var durationMillis = Math.floor(this._player.getDuration() * 1000)
      this._endTime = this._startTime + durationMillis
      this.eventSink('play', this)
    })
    this._player.addEventListener('pause', () => this.eventSink('pause', this))
    this._player.addEventListener('ended', () => this.eventSink('ended', this))

    // I did not end up using the 'playing' event -- for the most part, twitch pauses videos when the buffer runs out,
    // which is a sufficient signal to sync up the videos again (although they don't start playing automatically again).
    this._player.addEventListener('playing', () => this.eventSink('test_playing', this))

    this.onready(this)
  }

  get startTime() { return this._startTime + this.offset }
  get endTime() { return this._endTime + this.offset }

  getCurrentTimestamp() {
    var durationMillis = Math.floor(this._player.getCurrentTime() * 1000)
    return this._startTime + this.offset + durationMillis
  }

  play() { this._player.play() }
  pause() { this._player.pause() }
  seekTo(timestamp, targetState) {
    // If there is a seek pending FROM US, ignore all 'seekTo' instructions, since they're almost certainly noise.
    if (pendingSeekTimestamp > 0 && pendingSeekSource == this.id) return

    if (timestamp < this.startTime) {
      console.log('Attempted to seek', this.id, 'before the startTime, seeking start instead', timestamp, this.startTime)
      var durationSeconds = 0.001 // I think seek(0) does something wrong, so.
      this.state = SEEKING_START
      this._player.pause()
      this._player.seek(durationSeconds)
    // If we try to seek past the end time (and the end time is known), instead pause the video near the end.
    } else if (this._endTime != null && timestamp >= this.endTime - VIDEO_END_BUFFER) {
      var durationSeconds = (this.endTime - this.startTime - VIDEO_END_BUFFER) / 1000.0
      this.state = SEEKING_END
      this._player.pause()
      this._player.seek(durationSeconds)
    } else {
      var durationSeconds = (timestamp - this.startTime) / 1000.0
      if (durationSeconds === 0) durationSeconds = 0.001 // I think seek(0) does something wrong, so.

      if (targetState === PAUSED) {
        // We don't want to pause videos which are already paused. It can cause weird behaviors if a seek is interspersed.
        if (this.state !== PAUSED) this._player.pause()
        this._player.seek(durationSeconds)
        this.state = SEEKING_PAUSE
      } else if (targetState === PLAYING) {
        this._player.seek(durationSeconds)
        // We don't want to pause videos which are already playing. It can cause weird behaviors if a seek is interspersed.
        if (this.state !== PLAYING) this._player.play()
        this.state = SEEKING_PLAY
      }
    }
  }

  eventSink(event, thisPlayer, seekMillis) {
    // console.log(thisPlayer.id, 'received event', event, 'while in state', thisPlayer.state, seekMillis)

    if (event == 'seek') {
      switch (thisPlayer.state) {
        // These states are expected to have a seek event based on automated seeking actions,
        // so we assume that any 'seek' event corresponds to that action.
        case SEEKING_PLAY:
          thisPlayer.state = PLAYING
          break
        case SEEKING_PAUSE:
          thisPlayer.state = PAUSED
          break
        case SEEKING_START:
          thisPlayer.state = BEFORE_START
          break
        case SEEKING_END:
          thisPlayer.state = AFTER_END
          break

        case ASYNC: // If the videos are async'd and the user seeks, update the video's offset to match the seek.
          console.log('User has manually seeked', thisPlayer.id, 'while in async mode')
          var timestamp = thisPlayer.startTime + seekMillis
          thisPlayer.offset += (ASYNC_ALIGN - timestamp)
          break

        // All other states indicate the user manually seeking the video.
        case PLAYING:
        case PAUSED:
        case BEFORE_START: // If we're waiting to start it's kinda like we're paused at 0.
        case AFTER_END: // If we're waiting at the end it's kinda like we're paused at 100.
          var timestamp = thisPlayer.startTime + seekMillis
          console.log('User has manually seeked', thisPlayer.id, 'to', timestamp, 'seeking all other players')
          seekPlayersTo(timestamp, (thisPlayer.state === PLAYING ? PLAYING : PAUSED))
          break

        case RESTARTING: // This is the only state (other than LOADING) where the player isn't really loaded. Ignore seeks here.
        case READY: // If the user has previously watched one of these videos, we'll get a seek event after it's loaded. Ignore it; we'll align the videos later.
          break
      }
    } else if (event == 'play') {
      switch (thisPlayer.state) {
        case PAUSED: // If the user manually starts a fully paused video, sync all other videos to it.
        case READY: // A manual play on a 'ready' video (before other players have loaded)
        case BEFORE_START: // If the user attempts to play a video that's waiting at the start, just sync everyone to this.
          console.log('User has manually started', thisPlayer.id, 'starting all players')
          var timestamp = thisPlayer.getCurrentTimestamp()
          seekPlayersTo(timestamp, PLAYING, /*exceptFor*/thisPlayer.id)
          break

        case SEEKING_PAUSE: // However, if the video is currently seeking, we use the last seek target instead.
          console.log('User has manually started', thisPlayer.id, 'while it was seeking_paused, re-seeking with PLAYING')

          // There's a small race condition here... is there? Have I ever gotten here with a pending timestamp? Testing!
          debugger;
          pendingSeekSource = thisPlayer.id
          seekPlayersTo(pendingSeekTimestamp, PLAYING)
          break

        case RESTARTING: // We want ended videos to sit somewhere near the end mark, for clarity.
          console.log('Finished restarting the video after it ended, seeking to a safe end point and pausing')
          thisPlayer.seekToEnd()
          break

        case SEEKING_PLAY: // Already in the correct state. Take no action and don't worry too much about it.
        case PLAYING:      // Already in the correct state. Take no action and don't worry too much about it.
        case SEEKING_START: // Hopefully the user doesn't try to play the video while we're seeking for one of these two actions.
        case SEEKING_END:   // I'm not sure there's much we can safely do here, though -- just hope the user knows what they're doing.
        case AFTER_END: // We'd really prefer that the user *didn't* try to interact with players sitting in the AFTER_END state.
                        // However, if they do, the safest thing is actually to just let it happen, and wait for the player to naturally play out.
                        // It will hit the end, trigger 'ended', and restart back to here.
        case ASYNC: // No action needed. The user is likely resuming the video so they can watch and sync it up.
          console.log('Ignoring unexpected play event for', thisPlayer.id, 'was in state', thisPlayer.state)
          break
      }
    } else if (event == 'pause') {
      switch (thisPlayer.state) {
        case SEEKING_PLAY:
        case PLAYING:
          console.log('User has manually paused', thisPlayer.id, 'while it was playing, pausing all other players')
          // When the user clicks outside of the player's buffer, twitch issues 'pause', 'seek', and then 'play' events.
          // Unfortunately, the first of these events (pause) looks identical to the user just pausing the player.
          // Therefore, we just pause all videos on the first 'pause' event, which will cause Twitch to only issue a 'seek' and not a 'play'.
          // This results in all videos doing a SEEKING_PAUSE, which is fairly close to the user's intent anyways.
          for (var player of players.values()) {
            if (player.state === SEEKING_PLAY) player.state = SEEKING_PAUSE
            if (player.state === PLAYING)      player.state = PAUSED
            if (player.id != thisPlayer.id)    player.pause() // Note: We don't want to pause the current player, since it might be waiting for a seek event.
          }
          break

        case ASYNC: // Either the automatic pause at the start of asyncing, or the user manually paused the video to align it.
          var pausedTimestamp = thisPlayer.getCurrentTimestamp()
          thisPlayer.offset += (ASYNC_ALIGN - pausedTimestamp)
          break

        case SEEKING_PAUSE: // Already in the correct state. Take no action and don't worry too much about it.
        case PAUSED:        // Already in the correct state. Take no action and don't worry too much about it.
        case READY:         // The remaining states here are all states where the video isn't actively playing.
        case SEEKING_START: // If we do get a pause event in one of these states, the safest thing we can do is to ignore it,
        case RESTARTING:    // and hope that the state graph doesn't get too confused by the video being paused in a location
        case SEEKING_END:   // which doesn't quite match what we were expecting.
        case BEFORE_START:  // These last two states are less worrying because they're semi-persistent,
        case AFTER_END:     // i.e. we'll only transition out of them for 'seek' events.
          console.log('Ignoring unexpected pause event for', thisPlayer.id)
          break
      }
    } else if (event == 'ended') {
      switch (thisPlayer.state) {
        case PLAYING: // This is the most likely state: letting a video play out until its natural end.
        case READY:         // All other states are possible by seeking, if the user clicks at the end of the timeline.
        case SEEKING_PLAY:  // There's nothing malicious happening here -- it's just a case of the user taking an action
        case SEEKING_PAUSE: // while we were busy with something else.
        case PAUSED:        // For safety, we also trigger a restart here (although it likely wasn't what the user intended),
        case SEEKING_START: // since Twitch will start autoplaying the next video ~15 seconds after this event.
        case BEFORE_START:  // Furthermore, we won't get a clear notification that a new video has loaded,
        case RESTARTING:    // which means our video's start and end times would be wrong for future sync actions.
        case SEEKING_END:
        case AFTER_END:
          // Once a video as ended, 'play' is the only way to interact with it automatically.
          // To bring it back into an interactable state, we play() the video and wait for it to restart from the beginning.
          console.log(thisPlayer.id, 'reached the end of the timeline, restarting to avoid autoplay')
          thisPlayer.state = RESTARTING
          thisPlayer.play() // This play command will trigger a seek to the beginning first, then a play.
          break

        case ASYNC: // If this happens while asyncing, just restart the player (but don't change state). The user is responsible here anyways.
          thisPlayer.play()
          break
      }
    }

    // console.log(thisPlayer.id, 'handled event', event, 'and is now in state', thisPlayer.state)

    // *After* we transition the video's state, check to see if this completes a pending seek event.
    if (pendingSeekTimestamp > 0) {
      var anyPlayerStillSeeking = false
      for (var player of players.values()) {
        if ([SEEKING_PLAY, SEEKING_PAUSE, SEEKING_START, SEEKING_END].includes(player.state)) anyPlayerStillSeeking = true
      }

      if (!anyPlayerStillSeeking) {
        console.log(thisPlayer.id, 'was last to finish seeking to', pendingSeekTimestamp, 'setting pendingSeekTimestamp to 0')
        pendingSeekTimestamp = 0
        pendingSeekSource = null
      }
    }
  }
}
