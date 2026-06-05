import React from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import axios from 'axios'

import AssignmentSelect from './pages/admin/AssignmentSelect'
import AdminStudentList from './pages/admin/AdminStudentList'
import AdminGrading from './pages/admin/AdminGrading'
import NotFound from './pages/public/NotFound'
import ProtectedRoute from './pages/components/ProtectedRoute'

const configureAxiosInterceptors = () => {
  axios.interceptors.response.use(
    (successRes) => successRes,
    (error) => Promise.reject(error),
  )
}

configureAxiosInterceptors()

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/mini/assignments" replace />} />
        <Route path="/mini" element={<Navigate to="/mini/assignments" replace />} />
        <Route path="/mini/assignments" element={<ProtectedRoute><AssignmentSelect /></ProtectedRoute>} />
        <Route path="/mini/assignments/:project_id/submissions" element={<ProtectedRoute><AdminStudentList /></ProtectedRoute>} />
        <Route path="/mini/assignments/:project_id/submissions/:id/grade" element={<ProtectedRoute><AdminGrading /></ProtectedRoute>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}
