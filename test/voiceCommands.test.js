const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
    VoiceCommandManager,
    normalizeSpokenCommand,
    pcmToWav,
} = require('../voiceCommands');

const readyTranscriber = (transcripts = []) => ({
    isReady: true,
    transcribe: async () => transcripts.shift() || '',
});

test('normalizes natural voice command aliases', () => {
    assert.equal(normalizeSpokenCommand('skip this song.'), 'skip');
    assert.equal(normalizeSpokenCommand('what is playing?'), 'nowplaying');
    assert.equal(normalizeSpokenCommand('show me the queue'), 'queue');
    assert.equal(normalizeSpokenCommand('please play Dreams'), 'play Dreams');
    assert.equal(normalizeSpokenCommand('play, feel it in the air'), 'play feel it in the air');
    assert.equal(normalizeSpokenCommand('please play: Feel It in the Air.'), 'play Feel It in the Air');
    assert.equal(normalizeSpokenCommand('stop the music'), 'stopmusic');
});

test('extracts commands only when the transcript contains the wake phrase', () => {
    const manager = new VoiceCommandManager({
        client: {},
        connections: new Map(),
        executeCommand: () => undefined,
        wakePhrase: 'hey bart',
    });

    assert.equal(manager.extractCommand('Hey Bart, skip this song.'), ', skip this song.');
    assert.equal(manager.extractCommand('Okay hey bart, skip.'), ', skip.');
    assert.equal(manager.extractCommand('play a song'), null);
});

test('accepts common wake-phrase variants', () => {
    const manager = new VoiceCommandManager({
        client: {},
        connections: new Map(),
        executeCommand: () => undefined,
        wakePhrase: 'hey bart',
    });

    for (const transcript of [
        'Hey bot, skip this song.',
        'Hey Bert, skip this song.',
        'Hey bought, skip this song.',
        'A bot, skip this song.',
    ]) {
        assert.equal(manager.extractCommand(transcript), ', skip this song.');
    }
});

test('builds a valid PCM WAV container', () => {
    const pcm = Buffer.alloc(128);
    const wav = pcmToWav(pcm);

    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt16LE(22), 1);
    assert.equal(wav.readUInt32LE(24), 16_000);
    assert.equal(wav.readUInt32LE(40), 20);
    assert.equal(wav.length, 64);
});

test('automatically activates listening on a voice connection', () => {
    const speaking = new EventEmitter();
    const connection = {
        joinConfig: { selfDeaf: true },
        receiver: { speaking },
        rejoin: (updates) => Object.assign(connection.joinConfig, updates),
    };
    const manager = new VoiceCommandManager({
        client: {},
        connections: new Map(),
        executeCommand: () => undefined,
        transcriber: readyTranscriber(),
    });

    const activated = manager.activateForConnection('guild-1', connection, {
        voiceChannelId: 'voice-channel',
        textChannelId: 'text-channel',
    });

    assert.equal(activated, true);
    assert.equal(manager.isEnabled('guild-1'), true);
    assert.equal(connection.joinConfig.selfDeaf, false);
    assert.equal(speaking.listenerCount('start'), 1);
});

test('transcribes a wake-phrase command and routes it to the command handler', async () => {
    const sent = [];
    const executed = [];
    const logs = [];
    const channel = {
        isTextBased: () => true,
        send: async (payload) => sent.push(payload),
    };
    const guild = {
        channels: { cache: new Map([['text-channel', channel]]) },
    };
    const member = {
        displayName: 'Listener',
        user: { id: 'user-1' },
        guild,
    };
    const manager = new VoiceCommandManager({
        client: {},
        connections: new Map(),
        executeCommand: async (message) => executed.push(message.content),
        transcriber: readyTranscriber(['Hey Bart, skip this song.']),
        wakePhrase: 'hey bart',
        logTranscripts: true,
        logger: { log: (message) => logs.push(message) },
    });
    manager.enabledGuilds.set('guild-1', { textChannelId: 'text-channel' });

    await manager.transcribeAndExecute('guild-1', member, Buffer.alloc(128));

    assert.deepEqual(executed, ['!skip']);
    assert.match(sent[0], /Listener.*`skip`/);
    assert.ok(logs.some((line) => line.includes('Whisper') && line.includes('Hey Bart, skip this song.')));
    assert.ok(logs.some((line) => line.includes('command recognized: !skip')));
});

test('does not wait for the Discord acknowledgement before executing a voice command', async () => {
    let releaseAcknowledgement;
    const acknowledgement = new Promise((resolve) => {
        releaseAcknowledgement = resolve;
    });
    const executed = [];
    const channel = {
        isTextBased: () => true,
        send: () => acknowledgement,
    };
    const guild = {
        channels: { cache: new Map([['text-channel', channel]]) },
    };
    const member = {
        displayName: 'Listener',
        user: { id: 'user-1' },
        guild,
    };
    const manager = new VoiceCommandManager({
        client: {},
        connections: new Map(),
        executeCommand: async (message) => executed.push(message.content),
        transcriber: readyTranscriber(['Hey Bart, play Dreams.']),
        wakePhrase: 'hey bart',
    });
    manager.enabledGuilds.set('guild-1', { textChannelId: 'text-channel' });

    const transcription = manager.transcribeAndExecute('guild-1', member, Buffer.alloc(128));
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(executed, ['!play Dreams']);
    releaseAcknowledgement();
    await transcription;
});

test('saying only the wake phrase arms the next utterance', async () => {
    const sent = [];
    const executed = [];
    const transcripts = ['Hey Bart.', 'skip this song'];
    const channel = {
        isTextBased: () => true,
        send: async (payload) => sent.push(payload),
    };
    const guild = {
        channels: { cache: new Map([['text-channel', channel]]) },
    };
    const member = {
        displayName: 'Listener',
        user: { id: 'user-1' },
        guild,
    };
    const manager = new VoiceCommandManager({
        client: {},
        connections: new Map(),
        executeCommand: async (message) => executed.push(message.content),
        transcriber: readyTranscriber(transcripts),
        wakePhrase: 'hey bart',
    });
    manager.enabledGuilds.set('guild-1', { textChannelId: 'text-channel' });

    await manager.transcribeAndExecute('guild-1', member, Buffer.alloc(128));
    assert.deepEqual(executed, []);
    assert.match(sent[0], /listening for your command/i);

    await manager.transcribeAndExecute('guild-1', member, Buffer.alloc(128));

    assert.deepEqual(executed, ['!skip']);
});
