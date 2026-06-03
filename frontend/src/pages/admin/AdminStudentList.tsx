import React, { useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { Link, useParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import MenuComponent from '../components/MenuComponent'
import DirectoryBreadcrumbs from '../components/DirectoryBreadcrumbs'

type Submission = {
  submissionId: number
  projectId: number
  userId: number
  userKey: string
  firstName: string
  lastName: string
  fullName: string
  folderName: string
  submittedAt: string
  isPassing: boolean
  codeFileCount: number
  hasTestcasesJson: boolean
  hasTestCaseResults: boolean
  path: string
}

type Assignment = {
  id: number
  name: string
  language: string
}

export default function AdminStudentList() {
  const { school_id = '1', class_id = '1', module_id = '1', project_id = '' } = useParams()
  const [assignment, setAssignment] = useState<Assignment | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const pid = parseInt(project_id, 10)

  useEffect(() => {
    if (!Number.isFinite(pid)) return
    setLoading(true)
    Promise.all([
      axios.get(`${import.meta.env.VITE_API_URL}/mini/assignments/${pid}`),
      axios.get(`${import.meta.env.VITE_API_URL}/mini/assignments/${pid}/submissions`),
    ])
      .then(([assignmentRes, submissionsRes]) => {
        setAssignment(assignmentRes.data)
        setSubmissions(Array.isArray(submissionsRes.data?.submissions) ? submissionsRes.data.submissions : [])
        setError(null)
      })
      .catch((err) => {
        console.error(err)
        setError('Could not load submissions for this assignment.')
      })
      .finally(() => setLoading(false))
  }, [pid])

  const sorted = useMemo(() => {
    return [...submissions].sort((a, b) => {
      const byLast = (a.lastName || '').localeCompare(b.lastName || '', undefined, { sensitivity: 'base' })
      if (byLast !== 0) return byLast
      const byFirst = (a.firstName || '').localeCompare(b.firstName || '', undefined, { sensitivity: 'base' })
      if (byFirst !== 0) return byFirst
      return a.submissionId - b.submissionId
    })
  }, [submissions])

  const baseUrl = `/admin/school/${school_id}/class/${class_id}/module/${module_id}/project/${project_id}`

  return (
    <div className="page-container mini-shell">
      <Helmet><title>MAAT-Mini</title></Helmet>
      <MenuComponent showUpload={false} showAdminUpload={false} showHelp={false} showCreate={false} showLast={false} showReviewButton={false} />
      <DirectoryBreadcrumbs
        items={[
          { label: 'Assignment Selection', to: '/admin/schools' },
          { label: assignment?.name || 'Submissions' },
        ]}
      />
      <div className="pageTitle">Submissions: {assignment?.name || `Assignment ${project_id}`}</div>

      <main className="mini-page">
        {loading && <div className="mini-card">Loading submissions...</div>}
        {error && <div className="mini-alert">{error}</div>}
        {!loading && !error && sorted.length === 0 && (
          <div className="mini-card">No submissions were found for this assignment.</div>
        )}

        {sorted.length > 0 && (
          <div className="mini-table-wrap">
            <table className="mini-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Folder</th>
                  <th>Tests</th>
                  <th>Code files</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((submission) => (
                  <tr key={submission.submissionId}>
                    <td>{submission.fullName || submission.userKey}</td>
                    <td><code>{submission.folderName}</code></td>
                    <td>
                      <span className={submission.isPassing ? 'mini-pill mini-pill--pass' : 'mini-pill mini-pill--fail'}>
                        {submission.isPassing ? 'Passing' : 'Failing'}
                      </span>
                    </td>
                    <td>{submission.codeFileCount}</td>
                    <td>
                      <Link className="mini-button" to={`${baseUrl}/grade/${submission.submissionId}`}>Grade</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}
