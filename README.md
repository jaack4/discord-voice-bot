# Discord YouTube Bot

A Discord bot that can play YouTube audio in voice channels by simply pasting a YouTube link in any text channel.

## Features

- 🎵 Play YouTube audio in voice channels
- 📋 **Song queue system** - Add multiple songs and they'll play automatically
- 🔗 Automatic YouTube URL detection
- 📊 Rich embed messages with video information
- 🎛️ Automatic audio quality selection
- 🔄 Real-time status updates
- ⏭️ **Queue management commands** - Skip, clear, view queue
- 👤 **Track who requested each song**
- 🤖 **Easy commands** - Simple ! commands for control
- ❌ Comprehensive error handling

## Prerequisites

Before running this bot, make sure you have:

1. **Node.js** (version 16.9.0 or higher)
2. **FFmpeg** installed on your system
3. A **Discord Bot Token**

Note: yt-dlp will be automatically installed by the `youtube-dl-exec` package, so no manual installation is required!

## Installation

### 1. Install Node.js Dependencies

```bash
npm install
```

### 2. Install System Dependencies

#### Windows:
- Download and install [FFmpeg](https://ffmpeg.org/download.html)
- Download and install [yt-dlp](https://github.com/yt-dlp/yt-dlp/releases)
- Make sure both are added to your system PATH

#### macOS:
```bash
brew install ffmpeg yt-dlp
```

#### Linux (Ubuntu/Debian):
```bash
sudo apt update
sudo apt install ffmpeg python3-pip
pip3 install yt-dlp
```

### 3. Set Up Discord Bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to the "Bot" section
4. Create a bot and copy the token
5. Enable the following bot permissions:
   - Send Messages
   - Connect
   - Speak
   - Use Voice Activity

### 4. Configure the Bot

Create a `config.js` file based on `config.example.js`:

```javascript
module.exports = {
    DISCORD_BOT_TOKEN: 'your_actual_bot_token_here'
};
```

Or set the environment variable:
```bash
export DISCORD_BOT_TOKEN=your_actual_bot_token_here
```

### 5. Invite Bot to Your Server

Generate an invite link with the following permissions:
- Send Messages (2048)
- Connect (1048576)
- Speak (2097152)
- Use Voice Activity (33554432)

Invite URL format:
```
https://discord.com/api/oauth2/authorize?client_id=YOUR_BOT_CLIENT_ID&permissions=35651584&scope=bot
```

## Usage

1. Start the bot:
```bash
npm start
```

2. Join a voice channel in your Discord server

3. **Add songs to queue:**
   - Use `!play <YouTube URL>` or `!p <YouTube URL>` to add songs
   - Example: `!play https://youtube.com/watch?v=dQw4w9WgXcQ`
   - If it's the first song, it will start playing immediately
   - Additional songs will be queued and play automatically

4. **Use commands to control playback:**
   - `!play <URL>` or `!p <URL>` - Add a YouTube song to queue
   - `!queue` or `!q` - View the current queue
   - `!skip` or `!s` - Skip the current song
   - `!nowplaying` or `!np` - Show current song info
   - `!clear` - Clear all songs from queue (except current)
   - `!stop` or `!leave` - Stop music and leave voice channel
   - `!help` - Show all available commands

## Supported YouTube URL Formats

- `https://www.youtube.com/watch?v=VIDEO_ID`
- `https://youtu.be/VIDEO_ID`
- `https://youtube.com/embed/VIDEO_ID`
- `https://youtube.com/v/VIDEO_ID`

## Commands

### 🎵 Music Commands
- `!play <URL>` or `!p <URL>` - Add a YouTube song to the queue
- `!queue` or `!q` - Show the current music queue
- `!skip` or `!s` - Skip the currently playing song
- `!nowplaying` or `!np` - Show information about the current song
- `!clear` - Clear all songs from the queue (except currently playing)
- `!stop` or `!leave` - Stop music and leave the voice channel
- `!help` - Show all available commands

### 🎵 Adding Songs
Use the `!play` command with a YouTube URL:
- `!play https://youtube.com/watch?v=dQw4w9WgXcQ`
- `!p https://youtu.be/dQw4w9WgXcQ`
- The bot will add it to the queue and start playing if it's the first song
- Shows rich information about the video

## Troubleshooting

### Common Issues:

1. **"I need permissions to connect and speak in your voice channel!"**
   - Make sure the bot has Connect and Speak permissions for the voice channel

2. **"You need to be in a voice channel to play music!"**
   - Join a voice channel before pasting a YouTube URL

3. **Audio not playing:**
   - Ensure FFmpeg is properly installed and in your system PATH
   - Check that yt-dlp is installed and up to date
   - Verify the YouTube URL is valid and accessible

4. **Bot not responding:**
   - Check that the bot token is correct
   - Ensure the bot has the necessary permissions in your server
   - Check the console for error messages

### Updating yt-dlp:

The `youtube-dl-exec` package automatically manages yt-dlp installation and updates. If you need to manually update yt-dlp:

```bash
# Using pip (if installed manually)
pip3 install --upgrade yt-dlp

# The npm package will automatically use the latest version
npm update youtube-dl-exec
```

## Technical Details

- **Discord.js**: v14.x for Discord API interaction
- **@discordjs/voice**: For voice channel functionality
- **youtube-dl-exec**: Node.js wrapper for yt-dlp with automatic installation
- **FFmpeg**: For audio processing and streaming

## Contributing

Feel free to submit issues and enhancement requests!

## License

This project is licensed under the MIT License.
