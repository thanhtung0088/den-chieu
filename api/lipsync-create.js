// api/lipsync-create.js
// Nhận LINK (URL) ảnh ca sĩ + LINK audio bài hát (đã upload sẵn lên Vercel Blob)
// -> gửi cho D-ID để tạo video "hát nhép" thật (khớp môi theo audio).
// Dùng URL thay vì base64 để tránh lỗi 413 (Vercel giới hạn body function ~4.5MB).
// D-ID xử lý bất đồng bộ -> hàm này chỉ TẠO job, không đợi xong.
// Trình duyệt sẽ gọi /api/lipsync-status?id=... để hỏi kết quả (xem file kia).
//
// Cần thêm biến môi trường DID_API_KEY trên Vercel (Project Settings -> Environment Variables)
// Lấy API key tại: https://studio.d-id.com -> Account Settings -> API Keys

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Chỉ chấp nhận POST' });
  }

  const apiKey = process.env.DID_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Chưa cấu hình DID_API_KEY trên Vercel' });
  }

  const { imageUrl, audioUrl } = req.body || {};
  if (!imageUrl || !audioUrl) {
    return res.status(400).json({ error: 'Thiếu link ảnh hoặc link audio' });
  }

  try {
    const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');

    const createRes = await fetch('https://api.d-id.com/talks', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_url: imageUrl,
        script: {
          type: 'audio',
          audio_url: audioUrl,
        },
        config: {
          fluent: true,
          pad_audio: 0,
        },
      }),
    });

    const data = await createRes.json();

    if (!createRes.ok) {
      return res.status(createRes.status).json({
        error: data.description || data.message || 'D-ID từ chối yêu cầu (có thể ảnh không có khuôn mặt rõ, hoặc link không truy cập được)',
      });
    }

    return res.status(200).json({ id: data.id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Lỗi khi gọi D-ID: ' + e.message });
  }
}
