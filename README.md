# Discord YouTube Bot

This bot plays YouTube audio in Discord voice channels. It supports a queue, basic playback controls, and YouTube search.

## Requirements

- Node.js 16.9.0 or newer
- FFmpeg installed and available in PATH
- Discord bot token

Note: yt-dlp is handled automatically by the `youtube-dl-exec` package.

## Setup

1) Install dependencies
```bash
npm install
```

2) Configure the bot token
Create `config.js` (or set an environment variable):
```javascript
module.exports = {
    DISCORD_BOT_TOKEN: 'your_bot_token_here'
};
```

3) Invite the bot
Create an invite using your application client ID and the permissions integer:
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_CLIENT_ID&permissions=35651584&scope=bot
```

4) Run the bot
```bash
npm start
```

## Usage

Join a voice channel first, then use these commands in a text channel:

- `!play <url or search query>` or `!p <url or search query>`: Add to queue. If a URL is not provided, the top YouTube result is used.
- `!search <query>`: Show top 5 YouTube results and select one.
- `!queue` or `!q`: Show the current queue.
- `!skip` or `!s`: Skip the current track.
- `!nowplaying` or `!np`: Show the current track.
- `!clear`: Remove all queued tracks except the current one.
- `!stop` or `!leave`: Stop and disconnect from voice.
- `!help`: Show command help.

Supported YouTube URL formats include:
- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`

## Troubleshooting

- The bot must have the following permissions: Send Messages, Connect, Speak, Use Voice Activity.
- Ensure FFmpeg is installed and on PATH.
- If search selection fails due to missing permissions, grant the Add Reactions and Read Message History permissions or switch the selection flow to message-based input.
- If audio does not play, verify the URL is accessible and try again.
- For connection issues, check your network and Discord status.

To update yt-dlp used by `youtube-dl-exec`:
```bash
npm update youtube-dl-exec
```

## Notes

- This project uses: discord.js (v14), @discordjs/voice, youtube-dl-exec, and FFmpeg.
- Keep your bot token secret. Do not commit `config.js`.

## License

MIT
