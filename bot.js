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

// Store active connections and players
const connections = new Map();
const players = new Map();

// YouTube URL regex pattern
const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/;

client.once('ready', () => {
    console.log(`🤖 Bot is ready! Logged in as ${client.user.tag}`);
    console.log(`📊 Serving ${client.guilds.cache.size} servers`);
});

client.on('messageCreate', async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Check if message contains a YouTube URL
    const youtubeMatch = message.content.match(youtubeRegex);
    if (!youtubeMatch) return;

    const videoUrl = youtubeMatch[0];
    
    // Check if user is in a voice channel
    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
        return message.reply('❌ You need to be in a voice channel to play music!');
    }

    // Check bot permissions
    if (!voiceChannel.permissionsFor(message.guild.members.me).has(['Connect', 'Speak'])) {
        return message.reply('❌ I need permissions to connect and speak in your voice channel!');
    }

    try {
        // Send initial loading message
        const loadingEmbed = new EmbedBuilder()
            .setColor('#ffff00')
            .setTitle('🔄 Processing...')
            .setDescription(`Fetching audio from YouTube...`)
            .setTimestamp();
        
        const loadingMessage = await message.reply({ embeds: [loadingEmbed] });

        // Get video info
        const videoInfo = await getVideoInfo(videoUrl);
        
        // Update loading message with video info
        const processingEmbed = new EmbedBuilder()
            .setColor('#ffff00')
            .setTitle('🎵 Now Playing')
            .setDescription(`**${videoInfo.title}**\nBy: ${videoInfo.uploader}`)
            .setThumbnail(videoInfo.thumbnail)
            .addFields(
                { name: 'Duration', value: formatDuration(videoInfo.duration), inline: true },
                { name: 'Status', value: '🔄 Loading audio...', inline: true }
            )
            .setTimestamp();
        
        await loadingMessage.edit({ embeds: [processingEmbed] });

        // Join voice channel
        const connection = await joinVoiceChannel({
            channelId: voiceChannel.id,
            guildId: message.guild.id,
            adapterCreator: message.guild.voiceAdapterCreator,
        });

        connections.set(message.guild.id, connection);

        // Create audio player
        const player = createAudioPlayer();
        players.set(message.guild.id, player);

        // Get audio stream and create resource
        const audioStream = await getAudioStream(videoUrl);
        const resource = createAudioResource(audioStream, {
            inputType: 'arbitrary',
        });

        // Subscribe connection to player
        connection.subscribe(player);

        // Play the audio
        player.play(resource);

        // Update embed to show now playing
        const playingEmbed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🎵 Now Playing')
            .setDescription(`**${videoInfo.title}**\nBy: ${videoInfo.uploader}`)
            .setThumbnail(videoInfo.thumbnail)
            .addFields(
                { name: 'Duration', value: formatDuration(videoInfo.duration), inline: true },
                { name: 'Status', value: '▶️ Playing', inline: true }
            )
            .setTimestamp();
        
        await loadingMessage.edit({ embeds: [playingEmbed] });

        // Handle player events
        player.on(AudioPlayerStatus.Playing, () => {
            console.log(`🎵 Playing: ${videoInfo.title}`);
        });

        player.on(AudioPlayerStatus.Idle, () => {
            console.log('⏹️ Playback finished');
        });

        player.on('error', (error) => {
            console.error('❌ Audio player error:', error);
            message.channel.send('❌ An error occurred while playing the audio.');
        });

        // Handle connection events
        connection.on(VoiceConnectionStatus.Disconnected, () => {
            console.log('🔌 Disconnected from voice channel');
            connections.delete(message.guild.id);
            players.delete(message.guild.id);
        });

    } catch (error) {
        console.error('❌ Error playing YouTube audio:', error);
        
        const errorEmbed = new EmbedBuilder()
            .setColor('#ff0000')
            .setTitle('❌ Error')
            .setDescription('Failed to play the YouTube video. Please try again or check if the URL is valid.')
            .setTimestamp();
        
        message.reply({ embeds: [errorEmbed] });
    }
});

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
