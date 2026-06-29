import { CANVAS_H, CANVAS_W, clampRect } from './layoutUtils'

export function nextObjectIndex(objects) {
  if (!objects?.length) return 0
  return Math.max(...objects.map((o) => o.index)) + 1
}

export function defaultPictureRect(objects, { w = 200, h = 150 } = {}) {
  const count = objects?.filter((o) => o.role === 'slidePicture' || o.role === 'image').length || 0
  const col = count % 2
  const row = Math.floor(count / 2)
  return clampRect({
    x: 48 + col * (w + 24),
    y: 72 + row * (h + 20),
    w,
    h,
  })
}

export function createSlidePictureObject(objects, name) {
  const index = nextObjectIndex(objects)
  const pictureCount = objects.filter((o) => o.role === 'slidePicture').length
  const label = name || `Slide Picture ${pictureCount + 1}`
  return {
    index,
    tp: 'slidePicture',
    I: label,
    name: `Ảnh slide — ${label}`,
    role: 'slidePicture',
    r: defaultPictureRect(objects),
    image: null,
    selectable: true,
    locked: false,
    isNew: true,
  }
}

export function createImageObject(objects, name, image = null) {
  const index = nextObjectIndex(objects)
  const imageCount = objects.filter((o) => o.role === 'image').length
  const label = name || `Picture ${imageCount + 1}`
  return {
    index,
    tp: 'image',
    I: label,
    name: `Ảnh — ${label}`,
    role: 'image',
    r: defaultPictureRect(objects, { w: 180, h: 130 }),
    image,
    selectable: true,
    locked: false,
    isNew: true,
  }
}

export function buildLayoutPatch(question, objects, extra = {}) {
  const zOrder = extra.zOrder || objects.map((o) => o.index)
  const patch = {
    ...question.layout,
    objects,
    zOrder,
    overlaps: extra.overlaps,
    removedIndexes: extra.removedIndexes ?? question.layout?.removedIndexes,
  }
  if (extra.slideAttachment !== undefined) patch.slideAttachment = extra.slideAttachment
  return patch
}

export function newImageFilename(file) {
  const ext = (file?.name?.split('.').pop() || 'png').toLowerCase()
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now()}${Math.random().toString(16).slice(2)}`
  return `img-${id.slice(0, 40)}.${ext}`
}

export function canDeleteCanvasObject(obj) {
  return !!obj?.isNew
}