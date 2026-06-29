// api/chat.js — 3단계 fallback 프록시 (Vercel 서버리스 함수)
// 순서: ① Gemini 2.5 flash → ② Gemini 2.5 flash-lite → ③ Groq(gpt-oss-20b)
// 한 곳이 429(한도)/503(과부하)이면 자동으로 다음으로 넘어갑니다.
//
// Vercel 환경변수(둘 다 넣으면 3단계 모두 사용, 하나만 있으면 있는 것만 사용):
//   GEMINI_API_KEY  (발급: https://aistudio.google.com)
//   GROQ_API_KEY    (발급: https://console.groq.com)

async function callGemini(model, system, contents, key) {
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { maxOutputTokens: 1024, temperature: 0.7, thinkingConfig: { thinkingBudget: 0 } }
      })
    }
  );
  const data = await r.json();
  if (r.ok) {
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();
    return { ok: true, text };
  }
  return { ok: false, status: r.status, error: data.error?.message || 'Gemini error' };
}

async function callGroq(model, system, messages, key) {
  const msgs = [
    { role: 'system', content: system },
    ...messages.map(m => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }))
  ];
  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'authorization': `Bearer ${key}` },
    body: JSON.stringify({ model, messages: msgs, max_tokens: 1024, temperature: 0.7, reasoning_effort: 'low' })
  });
  const data = await r.json();
  if (r.ok) {
    const text = (data.choices?.[0]?.message?.content || '').trim();
    return { ok: true, text };
  }
  return { ok: false, status: r.status, error: data.error?.message || 'Groq error' };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;
  if (!geminiKey && !groqKey) {
    res.status(500).json({ error: 'GEMINI_API_KEY 또는 GROQ_API_KEY 환경변수가 설정되지 않았습니다.' });
    return;
  }

  try {
    let payload = req.body;
    if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch (_) { payload = {}; } }
    if (!payload || typeof payload !== 'object') payload = {};
    const { system, messages } = payload;
    const sys = system || '';
    const msgs = messages || [];

    // Gemini용 contents (assistant → model)
    const contents = msgs.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }]
    }));

    // 시도 순서
    const chain = [
      { type: 'gemini', model: 'gemini-2.5-flash', key: geminiKey },
      { type: 'gemini', model: 'gemini-2.5-flash-lite', key: geminiKey },
      { type: 'groq', model: 'openai/gpt-oss-20b', key: groqKey }
    ];

    let lastStatus = 500, lastErr = '사용 가능한 provider가 없습니다.';

    for (const p of chain) {
      if (!p.key) continue; // 키 없으면 건너뜀
      const out = p.type === 'gemini'
        ? await callGemini(p.model, sys, contents, p.key)
        : await callGroq(p.model, sys, msgs, p.key);

      if (out.ok) { res.status(200).json({ content: [{ type: 'text', text: out.text }] }); return; }

      lastStatus = out.status || 500;
      lastErr = out.error;
      // 한도/과부하면 다음 provider로, 그 외 오류는 중단
      if (out.status === 429 || out.status === 503 || out.status === 413) continue;
      break;
    }

    res.status(lastStatus).json({ error: lastErr });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
