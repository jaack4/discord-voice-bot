const test = require('node:test');
const assert = require('node:assert/strict');
const { LocalWhisper } = require('../localWhisper');

test('sends WAV audio to the local whisper.cpp inference endpoint', async () => {
    const whisper = new LocalWhisper({
        endpointUrl: 'http://127.0.0.1:8080/inference',
        startServer: false,
    });
    whisper.isReady = true;

    const originalFetch = global.fetch;
    let request;
    global.fetch = async (url, options) => {
        request = { url, options };
        return {
            ok: true,
            json: async () => ({ text: ' Hey Bart, skip. ' }),
        };
    };

    try {
        const transcript = await whisper.transcribe(Buffer.alloc(64), {
            prompt: 'Discord voice commands',
        });
        assert.equal(transcript, ' Hey Bart, skip. ');
    } finally {
        global.fetch = originalFetch;
    }

    assert.equal(request.url, 'http://127.0.0.1:8080/inference');
    assert.equal(request.options.method, 'POST');
    assert.deepEqual(
        [...request.options.body.keys()],
        ['file', 'temperature', 'temperature_inc', 'response_format', 'language', 'prompt'],
    );
    assert.equal(request.options.headers, undefined);
});
