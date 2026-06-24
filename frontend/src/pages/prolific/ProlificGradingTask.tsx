// ProlificGradingTask.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { useNavigate, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import DiffView from '../components/CodeDiffView'
import LoadingAnimation from '../components/LoadingAnimation'
import '../../styling/ProlificGrading.scss'
import '../../styling/Mini.scss'

import { FiArrowLeft, FiArrowRight, FiBookOpen, FiCheckCircle, FiCpu, FiHelpCircle, FiList, FiTarget, FiX } from 'react-icons/fi'

type ErrorOption = {
    id: string
    label: string
    description: string
    points: number
}

type ObservedError = {
    startLine: number
    endLine: number
    errorId: string
    count: number
    note?: string
}

type LineRange = {
    start: number
    end: number
}

type TaskMode = 'rubric' | 'line_no_ai' | 'line_ai'

type ProlificTask = {
    id: number
    taskIndex: number
    taskCount: number
    submissionId: number
    projectId: number
    mode: TaskMode
    modeLabel: string
    programLabel: string
    stageIndex: number
    stageCount: number
    stageTaskIndex: number
    stageTaskCount: number
    stageLabel: string
    isRepeat: boolean
    completed: boolean
    grade?: number | null
    rubricSelections?: string[]
    rubricCounts?: Record<string, number>
    rubricComment?: string
    errors?: ObservedError[]
}

type TaskPayload = {
    success: boolean
    token: string
    assignmentId: number
    assignmentName: string
    task: ProlificTask
    nextTaskId?: number | null
    errorDefs: ErrorOption[]
    error?: string
}

type AiStatus = 'idle' | 'loading' | 'error'

type TutorialStep = {
    title: string
    description: string
    highlightSelectors: string[]
    scrollSelector?: string
}

type TutorialHighlightRect = {
    key: string
    left: number
    top: number
    width: number
    height: number
    label?: string
}

type TutorialViewport = {
    width: number
    height: number
}


const MINI_CLASS_ID = 1

function ProgressBar({ task }: { task: ProlificTask }) {
    const steps = ['Prolific ID', 'Materials', 'Rubric', 'Line-level', 'AI-assisted', 'Survey']
    const currentStep = Math.max(3, Math.min(5, task.stageIndex + 2))
    const stagePct = task.stageTaskCount > 0 ? (task.stageTaskIndex - 1) / task.stageTaskCount : 0
    const totalPct = Math.max(0, Math.min(100, ((currentStep - 1 + stagePct) / (steps.length - 1)) * 100))

    return (
        <section className="prolific-progress" aria-label="Study progress">
            <div className="prolific-progress__meta">
                <span>Progress</span>
                <span>{task.stageLabel}: {task.stageTaskIndex} of {task.stageTaskCount}</span>
            </div>
            <div className="prolific-progress__track" aria-hidden="true">
                <div className="prolific-progress__fill" style={{ width: `${totalPct}%` }} />
            </div>
            <ol className="prolific-progress__steps">
                {steps.map((step, idx) => {
                    const stepNo = idx + 1
                    return (
                        <li key={step} className={[stepNo < currentStep ? 'is-complete' : '', stepNo === currentStep ? 'is-current' : ''].filter(Boolean).join(' ')}>
                            {step}
                        </li>
                    )
                })}
            </ol>
        </section>
    )
}


function tutorialStorageKey(sessionToken: string, mode: TaskMode) {
    return `MAAT_MINI_PROLIFIC_STAGE_TUTORIAL_SEEN:${sessionToken || 'unknown'}:${mode}`
}

function stageDisplayName(mode: TaskMode) {
    if (mode === 'rubric') return 'Rubric'
    if (mode === 'line_ai') return 'AI-assisted'
    return 'Line-level'
}

function modeLabelForMode(mode: TaskMode) {
    if (mode === 'rubric') return 'Standard rubric grading'
    if (mode === 'line_ai') return 'AI-assisted line-level grading'
    return 'Line-level grading'
}

function resolvedTaskMode(task: ProlificTask): TaskMode {
    // Stage order is the source of truth for the Prolific study: Rubric -> Line-level -> AI-assisted.
    // This protects the participant flow when a task payload is loaded with a stale/wrong mode label.
    if (Number.isFinite(task.stageIndex)) {
        if (task.stageIndex <= 1) return 'rubric'
        if (task.stageIndex === 2) return 'line_no_ai'
        if (task.stageIndex >= 3) return 'line_ai'
    }

    const labels = `${task.stageLabel ?? ''} ${task.modeLabel ?? ''}`.toLowerCase()
    if (labels.includes('rubric') || labels.includes('standard')) return 'rubric'
    if (labels.includes('ai') || labels.includes('assisted')) return 'line_ai'
    if (labels.includes('line')) return 'line_no_ai'

    return task.mode
}

function normalizeTaskPayload(next: TaskPayload): TaskPayload {
    if (!next.task) return next

    const mode = resolvedTaskMode(next.task)
    if (mode === next.task.mode) return next

    return {
        ...next,
        task: {
            ...next.task,
            mode,
            modeLabel: modeLabelForMode(mode),
            stageLabel: stageDisplayName(mode),
        },
    }
}

function stageDifferenceText(mode: TaskMode) {
    if (mode === 'rubric') {
        return 'This stage grades the whole program with the standard rubric. Add one or more instances for each rubric category that applies.'
    }

    if (mode === 'line_ai') {
        return 'This stage uses line-level grading with AI assistance. Select the exact code line or line range, review any AI suggestions, and still make the final grading decision yourself.'
    }

    return 'This stage uses line-level grading. Select the exact code line or line range yourself, then assign the appropriate error categories.'
}

function stageTutorialSteps(mode: TaskMode): TutorialStep[] {
    const stageName = stageDisplayName(mode)
    const panelStep: TutorialStep = mode === 'rubric'
        ? {
            title: 'Use the standard rubric panel',
            description: 'The right panel contains Find in code, Jump To buttons, each rubric category, plus and minus buttons for multiple instances, the optional explanation box, the current grade, and Save and next. Use + for every instance of an error category that applies to the whole program.',
            highlightSelectors: ['.find-bar', '.navigation-section', '.rubric-instance-list', '.prolific-grade-card'],
            scrollSelector: '.prolific-grading-panel',
        }
        : mode === 'line_ai'
            ? {
                title: 'Use line-level controls and AI suggestions',
                description: 'The right panel contains Find in code, Jump To buttons, the selected-line pill, AI suggestions, all error categories, plus and minus count buttons, optional notes, the current grade, and Save and next. AI suggestions appear only after you select code lines, and they are suggestions rather than automatic grades.',
                highlightSelectors: ['.find-bar', '.navigation-section', '.selected-line-pill', '.ai-suggestions-picker', '.error-options-list', '.prolific-grade-card'],
                scrollSelector: '.prolific-grading-panel',
            }
            : {
                title: 'Use line-level grading controls',
                description: 'The right panel contains Find in code, Jump To buttons, the selected-line pill, all error categories, plus and minus count buttons, optional notes, the current grade, and Save and next. Select the exact line or line range before assigning errors.',
                highlightSelectors: ['.find-bar', '.navigation-section', '.selected-line-pill', '.error-options-list', '.prolific-grade-card'],
                scrollSelector: '.prolific-grading-panel',
            }

    return [
        {
            title: `Welcome to the ${stageName} grading stage`,
            description: `${stageDifferenceText(mode)} The header buttons let you view the assignment materials again or replay this tutorial, and the current grade updates as you work.`,
            highlightSelectors: ['.grading-task-card'],
            scrollSelector: '.grading-task-card',
        },
        {
            title: 'Compare student output with correct output',
            description: 'The test case list is on the left. In split view, the left output pane shows the student program output and the right output pane shows the correct expected output. Use this comparison to decide which grading categories apply.',
            highlightSelectors: ['.diff-sidebar', '.diff-side-pane.actual', '.diff-side-pane.expected'],
            scrollSelector: '.diff-view',
        },
        {
            title: 'Know the diff buttons',
            description: 'Use View to switch between Split and Stacked output layouts. Use Lines to switch between all output lines and only the changed lines. Use Diff Finder to turn intra-line highlighting on or off when a failing test has character-level differences.',
            highlightSelectors: ['.view-toggle', '.scope-toggle', '.toggle-intra'],
            scrollSelector: '.diff-toolbar',
        },
        {
            title: 'Review the submitted code',
            description: mode === 'rubric'
                ? 'The submitted source code appears below the test output. In the Rubric stage, read the code and output together, then apply rubric categories to the whole program.'
                : 'The submitted source code appears below the test output. Click one line or drag across multiple lines to select the exact code range before adding line-level errors.',
            highlightSelectors: ['.code-block'],
            scrollSelector: '.code-section',
        },
        panelStep,
        {
            title: 'Scroll down to save and check your summary',
            description: 'The grading summary is below the code. It repeats the current grade, lists every deduction you selected, and gives another Save and next button. Use Save and next to store this task and move forward; the last task sends you to the survey.',
            highlightSelectors: ['.all-observed-panel'],
            scrollSelector: '.all-observed-section',
        },
    ]
}

function modeIcon(mode: TaskMode) {
    if (mode === 'rubric') return <FiList aria-hidden="true" />
    if (mode === 'line_ai') return <FiCpu aria-hidden="true" />
    return <FiTarget aria-hidden="true" />
}

function truncateForAi(text: string, limit: number): string {
    const normalized = (text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
    if (normalized.length <= limit) return normalized
    return `${normalized.slice(0, limit)}\n...[truncated]...`
}

function normalizeCount(value: unknown): number {
    const parsed = Number(value)
    if (!Number.isFinite(parsed)) return 0
    return Math.max(0, Math.floor(parsed))
}

function countsFromRubricSelections(raw: unknown): Record<string, number> {
    const counts: Record<string, number> = {}

    if (Array.isArray(raw)) {
        for (const value of raw) {
            const id = String(value ?? '').trim()
            if (!id) continue
            counts[id] = (counts[id] ?? 0) + 1
        }
        return counts
    }

    if (raw && typeof raw === 'object') {
        for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
            const cleanId = String(id ?? '').trim()
            if (!cleanId) continue

            if (typeof value === 'boolean') {
                if (value) counts[cleanId] = 1
                continue
            }

            const count = normalizeCount(value)
            if (count > 0) counts[cleanId] = count
        }
    }

    return counts
}

function expandRubricCounts(counts: Record<string, number>): string[] {
    const ids: string[] = []

    for (const [id, rawCount] of Object.entries(counts)) {
        const count = normalizeCount(rawCount)
        for (let i = 0; i < count; i++) ids.push(id)
    }

    return ids
}

function tutorialHighlightLabel(el: Element): string | undefined {
    if (el.classList.contains('diff-side-pane') && el.classList.contains('actual')) return 'Student output'
    if (el.classList.contains('diff-side-pane') && el.classList.contains('expected')) return 'Correct output'
    return undefined
}

function getTutorialHighlightRects(step: TutorialStep): TutorialHighlightRect[] {
    if (typeof window === 'undefined' || typeof document === 'undefined') return []

    const elements: HTMLElement[] = []
    const seen = new Set<Element>()

    step.highlightSelectors.forEach((selector) => {
        document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
            const style = window.getComputedStyle(el)
            if (style.display === 'none' || style.visibility === 'hidden') return
            if (seen.has(el)) return

            seen.add(el)
            elements.push(el)
        })
    })

    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const viewportPadding = 8
    const rectPadding = 7

    return elements
        .map((el, idx) => {
            const rect = el.getBoundingClientRect()
            if (rect.width <= 0 || rect.height <= 0) return null
            if (rect.bottom < 0 || rect.right < 0 || rect.top > viewportHeight || rect.left > viewportWidth) return null

            const left = Math.max(viewportPadding, rect.left - rectPadding)
            const top = Math.max(viewportPadding, rect.top - rectPadding)
            const right = Math.min(viewportWidth - viewportPadding, rect.right + rectPadding)
            const bottom = Math.min(viewportHeight - viewportPadding, rect.bottom + rectPadding)
            const width = Math.max(0, right - left)
            const height = Math.max(0, bottom - top)

            if (width <= 0 || height <= 0) return null

            return {
                key: `${idx}-${Math.round(left)}-${Math.round(top)}-${Math.round(width)}-${Math.round(height)}`,
                left,
                top,
                width,
                height,
                label: tutorialHighlightLabel(el),
            }
        })
        .filter((rect): rect is TutorialHighlightRect => rect !== null)
}

function scrollPageToTop() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const scroll = () => {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
        document.documentElement.scrollTop = 0
        document.body.scrollTop = 0
    }

    scroll()
    window.requestAnimationFrame(scroll)
}

export function ProlificGradingTask() {
    const { session_token = '', task_id = '' } = useParams<{ session_token: string; task_id: string }>()
    const taskId = Number.parseInt(task_id, 10)
    const navigate = useNavigate()

    const [payload, setPayload] = useState<TaskPayload | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
    const [saveValidationError, setSaveValidationError] = useState<string | null>(null)
    const [showSavedBanner, setShowSavedBanner] = useState(false)
    const [showStageTutorial, setShowStageTutorial] = useState(false)
    const [tutorialStepIndex, setTutorialStepIndex] = useState(0)
    const [tutorialHighlightRects, setTutorialHighlightRects] = useState<TutorialHighlightRect[]>([])
    const [tutorialViewport, setTutorialViewport] = useState<TutorialViewport>({ width: 0, height: 0 })

    const [rubricCounts, setRubricCounts] = useState<Record<string, number>>({})
    const [rubricComment, setRubricComment] = useState('')
    const [observedErrors, setObservedErrors] = useState<ObservedError[]>([])
    const [activeTestcaseName, setActiveTestcaseName] = useState('')
    const [activeTestcaseLongDiff, setActiveTestcaseLongDiff] = useState('')

    const [hoveredLine, setHoveredLine] = useState<number | null>(null)
    const [initialLine, setInitialLine] = useState<number | null>(null)
    const [selectedRange, setSelectedRange] = useState<LineRange | null>(null)
    const selectedRangeRef = useRef<LineRange | null>(null)
    const codeContainerRef = useRef<HTMLDivElement | null>(null)
    const lineRefs = useRef<Record<number, HTMLLIElement | null>>({})
    const diffViewRef = useRef<HTMLElement | null>(null)
    const summaryRef = useRef<HTMLElement | null>(null)
    const tutorialMaskIdRef = useRef(`stage-tutorial-mask-${Math.random().toString(36).slice(2)}`)

    const [aiSuggestionIds, setAiSuggestionIds] = useState<string[]>([])
    const [aiSuggestStatus, setAiSuggestStatus] = useState<AiStatus>('idle')
    const [aiSuggestError, setAiSuggestError] = useState<string | null>(null)
    const lastAiKeyRef = useRef('')
    const aiAbortRef = useRef<AbortController | null>(null)

    // MAAT-style find-in-code controls. These are enabled in every grading mode.
    const [findInput, setFindInput] = useState<string>('')
    const [findQuery, setFindQuery] = useState<string>('')
    const [findMatches, setFindMatches] = useState<number[]>([])
    const [findMatchIndex, setFindMatchIndex] = useState<number>(0)

    const findMatchSet = useMemo(() => new Set(findMatches), [findMatches])
    const activeFindLine = findMatches.length > 0 ? findMatches[findMatchIndex] : null

    const task = payload?.task ?? null
    const errorDefs = useMemo(() => payload?.errorDefs ?? [], [payload])
    const errorMap = useMemo<Record<string, ErrorOption>>(() => {
        const out: Record<string, ErrorOption> = {}
        for (const item of errorDefs) out[item.id] = item
        return out
    }, [errorDefs])

    const isRubricMode = task?.mode === 'rubric'
    const aiEnabled = task?.mode === 'line_ai'
    const lineMode = task?.mode === 'line_no_ai' || task?.mode === 'line_ai'
    const tutorialSteps = useMemo(() => (task ? stageTutorialSteps(task.mode) : []), [task?.mode])
    const currentTutorialStep = showStageTutorial ? tutorialSteps[tutorialStepIndex] : null

    useEffect(() => {
        selectedRangeRef.current = selectedRange
    }, [selectedRange])

    useEffect(() => {
        if (!task || loading) return
        const seenKey = tutorialStorageKey(session_token, task.mode)
        if (window.localStorage.getItem(seenKey) === 'true') return
        setTutorialStepIndex(0)
        setShowStageTutorial(true)
    }, [task?.mode, loading, session_token])

    const updateTutorialSpotlights = useCallback(() => {
        if (!showStageTutorial || !currentTutorialStep) {
            setTutorialHighlightRects([])
            return
        }

        setTutorialViewport({ width: window.innerWidth, height: window.innerHeight })
        setTutorialHighlightRects(getTutorialHighlightRects(currentTutorialStep))
    }, [showStageTutorial, currentTutorialStep])

    useEffect(() => {
        if (!showStageTutorial || !currentTutorialStep) {
            setTutorialHighlightRects([])
            return
        }

        const scrollToCurrentTarget = () => {
            const scrollSelector = currentTutorialStep.scrollSelector ?? currentTutorialStep.highlightSelectors[0]
            const scrollTarget = scrollSelector ? document.querySelector(scrollSelector) : null
            if (scrollTarget instanceof HTMLElement) {
                scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
            }
        }

        const scrollAndMeasure = () => {
            scrollToCurrentTarget()
            window.requestAnimationFrame(updateTutorialSpotlights)
        }

        updateTutorialSpotlights()

        const timers = [
            window.setTimeout(scrollAndMeasure, 90),
            window.setTimeout(scrollAndMeasure, 260),
            window.setTimeout(scrollAndMeasure, 520),
        ]

        window.addEventListener('resize', updateTutorialSpotlights)
        window.addEventListener('scroll', updateTutorialSpotlights, true)

        return () => {
            timers.forEach((timer) => window.clearTimeout(timer))
            window.removeEventListener('resize', updateTutorialSpotlights)
            window.removeEventListener('scroll', updateTutorialSpotlights, true)
        }
    }, [showStageTutorial, currentTutorialStep, updateTutorialSpotlights])

    useEffect(() => {
        if (!showStageTutorial) return

        const scrollKeys = new Set(['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'End', 'Home', 'PageDown', 'PageUp', ' '])
        const isInsideTutorialCard = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('.stage-tutorial-card'))
        const isEditableTarget = (target: EventTarget | null) => {
            if (!(target instanceof HTMLElement)) return false
            const tag = target.tagName.toLowerCase()
            return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
        }

        const preventWheelOrTouchScroll = (event: Event) => {
            if (isInsideTutorialCard(event.target)) return
            event.preventDefault()
        }

        const preventKeyboardScroll = (event: KeyboardEvent) => {
            if (!scrollKeys.has(event.key)) return
            if (isInsideTutorialCard(event.target) || isEditableTarget(event.target)) return
            event.preventDefault()
        }

        document.documentElement.classList.add('stage-tutorial-scroll-locked')
        document.body.classList.add('stage-tutorial-scroll-locked')
        window.addEventListener('wheel', preventWheelOrTouchScroll, { passive: false, capture: true })
        window.addEventListener('touchmove', preventWheelOrTouchScroll, { passive: false, capture: true })
        window.addEventListener('keydown', preventKeyboardScroll, { capture: true })

        return () => {
            document.documentElement.classList.remove('stage-tutorial-scroll-locked')
            document.body.classList.remove('stage-tutorial-scroll-locked')
            window.removeEventListener('wheel', preventWheelOrTouchScroll, true)
            window.removeEventListener('touchmove', preventWheelOrTouchScroll, true)
            window.removeEventListener('keydown', preventKeyboardScroll, true)
        }
    }, [showStageTutorial])

    useEffect(() => {
        if (!session_token || !Number.isFinite(taskId)) return
        scrollPageToTop()
        setLoading(true)
        setError(null)
        setSaveStatus('idle')
        setSaveValidationError(null)
        setShowSavedBanner(false)
        setShowStageTutorial(false)
        setTutorialStepIndex(0)
        setSelectedRange(null)
        selectedRangeRef.current = null
        setInitialLine(null)
        setHoveredLine(null)
        setAiSuggestionIds([])
        setAiSuggestStatus('idle')
        setAiSuggestError(null)
        if (aiAbortRef.current) {
            aiAbortRef.current.abort()
            aiAbortRef.current = null
        }
        setFindInput('')
        setFindQuery('')
        setFindMatches([])
        setFindMatchIndex(0)
        lineRefs.current = {}
        lastAiKeyRef.current = ''

        axios
            .get(`${import.meta.env.VITE_API_URL}/mini/prolific/session/${session_token}/tasks/${taskId}`)
            .then((res) => {
                const next = normalizeTaskPayload(res.data as TaskPayload)
                setPayload(next)
                const draftKey = `MAAT_MINI_PROLIFIC_TASK_DRAFT:${session_token}:${next.task.id}`
                const draftRaw = sessionStorage.getItem(draftKey)
                let draftRestored = false

                if (draftRaw) {
                    try {
                        const draft = JSON.parse(draftRaw)
                        if (draft && typeof draft === 'object') {
                            if (draft.rubricCounts && typeof draft.rubricCounts === 'object') {
                                setRubricCounts(countsFromRubricSelections(draft.rubricCounts))
                            } else {
                                setRubricCounts(countsFromRubricSelections(draft.rubricSelections))
                            }

                            setRubricComment(typeof draft.rubricComment === 'string' ? draft.rubricComment : '')
                            setObservedErrors(Array.isArray(draft.observedErrors) ? draft.observedErrors : [])
                            draftRestored = true
                        }
                    } catch (e) {
                        console.warn('Could not restore Prolific grading draft:', e)
                    }
                }

                if (!draftRestored) {
                    const restoredCounts = next.task?.rubricCounts && typeof next.task.rubricCounts === 'object'
                        ? countsFromRubricSelections(next.task.rubricCounts)
                        : countsFromRubricSelections(next.task?.rubricSelections ?? [])

                    setRubricCounts(restoredCounts)
                    setRubricComment(next.task?.rubricComment ?? '')
                    setObservedErrors(Array.isArray(next.task?.errors) ? next.task.errors : [])
                }

                return axios.post(`${import.meta.env.VITE_API_URL}/mini/prolific/session/${session_token}/tasks/${taskId}/start`)
            })
            .catch((err) => {
                console.error(err)
                setError(err?.response?.data?.error || 'Could not load this grading task.')
            })
            .finally(() => {
                setLoading(false)
                scrollPageToTop()
            })
    }, [session_token, taskId])

    useEffect(() => {
        if (!showSavedBanner) return
        const timer = window.setTimeout(() => {
            setShowSavedBanner(false)
            setSaveStatus((prev) => (prev === 'saved' ? 'idle' : prev))
        }, 2200)
        return () => window.clearTimeout(timer)
    }, [showSavedBanner])

    const selectedRubricIds = useMemo(() => expandRubricCounts(rubricCounts), [rubricCounts])

    const rubricDeduction = useMemo(() => {
        return Object.entries(rubricCounts).reduce((sum, [id, count]) => {
            return sum + (errorMap[id]?.points ?? 0) * normalizeCount(count)
        }, 0)
    }, [rubricCounts, errorMap])

    const lineDeduction = useMemo(() => {
        return observedErrors.reduce((sum, err) => {
            const points = errorMap[err.errorId]?.points ?? 0
            return sum + points * Math.max(1, Number(err.count ?? 1))
        }, 0)
    }, [observedErrors, errorMap])

    const grade = Math.max(0, 100 - (isRubricMode ? rubricDeduction : lineDeduction))
    const hasMarkedRequiredError = isRubricMode ? selectedRubricIds.length > 0 : lineMode ? observedErrors.length > 0 : true
    const requiredErrorMessage = isRubricMode
        ? 'Mark at least one rubric deduction before saving this problem.'
        : 'Select a line and mark at least one error before saving this problem.'

    useEffect(() => {
        if (!saveValidationError || !hasMarkedRequiredError) return
        setSaveValidationError(null)
    }, [saveValidationError, hasMarkedRequiredError])

    const selectedRangeCountsByErrorId = useMemo(() => {
        const m: Record<string, number> = {}
        if (!selectedRange) return m
        for (const e of observedErrors) {
            if (e.startLine === selectedRange.start && e.endLine === selectedRange.end) m[e.errorId] = e.count
        }
        return m
    }, [observedErrors, selectedRange])

    const selectedRangeErrors = useMemo(() => {
        if (!selectedRange) return []
        return observedErrors.filter((err) => err.startLine <= selectedRange.end && err.endLine >= selectedRange.start)
    }, [observedErrors, selectedRange])

    const selectedRubricRows = useMemo(() => {
        return Object.entries(rubricCounts)
            .map(([id, count]) => [id, normalizeCount(count)] as [string, number])
            .filter(([, count]) => count > 0)
            .sort(([a], [b]) => {
                const aIndex = errorDefs.findIndex((err) => err.id === a)
                const bIndex = errorDefs.findIndex((err) => err.id === b)
                if (aIndex === -1 && bIndex === -1) return a.localeCompare(b)
                if (aIndex === -1) return 1
                if (bIndex === -1) return -1
                return aIndex - bIndex
            })
    }, [rubricCounts, errorDefs])

    const tableRows = useMemo<[number, number, ObservedError[]][]>(() => {
        const rows = Object.values(
            observedErrors.reduce((table, err) => {
                const key = `${err.startLine}-${err.endLine}`
                if (!table[key]) table[key] = [err.startLine, err.endLine, []]
                table[key][2].push(err)
                return table
            }, {} as Record<string, [number, number, ObservedError[]]>),
        ) as [number, number, ObservedError[]][]

        return rows.sort((a, b) => {
            const [aStart, aEnd] = a
            const [bStart, bEnd] = b
            if (aStart !== bStart) return aStart - bStart
            return aEnd - bEnd
        })
    }, [observedErrors])

    const clearBrowserSelection = () => {
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0) sel.removeAllRanges()
    }

    const clearLineSelectionState = () => {
        clearBrowserSelection()
        setSelectedRange(null)
        selectedRangeRef.current = null
        setInitialLine(null)
        setHoveredLine(null)
        setAiSuggestionIds([])
        setAiSuggestStatus('idle')
        setAiSuggestError(null)
        lastAiKeyRef.current = ''
        if (aiAbortRef.current) {
            aiAbortRef.current.abort()
            aiAbortRef.current = null
        }
    }

    const scrollToLine = (lineNo: number) => {
        const el = lineRefs.current[lineNo]
        if (!el) return
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    const scrollToSection = (section: HTMLElement | null) => {
        if (!section) return
        section.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    const completeStageTutorial = () => {
        if (task) window.localStorage.setItem(tutorialStorageKey(session_token, task.mode), 'true')
        setShowStageTutorial(false)
        setTutorialStepIndex(0)
    }

    const replayStageTutorial = () => {
        setTutorialStepIndex(0)
        setShowStageTutorial(true)
    }

    const nextTutorialStep = () => {
        if (tutorialStepIndex >= tutorialSteps.length - 1) {
            completeStageTutorial()
            return
        }
        setTutorialStepIndex((prev) => Math.min(prev + 1, tutorialSteps.length - 1))
    }

    const previousTutorialStep = () => {
        setTutorialStepIndex((prev) => Math.max(prev - 1, 0))
    }

    const performFind = (rawQuery: string) => {
        const needle = rawQuery.trim()
        if (!needle) {
            setFindQuery('')
            setFindMatches([])
            setFindMatchIndex(0)
            return
        }

        const lowerNeedle = needle.toLowerCase()
        const lineNos = Object.keys(lineRefs.current)
            .map((k) => Number(k))
            .filter((n) => Number.isFinite(n))
            .sort((a, b) => a - b)

        const matches: number[] = []
        for (const ln of lineNos) {
            const el = lineRefs.current[ln]
            if (!el) continue
            const hay = (el.textContent ?? '').replace(/\u00A0/g, ' ').toLowerCase()
            if (hay.includes(lowerNeedle)) matches.push(ln)
        }

        setFindQuery(needle)
        setFindMatches(matches)
        setFindMatchIndex(0)
        if (matches.length > 0) scrollToLine(matches[0])
    }

    const stepFind = (dir: 1 | -1) => {
        if (findMatches.length === 0) return
        setFindMatchIndex((prev) => {
            const next = (prev + dir + findMatches.length) % findMatches.length
            scrollToLine(findMatches[next])
            return next
        })
    }

    const renderFindBar = () => (
        <div className="find-bar" role="search" aria-label="Find in code">
            <input
                className="find-input"
                type="text"
                placeholder="Find in code (Enter to search)"
                value={findInput}
                onChange={(e) => setFindInput(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    e.preventDefault()

                    const nextQuery = findInput.trim()
                    if (nextQuery !== findQuery) {
                        performFind(findInput)
                        return
                    }
                    stepFind(e.shiftKey ? -1 : 1)
                }}
            />

            <div className="find-count" aria-label="Match count">
                {findMatches.length === 0 ? '0/0' : `${findMatchIndex + 1}/${findMatches.length}`}
            </div>

            <div className="find-nav" aria-label="Find navigation">
                <button type="button" className="find-nav-btn" disabled={findMatches.length === 0} onClick={() => stepFind(-1)} title="Previous match (Shift+Enter)">
                    ‹
                </button>
                <button type="button" className="find-nav-btn" disabled={findMatches.length === 0} onClick={() => stepFind(1)} title="Next match (Enter)">
                    ›
                </button>
            </div>
        </div>
    )

    const handleMouseDown = (line: number) => {
        if (!lineMode) return
        setInitialLine(line)
        setSelectedRange({ start: line, end: line })
    }

    const handleMouseEnter = (line: number) => {
        if (!lineMode) return
        setHoveredLine(line)
        if (initialLine === null) return
        const nextRange = { start: Math.min(initialLine, line), end: Math.max(initialLine, line) }
        setSelectedRange(nextRange)
        if (nextRange.start !== nextRange.end) clearBrowserSelection()
    }

    const handleMouseUp = () => {
        if (selectedRangeRef.current && selectedRangeRef.current.start !== selectedRangeRef.current.end) clearBrowserSelection()
        setInitialLine(null)
    }

    const getSelectedCodeFromDom = (range: LineRange): string => {
        const lines: string[] = []
        for (let ln = range.start; ln <= range.end; ln++) {
            const el = lineRefs.current[ln]
            if (!el) continue
            const codeText = el.querySelector('.code-text')?.textContent ?? ''
            const cleaned = codeText.replace(/\u00A0/g, ' ').trimEnd()
            lines.push(`${ln}: ${cleaned}`)
        }
        return lines.join('\n').trim()
    }

    const requestAiSuggestions = async (range: LineRange) => {
        if (!task || !aiEnabled) return
        const selectedCode = getSelectedCodeFromDom(range)
        if (!selectedCode) return

        const key = `${task.submissionId}:${range.start}-${range.end}:${selectedCode.length}:${activeTestcaseName}:${activeTestcaseLongDiff.length}:${errorDefs.length}`
        if (lastAiKeyRef.current === key) return
        lastAiKeyRef.current = key

        if (aiAbortRef.current) aiAbortRef.current.abort()
        const ctrl = new AbortController()
        aiAbortRef.current = ctrl

        setAiSuggestStatus('loading')
        setAiSuggestError(null)

        try {
            const res = await axios.post(
                `${import.meta.env.VITE_API_URL}/ai/grading-suggestions`,
                {
                    submissionId: task.submissionId,
                    startLine: range.start,
                    endLine: range.end,
                    selectedCode: truncateForAi(selectedCode, 1500),
                    testcaseName: activeTestcaseName,
                    testcaseLongDiff: truncateForAi(activeTestcaseLongDiff, 2500),
                },
                { signal: ctrl.signal },
            )
            const ids = Array.isArray(res.data?.suggestions)
                ? res.data.suggestions.map((id: any) => String(id)).filter((id: string) => errorMap[id])
                : []
            setAiSuggestionIds(ids)
            setAiSuggestStatus('idle')
        } catch (e: any) {
            if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return
            setAiSuggestStatus('error')
            setAiSuggestError('AI suggestion request failed.')
            setAiSuggestionIds([])
        }
    }

    useEffect(() => {
        if (!aiEnabled || initialLine !== null) return
        if (!selectedRange) {
            setAiSuggestionIds([])
            setAiSuggestStatus('idle')
            setAiSuggestError(null)
            lastAiKeyRef.current = ''
            return
        }
        requestAiSuggestions(selectedRange)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedRange, initialLine, activeTestcaseName, activeTestcaseLongDiff, aiEnabled, errorMap])

    const bumpRubricCount = (errorId: string, delta: number) => {
        if (!delta) return

        setRubricCounts((prev) => {
            const current = normalizeCount(prev[errorId])
            const nextCount = Math.max(0, current + delta)

            if (nextCount <= 0) {
                const next = { ...prev }
                delete next[errorId]
                return next
            }

            return { ...prev, [errorId]: nextCount }
        })

        setSaveStatus('idle')
        if (delta > 0) setSaveValidationError(null)
    }

    const bumpErrorCount = (start: number, end: number, errorId: string, delta: number) => {
        if (!delta) return
        setObservedErrors((prev) => {
            const idx = prev.findIndex((e) => e.startLine === start && e.endLine === end && e.errorId === errorId)
            if (idx === -1) {
                if (delta < 0) return prev
                return [...prev, { startLine: start, endLine: end, errorId, count: delta, note: '' }]
            }
            const next = [...prev]
            const cur = next[idx]
            const nextCount = Math.max(0, Number(cur.count ?? 1) + delta)
            if (nextCount <= 0) next.splice(idx, 1)
            else next[idx] = { ...cur, count: nextCount }
            return next
        })
        setSaveStatus('idle')
        if (delta > 0) setSaveValidationError(null)
    }

    const setErrorNote = (start: number, end: number, errorId: string, note: string) => {
        setObservedErrors((prev) =>
            prev.map((e) => (e.startLine === start && e.endLine === end && e.errorId === errorId ? { ...e, note } : e)),
        )
        setSaveStatus('idle')
    }

    const draftKeyForTask = (token: string, id: number) => `MAAT_MINI_PROLIFIC_TASK_DRAFT:${token}:${id}`

    const saveCurrentDraft = () => {
        if (!payload || !task) return
        sessionStorage.setItem(
            draftKeyForTask(payload.token, task.id),
            JSON.stringify({ rubricCounts, rubricSelections: selectedRubricIds, rubricComment, observedErrors }),
        )
    }

    const viewMaterials = () => {
        if (!payload || !task) return
        saveCurrentDraft()
        setLoading(true)
        axios
            .post(`${import.meta.env.VITE_API_URL}/mini/prolific/session/${payload.token}/tasks/${task.id}/pause`)
            .catch((err) => console.error('Could not pause grading timer:', err))
            .finally(() => {
                setLoading(false)
                navigate(`/mini/prolific/${payload.token}/materials?returnTask=${task.id}`)
            })
    }

    const saveAndContinue = () => {
        if (!payload || !task || saveStatus === 'saving') return

        if (!hasMarkedRequiredError) {
            setSaveStatus('idle')
            setShowSavedBanner(false)
            setSaveValidationError(requiredErrorMessage)
            return
        }

        setSaveValidationError(null)
        setSaveStatus('saving')
        setShowSavedBanner(false)

        axios
            .post(`${import.meta.env.VITE_API_URL}/mini/prolific/session/${payload.token}/tasks/${task.id}/save`, {
                grade,
                scoringMode: isRubricMode ? 'rubric' : 'lineErrors',
                rubricSelections: selectedRubricIds,
                rubricCounts,
                rubricComment,
                errors: observedErrors,
                errorPoints: {},
                errorDefs: {},
            })
            .then(() => {
                sessionStorage.removeItem(draftKeyForTask(payload.token, task.id))
                clearLineSelectionState()
                scrollPageToTop()
                setSaveStatus('saved')
                setShowSavedBanner(true)

                const nextPath = payload.nextTaskId
                    ? `/mini/prolific/${payload.token}/tasks/${payload.nextTaskId}`
                    : `/mini/prolific/${payload.token}/survey`

                navigate(nextPath)
                window.requestAnimationFrame(scrollPageToTop)
            })
            .catch((err) => {
                console.error(err)
                setSaveStatus('error')
            })
    }

    const renderRubricErrorCard = (err: ErrorOption, count: number) => {
        const shownDeduction = err.points * Math.max(1, count || 1)

        return (
            <div key={err.id} className={`suggestion-card ${count > 0 ? 'is-selected' : ''}`} title={err.description}>
                <div className="suggestion-top">
                    <span className="suggestion-title">{err.label}</span>
                </div>
                {err.description && <div className="suggestion-description">{err.description}</div>}
                <div className="suggestion-bottom">
                    <div className="instance-box" aria-label="Instances">
                        <span className={`count-badge ${count > 0 ? 'active' : ''}`}>x{count}</span>
                        <div className="count-controls" aria-label="Adjust count">
                            <button type="button" className="count-btn plus" onClick={() => bumpRubricCount(err.id, 1)} aria-label={`Increase ${err.label} count`}>
                                +
                            </button>
                            {count > 0 && (
                                <button type="button" className="count-btn minus" onClick={() => bumpRubricCount(err.id, -1)} aria-label={`Decrease ${err.label} count`}>
                                    −
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="points-box" aria-label="Point deduction">
                        <span className="deduction-value">-{shownDeduction}</span>
                    </div>
                </div>
            </div>
        )
    }

    const renderRubricPanel = () => (
        <aside className="grading-panel prolific-grading-panel" aria-label="Standard rubric grading panel">
            <div className="grading-panel-header">
                <div className="grading-title">Standard rubric</div>
                <div className="grading-hint">Add one instance for each time a rubric category applies to this program.</div>
            </div>

            {renderFindBar()}

            <div className="navigation-section">
                <div className="navigation-header">Jump To</div>
                <ul className="navigation-list">
                    <li className="navigation-item" onClick={() => scrollToSection(diffViewRef.current)}>Test Cases</li>
                    <li className="navigation-item" onClick={() => scrollToSection(summaryRef.current)}>Grading Summary</li>
                </ul>
            </div>

            <div className="grading-section">
                <div className="section-label">Rubric categories</div>
                <div className="error-options-list rubric-instance-list">
                    {errorDefs.map((err) => renderRubricErrorCard(err, normalizeCount(rubricCounts[err.id])))}
                </div>
            </div>

            <label className="grading-section rubric-comment">
                <span className="section-label">Optional explanation</span>
                <textarea value={rubricComment} onChange={(e) => setRubricComment(e.target.value)} rows={5} placeholder="Briefly explain the main grading decision." />
            </label>

            <div className="prolific-grade-card">
                <div>
                    <span className="mini-card__eyebrow">Current grade</span>
                    <strong>{grade}</strong>
                </div>
                <button className="mini-button mini-button--primary" type="button" onClick={saveAndContinue} disabled={saveStatus === 'saving'}>
                    {payload?.nextTaskId ? 'Save and next' : 'Save and survey'}
                    <FiArrowRight aria-hidden="true" />
                </button>
            </div>

            {saveValidationError && <div className="mini-alert" role="alert">{saveValidationError}</div>}
            {saveStatus === 'error' && <div className="mini-alert">Save failed. Try again.</div>}
        </aside>
    )

    const renderLineErrorCard = (err: ErrorOption, count: number, range: LineRange) => {
        const shownDeduction = err.points * Math.max(1, count || 1)
        return (
            <div key={err.id} className="suggestion-card" title={err.description}>
                <div className="suggestion-top">
                    <span className="suggestion-title">{err.label}</span>
                </div>
                {err.description && <div className="suggestion-description">{err.description}</div>}
                <div className="suggestion-bottom">
                    <div className="instance-box" aria-label="Instances">
                        <span className={`count-badge ${count > 0 ? 'active' : ''}`}>x{count}</span>
                        <div className="count-controls" aria-label="Adjust count">
                            <button type="button" className="count-btn plus" onClick={() => bumpErrorCount(range.start, range.end, err.id, 1)} aria-label="Increase count">+</button>
                            {count > 0 && <button type="button" className="count-btn minus" onClick={() => bumpErrorCount(range.start, range.end, err.id, -1)} aria-label="Decrease count">−</button>}
                        </div>
                    </div>
                    <div className="points-box" aria-label="Point deduction">
                        <span className="deduction-value">-{shownDeduction}</span>
                    </div>
                </div>
            </div>
        )
    }

    const renderLinePanel = () => (
        <aside className="grading-panel prolific-grading-panel" aria-label="Line-level grading panel">
            <div className="grading-panel-header">
                <div className="grading-title">Line-level grading</div>
                <div className="grading-hint">Select one or more code lines, then assign error categories.</div>
            </div>

            {renderFindBar()}

            <div className="navigation-section">
                <div className="navigation-header">Jump To</div>
                <ul className="navigation-list">
                    <li className="navigation-item" onClick={() => scrollToSection(diffViewRef.current)}>Test Cases</li>
                    <li className="navigation-item" onClick={() => scrollToSection(summaryRef.current)}>Grading Summary</li>
                </ul>
            </div>

            <div className="grading-section">
                <div className="section-label">Selected line(s)</div>
                <button
                    type="button"
                    className={`selected-line-pill ${selectedRange ? 'active' : 'inactive'}`}
                    disabled={!selectedRange}
                    onClick={() => (selectedRange ? scrollToLine(selectedRange.start) : null)}
                >
                    {!selectedRange ? 'None' : selectedRange.start === selectedRange.end ? `Line ${selectedRange.start}` : `Lines ${selectedRange.start}-${selectedRange.end}`}
                </button>
            </div>

            {aiEnabled && (
                <div className="grading-section ai-suggestions-picker">
                    <div className="ai-suggestions-picker-header">
                        <span className="ai-suggestions-picker-title">AI suggestions</span>
                        <span className="mini-pill">Shown for this condition</span>
                    </div>
                    <div className="ai-suggestions-picker-body">
                        {aiSuggestStatus === 'loading' && <div className="muted small">Generating suggestions...</div>}
                        {aiSuggestStatus === 'error' && <div className="muted small">{aiSuggestError ?? 'AI error.'}</div>}
                        {aiSuggestStatus === 'idle' && selectedRange !== null && aiSuggestionIds.length === 0 && <div className="muted small">No suggestions yet for this selection.</div>}
                        {selectedRange && aiSuggestionIds.map((id) => {
                            const err = errorMap[id]
                            if (!err) return null
                            return renderLineErrorCard(err, selectedRangeCountsByErrorId[id] ?? 0, selectedRange)
                        })}
                    </div>
                </div>
            )}

            <div className="grading-section">
                <div className="section-label">All error categories</div>
                {selectedRange === null && <div className="muted small">Select a line to enable error categories.</div>}
                <div className="error-options-list">
                    {selectedRange && errorDefs.map((err) => renderLineErrorCard(err, selectedRangeCountsByErrorId[err.id] ?? 0, selectedRange))}
                </div>
            </div>

            <div className="grading-section">
                <div className="section-label">Errors on selected line(s)</div>
                {selectedRange === null && <div className="muted">No line selected.</div>}
                {selectedRange !== null && selectedRangeErrors.length === 0 && <div className="muted">No errors on this line.</div>}
                {selectedRange !== null && selectedRangeErrors.length > 0 && (
                    <div className="line-error-list">
                        {selectedRangeErrors.map((err, idx) => {
                            const meta = errorMap[err.errorId]
                            const label = meta?.label ?? err.errorId
                            const rangeLabel = err.startLine === err.endLine ? `Line ${err.startLine}` : `Lines ${err.startLine}-${err.endLine}`
                            return (
                                <div key={`${err.startLine}-${err.endLine}-${err.errorId}-${idx}`} className="suggestion-card">
                                    <div className="suggestion-top">
                                        <span className="suggestion-title">{label}</span>
                                        <span className="muted small">{rangeLabel}</span>
                                    </div>
                                    <div className="suggestion-bottom">
                                        <div className="instance-box">
                                            <span className="count-badge active">x{Math.max(1, err.count ?? 1)}</span>
                                            <div className="count-controls">
                                                <button type="button" className="count-btn plus" onClick={() => bumpErrorCount(err.startLine, err.endLine, err.errorId, 1)}>+</button>
                                                <button type="button" className="count-btn minus" onClick={() => bumpErrorCount(err.startLine, err.endLine, err.errorId, -1)}>−</button>
                                            </div>
                                        </div>
                                    </div>
                                    <textarea
                                        className="error-note"
                                        value={err.note ?? ''}
                                        onChange={(e) => setErrorNote(err.startLine, err.endLine, err.errorId, e.target.value)}
                                        placeholder="Optional note"
                                        rows={2}
                                    />
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            <div className="prolific-grade-card">
                <div>
                    <span className="mini-card__eyebrow">Current grade</span>
                    <strong>{grade}</strong>
                </div>
                <button className="mini-button mini-button--primary" type="button" onClick={saveAndContinue} disabled={saveStatus === 'saving'}>
                    {payload?.nextTaskId ? 'Save and next' : 'Save and survey'}
                    <FiArrowRight aria-hidden="true" />
                </button>
            </div>
            {saveValidationError && <div className="mini-alert" role="alert">{saveValidationError}</div>}
            {saveStatus === 'error' && <div className="mini-alert">Save failed. Try again.</div>}
        </aside>
    )

    const renderStageTutorial = () => {
        if (!task || !showStageTutorial || !currentTutorialStep || tutorialSteps.length === 0) return null

        const isLastStep = tutorialStepIndex >= tutorialSteps.length - 1
        const maskId = tutorialMaskIdRef.current
        const viewportWidth = tutorialViewport.width || window.innerWidth
        const viewportHeight = tutorialViewport.height || window.innerHeight

        return (
            <div className="stage-tutorial-overlay" role="dialog" aria-modal="true" aria-labelledby="stage-tutorial-title" aria-describedby="stage-tutorial-description">
                <svg className="stage-tutorial-backdrop" aria-hidden="true" width="100%" height="100%" preserveAspectRatio="none">
                    <defs>
                        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width={viewportWidth} height={viewportHeight}>
                            <rect x="0" y="0" width={viewportWidth} height={viewportHeight} fill="white" />
                            {tutorialHighlightRects.map((rect) => (
                                <rect
                                    key={`hole-${rect.key}`}
                                    x={rect.left}
                                    y={rect.top}
                                    width={rect.width}
                                    height={rect.height}
                                    rx="18"
                                    ry="18"
                                    fill="black"
                                />
                            ))}
                        </mask>
                    </defs>
                    <rect x="0" y="0" width={viewportWidth} height={viewportHeight} className="stage-tutorial-backdrop-fill" mask={`url(#${maskId})`} />
                </svg>
                <div className="stage-tutorial-click-catcher" aria-hidden="true" />
                <div className="stage-tutorial-spotlights" aria-hidden="true">
                    {tutorialHighlightRects.map((rect) => (
                        <div
                            key={`spotlight-${rect.key}`}
                            className="stage-tutorial-spotlight"
                            style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
                        >
                            {rect.label && <span className="stage-tutorial-spotlight__label">{rect.label}</span>}
                        </div>
                    ))}
                </div>
                <section className="stage-tutorial-card">
                    <h2 id="stage-tutorial-title">{currentTutorialStep.title}</h2>
                    <p id="stage-tutorial-description">{currentTutorialStep.description}</p>

                    <div className="stage-tutorial-dots" aria-label="Tutorial progress">
                        {tutorialSteps.map((step, idx) => (
                            <button
                                key={step.title}
                                type="button"
                                className={`stage-tutorial-dot ${idx === tutorialStepIndex ? 'is-active' : ''}`}
                                onClick={() => setTutorialStepIndex(idx)}
                                aria-label={`Go to tutorial step ${idx + 1}: ${step.title}`}
                            />
                        ))}
                    </div>

                    <div className="stage-tutorial-actions">
                        <button type="button" className="mini-button" onClick={completeStageTutorial}>
                            Skip tutorial
                        </button>
                        <div className="stage-tutorial-actions__right">
                            <button type="button" className="mini-button" onClick={previousTutorialStep} disabled={tutorialStepIndex === 0}>
                                <FiArrowLeft aria-hidden="true" />
                                Back
                            </button>
                            <button type="button" className="mini-button mini-button--primary" onClick={nextTutorialStep}>
                                {isLastStep ? 'Start grading' : 'Next'}
                                {!isLastStep && <FiArrowRight aria-hidden="true" />}
                                {isLastStep && <FiCheckCircle aria-hidden="true" />}
                            </button>
                        </div>
                    </div>
                </section>
            </div>
        )
    }

    const renderSummary = () => (
        <section className="all-observed-section" aria-label="Grading summary" ref={summaryRef}>
            <h2 className="section-title">Grading Summary</h2>
            <div className="all-observed-panel prolific-summary-panel">
                <div className="save-panel">
                    <div className="grade-column">
                        <div className="grade-stack">
                            <div className="grade-value">{grade}</div>
                            <div className="grade-mode">{isRubricMode ? 'Standard rubric' : aiEnabled ? 'Line errors with AI suggestions' : 'Line errors'}</div>
                        </div>
                    </div>
                    <button className={`save-grade ${saveStatus}`} onClick={saveAndContinue} disabled={saveStatus === 'saving'}>
                        {saveStatus === 'idle' && (payload?.nextTaskId ? 'Save and next' : 'Save and survey')}
                        {saveStatus === 'saving' && 'Saving...'}
                        {saveStatus === 'saved' && 'Saved!'}
                        {saveStatus === 'error' && 'Error'}
                    </button>
                </div>

                {saveValidationError && <div className="mini-alert" role="alert">{saveValidationError}</div>}

                {isRubricMode && selectedRubricRows.length === 0 && <div className="muted">No rubric deductions selected.</div>}
                {isRubricMode && selectedRubricRows.length > 0 && (
                    <div className="all-errors">
                        {selectedRubricRows.map(([id, count]) => {
                            const err = errorMap[id]
                            const label = err?.label ?? id
                            const totalPoints = (err?.points ?? 0) * count

                            return (
                                <div key={id} className="all-errors-line">
                                    <div className="all-errors-line-header">
                                        <span className="all-errors-line-title">{label}</span>
                                        <span className="all-errors-line-meta">{count} {count === 1 ? 'instance' : 'instances'}, -{totalPoints}</span>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}

                {lineMode && observedErrors.length === 0 && <div className="muted">No line errors added yet.</div>}
                {lineMode && tableRows.length > 0 && (
                    <div className="all-errors">
                        {tableRows.map(([start, end, errors]) => {
                            const totalPointsForRange = errors.reduce((sum, e) => sum + (errorMap[e.errorId]?.points ?? 0) * Math.max(1, e.count ?? 1), 0)
                            const totalCountForRange = errors.reduce((sum, e) => sum + Math.max(1, e.count ?? 1), 0)
                            return (
                                <div key={`${start}-${end}`} className="all-errors-line">
                                    <button
                                        type="button"
                                        className="all-errors-line-header"
                                        onClick={() => {
                                            setSelectedRange({ start, end })
                                            scrollToLine(start)
                                        }}
                                    >
                                        <span className="all-errors-line-title">{start === end ? `Line ${start}` : `Lines ${start}-${end}`}</span>
                                        <span className="all-errors-line-meta">{totalCountForRange} {totalCountForRange === 1 ? 'instance' : 'instances'}, -{totalPointsForRange}</span>
                                    </button>
                                    <div className="all-errors-line-body">
                                        {errors.map((err, idx) => (
                                            <div key={`${start}-${end}-${err.errorId}-${idx}`} className="all-errors-item">
                                                <div className="col label">{errorMap[err.errorId]?.label ?? err.errorId}</div>
                                                <div className="col instances">x{Math.max(1, err.count ?? 1)}</div>
                                                <div className="col note">{err.note || 'No note'}</div>
                                                <div className="col points">-{(errorMap[err.errorId]?.points ?? 0) * Math.max(1, err.count ?? 1)}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>
        </section>
    )

    return (
        <div className="page-container prolific-shell" id="prolific-output-diff">
            <LoadingAnimation show={loading || saveStatus === 'saving'} message={loading ? 'Loading grading task...' : 'Saving task...'} />
            <Helmet><title>MAAT-Mini Grading</title></Helmet>
            <MenuComponent showUpload={false} showAdminUpload={false} showHelp={false} showCreate={false} showLast={false} showReviewButton={false} />

            {task && <ProgressBar task={task} />}

            {error && <main className="mini-page prolific-page"><div className="mini-alert" role="alert">{error}</div></main>}

            {task && payload && (
                <>
                    <main className="mini-page prolific-page grading-task-header">
                        <section className="mini-card grading-task-card">
                            <div className="grading-task-card__icon">{modeIcon(task.mode)}</div>
                            <div>
                                <div className="mini-card__eyebrow">{task.programLabel}</div>
                                <h1>{task.modeLabel}</h1>
                                <p>
                                    Grade this anonymized program. This is {task.stageLabel} task {task.stageTaskIndex} of {task.stageTaskCount}.
                                    {task.isRepeat ? ' This program may look familiar; grade it independently.' : ''}
                                </p>
                            </div>
                            <div className="grading-task-card__actions">
                                <button className="mini-button" type="button" onClick={viewMaterials}>
                                    <FiBookOpen aria-hidden="true" />
                                    View materials
                                </button>
                                <button className="mini-button" type="button" onClick={replayStageTutorial}>
                                    <FiHelpCircle aria-hidden="true" />
                                    Show tutorial
                                </button>
                                <div className="grading-task-card__grade">
                                    <span>Current grade</span>
                                    <strong>{grade}</strong>
                                </div>
                            </div>
                        </section>
                    </main>

                    <div
                        className={`grading-saved-alert ${showSavedBanner ? 'is-visible' : ''}`}
                        role="alert"
                        aria-live="polite"
                        aria-hidden={!showSavedBanner}
                    >
                        <div className="grading-saved-alert__icon" aria-hidden="true"><FiCheckCircle /></div>
                        <div className="grading-saved-alert__content">
                            <div className="grading-saved-alert__eyebrow">Task saved</div>
                            <div className="grading-saved-alert__title">Saved successfully</div>
                            <div className="grading-saved-alert__text">Your grading time and choices were saved.</div>
                        </div>
                        <button type="button" className="grading-saved-alert__close" onClick={() => setShowSavedBanner(false)} aria-label="Dismiss saved alert">
                            <FiX />
                        </button>
                    </div>

                    {renderStageTutorial()}

                    <DiffView
                        submissionId={task.submissionId}
                        classId={MINI_CLASS_ID}
                        revealHiddenOutput
                        diffViewRef={diffViewRef}
                        codeSectionTitle="Submitted Code"
                        onActiveTestcaseChange={(tc) => {
                            if (!tc || tc.passed) {
                                setActiveTestcaseName('')
                                setActiveTestcaseLongDiff('')
                                return
                            }
                            setActiveTestcaseName(tc.name ?? '')
                            setActiveTestcaseLongDiff(tc.longDiff ?? '')
                        }}
                        betweenDiffAndCode={
                            <div className="grading-banner" role="note" aria-label="How to grade this task">
                                <div className="banner-title">How to grade this task</div>
                                <div className="banner-text">
                                    {isRubricMode
                                        ? 'Use the standard rubric panel to add one instance for each rubric category that applies to the whole program.'
                                        : aiEnabled
                                            ? 'Click a line or select multiple lines, then assign errors. AI suggestions may appear after you select lines.'
                                            : 'Click a line or select multiple lines, then assign errors.'}
                                </div>
                            </div>
                        }
                        codeContainerRef={codeContainerRef}
                        lineRefs={lineRefs}
                        getLineClassName={(lineNo) => {
                            const hasError = lineMode && observedErrors.some((err) => err.startLine <= lineNo && err.endLine >= lineNo)
                            const isSelected = lineMode && selectedRange !== null && lineNo >= selectedRange.start && lineNo <= selectedRange.end
                            const isFindMatch = findMatchSet.has(lineNo)
                            const isFindActive = activeFindLine === lineNo
                            return [
                                hasError ? 'has-error' : '',
                                lineMode && hoveredLine === lineNo ? 'is-hovered' : '',
                                isSelected ? 'is-selected' : '',
                                isFindMatch ? 'is-find-match' : '',
                                isFindActive ? 'is-find-active' : '',
                            ]
                                .filter(Boolean)
                                .join(' ')
                        }}
                        onLineMouseDown={lineMode ? handleMouseDown : undefined}
                        onLineMouseEnter={lineMode ? handleMouseEnter : undefined}
                        onLineMouseLeave={lineMode ? () => setHoveredLine(null) : undefined}
                        onLineMouseUp={lineMode ? handleMouseUp : undefined}
                        belowCode={renderSummary()}
                        rightPanel={isRubricMode ? renderRubricPanel() : renderLinePanel()}
                    />
                </>
            )}
        </div>
    )
}

export default ProlificGradingTask