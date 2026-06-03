import React from 'react'
import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <main className="mini-page">
      <h1>Page not found</h1>
      <p>The requested MAAT-Mini page does not exist.</p>
      <Link to="/admin/schools">Return to assignments</Link>
    </main>
  )
}
