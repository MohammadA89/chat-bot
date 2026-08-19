/**
 * Turning what the user drops into the composer into something a vision model
 * will accept: image files only, downscaled so a screenshot does not blow up
 * the request body — or the browser's storage quota when the chat is saved.
 */
import type { Attachment } from '../types'
import { uid } from './utils'

/** Formats both providers accept as inline base64 image blocks. */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

export const ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_TYPES.join(',')

/** Longest edge kept after downscaling; matches what vision models sample at. */
const MAX_EDGE = 1400

/** Refuse anything larger before decoding it, so a huge file can't hang the tab. */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024

/** Most images allowed on a single message. */
export const MAX_ATTACHMENTS = 4

export function isSupportedImage(file: File): boolean {
  return (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)
}

/** Bytes a `data:` URL carries once its base64 payload is decoded. */
export function dataUrlBytes(dataUrl: string): number {
  const payload = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('فایل خوانده نشد.'))
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('این فایل یک تصویر معتبر نیست.'))
    image.src = src
  })
}

/**
 * Reads one image file into an attachment, downscaling it when it is bigger
 * than `MAX_EDGE`. Animated GIFs are passed through untouched — redrawing one
 * on a canvas would keep only its first frame.
 */
export async function fileToAttachment(file: File): Promise<Attachment> {
  if (!isSupportedImage(file)) {
    throw new Error(`«${file.name}» تصویر پشتیبانی‌شده نیست (PNG، JPEG، WebP یا GIF).`)
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error(`«${file.name}» بزرگ‌تر از ۲۰ مگابایت است.`)
  }

  const original = await readAsDataUrl(file)
  const image = await loadImage(original)
  const scale = Math.min(1, MAX_EDGE / Math.max(image.naturalWidth, image.naturalHeight))

  const base: Attachment = {
    id: uid(),
    name: file.name || 'image',
    mimeType: file.type,
    size: file.size,
    width: image.naturalWidth,
    height: image.naturalHeight,
    dataUrl: original,
  }

  if (scale === 1 || file.type === 'image/gif') return base

  const width = Math.round(image.naturalWidth * scale)
  const height = Math.round(image.naturalHeight * scale)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return base

  ctx.drawImage(image, 0, 0, width, height)
  // PNG screenshots re-encode far smaller as JPEG; anything with alpha stays PNG.
  const targetType = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  const resized = canvas.toDataURL(targetType, 0.85)

  return {
    ...base,
    mimeType: targetType,
    size: dataUrlBytes(resized),
    width,
    height,
    dataUrl: resized,
  }
}

/** Pulls the image files out of a paste or drop, ignoring everything else. */
export function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return []
  return [...data.files].filter(isSupportedImage)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
