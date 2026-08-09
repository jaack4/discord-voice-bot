const prism = require('prism-media');
const {
    EndBehaviorType,
    VoiceConnectionStatus,
    entersState,
    joinVoiceChannel,
} = require('@discordjs/voice');

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BYTES_PER_SAMPLE = 2;
const FRAME_SIZE = 960;
const MIN_AUDIO_BYTES = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE * 0.2;
const WHISPER_SAMPLE_RATE = 16_000;
const WHISPER_CHANNELS = 1;
const DEFAULT_WAKE_PHRASES = [
    'hey bot',
    'hey bart',
    'hey bert',
    'hey burt',
    'hey bat',
    'hey bard',
    'hey barb',
    'hey bought',
    'a bot',
    'a bart',
];

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function downsampleForWhisper(pcm) {
    const inputFrameBytes = CHANNELS * BYTES_PER_SAMPLE;
    const sampleRatio = SAMPLE_RATE / WHISPER_SAMPLE_RATE;
    const outputFrames = Math.floor(pcm.length / inputFrameBytes / sampleRatio);
    const output = Buffer.alloc(outputFrames * BYTES_PER_SAMPLE);

    for (let outputIndex = 0; outputIndex < outputFrames; outputIndex += 1) {
        let sum = 0;
        for (let ratioIndex = 0; ratioIndex < sampleRatio; ratioIndex += 1) {
            const inputOffset = (outputIndex * sampleRatio + ratioIndex) * inputFrameBytes;
            sum += pcm.readInt16LE(inputOffset);
            sum += pcm.readInt16LE(inputOffset + BYTES_PER_SAMPLE);
        }
        output.writeInt16LE(Math.round(sum / (sampleRatio * CHANNELS)), outputIndex * BYTES_PER_SAMPLE);
    }

    return output;
}

function pcmToWav(pcm) {
    const whisperPcm = downsampleForWhisper(pcm);
    const header = Buffer.alloc(44);
    const byteRate = WHISPER_SAMPLE_RATE * WHISPER_CHANNELS * BYTES_PER_SAMPLE;
    const blockAlign = WHISPER_CHANNELS * BYTES_PER_SAMPLE;

    header.write('RIFF', 0);
    header.writeUInt32LE(36 + whisperPcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(WHISPER_CHANNELS, 22);
    header.writeUInt32LE(WHISPER_SAMPLE_RATE, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
    header.write('data', 36);
    header.writeUInt32LE(whisperPcm.length, 40);

    return Buffer.concat([header, whisperPcm]);
}

function normalizeSpokenCommand(command) {
    const normalized = command
        .trim()
        .replace(/^[,.:;!\-\s]+/, '')
        .replace(/^please\s+/i, '')
        .replace(/^([a-z]+)\s*[,.:;!?\-]+\s*/i, '$1 ')
        .replace(/[,.:;!?]+$/, '')
        .trim();

    const aliases = [
        [/^(?:what(?:'s| is)|which song is) (?:currently )?playing$/i, 'nowplaying'],
        [/^(?:what(?:'s| is) (?:in|on) (?:the )?queue|show (?:me )?(?:the )?queue)$/i, 'queue'],
        [/^skip(?: (?:this|the|current) (?:song|track))?$/i, 'skip'],
        [/^stop(?: (?:the )?music| playing)?$/i, 'stopmusic'],
        [/^clear(?: (?:the )?queue)?$/i, 'clear'],
        [/^leave(?: (?:the )?voice (?:chat|channel))?$/i, 'leave'],
    ];

    for (const [pattern, replacement] of aliases) {
        if (pattern.test(normalized)) return replacement;
    }

    return normalized;
}

class VoiceCommandManager {
    constructor({
        client,
        connections,
        executeCommand,
        onDisable,
        transcriber,
        wakePhrase = 'hey bart',
        maxUtteranceMs = 15_000,
        silenceMs = 500,
        activationWindowMs = 8_000,
        autoJoinVoiceChannelId,
        commandTextChannelId,
        logTranscripts = false,
        logger = console,
    }) {
        this.client = client;
        this.connections = connections;
        this.executeCommand = executeCommand;
        this.onDisable = onDisable;
        this.transcriber = transcriber;
        this.wakePhrase = wakePhrase.trim() || 'hey bart';
        this.maxUtteranceMs = maxUtteranceMs;
        this.silenceMs = silenceMs;
        this.activationWindowMs = activationWindowMs;
        this.autoJoinVoiceChannelId = autoJoinVoiceChannelId;
        this.commandTextChannelId = commandTextChannelId;
        this.logTranscripts = logTranscripts;
        this.logger = logger;
        this.maxAudioBytes = Math.floor(
            SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE * (maxUtteranceMs / 1000),
        );
        this.enabledGuilds = new Map();
        this.listeners = new Map();
        this.activeRecordings = new Set();
        this.transcriptionQueues = new Map();
        this.suppressedGuilds = new Set();
        this.armedUsers = new Map();
        this.wakePhrases = [...new Set([this.wakePhrase, ...DEFAULT_WAKE_PHRASES])];
    }

    voiceLog(guildId, member, message) {
        if (!this.logTranscripts) return;
        const guildName = member?.guild?.name || guildId;
        const speaker = member?.displayName || member?.user?.tag || member?.user?.id || 'unknown user';
        this.logger.log(`[voice][${guildName}][${speaker}] ${message}`);
    }

    isEnabled(guildId) {
        return this.enabledGuilds.has(guildId);
    }

    canAutoActivate(guildId) {
        return Boolean(this.transcriber?.isReady) && !this.suppressedGuilds.has(guildId);
    }

    async command(message, args) {
        const action = args[0]?.toLowerCase() || 'status';

        if (action === 'on' || action === 'enable') return this.enable(message);

        if (action === 'off' || action === 'disable') {
            if (!this.isEnabled(message.guild.id)) {
                return message.reply('Voice activation is already off.');
            }

            this.suppressedGuilds.add(message.guild.id);
            this.disable(message.guild.id);
            return message.reply('Voice activation is off.');
        }

        if (action === 'status') {
            const enabled = this.isEnabled(message.guild.id);
            return message.reply(
                enabled
                    ? `Voice activation is on. Say **${this.wakePhrase}** followed by a command.`
                    : 'Voice activation is off. Use `!voice on` while you are in a voice channel.',
            );
        }

        return message.reply('Use `!voice on`, `!voice off`, or `!voice status`.');
    }

    async enable(message) {
        if (!this.transcriber?.isReady) {
            return message.reply(
                'Local Whisper is not ready. Run `npm run setup:whisper`, then restart the bot.',
            );
        }

        const voiceChannel = message.member?.voice?.channel;
        if (!voiceChannel) {
            return message.reply('Join a voice channel first, then use `!voice on`.');
        }

        if (!voiceChannel.permissionsFor(message.guild.members.me).has('Connect')) {
            return message.reply('I need permission to connect to your voice channel.');
        }

        const guildId = message.guild.id;
        this.suppressedGuilds.delete(guildId);
        let connection = this.connections.get(guildId);

        if (connection && connection.joinConfig.channelId !== voiceChannel.id) {
            return message.reply('I am already connected to a different voice channel.');
        }

        if (!connection) {
            connection = joinVoiceChannel({
                channelId: voiceChannel.id,
                guildId,
                adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                selfDeaf: false,
            });
            this.connections.set(guildId, connection);
        } else {
            connection.rejoin({ selfDeaf: false });
        }

        try {
            await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
        } catch (error) {
            console.error('Voice activation connection error:', error);
            if (!this.enabledGuilds.has(guildId)) {
                connection.destroy();
                this.connections.delete(guildId);
            }
            return message.reply('I could not establish a voice connection. Please try again.');
        }

        this.activateForConnection(guildId, connection, {
            voiceChannelId: voiceChannel.id,
            textChannelId: message.channel.id,
        });

        return message.reply(
            `Voice activation is on. Say **${this.wakePhrase}** followed by a command, such as “${this.wakePhrase}, play Bohemian Rhapsody.” Speech turns are transcribed locally by Whisper; audio is not saved by this bot.`,
        );
    }

    disable(guildId, { updateConnection = true } = {}) {
        this.enabledGuilds.delete(guildId);
        for (const key of this.armedUsers.keys()) {
            if (key.startsWith(`${guildId}:`)) this.armedUsers.delete(key);
        }
        const listener = this.listeners.get(guildId);
        if (listener) {
            listener.receiver.speaking.off('start', listener.onStart);
            this.listeners.delete(guildId);
        }
        if (updateConnection) this.onDisable?.(guildId);
    }

    activateForConnection(guildId, connection, { voiceChannelId, textChannelId }) {
        if (!this.canAutoActivate(guildId)) return false;

        const newlyActivated = !this.enabledGuilds.has(guildId);
        if (connection.joinConfig.selfDeaf) connection.rejoin({ selfDeaf: false });
        this.enabledGuilds.set(guildId, { voiceChannelId, textChannelId });
        this.attachToConnection(guildId, connection);
        return newlyActivated;
    }

    async autoJoinConfiguredChannel() {
        if (!this.autoJoinVoiceChannelId && !this.commandTextChannelId) return false;
        if (!this.autoJoinVoiceChannelId || !this.commandTextChannelId) {
            console.error(
                'Always-listening autojoin needs both VOICE_AUTOJOIN_CHANNEL_ID and VOICE_COMMAND_TEXT_CHANNEL_ID.',
            );
            return false;
        }
        if (!this.transcriber?.isReady) {
            console.error('Always-listening autojoin needs the local Whisper server to be ready.');
            return false;
        }

        try {
            const [voiceChannel, textChannel] = await Promise.all([
                this.client.channels.fetch(this.autoJoinVoiceChannelId),
                this.client.channels.fetch(this.commandTextChannelId),
            ]);

            if (!voiceChannel?.isVoiceBased() || !textChannel?.isTextBased()) {
                throw new Error('Configured voice or text channel ID has the wrong channel type.');
            }
            if (voiceChannel.guild.id !== textChannel.guild.id) {
                throw new Error('Configured voice and text channels must be in the same server.');
            }
            if (!voiceChannel.permissionsFor(voiceChannel.guild.members.me).has('Connect')) {
                throw new Error('The bot does not have Connect permission in the configured voice channel.');
            }

            const guildId = voiceChannel.guild.id;
            let connection = this.connections.get(guildId);
            if (!connection) {
                connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId,
                    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                    selfDeaf: false,
                });
                this.connections.set(guildId, connection);
            } else {
                connection.rejoin({ channelId: voiceChannel.id, selfDeaf: false });
            }

            await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
            this.suppressedGuilds.delete(guildId);
            this.activateForConnection(guildId, connection, {
                voiceChannelId: voiceChannel.id,
                textChannelId: textChannel.id,
            });
            await textChannel.send(
                `🎙️ Always-listening voice activation is ready in **${voiceChannel.name}**. Say **${this.wakePhrase}** to activate me.`,
            );
            return true;
        } catch (error) {
            console.error('Voice autojoin failed:', error);
            return false;
        }
    }

    attachToConnection(guildId, connection) {
        if (!this.isEnabled(guildId)) return;

        const existing = this.listeners.get(guildId);
        if (existing?.receiver === connection.receiver) return;
        if (existing) existing.receiver.speaking.off('start', existing.onStart);

        const onStart = (userId) => {
            this.captureUtterance(guildId, connection, userId).catch((error) => {
                console.error('Voice capture error:', error);
            });
        };

        connection.receiver.speaking.on('start', onStart);
        this.listeners.set(guildId, { receiver: connection.receiver, onStart });
    }

    async captureUtterance(guildId, connection, userId) {
        const recordingKey = `${guildId}:${userId}`;
        if (!this.isEnabled(guildId) || this.activeRecordings.has(recordingKey)) return;

        const guild = this.client.guilds.cache.get(guildId);
        const member = guild?.members.cache.get(userId) || await guild?.members.fetch(userId).catch(() => null);
        if (!member || member.user.bot) return;

        this.activeRecordings.add(recordingKey);
        this.voiceLog(guildId, member, 'speech started; recording...');

        const opusStream = connection.receiver.subscribe(userId, {
            end: {
                behavior: EndBehaviorType.AfterSilence,
                duration: this.silenceMs,
            },
        });
        const decoder = new prism.opus.Decoder({
            frameSize: FRAME_SIZE,
            channels: CHANNELS,
            rate: SAMPLE_RATE,
        });
        const chunks = [];
        let audioBytes = 0;
        let finished = false;

        const cleanup = () => {
            clearTimeout(maxDurationTimer);
            this.activeRecordings.delete(recordingKey);
        };

        const fail = (error) => {
            if (finished) return;
            finished = true;
            cleanup();
            console.error(`Voice recording failed for ${member.user.tag}:`, error);
            opusStream.destroy();
            decoder.destroy();
        };

        const finish = () => {
            if (finished) return;
            finished = true;
            cleanup();
            const durationMs = Math.round(
                (audioBytes / (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE)) * 1000,
            );
            if (audioBytes < MIN_AUDIO_BYTES) {
                this.voiceLog(guildId, member, `ignored ${durationMs} ms recording (too short).`);
                return;
            }
            if (!this.isEnabled(guildId)) return;
            this.voiceLog(guildId, member, `speech ended after ${durationMs} ms; queued for Whisper.`);
            this.enqueueTranscription(guildId, member, Buffer.concat(chunks, audioBytes));
        };

        decoder.on('data', (chunk) => {
            const remaining = this.maxAudioBytes - audioBytes;
            if (remaining <= 0) return;
            const accepted = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
            chunks.push(accepted);
            audioBytes += accepted.length;

            if (audioBytes >= this.maxAudioBytes) {
                opusStream.destroy();
                if (!decoder.writableEnded) decoder.end();
            }
        });
        decoder.once('end', finish);
        decoder.once('error', fail);
        opusStream.once('error', fail);
        opusStream.once('close', () => {
            if (!decoder.destroyed && !decoder.writableEnded) decoder.end();
        });

        const maxDurationTimer = setTimeout(() => {
            opusStream.destroy();
            if (!decoder.writableEnded) decoder.end();
        }, this.maxUtteranceMs);

        opusStream.pipe(decoder);
    }

    enqueueTranscription(guildId, member, pcm) {
        const previous = this.transcriptionQueues.get(guildId) || Promise.resolve();
        if (this.transcriptionQueues.has(guildId)) {
            this.voiceLog(guildId, member, 'waiting for an earlier speaker to finish transcribing.');
        }
        const current = previous
            .catch(() => undefined)
            .then(() => this.transcribeAndExecute(guildId, member, pcm))
            .catch((error) => console.error('Voice transcription error:', error))
            .finally(() => {
                if (this.transcriptionQueues.get(guildId) === current) {
                    this.transcriptionQueues.delete(guildId);
                }
            });

        this.transcriptionQueues.set(guildId, current);
    }

    async transcribeAndExecute(guildId, member, pcm) {
        if (!this.isEnabled(guildId)) return;

        const transcriptionStartedAt = Date.now();
        const transcript = await this.transcriber.transcribe(pcmToWav(pcm), {
            prompt: `Discord voice commands. Wake phrase: ${this.wakePhrase}. Commands include play, search, queue, skip, now playing, clear, stop music, leave, help, and voice off.`,
        });
        if (!this.isEnabled(guildId)) return;
        const cleanedTranscript = transcript.trim();
        const transcriptionMs = Date.now() - transcriptionStartedAt;
        this.voiceLog(
            guildId,
            member,
            `Whisper (${transcriptionMs} ms): ${JSON.stringify(cleanedTranscript || '<no speech>')}`,
        );
        const settings = this.enabledGuilds.get(guildId);
        const channel = member.guild.channels.cache.get(settings.textChannelId);
        if (!channel?.isTextBased()) {
            this.voiceLog(guildId, member, 'cannot execute: command text channel is unavailable.');
            return;
        }
        const armedKey = `${guildId}:${member.user.id}`;
        const armedUntil = this.armedUsers.get(armedKey) || 0;
        let command = this.extractCommand(cleanedTranscript);

        if (command === null) {
            if (armedUntil <= Date.now()) {
                this.armedUsers.delete(armedKey);
                this.voiceLog(
                    guildId,
                    member,
                    `ignored transcript: wake phrase ${JSON.stringify(this.wakePhrase)} was not heard.`,
                );
                return;
            }
            this.voiceLog(guildId, member, 'using the active wake-phrase window for this utterance.');
            command = cleanedTranscript;
            this.armedUsers.delete(armedKey);
        }

        const normalized = normalizeSpokenCommand(command);
        if (!normalized) {
            this.armedUsers.set(armedKey, Date.now() + this.activationWindowMs);
            this.voiceLog(
                guildId,
                member,
                `wake phrase heard; listening for a command for ${this.activationWindowMs / 1000} seconds.`,
            );
            await channel.send(
                `🎙️ **${member.displayName}**, listening for your command…`,
            );
            return;
        }

        this.armedUsers.delete(armedKey);
        this.voiceLog(guildId, member, `command recognized: !${normalized}`);

        const displayedCommand = normalized === 'stopmusic' ? 'stop music' : normalized;
        await channel.send(`🎙️ **${member.displayName}**: \`${displayedCommand}\``);
        await this.executeCommand({
            content: `!${normalized}`,
            author: member.user,
            member,
            guild: member.guild,
            channel,
            reply: (payload) => channel.send(payload),
        });
    }

    extractCommand(transcript) {
        let matchedWakePhrase = null;

        for (const wakePhrase of this.wakePhrases) {
            const wakePattern = new RegExp(`\\b${escapeRegExp(wakePhrase)}\\b`, 'i');
            const match = wakePattern.exec(transcript);
            if (match && (!matchedWakePhrase || match.index < matchedWakePhrase.index)) {
                matchedWakePhrase = { index: match.index, length: match[0].length };
            }
        }

        if (!matchedWakePhrase) return null;
        return transcript.slice(matchedWakePhrase.index + matchedWakePhrase.length).trim();
    }

    shutdown() {
        for (const guildId of this.enabledGuilds.keys()) {
            this.disable(guildId, { updateConnection: false });
        }
    }
}

module.exports = { VoiceCommandManager, normalizeSpokenCommand, pcmToWav };
