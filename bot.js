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

// YouTube URL regex pattern
const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/;

client.once('ready', () => {
    console.log(`Bot is ready. Logged in as ${client.user.tag}`);
    console.log(`Serving ${client.guilds.cache.size} servers`);
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
        case 'clear':
            return clearQueue(message);
        case 'stop':
        case 'leave':
            return stopAndLeave(message);
        case 'nowplaying':
        case 'np':
            return showNowPlaying(message);
        case 'help':
            return showHelp(message);
        default:
            return message.reply('Command doesn\'t exist retard');
    }
}

// Play command handler
async function playCommand(message, args) {
    // Check if user provided a URL
    if (args.length === 0) {
        return message.reply('Please provide a YouTube URL! Example: `!play https://youtube.com/watch?v=...`');
    }

    const input = args.join(' ');
    
    // Check if input contains a YouTube URL
    const youtubeMatch = input.match(youtubeRegex);
    if (!youtubeMatch) {
        return message.reply('Please provide a valid YouTube URL!');
    }

    const videoUrl = youtubeMatch[0];
    
    // Check if user is in a voice channel
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
        return message.reply('You need to be in a voice channel to play music dumbass.');
    }

    // Check bot permissions
    if (!voiceChannel.permissionsFor(message.guild.members.me).has(['Connect', 'Speak'])) {
        return message.reply('I need permissions to connect and speak in your voice channel!');
    }

    // Add song to queue
    await addToQueue(message.guild.id, videoUrl, message.member, message.channel);
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
            .setDescription('Illegal URL retard')
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
        if (connection) {
            connection.destroy();
            connections.delete(guildId);
            players.delete(guildId);
            currentSongs.delete(guildId);
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
            });
            connections.set(guildId, connection);
        }

        // Create audio player if not exists
        let player = players.get(guildId);
        if (!player) {
            player = createAudioPlayer();
            players.set(guildId, player);
            connection.subscribe(player);

            // Handle player events
            player.on(AudioPlayerStatus.Playing, () => {
                console.log(`Playing: ${song.title}`);
            });

            player.on(AudioPlayerStatus.Idle, () => {
                console.log('Song finished, playing next...');
                // Remove current song from queue and play next
                queue.shift();
                setTimeout(() => playNextSong(guildId, voiceChannel, textChannel), 1000);
            });

            player.on('error', (error) => {
                console.error('Audio player error:', error);
                textChannel.send('An error occurred while playing the audio. Skipping to next song...');
                queue.shift();
                setTimeout(() => playNextSong(guildId, voiceChannel, textChannel), 1000);
            });
        }

        // Get audio stream and create resource
        const audioStream = await getAudioStream(song.url);
        const resource = createAudioResource(audioStream, {
            inputType: 'arbitrary',
        });

        // Play the audio
        player.play(resource);

        // Send now playing message
        const playingEmbed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🎵 Now Playing')
            .setDescription(`**${song.title}**\nBy: ${song.uploader}`)
            .setThumbnail(song.thumbnail)
            .addFields(
                { name: 'Duration', value: formatDuration(song.duration), inline: true },
                { name: 'Requested By', value: song.requestedBy, inline: true },
                { name: 'Queue Position', value: `1 of ${queue.length}`, inline: true }
            )
            .setTimestamp();
        
        textChannel.send({ embeds: [playingEmbed] });

    } catch (error) {
        console.error('Error playing song:', error);
        textChannel.send('Failed to play the current song. Skipping to next...');
        queue.shift();
        setTimeout(() => playNextSong(guildId, voiceChannel, textChannel), 1000);
    }
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
            { name: 'Music Commands', value: '`!play` or `!p <URL>` - Play a YouTube URL\n`!queue` or `!q` - Show current queue\n`!skip` or `!s` - Skip current song\n`!nowplaying` or `!np` - Show current song\n`!clear` - Clear the queue\n`!stop` or `!leave` - Stop music and leave', inline: false },
            { name: 'Other Commands', value: '`!help` - Show this help message', inline: false },
            { name: 'How to Play Music', value: 'Use `!play or !p <YouTube URL>` to add songs to the queue\nExample: `!play https://youtube.com/watch?v=...`', inline: false }
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
    try {
        // Use youtube-dl-exec to get the best audio format
        const stream = youtubedl.exec(url, {
            format: 'bestaudio',
            noPlaylist: true,
            output: '-',
            quiet: true,
        });
        
        return stream.stdout;
    } catch (error) {
        console.error('Error getting audio stream:', error);
        throw new Error('Failed to get audio stream');
    }
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

// Handle process termination
process.on('SIGINT', () => {
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
try {
    // Try to load from config.js first
    const config = require('./config.js');
    botToken = config.DISCORD_BOT_TOKEN;
} catch (error) {
    // Fall back to environment variable
    botToken = process.env.DISCORD_BOT_TOKEN;
}

if (!botToken) {
    console.error('❌ No bot token found! Please set DISCORD_BOT_TOKEN environment variable or create config.js');
    process.exit(1);
}

client.login(botToken);
