import React, { type ReactNode } from 'react'
import '../../styling/ProgressBar.scss'

export const PROLIFIC_PROGRESS_STEPS = ['Prolific ID', 'Materials', 'Rubric', 'Line-level', 'AI-assisted', 'Survey']

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, value))
}

export function getProlificProgressPercent(
  currentStep: number,
  _progressWithinStep = 0,
  stepCount = PROLIFIC_PROGRESS_STEPS.length,
) {
  const safeStepCount = Math.max(1, stepCount)
  const safeStep = clamp(Math.round(currentStep), 1, safeStepCount)

  return ((safeStep - 0.5) / safeStepCount) * 100
}

type ProgressBarProps = {
  currentStep: number
  detail?: ReactNode

  /**
   * Kept so existing callers still compile.
   * It is intentionally ignored because the Prolific bar should stay centered
   * on the active PROLIFIC_PROGRESS_STEPS item until that stage is over.
   */
  progressWithinStep?: number

  steps?: string[]
}

export default function ProgressBar({
  currentStep,
  detail,
  progressWithinStep = 0,
  steps = PROLIFIC_PROGRESS_STEPS,
}: ProgressBarProps) {
  const stepCount = Math.max(1, steps.length)
  const safeStep = clamp(Math.round(currentStep), 1, stepCount)
  const pct = getProlificProgressPercent(safeStep, progressWithinStep, stepCount)

  return (
    <section className="prolific-progress" aria-label="Study progress">
      <div className="prolific-progress__meta">
        <span>Progress</span>
        <span>{detail ?? `Step ${safeStep} of ${stepCount}`}</span>
      </div>

      <div
        className="prolific-progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
      >
        <div className="prolific-progress__fill" style={{ width: `${pct}%` }} />
      </div>

      <ol
        className="prolific-progress__steps"
        style={{ gridTemplateColumns: `repeat(${stepCount}, minmax(0, 1fr))` }}
      >
        {steps.map((step, idx) => {
          const stepNo = idx + 1

          return (
            <li
              key={step}
              className={[
                stepNo < safeStep ? 'is-complete' : '',
                stepNo === safeStep ? 'is-current' : '',
              ].filter(Boolean).join(' ')}
            >
              {step}
            </li>
          )
        })}
      </ol>
    </section>
  )
}