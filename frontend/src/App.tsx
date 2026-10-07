import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { Navbar } from './components/Navbar';
import { ProtectedRoute } from './components/ProtectedRoute';

// Student Pages
import { Login } from './pages/Login';
import { Dashboard } from './pages/student/Dashboard';
import { ExamRoom } from './pages/student/ExamRoom';
import { Results } from './pages/student/Results';

// Admin Pages
import { AdminLogin } from './pages/admin/AdminLogin';
import { AdminDashboard } from './pages/admin/AdminDashboard';
import { Students } from './pages/admin/Students';
import { Questions } from './pages/admin/Questions';
import { Exams } from './pages/admin/Exams';
import { AdminResults } from './pages/admin/AdminResults';
import { Grading } from './pages/admin/Grading';

const RootRedirect: React.FC = () => {
  const { isAuthenticated, role, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-4 border-sky-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Navigate to={role === 'ADMIN' ? '/admin/dashboard' : '/dashboard'} replace />;
};

export const App: React.FC = () => {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="min-h-screen flex flex-col bg-slate-50">
          <Routes>
            {/* Exam Room has its own focused top header without standard nav */}
            <Route path="/exams/:examId" element={
              <React.Fragment>
                <ProtectedRoute requiredRole="STUDENT" />
                <ExamRoom />
              </React.Fragment>
            } />

            {/* General Routes with Navbar */}
            <Route
              path="*"
              element={
                <div className="flex flex-col min-h-screen">
                  <Navbar />
                  <main className="flex-1">
                    <Routes>
                      {/* Root redirect */}
                      <Route path="/" element={<RootRedirect />} />

                      {/* Public Auth Routes */}
                      <Route path="/login" element={<Login />} />
                      <Route path="/admin/login" element={<AdminLogin />} />

                      {/* Protected Student Routes */}
                      <Route element={<ProtectedRoute requiredRole="STUDENT" />}>
                        <Route path="/dashboard" element={<Dashboard />} />
                        <Route path="/results" element={<Results />} />
                      </Route>

                      {/* Protected Admin Routes */}
                      <Route element={<ProtectedRoute requiredRole="ADMIN" />}>
                        <Route path="/admin/dashboard" element={<AdminDashboard />} />
                        <Route path="/admin/students" element={<Students />} />
                        <Route path="/admin/questions" element={<Questions />} />
                        <Route path="/admin/exams" element={<Exams />} />
                        <Route path="/admin/results" element={<AdminResults />} />
                        <Route path="/admin/grading/:attemptId" element={<Grading />} />
                      </Route>

                      {/* Fallback */}
                      <Route path="*" element={<Navigate to="/" replace />} />
                    </Routes>
                  </main>
                </div>
              }
            />
          </Routes>
        </div>
      </BrowserRouter>
    </AuthProvider>
  );
};

export default App;
