import { useCallback, useRef, useState } from 'react'

const MAX_HISTORY = 50
const BURST_IDLE_MS = 600

export function cloneQuiz(quiz) {
  if (!quiz) return null
  return structuredClone(quiz)
}

export function quizHasDirtyFlags(quiz) {
  if (!quiz) return false
  const slideDirty = (s) => s && Object.keys(s).some((k) => k.startsWith('_dirty'))
  if (slideDirty(quiz.introSlide)) return true
  if (quiz.resultSlides?.some(slideDirty)) return true
  return (quiz.questions || []).some((q) => q.deleted || slideDirty(q))
}

export function useQuizHistory(initialQuiz = null) {
  const [quiz, setQuizState] = useState(initialQuiz)
  const pastRef = useRef([])
  const futureRef = useRef([])
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false })

  const burstSnapshottedRef = useRef(false)
  const burstTimerRef = useRef(null)

  const syncHistoryFlags = useCallback(() => {
    setHistoryState({
      canUndo: pastRef.current.length > 0,
      canRedo: futureRef.current.length > 0,
    })
  }, [])

  const pushPast = useCallback((snapshot) => {
    if (!snapshot) return
    pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), cloneQuiz(snapshot)]
    futureRef.current = []
    syncHistoryFlags()
  }, [syncHistoryFlags])

  const endBurst = useCallback(() => {
    burstSnapshottedRef.current = false
  }, [])

  const scheduleBurstEnd = useCallback(() => {
    if (burstTimerRef.current) clearTimeout(burstTimerRef.current)
    burstTimerRef.current = setTimeout(endBurst, BURST_IDLE_MS)
  }, [endBurst])

  const setQuiz = useCallback((updater, options = {}) => {
    const { recordHistory = true, burst = false } = options
    setQuizState((prev) => {
      if (!prev) return prev
      const next = typeof updater === 'function' ? updater(prev) : updater
      if (next === prev) return prev

      if (recordHistory) {
        if (burst) {
          if (!burstSnapshottedRef.current) {
            pushPast(prev)
            burstSnapshottedRef.current = true
          }
          scheduleBurstEnd()
        } else {
          pushPast(prev)
          endBurst()
        }
      }
      return next
    })
  }, [pushPast, scheduleBurstEnd, endBurst])

  const resetHistory = useCallback((newQuiz) => {
    pastRef.current = []
    futureRef.current = []
    burstSnapshottedRef.current = false
    if (burstTimerRef.current) clearTimeout(burstTimerRef.current)
    setQuizState(newQuiz)
    syncHistoryFlags()
  }, [syncHistoryFlags])

  const beginCanvasEdit = useCallback(() => {
    setQuizState((prev) => {
      if (!prev || burstSnapshottedRef.current) return prev
      pushPast(prev)
      burstSnapshottedRef.current = true
      scheduleBurstEnd()
      return prev
    })
  }, [pushPast, scheduleBurstEnd])

  const undo = useCallback(() => {
    setQuizState((prev) => {
      if (!pastRef.current.length || !prev) return prev
      const previous = pastRef.current.pop()
      futureRef.current.push(cloneQuiz(prev))
      syncHistoryFlags()
      endBurst()
      return previous
    })
  }, [syncHistoryFlags, endBurst])

  const redo = useCallback(() => {
    setQuizState((prev) => {
      if (!futureRef.current.length || !prev) return prev
      const next = futureRef.current.pop()
      pastRef.current.push(cloneQuiz(prev))
      syncHistoryFlags()
      endBurst()
      return next
    })
  }, [syncHistoryFlags, endBurst])

  return {
    quiz,
    setQuiz,
    resetHistory,
    undo,
    redo,
    beginCanvasEdit,
    canUndo: historyState.canUndo,
    canRedo: historyState.canRedo,
  }
}