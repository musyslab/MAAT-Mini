import React from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import axios from 'axios'

import ProlificEntry from './pages/prolific/ProlificEntry'
import ProlificMaterials from './pages/prolific/ProlificMaterials'
import ProlificSurvey from './pages/prolific/ProlificSurvey'
import ProlificGradingTask from './pages/prolific/ProlificGradingTask'
import NotFound from './pages/public/NotFound'

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
        <Route path="/" element={<Navigate to="/mini/prolific" replace />} />
        <Route path="/mini" element={<Navigate to="/mini/prolific" replace />} />
        <Route path="/mini/assignments" element={<Navigate to="/mini/prolific" replace />} />
        <Route path="/mini/prolific" element={<ProlificEntry />} />
        <Route path="/mini/prolific/:session_token/materials" element={<ProlificMaterials />} />
        <Route path="/mini/prolific/:session_token/tasks/:task_id" element={<ProlificGradingTask />} />
        <Route path="/mini/prolific/:session_token/survey" element={<ProlificSurvey />} />
        <Route path="/mini/assignments/:project_id/materials" element={<Navigate to="/mini/prolific" replace />} />
        <Route path="/mini/assignments/:project_id/submissions" element={<Navigate to="/mini/prolific" replace />} />
        <Route path="/mini/assignments/:project_id/submissions/:id/grade" element={<Navigate to="/mini/prolific" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}
