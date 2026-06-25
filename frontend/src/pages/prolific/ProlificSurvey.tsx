import React, { FormEvent, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { useNavigate, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import { FiCheckCircle, FiExternalLink } from 'react-icons/fi'
import MenuComponent from '../components/MenuComponent'
import ProgressBar, { getProlificProgressPercent } from '../components/ProgressBar'
import '../../styling/ProlificSurvey.scss'

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

type SurveyOption = {
  value: string
  label: string
  description?: string
}

type SurveyQuestion = {
  id: string
  label: string
  helper?: string
  options: SurveyOption[]
  required?: boolean
}

type SurveySection = {
  title: string
  description: string
  questions: SurveyQuestion[]
}

const LIKERT_CONFIDENCE: SurveyOption[] = [
  { value: '1', label: '1 - Not confident' },
  { value: '2', label: '2 - Slightly confident' },
  { value: '3', label: '3 - Moderately confident' },
  { value: '4', label: '4 - Confident' },
  { value: '5', label: '5 - Very confident' },
]

const LIKERT_DIFFICULTY: SurveyOption[] = [
  { value: '1', label: '1 - Very easy' },
  { value: '2', label: '2 - Easy' },
  { value: '3', label: '3 - Moderate' },
  { value: '4', label: '4 - Difficult' },
  { value: '5', label: '5 - Very difficult' },
]

const LIKERT_AGREEMENT: SurveyOption[] = [
  { value: '1', label: '1 - Strongly disagree' },
  { value: '2', label: '2 - Disagree' },
  { value: '3', label: '3 - Neutral' },
  { value: '4', label: '4 - Agree' },
  { value: '5', label: '5 - Strongly agree' },
]

const LIKERT_USEFULNESS: SurveyOption[] = [
  { value: '1', label: '1 - Not useful' },
  { value: '2', label: '2 - Slightly useful' },
  { value: '3', label: '3 - Moderately useful' },
  { value: '4', label: '4 - Useful' },
  { value: '5', label: '5 - Very useful' },
  { value: 'not_seen', label: 'I did not notice them' },
]

const LIKERT_WORKLOAD: SurveyOption[] = [
  { value: '1', label: '1 - Very low' },
  { value: '2', label: '2 - Low' },
  { value: '3', label: '3 - Moderate' },
  { value: '4', label: '4 - High' },
  { value: '5', label: '5 - Very high' },
]

const MODE_OPTIONS: SurveyOption[] = [
  {
    value: 'rubric',
    label: 'Standard rubric grading',
    description: 'Whole-program grading with rubric categories.',
  },
  {
    value: 'line_no_ai',
    label: 'Line-level grading without AI',
    description: 'Selecting exact code lines and assigning categories yourself.',
  },
  {
    value: 'line_ai',
    label: 'Line-level grading with AI suggestions',
    description: 'Selecting exact code lines with AI-suggested categories available.',
  },
  {
    value: 'no_preference',
    label: 'No preference',
  },
]

const SURVEY_SECTIONS: SurveySection[] = [
  {
    title: 'Overall grading experience',
    description: 'These questions ask about the study as a whole across all grading stages.',
    questions: [
      {
        id: 'overallConfidence',
        label: 'Overall, how confident were you in the grades you assigned?',
        options: LIKERT_CONFIDENCE,
      },
      {
        id: 'overallDifficulty',
        label: 'Overall, how difficult was it to grade the submissions?',
        options: LIKERT_DIFFICULTY,
      },
      {
        id: 'overallFairness',
        label: 'Overall, the grading interface let me assign fair grades.',
        options: LIKERT_AGREEMENT,
      },
      {
        id: 'mentalDemand',
        label: 'How mentally demanding was the grading work?',
        options: LIKERT_WORKLOAD,
      },
      {
        id: 'timePressure',
        label: 'How much time pressure did you feel while grading?',
        options: LIKERT_WORKLOAD,
      },
    ],
  },
  {
    title: 'Standard rubric grading',
    description: 'Think only about the stage where you graded the whole program using rubric categories.',
    questions: [
      {
        id: 'rubricClarity',
        label: 'The rubric categories were clear enough to apply consistently.',
        options: LIKERT_AGREEMENT,
      },
      {
        id: 'rubricConfidence',
        label: 'How confident were you in your standard-rubric grades?',
        options: LIKERT_CONFIDENCE,
      },
      {
        id: 'rubricEase',
        label: 'How difficult was it to decide which rubric categories applied?',
        options: LIKERT_DIFFICULTY,
      },
      {
        id: 'rubricCoverage',
        label: 'The rubric categories covered the kinds of mistakes I saw.',
        options: LIKERT_AGREEMENT,
      },
    ],
  },
  {
    title: 'Line-level grading without AI',
    description: 'Think only about the stage where you selected code lines and assigned error categories without AI help.',
    questions: [
      {
        id: 'lineSelectionEase',
        label: 'Selecting the exact line or line range was easy.',
        options: LIKERT_AGREEMENT,
      },
      {
        id: 'lineConfidence',
        label: 'How confident were you in your line-level grades without AI?',
        options: LIKERT_CONFIDENCE,
      },
      {
        id: 'lineGranularityHelped',
        label: 'Line-level grading helped me explain deductions more precisely than whole-program rubric grading.',
        options: LIKERT_AGREEMENT,
      },
      {
        id: 'lineDifficulty',
        label: 'How difficult was it to connect output differences to specific code lines?',
        options: LIKERT_DIFFICULTY,
      },
    ],
  },
  {
    title: 'AI-assisted line-level grading',
    description: 'Think only about the stage where AI suggestions could appear after selecting code lines.',
    questions: [
      {
        id: 'aiUsefulness',
        label: 'How useful were the AI suggestions when they appeared?',
        options: LIKERT_USEFULNESS,
      },
      {
        id: 'aiTrust',
        label: 'I trusted the AI suggestions enough to consider them in my decision.',
        options: LIKERT_AGREEMENT,
      },
      {
        id: 'aiAccuracy',
        label: 'The AI suggestions were usually relevant to the selected code and failing tests.',
        options: LIKERT_AGREEMENT,
      },
      {
        id: 'aiInfluence',
        label: 'The AI suggestions changed at least some of my grading decisions.',
        options: LIKERT_AGREEMENT,
      },
      {
        id: 'aiConfidence',
        label: 'How confident were you in your AI-assisted line-level grades?',
        options: LIKERT_CONFIDENCE,
      },
    ],
  },
  {
    title: 'Materials and interface',
    description: 'These questions focus on the instructions, assignment materials, output diff, and code navigation.',
    questions: [
      {
        id: 'materialsClarity',
        label: 'The assignment materials were clear enough to understand what the student program should do.',
        options: LIKERT_AGREEMENT,
      },
      {
        id: 'testOutputClarity',
        label: 'The student-vs-correct output comparison made the program behavior clear.',
        options: LIKERT_AGREEMENT,
      },
      {
        id: 'codeNavigationEase',
        label: 'The interface made it easy to move between test cases, output, code, and the grading panel.',
        options: LIKERT_AGREEMENT,
      },
      {
        id: 'tutorialHelpfulness',
        label: 'The tutorials helped me understand what to do in each grading stage.',
        options: LIKERT_AGREEMENT,
      },
    ],
  },
  {
    title: 'Comparisons between grading formats',
    description: 'Compare the three grading formats based on your experience.',
    questions: [
      {
        id: 'preferredMode',
        label: 'Which grading format did you prefer overall?',
        options: MODE_OPTIONS,
      },
      {
        id: 'mostReliableMode',
        label: 'Which grading format felt most reliable for assigning accurate grades?',
        options: MODE_OPTIONS,
      },
      {
        id: 'leastReliableMode',
        label: 'Which grading format felt least reliable?',
        options: MODE_OPTIONS,
      },
      {
        id: 'attentionCheck',
        label: 'Attention check: please select "Line-level grading without AI".',
        options: MODE_OPTIONS,
      },
    ],
  },
]

const REQUIRED_QUESTION_IDS = SURVEY_SECTIONS.flatMap((section) =>
  section.questions
    .filter((question) => question.required !== false)
    .map((question) => question.id),
)

export default function ProlificSurvey() {
  const { session_token = '' } = useParams<{ session_token: string }>()
  const navigate = useNavigate()
  const [session, setSession] = useState<ProlificSession | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [responses, setResponses] = useState<Record<string, string>>({})
  const [confusingParts, setConfusingParts] = useState('')
  const [helpfulParts, setHelpfulParts] = useState('')
  const [aiConcerns, setAiConcerns] = useState('')
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

  const answeredRequiredCount = useMemo(() => {
    return REQUIRED_QUESTION_IDS.filter((id) => Boolean(responses[id])).length
  }, [responses])

  const canSubmit = useMemo(() => {
    return answeredRequiredCount === REQUIRED_QUESTION_IDS.length && !submitting
  }, [answeredRequiredCount, submitting])

  const completedUnits = session
    ? 2 + session.completedTaskCount + (submitted ? 1 : 0)
    : 0

  const updateResponse = (questionId: string, value: string) => {
    setResponses((prev) => ({ ...prev, [questionId]: value }))
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!canSubmit || !session) return
    setSubmitting(true)
    setError(null)

    axios
      .post(`${import.meta.env.VITE_API_URL}/mini/prolific/session/${session.token}/survey`, {
        confidence: responses.overallConfidence,
        difficulty: responses.overallDifficulty,
        aiUsefulness: responses.aiUsefulness,
        fairness: responses.overallFairness,
        preferredMode: responses.preferredMode,
        mostReliableMode: responses.mostReliableMode,
        leastReliableMode: responses.leastReliableMode,
        attentionCheck: responses.attentionCheck,
        responses,
        confusingParts,
        helpfulParts,
        aiConcerns,
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

  const renderQuestion = (question: SurveyQuestion) => {
    const selectedValue = responses[question.id] ?? ''

    return (
      <fieldset className="survey-question" key={question.id}>
        <legend>{question.label}</legend>
        {question.helper && <p className="survey-question__helper">{question.helper}</p>}

        <div className={`survey-options ${question.options.length > 5 ? 'survey-options--many' : ''}`}>
          {question.options.map((option) => (
            <label
              className={`survey-option ${selectedValue === option.value ? 'is-selected' : ''}`}
              key={option.value}
            >
              <input
                type="radio"
                name={question.id}
                value={option.value}
                checked={selectedValue === option.value}
                onChange={(e) => updateResponse(question.id, e.target.value)}
                required={question.required !== false}
              />
              <span className="survey-option__label">{option.label}</span>
              {option.description && <span className="survey-option__description">{option.description}</span>}
            </label>
          ))}
        </div>
      </fieldset>
    )
  }

  return (
    <div className="page-container mini-shell prolific-shell">
      <Helmet><title>MAAT-Mini Survey</title></Helmet>
      <MenuComponent />
      <ProgressBar
        currentStep={6}
        progressPercent={session ? getProlificProgressPercent(completedUnits, session.taskCount) : 0}
      />

      <main className="mini-page prolific-page">
        {loading && <div className="mini-card">Loading survey...</div>}
        {error && <div className="mini-alert" role="alert">{error}</div>}

        {!loading && session && !submitted && (
          <form className="mini-card prolific-form prolific-survey" onSubmit={submit}>
            <div className="prolific-form__header">
              <div className="mini-card__eyebrow">Final step</div>
              <h1>Post-study survey</h1>
              <p>
                You completed {session.completedTaskCount} of {session.taskCount} grading tasks. Please answer the survey below to receive your completion code.
              </p>
            </div>

            <div className="survey-progress" aria-label="Survey completion">
              <div>
                <strong>{answeredRequiredCount}</strong> of <strong>{REQUIRED_QUESTION_IDS.length}</strong> required questions answered
              </div>
              <div className="survey-progress__bar" aria-hidden="true">
                <span style={{ width: `${Math.round((answeredRequiredCount / REQUIRED_QUESTION_IDS.length) * 100)}%` }} />
              </div>
            </div>

            {SURVEY_SECTIONS.map((section) => (
              <section className="survey-section" key={section.title}>
                <div className="survey-section__header">
                  <h2>{section.title}</h2>
                  <p>{section.description}</p>
                </div>

                <div className="survey-section__questions">
                  {section.questions.map(renderQuestion)}
                </div>
              </section>
            ))}

            <section className="survey-section">
              <div className="survey-section__header">
                <h2>Open-ended feedback</h2>
                <p>These responses are optional, but they help explain the rating answers above.</p>
              </div>

              <label className="prolific-field">
                <span>What was most confusing or difficult about the study?</span>
                <textarea
                  value={confusingParts}
                  onChange={(e) => setConfusingParts(e.target.value)}
                  rows={4}
                  placeholder="Describe any instructions, UI behavior, grading categories, or program behavior that was hard to understand."
                />
              </label>

              <label className="prolific-field">
                <span>What was most helpful while grading?</span>
                <textarea
                  value={helpfulParts}
                  onChange={(e) => setHelpfulParts(e.target.value)}
                  rows={4}
                  placeholder="Describe any materials, views, tools, or workflow details that helped you grade."
                />
              </label>

              <label className="prolific-field">
                <span>Do you have any concerns about the AI suggestions?</span>
                <textarea
                  value={aiConcerns}
                  onChange={(e) => setAiConcerns(e.target.value)}
                  rows={4}
                  placeholder="For example: confusing suggestions, missing suggestions, over-trust, wrong categories, or anything else."
                />
              </label>

              <label className="prolific-field">
                <span>Additional comments</span>
                <textarea
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  rows={5}
                  placeholder="Share anything else about the grading formats, fairness, workload, or interface."
                />
              </label>
            </section>

            <div className="survey-submit-row">
              <div className="muted small">
                {canSubmit ? 'Ready to submit.' : 'Answer all required questions before submitting.'}
              </div>
              <button className="mini-button mini-button--primary" type="submit" disabled={!canSubmit}>
                {submitting ? 'Submitting...' : 'Submit survey'}
              </button>
            </div>
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