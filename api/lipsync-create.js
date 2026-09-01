// api/lipsync-create.js
// Nhận ảnh ca sĩ + audio bài hát (dạng base64 data URI, đã được nén nhỏ ở
// trình duyệt trước khi gửi) -> gửi cho D-ID để tạo video "hát nhép" thật.
//
// LƯU Ý: không dùng Vercel Blob nữa vì tính năng client-upload của Vercel Blob
// đang có lỗi CORS ở phía nền tảng (Vercel xác nhận, chưa có thời gian sửa).
// Gửi thẳng base64 qua serverless function này; trình duyệt đã tự nén audio
// (mono, giảm sample rate) + ảnh (resize, nén JPEG) trước để không vượt giới
// hạn 4.5MB của Vercel Functions.
//
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
    const authHeader = 'Basic ' + Buffer.from(apiKey + ':').toString('base64');

    const createRes = await fetch('https://api.d-id.com/talks', {
      method: 'POST',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_url: imageBase64, // data:image/jpeg;base64,...
        script: {
          type: 'audio',
          audio_url: audioBase64, // data:audio/wav;base64,...
        },
        config: {
          fluent: true,
          pad_audio: 0,
        },
      }),
    });

    const data = await createRes.json();

    if (!createRes.ok) {
      return res.status(createRes.status).js
