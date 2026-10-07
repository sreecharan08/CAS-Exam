import React, { useState, useEffect, useCallback } from 'react';
import { api, type Department, type Question } from '../../api/client';
import {
  FileText,
  Plus,
  Edit2,
  Trash2,
  Clock,
  Calendar,
  X,
  AlertCircle,
  ArrowUp,
  ArrowDown
} from 'lucide-react';

interface ExamItem {
  id: number;
  title: string;
  description: string;
  duration_minutes: number;
  questions_per_attempt: number;
  question_pool_size?: number;
  start_datetime: string;
  end_datetime: string;
  is_active: boolean;
  department_ids: number[];
  department_details: Department[];
  question_count: number;
  total_marks: number;
  exam_questions: any[];
}

export const Exams: React.FC = () => {
  const [exams, setExams] = useState<ExamItem[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [availableQuestions, setAvailableQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<ExamItem | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  // Form Fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [questionsPerAttempt, setQuestionsPerAttempt] = useState(30);
  const [startDatetime, setStartDatetime] = useState('');
  const [endDatetime, setEndDatetime] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [selectedDepts, setSelectedDepts] = useState<number[]>([]);
  const [selectedQuestions, setSelectedQuestions] = useState<number[]>([]);

  const fetchExams = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [examsRes, deptsRes, qRes] = await Promise.all([
        api.getAdminExams(),
        api.getDepartments(),
        api.getAdminQuestions(),
      ]);
      setExams(examsRes.results || examsRes);
      setDepartments(deptsRes);
      setAvailableQuestions(qRes.results || qRes);
    } catch (err: any) {
      setError(err.message || 'Failed to load examinations data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchExams();
  }, [fetchExams]);

  const openCreateModal = () => {
    setEditingExam(null);
    setTitle('');
    setDescription('');
    setDurationMinutes(30);
    setQuestionsPerAttempt(30);

    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const toLocalISO = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

    setStartDatetime(toLocalISO(now));
    const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    setEndDatetime(toLocalISO(nextWeek));

    setIsActive(true);
    setSelectedDepts(departments.map((d) => d.id)); // Default to both
    setSelectedQuestions([]);
    setModalError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (exam: ExamItem) => {
    setEditingExam(exam);
    setTitle(exam.title);
    setDescription(exam.description);
    setDurationMinutes(exam.duration_minutes);
    setQuestionsPerAttempt(exam.questions_per_attempt || 30);

    const toLocalISO = (isoStr: string) => {
      const d = new Date(isoStr);
      const pad = (n: number) => n.toString().padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    setStartDatetime(toLocalISO(exam.start_datetime));
    setEndDatetime(toLocalISO(exam.end_datetime));
    setIsActive(exam.is_active);
    setSelectedDepts(exam.department_ids || []);

    const qIds = (exam.exam_questions || []).map((eq: any) => eq.id);
    setSelectedQuestions(qIds);

    setModalError(null);
    setIsModalOpen(true);
  };

  const handleDeptToggle = (deptId: number) => {
    setSelectedDepts((prev) =>
      prev.includes(deptId) ? prev.filter((id) => id !== deptId) : [...prev, deptId]
    );
  };

  const handleQuestionToggle = (qId: number) => {
    setSelectedQuestions((prev) =>
      prev.includes(qId) ? prev.filter((id) => id !== qId) : [...prev, qId]
    );
  };

  const moveQuestion = (idx: number, direction: 'UP' | 'DOWN') => {
    const newArr = [...selectedQuestions];
    const targetIdx = direction === 'UP' ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= newArr.length) return;
    const temp = newArr[idx];
    newArr[idx] = newArr[targetIdx];
    newArr[targetIdx] = temp;
    setSelectedQuestions(newArr);
  };

  const handleSaveExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    if (!title.trim()) {
      setModalError('Exam title is required.');
      return;
    }

    if (selectedDepts.length === 0) {
      setModalError('Select at least one target department (Cyber Security, IoT, or both).');
      return;
    }

    const start = new Date(startDatetime);
    const end = new Date(endDatetime);
    if (start >= end) {
      setModalError('End date/time must be strictly after Start date/time.');
      return;
    }

    if (selectedQuestions.length < questionsPerAttempt) {
      setModalError(
        selectedQuestions.length === 0
          ? `Select at least ${questionsPerAttempt} question(s) from the question bank (Questions / Student is set to ${questionsPerAttempt}).`
          : `Assigned question pool size (${selectedQuestions.length}) must be at least the questions per attempt (${questionsPerAttempt}).`
      );
      return;
    }

    const payload = {
      title: title.trim(),
      description: description.trim(),
      duration_minutes: durationMinutes,
      questions_per_attempt: questionsPerAttempt,
      start_datetime: start.toISOString(),
      end_datetime: end.toISOString(),
      is_active: isActive,
      departments: selectedDepts,
      questions: selectedQuestions.map((qId, idx) => ({ id: qId, order: idx + 1 })),
    };

    try {
      if (editingExam) {
        await api.updateExam(editingExam.id, payload);
      } else {
        await api.createExam(payload);
      }
      setIsModalOpen(false);
      fetchExams();
    } catch (err: any) {
      setModalError(err.message || 'Failed to save examination.');
    }
  };

  const handleDeleteExam = async (id: number) => {
    if (!confirm('Are you sure you want to delete this examination?')) return;
    try {
      await api.deleteExam(id);
      fetchExams();
    } catch (err: any) {
      alert(err.message || 'Failed to delete exam');
    }
  };

  // Calculate live question & marks summary for selected questions in modal
  const selectedQuestionObjects = selectedQuestions
    .map((qId) => availableQuestions.find((q) => q.id === qId))
    .filter(Boolean) as Question[];

  const calculatedTotalMarks = selectedQuestionObjects.reduce((acc, q) => acc + q.marks, 0);

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center">
              <FileText className="h-6 w-6 mr-2 text-teal-700" /> Examination Management
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Configure exam schedules, target departments, and assign MCQ items ({exams.length} examinations)
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm shadow-sm transition self-start sm:self-auto"
          >
            <Plus className="h-4 w-4 mr-1.5" /> Create Examination
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 flex items-start space-x-3 text-red-700">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0 text-red-500" />
            <div className="text-sm font-medium">{error}</div>
          </div>
        )}

        {/* Exams Grid */}
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-3">
            <div className="w-10 h-10 border-4 border-teal-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm font-medium text-slate-500">Loading examinations...</p>
          </div>
        ) : exams.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center text-slate-500 text-sm">
            No examinations configured. Click "Create Examination" to begin.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {exams.map((exam) => (
              <div
                key={exam.id}
                className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between hover:shadow-md transition"
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <h3 className="text-base font-bold text-slate-900 leading-snug line-clamp-2">
                      {exam.title}
                    </h3>
                    <div className="flex items-center space-x-1 flex-shrink-0">
                      <button
                        onClick={() => openEditModal(exam)}
                        className="p-1 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-100 transition"
                        title="Edit Exam"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteExam(exam.id)}
                        className="p-1 rounded-md border border-red-200 text-red-600 hover:bg-red-50 transition"
                        title="Delete Exam"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-slate-600 line-clamp-2 mb-4">
                    {exam.description || 'No description.'}
                  </p>

                  {/* Target Departments */}
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {exam.department_details && exam.department_details.length > 0 ? (
                      exam.department_details.map((dept) => (
                        <span
                          key={dept.id}
                          className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-sky-100 text-sky-800"
                        >
                          {dept.code}
                        </span>
                      ))
                    ) : (
                      <span className="text-xs text-amber-700 italic">No department assigned</span>
                    )}
                  </div>

                  {/* Schedule Details */}
                  <div className="space-y-1.5 text-xs text-slate-500 border-t border-slate-100 pt-3">
                    <div className="flex items-center">
                      <Clock className="h-3.5 w-3.5 mr-2 text-slate-400" />
                      <span>Duration: <strong className="text-slate-700">{exam.duration_minutes} mins</strong></span>
                    </div>
                    <div className="flex items-center">
                      <Calendar className="h-3.5 w-3.5 mr-2 text-slate-400" />
                      <span>Start: <strong className="text-slate-700">{new Date(exam.start_datetime).toLocaleDateString()} {new Date(exam.start_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></span>
                    </div>
                    <div className="flex items-center">
                      <Calendar className="h-3.5 w-3.5 mr-2 text-slate-400" />
                      <span>End: <strong className="text-slate-700">{new Date(exam.end_datetime).toLocaleDateString()} {new Date(exam.end_datetime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong></span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold">
                  <span className="text-slate-700">
                    Pool: {exam.question_pool_size || exam.question_count} Qs | {exam.questions_per_attempt || 30} per student | {exam.total_marks} Marks
                  </span>
                  <span className={exam.is_active ? 'text-emerald-600' : 'text-slate-400'}>
                    {exam.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create / Edit Exam Modal */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white max-w-3xl w-full rounded-2xl p-6 shadow-2xl border border-slate-200 my-8">
              <div className="flex items-center justify-between pb-4 border-b border-slate-200 mb-6">
                <h3 className="text-lg font-bold text-slate-900">
                  {editingExam ? 'Edit Examination' : 'Create Examination'}
                </h3>
                <button
                  onClick={() => setIsModalOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {modalError && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-xs font-medium text-red-700 flex items-center">
                  <AlertCircle className="h-4 w-4 mr-2 flex-shrink-0" />
                  {modalError}
                </div>
              )}

              <form onSubmit={handleSaveExam} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                    Exam Title
                  </label>
                  <input
                    type="text"
                    required
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="e.g. Cyber Security Fundamentals Midterm"
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                    Description
                  </label>
                  <textarea
                    rows={2}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Brief description or student instructions..."
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                      Duration (Mins)
                    </label>
                    <input
                      type="number"
                      min="5"
                      max="300"
                      required
                      value={durationMinutes}
                      onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                      Questions / Student
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="300"
                      required
                      value={questionsPerAttempt}
                      onChange={(e) => setQuestionsPerAttempt(parseInt(e.target.value, 10))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                      Start Datetime
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={startDatetime}
                      onChange={(e) => setStartDatetime(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                      End Datetime
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={endDatetime}
                      onChange={(e) => setEndDatetime(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-teal-600"
                    />
                  </div>
                </div>

                {/* Target Departments */}
                <div className="pt-2">
                  <label className="block text-xs font-bold uppercase text-slate-700 mb-2">
                    Target Departments (Eligible Cohorts)
                  </label>
                  <div className="flex flex-wrap gap-4 p-3 bg-slate-50 rounded-xl border border-slate-200">
                    {departments.map((dept) => (
                      <label key={dept.id} className="flex items-center space-x-2 text-sm text-slate-800 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedDepts.includes(dept.id)}
                          onChange={() => handleDeptToggle(dept.id)}
                          className="h-4 w-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500"
                        />
                        <span>{dept.name} (<strong>{dept.code}</strong>)</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Question Selection & Reordering */}
                <div className="pt-2">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-bold uppercase text-slate-700">
                      Assign Questions from Question Bank
                    </label>
                    <div className="text-xs font-bold text-teal-800 bg-teal-50 px-2.5 py-1 rounded-md border border-teal-200">
                      Total: {selectedQuestions.length} Questions | {calculatedTotalMarks} Marks
                    </div>
                  </div>

                  {/* Selected questions list with ordering */}
                  {selectedQuestions.length > 0 && (
                    <div className="mb-3 max-h-40 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 bg-slate-50 p-2">
                      <div className="text-xs font-semibold text-slate-500 mb-1 px-1">Selected Order:</div>
                      {selectedQuestionObjects.map((q, idx) => (
                        <div key={q.id} className="flex items-center justify-between py-1.5 px-2 bg-white rounded my-1 text-xs">
                          <span className="font-bold text-slate-700 w-6">#{idx + 1}</span>
                          <span className="flex-1 truncate mx-2 text-slate-800">{q.question_text}</span>
                          <span className="text-slate-500 mr-2 font-mono font-medium">{q.marks}m</span>
                          <div className="flex items-center space-x-1">
                            <button
                              type="button"
                              onClick={() => moveQuestion(idx, 'UP')}
                              disabled={idx === 0}
                              className="p-0.5 rounded hover:bg-slate-100 disabled:opacity-30"
                              title="Move up"
                            >
                              <ArrowUp className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveQuestion(idx, 'DOWN')}
                              disabled={idx === selectedQuestions.length - 1}
                              className="p-0.5 rounded hover:bg-slate-100 disabled:opacity-30"
                              title="Move down"
                            >
                              <ArrowDown className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Available questions checkboxes */}
                  <div className="max-h-48 overflow-y-auto border border-slate-200 rounded-lg divide-y divide-slate-100 p-2">
                    {availableQuestions.map((q) => (
                      <label key={q.id} className="flex items-start space-x-2 py-2 px-2 hover:bg-slate-50 cursor-pointer text-xs rounded">
                        <input
                          type="checkbox"
                          checked={selectedQuestions.includes(q.id)}
                          onChange={() => handleQuestionToggle(q.id)}
                          className="mt-0.5 h-3.5 w-3.5 text-teal-600 rounded border-slate-300 focus:ring-teal-500"
                        />
                        <div className="flex-1">
                          <span className="font-medium text-slate-800">{q.question_text}</span>
                          <span className="text-slate-400 ml-2">({q.category || 'General'} - {q.marks} marks)</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex items-center space-x-2 pt-2">
                  <input
                    type="checkbox"
                    id="active_cb"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="h-4 w-4 text-teal-600 rounded border-slate-300 focus:ring-teal-500"
                  />
                  <label htmlFor="active_cb" className="text-sm font-medium text-slate-700 cursor-pointer">
                    Exam is Active
                  </label>
                </div>

                <div className="pt-4 border-t border-slate-200 flex justify-end space-x-3">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 border border-slate-300 rounded-lg text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-lg bg-teal-700 hover:bg-teal-800 text-white font-semibold text-sm shadow-sm transition"
                  >
                    {editingExam ? 'Update Examination' : 'Create Examination'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
