// api/suggest-lipsync.js
// API gọi Gemini tạo kịch bản hát nhép – đã tối ưu, bắt lỗi JSON

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Chỉ hỗ trợ POST.' });
  }

  // Lấy API key từ biến môi trường
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Thiếu GEMINI_API_KEY. Hãy thêm biến môi trường trên Vercel.' });
  }

  // Parse body an toàn
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: 'Dữ liệu gửi lên không đúng định dạng JSON.' });
  }

  const { imageBase64, lyrics } = body;
  if (!imageBase64) {
    return res.status(400).json({ error: 'Thiếu ảnh (imageBase64).' });
  }
  if (!lyrics || lyrics.trim().length === 0) {
    return res.status(400).json({ error: 'Thiếu lời bài hát.' });
  }

  // Tách lời thành từng câu – ưu tiên xuống dòng, nếu ít thì tách theo dấu câu
  const lines = lyrics.split('\n').filter(line => line.trim().length > 0);
  let sentences = lines;
  if (sentences.length < 3) {
    sentences = lyrics.split(/[.?!;:]/).filter(s => s.trim().length > 2).map(s => s.trim());
  }
  if (sentences.length > 20) sentences = sentences.slice(0, 20);
  if (sentences.length === 0) sentences = ['Bài hát này thật tuyệt vời!'];

  // Prompt ngắn gọn, rõ ràng, yêu cầu JSON chính xác
  const prompt = `
Bạn là đạo diễn video âm nhạc. Tạo kịch bản hát nhép (lip sync) cho từng câu hát.
Mỗi câu là một cảnh, dùng chính ảnh ca sĩ đó.
Mô tả chuyển động, góc quay, biểu cảm phù hợp với nội dung câu hát.
Phụ đề là chính câu hát đó.
Thời lượng mỗi cảnh từ 3 đến 6 giây, tuỳ độ dài câu.

Trả về JSON duy nhất, không thêm bất kỳ văn bản nào khác, theo cấu trúc:
{
  "title": "Tên video ngắn gọn",
  "scenes": [
    {
      "visualIdea": "mô tả chuyển động/ góc quay",
      "caption": "câu hát (phụ đề)",
      "narration": "hướng dẫn biểu cảm",
      "durationSec": 4
    }
  ]
}

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
            temperature: 0.6,
            maxOutputTokens: 2500,
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      return res.status(502).json({
        error: 'Lỗi từ Gemini API',
        status: response.status,
        detail: errText.slice(0, 300),
      });
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    // Loại bỏ markdown code fence nếu có
    const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(502).json({
        error: 'AI trả về không đúng định dạng JSON.',
        raw: cleaned.slice(0, 500),
      });
    }

    if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
      return res.status(502).json({ error: 'Kết quả AI thiếu danh sách cảnh.' });
    }

    // Chuẩn hóa dữ liệu trả về
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
