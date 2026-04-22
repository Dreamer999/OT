import fs from 'node:fs';
import { config } from '../config.js';

class MockTranscription {
  name = 'mock';
  async transcribe({ filename }) {
    const lines = [
      "This is a mock transcript produced by OT's demo mode.",
      `The uploaded file was "${filename}".`,
      'To enable real transcription, set TRANSCRIPTION_PROVIDER=openai and OPENAI_API_KEY in .env.',
      'We discussed three things: the PRD, the architecture, and the deploy path.',
      'Action items: finish the PRD, review the architecture, ship the demo to Render.',
    ];
    return {
      text: lines.join(' '),
      language: 'en',
      raw: { mock: true, lines },
    };
  }
}

class OpenAIWhisperTranscription {
  name = 'openai';
  constructor(apiKey) {
    this.apiKey = apiKey;
  }
  async transcribe({ absPath }) {
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: this.apiKey });
    const resp = await client.audio.transcriptions.create({
      file: fs.createReadStream(absPath),
      model: 'whisper-1',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment'],
    });
    return {
      text: resp.text,
      language: resp.language,
      raw: resp,
    };
  }
}

export function getTranscriptionProvider() {
  if (config.transcription.provider === 'openai' && config.transcription.openaiKey) {
    return new OpenAIWhisperTranscription(config.transcription.openaiKey);
  }
  return new MockTranscription();
}
