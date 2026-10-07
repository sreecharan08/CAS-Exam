import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type ExamResult } from '../../api/client';
import {
  Award,
  CheckCircle,
  AlertCircle,
  ArrowLeft,
  ShieldAlert,
  Calendar,
  Clock3
} from 'lucide-react';

export const Results: React.FC = () => {
  const [results, setResults] = useState<ExamResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const data = await api.getStudentResults();
        setResults(data);
      } catch (err: any) {
        setError(err.message || 'Failed to load examination results.');
      } finally {
        setLoading(false);
      }
    };
    fetchResults();
  }, []);

  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return 'N/A';
    return new Date(dateStr).toLocaleString('en-US', {
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
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">My Examination Results</h1>
            <p className="text-sm text-slate-500 mt-1">
              Official scores and completion status for attended examinations
            </p>
          </div>
          <button
            onClick={() => navigate('/dashboard')}
            className="inline-flex items-center px-4 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 transition"
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Dashboard
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 flex items-start space-x-3 text-red-700">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0 text-red-500" />
            <div className="text-sm">{error}</div>
          </div>
        )}

        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-3">
            <div className="w-10 h-10 border-4 border-sky-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm font-medium text-slate-500">Loading your performance records...</p>
          </div>
        ) : results.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center">
            <Award className="h-12 w-12 text-slate-400 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-slate-900">No examination results available</h3>
            <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">
              You haven't submitted any examinations yet. Check your dashboard for available assessments.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {results.map((res) => (
              <div
                key={res.id}
                className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col justify-between"
              >
                <div className="p-6">
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className="text-lg font-bold text-slate-900 leading-snug line-clamp-2">
                      {res.exam_title}
                    </h3>
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                        res.status === 'SUBMITTED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {res.status === 'SUBMITTED' ? 'Submitted' : 'Auto-Submitted'}
                    </span>
                  </div>

                  {/* Score Highlight Card */}
                  {res.exam_type === 'FILE_UPLOAD' && !res.is_graded ? (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 my-4 flex items-center space-x-3">
                      <Clock3 className="h-6 w-6 text-amber-600 flex-shrink-0" />
                      <div>
                        <div className="text-sm font-bold text-amber-800">Pending Review</div>
                        <div className="text-xs text-amber-700">Your submission is awaiting manual grading.</div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 my-4 flex items-center justify-between">
                      <div>
                        <div className="text-xs text-slate-500 font-semibold uppercase">Total Score</div>
                        <div className="text-2xl font-black text-slate-900">
                          {res.score} <span className="text-sm font-normal text-slate-500">/ {res.max_score}</span>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-slate-500 font-semibold uppercase">Percentage</div>
                        <div className="text-2xl font-black text-sky-700">
                          {res.percentage}%
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Submission details */}
                  <div className="space-y-2 text-xs text-slate-600 border-t border-slate-100 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center text-slate-500">
                        <Calendar className="h-3.5 w-3.5 mr-1.5 text-slate-400" /> Date Submitted:
                      </span>
                      <span className="font-medium text-slate-800">{formatDateTime(res.submitted_at)}</span>
                    </div>

                    <div className="flex items-center justify-between">
                      <span className="flex items-center text-slate-500">
                        <ShieldAlert className="h-3.5 w-3.5 mr-1.5 text-slate-400" /> Violations:
                      </span>
                      <span className={`font-semibold ${res.violation_count > 0 ? 'text-red-600' : 'text-slate-700'}`}>
                        {res.violation_count} recorded
                      </span>
                    </div>

                    {res.submission_reason && res.submission_reason !== 'NORMAL' && (
                      <div className="flex items-center justify-between">
                        <span className="text-slate-500">Reason:</span>
                        <span className="font-semibold text-amber-700">{res.submission_reason}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <span className="flex items-center font-medium">
                    {res.exam_type === 'FILE_UPLOAD' && !res.is_graded ? (
                      <><Clock3 className="h-3.5 w-3.5 mr-1 text-amber-600" /> Awaiting Grading</>
                    ) : (
                      <><CheckCircle className="h-3.5 w-3.5 mr-1 text-emerald-600" /> Verified Server Score</>
                    )}
                  </span>
                  <span className="font-mono text-slate-400">Attempt ID: #{res.id}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
