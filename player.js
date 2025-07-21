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
  if (playerType === YOUTUBE) return new YoutubePlayer(divId, videoDetails)
  throw new Exception('Unknown player type: ' + playerType.toString())
}

class TwitchPlayer {
  constructor(divId, videoDetails) {
    this.state = LOADING

    this.streamer = videoDetails.streamer
    this._startTime = videoDetails.startTime
    this._endTime = videoDetails.endTime
    this.offset = 0
    this.id = divId

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
  seekToEnd() { this.seekTo(this.endTime) }
  seekTo(timestamp, targetState) {
    if (timestamp < this.startTime) {
      console.log('Attempted to seek before the startTime, seeking start instead')
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
}

class YoutubePlayer {
  constructor(divId, videoDetails) {
    this.state = LOADING

    this.streamer = videoDetails.streamer
    this._startTime = videoDetails.startTime
    this._endTime = videoDetails.endTime
    this.offset = 0
    this.id = divId

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
  }
  
  onPlayerReady() {
    this._player.mute() // Oddly this cannot be set in the options, so we set it on ready.

    // Only hook events once the player has loaded, so we don't have to worry about events in the LOADING state.
    this._player.addEventListener('onStateChange', (event) => {
      switch (event.data) {
        case YT.PlayerState.ENDED:
          this.eventSink('ended', this)
          break
        case YT.PlayerState.PLAYING:
          // Since we're not calling the youtube APIs, we don't know the video duration.
          // However, it should be available once the player starts playing.
          var durationMillis = Math.floor(this._player.getDuration() * 1000)
          this._endTime = this._startTime + durationMillis
          this.eventSink('play', this)
          break
        case YT.PlayerState.PAUSED:
          this.eventSink('pause', this)
          break
        /*
        case YT.PlayerState.UNSTARTED:
        case YT.PlayerState.BUFFERING:
        case YT.PlayerState.CUED:
          break
        */
      }
    })

    this.onready(this) // Call back into index.js for the main bulk of 'readying'
  }

  get startTime() { return this._startTime + this.offset }
  get endTime() { return this._endTime + this.offset }

  getCurrentTimestamp() {
    var durationMillis = Math.floor(this._player.getCurrentTime() * 1000)
    return this._startTime + this.offset + durationMillis
  }

  play() { this._player.playVideo() }
  pause() { this._player.pauseVideo() }
  seekToEnd() { this.seekTo(this.endTime) }
  seekTo(timestamp, targetState) {
    if (timestamp < this.startTime) {
      console.log('Attempted to seek before the startTime, seeking start instead')
      var durationSeconds = 0.001 // I think seek(0) does something wrong, so.
      this.state = SEEKING_START
      this._player.pauseVideo()
      this._player.seekTo(durationSeconds, true)
    // If we try to seek past the end time (and the end time is known), instead pause the video near the end.
    } else if (this._endTime != null && timestamp >= this.endTime - VIDEO_END_BUFFER) {
      var durationSeconds = (this.endTime - this.startTime - VIDEO_END_BUFFER) / 1000.0
      this.state = SEEKING_END
      this._player.pauseVideo()
      this._player.seekTo(durationSeconds, true)
    } else {
      var durationSeconds = (timestamp - this.startTime) / 1000.0
      if (durationSeconds === 0) durationSeconds = 0.001 // I think seek(0) does something wrong, so.

      if (targetState === PAUSED) {
        // We don't want to pause videos which are already paused. It can cause weird behaviors if a seek is interspersed.
        if (this.state !== PAUSED) this._player.pauseVideo()
        this._player.seekTo(durationSeconds, true)
        this.state = SEEKING_PAUSE
      } else if (targetState === PLAYING) {
        this._player.seekTo(durationSeconds, true)
        // We don't want to pause videos which are already playing. It can cause weird behaviors if a seek is interspersed.
        if (this.state !== PLAYING) this._player.playVideo()
        this.state = SEEKING_PLAY
      }
    }
  }
}