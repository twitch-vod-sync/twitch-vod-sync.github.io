// Player states
const LOADING       = 0
const READY         = 1
const SEEKING_PLAY  = 2
const PLAYING       = 3
const SEEKING_PAUSE = 4
const PAUSED        = 5
const BEFORE_START  = 6
const AFTER_END     = 7
const ASYNC         = 8

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
      var durationSeconds = 0.001
      this.state = BEFORE_START
      this.player.pause()
      this.player.seek(durationSeconds)
    } else if (timestamp >= this.endTime) {
      // Once a this has ended, 'play' is the only way to interact with it automatically.
      // After this, twitch will issue a seek to the beginning then a play command (which we handle later).
      this.state = AFTER_END // TODO: The twitch player seems to behave oddly after this event... I may need to remove and recreate the player entity. Yikes.
      this.player.play()
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


}
