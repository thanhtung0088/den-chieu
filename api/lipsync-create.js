// api/lipsync-create.js
// Nhận ảnh ca sĩ + audio bài hát (dạng base64 data URI) từ trình duyệt,
// gửi lên D-ID để tạo video "hát nhép" thật (khớp môi theo audio).
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

  const { imageBase64, audioBase64 } = req.body || {};
  if (!imageBase64 || !audioBase64) {
    return res.status(400).json({ error: 'Thiếu ảnh hoặc audio' });
  }

  try {
    // D-ID chấp nhận data URI trực tiếp cho ảnh nguồn và audio nếu dung lượng không quá lớn.
    // Giới hạn tham khảo: ảnh nên < 5MB, audio nên < ~15MB (bài hát dài/nặng có thể lỗi -> nên nén trước khi gửi).
    const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');

    const createRes = await fetch('https://api.d-id.com/talks', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_url: imageBase64, // data:image/...;base64,...
        script: {
          type: 'audio',
          audio_url: audioBase64, // data:audio/...;base64,...
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
        error: data.description || data.message || 'D-ID từ chối yêu cầu (có thể do ảnh/audio quá nặng hoặc không có khuôn mặt rõ trong ảnh)',
      });
    }

    return res.status(200).json({ id: data.id });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Lỗi khi gọi D-ID: ' + e.message });
  }
}
