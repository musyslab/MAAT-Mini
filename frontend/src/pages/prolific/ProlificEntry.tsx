import React, { FormEvent, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import { FiArrowRight, FiClipboard, FiShield } from 'react-icons/fi'
import MenuComponent from '../components/MenuComponent'
import '../../styling/Mini.scss'

type ProlificSessionResponse = {
  success: boolean
  token: string
  assignmentId: number
  assignmentName: string
  firstTaskId?: number | null
  taskCount: number
  completionCode?: string
  error?: string
}

function ProgressBar({ currentStep }: { currentStep: number }) {
  const steps = ['Prolific ID', 'Materials', 'Grading', 'Survey']
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
        {steps.map((step, idx) => (
          <li key={step} className={idx + 1 <= currentStep ? 'is-complete' : ''}>{step}</li>
        ))}
      </ol>
    </section>
  )
}

export default function ProlificEntry() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [prolificPid, setProlificPid] = useState(searchParams.get('PROLIFIC_PID') ?? '')
  const [studyId, setStudyId] = useState(searchParams.get('STUDY_ID') ?? '')
  const [sessionId, setSessionId] = useState(searchParams.get('SESSION_ID') ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resumeToken, setResumeToken] = useState<string | null>(null)

  useEffect(() => {
    setResumeToken(localStorage.getItem('MAAT_MINI_PROLIFIC_TOKEN'))
  }, [])

  const isReady = useMemo(() => {
    return prolificPid.trim().length > 0 && studyId.trim().length > 0 && sessionId.trim().length > 0
  }, [prolificPid, studyId, sessionId])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!isReady || loading) return

    setLoading(true)
    setError(null)

    axios
      .post(`${import.meta.env.VITE_API_URL}/mini/prolific/session`, {
        prolificPid: prolificPid.trim(),
        studyId: studyId.trim(),
        sessionId: sessionId.trim(),
      })
      .then((res) => {
        const payload = res.data as ProlificSessionResponse
        if (!payload?.success || !payload.token) {
          setError(payload?.error || 'Could not start the Prolific study.')
          return
        }
        localStorage.setItem('MAAT_MINI_PROLIFIC_TOKEN', payload.token)
        navigate(`/mini/prolific/${payload.token}/materials`)
      })
      .catch((err) => {
        console.error(err)
        setError(err?.response?.data?.error || 'Could not start the Prolific study.')
      })
      .finally(() => setLoading(false))
  }

  return (
    <div className="page-container mini-shell prolific-shell">
      <Helmet><title>MAAT-Mini Prolific Study</title></Helmet>
      <MenuComponent />
      <ProgressBar currentStep={1} />

      <main className="mini-page prolific-page">
        <section className="prolific-hero">
          <div className="prolific-hero__copy">
            <div className="mini-card__eyebrow">MAAT-Mini Prolific study</div>
            <h1>Code grading study</h1>
            <p>
              Enter the Prolific information supplied with your study link. You will be assigned to one of three Python assignments,
              review the materials, grade anonymized programs in three formats, and complete a short survey.
            </p>
          </div>
          <div className="prolific-hero__facts" aria-label="Study requirements">
            <div><FiClipboard aria-hidden="true" /> Use your Prolific PID, Study ID, and Session ID.</div>
            <div><FiShield aria-hidden="true" /> You will receive a completion code after the survey.</div>
          </div>
        </section>

        {resumeToken && (
          <section className="mini-card prolific-resume-card">
            <div>
              <h2>Resume existing study session</h2>
              <p>You have a saved session on this browser.</p>
            </div>
            <button className="mini-button" type="button" onClick={() => navigate(`/mini/prolific/${resumeToken}/materials`)}>
              Resume
              <FiArrowRight aria-hidden="true" />
            </button>
          </section>
        )}

        <form className="mini-card prolific-form" onSubmit={submit}>
          <div className="prolific-form__header">
            <h2>Prolific credentials</h2>
            <p>These values are normally included in your Prolific study URL and are required for compensation tracking.</p>
          </div>

          <label className="prolific-field">
            <span>PROLIFIC_PID</span>
            <input
              value={prolificPid}
              onChange={(e) => setProlificPid(e.target.value)}
              placeholder="Example: 5f0000000000000000000000"
              autoComplete="off"
              required
            />
          </label>

          <label className="prolific-field">
            <span>STUDY_ID</span>
            <input
              value={studyId}
              onChange={(e) => setStudyId(e.target.value)}
              placeholder="Study ID from Prolific"
              autoComplete="off"
              required
            />
          </label>

          <label className="prolific-field">
            <span>SESSION_ID</span>
            <input
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              placeholder="Session ID from Prolific"
              autoComplete="off"
              required
            />
          </label>

          {error && <div className="mini-alert" role="alert">{error}</div>}

          <button className="mini-button mini-button--primary" type="submit" disabled={!isReady || loading}>
            {loading ? 'Starting...' : 'Start study'}
            {!loading && <FiArrowRight aria-hidden="true" />}
          </button>
        </form>
      </main>
    </div>
  )
}
