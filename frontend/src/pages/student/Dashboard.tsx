import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api, type ExamCard } from '../../api/client';
import {
  FileText,
  Clock,
  Calendar,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  BookOpen,
  RefreshCw,
  UploadCloud
} from 'lucide-react';

export const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [exams, setExams] = useState<ExamCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'AVAILABLE' | 'UPCOMING' | 'COMPLETED'>('ALL');
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
  const [enteringExamId, setEnteringExamId] = useState<number | null>(null);

  // Requests fullscreen and only navigates into the exam room if it actually
  // succeeds, so the student never lands mid-exam in a broken non-fullscreen
  // state. Must run synchronously inside the click handler (no awaits before
  // the request) so the browser still treats it as a user gesture.
  // File Upload exams aren't proctored (no violation tracking), so they skip
  // the fullscreen requirement entirely and just navigate straight in.
  const handleEnterExam = async (examId: number, examType: ExamCard['exam_type']) => {
    setFullscreenError(null);

    if (examType === 'FILE_UPLOAD') {
      navigate(`/exams/${examId}`);
      return;
    }

    setEnteringExamId(examId);
    try {
      const el = document.documentElement as HTMLElement & {
        webkitRequestFullscreen?: () => Promise<void>;
        msRequestFullscreen?: () => Promise<void>;
      };
      if (el.requestFullscreen) {
        await el.requestFullscreen();
      } else if (el.webkitRequestFullscreen) {
        await el.webkitRequestFullscreen();
      } else if (el.msRequestFullscreen) {
        await el.msRequestFullscreen();
      } else {
        throw new Error('Fullscreen is not supported in this browser.');
      }
      navigate(`/exams/${examId}`);
    } catch (err) {
      setFullscreenError(
        'Fullscreen permission is required to start the examination. Please allow fullscreen access in your browser and try again.'
      );
    } finally {
      setEnteringExamId(null);
    }
  };

  const fetchExams = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getStudentExams();
      setExams(data.exams);
    } catch (err: any) {
      setError(err.message || 'Failed to load examinations.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExams();
  }, []);

  const filteredExams = exams.filter((exam) => {
    if (filter === 'ALL') return true;
    if (filter === 'AVAILABLE') return exam.status === 'AVAILABLE' || exam.status === 'IN_PROGRESS';
    if (filter === 'UPCOMING') return exam.status === 'UPCOMING';
    if (filter === 'COMPLETED') return exam.status === 'COMPLETED';
    return true;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'AVAILABLE':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
            Available Now
          </span>
        );
      case 'IN_PROGRESS':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 animate-pulse">
            In Progress
          </span>
        );
      case 'UPCOMING':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
            Upcoming
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
            Completed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800">
            {status}
          </span>
        );
    }
  };

  const formatDateTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Student Profile Banner */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl font-bold text-slate-900">{user?.full_name}</h1>
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-sky-100 text-sky-800 border border-sky-200">
                {user?.department?.code}
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-1">
              Roll Number: <span className="font-mono font-medium text-slate-700">{user?.roll_number}</span> | Department: <span className="font-medium text-slate-700">{user?.department?.name}</span>
            </p>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={fetchExams}
              className="inline-flex items-center px-3 py-2 border border-slate-300 rounded-lg text-sm font-medium text-slate-700 bg-white hover:bg-slate-50 shadow-sm transition"
            >
              <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center space-x-2 mb-6 border-b border-slate-200 pb-3">
          {(['ALL', 'AVAILABLE', 'UPCOMING', 'COMPLETED'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                filter === tab
                  ? 'bg-sky-700 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-200/60'
              }`}
            >
              {tab === 'ALL'
                ? `All Exams (${exams.length})`
                : tab === 'AVAILABLE'
                ? `Available (${exams.filter((e) => e.status === 'AVAILABLE' || e.status === 'IN_PROGRESS').length})`
                : tab === 'UPCOMING'
                ? `Upcoming (${exams.filter((e) => e.status === 'UPCOMING').length})`
                : `Completed (${exams.filter((e) => e.status === 'COMPLETED').length})`}
            </button>
          ))}
        </div>

        {/* Error Notification */}
        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 flex items-start space-x-3 text-red-700">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0 text-red-500" />
            <div className="text-sm">{error}</div>
          </div>
        )}

        {fullscreenError && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 flex items-start space-x-3 text-red-700">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0 text-red-500" />
            <div className="text-sm">{fullscreenError}</div>
          </div>
        )}

        {/* Exams Grid */}
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-3">
            <div className="w-10 h-10 border-4 border-sky-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm font-medium text-slate-500">Loading department exams...</p>
          </div>
        ) : filteredExams.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
            <BookOpen className="h-12 w-12 text-slate-400 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-slate-900">No examinations found</h3>
            <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
              There are no examinations in this category assigned to your department ({user?.department?.name}).
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredExams.map((exam) => (
              <div
                key={exam.id}
                className="bg-white rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition flex flex-col justify-between overflow-hidden"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className="text-lg font-bold text-slate-900 leading-snug line-clamp-2">
                      {exam.title}
                    </h3>
                    {getStatusBadge(exam.status)}
                  </div>

                  {exam.exam_type === 'FILE_UPLOAD' && (
                    <span className="inline-flex items-center mb-2 px-2 py-0.5 rounded text-xs font-semibold bg-purple-100 text-purple-800">
                      <UploadCloud className="h-3 w-3 mr-1" /> File Upload Exam
                    </span>
                  )}

                  <p className="text-sm text-slate-600 line-clamp-2 mb-4">
                    {exam.description || 'No description provided.'}
                  </p>

                  <div className="space-y-2 text-xs text-slate-500 border-t border-slate-100 pt-3">
                    <div className="flex items-center">
                      <Clock className="h-3.5 w-3.5 mr-2 text-slate-400" />
                      <span>Duration: <strong className="text-slate-700">{exam.duration_minutes} minutes</strong></span>
                    </div>
                    <div className="flex items-center">
                      <Calendar className="h-3.5 w-3.5 mr-2 text-slate-400" />
                      <span>Start: <strong className="text-slate-700">{formatDateTime(exam.start_datetime)}</strong></span>
                    </div>
                    <div className="flex items-center">
                      <Calendar className="h-3.5 w-3.5 mr-2 text-slate-400" />
                      <span>End: <strong className="text-slate-700">{formatDateTime(exam.end_datetime)}</strong></span>
                    </div>
                    <div className="flex items-center">
                      <FileText className="h-3.5 w-3.5 mr-2 text-slate-400" />
                      <span>Questions: <strong className="text-slate-700">{exam.question_count}</strong> | Total Marks: <strong className="text-slate-700">{exam.total_marks}</strong></span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-100">
                  {exam.status === 'AVAILABLE' && (
                    <button
                      onClick={() => handleEnterExam(exam.id, exam.exam_type)}
                      disabled={enteringExamId === exam.id}
                      className="w-full flex items-center justify-center py-2.5 px-4 rounded-lg bg-sky-700 hover:bg-sky-800 text-white font-semibold text-sm shadow-sm transition disabled:opacity-60"
                    >
                      {enteringExamId === exam.id ? 'Entering Fullscreen...' : (
                        <>Start Examination <ArrowRight className="h-4 w-4 ml-1.5" /></>
                      )}
                    </button>
                  )}

                  {exam.status === 'IN_PROGRESS' && (
                    <button
                      onClick={() => handleEnterExam(exam.id, exam.exam_type)}
                      disabled={enteringExamId === exam.id}
                      className="w-full flex items-center justify-center py-2.5 px-4 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold text-sm shadow-sm transition disabled:opacity-60"
                    >
                      {enteringExamId === exam.id ? 'Entering Fullscreen...' : (
                        <>Resume Examination <ArrowRight className="h-4 w-4 ml-1.5" /></>
                      )}
                    </button>
                  )}

                  {exam.status === 'UPCOMING' && (
                    <button
                      disabled
                      className="w-full py-2.5 px-4 rounded-lg bg-slate-200 text-slate-500 font-medium text-sm cursor-not-allowed"
                    >
                      Exam Has Not Started
                    </button>
                  )}

                  {exam.status === 'COMPLETED' && (
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-slate-600 flex items-center">
                        <CheckCircle className="h-4 w-4 text-emerald-600 mr-1.5" />
                        {exam.has_attempted ? `Score: ${exam.score}/${exam.max_score} (${exam.percentage}%)` : 'Window Closed'}
                      </span>
                      <button
                        onClick={() => navigate('/results')}
                        className="text-xs font-semibold text-sky-700 hover:text-sky-800 underline"
                      >
                        View Results
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
