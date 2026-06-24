import React, { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import { Highlight, Prism, themes } from 'prism-react-renderer'
import { FaChevronDown } from 'react-icons/fa'
import { FiArrowRight, FiBookOpen, FiCheckCircle } from 'react-icons/fi'
import MenuComponent from '../components/MenuComponent'
import '../../styling/CodeDiffView.scss'
import '../../styling/Mini.scss'

let prismLangsLoaded = false
let prismLangsPromise: Promise<void> | null = null

function ensurePrismLangsLoaded() {
    if (prismLangsLoaded) return Promise.resolve()
    if (prismLangsPromise) return prismLangsPromise

    ;(globalThis as any).Prism = (globalThis as any).Prism ?? Prism
    prismLangsPromise = Promise.all([
        import('prismjs/components/prism-java'),
        import('prismjs/components/prism-python'),
    ]).then(() => {
        prismLangsLoaded = true
    })

    return prismLangsPromise
}

type MaterialFile = {
    name: string
    kind: string
    extension: string
    sizeBytes: number
}

type SolutionFile = MaterialFile & {
    language: string
    content: string
}

type TextFile = MaterialFile & {
    content: string
}

type Assignment = {
    id: number
    name: string
    language: string
    submissionCount: number
    instructionFiles: string[]
    solutionFiles: string[]
    textFiles: string[]
}

type AssignmentMaterialsPayload = {
    assignment: Assignment
    pdfFiles: MaterialFile[]
    solutionFiles: SolutionFile[]
    textFiles: TextFile[]
}

type ProlificSession = {
    success: boolean
    token: string
    assignmentId: number
    assignmentName: string
    firstTaskId: number | null
    taskCount: number
    completedTaskCount: number
    status: string
}

function ProgressBar({ currentStep }: { currentStep: number }) {
    const steps = ['Prolific ID', 'Materials', 'Rubric', 'Line-level', 'AI-assisted', 'Survey']
    const pct = Math.max(0, Math.min(100, ((currentStep - 1) / (steps.length - 1)) * 100))

    return (
        <section className="prolific-progress" aria-label="Study progress">
            <div className="prolific-progress__meta">
                <span>Progress</span>
                <span>Step {currentStep} of {steps.length}</span>
            </div>
            <div className="prolific-progress__track" aria-hidden="true">
                <div className="prolific-progress__fill" style={{ width: `${pct}%` }} />
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

function languageForHighlight(language: string, filename: string) {
    const lowerName = filename.toLowerCase()
    const lowerLang = language.toLowerCase()
    if (lowerLang === 'java' || lowerName.endsWith('.java')) return 'java'
    if (lowerLang === 'python' || lowerName.endsWith('.py')) return 'python'
    return 'text'
}

function formatBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) return ''
    if (bytes < 1024) return `${bytes} B`
    const kb = bytes / 1024
    if (kb < 1024) return `${kb.toFixed(1)} KB`
    return `${(kb / 1024).toFixed(1)} MB`
}

function CodePreview({ file }: { file: SolutionFile }) {
    const [, forcePrismRefresh] = useState(0)

    useEffect(() => {
        ensurePrismLangsLoaded().then(() => forcePrismRefresh((v) => v + 1))
    }, [])

    const language = languageForHighlight(file.language, file.name)

    return (
        <Highlight theme={themes.vsLight} code={file.content ?? ''} language={language as any}>
            {({ style, tokens, getLineProps, getTokenProps }) => (
                <div className="code-block code-viewer" role="region" aria-label="Reference solution file">
                    <ol className="code-list" style={style}>
                        {tokens.map((line, i) => {
                            const lineNo = i + 1
                            const { key: lineKey, ...lineProps } = getLineProps({ line, key: i })
                            return (
                                <li key={lineKey ?? lineNo} {...lineProps} className={`code-line ${lineProps.className ?? ''}`}>
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
}

export default function ProlificMaterials() {
    const { session_token = '' } = useParams<{ session_token: string }>()
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const returnTaskId = Number.parseInt(searchParams.get('returnTask') ?? '', 10)
    const hasReturnTask = Number.isFinite(returnTaskId)
    const [session, setSession] = useState<ProlificSession | null>(null)
    const [materials, setMaterials] = useState<AssignmentMaterialsPayload | null>(null)
    const [loading, setLoading] = useState(true)
    const [savingTime, setSavingTime] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [selectedPdfName, setSelectedPdfName] = useState('')
    const [selectedSolutionName, setSelectedSolutionName] = useState('')

    useEffect(() => {
        if (!session_token) return
        setLoading(true)
        axios
            .get(`${import.meta.env.VITE_API_URL}/mini/prolific/session/${session_token}`)
            .then((sessionRes) => {
                const nextSession = sessionRes.data as ProlificSession
                setSession(nextSession)
                return Promise.all([
                    Promise.resolve(nextSession),
                    axios.get(`${import.meta.env.VITE_API_URL}/mini/assignments/${nextSession.assignmentId}/materials`),
                ])
            })
            .then(([nextSession, materialsRes]) => {
                const payload: AssignmentMaterialsPayload = {
                    assignment: materialsRes.data?.assignment,
                    pdfFiles: Array.isArray(materialsRes.data?.pdfFiles) ? materialsRes.data.pdfFiles : [],
                    solutionFiles: Array.isArray(materialsRes.data?.solutionFiles) ? materialsRes.data.solutionFiles : [],
                    textFiles: Array.isArray(materialsRes.data?.textFiles) ? materialsRes.data.textFiles : [],
                }

                setMaterials(payload)
                setSelectedPdfName(payload.pdfFiles[0]?.name ?? '')
                setSelectedSolutionName(payload.solutionFiles[0]?.name ?? '')
                setError(null)

                return axios.post(`${import.meta.env.VITE_API_URL}/mini/prolific/session/${nextSession.token}/materials-time`, { event: 'start', fromTaskId: hasReturnTask ? returnTaskId : undefined })
            })
            .catch((err) => {
                console.error(err)
                setError(err?.response?.data?.error || 'Could not load assignment materials.')
            })
            .finally(() => setLoading(false))
    }, [session_token, hasReturnTask, returnTaskId])

    const selectedPdf = useMemo(() => {
        return materials?.pdfFiles.find((file) => file.name === selectedPdfName) ?? materials?.pdfFiles[0] ?? null
    }, [materials, selectedPdfName])

    const selectedSolution = useMemo(() => {
        return materials?.solutionFiles.find((file) => file.name === selectedSolutionName) ?? materials?.solutionFiles[0] ?? null
    }, [materials, selectedSolutionName])

    const pdfSrc = selectedPdf && materials
        ? `${import.meta.env.VITE_API_URL}/mini/assignments/${materials.assignment.id}/materials/file?kind=instruction&name=${encodeURIComponent(selectedPdf.name)}`
        : ''

    const startGrading = () => {
        if (!session) return
        setSavingTime(true)
        axios
            .post(`${import.meta.env.VITE_API_URL}/mini/prolific/session/${session.token}/materials-time`, { event: 'end' })
            .catch((err) => console.error('Could not save material review time:', err))
            .finally(() => {
                setSavingTime(false)
                const nextTaskId = hasReturnTask ? returnTaskId : session.firstTaskId
                if (nextTaskId) {
                    navigate(`/mini/prolific/${session.token}/tasks/${nextTaskId}`)
                } else {
                    navigate(`/mini/prolific/${session.token}/survey`)
                }
            })
    }

    return (
        <div className="page-container mini-shell prolific-shell">
            <Helmet><title>MAAT-Mini Materials</title></Helmet>
            <MenuComponent />
            <ProgressBar currentStep={2} />

            <main className="mini-page prolific-page assignment-materials-page">
                {loading && <div className="mini-card">Loading assignment materials.</div>}
                {error && <div className="mini-alert" role="alert">{error}</div>}

                {!loading && !error && materials && session && (
                    <>
                        <section className="mini-card assignment-materials-summary" aria-label="Assignment material summary">
                            <div>
                                <div className="mini-card__eyebrow">Assigned Python assignment</div>
                                <h1>{materials.assignment.name}</h1>
                                <div className="mini-card__meta">
                                    <span>{materials.assignment.language}</span>
                                    <span>{materials.pdfFiles.length} instruction PDF{materials.pdfFiles.length === 1 ? '' : 's'}</span>
                                    <span>{materials.solutionFiles.length} reference solution file{materials.solutionFiles.length === 1 ? '' : 's'}</span>
                                    <span>{session.taskCount} grading task{session.taskCount === 1 ? '' : 's'}</span>
                                </div>
                            </div>
                            <button className="mini-button mini-button--primary" type="button" onClick={startGrading} disabled={savingTime}>
                                {savingTime ? 'Starting...' : hasReturnTask ? 'Return to grading' : 'Start grading'}
                                {!savingTime && <FiArrowRight aria-hidden="true" />}
                            </button>
                        </section>

                        <section className="mini-card prolific-instructions-card">
                            <h2><FiBookOpen aria-hidden="true" /> What you will do</h2>
                            <ul>
                                <li>Grade seven programs with the standard rubric, then seven with a line-level rubric, then seven with a line-level rubric including AI suggestions.</li>
                                <li>You can return to these materials while grading.</li>
                                <li>Finish the survey to receive the completion code.</li>
                            </ul>
                        </section>

                        <div className="prolific-materials-grid">
                            <section className="mini-card material-section" aria-label="Instruction documents">
                                <div className="material-section__header">
                                    <div>
                                        <h2>Instructions</h2>
                                    </div>
                                    {materials.pdfFiles.length > 1 && (
                                        <div className="select-wrap material-select-wrap">
                                            <select className="select" value={selectedPdfName} onChange={(e) => setSelectedPdfName(e.target.value)} aria-label="Select instruction PDF">
                                                {materials.pdfFiles.map((file, idx) => (
                                                    <option key={file.name} value={file.name}>Instruction PDF {idx + 1}{formatBytes(file.sizeBytes) ? ` (${formatBytes(file.sizeBytes)})` : ''}</option>
                                                ))}
                                            </select>
                                            <FaChevronDown className="select-icon" aria-hidden="true" />
                                        </div>
                                    )}
                                </div>

                                {selectedPdf && pdfSrc && (
                                    <iframe className="materials-pdf" title="Assignment instructions" src={pdfSrc} />
                                )}
                                {!selectedPdf && <div className="no-data-message">No PDF instructions were found for this assignment.</div>}
                            </section>

                            <section className="code-section prolific-code-section" aria-label="Reference solution files">
                                <h2 className="section-title">Reference solution</h2>

                                {materials.solutionFiles.length > 1 && (
                                    <div className="code-file-picker">
                                        <label className="section-label" htmlFor="reference-solution-select">
                                            File Selection
                                        </label>
                                        <div className="select-wrap">
                                            <select
                                                id="reference-solution-select"
                                                className="select"
                                                value={selectedSolutionName}
                                                onChange={(e) => setSelectedSolutionName(e.target.value)}
                                                aria-label="Select solution file"
                                            >
                                                {materials.solutionFiles.map((file) => (
                                                    <option key={file.name} value={file.name}>
                                                        {file.name}
                                                    </option>
                                                ))}
                                            </select>
                                            <FaChevronDown className="select-icon" aria-hidden="true" />
                                        </div>
                                    </div>
                                )}

                                {selectedSolution && <CodePreview file={selectedSolution} />}
                                {!selectedSolution && <div className="no-data-message">No reference solution file was found.</div>}
                            </section>
                        </div>

                        {materials.textFiles.length > 0 && (
                            <section className="mini-card material-section" aria-label="Additional text materials">
                                <div className="material-section__header">
                                    <div>
                                        <div className="mini-card__eyebrow">Additional materials</div>
                                        <h2>Text files</h2>
                                    </div>
                                </div>
                                {materials.textFiles.map((file, idx) => (
                                    <details key={file.name} className="text-material">
                                        <summary>Text material {idx + 1}</summary>
                                        <pre>{file.content}</pre>
                                    </details>
                                ))}
                            </section>
                        )}

                        <section className="mini-card prolific-ready-card">
                            <div>
                                <h2><FiCheckCircle aria-hidden="true" /> Ready to grade?</h2>
                            </div>
                            <button className="mini-button mini-button--primary" type="button" onClick={startGrading} disabled={savingTime}>
                                {savingTime ? 'Starting...' : hasReturnTask ? 'Return to grading' : 'Start grading'}
                                {!savingTime && <FiArrowRight aria-hidden="true" />}
                            </button>
                        </section>
                    </>
                )}
            </main>
        </div>
    )
}