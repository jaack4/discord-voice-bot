const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class LocalWhisper {
    constructor({
        endpointUrl = 'http://127.0.0.1:8080/inference',
        executablePath,
        modelPath,
        language = 'en',
        threads = 4,
        useGpu = true,
        startServer = true,
        startupTimeoutMs = 60_000,
    } = {}) {
        this.endpointUrl = endpointUrl;
        this.executablePath = path.resolve(executablePath || path.join('whisper_runtime', 'bin', 'whisper-server.exe'));
        this.modelPath = path.resolve(modelPath || path.join('whisper_runtime', 'models', 'ggml-base.en.bin'));
        this.language = language;
        this.threads = threads;
        this.useGpu = useGpu;
        this.startServer = startServer;
        this.startupTimeoutMs = startupTimeoutMs;
        this.process = null;
        this.isReady = false;
        this.startPromise = null;
    }

    async start() {
        if (this.isReady) return;
        if (this.startPromise) return this.startPromise;

        this.startPromise = this.startInternal().finally(() => {
            this.startPromise = null;
        });
        return this.startPromise;
    }

    async startInternal() {
        if (await this.probe()) {
            this.isReady = true;
            console.log(`Local Whisper is ready at ${this.endpointUrl}`);
            return;
        }

        if (!this.startServer) {
            throw new Error(`Local Whisper server is not reachable at ${this.endpointUrl}`);
        }
        if (!fs.existsSync(this.executablePath)) {
            throw new Error(`whisper-server was not found at ${this.executablePath}. Run npm run setup:whisper.`);
        }
        if (!fs.existsSync(this.modelPath)) {
            throw new Error(`Whisper model was not found at ${this.modelPath}. Run npm run setup:whisper.`);
        }

        const endpoint = new URL(this.endpointUrl);
        if (!['127.0.0.1', 'localhost', '::1'].includes(endpoint.hostname)) {
            throw new Error('The managed Whisper server must bind to localhost. Set WHISPER_START_SERVER=false for an external server.');
        }

        const port = endpoint.port || '8080';
        const args = [
            '--model', this.modelPath,
            '--host', endpoint.hostname === 'localhost' ? '127.0.0.1' : endpoint.hostname,
            '--port', port,
            '--language', this.language,
            '--threads', String(this.threads),
        ];
        if (!this.useGpu) args.push('--no-gpu');

        console.log(`Starting local Whisper (${this.useGpu ? 'GPU' : 'CPU'})...`);
        this.process = spawn(this.executablePath, args, {
            cwd: path.dirname(this.executablePath),
            windowsHide: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        this.process.stdout.on('data', (chunk) => this.logServerOutput(chunk));
        this.process.stderr.on('data', (chunk) => this.logServerOutput(chunk));
        this.process.once('error', (error) => {
            this.isReady = false;
            console.error('Local Whisper process error:', error);
        });
        this.process.once('exit', (code, signal) => {
            this.isReady = false;
            this.process = null;
            if (code !== 0 && signal !== 'SIGTERM') {
                console.error(`Local Whisper exited with code ${code ?? 'unknown'} (${signal || 'no signal'}).`);
            }
        });

        const deadline = Date.now() + this.startupTimeoutMs;
        while (Date.now() < deadline) {
            if (await this.probe()) {
                this.isReady = true;
                console.log(`Local Whisper is ready at ${this.endpointUrl}`);
                await this.warmUp();
                return;
            }
            if (!this.process) break;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }

        this.stop();
        throw new Error('Local Whisper did not become ready before the startup timeout.');
    }

    async warmUp() {
        // The first CUDA inference compiles/loads kernels and can take ~20 seconds
        // on older GPUs. Pay that cost at bot startup, not after a wake phrase.
        const sampleRate = 16_000;
        const pcmBytes = sampleRate * 2;
        const wav = Buffer.alloc(44 + pcmBytes);
        wav.write('RIFF', 0);
        wav.writeUInt32LE(wav.length - 8, 4);
        wav.write('WAVE', 8);
        wav.write('fmt ', 12);
        wav.writeUInt32LE(16, 16);
        wav.writeUInt16LE(1, 20);
        wav.writeUInt16LE(1, 22);
        wav.writeUInt32LE(sampleRate, 24);
        wav.writeUInt32LE(sampleRate * 2, 28);
        wav.writeUInt16LE(2, 32);
        wav.writeUInt16LE(16, 34);
        wav.write('data', 36);
        wav.writeUInt32LE(pcmBytes, 40);

        console.log('Warming up local Whisper...');
        const startedAt = Date.now();
        await this.transcribe(wav);
        console.log(`Local Whisper warm-up complete (${Date.now() - startedAt} ms).`);
    }

    logServerOutput(chunk) {
        const message = chunk.toString().trim();
        if (message) console.log(`[whisper] ${message}`);
    }

    async probe() {
        try {
            const url = new URL(this.endpointUrl);
            url.pathname = '/';
            url.search = '';
            const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
            return response.ok;
        } catch (_error) {
            return false;
        }
    }

    async transcribe(wavBuffer, { prompt = '' } = {}) {
        if (!this.isReady) await this.start();

        const form = new FormData();
        form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'voice-command.wav');
        form.append('temperature', '0.0');
        form.append('temperature_inc', '0.2');
        form.append('response_format', 'json');
        form.append('language', this.language);
        if (prompt) form.append('prompt', prompt);

        const response = await fetch(this.endpointUrl, {
            method: 'POST',
            body: form,
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) {
            const detail = await response.text();
            throw new Error(`Local Whisper failed (${response.status}): ${detail.slice(0, 300)}`);
        }

        const result = await response.json();
        return typeof result === 'string' ? result : (result.text || '');
    }

    stop() {
        this.isReady = false;
        if (this.process) {
            this.process.kill();
            this.process = null;
        }
    }
}

module.exports = { LocalWhisper };
