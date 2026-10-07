import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api, type GradingPayload, type FilePreview } from '../../api/client';
import {
  PenLine,
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  Clock3,
  Paperclip,
  Download,
  Eye,
  EyeOff,
  User,
  Building2
} from 'lucide-react';

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const Grading: React.FC = () => {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();

  const [payload, setPayload] = useState<GradingPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  // Draft scores/feedback keyed by question_id
  const [scores, setScores] = useState<Record<number, string>>({});
  const [feedbacks, setFeedbacks] = useState<Record<number, string>>({});

  // Inline file previews keyed by file_id
  const [previews, setPreviews] = useState<Record<number, FilePreview | 'loading' | undefined>>({});

  const fetchGrading = useCallback(async () => {
    if (!attemptId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getAdminGrading(parseInt(attemptId, 10));
      setPayload(data);
      const s: Record<number, string> = {};
      const f: Record<number, string> = {};
      data.tasks.forEach((t) => {
        s[t.question_id] = t.manual_score !== null ? String(t.manual_score) : '';
        f[t.question_id] = t.feedback || '';
      });
      setScores(s);
      setFeedbacks(f);
    } catch (err: any) {
      setError(err.message || 'Failed to load submission for grading.');
    } finally {
      setLoading(false);
    }
  }, [attemptId]);

  useEffect(() => {
    fetchGrading();
  }, [fetchGrading]);

  const togglePreview = async (fileId: number) => {
    const current = previews[fileId];
    if (current && current !== 'loading') {
      setPreviews((prev) => ({ ...prev, [fileId]: undefined }));
      return;
    }
    setPreviews((prev) => ({ ...prev, [fileId]: 'loading' }));
    try {
      const data = await api.getAdminFilePreview(fileId);
      setPreviews((prev) => ({ ...prev, [fileId]: data }));
    } catch (err: any) {
      setPreviews((prev) => ({
        ...prev,
        [fileId]: { previewable: false, filename: '' },
      }));
    }
  };

  const handleDownload = async (fileId: number, filename: string) => {
    try {
      await api.downloadAdminFile(fileId, filename);
    } catch (err: any) {
      setError(err.message || 'Failed to download file.');
    }
  };

  const handleSave = async () => {
    if (!payload) return;
    setSaving(true);
    setError(null);
    setSaveMessage(null);
    try {
      const grades = payload.tasks
        .filter((t) => scores[t.question_id] !== '' && scores[t.question_id] !== undefined)
        .map((t) => ({
          question_id: t.question_id,
          score: parseFloat(scores[t.question_id]),
          feedback: feedbacks[t.question_id] || '',
        }));
      const updated = await api.saveAdminGrading(parseInt(attemptId!, 10), grades);
      setPayload(updated);
      setSaveMessage(updated.is_graded ? 'All tasks graded and saved.' : 'Progress saved.');
    } catch (err: any) {
      setError(err.message || 'Failed to save grades.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-amber-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (error && !payload) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white max-w-md w-full p-8 rounded-xl shadow-lg border border-slate-200 text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Unable to Load Submission</h2>
          <p className="text-sm text-slate-600 mb-6">{error}</p>
          <button
            onClick={() => navigate('/admin/results')}
            className="w-full inline-flex justify-center items-center py-2.5 px-4 rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 transition"
          >
            <ArrowLeft className="h-4 w-4 mr-2" /> Back to Results
          </button>
        </div>
      </div>
    );
  }

  if (!payload) return null;

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={() => navigate('/admin/results')}
            className="inline-flex items-center px-3 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 bg-white hover:bg-slate-50 transition"
          >
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Results
          </button>
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${
              payload.is_graded ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
            }`}
          >
            {payload.is_graded ? (
              <><CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Fully Graded</>
            ) : (
              <><Clock3 className="h-3.5 w-3.5 mr-1.5" /> Pending Review</>
            )}
          </span>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <h1 className="text-xl font-bold text-slate-900 flex items-center">
            <PenLine className="h-5 w-5 mr-2 text-amber-600" /> {payload.exam_title}
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-slate-600">
            <span className="flex items-center">
              <User className="h-4 w-4 mr-1.5 text-slate-400" />
              <span className="font-mono font-bold text-slate-800 mr-1">{payload.roll_number}</span>
              ({payload.student_name})
            </span>
            <span className="flex items-center">
              <Building2 className="h-4 w-4 mr-1.5 text-slate-400" /> {payload.department_name}
            </span>
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center space-x-6 text-sm">
            <span className="text-slate-500">
              Total: <strong className="text-slate-900">{payload.score} / {payload.max_score}</strong>
            </span>
            <span className="text-slate-500">
              Percentage: <strong className="text-sky-700">{payload.percentage}%</strong>
            </span>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 flex items-start space-x-3 text-red-700">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0 text-red-500" />
            <div className="text-sm font-medium">{error}</div>
          </div>
        )}

        {saveMessage && (
          <div className="mb-6 p-4 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start space-x-3 text-emerald-700">
            <CheckCircle2 className="h-5 w-5 mt-0.5 flex-shrink-0 text-emerald-500" />
            <div className="text-sm font-medium">{saveMessage}</div>
          </div>
        )}

        <div className="space-y-6">
          {payload.tasks.map((task, idx) => (
            <div key={task.question_id} className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-2.5 py-1 rounded-md">
                    Task {idx + 1}
                  </span>
                  <span className="ml-2 text-xs text-slate-500 font-medium">
                    Max Marks: <strong className="text-slate-800">{task.marks}</strong>
                  </span>
                </div>
                {task.graded && (
                  <span className="inline-flex items-center text-xs font-semibold text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Graded
                  </span>
                )}
              </div>

              <p className="text-base font-medium text-slate-900 mb-2">{task.question_text}</p>

              {task.instructions && (
                <div className="text-xs p-3 rounded-lg bg-purple-50 border border-purple-100 text-purple-900 mb-4">
                  <span className="font-semibold">Grading instructions: </span>
                  {task.instructions}
                </div>
              )}

              {task.files.length === 0 ? (
                <div className="text-sm text-slate-400 italic mb-4">No files were submitted for this task.</div>
              ) : (
                <div className="space-y-2 mb-4">
                  {task.files.map((f) => {
                    const preview = previews[f.id];
                    return (
                      <div key={f.id} className="border border-slate-200 rounded-lg overflow-hidden">
                        <div className="flex items-center justify-between p-3 bg-slate-50 text-sm">
                          <div className="flex items-center space-x-2 min-w-0">
                            <Paperclip className="h-4 w-4 text-slate-400 flex-shrink-0" />
                            <span className="font-medium text-slate-800 truncate">{f.filename}</span>
                            <span className="text-xs text-slate-400 flex-shrink-0">({formatFileSize(f.size)})</span>
                          </div>
                          <div className="flex items-center space-x-1 flex-shrink-0 ml-3">
                            <button
                              type="button"
                              onClick={() => togglePreview(f.id)}
                              title="Preview"
                              className="p-1.5 rounded-md text-slate-500 hover:bg-slate-200 transition"
                            >
                              {preview && preview !== 'loading' ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDownload(f.id, f.filename)}
                              title="Download"
                              className="p-1.5 rounded-md text-slate-500 hover:bg-slate-200 transition"
                            >
                              <Download className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                        {preview === 'loading' && (
                          <div className="p-4 text-xs text-slate-400 italic">Loading preview...</div>
                        )}
                        {preview && preview !== 'loading' && (
                          preview.previewable ? (
                            <div>
                              <pre className="p-4 text-xs text-slate-800 bg-slate-900/95 text-slate-100 overflow-x-auto max-h-80 overflow-y-auto whitespace-pre-wrap break-words">
                                {preview.content}
                              </pre>
                              {preview.truncated && (
                                <div className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-t border-amber-100">
                                  Preview truncated - download the file to see the full content.
                                </div>
                              )}
                            </div>
                          ) : (
                            <div className="p-3 text-xs text-slate-500 italic">
                              This file type can't be previewed inline. Use download to review it.
                            </div>
                          )
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                    Score (0 - {task.marks})
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={task.marks}
                    step="0.5"
                    value={scores[task.question_id] ?? ''}
                    onChange={(e) =>
                      setScores((prev) => ({ ...prev, [task.question_id]: e.target.value }))
                    }
                    placeholder="Not graded"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                    Feedback (optional)
                  </label>
                  <input
                    type="text"
                    value={feedbacks[task.question_id] ?? ''}
                    onChange={(e) =>
                      setFeedbacks((prev) => ({ ...prev, [task.question_id]: e.target.value }))
                    }
                    placeholder="Feedback shown to the student..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-6 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center px-6 py-3 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm shadow-md transition disabled:opacity-60"
          >
            {saving ? 'Saving...' : 'Save Grades'}
          </button>
        </div>
      </div>
    </div>
  );
};
