import React, { FormEvent, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useNavigate, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import { FiCheckCircle, FiExternalLink } from 'react-icons/fi'
import MenuComponent from '../components/MenuComponent'
import '../../styling/Mini.scss'

type ProlificSession = {
  success: boolean
  token: string
  assignmentId: number
  assignmentName: string
  taskCount: number
  completedTaskCount: number
  status: string
  completionCode?: string
  completionUrl?: string
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

export default function ProlificSurvey() {
  const { session_token = '' } = useParams<{ session_token: string }>()
  const navigate = useNavigate()
  const [session, setSession] = useState<ProlificSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [confidence, setConfidence] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [aiUsefulness, setAiUsefulness] = useState('')
  const [fairness, setFairness] = useState('')
  const [comments, setComments] = useState('')

  useEffect(() => {
    if (!session_token) return
    setLoading(true)
    axios
      .get(`${import.meta.env.VITE_API_URL}/mini/prolific/session/${session_token}`)
      .then((res) => {
        setSession(res.data as ProlificSession)
        setError(null)
      })
      .catch((err) => {
        console.error(err)
        setError(err?.response?.data?.error || 'Could not load your study session.')
      })
      .finally(() => setLoading(false))
  }, [session_token])

  const canSubmit = useMemo(() => {
    return confidence && difficulty && aiUsefulness && fairness && !submitting
  }, [confidence, difficulty, aiUsefulness, fairness, submitting])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit || !session) return
    setSubmitting(true)
    setError(null)

    axios
      .post(`${import.meta.env.VITE_API_URL}/mini/prolific/session/${session.token}/survey`, {
        confidence,
        difficulty,
        aiUsefulness,
        fairness,
        comments,
      })
      .then((res) => {
        setSession({ ...session, ...(res.data?.session ?? {}) })
        setSubmitted(true)
        localStorage.removeItem('MAAT_MINI_PROLIFIC_TOKEN')
      })
      .catch((err) => {
        console.error(err)
        setError(err?.response?.data?.error || 'Could not save the survey.')
      })
      .finally(() => setSubmitting(false))
  }

  return (
    <div className="page-container mini-shell prolific-shell">
      <Helmet><title>MAAT-Mini Survey</title></Helmet>
      <MenuComponent />
      <ProgressBar currentStep={6} />

      <main className="mini-page prolific-page">
        {loading && <div className="mini-card">Loading survey...</div>}
        {error && <div className="mini-alert" role="alert">{error}</div>}

        {!loading && session && !submitted && (
          <form className="mini-card prolific-form prolific-survey" onSubmit={submit}>
            <div className="prolific-form__header">
              <div className="mini-card__eyebrow">Final step</div>
              <h1>Post-study survey</h1>
              <p>
                You completed {session.completedTaskCount} of {session.taskCount} grading tasks. Submit this short survey to receive your completion code.
              </p>
            </div>

            <label className="prolific-field">
              <span>How confident were you in your grading decisions?</span>
              <select value={confidence} onChange={(e) => setConfidence(e.target.value)} required>
                <option value="">Select one</option>
                <option value="1">1 - Not confident</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5 - Very confident</option>
              </select>
            </label>

            <label className="prolific-field">
              <span>How difficult was the grading task?</span>
              <select value={difficulty} onChange={(e) => setDifficulty(e.target.value)} required>
                <option value="">Select one</option>
                <option value="1">1 - Very easy</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5 - Very difficult</option>
              </select>
            </label>

            <label className="prolific-field">
              <span>How useful were the AI suggestions when they appeared?</span>
              <select value={aiUsefulness} onChange={(e) => setAiUsefulness(e.target.value)} required>
                <option value="">Select one</option>
                <option value="1">1 - Not useful</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5 - Very useful</option>
                <option value="not_seen">I did not notice them</option>
              </select>
            </label>

            <label className="prolific-field">
              <span>How fair did the three grading formats feel?</span>
              <select value={fairness} onChange={(e) => setFairness(e.target.value)} required>
                <option value="">Select one</option>
                <option value="1">1 - Not fair</option>
                <option value="2">2</option>
                <option value="3">3</option>
                <option value="4">4</option>
                <option value="5">5 - Very fair</option>
              </select>
            </label>

            <label className="prolific-field">
              <span>Optional comments</span>
              <textarea value={comments} onChange={(e) => setComments(e.target.value)} rows={5} placeholder="Share anything confusing, helpful, or frustrating." />
            </label>

            <button className="mini-button mini-button--primary" type="submit" disabled={!canSubmit}>
              {submitting ? 'Submitting...' : 'Submit survey'}
            </button>
          </form>
        )}

        {!loading && session && submitted && (
          <section className="mini-card prolific-complete-card">
            <FiCheckCircle className="prolific-complete-card__icon" aria-hidden="true" />
            <div>
              <div className="mini-card__eyebrow">Complete</div>
              <h1>Thank you for completing the study</h1>
              <p>Use this completion code in Prolific:</p>
              <div className="completion-code" aria-label="Prolific completion code">{session.completionCode || 'COMPLETED'}</div>
              {session.completionUrl && (
                <a className="mini-button mini-button--primary" href={session.completionUrl} target="_blank" rel="noreferrer">
                  Open Prolific completion page
                  <FiExternalLink aria-hidden="true" />
                </a>
              )}
            </div>
          </section>
        )}

        {!loading && !session && !error && (
          <section className="mini-card">
            <h1>Session not found</h1>
            <p>Return to the beginning and re-enter your Prolific information.</p>
            <button className="mini-button" type="button" onClick={() => navigate('/mini/prolific')}>Start over</button>
          </section>
        )}
      </main>
    </div>
  )
}
