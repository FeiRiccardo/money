import type { AttachmentInput } from '../domain/types';

export const MAX_PHOTOS = 5;
const MAX_SIDE = 1280;
const QUALITY = 0.8;

/**
 * Shrinks a picked image to at most 1280px on its longest side and re-encodes it as JPEG, so a 4 MB phone
 * photo costs about 150 KB. Rejects when the file is not an image the browser can decode.
 */
export async function shrinkImage(file: File): Promise<AttachmentInput> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('no canvas');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!blob) throw new Error('could not encode');
    return { mime: 'image/jpeg', data: await blob.arrayBuffer() };
  } finally {
    bitmap.close();
  }
}

/** A temporary URL to show stored photo bytes in an <img>. Revoke it when done. */
export function photoUrl(photo: AttachmentInput): string {
  return URL.createObjectURL(new Blob([photo.data], { type: photo.mime }));
}
