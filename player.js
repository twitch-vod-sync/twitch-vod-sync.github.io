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

class Player {
  constructor(divId, videos) {
    this.state = LOADING

    if (videos != null && videos.length > 0) {
      var videoDetails = videos[0] // TODO: Support multiple videos here (everything else should be wired up)
      this.streamer = videoDetails.streamer
      this._startTime = videoDetails.startTime
      this._endTime = videoDetails.endTime

      var options = {
        width: '100%',
        height: '100%',
        video: videoDetails.id,
        autoplay: false,
        muted: true,
      }
      this.player = new Twitch.Player(divId, options)
      this.offset = 0
    }
  }

  get startTime() { return this._startTime + this.offset }
  get endTime() { return this._endTime + this.offset }

  getCurrentTimestamp() {
    var durationMillis = Math.floor(this.player.getCurrentTime() * 1000)
    return this._startTime + this.offset + durationMillis
  }

  play() { this.player.play() }
  pause() { this.player.pause() }
  seekToEnd() { this.seekTo(this.endTime) }
  seekTo(timestamp, targetState) {
    if (timestamp < this.startTime) {
      var durationSeconds = 0.001 // I think seek(0) does something wrong, so.
      this.state = SEEKING_START
      this.player.pause()
      this.player.seek(durationSeconds)
    } else if (timestamp >= this.endTime - 10000) {
      // If you seek within the last 10 seconds, twitch auto-ends the video. Back off to T-11 seconds instead.
      var durationSeconds = (this.endTime - this.startTime) / 1000.0 - 11
      this.state = AFTER_END
      this.player.pause()
      this.player.seek(durationSeconds)
    } else {
      var durationSeconds = (timestamp - this.startTime) / 1000.0
      if (durationSeconds === 0) durationSeconds = 0.001 // I think seek(0) does something wrong, so.

      if (targetState === PAUSED) {
        this.state = SEEKING_PAUSE
        this.player.pause()
        this.player.seek(durationSeconds)
      } else if (targetState === PLAYING) {
        this.state = SEEKING_PLAY
        this.player.seek(durationSeconds)
        this.player.play()
      }
    }
  }
}
