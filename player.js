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
      videos.sort((a, b) => Math.sign(a.startTime - b.startTime))
      this._videos = videos
      this._currentVideo = videos[0]

      // To all external systems, this just looks like a single video; compute the max start and end times to pretend
      this._startTime = this._videos[0].startTime
      this._endTime = this._videos[this._videos.length - 1].endTime

      var options = {
        width: '100%',
        height: '100%',
        video: this._currentVideo.id,
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
  seekTo(timestamp, targetState) {
    timestamp -= this.offset // Adjust by the offset first, rather than adjusting all our videos by the offset

    // First, check to see if we're seeking within the current video -- if so, handle like the old days
    if (timestamp >= this._currentVideo.startTime && timestamp < this._currentVideo.endTime - 10000) {
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
      return
    }

    // Otherwise, look for a better match. If possible, we load a video which overlaps the target time,
    // but if the user picks 'dead time', we load the next chronological video (since they will likely play from here).
    var targetVideo = null
    for (var video of this._videos) {
      if (timestamp < video.endTime - 10000) {
        targetVideo = video
        break
      }
    }

    var targetDurationSeconds = 0

    // If we are trying to seek *after the last video*, enter the AFTER_END state on the final video.
    if (targetVideo == null) {
      this.state = AFTER_END
      targetVideo = this._videos[this._videos.length - 1]
      // If you seek within the last 10 seconds, twitch auto-ends the video and starts the autoplay timer.
      targetDurationSeconds = (targetVideo.endTime - targetVideo.startTime) / 1000.0 - 11

    // If the seek target is within the video, load directly to it
    } else if (timestamp > targetVideo.startTime) {
      this.state = SEEKING_PAUSE // ????? TODO test this
      targetDurationSeconds = (timestamp - targetVideo.startTime) / 1000.0
    
    // Otherwise, we're trying to seek into dead time; enter the BEFORE_START state.
    } else {
      this.state = BEFORE_START
      targetDurationSeconds = 0.001
    }

    this._currentVideo = targetVideo
    this.player.setVideo(targetVideo.id, targetDurationSeconds) 
    if (targetState === PAUSED) {
      // this.player.pause() // I don't think we need this
    } else if (targetState === PLAYING) {
      this.player.play()
    }
  }

  // This function is called when we reach the end of a video and it's restarted.
  // If we seek to the end of the current video, the main function will handle progressing to the next one (as needed).
  seekToEnd() {
    this.seekTo(this._currentVideo.endTime, PLAYING)
  }
}
