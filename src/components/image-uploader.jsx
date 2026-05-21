// image-uploader.jsx — reusable drag-drop image uploader with crop-to-square.
//
// Usage:
//   <ImageUploader
//     value={imageUrl}               // current image URL (or null)
//     onChange={(url) => setUrl(url)} // called with the new public URL after upload
//     folder="menu-items"            // optional bucket sub-folder
//     label="Item photo"             // optional label
//   />
//
// The component:
//   1. Accepts a file via drag-drop or click.
//   2. Draws the image on a hidden <canvas> cropped to a square (centre-crop).
//   3. Calls uploadImage() from src/services/imageupload.js.
//   4. Calls onChange(publicUrl) on success.
//   5. Shows a preview with replace/remove controls.
//
// No external image-crop library is required — canvas is used for simplicity.

import React, { useCallback, useRef, useState } from 'react';
import { Upload, X, ImageIcon, Loader2 } from 'lucide-react';
import { uploadImage } from '@/services/imageupload';
import { cn } from '@/lib/utils';

// --------------------------------------------------------------------------
// Crop helper — returns a Blob of the centre-cropped square at targetSize px
// --------------------------------------------------------------------------
function cropToSquare(img, targetSize = 512) {
  const size = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - size) / 2;
  const sy = (img.naturalHeight - size) / 2;

  const canvas = document.createElement('canvas');
  canvas.width = targetSize;
  canvas.height = targetSize;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, sx, sy, size, size, 0, 0, targetSize, targetSize);

  return new Promise((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.88)
  );
}

// --------------------------------------------------------------------------
// Component
// --------------------------------------------------------------------------
export function ImageUploader({
  value,
  onChange,
  folder = 'uploads',
  label = 'Image',
  className,
  disabled = false,
}) {
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(value || null);
  const inputRef = useRef(null);

  // Sync preview when the `value` prop changes externally.
  React.useEffect(() => {
    setPreview(value || null);
  }, [value]);

  const handleFile = useCallback(
    async (file) => {
      if (!file || !file.type.startsWith('image/')) {
        setError('Please select an image file (jpg, png, gif, webp).');
        return;
      }
      setError(null);
      setUploading(true);

      try {
        // Show a local preview immediately while uploading.
        const objectUrl = URL.createObjectURL(file);
        setPreview(objectUrl);

        // Crop to square via canvas.
        const img = new Image();
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = objectUrl;
        });
        const croppedBlob = await cropToSquare(img);

        // Upload the cropped blob.
        const result = await uploadImage(croppedBlob, folder, file.name);
        URL.revokeObjectURL(objectUrl);

        if (!result.ok) {
          setError(result.error || 'Upload failed.');
          setPreview(value || null);
          return;
        }

        setPreview(result.publicUrl);
        onChange?.(result.publicUrl);
      } catch (err) {
        setError(err.message || 'Upload failed.');
        setPreview(value || null);
      } finally {
        setUploading(false);
      }
    },
    [folder, onChange, value]
  );

  const handleInputChange = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset input so the same file can be reselected.
    e.target.value = '';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    if (disabled || uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleRemove = () => {
    setPreview(null);
    setError(null);
    onChange?.(null);
  };

  const openPicker = () => {
    if (!disabled && !uploading) inputRef.current?.click();
  };

  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</p>
      )}

      {preview ? (
        // Preview state — show image with replace / remove controls.
        <div className="relative inline-block group">
          <img
            src={preview}
            alt="Upload preview"
            className="h-32 w-32 rounded-lg object-cover border border-gray-200 dark:border-gray-700"
          />
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
              <Loader2 className="h-6 w-6 animate-spin text-white" />
            </div>
          )}
          {!uploading && !disabled && (
            <div className="absolute inset-0 flex items-end justify-center gap-1 rounded-lg bg-black/0 group-hover:bg-black/30 transition-colors pb-2">
              <button
                type="button"
                onClick={openPicker}
                className="hidden group-hover:flex items-center gap-1 rounded bg-white/90 px-2 py-1 text-xs font-medium text-gray-800 shadow hover:bg-white"
              >
                <Upload className="h-3 w-3" />
                Replace
              </button>
              <button
                type="button"
                onClick={handleRemove}
                className="hidden group-hover:flex items-center rounded bg-red-500/90 p-1 text-white shadow hover:bg-red-600"
                aria-label="Remove image"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
        </div>
      ) : (
        // Drop zone.
        <div
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-label="Upload image"
          onClick={openPicker}
          onKeyDown={(e) => e.key === 'Enter' && openPicker()}
          onDragOver={(e) => { e.preventDefault(); if (!disabled) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={cn(
            'flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed',
            'h-32 w-32 cursor-pointer select-none transition-colors',
            dragging
              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950'
              : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-900',
            disabled && 'pointer-events-none opacity-50',
          )}
        >
          {uploading ? (
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          ) : (
            <>
              <ImageIcon className="h-6 w-6 text-gray-400" />
              <span className="text-[11px] text-gray-500 text-center px-1">
                Drop or click
              </span>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}

      {/* Hidden file input. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="sr-only"
        onChange={handleInputChange}
        disabled={disabled || uploading}
        aria-hidden="true"
      />
    </div>
  );
}

export default ImageUploader;
