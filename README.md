[Twitch VOD Sync](https://twitch-vod-sync.github.io/twitch-vod-sync.github.io)
==============================================================

This is a web application that can show multiple recorded videos from Twitch, syncing them exactly.

If you want to see the streams of multiple people playing together, applications like [MultiTwitch.tv](http://www.multitwitch.tv/) ([GitHub](https://github.com/bhamrick/multitwitch)) or Twitch's own "Squad Stream" mode can help. However if you are watching the streams after the fact (or after the event) or if the streams are not exactly synced (because they use different delays, common in competitions) it won't work.

This application can bring up multiple VOD (recorded streams), obtain their starting date from the API, and show them in perfect sync. You will still need to input the appropriate delay for each stream if different.

**[Head over here to get started](https://twitch-vod-sync.github.io)**

Current status
--------------

This project is a fork of [the original](https://github.com/remram44/twitch-vod-sync) from remram44, where I (jbzdarkid) can do a bit of extended development.
I have taken some efforts to clean up the UX (and fix a couple of bugs with the players), but haven't added any groundbreaking functionality.
I did port the code to pure JS, though, since I find react + typescript to be an unnecessary headache.