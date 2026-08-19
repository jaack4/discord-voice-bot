# Discord YouTube and Voice Bot

Node.js Discord bot for YouTube audio playback and local voice commands.

## Features

- Play YouTube URLs or search terms in a Discord voice channel.
- Queue songs per server and show now-playing metadata.
- Search the top five YouTube results and select one with a reaction.
- Optionally listen for voice commands using a local `whisper.cpp` server.

## Requirements

- Node.js 22.12 or newer
- FFmpeg available on `PATH`
- A Discord application with a bot token
- Discord intents enabled for Message Content and Guild Voice States

The bot needs permission to view channels, send messages, read message history,
add reactions, connect to voice, speak, and use voice activity.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and set:

   ```dotenv
   DISCORD_BOT_TOKEN=your_discord_bot_token
   ```

   `DISCORD_TOKEN` is also accepted as a legacy token variable. Keep `.env` and
   `config.js` private; both are ignored by Git.

3. Start the bot:

   ```bash
   npm start
   ```

`youtube-dl-exec` manages its `yt-dlp` dependency. The optional `npm run setup`
script checks Node.js, FFmpeg, and yt-dlp availability.

## Commands

All commands use the `!` prefix.

| Command | Description |
| --- | --- |
| `!play <URL or search>` / `!p` | Play a YouTube URL or automatically play the top search result |
| `!search <query>` | Search five results and select one with a reaction |
| `!queue` / `!q` | Show the current song and queue |
| `!nowplaying` / `!np` | Show the current song |
| `!skip` / `!s` | Skip the current song |
| `!clear` | Remove queued songs but keep the current song |
| `!stopmusic` | Stop playback while keeping voice activation connected |
| `!stop` / `!leave` | Stop playback, clear the queue, and leave voice |
| `!voice on` | Join your voice channel and enable voice commands |
| `!voice off` | Disable voice commands |
| `!voice status` | Show voice activation status |
| `!help` | Show command help in Discord |

## Voice activation

Voice activation is enabled automatically whenever the bot joins a voice
channel and the local Whisper server is ready. Say `hey bart` or a recognized
variant, followed by a command. You can also say the wake phrase and command in
one utterance, for example `hey bart, play Dreams`.

To install the bundled Windows Whisper runtime and English `base.en` model:

```powershell
npm run setup:whisper
```

The setup script selects CUDA when `nvidia-smi` is available and otherwise uses
CPU. It stores the runtime under `whisper_runtime/`, which is ignored by Git.
The bot records speech in memory, sends it to the configured Whisper endpoint,
and does not save recordings. Set `VOICE_LOG_TRANSCRIPTS=false` to keep spoken
text out of the console. Set both `VOICE_AUTOJOIN_CHANNEL_ID` and
`VOICE_COMMAND_TEXT_CHANNEL_ID` to enable always-listening startup behavior.

Relevant voice settings are documented in `.env.example`, including
`VOICE_WAKE_PHRASE`, `VOICE_SILENCE_MS`, `WHISPER_SERVER_URL`,
`WHISPER_START_SERVER`, `WHISPER_USE_GPU`, and `WHISPER_THREADS`.

## Development

Run the test suite with:

```bash
npm test
```

The main entry point is `bot.js`. Voice capture and command normalization live
in `voiceCommands.js`; Whisper process management lives in `localWhisper.js`.

## License

MIT
