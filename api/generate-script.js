// api/generate-script.js
// Vercel Serverless Function — proxy gọi Anthropic API để viết kịch bản video.
// Giữ API key ở server, KHÔNG bao giờ lộ ra phía trình duyệt.
//
// Cách cấu hình:
//  1. Lấy API key tại https://console.anthropic.com (mục API Keys)
//  2. Vào Vercel Project Settings → Environment Variables
//  3. Thêm biến: ANTHROPIC_API_KEY = <key của Thầy>
//  4. Redeploy lại project để biến môi trường có hiệu lực.

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Chỉ hỗ trợ phương thức POST.' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'Server chưa cấu hình ANTHROPIC_API_KEY. Hãy thêm biến môi trường này trong Vercel Project Settings rồi deploy lại.' });
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
    gdcd: 'Đây là video bài giảng môn Giáo dục công dân (GDCD) cấp Trung học cơ sở tại Việt Nam. Văn phong chuẩn mực, dễ hiểu với học sinh, mang tính giáo dục, tránh nói quá hoặc gây tranh cãi, phù hợp môi trường lớp học.',
    song: 'Đây là video quảng bá / giới thiệu một sáng tác âm nhạc tiếng Việt. Văn phong giàu cảm xúc, lôi cuốn, phù hợp đăng lên mạng xã hội.',
    other: 'Đây là một video ngắn nói chung, dùng cho mục đích cá nhân. Văn phong tự nhiên, mạch lạc, dễ nghe.',
  }[purpose];

  const systemPrompt = [
    'Bạn là biên kịch video chuyên nghiệp, viết bằng tiếng Việt tự nhiên, trong sáng.',
    purposeGuide,
    'Nhiệm vụ: chia nội dung người dùng mô tả thành khoảng ' + sceneCountHint + ' cảnh video ngắn nối tiếp nhau, mạch lạc từ mở đầu đến kết thúc.',
    'Mỗi cảnh gồm các trường:',
    '- "visualIdea": mô tả ngắn gọn hình ảnh nên dùng cho cảnh này (để người dùng tự tìm hoặc chụp ảnh phù hợp), không cần văn hoa.',
    '- "caption": phụ đề ngắn hiện trên màn hình, dưới 18 từ, súc tích.',
    '- "narration": lời đọc/thuyết minh đầy đủ cho cảnh, khoảng 1-3 câu, viết để đọc thành tiếng tự nhiên.',
    '- "durationSec": số giây đề xuất cho cảnh (ước lượng theo tốc độ đọc lời thoại, khoảng 150 từ/phút tiếng Việt), trong khoảng 3-12.',
    'CHỈ trả lời bằng một khối JSON hợp lệ duy nhất theo đúng cấu trúc sau, không thêm bất kỳ chữ nào khác, không dùng markdown code fence:',
    '{"title": string, "scenes": [{"visualIdea": string, "caption": string, "narration": string, "durationSec": number}]}',
  ].join(' ');

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 2200,
        system: systemPrompt,
        messages: [{ role: 'user', content: 'Chủ đề / mô tả video: ' + topic }],
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      res.status(502).json({ error: 'Lỗi gọi AI (mã ' + upstream.status + ').', detail: errText.slice(0, 500) });
      return;
    }

    const data = await upstream.json();
    const textBlock = (data.content || []).find((b) => b.type === 'text');
    const raw = textBlock ? textBlock.text : '';
    const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      res.status(502).json({ error: 'AI trả về không đúng định dạng JSON.', raw: cleaned.slice(0, 800) });
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
    res.status(500).json({ error: 'Lỗi máy chủ: ' + (e && e.message ? e.message : 'không rõ nguyên nhân') });
  }
};
