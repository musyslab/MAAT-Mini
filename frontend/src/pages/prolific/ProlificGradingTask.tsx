// ProlificGradingTask.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { useNavigate, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import DiffView from '../components/CodeDiffView'
import LoadingAnimation from '../components/LoadingAnimation'
import '../../styling/ProlificGrading.scss'
import '../../styling/Mini.scss'

import { FiArrowRight, FiCheckCircle, FiCpu, FiEdit3, FiList, FiTarget, FiX } from 'react-icons/fi'

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
    isRepeat: boolean
    completed: boolean
    grade?: number | null
    rubricSelections?: string[]
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

const MINI_CLASS_ID = 1

function ProgressBar({ taskIndex, taskCount }: { taskIndex: number; taskCount: number }) {
    const outerSteps = ['Prolific ID', 'Materials', 'Grading', 'Survey']
    const gradingPct = taskCount > 0 ? taskIndex / taskCount : 0
    const totalPct = Math.max(0, Math.min(100, ((2 + gradingPct) / (outerSteps.length - 1)) * 100))

    return (
        <section className="prolific-progress" aria-label="Study progress">
            <div className="prolific-progress__meta">
                <span>Progress</span>
                <span>Grading task {taskIndex} of {taskCount}</span>
            </div>
            <div className="prolific-progress__track" aria-hidden="true">
                <div className="prolific-progress__fill" style={{ width: `${totalPct}%` }} />
            </div>
            <ol className="prolific-progress__steps">
                {outerSteps.map((step, idx) => (
                    <li key={step} className={idx <= 2 ? 'is-complete' : ''}>{step}</li>
                ))}
            </ol>
        </section>
    )
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

export function ProlificGradingTask() {
    const { session_token = '', task_id = '' } = useParams<{ session_token: string; task_id: string }>()
    const taskId = Number.parseInt(task_id, 10)
    const navigate = useNavigate()

    const [payload, setPayload] = useState<TaskPayload | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
    const [showSavedBanner, setShowSavedBanner] = useState(false)

    const [rubricSelections, setRubricSelections] = useState<Record<string, boolean>>({})
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

    const [aiSuggestionIds, setAiSuggestionIds] = useState<string[]>([])
    const [aiSuggestStatus, setAiSuggestStatus] = useState<AiStatus>('idle')
    const [aiSuggestError, setAiSuggestError] = useState<string | null>(null)
    const lastAiKeyRef = useRef('')
    const aiAbortRef = useRef<AbortController | null>(null)

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

    useEffect(() => {
        selectedRangeRef.current = selectedRange
    }, [selectedRange])

    useEffect(() => {
        if (!session_token || !Number.isFinite(taskId)) return
        setLoading(true)
        setError(null)
        setSaveStatus('idle')
        setShowSavedBanner(false)
        setSelectedRange(null)
        setInitialLine(null)
        setHoveredLine(null)
        setAiSuggestionIds([])
        lastAiKeyRef.current = ''

        axios
            .get(`${import.meta.env.VITE_API_URL}/mini/prolific/session/${session_token}/tasks/${taskId}`)
            .then((res) => {
                const next = res.data as TaskPayload
                setPayload(next)
                const selected: Record<string, boolean> = {}
                for (const id of next.task?.rubricSelections ?? []) selected[id] = true
                setRubricSelections(selected)
                setRubricComment(next.task?.rubricComment ?? '')
                setObservedErrors(Array.isArray(next.task?.errors) ? next.task.errors : [])
                return axios.post(`${import.meta.env.VITE_API_URL}/mini/prolific/session/${session_token}/tasks/${taskId}/start`)
            })
            .catch((err) => {
                console.error(err)
                setError(err?.response?.data?.error || 'Could not load this grading task.')
            })
            .finally(() => setLoading(false))
    }, [session_token, taskId])

    useEffect(() => {
        if (!showSavedBanner) return
        const timer = window.setTimeout(() => {
            setShowSavedBanner(false)
            setSaveStatus((prev) => (prev === 'saved' ? 'idle' : prev))
        }, 2200)
        return () => window.clearTimeout(timer)
    }, [showSavedBanner])

    const selectedRubricIds = useMemo(() => {
        return Object.entries(rubricSelections)
            .filter(([, checked]) => checked)
            .map(([id]) => id)
    }, [rubricSelections])

    const rubricDeduction = useMemo(() => {
        return selectedRubricIds.reduce((sum, id) => sum + (errorMap[id]?.points ?? 0), 0)
    }, [selectedRubricIds, errorMap])

    const lineDeduction = useMemo(() => {
        return observedErrors.reduce((sum, err) => {
            const points = errorMap[err.errorId]?.points ?? 0
            return sum + points * Math.max(1, Number(err.count ?? 1))
        }, 0)
    }, [observedErrors, errorMap])

    const grade = Math.max(0, 100 - (isRubricMode ? rubricDeduction : lineDeduction))

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

    const scrollToLine = (lineNo: number) => {
        const el = lineRefs.current[lineNo]
        if (!el) return
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    const scrollToSection = (section: HTMLElement | null) => {
        if (!section) return
        section.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

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
    }

    const setErrorNote = (start: number, end: number, errorId: string, note: string) => {
        setObservedErrors((prev) =>
            prev.map((e) => (e.startLine === start && e.endLine === end && e.errorId === errorId ? { ...e, note } : e)),
        )
        setSaveStatus('idle')
    }

    const toggleRubric = (errorId: string) => {
        setRubricSelections((prev) => ({ ...prev, [errorId]: !prev[errorId] }))
        setSaveStatus('idle')
    }

    const saveAndContinue = () => {
        if (!payload || !task || saveStatus === 'saving') return
        setSaveStatus('saving')
        setShowSavedBanner(false)

        axios
            .post(`${import.meta.env.VITE_API_URL}/mini/prolific/session/${payload.token}/tasks/${task.id}/save`, {
                grade,
                scoringMode: isRubricMode ? 'rubric' : 'lineErrors',
                rubricSelections: selectedRubricIds,
                rubricComment,
                errors: observedErrors,
                errorPoints: {},
                errorDefs: {},
            })
            .then(() => {
                setSaveStatus('saved')
                setShowSavedBanner(true)
                if (payload.nextTaskId) {
                    navigate(`/mini/prolific/${payload.token}/tasks/${payload.nextTaskId}`)
                } else {
                    navigate(`/mini/prolific/${payload.token}/survey`)
                }
            })
            .catch((err) => {
                console.error(err)
                setSaveStatus('error')
            })
    }

    const renderRubricPanel = () => (
        <aside className="grading-panel prolific-grading-panel" aria-label="Standard rubric grading panel">
            <div className="grading-panel-header">
                <div className="grading-title">Standard rubric</div>
                <div className="grading-hint">Select each rubric category that applies to this program.</div>
            </div>

            <div className="rubric-option-list">
                {errorDefs.map((err) => (
                    <label key={err.id} className={`rubric-option ${rubricSelections[err.id] ? 'is-selected' : ''}`}>
                        <input type="checkbox" checked={!!rubricSelections[err.id]} onChange={() => toggleRubric(err.id)} />
                        <span className="rubric-option__body">
                            <span className="rubric-option__title">{err.label}</span>
                            <span className="rubric-option__description">{err.description}</span>
                        </span>
                        <span className="rubric-option__points">-{err.points}</span>
                    </label>
                ))}
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

            {!aiEnabled && (
                <div className="grading-section no-ai-note">
                    <FiEdit3 aria-hidden="true" />
                    <span>AI suggestions are intentionally hidden for this condition.</span>
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
            {saveStatus === 'error' && <div className="mini-alert">Save failed. Try again.</div>}
        </aside>
    )

    const renderSummary = () => (
        <section className="all-observed-section" aria-label="Grading summary" ref={summaryRef}>
            <h2 className="section-title">Grading Summary</h2>
            <div className="all-observed-panel prolific-summary-panel">
                <div className="save-panel">
                    <div className="grade-column">
                        <div className="grade-stack">
                            <div className="grade-value">{grade}</div>
                            <div className="grade-mode">{isRubricMode ? 'Standard rubric' : aiEnabled ? 'Line errors with AI suggestions' : 'Line errors without AI suggestions'}</div>
                        </div>
                    </div>
                    <button className={`save-grade ${saveStatus}`} onClick={saveAndContinue} disabled={saveStatus === 'saving'}>
                        {saveStatus === 'idle' && (payload?.nextTaskId ? 'Save and next' : 'Save and survey')}
                        {saveStatus === 'saving' && 'Saving...'}
                        {saveStatus === 'saved' && 'Saved!'}
                        {saveStatus === 'error' && 'Error'}
                    </button>
                </div>

                {isRubricMode && selectedRubricIds.length === 0 && <div className="muted">No rubric deductions selected.</div>}
                {isRubricMode && selectedRubricIds.length > 0 && (
                    <div className="all-errors">
                        {selectedRubricIds.map((id) => {
                            const err = errorMap[id]
                            if (!err) return null
                            return (
                                <div key={id} className="all-errors-line">
                                    <div className="all-errors-line-header">
                                        <span className="all-errors-line-title">{err.label}</span>
                                        <span className="all-errors-line-meta">-{err.points}</span>
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
            <MenuComponent />

            {task && <ProgressBar taskIndex={task.taskIndex} taskCount={task.taskCount} />}

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
                                    Grade this anonymized program.
                                    {task.isRepeat ? ' This program may look familiar; grade it independently.' : ''}
                                </p>
                            </div>
                            <div className="grading-task-card__grade">
                                <span>Current grade</span>
                                <strong>{grade}</strong>
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
                                        ? 'Use the standard rubric panel to select any categories that apply to the whole program.'
                                        : aiEnabled
                                            ? 'Click a line or select multiple lines, then assign errors. AI suggestions may appear after you select lines.'
                                            : 'Click a line or select multiple lines, then assign errors. AI suggestions are hidden for this task.'}
                                </div>
                            </div>
                        }
                        codeContainerRef={lineMode ? codeContainerRef : undefined}
                        lineRefs={lineMode ? lineRefs : undefined}
                        getLineClassName={(lineNo) => {
                            if (!lineMode) return ''
                            const hasError = observedErrors.some((err) => err.startLine <= lineNo && err.endLine >= lineNo)
                            const isSelected = selectedRange !== null && lineNo >= selectedRange.start && lineNo <= selectedRange.end
                            return [hasError ? 'has-error' : '', hoveredLine === lineNo ? 'is-hovered' : '', isSelected ? 'is-selected' : ''].filter(Boolean).join(' ')
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
