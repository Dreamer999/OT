import { config } from '../config.js';

const SYSTEM_PROMPT = `You are the OT analyst. Given a raw speech-to-text transcript, output a strict JSON object with this shape:
{
  "summary": string,                   // 2-3 sentence TL;DR
  "action_items": string[],            // verbs first, owner-optional
  "decisions": string[],               // concrete decisions reached
  "topics": string[],                  // 1-3 word tags
  "sentiment": "positive"|"neutral"|"negative"
}
Rules: output ONLY the JSON object, no prose, no code fences.`;

class MockAnalysis {
  name = 'mock';
  async analyze({ text }) {
    return {
      summary: 'Mock summary: the speaker covered the PRD, the system architecture, and next steps for shipping the demo.',
      action_items: ['Finish the PRD', 'Review the architecture', 'Ship the demo to Render'],
      decisions: ['Use Path A (PWA share target) for v1'],
      topics: ['PRD', 'architecture', 'deploy'],
      sentiment: 'neutral',
      raw: { mock: true, chars: text.length },
    };
  }
}

class AnthropicAnalysis {
  name = 'anthropic';
  constructor({ apiKey, model }) {
    this.apiKey = apiKey;
    this.model = model;
  }
  async analyze({ text }) {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: this.apiKey });
    const resp = await client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      ],
      messages: [
        { role: 'user', content: `Transcript:\n\n${text}` },
      ],
    });
    const raw = resp.content?.[0]?.type === 'text' ? resp.content[0].text : '';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }
    return {
      summary: parsed.summary || '',
      action_items: parsed.action_items || [],
      decisions: parsed.decisions || [],
      topics: parsed.topics || [],
      sentiment: parsed.sentiment || 'neutral',
      raw: resp,
    };
  }
}

export function getAnalysisProvider() {
  if (config.analysis.provider === 'anthropic' && config.analysis.anthropicKey) {
    return new AnthropicAnalysis({
      apiKey: config.analysis.anthropicKey,
      model: config.analysis.model,
    });
  }
  return new MockAnalysis();
}
