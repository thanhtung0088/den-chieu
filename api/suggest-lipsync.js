// api/suggest-lipsync.js
// Dùng Gemini 2.5 Flash (Experimental) – bắt buộc trả về JSON

module.exports = async (req, res) => {
  // Chỉ cho phép POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Chỉ hỗ trợ POST.' });
  }

  // Lấy API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('❌ Thiếu GEMINI_API_KEY');
    return res.status(500).json({ error: 'Thiếu GEMINI_API_KEY. Hãy thêm biến môi trường trên Vercel.' });
  }

  // Parse body
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch (e) {
    return res.status(400).json({ error: 'Dữ liệu không đúng JSON.' });
  }

  const { imageBase64, lyrics } = body;
  if (!imageBase64) {
    return res.status(400).json({ error: 'Thiếu ảnh (imageBase64).' });
  }
  if (!lyrics || lyrics.trim().length === 0) {
    return res.status(400).json({ error: 'Thiếu lời bài hát.' });
  }

  // Chia lời thành câu
  const lines = lyrics.split('\n').filter(line => line.trim().length > 0);
  let sentences = lines;
  if (sentences.length < 3) {
    sentences = lyrics.split(/[.?!;:]/).filter(s => s.trim().length > 2).map(s => s.trim());
  }
  if (sentences.length > 20) sentences = sentences.slice(0, 20);
  if (sentences.length === 0) sentences = ['Bài hát này thật tuyệt vời!'];

  // Prompt yêu cầu JSON rõ ràng
  const prompt = `
Bạn là đạo diễn video. Tạo kịch bản hát nhép (lip sync) cho từng câu hát.
Mỗi câu là một cảnh, dùng ảnh ca sĩ.
Mô tả chuyển động, góc quay, biểu cảm.
Phụ đề là chính câu hát đó.
Thời lượng mỗi cảnh từ 3 đến 6 giây.

QUAN TRỌNG: CHỈ trả về JSON hợp lệ, không thêm bất kỳ văn bản nào khác.

Cấu trúc JSON:
{
  "title": "Tên video ngắn gọn",
  "scenes": [
    {
      "visualIdea": "mô tả chuyển động/góc quay",
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
    // Dùng Gemini 2.5 Flash
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,          // Giảm temperature để JSON ổn định hơn
            maxOutputTokens: 2500,
            responseMimeType: 'application/json', // ⭐ BẮT BUỘC TRẢ VỀ JSON
          },
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('❌ Gemini error:', response.status, errText);
      return res.status(502).json({
        error: 'Gemini API lỗi',
        status: response.status,
        detail: errText.slice(0, 300),
      });
    }

    const data = await response.json();
    
    // Lấy text từ response
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    console.log('📝 Raw response:', rawText.slice(0, 200));

    // Nếu đã có responseMimeType: 'application/json', rawText là JSON luôn
    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      // Fallback: thử làm sạch nếu vẫn bị markdown
      const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
      try {
        parsed = JSON.parse(cleaned);
      } catch (e2) {
        console.error('❌ Lỗi parse JSON:', rawText.slice(0, 500));
        return res.status(502).json({
          error: 'AI trả về không đúng JSON.',
          raw: rawText.slice(0, 500),
        });
      }
    }

    // Kiểm tra cấu trúc
    if (!parsed || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
      return res.status(502).json({ error: 'Thiếu danh sách cảnh.' });
    }

    // Trả về kết quả
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
    console.error('❌ Lỗi server:', e);
    return res.status(500).json({ error: 'Lỗi máy chủ: ' + e.message });
  }
};
