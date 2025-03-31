[Twitch VOD Sync](https://twitch-vod-sync.github.io/twitch-vod-sync.github.io)
----

This is a web application that can play back multiple Twitch recordings (also known as VODs) at the same time, while keeping them in sync.

This app is *not* for watching live streams. If you want to watch multiple livestreams at the same time, consider [MultiTwitch.tv](https://www.multitwitch.tv/) ([GitHub](https://github.com/bhamrick/multitwitch)) or Twitch's own "Squad Stream" mode.

## Features
- Watch up to 6 streams at the same time (use the + and - buttons next to the timeline)
- Enter streams by ID or by channel name (if you've already entered one video, it will find overlapping videos from another channel)
- Control streams using the native Twitch player controls (left/right, play/pause, or seek with the timeline)
- Share the URL with others to share the same videos
- The timeline will hide video end times by default (to avoid spoilers). You can click on the timeline and press 'h' to toggle this functionality.
- The players can handle (with occasional hiccups) videos with significantly different lengths.
  - Videos will pause at their start and wait for other videos before starting automatically
  - Videos will pause if they reach the end and allow other videos to continue playing
- You can manually re-align videos which were not simultanous with the "async" mode:
   - Click on the timeline and press "a"
   - Use each player's controls to adjust them to the same time (e.g. the start of the race)
   - Click on the timeline and press "a" again to confirm alignment

**[Head over here to get started](https://twitch-vod-sync.github.io)**

## Project status
This project is a fork of [the original](https://github.com/remram44/twitch-vod-sync) from remram44, where I (jbzdarkid) can do a bit of extended development.
I have rewritten the code in pure JS, and maintained as many features as I could (and implemented some of the feature requests).
Please feel free to file issues here if you have ideas for improvements.
