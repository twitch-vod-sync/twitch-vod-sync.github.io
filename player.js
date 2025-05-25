// Player states
const LOADING       = 0
const READY         = 1
const SEEKING_PLAY  = 2
const PLAYING       = 3
const SEEKING_PAUSE = 4
const PAUSED        = 5
const SEEKING_START = 6
const BEFORE_START  = 7
const RESTARTING    = 8
const AFTER_END     = 9
const ASYNC         = 10

STATE_STRINGS = [
  'LOADING',
  'READY',
  'SEEKING_PLAY',
  'PLAYING',
  'SEEKING_PAUSE',
  'PAUSED',
  'SEEKING_START',
  'BEFORE_START',
  'RESTARTING',
  'AFTER_END',
  'ASYNC',
]

// If you seek (manually or automatically) to a timestamp within the last 10 seconds, twitch ends the video and starts auto-playing the next one.
// When a video ends, I want to leave it paused somewhere near the end screen -- so this value represents a safe point to seek to which avoids autoplay.
const VIDEO_END_BUFFER = 15000

class Player {
  constructor(divId, videos) {
    this.state = LOADING

    if (videos != null && videos.length > 0) {
      var videoDetails = videos[0] // TODO: Support multiple videos here (everything else should be wired up)
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
  }

  onPlayerReady() {
    // Only hook events once the player has loaded, so we don't have to worry about events in the LOADING state.
    this._player.addEventListener('seek', (eventData) => {
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
    // That said, some of my tests seem to be flaky because "play" causes the video to jump into a 'buffering' state (according to getPlayerState().playback)
    // Re-adding the event listener just to get some logging and see if this is a potential fix.
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
    window.eventLog.push([new Date().getTime(), this.id, 'seekTo', targetState, timestamp])
    if (timestamp < this.startTime) {
      var durationSeconds = 0.001 // I think seek(0) does something wrong, so.
      this.state = SEEKING_START
      this._player.pause()
      this._player.seek(durationSeconds)
    } else if (timestamp >= this.endTime - VIDEO_END_BUFFER) {
      var durationSeconds = (this.endTime - this.startTime - VIDEO_END_BUFFER) / 1000.0
      this.state = AFTER_END
      this._player.pause()
      this._player.seek(durationSeconds)
    } else {
      var durationSeconds = (timestamp - this.startTime) / 1000.0
      if (durationSeconds === 0) durationSeconds = 0.001 // I think seek(0) does something wrong, so.

      if (targetState === PAUSED) {
        this.state = SEEKING_PAUSE
        this._player.pause()
        this._player.seek(durationSeconds)
      } else if (targetState === PLAYING) {
        this.state = SEEKING_PLAY
        this._player.seek(durationSeconds)
        this._player.play()
      }
    }
  }
}
