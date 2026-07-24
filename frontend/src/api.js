const API = '/api'

export async function importZip(file) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API}/import`, { method: 'POST', body: form })
  if (!res.ok) throw new Error((await res.json()).detail || 'Import thất bại')
  return res.json()
}

export async function importSample(source = 'zip') {
  const res = await fetch(`${API}/import/sample?source=${source}`, { method: 'POST' })
  if (!res.ok) throw new Error((await res.json()).detail || 'Load mẫu thất bại')
  return res.json()
}

export async function fetchExcelTemplates() {
  const res = await fetch(`${API}/import/excel/templates`)
  if (!res.ok) throw new Error((await res.json()).detail || 'Không tải được danh sách template')
  return res.json()
}

export function excelTemplateDownloadUrl(templateId) {
  return `${API}/import/excel/templates/${templateId}`
}

export async function importExcel(file, { quizTitle, groupTitle } = {}) {
  const form = new FormData()
  form.append('file', file)
  if (quizTitle) form.append('quiz_title', quizTitle)
  if (groupTitle) form.append('group_title', groupTitle)
  const res = await fetch(`${API}/import/excel`, { method: 'POST', body: form })
  if (!res.ok) throw new Error((await res.json()).detail || 'Import Excel thất bại')
  return res.json()
}

export async function importExcelSample({ quizTitle, groupTitle } = {}) {
  const params = new URLSearchParams()
  if (quizTitle) params.set('quiz_title', quizTitle)
  if (groupTitle) params.set('group_title', groupTitle)
  const qs = params.toString()
  const res = await fetch(`${API}/import/excel/sample${qs ? `?${qs}` : ''}`, { method: 'POST' })
  if (!res.ok) throw new Error((await res.json()).detail || 'Import mẫu Excel thất bại')
  return res.json()
}

export async function importExcelFibWbSample({ quizTitle, groupTitle } = {}) {
  const params = new URLSearchParams()
  if (quizTitle) params.set('quiz_title', quizTitle)
  if (groupTitle) params.set('group_title', groupTitle)
  const qs = params.toString()
  const res = await fetch(`${API}/import/excel/fib-wb-sample${qs ? `?${qs}` : ''}`, { method: 'POST' })
  if (!res.ok) throw new Error((await res.json()).detail || 'Import mẫu FIB/WB thất bại')
  return res.json()
}

export async function importExcelMediaSample({ quizTitle, groupTitle } = {}) {
  const params = new URLSearchParams()
  if (quizTitle) params.set('quiz_title', quizTitle)
  if (groupTitle) params.set('group_title', groupTitle)
  const qs = params.toString()
  const res = await fetch(`${API}/import/excel/media-sample${qs ? `?${qs}` : ''}`, { method: 'POST' })
  if (!res.ok) throw new Error((await res.json()).detail || 'Import mẫu audio/video thất bại')
  return res.json()
}

export async function saveSession(sessionId, payload) {
  const res = await fetch(`${API}/session/${sessionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error((await res.json()).detail || 'Lưu thất bại')
  return res.json()
}

export async function exportSession(sessionId, title) {
  const res = await fetch(`${API}/session/${sessionId}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  })
  if (!res.ok) throw new Error((await res.json()).detail || 'Export thất bại')
  return res.blob()
}

export async function exportMedia(sessionId) {
  const res = await fetch(`${API}/session/${sessionId}/export-media`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error((await res.json()).detail || 'Export Media thất bại')
  return res.blob()
}

export async function exportMediaLocal(sessionId) {
  const res = await fetch(`${API}/session/${sessionId}/export-media-local`, {
    method: 'POST',
  })
  if (!res.ok) throw new Error((await res.json()).detail || 'Export Media Local thất bại')
  return res.json()
}

export async function exportSingleMediaLocal(sessionId, filename, targetName) {
  const res = await fetch(`${API}/session/${sessionId}/export-single-media-local`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename, target_name: targetName }),
  })
  if (!res.ok) throw new Error((await res.json()).detail || 'Export ảnh local thất bại')
  return res.json()
}

export async function uploadImage(sessionId, filename, file) {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API}/session/${sessionId}/asset/${encodeURIComponent(filename)}`, {
    method: 'POST',
    body: form,
  })
  if (!res.ok) throw new Error((await res.json()).detail || 'Upload ảnh thất bại')
  return res.json()
}

export async function uploadNewImage(sessionId, file) {
  const ext = (file?.name?.split('.').pop() || 'png').toLowerCase()
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replace(/-/g, '')
    : `${Date.now()}${Math.random().toString(16).slice(2)}`
  const filename = `img-${id.slice(0, 40)}.${ext}`
  const result = await uploadImage(sessionId, filename, file)
  return { ...result, filename }
}

export function assetUrl(sessionId, filename) {
  return `${API}/session/${sessionId}/asset/${encodeURIComponent(filename)}?t=${Date.now()}`
}

export function previewPlayerUrl(sessionId, options = {}) {
  const params = new URLSearchParams()
  if (options.reloadKey != null) params.set('t', String(options.reloadKey))
  if (options.slideId) params.set('slideId', options.slideId)
  if (options.qIndex != null && options.qIndex >= 0) params.set('qIndex', String(options.qIndex))
  if (options.editor) params.set('editor', '1')
  if (options.skipStart) params.set('skipStart', '1')
  if (options.slideRole) params.set('slideRole', options.slideRole)
  if (options.resultKind) params.set('resultKind', options.resultKind)
  const qs = params.toString()
  return `${API}/session/${sessionId}/preview/player${qs ? `?${qs}` : ''}`
}

export function packageResUrl(sessionId, path) {
  return `${API}/session/${sessionId}/res/${path}`
}