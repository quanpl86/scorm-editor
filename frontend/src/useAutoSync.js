import { useEffect, useRef, useState } from 'react'
import { saveSession } from './api'
import { quizHasDirtyFlags } from './useQuizHistory'

export function useAutoSync({
  quiz,
  buildPayload,
  applySavedState,
  debounceMs = 700,
  paused = false,
}) {
  const [previewRevision, setPreviewRevision] = useState(0)
  const [autoSaving, setAutoSaving] = useState(false)
  const timerRef = useRef(null)
  const quizRef = useRef(quiz)
  quizRef.current = quiz

  useEffect(() => {
    if (paused || !quiz || !quizHasDirtyFlags(quiz)) return undefined

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      const current = quizRef.current
      if (!current || !quizHasDirtyFlags(current)) return
      setAutoSaving(true)
      try {
        const saved = await saveSession(current.sessionId, buildPayload(current))
        applySavedState(saved)
        setPreviewRevision((r) => r + 1)
      } catch (err) {
        console.error('Auto-sync failed:', err)
      } finally {
        setAutoSaving(false)
      }
    }, debounceMs)

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [quiz, buildPayload, applySavedState, debounceMs, paused])

  const bumpPreviewRevision = () => setPreviewRevision((r) => r + 1)

  return { previewRevision, autoSaving, bumpPreviewRevision }
}