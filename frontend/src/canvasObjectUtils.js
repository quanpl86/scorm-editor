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
    imageZoom: true,
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
    imageZoom: false,
    selectable: true,
    locked: false,
    isNew: true,
  }
}

export function defaultImageZoom(role) {
  return objectMediaRole({ role }) === 'slidePicture'
}

export function objectMediaRole(obj) {
  return obj?.role || obj?.tp || ''
}

export function isImageCanvasObject(obj) {
  const role = objectMediaRole(obj)
  return role === 'slidePicture' || role === 'image'
}

export function resolveSlideAttachment(layout = {}) {
  if (layout.slideAttachment != null) return layout.slideAttachment || null
  if (layout.slidePicture != null) return layout.slidePicture || null
  const frame = (layout.objects || []).find(
    (o) => isImageCanvasObject(o) && objectMediaRole(o) === 'slidePicture' && o.image,
  )
  return frame?.image || null
}

export function resolveSlideAttachmentZoom(layout = {}) {
  if (layout.slideAttachmentZoom != null) return !!layout.slideAttachmentZoom
  const frame = (layout.objects || []).find(
    (o) => isImageCanvasObject(o) && objectMediaRole(o) === 'slidePicture',
  )
  if (frame?.imageZoom != null) return !!frame.imageZoom
  return true
}

export function normalizeLayoutObjects(objects, layout = {}) {
  const slideZoom = layout.slideAttachmentZoom
  return (objects || []).map((obj) => {
    if (!isImageCanvasObject(obj)) return obj
    if (obj.imageZoom != null) return obj
    const role = objectMediaRole(obj)
    let imageZoom = defaultImageZoom(role)
    if (role === 'slidePicture' && slideZoom != null) {
      imageZoom = !!slideZoom
    }
    return { ...obj, imageZoom }
  })
}

function hasRicherText(prior, incoming) {
  if (!prior) return false
  const priorHtml = prior.html?.trim()
  const incomingHtml = incoming?.html?.trim()
  if (priorHtml && priorHtml !== incomingHtml) {
    if (!incomingHtml || priorHtml.length > incomingHtml.length) return true
  }
  if (prior.textFormat && JSON.stringify(prior.textFormat) !== JSON.stringify(incoming?.textFormat)) {
    return true
  }
  return false
}

/** Giữ field local khi parent trả về objects thiếu / cũ (race sync / save). */
export function mergeLayoutObjects(incoming, prev, layout = {}) {
  const normalized = normalizeLayoutObjects(incoming, layout)
  if (!prev?.length) return normalized
  const prevMap = new Map(prev.map((o) => [o.index, o]))
  const rawIncoming = incoming || []
  return normalized.map((obj) => {
    const prior = prevMap.get(obj.index)
    const raw = rawIncoming.find((o) => o.index === obj.index)
    let merged = obj

    if (isImageCanvasObject(obj) && prior && raw && raw.imageZoom == null && prior.imageZoom != null) {
      merged = { ...merged, imageZoom: prior.imageZoom }
    }

    if (prior && (obj.role === 'direction' || obj.role === 'content') && hasRicherText(prior, obj)) {
      merged = {
        ...merged,
        html: prior.html ?? merged.html,
        text: prior.text ?? merged.text,
        textFormat: prior.textFormat ?? merged.textFormat,
      }
    }

    return merged
  })
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
  if (extra.slideAttachmentZoom !== undefined) patch.slideAttachmentZoom = extra.slideAttachmentZoom
  return patch
}

/** Payload layout gửi server — luôn gồm imageZoom + slideAttachmentZoom. */
export function sanitizeLayoutForSave(layout) {
  if (!layout) return null
  const objects = layout.objects || []
  const hasSlidePicture = objects.some(
    (o) => isImageCanvasObject(o) && objectMediaRole(o) === 'slidePicture',
  )
  const attachment = resolveSlideAttachment(layout)

  const payload = {
    objects: objects.map((obj) => {
      const row = { index: obj.index, r: obj.r }
      if (obj.remove) row.remove = true
      if (obj.image != null) row.image = obj.image
      if (isImageCanvasObject(obj)) {
        row.imageZoom = !!(obj.imageZoom ?? defaultImageZoom(objectMediaRole(obj)))
      }
      return row
    }),
    zOrder: layout.zOrder,
  }

  const added = objects.filter((o) => o.isNew)
  if (added.length) {
    payload.addedObjects = added.map((o) => ({
      tp: o.tp || o.role,
      role: o.role || o.tp,
      I: o.I || o.name,
      name: o.name,
      r: o.r,
      image: o.image || null,
      imageZoom: isImageCanvasObject(o)
        ? !!(o.imageZoom ?? defaultImageZoom(objectMediaRole(o)))
        : null,
    }))
  }

  if (layout.removedIndexes?.length) payload.removedIndexes = layout.removedIndexes
  if (attachment) payload.slideAttachment = attachment
  if (hasSlidePicture) payload.slideAttachmentZoom = resolveSlideAttachmentZoom(layout)

  const choiceColumns = layout.choiceColumns ?? layout.choicePreview?.layout?.columns
  if (choiceColumns != null) {
    const maxCols = layout.choicePreview?.type === 'TrueFalse' ? 2 : 4
    const cols = Math.max(1, Math.min(maxCols, Math.round(Number(choiceColumns) || 1)))
    payload.choiceColumns = cols
  }

  return payload
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