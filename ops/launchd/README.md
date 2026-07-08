# Daily Spotify push (launchd)

Copy the plist into `~/Library/LaunchAgents`, adjusting `WorkingDirectory`/log paths and the `npm` path (`which npm`) to match your machine, then load it:

```
cp ops/launchd/com.jim.ratemymusic.daily.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.jim.ratemymusic.daily.plist
launchctl list | grep com.jim.ratemymusic.daily
```
