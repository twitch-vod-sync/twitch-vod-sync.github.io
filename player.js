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

// Callback events
const SEEK  = enumValue('SEEK')
const PLAY  = enumValue('PLAY')
const PAUSE = enumValue('PAUSE')
const ENDED = enumValue('ENDED')

const TEST_PLAYING = enumValue('TEST_PLAYING') // Only used in tests

// If you seek (manually or automatically) to a timestamp within the last 10 seconds, twitch ends the video and starts auto-playing the next one.
// When a video ends, I want to leave it paused somewhere near the end screen -- so this value represents a safe point to seek to which avoids autoplay.
const VIDEO_END_BUFFER = 15000

window.newPlayer = function(divId, videos, playerType) {
  if (videos == null || videos.length === 0) throw new Exception('Invalid videos: ' + videos.toString())
  var videoDetails = videos[0] // TODO: Support multiple videos here?

  if (playerType === TWITCH)  return new TwitchPlayer(divId, videoDetails)
  if (playerType === YOUTUBE) return new YoutubePlayer(divId, videoDetails)
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

  seekToEnd() { this.seekTo(this.endTime, PAUSED) }
  seekTo(timestamp, targetState) {
    if (timestamp < this.startTime) {
      console.log('Attempted to seek before the startTime, seeking start instead')
      var durationSeconds = 0.001 // I think seek(0) does something wrong, so.
      this.state = SEEKING_START
      this.pause()
      this.seek(durationSeconds)
    // If we try to seek past the end time (and the end time is known), instead pause the video near the end.
    } else if (this._endTime != null && timestamp >= this.endTime - VIDEO_END_BUFFER) {
      var durationSeconds = (this.endTime - this.startTime - VIDEO_END_BUFFER) / 1000.0
      this.state = SEEKING_END
      this.pause()
      this.seek(durationSeconds)
    } else {
      var durationSeconds = (timestamp - this.startTime) / 1000.0
      if (durationSeconds === 0) durationSeconds = 0.001 // I think seek(0) does something wrong, so.

      if (targetState === PAUSED) {
        // We don't want to pause videos which are already paused. It can cause weird behaviors if a seek is interspersed.
        if (this.state !== PAUSED) this.pause()
        this.seek(durationSeconds)
        this.state = SEEKING_PAUSE
      } else if (targetState === PLAYING) {
        this.seek(durationSeconds)
        // We don't want to play videos which are already playing. It can cause weird behaviors if a seek is interspersed.
        if (this.state !== PLAYING) this.play()
        this.state = SEEKING_PLAY
      }
    }
  }
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
      this.eventSink(SEEK, this, seekMillis)
    })
    this._player.addEventListener('play',  () => {
      // Twitch loads the "true" video duration once it starts playing. We use that to update our end time,
      // since there's a chance that the video is a live VOD, and its duration doesn't match what the API returned.
      var durationMillis = Math.floor(this._player.getDuration() * 1000)
      this._endTime = this._startTime + durationMillis
      this.eventSink(PLAY, this)
    })
    this._player.addEventListener('pause', () => this.eventSink(PAUSE, this))
    this._player.addEventListener('ended', () => this.eventSink(ENDED, this))

    // I did not end up using the 'playing' event -- for the most part, twitch pauses videos when the buffer runs out,
    // which is a sufficient signal to sync up the videos again (although they don't start playing automatically again).
    this._player.addEventListener('playing', () => this.eventSink(TEST_PLAYING, this))

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
  seek(durationSeconds) { this._player.seek(durationSeconds) }
}

class YoutubePlayer extends Player {
  constructor(divId, videoDetails) {
    super(divId, videoDetails)

    var options = {
      height: '100%',
      width: '100%',
      videoId: videoDetails.id,
      playerVars: {'autoplay': 0},
    }

    // The 'onReady' event needs to be hooked precisely so that it's not called *during* the new YT.Player invocation,
    // and so that 'this' is properly defined inside the callback
    this._player = new YT.Player(divId, options)
    this._player.addEventListener('onReady', () => this.onPlayerReady())
    this._lastPauseTime = null
    this._lastPlayTime = null
  }
  
  onPlayerReady() {
    this._player.mute() // Oddly this cannot be set in the options, so we set it on ready.

    // Only hook events once the player has loaded, so we don't have to worry about events in the LOADING state.
    this._player.addEventListener('onStateChange', (event) => {
      switch (event.data) {
        case YT.PlayerState.ENDED:
          this.eventSink(ENDED, this)
          break
        case YT.PlayerState.PLAYING:
          // Since we're not calling the youtube APIs, we don't know the video duration.
          // However, it should be available once the player starts playing.
          var durationMillis = Math.floor(this._player.getDuration() * 1000)
          this._endTime = this._startTime + durationMillis
          this.eventSink(PLAY, this)
          break
        case YT.PlayerState.PAUSED:
          this.eventSink(PAUSE, this)
          break
      }
    })

    this.onready(this) // Call back into index.js for the main bulk of 'readying'
    
    // Start the seek timer to check for manual seeks
    window.setInterval(() => this._seekTimer(), 100)
  }

  get startTime() { return this._startTime + this.offset }
  get endTime() { return this._endTime + this.offset }

  getCurrentTimestamp() {
    var durationMillis = Math.floor(this._player.getCurrentTime() * 1000)
    return this._startTime + this.offset + durationMillis
  }

  play() {
    this._player.playVideo()
    this._updateSeekAlignment(this._player.getCurrentTime())
  }
  pause() {
    this._player.pauseVideo()
    this._updateSeekAlignment(this._player.getCurrentTime())
  }
  seek(durationSeconds) {
    if (this._player.getPlayerState() === YT.PlayerState.CUED) return // HACK
    this._player.seekTo(durationSeconds)
    this._updateSeekAlignment(durationSeconds)
  }

  // Whenever we (knowingly) change the player's position, make a note of the 'last known timestamp'.
  // We can use this below (in _seekTimer) to track if the player has been manually seeked without our knowledge.
  _updateSeekAlignment(durationSeconds) {
    if (this._player.getPlayerState() === YT.PlayerState.PAUSED) {
      this._lastPauseTime = durationSeconds
      this._lastPlayTime = null
    } else if (this._player.getPlayerState() === YT.PlayerState.PLAYING) {
      this._lastPauseTime = null
      this._lastPlayTime = durationSeconds - new Date().getTime()
    }
  }
  
  // Unfortunately, the youtube iframe APIs don't actually provide us with a 'onSeek' event.
  // The only (reliable) way of detecting a seek while paused is to just set a timer which regularly
  // checks the video to see if the time has gotten out of sync with the expectation (i.e. linear time).
  _seekTimer() {
    var expected = 0
    if (this._player.getPlayerState() === YT.PlayerState.PAUSED) {
      if (this._lastPauseTime == null) return // No known comparison time; don't take any action.
      
      expected = this._lastPauseTime
    } else if (this._player.getPlayerState() === YT.PlayerState.PLAYING) {
      if (this._lastPlayTime == null) return // No known comparison time; don't take any action.

      expected = this._lastPlayTime + new Date().getTime()
    } else {
      return // Unknown state
    }
    
    var actual = this._player.getCurrentTime()
    if (Math.abs(expected - actual) > 1) {
      console.log('something')
      this._updateSeekAlignment(actual)
      var durationMillis = Math.floor(actual * 1000)
      this.eventSink(SEEK, this, durationMillis)
    }
  }
}