// api/suggest-lipsync.js
// Gọi Gemini để tạo kịch bản hát nhép từ ảnh + lời bài hát

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Chỉ hỗ trợ POST.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Thiếu GEMINI_API_KEY' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const imageBase64 = body.imageBase64 || '';
  const audioName = (body.audioName || 'bài hát').slice(0, 50);
  const lyrics = (body.lyrics || '').slice(0, 3000);

  if (!imageBase64) {
    res.status(400).json({ error: 'Thiếu ảnh.' });
    return;
  }
  if (!lyrics) {
    res.status(400).json({ error: 'Thiếu lời bài hát.' });
    return;
  }

  // Tách lời bài hát thành từng câu
  const lines = lyrics.split(/\n/).filter(line => line.trim().length > 0);
  let sentences = lines;
  if (sentences.length < 3) {
    sentences = lyrics.split(/[.?!;:]/).filter(s => s.trim().length > 2).map(s => s.trim());
  }
  if (sentences.length > 20) sentences = sentences.slice(0, 20);
  if (sentences.length === 0) sentences = ['Bài hát này thật tuyệt vời!'];

  // Tạo prompt cho Gemini
  const prompt = `
Bạn là đạo diễn video âm nhạc chuyên nghiệp.
Tôi có một ảnh chân dung của ca sĩ và lời bài hát sau đây (đã được chia thành từng câu). 
Hãy tạo kịch bản video "hát nhép" (lip sync) cho từng câu hát, mỗi câu là một cảnh.

Yêu cầu:
- Mỗi cảnh sẽ dùng chính ảnh ca sĩ đó (không cần tạo ảnh mới).
- Mô tả chuyển động, góc quay, biểu cảm phù hợp với nội dung từng câu hát.
- Phụ đề là chính câu hát đó.
- Thời lượng mỗi cảnh khoảng 3-6 giây, tùy theo độ dài câu.

Trả về JSON với cấu trúc:
{
  "title": "Tên video (tự động từ nội dung bài hát)",
  "scenes": [
    {
      "visualIdea": "mô tả ngắn gọn chuyển động/cảnh quay cho câu hát này",
      "caption": "chính câu hát (phụ đề)",
      "narration": "hướng dẫn biểu cảm hoặc cảm xúc cho ca sĩ (ngắn)",
      "durationSec": số giây (3-6)
    }
  ]
}

CHỈ trả về JSON, không thêm văn bản khác.

Lời bài hát (từng câu):
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
            temperature: 0.7,
            maxOutputTokens: 2500,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      res.status(502).json({ error: 'Lỗi gọi Gemini', detail: errText.slice(0, 500) });
      return;
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      res.status(502).json({ error: 'AI trả về không đúng JSON.', raw: cleaned.slice(0, 800) });
      return;
    }

    if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
      res.status(502).json({ error: 'Kết quả AI thiếu danh sách cảnh.' });
      return;
    }

    res.status(200).json({
      title: (parsed.title || 'Video hát nhép').slice(0, 200),
      scenes: parsed.scenes.slice(0, 20).map((s) => ({
        visualIdea: (s.visualIdea || '').slice(0, 300),
        caption: (s.caption || '').slice(0, 200),
        narration: (s.narration || '').slice(0, 600),
        durationSec: Math.max(2, Math.min(8, Number(s.durationSec) || 4)),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi máy chủ: ' + (e.message || 'không rõ') });
  }
};
