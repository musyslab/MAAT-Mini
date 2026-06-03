// AdminGrading.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import '../../styling/AdminGrading.scss'
import DirectoryBreadcrumbs from '../components/DirectoryBreadcrumbs'
import DiffView from '../components/CodeDiffView'
import LoadingAnimation from '../components/LoadingAnimation'

import { FiTrendingUp, FiChevronLeft, FiChevronRight, FiSave, FiUser, FiX, FiCheckCircle } from 'react-icons/fi'

const defaultpagenumber = -1

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

type ScoringMode = 'perInstance' | 'flatPerError'

type StudentSubmissionNavRow = {
    userId: number
    firstName: string
    lastName: string
    fullName: string
    submissionId: number
}

export function AdminGrading() {
    const { id, school_id, class_id, module_id, project_id, checkpoint_id: route_checkpoint_id } = useParams<{
        id: string
        school_id: string
        class_id: string
        module_id: string
        project_id: string
        checkpoint_id?: string
    }>()

    const submissionId = id !== undefined ? parseInt(id, 10) : defaultpagenumber
    const sid = school_id !== undefined ? parseInt(school_id, 10) : -1
    const cid = class_id !== undefined ? parseInt(class_id, 10) : -1
    const mid = module_id !== undefined ? parseInt(module_id, 10) : -1
    const pid = project_id !== undefined ? parseInt(project_id, 10) : -1
    const navigate = useNavigate()
    const location = useLocation()

    const schoolIdStr = school_id ?? ''
    const classIdStr = class_id ?? ''
    const moduleIdStr = module_id ?? ''
    const projectIdStr = project_id ?? ''

    const params = new URLSearchParams(location.search)
    const fromParam = (params.get('from') || '').toLowerCase()
    const fromAnalytics = fromParam === 'analytics' || fromParam === 'analytics-dashboard'
    const truthyValues = ['1', 'true', 'yes', 'y', 'on']
    const checkpointParam = (params.get('checkpoint') || params.get('practice') || '').toLowerCase()
    const isCheckpoint = !!route_checkpoint_id || truthyValues.includes(checkpointParam)
    const checkpointIdParam = (
        route_checkpoint_id ||
        params.get('checkpoint_id') ||
        params.get('practice_problem_id') ||
        ''
    ).trim()
    const parsedCheckpointId = parseInt(checkpointIdParam, 10)
    const checkpointId =
        isCheckpoint && !Number.isNaN(parsedCheckpointId) && parsedCheckpointId > 0 ? parsedCheckpointId : undefined

    const classSelectionUrl = `/admin/school/${schoolIdStr}/classes`
    const adminMenuUrl = `/admin/school/${schoolIdStr}/class/${classIdStr}/menu`
    const analyticsDashboardUrl = `/admin/school/${schoolIdStr}/class/${classIdStr}/analytics`
    const moduleListUrl = `/admin/school/${schoolIdStr}/class/${classIdStr}/modules`
    const moduleDetailsUrl = `/admin/school/${schoolIdStr}/class/${classIdStr}/module/${moduleIdStr}/overview`
    const studentListUrl = isCheckpoint && checkpointId
        ? `/admin/school/${schoolIdStr}/class/${classIdStr}/module/${moduleIdStr}/project/${projectIdStr}/checkpoint/${checkpointId}/submissions`
        : `/admin/school/${schoolIdStr}/class/${classIdStr}/module/${moduleIdStr}/project/${projectIdStr}/submissions`

    const [studentName, setStudentName] = useState<string>('')
    const [studentRoster, setStudentRoster] = useState<StudentSubmissionNavRow[]>([])
    const [studentHeaderLoading, setStudentHeaderLoading] = useState<boolean>(true)
    const [savedGradingLoading, setSavedGradingLoading] = useState<boolean>(true)
    const [showSavedBanner, setShowSavedBanner] = useState<boolean>(false)
    const [savedGrade, setSavedGrade] = useState<number | null>(null)
    const [activeTestcaseName, setActiveTestcaseName] = useState<string>('')
    const [activeTestcaseLongDiff, setActiveTestcaseLongDiff] = useState<string>('')

    // Track which lines contain errors and if errors exist
    const [observedErrors, setObservedErrors] = useState<ObservedError[]>([])
    const hasErrors = observedErrors.length > 0

    // Scoring mode:
    // - perInstance: points deducted per instance (count matters for grading)
    // - flatPerError: points deducted once if error exists on a selected range (count does not affect grading)
    const [scoringMode, setScoringMode] = useState<ScoringMode>('perInstance')

    const BASE_ERROR_DEFS = useMemo<ErrorOption[]>(
        () => [
            {
                id: 'MISSPELL',
                label: 'Spelling or word substitution error',
                description:
                    'A word or short phrase is wrong compared to expected output (including valid English words used incorrectly, missing/extra letters, or wrong small words) when the rest of the line is otherwise correct.',
                points: 10,
            },
            {
                id: 'FORMAT',
                label: 'Formatting mismatch',
                description: 'Correct content but incorrect formatting (spacing/newlines/case/spelling/precision).',
                points: 5,
            },
            {
                id: 'CONTENT',
                label: 'Missing or extra required content',
                description: 'Required value/line is missing, or additional unexpected value/line is produced.',
                points: 20,
            },
            {
                id: 'ORDER',
                label: 'Order mismatch',
                description: 'Reads inputs or prints outputs in the wrong order relative to the required sequence.',
                points: 15,
            },
            {
                id: 'INIT_STATE',
                label: 'Incorrect initialization',
                description: 'Uses uninitialized values or starts with the wrong initial state.',
                points: 20,
            },
            {
                id: 'STATE_MISUSE',
                label: 'Incorrect variable or state use',
                description: 'Wrong variable used, wrong type behavior (truncation), overwritten state, or flag not managed correctly.',
                points: 15,
            },
            {
                id: 'COMPUTE',
                label: 'Incorrect computation',
                description: 'Wrong formula, precedence, numeric operation, or derived value.',
                points: 20,
            },
            {
                id: 'CONDITION',
                label: 'Incorrect condition logic',
                description: 'Incorrect comparison, boundary, compound logic, or missing edge case handling.',
                points: 15,
            },
            {
                id: 'BRANCHING',
                label: 'Incorrect branching structure',
                description:
                    'Wrong if/elif/else structure (misbound else), missing default case, or missing break in selection-like logic.',
                points: 15,
            },
            {
                id: 'LOOP',
                label: 'Incorrect loop logic',
                description: 'Wrong bounds/termination, update/control error, off-by-one, wrong nesting, or accumulation error.',
                points: 20,
            },
            {
                id: 'INDEXING',
                label: 'Incorrect indexing or collection setup',
                description: 'Out-of-bounds, wrong base/range, or incorrect array/string/list setup (size or contents).',
                points: 20,
            },
            {
                id: 'FUNCTIONS',
                label: 'Incorrect function behavior or use',
                description: 'Wrong return behavior (missing/ignored/wrong type) or incorrect function use (scope/order/unnecessary re-calls).',
                points: 15,
            },
            {
                id: 'COMPILE',
                label: 'Program did not compile',
                description:
                    'Code fails to compile or run due to syntax errors, missing imports/includes, or build/runtime errors that prevent execution.',
                points: 40,
            },
        ],
        [],
    )

    // Custom (user-created) error defs for this grading session/page (persisted with grading config)
    const [customErrorDefs, setCustomErrorDefs] = useState<ErrorOption[]>([])
    const [newCustomLabel, setNewCustomLabel] = useState<string>('')
    const [newCustomPoints, setNewCustomPoints] = useState<number>(10)
    const [customAddError, setCustomAddError] = useState<string | null>(null)

    const makeCustomErrorId = () => `CUST_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`.toUpperCase()

    const addCustomErrorDef = () => {
        const label = newCustomLabel.trim()
        if (!label) {
            setCustomAddError('Label is required.')
            return
        }
        const id = makeCustomErrorId()
        const pts = Number.isFinite(newCustomPoints) ? Math.max(0, Math.floor(newCustomPoints)) : 0

        setCustomErrorDefs((prev) => [...prev, { id, label, description: '', points: pts }])
        setErrorPoints((prev) => ({ ...prev, [id]: pts }))
        setNewCustomLabel('')
        setNewCustomPoints(10)
        setCustomAddError(null)
        setSaveStatus('idle')
    }

    const ALL_ERROR_DEFS = useMemo<ErrorOption[]>(() => [...BASE_ERROR_DEFS, ...customErrorDefs], [BASE_ERROR_DEFS, customErrorDefs])

    // Store ONLY overrides (modified points). Defaults come from ALL_ERROR_DEFS.
    const [errorPoints, setErrorPoints] = useState<Record<string, number>>({})

    const DEFAULT_POINTS_MAP = useMemo<Record<string, number>>(() => {
        const m: Record<string, number> = {}
        for (const e of ALL_ERROR_DEFS) m[e.id] = Number.isFinite(e.points) ? Math.max(0, e.points) : 0
        return m
    }, [ALL_ERROR_DEFS])

    const getEffectivePoints = (errorId: string) => {
        const o = errorPoints[errorId]
        if (Number.isFinite(o)) return Math.max(0, o)
        return Number.isFinite(DEFAULT_POINTS_MAP[errorId]) ? Math.max(0, DEFAULT_POINTS_MAP[errorId]) : 0
    }

    const ERROR_DEFS = useMemo<ErrorOption[]>(
        () =>
            ALL_ERROR_DEFS.map((e) => ({
                ...e,
                points: getEffectivePoints(e.id),
            })),
        [ALL_ERROR_DEFS, errorPoints, DEFAULT_POINTS_MAP],
    )

    const ERROR_MAP = useMemo<Record<string, ErrorOption>>(() => {
        const map: Record<string, ErrorOption> = {}
        for (const err of ERROR_DEFS) map[err.id] = err
        return map
    }, [ERROR_DEFS])

    const bumpErrorPoints = (errorId: string, delta: number) => {
        if (!delta) return
        setErrorPoints((prev) => {
            const curEffective = Number.isFinite(prev[errorId]) ? prev[errorId] : getEffectivePoints(errorId)
            const next = Math.max(0, curEffective + delta)
            const def = Number.isFinite(DEFAULT_POINTS_MAP[errorId]) ? Math.max(0, DEFAULT_POINTS_MAP[errorId]) : 0

            // If back to default, remove override key.
            if (next === def) {
                const { [errorId]: _removed, ...rest } = prev
                return rest
            }
            return { ...prev, [errorId]: next }
        })
        setSaveStatus('idle')
    }

    // AI suggestions (dynamic, based on selected lines + failing diffs)
    const [aiSuggestionIds, setAiSuggestionIds] = useState<string[]>([])
    const [aiSuggestStatus, setAiSuggestStatus] = useState<'idle' | 'loading' | 'error'>('idle')
    const [aiSuggestError, setAiSuggestError] = useState<string | null>(null)
    const lastAiKeyRef = useRef<string>('')
    const aiAbortRef = useRef<AbortController | null>(null)
    const [aiEverRequested, setAiEverRequested] = useState<boolean>(false)
    const [aiHidden, setAiHidden] = useState<boolean>(false)

    // References for code lines
    const codeContainerRef = useRef<HTMLDivElement | null>(null)
    const lineRefs = useRef<Record<number, HTMLLIElement | null>>({})

    const [suppressNativeSelection, setSuppressNativeSelection] = useState<boolean>(false)

    const clearBrowserSelection = () => {
        const sel = window.getSelection()
        if (sel && sel.rangeCount > 0) {
            sel.removeAllRanges()
        }
    }

    useEffect(() => {
        const el = codeContainerRef.current
        if (!el) return

        el.classList.toggle('suppress-native-selection', suppressNativeSelection)

        return () => {
            el.classList.remove('suppress-native-selection')
        }
    }, [suppressNativeSelection])

    const errorCountByKey = useMemo(() => {
        const m: Record<string, number> = {}
        for (const e of observedErrors) {
            m[`${e.startLine}-${e.endLine}-${e.errorId}`] = e.count
        }
        return m
    }, [observedErrors])

    const getErrorCount = (start: number, end: number, errorId: string) => {
        return errorCountByKey[`${start}-${end}-${errorId}`] ?? 0
    }

    // Adjust COUNT (instances) via separate + / - buttons
    const bumpErrorCount = (start: number, end: number, errorId: string, delta: number) => {
        if (delta === 0) return

        setObservedErrors((prev) => {
            const idx = prev.findIndex((e) => e.startLine === start && e.endLine === end && e.errorId === errorId)
            if (idx === -1) {
                if (delta < 0) return prev
                return [...prev, { startLine: start, endLine: end, errorId: errorId, count: delta, note: '' }]
            }

            const next = [...prev]
            const cur = next[idx]
            const nextCount = (cur.count ?? 1) + delta

            if (nextCount <= 0) {
                next.splice(idx, 1)
            } else {
                next[idx] = { ...cur, count: nextCount }
            }
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

    const scrollToLine = (lineNo: number) => {
        const el = lineRefs.current[lineNo]
        if (!el) return
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    const getSelectedCodeFromDom = (range: LineRange): string => {
        const lines: string[] = []
        for (let ln = range.start; ln <= range.end; ln++) {
            const el = lineRefs.current[ln]
            if (!el) continue
            const raw = (el.textContent ?? '').replace(/\u00A0/g, ' ').trimEnd()
            const stripped = raw.replace(/^\s*\d+\s+/, '')
            lines.push(stripped)
        }
        return lines.join('\n').trim()
    }

    const requestAiSuggestions = async (range: LineRange) => {
        const key = `${submissionId}:${range.start}-${range.end}`
        if (lastAiKeyRef.current === key) return
        lastAiKeyRef.current = key

        const selectedCode = getSelectedCodeFromDom(range)
        if (!selectedCode) {
            setAiSuggestionIds([])
            setAiSuggestStatus('idle')
            setAiSuggestError(null)
            return
        }

        if (aiAbortRef.current) aiAbortRef.current.abort()
        const ctrl = new AbortController()
        aiAbortRef.current = ctrl

        setAiEverRequested(true)
        setAiSuggestStatus('loading')
        setAiSuggestError(null)

        try {
            const res = await axios.post(
                `${import.meta.env.VITE_API_URL}/ai/grading-suggestions`,
                {
                    submissionId: submissionId,
                    startLine: range.start,
                    endLine: range.end,
                    selectedCode: selectedCode,
                    testcaseName: activeTestcaseName,
                    testcaseLongDiff: activeTestcaseLongDiff,
                },
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                    },
                    signal: ctrl.signal,
                },
            )

            const ids = Array.isArray(res.data?.suggestions) ? res.data.suggestions : []
            setAiSuggestionIds(ids)
            setAiSuggestStatus('idle')
        } catch (e: any) {
            if (e?.name === 'CanceledError' || e?.code === 'ERR_CANCELED') return
            setAiSuggestStatus('error')
            setAiSuggestError('AI suggestion request failed.')
            setAiSuggestionIds([])
        }
    }

    const computeDeduction = (errorId: string, count: number) => {
        const pts = ERROR_MAP[errorId]?.points ?? 0
        if (scoringMode === 'flatPerError') return pts
        return pts * Math.max(1, count)
    }

    const autoResizeTextarea = (el: HTMLTextAreaElement | null) => {
        if (!el) return
        el.style.height = 'auto'
        el.style.height = `${el.scrollHeight}px`
    }

    const totalPoints = useMemo(() => {
        if (scoringMode === 'flatPerError') {
            const uniq = new Set<string>()
            for (const e of observedErrors) uniq.add(e.errorId)
            let sum = 0
            for (const id of uniq) sum += ERROR_MAP[id]?.points ?? 0
            return sum
        }

        return observedErrors.reduce((sum, err) => sum + computeDeduction(err.errorId, err.count ?? 1), 0)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [observedErrors, ERROR_MAP, scoringMode])

    const grade = Math.max(0, 100 - totalPoints)
    const gradedStudentRoster = useMemo(() => studentRoster.filter((row) => row.submissionId > 0), [studentRoster])

    const currentStudentIndex = useMemo(
        () => gradedStudentRoster.findIndex((row) => row.submissionId === submissionId),
        [gradedStudentRoster, submissionId],
    )

    const previousStudentNav =
        currentStudentIndex > 0
            ? gradedStudentRoster[currentStudentIndex - 1]
            : null

    const currentStudentNav = currentStudentIndex >= 0 ? gradedStudentRoster[currentStudentIndex] : null
    const nextStudentNav =
        currentStudentIndex >= 0 && currentStudentIndex < gradedStudentRoster.length - 1
            ? gradedStudentRoster[currentStudentIndex + 1]
            : null

    const goToSubmission = (nextSubmissionId: number) => {
        const parts = location.pathname.split('/')
        let targetIndex = parts.length - 1

        for (let i = parts.length - 1; i >= 0; i -= 1) {
            if (parts[i] === String(submissionId)) {
                targetIndex = i
                break
            }
        }

        parts[targetIndex] = String(nextSubmissionId)
        navigate(`${parts.join('/')}${location.search}${location.hash}`)
    }

    // Line hover and selection
    const [hoveredLine, setHoveredLine] = useState<number | null>(null)
    const [initialLine, setInitialLine] = useState<number | null>(null)
    const [selectedRange, setSelectedRange] = useState<LineRange | null>(null)
    const selectedRangeRef = useRef<LineRange | null>(null)
    useEffect(() => {
        selectedRangeRef.current = selectedRange
    }, [selectedRange])

    const selectLines = (start: number, end: number) => {
        setSelectedRange({ start: start, end: end })
    }

    const isRangeSelected = (start: number, end: number) => {
        if (selectedRange === null) return false
        return start <= selectedRange.end && end >= selectedRange.start
    }

    const handleMouseDown = (line: number) => {
        setSuppressNativeSelection(false)
        setInitialLine(line)
        selectLines(line, line)
    }

    const handleMouseEnter = (line: number) => {
        setHoveredLine(line)
        if (initialLine === null) return

        const nextRange = {
            start: Math.min(initialLine, line),
            end: Math.max(initialLine, line),
        }

        setSelectedRange(nextRange)

        const isMultiLine = nextRange.start !== nextRange.end
        setSuppressNativeSelection(isMultiLine)

        if (isMultiLine) {
            clearBrowserSelection()
        }
    }

    const handleMouseUp = () => {
        const range = selectedRangeRef.current
        const isMultiLine = range !== null && range.start !== range.end

        if (isMultiLine) {
            clearBrowserSelection()
        }

        setSuppressNativeSelection(false)
        setInitialLine(null)
    }

    useEffect(() => {
        if (initialLine !== null) return
        if (selectedRange === null) {
            setAiSuggestionIds([])
            setAiSuggestStatus('idle')
            setAiSuggestError(null)
            lastAiKeyRef.current = ''
            return
        }
        requestAiSuggestions(selectedRange)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedRange, initialLine])

    // Ctrl+F style find (commits on Enter)
    const [findInput, setFindInput] = useState<string>('')
    const [findQuery, setFindQuery] = useState<string>('') // last committed query
    const [findMatches, setFindMatches] = useState<number[]>([])
    const [findMatchIndex, setFindMatchIndex] = useState<number>(0)

    const findMatchSet = useMemo(() => new Set(findMatches), [findMatches])
    const activeFindLine = findMatches.length > 0 ? findMatches[findMatchIndex] : null

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

    // References for Navigation
    const diffViewRef = useRef<HTMLElement | null>(null)
    const allObservedErrorsRef = useRef<HTMLElement | null>(null)

    const scrollToSection = (section: HTMLElement) => {
        if (!section) return
        section.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }

    // Fetch student name for header
    useEffect(() => {
        if (submissionId < 0 || pid < 0) {
            setStudentHeaderLoading(false)
            return
        }

        setStudentHeaderLoading(true)

        axios
            .post(
                `${import.meta.env.VITE_API_URL}/submissions/recentsubproject`,
                { project_id: pid, checkpoint: isCheckpoint, checkpoint_id: checkpointId ?? null },
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                    },
                },
            )
            .then((res) => {
                const data = res.data ?? {}
                const rows: StudentSubmissionNavRow[] = Object.entries(data)
                    .map(([userId, value]) => {
                        const studentData = Array.isArray(value) ? value : []
                        const lastName = String(studentData[0] ?? '').trim()
                        const firstName = String(studentData[1] ?? '').trim()
                        const rawSubmissionId = parseInt(String(studentData[7] ?? ''), 10)

                        return {
                            userId: parseInt(userId, 10),
                            firstName: firstName,
                            lastName: lastName,
                            fullName: `${firstName} ${lastName}`.trim(),
                            submissionId: Number.isFinite(rawSubmissionId) ? rawSubmissionId : -1,
                        }
                    })
                    .sort((a, b) => {
                        const byLast = a.lastName.localeCompare(b.lastName, undefined, { sensitivity: 'base' })
                        if (byLast !== 0) return byLast

                        const byFirst = a.firstName.localeCompare(b.firstName, undefined, { sensitivity: 'base' })
                        if (byFirst !== 0) return byFirst

                        return a.userId - b.userId
                    })

                setStudentRoster(rows)

                const currentRow = rows.find((row) => row.submissionId === submissionId)
                setStudentName(currentRow?.fullName ?? '')
            })
            .catch((err) => console.log(err))
            .finally(() => setStudentHeaderLoading(false))
    }, [submissionId, pid, isCheckpoint, checkpointId])

    // Fetch saved grading errors
    useEffect(() => {
        if (submissionId < 0) {
            setSavedGradingLoading(false)
            return
        }

        setSavedGradingLoading(true)

        axios
            .get(`${import.meta.env.VITE_API_URL}/submissions/get-grading/${submissionId}`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
            })
            .then((response) => {
                const { errors, scoringMode: savedMode, errorPoints: savedPoints, errorDefs: savedDefs } = response.data
                const savedDbGrade = response.data?.grade

                setSavedGrade(Number.isFinite(Number(savedDbGrade)) ? Number(savedDbGrade) : null)

                if (savedMode === 'perInstance' || savedMode === 'flatPerError') {
                    setScoringMode(savedMode)
                }

                if (savedPoints && typeof savedPoints === 'object') {
                    setErrorPoints(savedPoints as Record<string, number>)
                } else {
                    setErrorPoints({})
                }

                if (savedDefs && typeof savedDefs === 'object') {
                    const defsArr: ErrorOption[] = Object.entries(savedDefs).map(([id, meta]) => ({
                        id: String(id),
                        label: String((meta as any)?.label ?? id),
                        description: String((meta as any)?.description ?? ''),
                        points: Number.isFinite((meta as any)?.points) ? Math.max(0, Number((meta as any).points)) : 0,
                    }))
                    setCustomErrorDefs(defsArr)
                } else {
                    setCustomErrorDefs([])
                }

                const nextErrors: ObservedError[] = (Array.isArray(errors) ? errors : []).map((item: any) => ({
                    startLine: Number(item.startLine),
                    endLine: Number(item.endLine),
                    errorId: String(item.errorId),
                    count: Math.max(1, Number(item.count ?? 1)),
                    note: typeof item.note === 'string' ? item.note : '',
                }))
                setObservedErrors(nextErrors)

                const modeForSig: ScoringMode = savedMode === 'flatPerError' ? 'flatPerError' : 'perInstance'
                const pointsForSig = savedPoints && typeof savedPoints === 'object' ? (savedPoints as Record<string, number>) : {}
                const defsForSig: ErrorOption[] =
                    savedDefs && typeof savedDefs === 'object'
                        ? Object.entries(savedDefs).map(([id, meta]) => ({
                            id: String(id),
                            label: String((meta as any)?.label ?? id),
                            description: String((meta as any)?.description ?? ''),
                            points: Number.isFinite((meta as any)?.points) ? Math.max(0, Number((meta as any).points)) : 0,
                        }))
                        : []

                savedSignatureRef.current = computeSignatureFromParts(nextErrors, modeForSig, pointsForSig, defsForSig)
                setIsDirty(false)
                setSaveStatus('idle')

            })
            .catch((err) => console.error('Could not load saved grading:', err))
            .finally(() => setSavedGradingLoading(false))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [submissionId])

    // Handles saving grading errors
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
    const isInitialPageLoading = studentHeaderLoading || savedGradingLoading
    const showLoadingOverlay = isInitialPageLoading || saveStatus === 'saving'

    // Unsaved changes tracking (dirty state)
    const [isDirty, setIsDirty] = useState<boolean>(false)
    const savedSignatureRef = useRef<string>('') // last loaded/saved snapshot

    const computeSignatureFromParts = (
        errs: ObservedError[],
        mode: ScoringMode,
        points: Record<string, number>,
        defs: ErrorOption[],
    ) => {
        const sortedErrs = [...errs].sort((a, b) => {
            if (a.startLine !== b.startLine) return a.startLine - b.startLine
            if (a.endLine !== b.endLine) return a.endLine - b.endLine
            return a.errorId.localeCompare(b.errorId)
        })

        const sortedDefs = [...defs]
            .map((d) => ({
                id: String(d.id),
                label: String(d.label ?? ''),
                description: String(d.description ?? ''),
                points: Math.max(0, Math.floor(Number(d.points ?? 0))),
            }))
            .sort((a, b) => a.id.localeCompare(b.id))

        const sortedPointsEntries = Object.entries(points ?? {})
            .map(([k, v]) => [String(k), Math.max(0, Math.floor(Number(v ?? 0)))] as const)
            .sort(([a], [b]) => a.localeCompare(b))

        return JSON.stringify({
            scoringMode: mode,
            errorPoints: sortedPointsEntries,
            errorDefs: sortedDefs,
            errors: sortedErrs.map((e) => ({
                startLine: Number(e.startLine),
                endLine: Number(e.endLine),
                errorId: String(e.errorId),
                count: Math.max(1, Number(e.count ?? 1)),
                note: String(e.note ?? ''),
            })),
        })
    }

    const currentSignature = useMemo(
        () => computeSignatureFromParts(observedErrors, scoringMode, errorPoints, customErrorDefs),
        [observedErrors, scoringMode, errorPoints, customErrorDefs],
    )

    useEffect(() => {
        const dirty = savedSignatureRef.current !== '' && currentSignature !== savedSignatureRef.current
        setIsDirty(dirty)
    }, [currentSignature])

    useEffect(() => {
        if (!isDirty) return
        setShowSavedBanner(false)
        setSaveStatus((prev) => (prev === 'saved' ? 'idle' : prev))
    }, [isDirty])

    useEffect(() => {
        if (!showSavedBanner) return

        const timer = window.setTimeout(() => {
            setShowSavedBanner(false)
            setSaveStatus('idle')
        }, 3000)

        return () => window.clearTimeout(timer)
    }, [showSavedBanner])

    const dismissSavedBanner = () => {
        setShowSavedBanner(false)
        setSaveStatus((prev) => (prev === 'saved' ? 'idle' : prev))
    }

    // Warn before leaving the page if there are unsaved changes (tab close/refresh/navigate away)
    useEffect(() => {
        const onBeforeUnload = (e: BeforeUnloadEvent) => {
            if (!isDirty) return
            e.preventDefault()
            e.returnValue = ''
        }
        window.addEventListener('beforeunload', onBeforeUnload)
        return () => window.removeEventListener('beforeunload', onBeforeUnload)
    }, [isDirty])

    const serializeErrorsForSave = (errs: ObservedError[]) => {
        // New backend supports counts directly.
        return errs.map((e) => ({
            startLine: e.startLine,
            endLine: e.endLine,
            errorId: e.errorId,
            count: Math.max(1, Number(e.count ?? 1)),
            note: (e.note ?? '').toString(),
        }))
    }

    const handleSave = () => {
        setSaveStatus('saving')
        setShowSavedBanner(false)

        const customDefsForSave: Record<string, { label: string; description: string; points: number }> = {}
        for (const e of customErrorDefs) {
            customDefsForSave[e.id] = { label: e.label, description: '', points: Math.max(0, Math.floor(Number(e.points ?? 0))) }
        }

        axios
            .post(
                `${import.meta.env.VITE_API_URL}/submissions/save-grading`,
                {
                    submissionId: submissionId,
                    grade: grade,
                    scoringMode: scoringMode,
                    errorPoints: errorPoints,
                    errorDefs: customDefsForSave,
                    errors: serializeErrorsForSave(observedErrors),
                    projectId: pid,
                    checkpoint: isCheckpoint,
                    checkpoint_id: checkpointId ?? null,
                },
                {
                    headers: {
                        Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}`,
                    },
                },
            )
            .then(() => {
                setSaveStatus('saved')
                setSavedGrade(grade)
                savedSignatureRef.current = currentSignature
                setIsDirty(false)
                setShowSavedBanner(true)
            })
            .catch((error) => {
                console.error('Failed to save:', error)
                setSaveStatus('error')
            })
    }

    // Groups and sorts errors for the All Errors table
    const tableRows = useMemo(() => {
        return Object.values(
            observedErrors.reduce((table, err) => {
                const key = `${err.startLine}-${err.endLine}`
                if (!table[key]) table[key] = [err.startLine, err.endLine, []]

                table[key][2].push(err)
                return table
            }, {} as Record<string, [number, number, ObservedError[]]>),
        ).sort((a, b) => {
            const [aStart, aEnd] = a
            const [bStart, bEnd] = b
            if (aStart !== bStart) return aStart - bStart
            return aEnd - bEnd
        })
    }, [observedErrors])

    const selectedRangeErrors = selectedRange !== null ? observedErrors.filter((err) => isRangeSelected(err.startLine, err.endLine)) : []

    const selectedRangeCountsByErrorId = useMemo(() => {
        const m: Record<string, number> = {}
        if (!selectedRange) return m
        for (const e of observedErrors) {
            if (e.startLine === selectedRange.start && e.endLine === selectedRange.end) {
                m[e.errorId] = e.count
            }
        }
        return m
    }, [observedErrors, selectedRange])

    return (
        <div className="page-container" id="admin-output-diff">
            <LoadingAnimation show={showLoadingOverlay} message={isInitialPageLoading ? 'Loading grading page...' : 'Saving grade...'} />
            <Helmet>
                <title>MAAT</title>
            </Helmet>
            <MenuComponent showUpload={false} showAdminUpload={false} showHelp={false} showCreate={false} showLast={false} showReviewButton={false} />

            <DirectoryBreadcrumbs
                items={[
                    { label: 'School Selection', to: '/admin/schools' },
                    { label: 'Class Selection', to: classSelectionUrl },
                    { label: 'Admin Menu', to: adminMenuUrl },
                    ...(fromAnalytics
                        ? [
                            { label: 'Analytics Dashboard', to: analyticsDashboardUrl },
                        ]
                        : [
                            { label: 'Module List', to: moduleListUrl },
                            { label: 'Module Details', to: moduleDetailsUrl },
                            { label: 'Student List', to: studentListUrl },
                        ]),
                    { label: 'Grade Submission' },
                ]}
                confirmOnNavigate={isDirty}
                confirmMessage="You have unsaved changes. Leave this page?"
            />

            <div className="pageTitle">Grade Submission: {studentName || 'Unknown Student'}</div>

            <div className="grading-student-nav">
                <div className="grading-student-nav__summary">
                    <div className="grading-student-chip">
                        <span className="grading-student-chip__icon" aria-hidden="true">
                            <FiUser />
                        </span>
                        <div className="grading-student-chip__content">
                            <span className="grading-student-chip__label">Student</span>
                            <span className="grading-student-chip__value">{currentStudentNav?.fullName || studentName || 'Unknown Student'}</span>
                        </div>
                    </div>

                    <div className="grading-student-chip">
                        <span className="grading-student-chip__icon" aria-hidden="true">
                            <FiSave />
                        </span>
                        <div className="grading-student-chip__content">
                            <span className="grading-student-chip__label">Current Saved Grade</span>
                            <span className="grading-student-chip__value">{savedGrade ?? 'Not saved yet'}</span>
                        </div>
                    </div>

                    <div className="grading-student-chip grading-student-chip--progress">
                        <span className="grading-student-chip__icon" aria-hidden="true">
                            <FiTrendingUp />
                        </span>
                        <div className="grading-student-chip__content">
                            <span className="grading-student-chip__label">Progress</span>
                            <span className="grading-student-chip__value">
                                {currentStudentIndex >= 0
                                    ? `Student ${currentStudentIndex + 1} of ${gradedStudentRoster.length}`
                                    : 'Student not found in roster'}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="grading-student-nav__actions">
                    <button
                        type="button"
                        className="grading-student-nav__button"
                        disabled={!previousStudentNav}
                        onClick={() => (previousStudentNav ? goToSubmission(previousStudentNav.submissionId) : null)}
                    >
                        <span className="grading-student-nav__button-icon" aria-hidden="true">
                            <FiChevronLeft />
                        </span>
                        <span className="grading-student-nav__button-text">
                            <span className="grading-student-nav__button-label">Previous</span>
                            <span className="grading-student-nav__button-name">
                                {previousStudentNav ? previousStudentNav.fullName : 'No previous submission'}
                            </span>
                        </span>
                    </button>

                    <button
                        type="button"
                        className="grading-student-nav__button"
                        disabled={!nextStudentNav}
                        onClick={() => (nextStudentNav ? goToSubmission(nextStudentNav.submissionId) : null)}
                    >
                        <span className="grading-student-nav__button-text">
                            <span className="grading-student-nav__button-label">Next</span>
                            <span className="grading-student-nav__button-name">
                                {nextStudentNav ? nextStudentNav.fullName : 'No next submission'}
                            </span>
                        </span>
                        <span className="grading-student-nav__button-icon" aria-hidden="true">
                            <FiChevronRight />
                        </span>
                    </button>
                </div>
            </div>

            <div
                className={`grading-saved-alert ${showSavedBanner ? 'is-visible' : ''}`}
                role="alert"
                aria-live="polite"
                aria-hidden={!showSavedBanner}
            >
                <div className="grading-saved-alert__icon" aria-hidden="true">
                    <FiCheckCircle />
                </div>

                <div className="grading-saved-alert__content">
                    <div className="grading-saved-alert__eyebrow">Grade submitted</div>
                    <div className="grading-saved-alert__title">Saved successfully</div>
                    <div className="grading-saved-alert__text">
                        The grade for {studentName || 'this student'} was saved.
                    </div>
                </div>

                <button
                    type="button"
                    className="grading-saved-alert__close"
                    onClick={dismissSavedBanner}
                    aria-label="Dismiss saved grade alert"
                    title="Dismiss"
                >
                    <FiX />
                </button>
            </div>

            <DiffView
                submissionId={submissionId}
                classId={cid}
                revealHiddenOutput
                diffViewRef={diffViewRef}
                codeSectionTitle="Submitted Code (click lines to mark errors)"
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
                    <div className="grading-banner" role="note" aria-label="How to add errors">
                        <div className="banner-title">How to mark errors</div>
                        <div className="banner-text">
                            Click a line or select multiple lines in the submitted code. Use the Grading Panel on the right to add or remove error
                            categories for the selected line(s).
                        </div>
                    </div>
                }
                codeContainerRef={codeContainerRef}
                lineRefs={lineRefs}
                getLineClassName={(lineNo) => {
                    const errors = observedErrors.some((err) => err.startLine <= lineNo && err.endLine >= lineNo)
                    const isFindMatch = findMatchSet.has(lineNo)
                    const isFindActive = activeFindLine === lineNo
                    return [errors ? 'has-error' : '', hoveredLine === lineNo ? 'is-hovered' : '', isRangeSelected(lineNo, lineNo) ? 'is-selected' : '', isFindMatch ? 'is-find-match' : '', isFindActive ? 'is-find-active' : '']
                        .filter(Boolean)
                        .join(' ')
                }}
                onLineMouseDown={(lineNo) => handleMouseDown(lineNo)}
                onLineMouseEnter={(lineNo) => handleMouseEnter(lineNo)}
                onLineMouseLeave={() => setHoveredLine(null)}
                onLineMouseUp={() => handleMouseUp()}
                belowCode={
                    <section className="all-observed-section" aria-label="Grading Summary and Save" ref={allObservedErrorsRef}>
                        <h2 className="section-title">Grading Summary and Save</h2>
                        <div className="all-observed-panel">
                            <div className="save-panel">
                                <div className="grade-column">
                                    <div className="grade-stack">
                                        <div className="grade-value">{grade}</div>
                                        <div className="grade-mode">{scoringMode === 'perInstance' ? 'Per-instance scoring' : 'Flat per-error scoring'}</div>
                                    </div>
                                </div>

                                <button className={`save-grade ${saveStatus}`} onClick={handleSave} disabled={saveStatus === 'saving'}>
                                    {saveStatus === 'idle' && 'Save'}
                                    {saveStatus === 'saving' && 'Saving...'}
                                    {saveStatus === 'saved' && 'Saved!'}
                                    {saveStatus === 'error' && 'Error'}
                                </button>

                                <div className="scoring-toggle" role="group" aria-label="Scoring mode toggle">
                                    <button type="button" className={`toggle-btn ${scoringMode === 'perInstance' ? 'active' : ''}`} onClick={() => setScoringMode('perInstance')}>
                                        Per instance
                                    </button>
                                    <button type="button" className={`toggle-btn ${scoringMode === 'flatPerError' ? 'active' : ''}`} onClick={() => setScoringMode('flatPerError')}>
                                        Flat per error
                                    </button>
                                </div>

                                {saveStatus === 'error' && <div className="muted small save-status">Save failed. Try again.</div>}
                            </div>

                            {!hasErrors && <div className="muted">No errors added yet.</div>}

                            {hasErrors && (
                                <div className="all-errors">
                                    {tableRows.map(([start, end, errors]) => {
                                        const totalPointsForRange =
                                            scoringMode === 'flatPerError'
                                                ? (() => {
                                                    const uniq = new Set<string>()
                                                    for (const e of errors) uniq.add(e.errorId)
                                                    let sum = 0
                                                    for (const id of uniq) sum += ERROR_MAP[id]?.points ?? 0
                                                    return sum
                                                })()
                                                : errors.reduce((sum, e) => sum + computeDeduction(e.errorId, e.count ?? 1), 0)
                                        const totalCountForRange = errors.reduce((sum, e) => sum + (e.count ?? 1), 0)

                                        return (
                                            <div
                                                key={`${start}-${end}`}
                                                className={`
                                                    all-errors-line
                                                    ${selectedRange?.start === start && selectedRange.end === end ? 'is-selected' : ''}
                                                `}
                                            >
                                                <button
                                                    type="button"
                                                    className="all-errors-line-header"
                                                    onClick={() => {
                                                        setSelectedRange({ start: start, end: end })
                                                        scrollToLine(start)
                                                    }}
                                                    title="Select line(s)"
                                                >
                                                    <span className="all-errors-line-title">{start === end ? `Line ${start}` : `Lines ${start}-${end}`}</span>
                                                    <span className="all-errors-line-meta">
                                                        {totalCountForRange} {totalCountForRange === 1 ? 'instance' : 'instances'}, -{totalPointsForRange}
                                                        {isDirty && (
                                                            <span className="unsaved-badge" title="You have unsaved changes">
                                                                Unsaved
                                                            </span>
                                                        )}
                                                    </span>
                                                </button>

                                                <div className="all-errors-line-body">
                                                    <div className="all-errors-table-header" role="row">
                                                        <div className="col label" role="columnheader">
                                                            Error
                                                        </div>
                                                        <div className="col instances" role="columnheader">
                                                            Instances
                                                        </div>
                                                        <div className="col note" role="columnheader">
                                                            Comment
                                                        </div>
                                                        <div className="col points" role="columnheader">
                                                            Points
                                                        </div>
                                                    </div>
                                                    {errors.map((err, idx) => {
                                                        const meta = ERROR_MAP[err.errorId]
                                                        const label = meta?.label ?? err.errorId
                                                        const desc = meta?.description ?? ''
                                                        const count = Math.max(1, err.count ?? 1)
                                                        const shownDeduction = computeDeduction(err.errorId, count)

                                                        return (
                                                            <div key={`${start}-${end}-${err.errorId}-${idx}`} className="all-errors-item" title={desc}>
                                                                <div className="col label">
                                                                    <span className="all-errors-item-label">{label}</span>
                                                                </div>

                                                                <div className="col instances">
                                                                    <div className="instance-box" aria-label="Instances">
                                                                        <span className={`count-badge ${count > 0 ? 'active' : ''}`}>x{count}</span>
                                                                        <div className="count-controls" aria-label="Adjust count">
                                                                            <button
                                                                                type="button"
                                                                                className="count-btn plus"
                                                                                onClick={() => bumpErrorCount(start, end, err.errorId, 1)}
                                                                                aria-label="Increase count"
                                                                                title="Increase count"
                                                                            >
                                                                                +
                                                                            </button>
                                                                            {getErrorCount(start, end, err.errorId) > 0 && (
                                                                                <button
                                                                                    type="button"
                                                                                    className="count-btn minus"
                                                                                    onClick={() => bumpErrorCount(start, end, err.errorId, -1)}
                                                                                    aria-label="Decrease count"
                                                                                    title="Decrease count"
                                                                                >
                                                                                    −
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                </div>

                                                                <textarea
                                                                    className="col note error-note"
                                                                    rows={1}
                                                                    value={err.note ?? ''}
                                                                    onChange={(e) => {
                                                                        setErrorNote(start, end, err.errorId, e.target.value)
                                                                        autoResizeTextarea(e.currentTarget)
                                                                    }}
                                                                    onInput={(e) => autoResizeTextarea(e.currentTarget)}
                                                                    placeholder="Add optional comment"
                                                                />

                                                                <div className="col points">
                                                                    <div className="points-box" aria-label="Point deduction">
                                                                        <span className="deduction-value">-{shownDeduction}</span>
                                                                        <div className="points-controls" aria-label="Adjust points">
                                                                            <button
                                                                                type="button"
                                                                                className="points-btn plus"
                                                                                onClick={() => bumpErrorPoints(err.errorId, 1)}
                                                                                aria-label="Increase points for this error type"
                                                                                title="Increase points"
                                                                            >
                                                                                +
                                                                            </button>
                                                                            <button
                                                                                type="button"
                                                                                className="points-btn minus"
                                                                                onClick={() => bumpErrorPoints(err.errorId, -1)}
                                                                                disabled={(ERROR_MAP[err.errorId]?.points ?? 0) <= 0}
                                                                                aria-label="Decrease points for this error type"
                                                                                title="Decrease points"
                                                                            >
                                                                                −
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </section>
                }
                rightPanel={
                    <aside className="grading-panel" aria-label="Grading panel">
                        <div className="grading-panel-header">
                            <div className="grading-title">Grading Panel</div>
                            <div className="grading-hint">{!selectedRange ? 'Select a line to start.' : 'Add errors to the selected line(s).'}</div>
                        </div>

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

                        <div className="navigation-section">
                            <div className="navigation-header">Jump To</div>
                            <ul className="navigation-list">
                                <li className="navigation-item" onClick={() => (diffViewRef.current !== null ? scrollToSection(diffViewRef.current) : null)}>
                                    Test Cases
                                </li>
                                <li className="navigation-item" onClick={() => (allObservedErrorsRef.current !== null ? scrollToSection(allObservedErrorsRef.current) : null)}>
                                    Grading Summary and Save
                                </li>
                            </ul>
                        </div>

                        <div className="grading-section">
                            <div className="section-label">Selected line(s)</div>
                            <div className="selected-line-row">
                                <button
                                    type="button"
                                    className={`selected-line-pill ${selectedRange ? 'active' : 'inactive'}`}
                                    disabled={!selectedRange}
                                    onClick={() => (selectedRange !== null ? scrollToLine(selectedRange.start) : null)}
                                    title="Click to jump to selected line"
                                >
                                    {selectedRange === null ? 'None' : selectedRange.start === selectedRange.end ? `Line ${selectedRange.start}` : `Lines ${selectedRange.start}-${selectedRange.end}`}
                                </button>
                            </div>
                        </div>

                        <div className="grading-section">
                            <div className="ai-suggestions-picker">
                                <div className="ai-suggestions-picker-header">
                                    <span className="ai-suggestions-picker-title">AI suggestions</span>
                                    <div className="ai-suggestions-actions">
                                        {aiEverRequested && (
                                            <>
                                                <button
                                                    type="button"
                                                    className="ai-suggest-btn"
                                                    disabled={selectedRange === null || aiSuggestStatus === 'loading'}
                                                    onClick={() => {
                                                        if (!selectedRangeRef.current) return
                                                        lastAiKeyRef.current = ''
                                                        requestAiSuggestions(selectedRangeRef.current)
                                                    }}
                                                    title="Retry AI suggestions"
                                                >
                                                    Retry
                                                </button>

                                                <button
                                                    type="button"
                                                    className="ai-suggest-btn"
                                                    onClick={() => setAiHidden((v) => !v)}
                                                    title={aiHidden ? 'Show AI suggestions' : 'Hide AI suggestions'}
                                                >
                                                    {aiHidden ? 'Show' : 'Hide'}
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>

                                <div className="ai-suggestions-picker-body">
                                    {!aiHidden && (
                                        <div className="suggestions-grid">
                                            {aiSuggestStatus === 'loading' && <div className="muted small">Generating suggestions...</div>}

                                            {aiSuggestStatus === 'error' && <div className="muted small">{aiSuggestError ?? 'AI error.'}</div>}

                                            {aiSuggestStatus === 'idle' && selectedRange !== null && aiSuggestionIds.length === 0 && (
                                                <div className="muted small">No suggestions yet for this selection.</div>
                                            )}

                                            {aiSuggestStatus !== 'loading' &&
                                                aiSuggestionIds.map((errorId) => {
                                                    const meta = ERROR_MAP[errorId]
                                                    const label = meta?.label ?? errorId
                                                    const pts = meta?.points ?? 0
                                                    const desc = meta?.description ?? ''
                                                    const count = selectedRange === null ? 0 : selectedRangeCountsByErrorId[errorId] ?? 0
                                                    const shownDeduction = selectedRange === null ? 0 : computeDeduction(errorId, Math.max(1, count))

                                                    return (
                                                        <div key={`ai-${errorId}`} className="suggestion-card" title={desc}>
                                                            <div className="suggestion-top">
                                                                <span className="suggestion-title">{label}</span>
                                                            </div>

                                                            <div className="suggestion-bottom">
                                                                <div className="instance-box" aria-label="Instances">
                                                                    <span className={`count-badge ${count > 0 ? 'active' : ''}`}>x{count}</span>
                                                                    <div className="count-controls" aria-label="Adjust count">
                                                                        <button
                                                                            type="button"
                                                                            className="count-btn plus"
                                                                            disabled={selectedRange === null}
                                                                            onClick={() => {
                                                                                if (selectedRange === null) return
                                                                                bumpErrorCount(selectedRange.start, selectedRange.end, errorId, 1)
                                                                            }}
                                                                            aria-label="Increase count"
                                                                            title="Increase count"
                                                                        >
                                                                            +
                                                                        </button>
                                                                        {selectedRange !== null && count > 0 && (
                                                                            <button
                                                                                type="button"
                                                                                className="count-btn minus"
                                                                                onClick={() => bumpErrorCount(selectedRange.start, selectedRange.end, errorId, -1)}
                                                                                aria-label="Decrease count"
                                                                                title="Decrease count"
                                                                            >
                                                                                −
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                <div className="points-box" aria-label="Point deduction">
                                                                    <span className="deduction-value">{selectedRange === null ? `-${pts}` : `-${shownDeduction}`}</span>
                                                                    <div className="points-controls" aria-label="Adjust points">
                                                                        <button
                                                                            type="button"
                                                                            className="points-btn plus"
                                                                            onClick={() => bumpErrorPoints(errorId, 1)}
                                                                            aria-label="Increase points for this error type"
                                                                            title="Increase points"
                                                                        >
                                                                            +
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            className="points-btn minus"
                                                                            onClick={() => bumpErrorPoints(errorId, -1)}
                                                                            disabled={pts <= 0}
                                                                            aria-label="Decrease points for this error type"
                                                                            title="Decrease points"
                                                                        >
                                                                            −
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                        </div>
                                    )}

                                    {aiHidden && <div className="muted small">AI suggestions are hidden.</div>}
                                </div>
                            </div>
                        </div>

                        <div className="grading-section">
                            <details className="all-errors-picker" defaultChecked={false as any}>
                                <summary className="all-errors-picker-header">
                                    <span className="all-errors-picker-title">All errors</span>
                                    <span className="all-errors-picker-count">{ERROR_DEFS.length}</span>
                                </summary>
                                <div className="all-errors-picker-body">
                                    <div className="error-options-list">
                                        {ERROR_DEFS.map((err) => {
                                            const count = selectedRange ? selectedRangeCountsByErrorId[err.id] ?? 0 : 0
                                            const shownDeduction = selectedRange === null ? err.points : computeDeduction(err.id, Math.max(1, count))

                                            return (
                                                <div key={err.id} className="suggestion-card" title={err.description}>
                                                    <div className="suggestion-top">
                                                        <span className="suggestion-title">{err.label}</span>
                                                    </div>

                                                    <div className="suggestion-bottom">
                                                        <div className="instance-box" aria-label="Instances">
                                                            <span className={`count-badge ${count > 0 ? 'active' : ''}`}>x{count}</span>
                                                            <div className="count-controls" aria-label="Adjust count">
                                                                <button
                                                                    type="button"
                                                                    className="count-btn plus"
                                                                    disabled={selectedRange === null}
                                                                    onClick={() => {
                                                                        if (selectedRange === null) return
                                                                        bumpErrorCount(selectedRange.start, selectedRange.end, err.id, 1)
                                                                    }}
                                                                    aria-label="Increase count"
                                                                    title="Increase count"
                                                                >
                                                                    +
                                                                </button>
                                                                {selectedRange !== null && count > 0 && (
                                                                    <button
                                                                        type="button"
                                                                        className="count-btn minus"
                                                                        onClick={() => bumpErrorCount(selectedRange.start, selectedRange.end, err.id, -1)}
                                                                        aria-label="Decrease count"
                                                                        title="Decrease count"
                                                                    >
                                                                        −
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>

                                                        <div className="points-box" aria-label="Point deduction">
                                                            <span className="deduction-value">-{shownDeduction}</span>
                                                            <div className="points-controls" aria-label="Adjust points">
                                                                <button
                                                                    type="button"
                                                                    className="points-btn plus"
                                                                    onClick={() => bumpErrorPoints(err.id, 1)}
                                                                    aria-label="Increase points for this error type"
                                                                    title="Increase points"
                                                                >
                                                                    +
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    className="points-btn minus"
                                                                    onClick={() => bumpErrorPoints(err.id, -1)}
                                                                    disabled={err.points <= 0}
                                                                    aria-label="Decrease points for this error type"
                                                                    title="Decrease points"
                                                                >
                                                                    −
                                                                </button>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        })}
                                    </div>

                                    <div className="custom-error-builder" aria-label="Add custom grading category">
                                        <div className="custom-error-title">Add a custom category</div>
                                        <input
                                            className="custom-error-input"
                                            type="text"
                                            value={newCustomLabel}
                                            onChange={(e) => setNewCustomLabel(e.target.value)}
                                            placeholder="Category label (required)"
                                        />
                                        <div className="custom-error-row">
                                            <input
                                                className="custom-error-points"
                                                type="number"
                                                min={0}
                                                value={Number.isFinite(newCustomPoints) ? newCustomPoints : 0}
                                                onChange={(e) => setNewCustomPoints(Number(e.target.value))}
                                            />
                                            <button type="button" className="custom-error-add-btn" onClick={addCustomErrorDef}>
                                                Add
                                            </button>
                                        </div>
                                        {customAddError && <div className="muted small">{customAddError}</div>}
                                    </div>

                                </div>

                            </details>

                            {selectedRange === null && <div className="muted small">Select a line to enable adjusting.</div>}

                        </div>

                        <div className="grading-section">
                            <div className="section-label">Errors on selected line(s)</div>

                            {selectedRange === null && <div className="muted">No line selected.</div>}

                            {selectedRange !== null && selectedRangeErrors.length === 0 && <div className="muted">No errors on this line.</div>}

                            {selectedRange !== null && selectedRangeErrors.length > 0 && (
                                <div className="line-error-list">
                                    {selectedRangeErrors.map((err, idx) => {
                                        const meta = ERROR_MAP[err.errorId]
                                        const label = meta?.label ?? err.errorId
                                        const desc = meta?.description ?? ''
                                        const count = Math.max(1, err.count ?? 1)
                                        const shownDeduction = computeDeduction(err.errorId, count)
                                        const ptsNow = meta?.points ?? 0
                                        const rangeLabel = err.startLine === err.endLine ? `Line ${err.startLine}` : `Lines ${err.startLine}-${err.endLine}`

                                        return (
                                            <div key={`${err.startLine}-${err.endLine}-${err.errorId}-${idx}`} className="suggestion-card" title={desc}>
                                                <div className="suggestion-top">
                                                    <span className="suggestion-title">{label}</span>
                                                    <span className="muted small">{rangeLabel}</span>
                                                </div>

                                                <div className="suggestion-bottom">
                                                    <div className="instance-box" aria-label="Instances">
                                                        <span className={`count-badge ${count > 0 ? 'active' : ''}`}>x{count}</span>
                                                        <div className="count-controls" aria-label="Adjust count">
                                                            <button
                                                                type="button"
                                                                className="count-btn plus"
                                                                onClick={() => bumpErrorCount(err.startLine, err.endLine, err.errorId, 1)}
                                                                aria-label="Increase count"
                                                                title="Increase count"
                                                            >
                                                                +
                                                            </button>
                                                            {getErrorCount(err.startLine, err.endLine, err.errorId) > 0 && (
                                                                <button
                                                                    type="button"
                                                                    className="count-btn minus"
                                                                    onClick={() => bumpErrorCount(err.startLine, err.endLine, err.errorId, -1)}
                                                                    aria-label="Decrease count"
                                                                    title="Decrease count"
                                                                >
                                                                    −
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <div className="points-box" aria-label="Point deduction">
                                                        <span className="deduction-value">-{shownDeduction}</span>
                                                        <div className="points-controls" aria-label="Adjust points">
                                                            <button
                                                                type="button"
                                                                className="points-btn plus"
                                                                onClick={() => bumpErrorPoints(err.errorId, 1)}
                                                                aria-label="Increase points for this error type"
                                                                title="Increase points"
                                                            >
                                                                +
                                                            </button>
                                                            <button
                                                                type="button"
                                                                className="points-btn minus"
                                                                onClick={() => bumpErrorPoints(err.errorId, -1)}
                                                                disabled={ptsNow <= 0}
                                                                aria-label="Decrease points for this error type"
                                                                title="Decrease points"
                                                            >
                                                                −
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )}
                        </div>
                    </aside>
                }
            />
        </div>
    )
}

export default AdminGrading