import React, { useEffect, useState } from 'react'
import axios from 'axios'
import { Link } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import DirectoryBreadcrumbs from '../components/DirectoryBreadcrumbs'

type Assignment = {
  id: number
  name: string
  language: string
  path: string
  submissionCount: number
  correctSolutionPath: string
  incorrectSolutionsPath: string
  instructionFiles: string[]
}

export default function AssignmentSelect() {
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    axios.get(`${import.meta.env.VITE_API_URL}/mini/assignments`)
      .then((res) => {
        setAssignments(Array.isArray(res.data?.assignments) ? res.data.assignments : [])
        setError(null)
      })
      .catch((err) => {
        console.error(err)
        setError('Could not load assignments from tabot-files/incorrect-programs/.')
      })
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="page-container mini-shell">
      <Helmet><title>MAAT-Mini</title></Helmet>
      <MenuComponent showUpload={false} showAdminUpload={false} showHelp={false} showCreate={false} showLast={false} showReviewButton={false} />
      <DirectoryBreadcrumbs items={[{ label: 'Assignment Selection' }]} />
      <div className="pageTitle">MAAT-Mini: Select Assignment</div>

      <main className="mini-page">
        <p className="mini-muted">
          Assignments are scanned from <code>tabot-files/incorrect-programs/</code>. Each folder should contain a <code>correct solution</code> folder and an <code>incorrect solutions</code> folder.
        </p>

        {loading && <div className="mini-card">Loading assignments...</div>}
        {error && <div className="mini-alert">{error}</div>}
        {!loading && !error && assignments.length === 0 && (
          <div className="mini-card">
            No assignments were found. Add folders under <code>tabot-files/incorrect-programs/</code> and refresh.
          </div>
        )}

        <div className="mini-grid">
          {assignments.map((assignment) => (
            <Link
              key={assignment.id}
              className="mini-card mini-card--link"
              to={`/admin/school/1/class/1/module/1/project/${assignment.id}/submissions`}
            >
              <div className="mini-card__eyebrow">Assignment {assignment.id}</div>
              <h2>{assignment.name}</h2>
              <div className="mini-card__meta">
                <span>{assignment.language}</span>
                <span>{assignment.submissionCount} submissions</span>
              </div>
              <div className="mini-card__path">{assignment.path}</div>
              {assignment.instructionFiles.length > 0 && (
                <div className="mini-card__small">Instructions: {assignment.instructionFiles.join(', ')}</div>
              )}
            </Link>
          ))}
        </div>
      </main>
    </div>
  )
}
