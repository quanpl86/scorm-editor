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

export function assetUrl(sessionId, filename) {
  return `${API}/session/${sessionId}/asset/${encodeURIComponent(filename)}?t=${Date.now()}`
}

export function previewPlayerUrl(sessionId) {
  return `${API}/session/${sessionId}/preview/player`
}

export function packageResUrl(sessionId, path) {
  return `${API}/session/${sessionId}/res/${path}`
}