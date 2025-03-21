// Player states
const LOADING       = 0
const READY         = 1
const SEEKING_PLAY  = 2
const PLAYING       = 3
const SEEKING_PAUSE = 4
const PAUSED        = 5
const BEFORE_START  = 6
const RESTARTING    = 7
const AFTER_END     = 8
const ASYNC         = 9

class Player {
  constructor(videoDetails, twitchPlayer) {
    this.state = LOADING
    if (twitchPlayer != null) this.player = twitchPlayer
    if (videoDetails != null) {
      this.streamer = videoDetails.streamer
      this._startTime = videoDetails.startTime
      this._endTime = videoDetails.endTime
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
  seekTo(timestamp, playOrPause) {
    if (timestamp < this.startTime) {
      var durationSeconds = 0.001 // I think seek(0) does something wrong, so.
      this.state = BEFORE_START
      this.player.pause()
      this.player.seek(durationSeconds)
    //} else if (timestamp >= this.endTime - 10) {
    //  // Seeking within the last 10 seconds will auto-end the video. TODO: Handle this safely? Or just rely on 'ended'?
    } else {
      var durationSeconds = (timestamp - this.startTime) / 1000.0
      if (durationSeconds == 0) durationSeconds = 0.001 // I think seek(0) does something wrong, so.

      if (playOrPause == 'pause') {
        this.state = SEEKING_PAUSE
        this.player.pause()
        this.player.seek(durationSeconds)
      } else if (playOrPause == 'play') {
        this.state = SEEKING_PLAY
        this.player.seek(durationSeconds)
        this.player.play()
      }
    }
  }

  seekToEnd() {
    this.state = AFTER_END
    this.player.pause()
    var totalDurationSeconds = (this.endTime - this.startTime) / 1000.0
    this.player.seek(totalDurationSeconds - 10) // If you seek within the last 10 seconds, twitch auto-ends the video.
  }
}
