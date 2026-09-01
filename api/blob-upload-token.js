// api/blob-upload-token.js
// Cấp "vé" tạm thời để trình duyệt được phép tải file thẳng lên Vercel Blob,
// KHÔNG đi qua body của serverless function -> tránh lỗi 413 (payload too large).
//
// Cần: đã tạo 1 "Blob Store" trong project trên Vercel (Storage -> Create -> Blob)
// và liên kết vào project -> Vercel sẽ tự thêm biến BLOB_READ_WRITE_TOKEN, không cần tự nhập.

import { handleUpload } from '@vercel/blob/client';

export default async function handler(request, response) {
  const body = request.body;
  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        return {
          allowedContentTypes: ['image/*', 'audio/*'],
          addRandomSuffix: true,
          maximumSizeInBytes: 50 * 1024 * 1024, // 50MB, đủ cho ảnh + cả bài hát dài
        };
      },
      onUploadCompleted: async () => {
        // không cần làm gì thêm ở đây
      },
    });
    return response.status(200).json(jsonResponse);
  } catch (error) {
    console.error(error);
    return response.status(400).json({ error: error.message || 'Lỗi khi cấp quyền upload' });
  }
}
