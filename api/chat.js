// api/chat.js — Google Gemini(무료) 프록시 (Vercel 서버리스 함수)
// 브라우저(index.html)는 이 함수로만 요청을 보내고, 실제 API 키는 서버 환경변수에만 둡니다.
// Vercel 프로젝트 설정 > Environment Variables 에 GEMINI_API_KEY 를 추가하세요.
// 키 발급: https://aistudio.google.com  (신용카드 없이 무료)

//const MODEL = 'gemini-2.5-flash'; // 한국어·형식 안정적, 토큰 한도 넉넉. 분당 빡빡하면 'gemini-2.5-flash-lite'.
const MODEL = 'gemini-2.5-flash-lite';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) { res.status(500).json({ error: 'GEMINI_API_KEY 환경변수가 설정되지 않았습니다.' }); return; }

  try {
    let payload = req.body;
    if (typeof payload === 'string') { try { payload = JSON.parse(payload); } catch (_) { payload = {}; } }
    if (!payload || typeof payload !== 'object') payload = {};
    const { system, messages } = payload;

    // Anthropic식 messages → Gemini contents (assistant → model)
    const contents = (messages || []).map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(m.content || '') }]
    }));

    const body = {
      system_instruction: { parts: [{ text: system || '' }] },
      contents,
      generationConfig: {
        maxOutputTokens: 1024,
        temperature: 0.7,
        // 사고 토큰 비활성화(빠르고 토큰 절약). 오류 나면 이 줄만 삭제.
        thinkingConfig: { thinkingBudget: 0 }
      }
    };

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body)
      }
    );

    const data = await r.json();
    if (!r.ok) { res.status(r.status).json({ error: data.error?.message || 'Gemini API error', raw: data }); return; }

    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('').trim();

    // index.html이 기대하는 형식
    res.status(200).json({ content: [{ type: 'text', text }] });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
