// imageupload.js — service layer for POST /uploads/image.
//
// Returns a presigned PUT URL from the backend so the browser can stream the
// file directly to object storage without routing bytes through the API server.

import { api } from '@/lib/api-client';

/**
 * Request a presigned PUT URL for an image upload.
 *
 * @param {File} file       — The File object selected or dropped by the user.
 * @param {string} [folder] — Optional sub-folder prefix in the bucket (e.g. "menu-items").
 *
 * Returns:
 *   { ok: true, data: { presigned_url, public_url, key, expires_at } }
 *   { ok: false, error: string }
 */
export async function requestPresignedUrl(file, folder = 'uploads') {
  const { data, error } = await api.request('POST', '/uploads/image', {
    auth: true,
    body: {
      filename: file.name,
      folder,
    },
  });

  if (error) {
    return { ok: false, error: error.message || 'Failed to get upload URL.' };
  }
  return { ok: true, data };
}

/**
 * Upload a Blob/File directly to object storage using the presigned PUT URL.
 *
 * @param {string} presignedUrl  — URL returned by requestPresignedUrl.
 * @param {Blob}   blob          — The image data to upload (may be a cropped canvas blob).
 * @param {string} [contentType] — MIME type; defaults to blob.type || 'image/jpeg'.
 *
 * Returns:
 *   { ok: true }
 *   { ok: false, error: string }
 */
export async function putToStorage(presignedUrl, blob, contentType) {
  try {
    const type = contentType || blob.type || 'image/jpeg';
    const resp = await fetch(presignedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': type },
      body: blob,
    });
    if (!resp.ok) {
      return { ok: false, error: `Storage upload failed: ${resp.status} ${resp.statusText}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || 'Network error during upload.' };
  }
}

/**
 * Full upload flow: request presigned URL → PUT blob → return public URL.
 *
 * @param {File|Blob} file      — The image (original or cropped blob).
 * @param {string}    [folder]  — Bucket sub-folder.
 * @param {string}    [name]    — Override filename (used when file is a Blob without .name).
 *
 * Returns:
 *   { ok: true, publicUrl: string }
 *   { ok: false, error: string }
 */
export async function uploadImage(file, folder = 'uploads', name) {
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

  return { ok: true, publicUrl: public_url };
}
