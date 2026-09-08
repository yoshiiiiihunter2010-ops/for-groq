import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.GROQ_API_KEY) {
  throw new Error('GROQ_API_KEY が未設定です。.env に設定してください。');
}

const app = express();
const port = process.env.PORT || 3000;
const outputDirectory = path.dirname(fileURLToPath(import.meta.url));

function parseHeroineReply(text) {
  const data = JSON.parse(text);
  if (typeof data.dialogue !== 'string' || !Number.isFinite(data.naturalness_score) || !Number.isFinite(data.mood_impact)) {
    throw new Error(`Groqの返答形式が不正です: ${text.slice(0, 120)}`);
  }
  return data;
}

async function generateWithRetry(messages) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const apiResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
          messages,
          temperature: 0.7,
          max_completion_tokens: 512,
          reasoning_effort: 'low',
          include_reasoning: false,
          response_format: { type: 'json_object' }
        })
      });
      if (!apiResponse.ok) throw new Error(await apiResponse.text());
      return await apiResponse.json();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/\b(429|500|502|503|504)\b/.test(message) || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * (2 ** attempt)));
    }
  }
  throw lastError;
}

app.use(express.json({ limit: '16kb' }));
app.use(express.static(outputDirectory));

app.post('/api/heroine', async (request, response) => {
  const { inputText, turn, mood } = request.body ?? {};
  if (typeof inputText !== 'string' || !/^[ぁ-ん]+$/u.test(inputText) || inputText.length > 40) {
    return response.status(400).json({ error: '入力は40文字以内のひらがなにしてください。' });
  }
  const messages = [{ role: 'user', content: `あなたは夕暮れの教室にいる高校生のヒロイン「栞」です。恋愛テキストアドベンチャーらしい自然でやさしい日本語で返事を作ってください。現在は${turn}ターン目、ご機嫌は${mood}/100です。プレイヤーの発言は「${inputText}」です。短すぎる・意味が伝わらない発言には困惑し、ご機嫌変化を負にしてください。返事は80文字以内。前置きやMarkdownを付けず、必ず次のJSONだけを返してください: {"naturalness_score": 0から100の整数, "mood_impact": -20から20の整数, "dialogue": "栞としての返事"}` }];
  try {
    const result = await generateWithRetry(messages);
    const text = result.choices?.[0]?.message?.content || '';
    const data = parseHeroineReply(text);
    response.json({
      naturalness_score: Math.max(0, Math.min(100, data.naturalness_score)),
      mood_impact: Math.max(-20, Math.min(20, data.mood_impact)),
      dialogue: data.dialogue.slice(0, 160)
    });
  } catch (error) {
    console.error('Groq API error:', error);
    const detail = error instanceof Error ? error.message : String(error);
    response.status(502).json({ error: `Groq APIエラー: ${detail}` });
  }
});

app.listen(port, () => console.log(`ゲームを開く: http://localhost:${port}/yugure_mojiseigen_love_game.html`));
