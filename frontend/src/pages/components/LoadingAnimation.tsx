import React from 'react'
import '../../styling/LoadingAnimation.scss'

interface LoadingAnimationProps {
  show: boolean
  message?: string
}

export default function LoadingAnimation({ show, message = 'Loading...' }: LoadingAnimationProps) {
  if (!show) return null

  return (
    <div className="mini-loading-overlay" role="status" aria-live="polite">
      <div className="mini-loading-card">
        <div className="mini-loading-spinner" aria-hidden="true" />
        <div>{message}</div>
      </div>
    </div>
  )
}