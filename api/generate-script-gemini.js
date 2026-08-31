// api/generate-script-gemini.js
// Dùng Gemini 2.5 Flash để viết kịch bản video.
// Cần cài biến môi trường GEMINI_API_KEY trên Vercel.

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Chỉ hỗ trợ POST.' });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Thiếu GEMINI_API_KEY. Hãy thêm biến môi trường này trong Vercel.' });
    return;
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const topic = (body.topic || '').toString().trim().slice(0, 800);
  const purpose = ['gdcd', 'song', 'other'].includes(body.purpose) ? body.purpose : 'other';
  const sceneCountHint = Math.max(3, Math.min(12, parseInt(body.sceneCountHint, 10) || 6));

  if (!topic) {
    res.status(400).json({ error: 'Thiếu nội dung mô tả chủ đề (topic).' });
    return;
  }

  const purposeGuide = {
    gdcd: 'Đây là video bài giảng GDCD cấp THCS tại Việt Nam. Văn phong chuẩn mực, dễ hiểu, mang tính giáo dục.',
    song: 'Đây là video quảng bá một sáng tác âm nhạc tiếng Việt. Văn phong giàu cảm xúc, lôi cuốn.',
    other: 'Đây là một video ngắn nói chung. Văn phong tự nhiên, mạch lạc, dễ nghe.',
  }[purpose];

  const prompt = `
Bạn là biên kịch video chuyên nghiệp, viết bằng tiếng Việt tự nhiên.
${purposeGuide}
Nhiệm vụ: chia nội dung người dùng mô tả thành khoảng ${sceneCountHint} cảnh video ngắn.
Mỗi cảnh gồm:
- "visualIdea": mô tả ngắn gọn hình ảnh cho cảnh này.
- "caption": phụ đề ngắn, dưới 18 từ.
- "narration": lời thuyết minh, khoảng 1-3 câu.
- "durationSec": số giây đề xuất (3-12 giây).
CHỈ trả lời bằng một khối JSON hợp lệ, không thêm bất kỳ chữ nào khác, theo cấu trúc:
{"title": string, "scenes": [{"visualIdea": string, "caption": string, "narration": string, "durationSec": number}]}

Chủ đề: ${topic}
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
            maxOutputTokens: 2200,
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
      title: (parsed.title || '').toString().slice(0, 200),
      scenes: parsed.scenes.slice(0, 12).map((s) => ({
        visualIdea: (s.visualIdea || '').toString().slice(0, 300),
        caption: (s.caption || '').toString().slice(0, 200),
        narration: (s.narration || '').toString().slice(0, 600),
        durationSec: Math.max(2, Math.min(30, Number(s.durationSec) || 5)),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: 'Lỗi máy chủ: ' + (e && e.message ? e.message : 'không rõ') });
  }
};
