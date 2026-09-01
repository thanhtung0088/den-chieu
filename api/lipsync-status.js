// api/lipsync-status.js
// Trình duyệt gọi lặp lại (mỗi 3 giây) endpoint này với ?id=... để hỏi
// D-ID đã dựng xong video hát nhép chưa.
// status trả về: "created" | "started" (đang xử lý) hoặc "done" (xong, có result_url) | "error"
//
// LƯU Ý: API key của D-ID đã có sẵn dấu hai chấm bên trong (dạng
// API_USER:API_PASSWORD) -> chỉ encode base64 nguyên key, KHÔNG được nối
// thêm ':' vào cuối (khác với kiểu OpenAI/Anthropic).

export default async function handler(req, res) {
  const apiKey = process.env.DID_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Chưa cấu hình DID_API_KEY trên Vercel' });
  }

  const { id } = req.query || {};
  if (!id) {
    return res.status(400).json({ error: 'Thiếu id job' });
  }

  try {
    const authHeader = 'Basic ' + Buffer.from(apiKey).toString('base64');
    const r = await fetch('https://api.d-id.com/talks/' + id, {
      headers: { 'Authorization': authHeader },
    });
    const data = await r.json();

    if (!r.ok) {
      return res.status(r.status).json({ error: data.description || data.message || 'Lỗi khi hỏi trạng thái' });
    }

    return res.status(200).json({
      status: data.status, // created | started | done | error
      result_url: data.result_url || null,
      error: data.error || null,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Lỗi khi gọi D-ID: ' + e.message });
  }
}
