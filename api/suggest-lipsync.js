// api/suggest-lipsync.js
// Dùng Gemini 2.5 Flash – bắt buộc trả về JSON
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Chỉ hỗ trợ POST.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Thiếu GEMINI_API_KEY.' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: 'Dữ liệu không đúng JSON.' });
  }

  const { imageBase64, lyrics } = body;
  if (!imageBase64) return res.status(400).json({ error: 'Thiếu ảnh.' });
  if (!lyrics || lyrics.trim().length === 0) return res.status(400).json({ error: 'Thiếu lời bài hát.' });

  const lines = lyrics.split('\n').filter(line => line.trim().length > 0);
  let sentences = lines;
  if (sentences.length < 3) {
    sentences = lyrics.split(/[.?!;:]/).filter(s => s.trim().length > 2).map(s => s.trim());
  }
  if (sentences.length > 20) sentences = sentences.slice(0, 20);
  if (sentences.length === 0) sentences = ['Bài hát này thật tuyệt vời!'];

  const prompt = `
Bạn là đạo diễn video. Tạo kịch bản hát nhép cho từng câu hát.
Mỗi câu là một cảnh, dùng ảnh ca sĩ.
Mô tả chuyển động, góc quay, biểu cảm.
Phụ đề là chính câu hát.
Thời lượng mỗi cảnh 3-6 giây.

QUAN TRỌNG: CHỈ trả về JSON, không thêm gì khác.
Cấu trúc:
{"title": "Tên video", "scenes": [{"visualIdea": "...", "caption": "...", "narration": "...", "durationSec": 4}]}

Lời bài hát:
${sentences.map((s, i) => `${i+1}. ${s}`).join('\n')}
  `;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 2500,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (!response.ok) {
      const err = await response.text();
      return res.status(502).json({ error: 'Gemini lỗi', detail: err.slice(0, 300) });
    }

    const data = await response.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
      try { parsed = JSON.parse(cleaned); } catch (e2) {
        return res.status(502).json({ error: 'AI trả về không đúng JSON.', raw: raw.slice(0, 500) });
      }
    }

    if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
      return res.status(502).json({ error: 'Thiếu danh sách cảnh.' });
    }

    return res.status(200).json({
      title: (parsed.title || 'Video hát nhép').slice(0, 200),
      scenes: parsed.scenes.slice(0, 20).map(s => ({
        visualIdea: (s.visualIdea || '').slice(0, 300),
        caption: (s.caption || '').slice(0, 200),
        narration: (s.narration || '').slice(0, 600),
        durationSec: Math.max(2, Math.min(8, Number(s.durationSec) || 4)),
      })),
    });
  } catch (e) {
    return res.status(500).json({ error: 'Lỗi máy chủ: ' + e.message });
  }
};
