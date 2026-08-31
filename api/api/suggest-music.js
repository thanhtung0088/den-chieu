// api/suggest-music.js
// Gọi Gemini gợi ý nhạc nền dựa trên kịch bản

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

  const title = (body.title || 'video').slice(0, 100);
  const script = (body.script || '').slice(0, 2000);

  if (!script) {
    res.status(400).json({ error: 'Thiếu nội dung kịch bản (script).' });
    return;
  }

  const prompt = `
Bạn là chuyên gia âm nhạc cho video. Dựa trên kịch bản video sau, hãy gợi ý 3 bài nhạc nền phù hợp (có thể là nhạc không lời hoặc có lời, tùy theo cảm xúc của video). 
Mỗi gợi ý bao gồm: tên bài hát, nghệ sĩ, thể loại, và lý do chọn (ngắn gọn).

Kịch bản:
Tiêu đề: ${title}
Nội dung:
${script}

Hãy trả lời bằng văn bản tiếng Việt, trình bày rõ ràng, không cần JSON. Chỉ đưa ra gợi ý, không thêm lời giới thiệu.
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
            maxOutputTokens: 1000,
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
    const suggestion = data.candidates?.[0]?.content?.parts?.[0]?.text || 'Không có gợi ý.';

    res.status(200).json({ suggestion });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi máy chủ: ' + (e.message || 'không rõ') });
  }
};
