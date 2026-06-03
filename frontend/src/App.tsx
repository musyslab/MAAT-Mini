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
        <Route path="/" element={<Navigate to="/admin/schools" replace />} />
        <Route path="/admin/schools" element={<ProtectedRoute><AssignmentSelect /></ProtectedRoute>} />
        <Route path="/admin/school/:school_id/classes" element={<ProtectedRoute><AssignmentSelect /></ProtectedRoute>} />
        <Route path="/admin/school/:school_id/class/:class_id/menu" element={<ProtectedRoute><AssignmentSelect /></ProtectedRoute>} />
        <Route path="/admin/school/:school_id/class/:class_id/modules" element={<ProtectedRoute><AssignmentSelect /></ProtectedRoute>} />
        <Route path="/admin/school/:school_id/class/:class_id/module/:module_id/overview" element={<ProtectedRoute><AssignmentSelect /></ProtectedRoute>} />
        <Route path="/admin/school/:school_id/class/:class_id/module/:module_id/project/:project_id/submissions" element={<ProtectedRoute><AdminStudentList /></ProtectedRoute>} />
        <Route path="/admin/school/:school_id/class/:class_id/module/:module_id/project/:project_id/grade/:id" element={<ProtectedRoute><AdminGrading /></ProtectedRoute>} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}
