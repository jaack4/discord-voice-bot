const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    AudioPlayerStatus,
    VoiceConnectionStatus,
    getVoiceConnection
} = require('@discordjs/voice');
const youtubedl = require('youtube-dl-exec');
const fs = require('fs');
const path = require('path');
const { VoiceCommandManager } = require('./voiceCommands');
const { LocalWhisper } = require('./localWhisper');

require('dotenv').config({ quiet: true });

// Initialize Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

// Store active connections, players, and queues
const connections = new Map();
const players = new Map();
const queues = new Map(); // Guild ID -> Array of song objects
const currentSongs = new Map(); // Guild ID -> Current song object
let voiceCommands;
let localWhisper;

// YouTube URL regex pattern
const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/;

client.once('ready', async () => {
    console.log(`Bot is ready. Logged in as ${client.user.tag}`);
    console.log(`Serving ${client.guilds.cache.size} servers`);
    try {
        await localWhisper.start();
    } catch (error) {
        console.error('Local Whisper failed to start:', error.message);
    }
    await voiceCommands.autoJoinConfiguredChannel();
});

client.on('messageCreate', async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    const content = message.content.trim();
    
    // Handle commands
    if (content.startsWith('!')) {
        return handleCommand(message);
    }
});

// Command handler
async function handleCommand(message) {
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    switch (command) {
        case 'play':
        case 'p':
            return playCommand(message, args);
        case 'queue':
        case 'q':
            return showQueue(message);
        case 'skip':
        case 's':
            return skipSong(message);
        case 'search':
            return searchCommand(message, args);
        case 'clear':
            return clearQueue(message);
        case 'stop':
        case 'leave':
            return stopAndLeave(message);
        case 'stopmusic':
            return stopMusic(message);
        case 'nowplaying':
        case 'np':
            return showNowPlaying(message);
        case 'pp':
            return getBets(message, args, 'prizepicks');
        case 'ud':
            return getBets(message, args, 'underdog');
        case 'help':
            return showHelp(message);
        case 'voice':
            return voiceCommands.command(message, args);
        default:
            return message.reply('That command does not exist. Use `!help` to see the available commands.');
    }
}

// Play command handler
async function playCommand(message, args) {
    // Check if user provided input
    if (args.length === 0) {
        return message.reply('Please provide a YouTube URL or search query! Example: `!play never gonna give you up`');
    }

    const input = args.join(' ');
    
    // Check if user is in a voice channel
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
        return message.reply('You need to be in a voice channel to play music.');
    }

    // Check bot permissions
    if (!voiceChannel.permissionsFor(message.guild.members.me).has(['Connect', 'Speak'])) {
        return message.reply('I need permissions to connect and speak in your voice channel!');
    }

    let videoUrl;
    
    // Check if input contains a YouTube URL
    const youtubeMatch = input.match(youtubeRegex);
    if (youtubeMatch) {
        // It's a URL, use it directly
        videoUrl = youtubeMatch[0];
    } else {
        // It's a search query, search for it
        try {
            videoUrl = await searchYouTube(input, message);
            if (!videoUrl) return; // Search failed or was cancelled
        } catch (error) {
            console.error('Search error:', error);
            return message.reply('Failed to search for that song. Please try again.');
        }
    }

    // Add song to queue
    await addToQueue(message.guild.id, videoUrl, message.member, message.channel);
}

// Helper function to search YouTube
async function searchYouTube(query, message) {
    try {
        // Send searching message
        const searchingEmbed = new EmbedBuilder()
            .setColor('#ffff00')
            .setTitle('Searching...')
            .setDescription(`Searching for: **${query}**`)
            .setTimestamp();
        
        const searchMessage = await message.channel.send({ embeds: [searchingEmbed] });

        // Use yt-dlp to search YouTube and get top result
        const searchResult = await youtubedl('ytsearch1:' + query, {
            dumpSingleJson: true,
            noWarnings: true,
            noCallHome: true,
            noCheckCertificate: true,
            flatPlaylist: true,
        });

        if (!searchResult.entries || searchResult.entries.length === 0) {
            await searchMessage.edit({
                embeds: [new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('Error')
                    .setDescription(`No results found for: **${query}**`)
                    .setTimestamp()]
            });
            return null;
        }

        const topResult = searchResult.entries[0];
        const videoUrl = topResult.webpage_url || topResult.url;

        // Delete the searching message
        await searchMessage.delete();

        return videoUrl;

    } catch (error) {
        console.error('Search error:', error);
        throw error;
    }
}

// Helper function to search YouTube with user selection
async function searchYouTubeWithSelection(query, message) {
    try {
        // Send searching message
        const searchingEmbed = new EmbedBuilder()
            .setColor('#ffff00')
            .setTitle('Searching...')
            .setDescription(`Searching for: **${query}**`)
            .setTimestamp();
        
        const searchMessage = await message.channel.send({ embeds: [searchingEmbed] });

        // Use yt-dlp to search YouTube and get top 5 results
        const searchResult = await youtubedl('ytsearch5:' + query, {
            dumpSingleJson: true,
            noWarnings: true,
            noCallHome: true,
            noCheckCertificate: true,
            flatPlaylist: true,
        });

        if (!searchResult.entries || searchResult.entries.length === 0) {
            await searchMessage.edit({
                embeds: [new EmbedBuilder()
                    .setColor('#ff0000')
                    .setTitle('Error')
                    .setDescription(`No results found for: **${query}**`)
                    .setTimestamp()]
            });
            return null;
        }

        // Create selection embed with results
        const results = searchResult.entries.slice(0, 5);
        let description = `**Search results for:** ${query}\n\n`;
        
        results.forEach((result, index) => {
            const duration = result.duration ? formatDuration(result.duration) : 'Unknown';
            description += `**${index + 1}.** ${result.title}\n`;
            description += `   *${result.uploader || 'Unknown'}* - ${duration}\n\n`;
        });
        
        description += 'React with 1️⃣-5️⃣ to select a song, or ❌ to cancel.';

        const selectionEmbed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('Select a Song')
            .setDescription(description)
            .setTimestamp();

        await searchMessage.edit({ embeds: [selectionEmbed] });

        // Add reaction options
        const reactions = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '❌'];
        for (let i = 0; i < Math.min(results.length, 5); i++) {
            await searchMessage.react(reactions[i]);
        }
        await searchMessage.react('❌');

        // Wait for user reaction
        const filter = (reaction, user) => {
            return reactions.includes(reaction.emoji.name) && user.id === message.author.id;
        };

        const collected = await searchMessage.awaitReactions({
            filter,
            max: 1,
            time: 30000,
            errors: ['time']
        });

        const reaction = collected.first();
        
        if (reaction.emoji.name === '❌') {
            await searchMessage.edit({
                embeds: [new EmbedBuilder()
                    .setColor('#ffff00')
                    .setTitle('Search Cancelled')
                    .setDescription('Song selection cancelled.')
                    .setTimestamp()]
            });
            return null;
        }

        // Get selected song
        const selectedIndex = reactions.indexOf(reaction.emoji.name);
        const selectedSong = results[selectedIndex];
        
        await searchMessage.delete();
        
        return selectedSong.webpage_url || selectedSong.url;

    } catch (error) {
        if (error.message && error.message.includes('time')) {
            const timeoutEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('Search Timeout')
                .setDescription('Search timed out. Please try again.')
                .setTimestamp();
            
            message.channel.send({ embeds: [timeoutEmbed] });
            return null;
        }
        throw error;
    }
}

// Search command handler
async function searchCommand(message, args) {
    // Check if user provided a search query
    if (args.length === 0) {
        return message.reply('Please provide a search query! Example: `!search never gonna give you up`');
    }

    const query = args.join(' ');
    
    // Check if user is in a voice channel
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
        return message.reply('You need to be in a voice channel to play music.');
    }

    // Check bot permissions
    if (!voiceChannel.permissionsFor(message.guild.members.me).has(['Connect', 'Speak'])) {
        return message.reply('I need permissions to connect and speak in your voice channel!');
    }

    try {
        const videoUrl = await searchYouTubeWithSelection(query, message);
        if (!videoUrl) return; // Search failed or was cancelled

        // Add song to queue
        await addToQueue(message.guild.id, videoUrl, message.member, message.channel);

    } catch (error) {
        console.error('Search error:', error);
        message.reply('Failed to search for that song. Please try again.');
    }
}

// Add song to queue
async function addToQueue(guildId, videoUrl, member, channel) {
    try {
        // Send loading message
        const loadingEmbed = new EmbedBuilder()
            .setColor('#ffff00')
            .setTitle('Processing...')
            .setDescription('Fetching video information...')
            .setTimestamp();
        
        const loadingMessage = await channel.send({ embeds: [loadingEmbed] });

        // Get video info
        const videoInfo = await getVideoInfo(videoUrl);
        
        // Create song object
        const song = {
            url: videoUrl,
            title: videoInfo.title,
            uploader: videoInfo.uploader,
            duration: videoInfo.duration,
            thumbnail: videoInfo.thumbnail,
            requestedBy: member.user.tag,
            requestedById: member.user.id
        };

        // Initialize queue if it doesn't exist
        if (!queues.has(guildId)) {
            queues.set(guildId, []);
        }

        const queue = queues.get(guildId);
        queue.push(song);

        // If this is the first song, start playing
        if (queue.length === 1) {
            await loadingMessage.delete();
            await playNextSong(guildId, member.voice.channel, channel);
        } else {
            // Update loading message to show added to queue
            const queuedEmbed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('Added to Queue')
                .setDescription(`**${song.title}**\nBy: ${song.uploader}`)
                .setThumbnail(song.thumbnail)
                .addFields(
                    { name: 'Duration', value: formatDuration(song.duration), inline: true },
                    { name: 'Position in Queue', value: `${queue.length}`, inline: true },
                    { name: 'Requested By', value: song.requestedBy, inline: true }
                )
                .setTimestamp();
            
            await loadingMessage.edit({ embeds: [queuedEmbed] });
        }

    } catch (error) {
        console.error('Error adding to queue:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('Error')
            .setDescription('That URL could not be processed.')
            .setTimestamp();
        
        channel.send({ embeds: [errorEmbed] });
    }
}

// Play next song in queue
async function playNextSong(guildId, voiceChannel, textChannel) {
    const queue = queues.get(guildId);
    if (!queue || queue.length === 0) {
        // Queue is empty, disconnect
        const connection = connections.get(guildId);
        currentSongs.delete(guildId);
        if (connection && !voiceCommands.isEnabled(guildId)) {
            connection.destroy();
            connections.delete(guildId);
            players.delete(guildId);
        }
        
        const emptyEmbed = new EmbedBuilder()
            .setColor('#ffff00')
            .setTitle('📭 Queue Empty')
            .setDescription('No more songs.')
            .setTimestamp();
        
        textChannel.send({ embeds: [emptyEmbed] });
        return;
    }

    const song = queue[0];
    currentSongs.set(guildId, song);

    try {
        // Join voice channel if not already connected
        let connection = connections.get(guildId);
        if (!connection) {
            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId: guildId,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: !voiceCommands.canAutoActivate(guildId),
            });
            connections.set(guildId, connection);
        }
        const newlyActivated = voiceCommands.activateForConnection(guildId, connection, {
            voiceChannelId: voiceChannel.id,
            textChannelId: textChannel.id,
        });
        if (newlyActivated) {
            await textChannel.send(
                `🎙️ Always-listening voice activation is on. Say **${voiceCommands.wakePhrase}** to activate me. Speech turns are transcribed locally by Whisper and are not saved by this bot.`,
            );
        }

        // Create audio player if not exists
        let player = players.get(guildId);
        if (!player) {
            player = createAudioPlayer();
            players.set(guildId, player);
            connection.subscribe(player);

            // Handle player events
            player.on(AudioPlayerStatus.Playing, (_oldState, newState) => {
                const playback = newState.resource.metadata;
                if (!playback || playback.nowPlayingSent) return;

                playback.nowPlayingSent = true;
                console.log(`Playing: ${playback.song.title}`);
                sendNowPlaying(playback.guildId, playback.song, playback.textChannel);
            });

            player.on(AudioPlayerStatus.Idle, (oldState) => {
                finishPlayback(oldState.resource, null);
            });

            player.on('error', (error) => {
                console.error('Audio player error:', error);
                finishPlayback(error.resource, error);
            });
        }

        // Get audio stream and create resource
        const audioStream = await getAudioStream(song.url);
        const resource = createAudioResource(audioStream, {
            inputType: 'arbitrary',
            metadata: {
                guildId,
                song,
                voiceChannel,
                textChannel,
                nowPlayingSent: false,
            },
        });

        // Play the audio
        player.play(resource);

    } catch (error) {
        console.error('Error playing song:', error);
        textChannel.send('Failed to play the current song. Skipping to next...');
        queue.shift();
        setTimeout(() => playNextSong(guildId, voiceChannel, textChannel), 1000);
    }
}

function sendNowPlaying(guildId, song, textChannel) {
    const queue = queues.get(guildId);
    const playingEmbed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('🎵 Now Playing')
        .setDescription(`**${song.title}**\nBy: ${song.uploader}`)
        .setThumbnail(song.thumbnail)
        .addFields(
            { name: 'Duration', value: formatDuration(song.duration), inline: true },
            { name: 'Requested By', value: song.requestedBy, inline: true },
            { name: 'Queue Position', value: `1 of ${queue?.length || 1}`, inline: true }
        )
        .setTimestamp();

    textChannel.send({ embeds: [playingEmbed] }).catch((error) => {
        console.error('Failed to send now playing message:', error);
    });
}

function finishPlayback(resource, error) {
    const playback = resource?.metadata;
    if (!playback) return;

    const { guildId, song, voiceChannel, textChannel } = playback;
    const queue = queues.get(guildId);

    // Ignore duplicate Idle/error events and resources replaced by another song.
    if (!queue || queue[0] !== song) return;

    queue.shift();
    currentSongs.delete(guildId);

    if (error) {
        textChannel.send('The audio stream failed. Skipping to the next song...').catch((sendError) => {
            console.error('Failed to send playback error message:', sendError);
        });
    } else {
        console.log(`Finished: ${song.title}`);
    }

    setTimeout(() => playNextSong(guildId, voiceChannel, textChannel), 1000);
}

// Show queue command
async function showQueue(message) {
    const queue = queues.get(message.guild.id);
    const currentSong = currentSongs.get(message.guild.id);

    if (!queue || queue.length === 0) {
        const emptyEmbed = new EmbedBuilder()
            .setColor('#ffff00')
            .setTitle('Queue is Empty')
            .setDescription('No songs in queue.')
            .setTimestamp();
        
        return message.reply({ embeds: [emptyEmbed] });
    }

    let description = '';
    
    // Show currently playing
    if (currentSong) {
        description += `**Now Playing:**\n${currentSong.title} - *${currentSong.uploader}*\nRequested by: ${currentSong.requestedBy}\n\n`;
    }

    // Show queue
    if (queue.length > 1) {
        description += '**Up Next:**\n';
        const upNext = queue.slice(1, 11); // Show next 10 songs
        upNext.forEach((song, index) => {
            description += `${index + 2}. ${song.title} - *${song.uploader}* (${formatDuration(song.duration)})\n   Requested by: ${song.requestedBy}\n`;
        });

        if (queue.length > 11) {
            description += `\n... and ${queue.length - 11} more songs`;
        }
    }

    const queueEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle(`🎵 Music Queue (${queue.length} songs)`)
        .setDescription(description)
        .setTimestamp();

    message.reply({ embeds: [queueEmbed] });
}

// Skip song command
async function skipSong(message) {
    const queue = queues.get(message.guild.id);
    const player = players.get(message.guild.id);

    if (!queue || queue.length === 0) {
        return message.reply('No songs in queue to skip.');
    }

    if (!player) {
        return message.reply('No music is currently playing.');
    }

    const skippedSong = queue[0];
    
    // Stop current song (this will trigger the Idle event and play next song)
    player.stop();

    const skipEmbed = new EmbedBuilder()
        .setColor('#ffff00')
        .setTitle('⏭Song Skipped')
        .setDescription(`Skipped: **${skippedSong.title}**`)
        .setTimestamp();

    message.reply({ embeds: [skipEmbed] });
}

// Clear queue command
async function clearQueue(message) {
    const queue = queues.get(message.guild.id);

    if (!queue || queue.length === 0) {
        return message.reply('Queue is already empty!');
    }

    // Keep only the currently playing song
    const currentSong = queue[0];
    queues.set(message.guild.id, currentSong ? [currentSong] : []);

    const clearEmbed = new EmbedBuilder()
        .setColor('#ffff00')
        .setTitle('Queue Cleared')
        .setDescription('All songs removed from queue except the currently playing song.')
        .setTimestamp();

    message.reply({ embeds: [clearEmbed] });
}

// Stop and leave command
async function stopAndLeave(message) {
    const connection = connections.get(message.guild.id);
    const player = players.get(message.guild.id);

    if (!connection && !player) {
        return message.reply('I\'m not connected to any voice channel!');
    }

    // Clear queue and stop player
    voiceCommands.disable(message.guild.id, { updateConnection: false });
    queues.delete(message.guild.id);
    currentSongs.delete(message.guild.id);
    
    if (player) {
        player.stop();
        players.delete(message.guild.id);
    }
    
    if (connection) {
        connection.destroy();
        connections.delete(message.guild.id);
    }

    const stopEmbed = new EmbedBuilder()
        .setColor('#ff0000')
        .setTitle('Stopped')
        .setDescription('Music stopped and left voice channel.')
        .setTimestamp();

    message.reply({ embeds: [stopEmbed] });
}

// Stop playback while keeping always-listening voice activation connected
async function stopMusic(message) {
    const player = players.get(message.guild.id);
    const queue = queues.get(message.guild.id);

    if (!player || !currentSongs.has(message.guild.id)) {
        return message.reply('No music is currently playing.');
    }

    if (queue) queue.splice(1);
    player.stop();
    return message.reply('Music stopped. Voice activation is still listening.');
}

// Show now playing command
async function showNowPlaying(message) {
    const currentSong = currentSongs.get(message.guild.id);
    const queue = queues.get(message.guild.id);

    if (!currentSong) {
        return message.reply('No music is currently playing!');
    }

    const nowPlayingEmbed = new EmbedBuilder()
        .setColor('#00ff00')
        .setTitle('🎵 Now Playing')
        .setDescription(`**${currentSong.title}**\nBy: ${currentSong.uploader}`)
        .setThumbnail(currentSong.thumbnail)
        .addFields(
            { name: 'Duration', value: formatDuration(currentSong.duration), inline: true },
            { name: 'Requested By', value: currentSong.requestedBy, inline: true },
            { name: 'Songs in Queue', value: queue ? queue.length.toString() : '0', inline: true }
        )
        .setTimestamp();

    message.reply({ embeds: [nowPlayingEmbed] });
}

// Show help command
async function showHelp(message) {
    const helpEmbed = new EmbedBuilder()
        .setColor('#0099ff')
        .setTitle('Bot Commands')
        .setDescription('Commands:')
        .addFields(
            { name: 'Music Commands', value: '`!play` or `!p <URL/query>` - Play URL or search (auto-picks top result)\n`!search <query>` - Search and choose from 5 results\n`!queue` or `!q` - Show current queue\n`!skip` or `!s` - Skip current song\n`!nowplaying` or `!np` - Show current song\n`!clear` - Clear the queue\n`!stop` or `!leave` - Stop music and leave', inline: false },
            { name: 'Betting Commands', value: '`!pp [count] [sport]` - Get PrizePicks bets for a slip\n`!ud [count] [sport]` - Get Underdog bets for a slip\n\nExamples:\n`!pp` - Get all PrizePicks bets (all unique players)\n`!pp 3` - Get top 3 PrizePicks bets (all sports)\n`!ud 5 NFL` - Get top 5 Underdog NFL bets\n`!pp NBA` - Get all PrizePicks NBA bets\n`!pp 4 NBA` - Get top 4 PrizePicks NBA bets\n\nValid sports: NFL, NBA', inline: false },
            { name: 'Other Commands', value: '`!help` - Show this help message', inline: false },
            { name: 'Voice Activation', value: 'Listening starts automatically whenever the bot joins voice.\n`!voice on` - Join immediately and listen\n`!voice off` - Stop voice activation\n`!voice status` - Show voice activation status\n\nSay **hey bart** or **hey bot** (common mishearings are accepted), then speak a command within 8 seconds—or say the wake phrase and command together.', inline: false },
            { name: 'How to Play Music', value: '**Quick play:** `!play <query>` - Auto-picks top result\n**Choose result:** `!search <query>` - Pick from 5 options\n**Direct URL:** `!play <URL>` - Play specific video\n\nExamples:\n`!play never gonna give you up` (instant)\n`!search bohemian rhapsody` (choose from list)', inline: false }
        )
        .setTimestamp();

    message.reply({ embeds: [helpEmbed] });
}

// Function to get video information
async function getVideoInfo(url) {
    try {
        const info = await youtubedl(url, {
            dumpSingleJson: true,
            noWarnings: true,
            noCallHome: true,
            noCheckCertificate: true,
            preferFreeFormats: true,
            youtubeSkipDashManifest: true,
        });
        
        return {
            title: info.title || 'Unknown Title',
            uploader: info.uploader || info.channel || 'Unknown Uploader',
            duration: info.duration || 0,
            thumbnail: info.thumbnail || info.thumbnails?.[0]?.url || null
        };
    } catch (error) {
        console.error('Error getting video info:', error);
        throw new Error('Failed to get video information');
    }
}

// Function to get audio stream
async function getAudioStream(url) {
    // Some videos only expose a combined audio/video format. Prefer audio-only,
    // but fall back to the best combined stream instead of returning no audio.
    const process = youtubedl.exec(url, {
        format: 'bestaudio/best',
        noPlaylist: true,
        output: '-',
        quiet: true,
    });
    const stream = process.stdout;

    // yt-dlp failures happen after the subprocess starts. Forward them into the
    // Discord audio pipeline rather than silently treating the failure as EOF.
    process.catch((error) => {
        console.error('yt-dlp audio stream failed:', error);
        if (!stream.destroyed) {
            stream.destroy(new Error('yt-dlp could not provide a playable audio stream'));
        }
    });

    return stream;
}

// Function to format duration
function formatDuration(seconds) {
    if (!seconds || seconds === 0) return 'Unknown';
    
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    } else {
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    }
}

// Get EV bets command handler
async function getBets(message, args, bookmaker) {
    // Parse the slip count from args - if not provided, show all bets
    let slipCount = null;
    let sportArgIndex = 0;
    
    if (args[0] && !isNaN(parseInt(args[0]))) {
        slipCount = parseInt(args[0]);
        sportArgIndex = 1;
        
        // Validate slip count
        if (slipCount < 1 || slipCount > 20) {
            return message.reply('Please provide a valid slip count between 1 and 20. Example: `!pp 3` or `!ud 5`');
        }
    }

    // Parse optional sport parameter (first arg if no count, second arg if count provided)
    const sport = args[sportArgIndex]?.toUpperCase();
    
    // Validate sport if provided
    const validSports = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB'];
    if (sport && !validSports.includes(sport)) {
        return message.reply(`Invalid sport. Valid options: ${validSports.join(', ')}. Example: \`!pp 3 NFL\` or \`!ud 5 NBA\``);
    }

    const bookmakerName = bookmaker === 'prizepicks' ? 'PrizePicks' : 'Underdog';
    const sportText = sport ? ` ${sport}` : '';
    const countText = slipCount ? `top ${slipCount}` : 'all';

    try {
        // Send loading message
        const loadingEmbed = new EmbedBuilder()
            .setColor('#ffff00')
            .setTitle('Fetching Bets...')
            .setDescription(`Getting ${countText}${sportText} ${bookmakerName} bets...`)
            .setTimestamp();
        
        const loadingMessage = await message.channel.send({ embeds: [loadingEmbed] });

        // Build API URL with optional sport filter - fetch all bets (no limit)
        let apiUrlWithParams = `${apiUrl}/bets?bookmaker=${bookmaker}&limit=500`;
        if (sport) {
            apiUrlWithParams += `&sport=${sport}`;
        }

        console.log(`Fetching bets: ${apiUrlWithParams}`);
        console.log(`Requested slip count: ${slipCount}, Sport: ${sport || 'All'}`);

        // Fetch bets from API
        const response = await fetch(apiUrlWithParams);
        
        if (!response.ok) {
            throw new Error(`API returned status ${response.status}`);
        }

        const allBets = await response.json();

        console.log(`Received ${allBets.length} bets from API`);

        if (!allBets || allBets.length === 0) {
            const noDataEmbed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('No Bets Found')
                .setDescription(`No active ${bookmakerName} bets found.`)
                .setTimestamp();
            
            return loadingMessage.edit({ embeds: [noDataEmbed] });
        }

        // Filter bets to ensure unique players (sorted by EV, already sorted from API)
        const uniqueBets = [];
        const seenPlayers = new Set();

        for (const bet of allBets) {
            if (!seenPlayers.has(bet.player)) {
                uniqueBets.push(bet);
                seenPlayers.add(bet.player);
                
                // Stop once we have enough bets for the slip (if count specified)
                if (slipCount !== null && uniqueBets.length >= slipCount) {
                    break;
                }
            }
        }

        console.log(`Filtered to ${uniqueBets.length} unique player bets`);

        // Check if we have enough unique bets (only if count was specified)
        if (slipCount !== null && uniqueBets.length < slipCount) {
            const warningEmbed = new EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('Not Enough Unique Bets')
                .setDescription(`Only found ${uniqueBets.length} unique player bets for ${bookmakerName}${sportText}. Showing all available.`)
                .setTimestamp();
            
            await loadingMessage.edit({ embeds: [warningEmbed] });
            await new Promise(resolve => setTimeout(resolve, 2000)); // Show warning for 2 seconds
        }

        const bets = uniqueBets;

        // Build the bets display
        let description = '';
        let totalEV = 0;

        bets.forEach((bet, index) => {
            const evPercent = bet.ev_percent?.toFixed(2) || '0.00';
            const trueProb = bet.true_prob ? (bet.true_prob * 100).toFixed(2) : 'N/A';
            totalEV += parseFloat(bet.ev_percent) || 0;
            
            description += `**${index + 1}. ${bet.player}** - ${formatMarketName(bet.market)} **${bet.outcome}** ${bet.betting_line}\n`;
            description += `   EV: **${evPercent}%** | True Prob: **${trueProb}%** | Sharp Mean: **${bet.sharp_mean}** | ${bet.sport_title}\n\n`;
        });

        // Calculate average EV
        const avgEV = (totalEV / bets.length).toFixed(2);

        // Calculate breakeven odds for this slip size
        // At -122, each leg has 54.95% implied probability
        // Breakeven for n legs: (0.5495)^n
        const impliedOddsPerLeg = 122 / (122 + 100); // 0.5495 or 54.95%
        const breakevenOdds = (Math.pow(impliedOddsPerLeg, bets.length) * 100).toFixed(2);
        
        // Find the most recent created_at time from the bets
        let mostRecentUpdate = null;
        if (bets.length > 0 && bets[0].created_at) {
            const createdAts = bets.map(bet => new Date(bet.created_at)).filter(date => !isNaN(date.getTime()));
            if (createdAts.length > 0) {
                mostRecentUpdate = new Date(Math.max(...createdAts.map(d => d.getTime())));
                console.log(`Most recent update (UTC): ${mostRecentUpdate.toISOString()}`);
                console.log(`Most recent update (Local): ${mostRecentUpdate.toString()}`);
            }
        }
        
        // Format the update time for footer (West Coast time)
        let footerText = '';
        if (mostRecentUpdate) {
            // Format in Pacific Time
            const formatter = new Intl.DateTimeFormat('en-US', {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                hour12: true,
                timeZone: 'America/Los_Angeles'
            });
            
            const formattedTime = formatter.format(mostRecentUpdate);
            
            // Get timezone abbreviation (PST/PDT)
            const tzFormatter = new Intl.DateTimeFormat('en-US', {
                timeZone: 'America/Los_Angeles',
                timeZoneName: 'short'
            });
            const tzParts = tzFormatter.formatToParts(mostRecentUpdate);
            const tzAbbr = tzParts.find(p => p.type === 'timeZoneName')?.value || 'PT';
            
            footerText += ` • Last updated: ${formattedTime} ${tzAbbr}`;
        }
        footerText += ' • Testing, assume EV values are inaccurate';
        
        const titleText = slipCount === null 
            ? `${bookmakerName} - All Bets (${bets.length} unique players)`
            : `${bookmakerName} - ${bets.length} Man Slip`;
        
        const betsEmbed = new EmbedBuilder()
            .setColor(bookmaker === 'prizepicks' ? '#8B5CF6' : '#F59E0B')
            .setTitle(titleText)
            .setDescription(`*Assuming -122 odds for each leg (3-power)*\n\n${description}`)
            .addFields(
                { name: 'Total Legs', value: bets.length.toString(), inline: true },
                { name: 'Average EV', value: `${avgEV}%`, inline: true }
            )
            .setFooter({ text: footerText })
            .setTimestamp(mostRecentUpdate || undefined);

        await loadingMessage.edit({ embeds: [betsEmbed] });

    } catch (error) {
        console.error('Error fetching bets:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('Error')
            .setDescription(`Failed to fetch ${bookmakerName} bets. Make sure the API is running.`)
            .setTimestamp();
        
        message.channel.send({ embeds: [errorEmbed] });
    }
}

// Helper function to format market names
function formatMarketName(market) {
    if (!market) return 'Unknown';
    
    // Convert snake_case to readable format
    const formatted = market
        .replace('player_', '')
        .replace(/_/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
    
    return formatted;
}

// Handle process termination
process.on('SIGINT', () => {
    voiceCommands.shutdown();
    localWhisper.stop();
    console.log('\n🛑 Shutting down bot...');
    
    // Disconnect from all voice channels
    connections.forEach((connection) => {
        connection.destroy();
    });
    
    client.destroy();
    process.exit(0);
});

// Error handling
process.on('unhandledRejection', (error) => {
    console.error('❌ Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught exception:', error);
    process.exit(1);
});

// Login with bot token
let botToken;
let apiUrl;
let voiceWakePhrase;
let autoJoinVoiceChannelId;
let voiceCommandTextChannelId;
let whisperEndpointUrl;
let whisperExecutablePath;
let whisperModelPath;
let whisperLanguage;
let whisperThreads;
let whisperUseGpu;
let whisperStartServer;
let voiceSilenceMs;
let voiceLogTranscripts;
try {
    // Try to load from config.js first
    const config = require('./config.js');
    botToken = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN || config.DISCORD_BOT_TOKEN;
    apiUrl = process.env.API_URL || config.API_URL || 'http://localhost:8000';
    voiceWakePhrase = process.env.VOICE_WAKE_PHRASE || config.VOICE_WAKE_PHRASE;
    autoJoinVoiceChannelId = process.env.VOICE_AUTOJOIN_CHANNEL_ID || config.VOICE_AUTOJOIN_CHANNEL_ID;
    voiceCommandTextChannelId = process.env.VOICE_COMMAND_TEXT_CHANNEL_ID || config.VOICE_COMMAND_TEXT_CHANNEL_ID;
    whisperEndpointUrl = process.env.WHISPER_SERVER_URL || config.WHISPER_SERVER_URL;
    whisperExecutablePath = process.env.WHISPER_EXECUTABLE_PATH || config.WHISPER_EXECUTABLE_PATH;
    whisperModelPath = process.env.WHISPER_MODEL_PATH || config.WHISPER_MODEL_PATH;
    whisperLanguage = process.env.WHISPER_LANGUAGE || config.WHISPER_LANGUAGE;
    whisperThreads = process.env.WHISPER_THREADS || config.WHISPER_THREADS;
    whisperUseGpu = process.env.WHISPER_USE_GPU ?? config.WHISPER_USE_GPU;
    whisperStartServer = process.env.WHISPER_START_SERVER ?? config.WHISPER_START_SERVER;
    voiceSilenceMs = process.env.VOICE_SILENCE_MS || config.VOICE_SILENCE_MS;
    voiceLogTranscripts = process.env.VOICE_LOG_TRANSCRIPTS ?? config.VOICE_LOG_TRANSCRIPTS;
} catch (error) {
    // Fall back to environment variable
    botToken = process.env.DISCORD_BOT_TOKEN || process.env.DISCORD_TOKEN;
    apiUrl = process.env.API_URL || 'http://localhost:8000';
    voiceWakePhrase = process.env.VOICE_WAKE_PHRASE;
    autoJoinVoiceChannelId = process.env.VOICE_AUTOJOIN_CHANNEL_ID;
    voiceCommandTextChannelId = process.env.VOICE_COMMAND_TEXT_CHANNEL_ID;
    whisperEndpointUrl = process.env.WHISPER_SERVER_URL;
    whisperExecutablePath = process.env.WHISPER_EXECUTABLE_PATH;
    whisperModelPath = process.env.WHISPER_MODEL_PATH;
    whisperLanguage = process.env.WHISPER_LANGUAGE;
    whisperThreads = process.env.WHISPER_THREADS;
    whisperUseGpu = process.env.WHISPER_USE_GPU;
    whisperStartServer = process.env.WHISPER_START_SERVER;
    voiceSilenceMs = process.env.VOICE_SILENCE_MS;
    voiceLogTranscripts = process.env.VOICE_LOG_TRANSCRIPTS;
}

if (!botToken) {
    console.error('❌ No bot token found! Please set DISCORD_BOT_TOKEN environment variable or create config.js');
    process.exit(1);
}

const parseBoolean = (value, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    return !['0', 'false', 'no', 'off'].includes(String(value).toLowerCase());
};

localWhisper = new LocalWhisper({
    endpointUrl: whisperEndpointUrl || 'http://127.0.0.1:8080/inference',
    executablePath: whisperExecutablePath,
    modelPath: whisperModelPath,
    language: whisperLanguage || 'en',
    threads: Number.parseInt(whisperThreads, 10) || 4,
    useGpu: parseBoolean(whisperUseGpu, true),
    startServer: parseBoolean(whisperStartServer, true),
});

voiceCommands = new VoiceCommandManager({
    client,
    connections,
    executeCommand: handleCommand,
    transcriber: localWhisper,
    wakePhrase: voiceWakePhrase || 'hey bart',
    silenceMs: Number.parseInt(voiceSilenceMs, 10) || 500,
    logTranscripts: parseBoolean(voiceLogTranscripts, true),
    autoJoinVoiceChannelId,
    commandTextChannelId: voiceCommandTextChannelId,
    onDisable: (guildId) => {
        const connection = connections.get(guildId);
        if (!connection) return;

        if (currentSongs.has(guildId)) {
            connection.rejoin({ selfDeaf: true });
            return;
        }

        connection.destroy();
        connections.delete(guildId);
        players.delete(guildId);
    },
});

client.login(botToken);
