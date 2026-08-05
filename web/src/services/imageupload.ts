// imageupload.js — service layer for POST /uploads/image.
//
// Returns a presigned PUT URL from the backend so the browser can stream the
// file directly to object storage without routing bytes through the API server.

import { api } from '@/lib/api-client';

export interface PresignedUpload {
  presigned_url: string;
  public_url: string;
  key: string;
  expires_at: string;
}

/**
 * Request a presigned PUT URL for an image upload.
 *
 * @param file       — The File object selected or dropped by the user.
 * @param folder — Optional sub-folder prefix in the bucket (e.g. "menu-items").
 */
export async function requestPresignedUrl(file: File, folder = 'uploads') {
  const { data, error } = await api.request<PresignedUpload>('POST', '/uploads/image', {
    auth: true,
    body: {
      filename: file.name,
      folder,
    },
  });

  if (error) {
    return { ok: false as const, error: error.message || 'Failed to get upload URL.' };
  }
  return { ok: true as const, data: data! };
}

/**
 * Upload a Blob/File directly to object storage using the presigned PUT URL.
 *
 * @param presignedUrl  — URL returned by requestPresignedUrl.
 * @param blob          — The image data to upload (may be a cropped canvas blob).
 * @param contentType — MIME type; defaults to blob.type || 'image/jpeg'.
 */
export async function putToStorage(presignedUrl: string, blob: Blob, contentType?: string) {
  try {
    const type = contentType || blob.type || 'image/jpeg';
    const resp = await fetch(presignedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': type },
      body: blob,
    });
    if (!resp.ok) {
      return { ok: false as const, error: `Storage upload failed: ${resp.status} ${resp.statusText}` };
    }
    return { ok: true as const };
  } catch (err) {
    return { ok: false as const, error: (err as Error)?.message || 'Network error during upload.' };
  }
}

/**
 * Full upload flow: request presigned URL → PUT blob → return public URL.
 *
 * @param file      — The image (original or cropped blob).
 * @param folder  — Bucket sub-folder.
 * @param name    — Override filename (used when file is a Blob without .name).
 */
export async function uploadImage(file: File | Blob, folder = 'uploads', name?: string) {
  // Synthesise a File-like object when the caller passes a raw Blob.
  const asFile =
    file instanceof File
      ? file
      : new File([file], name || 'image.jpg', { type: file.type || 'image/jpeg' });

  const presignResult = await requestPresignedUrl(asFile, folder);
  if (!presignResult.ok) return presignResult;

  const { presigned_url, public_url } = presignResult.data;

  const putResult = await putToStorage(presigned_url, asFile, asFile.type);
  if (!putResult.ok) return putResult;

  return { ok: true as const, publicUrl: public_url };
}
