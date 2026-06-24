// frontend/src/pages/components/CodeDiffView.tsx
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import axios from 'axios'
import { diffChars } from 'diff'
import '../../styling/CodeDiffView.scss'
import { Highlight, themes, Prism } from 'prism-react-renderer'

import {
    FaRegCheckSquare,
    FaChevronDown,
    FaLock,
    FaBars,
    FaColumns,
    FaGripLines,
    FaAlignJustify,
    FaSearch,
} from 'react-icons/fa'

// Ensure Prism languages (like Java) are registered once per page load.
let prismLangsLoaded = false
let prismLangsPromise: Promise<void> | null = null
function ensurePrismLangsLoaded() {
    if (prismLangsLoaded) return Promise.resolve()
    if (prismLangsPromise) return prismLangsPromise

        ; (globalThis as any).Prism = (globalThis as any).Prism ?? Prism
    prismLangsPromise = Promise.all([
        import('prismjs/components/prism-java'),
        // Optional: keep python explicit too (safe even if already present)
        import('prismjs/components/prism-python'),
    ]).then(() => {
        prismLangsLoaded = true
    })

    return prismLangsPromise
}

type DiffMode = 'short' | 'long'
type DiffLayout = 'stacked' | 'side-by-side'
type UiLogAction = 'Diff Finder' | 'Diff Mode' | 'Diff Layout'

type NewJsonResult = {
    name: string
    description?: string
    passed: boolean
    hidden?: boolean
    shortDiff?: string
    longDiff?: string
    shortDiffSameAsLong?: boolean
}

type LegacyJsonTest = {
    output?: Array<string>
    type?: number
    description?: string
    name?: string
    hidden?: boolean
}

type LegacyJsonResult = {
    skipped?: boolean
    passed?: boolean
    test?: LegacyJsonTest
}

type AnyPayload = {
    results?: any[]
}

type DiffEntry = {
    id: string
    num: number
    test: string
    description: string
    status: string
    passed: boolean
    skipped: boolean
    shortDiff: string
    longDiff: string
    shortDiffSameAsLong: boolean
    hidden: boolean
}

type CodeFile = {
    name: string
    content: string
}

type Seg = { text: string; changed: boolean }

type DiffCellKind = 'add' | 'del' | 'ctx' | 'meta' | 'add-header' | 'del-header' | 'empty'

type SideBySideRow = {
    key: string
    leftText: string
    rightText: string
    leftKind: DiffCellKind
    rightKind: DiffCellKind
    leftSegs?: Seg[]
    rightSegs?: Seg[]
}

const MAX_CHANGE_RATIO_FOR_INTRA = 0.7
const SHARED_SIDE_SCROLLBAR_EPSILON_PX = 1

function diffModeStateLabel(mode: DiffMode) {
    return mode === 'short' ? 'Short' : 'Long'
}

function diffLayoutStateLabel(layout: DiffLayout) {
    return layout === 'side-by-side' ? 'Side by Side' : 'Vertical'
}

function normalizeNewlines(text: string) {
    return (text ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function safeJsonParse(maybe: any): any {
    if (typeof maybe !== 'string') return maybe
    const s = maybe.trim()
    if (!s) return maybe
    if (!(s.startsWith('{') || s.startsWith('['))) return maybe
    try {
        return JSON.parse(s)
    } catch {
        return maybe
    }
}

// Legacy: older grader encoded expected/actual in output blocks
function parseLegacyOutputs(raw: string): { expected: string; actual: string; hadDiff: boolean } {
    const txt = raw ?? ''
    if (txt.includes('~~~diff~~~')) {
        const [userPart, expectedPart = ''] = txt.split('~~~diff~~~')
        return { expected: expectedPart, actual: userPart, hadDiff: true }
    }

    const lines = txt.replace(/\r\n/g, '\n').split('\n')
    const expectedLines: string[] = []
    const actualLines: string[] = []
    let sawDiffMarker = false

    for (const l of lines) {
        const t = l.trimStart()
        if (t.startsWith('---')) {
            sawDiffMarker = true
            continue
        }
        if (t.startsWith('< ')) {
            expectedLines.push(t.slice(2))
            sawDiffMarker = true
            continue
        }
        if (t.startsWith('> ')) {
            actualLines.push(t.slice(2))
            sawDiffMarker = true
            continue
        }
    }

    if (sawDiffMarker) {
        return { expected: expectedLines.join('\n'), actual: actualLines.join('\n'), hadDiff: true }
    }
    return { expected: '', actual: txt, hadDiff: false }
}

// Simple unified diff builder (legacy fallback only)
function buildUnifiedDiffLegacy(expected: string, actual: string, title: string): string {
    const e = normalizeNewlines(expected).split('\n')
    const a = normalizeNewlines(actual).split('\n')
    const lines: string[] = []
    lines.push(`--- actual:${title}`)
    lines.push(`+++ expected:${title}`)
    const max = Math.max(e.length, a.length)
    for (let i = 0; i < max; i++) {
        const el = e[i] ?? ''
        const al = a[i] ?? ''
        if (el === al) {
            lines.push(` ${el}`)
        } else {
            if (al !== '') lines.push(`-${al}`)
            if (el !== '') lines.push(`+${el}`)
            if (el === '' && al === '') lines.push(' ')
        }
    }
    return lines.join('\n')
}

function intralineSegments(a: string, b: string): { a: Seg[]; b: Seg[] } {
    const parts = diffChars(a ?? '', b ?? '')
    const A: Seg[] = []
    const B: Seg[] = []
    for (const p of parts) {
        if ((p as any).added) {
            B.push({ text: (p as any).value, changed: true })
        } else if ((p as any).removed) {
            A.push({ text: (p as any).value, changed: true })
        } else {
            A.push({ text: (p as any).value, changed: false })
            B.push({ text: (p as any).value, changed: false })
        }
    }
    return { a: A, b: B }
}

function areSimilarForIntra(a: string, b: string): boolean {
    const parts = diffChars(a ?? '', b ?? '')
    let changed = 0
    const total = Math.max((a ?? '').length, (b ?? '').length, 1)
    for (const p of parts) {
        if ((p as any).added || (p as any).removed) changed += (p as any).value.length
    }
    return changed / total <= MAX_CHANGE_RATIO_FOR_INTRA
}

function renderSegs(segs: Seg[], cls: 'add-ch' | 'del-ch') {
    return segs.map((seg, idx) =>
        seg.changed ? (
            <span key={idx} className={`intra ${cls}`}>
                {seg.text}
            </span>
        ) : (
            <span key={idx}>{seg.text}</span>
        )
    )
}

type DiffViewProps = {
    submissionId: number
    classId: number
    isPractice?: boolean
    practiceProblemId?: number | null

    // Optional: enable grading-like behaviors (ProlificGradingTask uses these)
    codeSectionTitle?: string
    diffViewRef?: React.RefObject<HTMLElement | null>
    codeContainerRef?: React.RefObject<HTMLDivElement | null>
    lineRefs?: React.MutableRefObject<Record<number, HTMLLIElement | null>>
    getLineClassName?: (lineNo: number) => string
    onLineMouseEnter?: (lineNo: number) => void
    onLineMouseLeave?: (lineNo: number) => void
    onLineMouseDown?: (lineNo: number) => void
    onLineMouseUp?: () => void
    rightPanel?: React.ReactNode
    betweenDiffAndCode?: React.ReactNode
    belowCode?: React.ReactNode
    onActiveTestcaseChange?: (tc: { name: string; num: number; passed: boolean; longDiff: string; shortDiff: string }) => void

    // If true: prevent selection/copying in the diff (student view).
    // If false/undefined: allow selecting/copying (staff/grading views).
    disableCopy?: boolean

    // If true: show the "Output hidden" banner, but still reveal the diff/output below (staff/grading views).
    // If false/undefined: keep hidden outputs hidden (student view).
    revealHiddenOutput?: boolean

}

export default function DiffView(props: DiffViewProps) {
    const {
        submissionId,
        classId,
        diffViewRef,
        codeSectionTitle = 'Submitted Code',
        codeContainerRef,
        lineRefs,
        getLineClassName,
        onLineMouseEnter,
        onLineMouseLeave,
        onLineMouseDown,
        onLineMouseUp,
        rightPanel,
        betweenDiffAndCode,
        belowCode,
        onActiveTestcaseChange,
        disableCopy = false,
        revealHiddenOutput = false,
        isPractice = false,
        practiceProblemId = null,
    } = props

    const internalCodeContainerRef = useRef<HTMLDivElement | null>(null)
    const effectiveCodeContainerRef = codeContainerRef ?? internalCodeContainerRef

    const sideBySideLeftRef = useRef<HTMLDivElement | null>(null)
    const sideBySideRightRef = useRef<HTMLDivElement | null>(null)
    const sideBySideBarRef = useRef<HTMLDivElement | null>(null)
    const sideBySideLeftContentRef = useRef<HTMLDivElement | null>(null)
    const sideBySideRightContentRef = useRef<HTMLDivElement | null>(null)
    const syncingSideScrollRef = useRef(false)

    const copyBlockHandlers = disableCopy
        ? {
            onCopy: (e: React.ClipboardEvent) => e.preventDefault(),
            onCut: (e: React.ClipboardEvent) => e.preventDefault(),
        }
        : {}

    const [testsLoaded, setTestsLoaded] = useState(false)
    const [payload, setPayload] = useState<AnyPayload>({ results: [] })

    // Force a rerender after Prism languages load so Highlight can use the grammar.
    const [, forcePrismRefresh] = useState(0)
    useEffect(() => {
        ensurePrismLangsLoaded().then(() => forcePrismRefresh((v) => v + 1))
    }, [])

    const [codeFiles, setCodeFiles] = useState<CodeFile[]>([])
    const [selectedCodeFile, setSelectedCodeFile] = useState<string>('')

    const [selectedDiffId, setSelectedDiffId] = useState<string | null>(null)
    const [testcaseDataKey, setTestcaseDataKey] = useState<string>('')
    const [diffMode, setDiffMode] = useState<DiffMode>('long')
    const [diffLayout, setDiffLayout] = useState<DiffLayout>('side-by-side')

    const testcaseSelectionKey = `${submissionId}:${classId}:${isPractice ? 1 : 0}:${practiceProblemId ?? 'none'}`

    // Intra-line highlight toggle
    const initialIntraRef = useRef<boolean>(true)
    const [intraEnabled, setIntraEnabled] = useState<boolean>(initialIntraRef.current)

    // Track which (submissionId,classId) we've already logged to avoid duplicate logs (React StrictMode)
    const initLogKeyRef = useRef<string | null>(null)

    // Track which testcase payload has had its initial topmost testcase selected.
    // Without this, matching generated testcase ids can preserve the previous selection across programs.
    const selectedDiffResetKeyRef = useRef<string | null>(null)

    const logUiClick = (
        action: UiLogAction,
        startedState?: boolean,
        previousStateLabel?: string,
        nextStateLabel?: string
    ) => {
        const shouldLogStarted = action === 'Diff Finder'
        if (submissionId < 0 || classId < 0) return
        axios.post(
            `${import.meta.env.VITE_API_URL}/submissions/log_ui`,
            {
                id: submissionId,
                class_id: classId,
                action,
                started_state: shouldLogStarted ? startedState : undefined,
                previous_state_label: previousStateLabel,
                next_state_label: nextStateLabel,
                practice: isPractice,
                practice_problem_id: practiceProblemId,
            },
            { headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` } }
        )
    }

    const syncSideBySideScroll = (source: 'left' | 'right' | 'bar') => {
        if (syncingSideScrollRef.current) return

        const left = sideBySideLeftRef.current
        const right = sideBySideRightRef.current
        const bar = sideBySideBarRef.current

        if (!left || !right || !bar) return

        syncingSideScrollRef.current = true

        if (source === 'bar') {
            const nextScrollLeft = bar.scrollLeft
            left.scrollLeft = nextScrollLeft
            right.scrollLeft = nextScrollLeft
        } else if (source === 'left') {
            // Keep the shared scrollbar visually aligned to the most recently moved pane,
            // but do not move the other pane.
            bar.scrollLeft = left.scrollLeft
        } else {
            // Keep the shared scrollbar visually aligned to the most recently moved pane,
            // but do not move the other pane.
            bar.scrollLeft = right.scrollLeft
        }

        requestAnimationFrame(() => {
            syncingSideScrollRef.current = false
        })
    }

    const getSideBySideContentWidth = (
        pane: HTMLDivElement | null,
        content: HTMLDivElement | null
    ) => {
        if (!pane) return 0

        const cellWidths = content
            ? Array.from(content.querySelectorAll<HTMLElement>('.sbs-cell')).map((el) =>
                Math.max(el.scrollWidth, el.offsetWidth, el.getBoundingClientRect().width)
            )
            : []

        return Math.max(
            pane.scrollWidth,
            pane.offsetWidth,
            pane.getBoundingClientRect().width,
            content?.scrollWidth ?? 0,
            content?.offsetWidth ?? 0,
            content?.getBoundingClientRect().width ?? 0,
            ...cellWidths
        )
    }

    const updateSharedSideScrollMetrics = () => {
        const left = sideBySideLeftRef.current
        const right = sideBySideRightRef.current
        const bar = sideBySideBarRef.current

        if (!left || !right || !bar) return

        const maxPaneScrollWidth = Math.max(
            getSideBySideContentWidth(left, sideBySideLeftContentRef.current),
            getSideBySideContentWidth(right, sideBySideRightContentRef.current)
        )

        const paneClientWidth = Math.min(
            left.clientWidth || Number.POSITIVE_INFINITY,
            right.clientWidth || Number.POSITIVE_INFINITY
        )
        const barClientWidth = bar.clientWidth

        if (!Number.isFinite(paneClientWidth) || paneClientWidth <= 0 || barClientWidth <= 0) return

        const scrollableDistance = Math.max(0, maxPaneScrollWidth - paneClientWidth)
        const nextWidth = Math.max(
            barClientWidth + SHARED_SIDE_SCROLLBAR_EPSILON_PX,
            barClientWidth + scrollableDistance
        )

        bar.style.setProperty('--side-by-side-bar-inner-width', `${nextWidth}px`)

        const inner = bar.firstElementChild as HTMLDivElement | null
        if (inner) inner.style.width = `${nextWidth}px`

        const maxBarScrollLeft = Math.max(0, nextWidth - barClientWidth)
        if (bar.scrollLeft > maxBarScrollLeft) bar.scrollLeft = maxBarScrollLeft
    }

    useEffect(() => {
        const nextDataKey = testcaseSelectionKey

        setTestsLoaded(false)
        setPayload({ results: [] })
        setTestcaseDataKey('')
        setSelectedDiffId(null)
        selectedDiffResetKeyRef.current = null
        setCodeFiles([])
        setSelectedCodeFile('')

        if (submissionId < 0 || classId < 0) {
            setPayload({ results: [] })
            setTestcaseDataKey(nextDataKey)
            setTestsLoaded(true)
            return
        }

        axios
            .get(
                `${import.meta.env.VITE_API_URL}/submissions/testcaseerrors?id=${submissionId}&class_id=${classId}` +
                `&practice=${isPractice ? 1 : 0}` +
                (practiceProblemId != null ? `&practice_problem_id=${practiceProblemId}` : ``),
                {
                    headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` },
                })
            .then((res) => {
                const maybe = safeJsonParse(res.data)
                setPayload((maybe && typeof maybe === 'object' ? maybe : { results: [] }) as AnyPayload)
                setTestcaseDataKey(nextDataKey)
                setTestsLoaded(true)
            })
            .catch((err) => {
                console.log(err)
                setPayload({ results: [] })
                setTestcaseDataKey(nextDataKey)
                setTestsLoaded(true)
            })
    }, [submissionId, classId, isPractice, practiceProblemId, testcaseSelectionKey])

    // Baseline the toggles on mount per submission/class
    useEffect(() => {
        if (submissionId < 0 || classId < 0) return
        const key = `${submissionId}:${classId}`
        if (initLogKeyRef.current === key) return
        initLogKeyRef.current = key
        logUiClick(
            'Diff Mode',
            diffMode === 'long',
            diffModeStateLabel(diffMode),
            diffModeStateLabel(diffMode)
        )
        logUiClick(
            'Diff Layout',
            diffLayout === 'side-by-side',
            diffLayoutStateLabel(diffLayout),
            diffLayoutStateLabel(diffLayout)
        )
        logUiClick(
            'Diff Finder',
            initialIntraRef.current,
            initialIntraRef.current ? 'On' : 'Off',
            initialIntraRef.current ? 'On' : 'Off'
        )
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [submissionId, classId])

    useEffect(() => {
        if (submissionId < 0 || classId < 0) {
            setCodeFiles([{ name: 'Submission', content: '' }])
            setSelectedCodeFile('Submission')
            return
        }

        axios
            .get(
                `${import.meta.env.VITE_API_URL}/submissions/codefinder?id=${submissionId}&class_id=${classId}&format=json` +
                `&practice=${isPractice ? 1 : 0}` +
                (practiceProblemId != null ? `&practice_problem_id=${practiceProblemId}` : ``),
                { headers: { Authorization: `Bearer ${localStorage.getItem('AUTOTA_AUTH_TOKEN')}` } }
            )
            .then((res) => {
                const data = safeJsonParse(res.data) as any

                // New shape: { files: [{ name, content }, ...] }
                if (data && typeof data === 'object' && Array.isArray(data.files)) {
                    const files: CodeFile[] = data.files
                        .filter((f: any) => f && typeof f.name === 'string')
                        .map((f: any) => ({ name: String(f.name), content: String(f.content ?? '') }))

                    setCodeFiles(files)
                    setSelectedCodeFile((prev) =>
                        prev && files.some((ff) => ff.name === prev) ? prev : files[0]?.name ?? ''
                    )
                    return
                }

                // Backward compat: old endpoint returned a single string
                if (typeof data === 'string') {
                    setCodeFiles([{ name: 'Submission', content: data }])
                    setSelectedCodeFile('Submission')
                    return
                }

                // Last-resort fallback
                setCodeFiles([{ name: 'Submission', content: '' }])
                setSelectedCodeFile('Submission')
            })
            .catch((err) => {
                console.log(err)
                setCodeFiles([{ name: 'Submission', content: '' }])
                setSelectedCodeFile('Submission')
            })
    }, [submissionId, classId])

    const diffFilesAll: DiffEntry[] = useMemo(() => {
        const raw = Array.isArray(payload?.results) ? payload.results : []
        const entries: DiffEntry[] = []

        const looksNew =
            raw.length > 0 &&
            raw.some((r: any) => r && typeof r === 'object' && ('shortDiff' in r || 'longDiff' in r || 'name' in r))

        if (looksNew) {
            raw.forEach((r: any, idx: number) => {
                const rr = (r ?? {}) as NewJsonResult
                const testName = String(rr.name ?? `Test ${idx + 1}`)
                const passed = Boolean(rr.passed)
                const hidden = Boolean((rr as any).hidden)
                const shortDiff = String(rr.shortDiff ?? '')
                const longDiff = String(rr.longDiff ?? '')
                const shortDiffSameAsLong = Boolean((rr as any).shortDiffSameAsLong)
                const desc = String(rr.description ?? '')
                entries.push({
                    id: `${idx}__${testName}`,
                    num: idx + 1,
                    test: testName,
                    description: desc,
                    status: passed ? 'Passed' : 'Failed',
                    passed,
                    skipped: false,
                    shortDiff,
                    longDiff,
                    shortDiffSameAsLong,
                    hidden,
                })
            })
            return entries.sort((a, b) => Number(a.passed) - Number(b.passed) || a.test.localeCompare(b.test))
        }

        // Legacy fallback (should be rare now): convert old shape into unified-ish diffs
        raw.forEach((r: any, idx: number) => {
            const rr = (r ?? {}) as LegacyJsonResult
            const skipped = Boolean(rr.skipped)
            const passed = Boolean(rr.passed)
            const t = rr.test ?? {}
            const testName = String(t.name ?? `Test ${idx + 1}`)
            const desc = String(t.description ?? '')
            const hidden = Boolean((t as any).hidden)
            const rawOut = (skipped ? ['This test did not run due to a configuration issue.'] : (t.output || [])).join(
                '\n'
            )
            const { expected, actual, hadDiff } = parseLegacyOutputs(rawOut)
            const unified = buildUnifiedDiffLegacy(expected, actual, testName)

            entries.push({
                id: `${idx}__${testName}`,
                num: idx + 1,
                test: testName,
                description: desc,
                status: skipped ? 'Skipped' : passed ? 'Passed' : 'Failed',
                passed,
                skipped,
                shortDiff: passed ? '' : unified,
                longDiff: passed ? '' : unified,
                shortDiffSameAsLong: !passed && !skipped,
                hidden,
            })

            // If there was no explicit diff, still show something readable
            if (!passed && !skipped && !hadDiff && !unified.trim()) {
                entries[entries.length - 1].shortDiff = buildUnifiedDiffLegacy('', rawOut, testName)
                entries[entries.length - 1].longDiff = entries[entries.length - 1].shortDiff
                entries[entries.length - 1].shortDiffSameAsLong = true
            }
        })

        return entries.sort((a, b) => Number(a.passed) - Number(b.passed) || a.test.localeCompare(b.test))
    }, [payload])

    useEffect(() => {
        if (testcaseDataKey !== testcaseSelectionKey) return

        if (diffFilesAll.length === 0) {
            selectedDiffResetKeyRef.current = testcaseSelectionKey
            if (selectedDiffId !== null) setSelectedDiffId(null)
            return
        }

        if (selectedDiffResetKeyRef.current !== testcaseSelectionKey) {
            selectedDiffResetKeyRef.current = testcaseSelectionKey
            setSelectedDiffId(diffFilesAll[0].id)
            return
        }

        if (!selectedDiffId || diffFilesAll.every((f) => f.id !== selectedDiffId)) {
            setSelectedDiffId(diffFilesAll[0]?.id ?? null)
        }
    }, [diffFilesAll, selectedDiffId, testcaseDataKey, testcaseSelectionKey])

    const selectedFile = useMemo(
        () => diffFilesAll.find((f) => f.id === selectedDiffId) || null,
        [diffFilesAll, selectedDiffId]
    )

    useEffect(() => {
        if (!onActiveTestcaseChange) return
        if (!selectedFile) return
        onActiveTestcaseChange({
            name: selectedFile.test,
            num: selectedFile.num,
            passed: selectedFile.passed,
            longDiff: selectedFile.longDiff ?? '',
            shortDiff: selectedFile.shortDiff ?? '',
        })
    }, [selectedFile, onActiveTestcaseChange])

    const showLayoutToggle = useMemo(() => {
        if (!selectedFile || selectedFile.passed) return false
        if (selectedFile.hidden && !revealHiddenOutput) return false
        return true
    }, [selectedFile, revealHiddenOutput])

    const showDiffModeToggle = useMemo(() => {
        if (!selectedFile || selectedFile.passed) return false
        if (selectedFile.hidden && !revealHiddenOutput) return false
        return !selectedFile.shortDiffSameAsLong
    }, [selectedFile, revealHiddenOutput])

    // If short and long are identical, force long so we never show an empty "short".
    useEffect(() => {
        if (!selectedFile || selectedFile.passed) return
        if (selectedFile.shortDiffSameAsLong && diffMode !== 'long') {
            setDiffMode('long')
        }
    }, [selectedFile, diffMode])

    const selectedDiffText = useMemo(() => {
        if (!selectedFile) return ''
        if (selectedFile.passed) return ''
        if (selectedFile.hidden && !revealHiddenOutput) return ''
        if (selectedFile.shortDiffSameAsLong) return selectedFile.longDiff ?? ''
        return diffMode === 'short' ? (selectedFile.shortDiff ?? '') : (selectedFile.longDiff ?? '')
    }, [selectedFile, diffMode, revealHiddenOutput])

    useEffect(() => {
        if (diffLayout !== 'side-by-side') return

        if (sideBySideLeftRef.current) sideBySideLeftRef.current.scrollLeft = 0
        if (sideBySideRightRef.current) sideBySideRightRef.current.scrollLeft = 0
        if (sideBySideBarRef.current) sideBySideBarRef.current.scrollLeft = 0
    }, [diffLayout, selectedDiffId, diffMode])

    const hasIntraInSelected = useMemo(() => {
        if (!selectedFile || selectedFile.passed) return false
        if (selectedFile.hidden && !revealHiddenOutput) return false
        const txt = selectedDiffText || ''
        const lines = txt.split('\n')
        for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i] ?? ''
            if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) continue
            const next = lines[i + 1] ?? ''

            const isSingleAdd = line.startsWith('+') && !line.startsWith('+++')
            const isSingleDel = line.startsWith('-') && !line.startsWith('---')
            const nextIsSingleAdd = next.startsWith('+') && !next.startsWith('+++')
            const nextIsSingleDel = next.startsWith('-') && !next.startsWith('---')
            const pairable = (isSingleDel && nextIsSingleAdd) || (isSingleAdd && nextIsSingleDel)

            if (!pairable) continue

            const delText = (isSingleDel ? line : next).slice(1)
            const addText = (isSingleDel ? next : line).slice(1)
            if (areSimilarForIntra(delText, addText)) return true
        }
        return false
    }, [selectedFile, selectedDiffText, revealHiddenOutput])

    const sideBySideRows = useMemo<SideBySideRow[]>(() => {
        const txt = selectedDiffText || ''
        if (!txt.trim()) return []

        const lines = txt.split('\n')
        const rows: SideBySideRow[] = []

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? ''
            const next = lines[i + 1] ?? ''

            if (line.startsWith('---') && next.startsWith('+++')) {
                rows.push({
                    key: `hdr-${i}`,
                    leftText: line,
                    rightText: next,
                    leftKind: 'del-header',
                    rightKind: 'add-header',
                })
                i++
                continue
            }

            if (line.startsWith('+++') && next.startsWith('---')) {
                rows.push({
                    key: `hdr-${i}`,
                    leftText: next,
                    rightText: line,
                    leftKind: 'del-header',
                    rightKind: 'add-header',
                })
                i++
                continue
            }

            if (line.startsWith('---')) {
                rows.push({
                    key: `hdr-left-${i}`,
                    leftText: line,
                    rightText: '',
                    leftKind: 'del-header',
                    rightKind: 'empty',
                })
                continue
            }

            if (line.startsWith('+++')) {
                rows.push({
                    key: `hdr-right-${i}`,
                    leftText: '',
                    rightText: line,
                    leftKind: 'empty',
                    rightKind: 'add-header',
                })
                continue
            }

            if (line.startsWith('@@')) {
                rows.push({
                    key: `meta-${i}`,
                    leftText: line,
                    rightText: line,
                    leftKind: 'meta',
                    rightKind: 'meta',
                })
                continue
            }

            const isSingleAdd = line.startsWith('+') && !line.startsWith('+++')
            const isSingleDel = line.startsWith('-') && !line.startsWith('---')
            const nextIsSingleAdd = next.startsWith('+') && !next.startsWith('+++')
            const nextIsSingleDel = next.startsWith('-') && !next.startsWith('---')
            const pairable = (isSingleDel && nextIsSingleAdd) || (isSingleAdd && nextIsSingleDel)

            if (pairable) {
                const delLine = isSingleDel ? line : next
                const addLine = isSingleDel ? next : line
                const delText = delLine.slice(1)
                const addText = addLine.slice(1)

                if (intraEnabled && areSimilarForIntra(delText, addText)) {
                    const { a, b } = intralineSegments(delText, addText)
                    rows.push({
                        key: `pair-${i}`,
                        leftText: delLine,
                        rightText: addLine,
                        leftKind: 'del',
                        rightKind: 'add',
                        leftSegs: a,
                        rightSegs: b,
                    })
                } else {
                    rows.push({
                        key: `pair-${i}`,
                        leftText: delLine,
                        rightText: addLine,
                        leftKind: 'del',
                        rightKind: 'add',
                    })
                }

                i++
                continue
            }

            if (isSingleDel) {
                rows.push({
                    key: `del-${i}`,
                    leftText: line,
                    rightText: '',
                    leftKind: 'del',
                    rightKind: 'empty',
                })
                continue
            }

            if (isSingleAdd) {
                rows.push({
                    key: `add-${i}`,
                    leftText: '',
                    rightText: line,
                    leftKind: 'empty',
                    rightKind: 'add',
                })
                continue
            }

            rows.push({
                key: `ctx-${i}`,
                leftText: line,
                rightText: line,
                leftKind: 'ctx',
                rightKind: 'ctx',
            })
        }

        return rows
    }, [selectedDiffText, intraEnabled])

    useLayoutEffect(() => {
        if (diffLayout !== 'side-by-side') return
        if (sideBySideRows.length === 0) return

        let cancelled = false
        let frame1 = 0
        let frame2 = 0
        const timeouts: number[] = []

        const refreshMetrics = () => {
            if (cancelled) return
            updateSharedSideScrollMetrics()
        }

        refreshMetrics()

        frame1 = requestAnimationFrame(() => {
            refreshMetrics()

            frame2 = requestAnimationFrame(() => {
                refreshMetrics()
            })
        })

        // The side-by-side layout can finish sizing after async data, fonts, and parent panels settle.
        // Rechecking a few times prevents the shared bar from staying at its initial no-overflow width.
        ;[0, 50, 150, 500].forEach((delay) => {
            timeouts.push(window.setTimeout(refreshMetrics, delay))
        })

        const resizeObserver =
            typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refreshMetrics) : null

        ;[
            sideBySideLeftRef.current,
            sideBySideRightRef.current,
            sideBySideBarRef.current,
            sideBySideLeftContentRef.current,
            sideBySideRightContentRef.current,
            sideBySideBarRef.current?.parentElement ?? null,
            sideBySideLeftRef.current?.closest('.diff-code') ?? null,
            sideBySideLeftRef.current?.closest('.diff-pane') ?? null,
        ].forEach((el) => {
            if (el && resizeObserver) resizeObserver.observe(el)
        })

        const mutationObserver =
            typeof MutationObserver !== 'undefined' ? new MutationObserver(refreshMetrics) : null

        ;[sideBySideLeftContentRef.current, sideBySideRightContentRef.current].forEach((el) => {
            if (el && mutationObserver) {
                mutationObserver.observe(el, { childList: true, subtree: true, characterData: true })
            }
        })

        window.addEventListener('resize', refreshMetrics)

        return () => {
            cancelled = true
            cancelAnimationFrame(frame1)
            cancelAnimationFrame(frame2)
            timeouts.forEach((timeout) => window.clearTimeout(timeout))
            resizeObserver?.disconnect()
            mutationObserver?.disconnect()
            window.removeEventListener('resize', refreshMetrics)
        }
    }, [diffLayout, selectedDiffId, selectedDiffText, intraEnabled, sideBySideRows.length])

    const selectedCode = useMemo(() => {
        if (codeFiles.length === 0) return null
        return codeFiles.find((f) => f.name === selectedCodeFile) ?? codeFiles[0]
    }, [codeFiles, selectedCodeFile])

    const codeText = selectedCode?.content ?? ''
    const language =
        selectedCode?.name?.endsWith('.py')
            ? 'python'
            : selectedCode?.name?.endsWith('.java')
                ? 'java'
                : 'clike'

    const isLineClickable = Boolean(onLineMouseDown)

    const renderSideBySideCell = (text: string, kind: DiffCellKind, segs?: Seg[]) => {
        if (kind === 'empty') return <span className="sbs-placeholder">{'\u00A0'}</span>

        if (kind === 'add' || kind === 'del') {
            const rawText = text.slice(1)
            return (
                <>
                    <span className="diff-sign">{kind === 'add' ? '+' : '-'}</span>
                    {segs ? renderSegs(segs, kind === 'add' ? 'add-ch' : 'del-ch') : rawText || '\u00A0'}
                </>
            )
        }

        return text || '\u00A0'
    }

    const renderStackedDiff = () => {
        const txt = selectedDiffText || ''
        if (!txt.trim()) {
            return <div className="muted">No diff text was provided for this test in {diffMode}.</div>
        }

        const lines = txt.split('\n')
        const out: JSX.Element[] = []

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i] ?? ''

            // Headers/hunks first so they never pair or get intra
            if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) {
                const headerCls = line.startsWith('---')
                    ? 'del header'
                    : line.startsWith('+++')
                        ? 'add header'
                        : 'meta header'
                out.push(
                    <div key={i} className={`diff-line ${headerCls}`}>
                        {line || ' '}
                    </div>
                )
                continue
            }

            const type = line[0]
            const content = line.slice(1)
            const next = lines[i + 1] ?? ''

            const isSingleAdd = line.startsWith('+') && !line.startsWith('+++')
            const isSingleDel = line.startsWith('-') && !line.startsWith('---')
            const nextIsSingleAdd = next.startsWith('+') && !next.startsWith('+++')
            const nextIsSingleDel = next.startsWith('-') && !next.startsWith('---')
            const pairable = (isSingleDel && nextIsSingleAdd) || (isSingleAdd && nextIsSingleDel)

            if (pairable) {
                const otherContent = next.slice(1)
                const addText = type === '-' ? otherContent : content
                const delText = type === '-' ? content : otherContent

                if (!intraEnabled || !areSimilarForIntra(delText, addText)) {
                    out.push(
                        <div key={`d-${i}`} className="diff-line del">
                            <span className="diff-sign">-</span>
                            {delText || '\u00A0'}
                        </div>
                    )
                    out.push(
                        <div key={`a-${i + 1}`} className="diff-line add">
                            <span className="diff-sign">+</span>
                            {addText || '\u00A0'}
                        </div>
                    )
                    i++
                    continue
                }

                const { a, b } = intralineSegments(delText, addText)
                out.push(
                    <div key={`d-${i}`} className="diff-line del">
                        <span className="diff-sign">-</span>
                        {renderSegs(a, 'del-ch')}
                    </div>
                )
                out.push(
                    <div key={`a-${i + 1}`} className="diff-line add">
                        <span className="diff-sign">+</span>
                        {renderSegs(b, 'add-ch')}
                    </div>
                )
                i++
                continue
            }

            const cls = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx'

            out.push(
                <div key={i} className={`diff-line ${cls}`}>
                    {line || ' '}
                </div>
            )
        }

        return out
    }

    const renderSideBySideDiff = () => {
        if (sideBySideRows.length === 0) {
            return <div className="muted">No diff text was provided for this test in {diffMode}.</div>
        }

        return (
            <div className="diff-content side-by-side">
                <div className="diff-side-by-side-shell" role="region" aria-label="Side-by-side testcase diff">
                    <div className="diff-side-pane actual">
                        <div
                            className="sbs-pane-scroll"
                            ref={sideBySideLeftRef}
                            onScroll={() => syncSideBySideScroll('left')}
                        >
                            <div className="sbs-pane-content" ref={sideBySideLeftContentRef}>
                                {sideBySideRows.map((row) => (
                                    <div key={`left-${row.key}`} className={`diff-line sbs-cell ${row.leftKind}`}>
                                        {renderSideBySideCell(row.leftText, row.leftKind, row.leftSegs)}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="diff-side-pane expected">
                        <div
                            className="sbs-pane-scroll"
                            ref={sideBySideRightRef}
                            onScroll={() => syncSideBySideScroll('right')}
                        >
                            <div className="sbs-pane-content" ref={sideBySideRightContentRef}>
                                {sideBySideRows.map((row) => (
                                    <div key={`right-${row.key}`} className={`diff-line sbs-cell ${row.rightKind}`}>
                                        {renderSideBySideCell(row.rightText, row.rightKind, row.rightSegs)}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>

                <div
                    className="diff-side-by-side-bar"
                    ref={sideBySideBarRef}
                    onScroll={() => syncSideBySideScroll('bar')}
                    aria-label="Shared horizontal scrollbar for side-by-side diff"
                >
                    <div className="diff-side-by-side-bar-inner" />
                </div>
            </div>
        )
    }

    const renderDiffViewSection = () => (
            <section
                className={`diff-view ${disableCopy ? 'no-user-select' : ''}`}
                {...copyBlockHandlers}
                ref={diffViewRef}
            >
                <aside className="diff-sidebar">
                    <ul className="diff-file-list">
                        {!testsLoaded && <li className="muted">Loading…</li>}
                        {testsLoaded && diffFilesAll.length === 0 && <li className="muted">No tests.</li>}
                        {[...diffFilesAll].sort((a, b) => a.num - b.num).map((f) => (
                            <li
                                key={f.id}
                                className={
                                    'file-item ' +
                                    (f.id === selectedDiffId ? 'selected ' : '') +
                                    (f.passed ? 'passed' : 'failed')
                                }
                                onClick={() => setSelectedDiffId(f.id)}
                                title={`Testcase ${f.num}: ${f.test}`}
                            >
                                <div className="testcase-name">
                                    <span className="tc-num">{f.num}.</span> {f.test}
                                </div>
                                <div className="testcase-sub">
                                    <span className={'status-dot ' + (f.passed ? 'is-pass' : 'is-fail')} />
                                    {f.status}
                                </div>
                            </li>
                        ))}
                    </ul>
                </aside>

                <div className="diff-pane">
                    <div className="diff-toolbar">
                        <div className="diff-title">
                            {selectedFile ? `Testcase ${selectedFile.num}: ${selectedFile.test}` : 'No selection'}
                        </div>

                        <div className="spacer" />

                        {(showLayoutToggle || showDiffModeToggle) && (
                            <div className="diff-toolbar-mode-group">
                                {showLayoutToggle && (
                                    <button
                                        type="button"
                                        className={`btn toggle-mode view-toggle ${diffLayout === 'side-by-side' ? 'on' : 'off'}`}
                                        aria-pressed={diffLayout === 'side-by-side'}
                                        onClick={() => {
                                            const next: DiffLayout = diffLayout === 'stacked' ? 'side-by-side' : 'stacked'
                                            logUiClick(
                                                'Diff Layout',
                                                diffLayout === 'side-by-side',
                                                diffLayoutStateLabel(diffLayout),
                                                diffLayoutStateLabel(next)
                                            )
                                            setDiffLayout(next)
                                        }}
                                        title="Switch between stacked and split diff views"
                                    >
                                        <span className="toggle-copy">
                                            <span className="toggle-label">View</span>
                                            <span className="toggle-value">
                                                {diffLayout === 'side-by-side' ? 'Split' : 'Stacked'}
                                            </span>
                                        </span>
                                        <span className="toggle-icon" aria-hidden="true">
                                            {diffLayout === 'side-by-side' ? <FaColumns /> : <FaBars />}
                                        </span>
                                    </button>
                                )}

                                {/* Button 1: shortDiff vs longDiff */}
                                {showDiffModeToggle && (
                                    <button
                                        type="button"
                                        className={`btn toggle-mode scope-toggle ${diffMode === 'long' ? 'on' : 'off'}`}
                                        aria-pressed={diffMode === 'long'}
                                        onClick={() => {
                                            const next: DiffMode = diffMode === 'short' ? 'long' : 'short'

                                            logUiClick(
                                                'Diff Mode',
                                                diffMode === 'long',
                                                diffModeStateLabel(diffMode),
                                                diffModeStateLabel(next)
                                            )

                                            setDiffMode(next)
                                        }}
                                        title="Switch between changed lines only and all diff lines"
                                    >
                                        <span className="toggle-copy">
                                            <span className="toggle-label">Lines</span>
                                            <span className="toggle-value">
                                                {diffMode === 'short' ? 'Differences' : 'All'}
                                            </span>
                                        </span>
                                        <span className="toggle-icon" aria-hidden="true">
                                            {diffMode === 'short' ? <FaGripLines /> : <FaAlignJustify />}
                                        </span>
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Button 2: Diff Finder */}
                        {selectedFile && !selectedFile.passed && (!selectedFile.hidden || revealHiddenOutput) && hasIntraInSelected && (
                            <button
                                type="button"
                                className={`btn toggle-intra ${intraEnabled ? 'on' : 'off'}`}
                                aria-pressed={intraEnabled}
                                disabled={!hasIntraInSelected}
                                onClick={() => {
                                    const next = !intraEnabled

                                    logUiClick(
                                        'Diff Finder',
                                        intraEnabled,
                                        intraEnabled ? 'On' : 'Off',
                                        next ? 'On' : 'Off'
                                    )

                                    setIntraEnabled(next)
                                }}
                                title={
                                    hasIntraInSelected
                                        ? 'Toggle intra-line highlighting'
                                        : 'Intra-line highlighting is not available for this diff'
                                }
                            >
                                <span className="toggle-copy">
                                    <span className="toggle-label">Diff Finder</span>
                                    <span className="toggle-value">{intraEnabled ? 'On' : 'Off'}</span>
                                </span>
                                <span className="toggle-icon" aria-hidden="true">
                                    <FaSearch />
                                </span>
                            </button>
                        )}
                    </div>

                    <div className={`diff-code ${diffLayout === 'side-by-side' ? 'side-by-side-mode' : ''}`}>
                        {!selectedFile && <div className="muted">Select a test on the left to view its diff.</div>}

                        {selectedFile && selectedFile.hidden && (
                            <div className="diff-content">
                                <div className="diff-empty hidden" role="status" aria-live="polite">
                                    <div className="empty-icon" aria-hidden="true">
                                        <FaLock />
                                    </div>
                                    <div className="empty-text">
                                        <div className="empty-title">Output hidden</div>
                                        <div className="empty-subtitle">
                                            This testcase’s output is hidden. Result: {selectedFile.passed ? 'Passed' : 'Failed'}.
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {selectedFile && (!selectedFile.hidden || revealHiddenOutput) && selectedFile.passed && (

                            <div className="diff-content">
                                <div className="diff-empty" role="status" aria-live="polite">
                                    <div className="empty-icon" aria-hidden="true">
                                        <FaRegCheckSquare />
                                    </div>
                                    <div className="empty-text">
                                        <div className="empty-title">No differences found</div>
                                        <div className="empty-subtitle">Your program’s output matches the expected output.</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {selectedFile && (!selectedFile.hidden || revealHiddenOutput) && !selectedFile.passed && (
                            diffLayout === 'side-by-side' ? renderSideBySideDiff() : <div className="diff-content">{renderStackedDiff()}</div>
                        )}
                    </div>
                </div>
            </section>
    )

    const renderCodeSection = () => (
            <Highlight theme={themes.vsLight} code={codeText} language={language as any}>
                {({ style, tokens, getLineProps, getTokenProps }) => (
                    <div
                        className={`code-block code-viewer ${isLineClickable ? 'line-clickable' : ''}`}
                        ref={effectiveCodeContainerRef}
                        onMouseLeave={onLineMouseUp ? () => onLineMouseUp() : undefined}
                        role="region"
                        aria-label="Submitted source code"
                    >
                        <ol className="code-list" style={style}>
                            {tokens.map((line, i) => {
                                const lineNo = i + 1
                                const { key: lineKey, ...lineProps } = getLineProps({ line, key: i })
                                const extraCls = getLineClassName ? getLineClassName(lineNo) : ''
                                return (
                                    <li
                                        key={lineKey ?? lineNo}
                                        ref={(el) => {
                                            if (lineRefs) lineRefs.current[lineNo] = el
                                        }}
                                        {...lineProps}
                                        className={`code-line ${extraCls} ${lineProps.className ?? ''}`}
                                        onMouseDown={onLineMouseDown ? () => onLineMouseDown(lineNo) : undefined}
                                        onMouseEnter={onLineMouseEnter ? () => onLineMouseEnter(lineNo) : undefined}
                                        onMouseLeave={onLineMouseLeave ? () => onLineMouseLeave(lineNo) : undefined}
                                        onMouseUp={onLineMouseUp ? () => onLineMouseUp() : undefined}
                                        title={
                                            onLineMouseDown ? 'Click this line to add or view grading errors' : undefined
                                        }
                                    >
                                        <span className="gutter">
                                            <span className="line-number">{lineNo}</span>
                                        </span>
                                        <span className="code-text">
                                            {line.map((token, key) => {
                                                const { key: tokenKey, ...tokenProps } = getTokenProps({ token, key })
                                                return <span key={tokenKey ?? key} {...tokenProps} />
                                            })}
                                        </span>
                                    </li>
                                )
                            })}
                        </ol>
                    </div>
                )}
            </Highlight>
    )

    return (
        <>
            {rightPanel ? (
                <div className="diff-code-panel">
                    <div className="diff-and-code">
                        {renderDiffViewSection()}

                        {betweenDiffAndCode}

                        {/* ==================== CODE SECTION (BOTTOM) ==================== */}
                        <section className="code-section">
                            <h2 className="section-title">{codeSectionTitle}</h2>
                            {codeFiles.length === 0 && <div className="no-data-message">Fetching submitted code…</div>}

                            {codeFiles.length > 0 && (
                                <>
                                    {codeFiles.length > 1 && (
                                        <div className="code-file-picker">
                                            <label className="section-label" htmlFor="codefile-select">
                                                File Selection
                                            </label>
                                            <div className="select-wrap">
                                                <select
                                                    id="codefile-select"
                                                    className="select"
                                                    value={selectedCodeFile}
                                                    onChange={(e) => setSelectedCodeFile(e.target.value)}
                                                >
                                                    {codeFiles.map((f) => (
                                                        <option key={f.name} value={f.name}>
                                                            {f.name}
                                                        </option>
                                                    ))}
                                                </select>
                                                <FaChevronDown className="select-icon" aria-hidden="true" />
                                            </div>
                                        </div>
                                    )}

                                    {renderCodeSection()}
                                </>
                            )}
                        </section>
                        {belowCode}
                    </div>

                    {rightPanel}
                </div>
            ) : (
                <>
                    {renderDiffViewSection()}

                    {betweenDiffAndCode}

                    {/* ==================== CODE SECTION (BOTTOM) ==================== */}
                    <section className="code-section">
                        <h2 className="section-title">{codeSectionTitle}</h2>
                        {codeFiles.length === 0 && <div className="no-data-message">Fetching submitted code…</div>}

                        {codeFiles.length > 0 && (
                            <>
                                {codeFiles.length > 1 && (
                                    <div className="code-file-picker">
                                        <label className="section-label" htmlFor="codefile-select">
                                            File Selection
                                        </label>
                                        <div className="select-wrap">
                                            <select
                                                id="codefile-select"
                                                className="select"
                                                value={selectedCodeFile}
                                                onChange={(e) => setSelectedCodeFile(e.target.value)}
                                            >
                                                {codeFiles.map((f) => (
                                                    <option key={f.name} value={f.name}>
                                                        {f.name}
                                                    </option>
                                                ))}
                                            </select>
                                            <FaChevronDown className="select-icon" aria-hidden="true" />
                                        </div>
                                    </div>
                                )}

                                {renderCodeSection()}
                            </>
                        )}
                    </section>
                    {belowCode}
                </>
            )}
        </>
    )
}
