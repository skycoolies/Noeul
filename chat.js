// api/chat.js — Groq(무료) 프록시 (Vercel 서버리스 함수)
// 브라우저(index.html)는 이 함수로만 요청을 보내고, 실제 API 키는 서버 환경변수에만 둡니다.
// Vercel 프로젝트 설정 > Environment Variables 에 GROQ_API_KEY 를 추가하세요.
// 키 발급: https://console.groq.com  (신용카드 없이 무료, 분당 30회로 한도 넉넉)

const MODEL = 'openai/gpt-oss-120b'; // 무료·고품질. 거부되면 'openai/gpt-oss-20b' 또는 'qwen/qwen3.6-27b'로 교체.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'GROQ_API_KEY 환경변수가 설정되지 않았습니다.' }); return; }

  try {
    let payload = req.body;
    if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch (_) { payload = {}; } }
    if (!payload || typeof payload !== 'object') payload = {};
    const { system, messages } = payload;

    // OpenAI 호환 형식: system 메시지 + user/assistant 턴
    const msgs = [
      { role: 'system', content: system || '' },
      ...(messages || []).map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: String(m.content || '')
      }))
    ];

    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: msgs,
        max_tokens: 1536,
        temperature: 0.7,
        reasoning_effort: 'low' // 빠르게. (gpt-oss 계열 옵션)
      })
    });

    const data = await r.json();
    if (!r.ok) { res.status(r.status).json({ error: data.error?.message || 'Groq API error', raw: data }); return; }

    // 최종 답변만 사용(추론 과정 field는 무시) → CoT 노출 방지
    const text = (data.choices?.[0]?.message?.content || '').trim();

    // index.html이 기대하는 형식({ content: [{type:'text', text}] })으로 반환
    res.status(200).json({ content: [{ type: 'text', text }] });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
