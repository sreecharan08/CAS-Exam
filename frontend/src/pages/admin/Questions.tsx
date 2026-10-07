import React, { useState, useEffect, useCallback } from 'react';
import { api, type Question, type ExamType } from '../../api/client';
import {
  HelpCircle,
  Plus,
  Edit2,
  Trash2,
  CheckCircle2,
  X,
  AlertCircle,
  Search,
  UploadCloud
} from 'lucide-react';

export const Questions: React.FC = () => {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Search & Filter
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | ExamType>('');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  // Form State
  const [questionType, setQuestionType] = useState<ExamType>('MCQ');
  const [questionText, setQuestionText] = useState('');
  const [marks, setMarks] = useState<number>(2);
  const [category, setCategory] = useState('Cyber Security');
  const [difficulty, setDifficulty] = useState('Medium');
  const [options, setOptions] = useState<{ [key: string]: string }>({
    A: '',
    B: '',
    C: '',
    D: '',
  });
  const [correctKey, setCorrectKey] = useState<'A' | 'B' | 'C' | 'D'>('A');
  const [gradingInstructions, setGradingInstructions] = useState('');

  const fetchQuestions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAdminQuestions({
        search,
        category: categoryFilter,
      });
      setQuestions(res.results || res);
    } catch (err: any) {
      setError(err.message || 'Failed to load question bank.');
    } finally {
      setLoading(false);
    }
  }, [search, categoryFilter]);

  useEffect(() => {
    fetchQuestions();
  }, [fetchQuestions]);

  const openCreateModal = () => {
    setEditingQuestion(null);
    setQuestionType('MCQ');
    setQuestionText('');
    setMarks(2);
    setCategory('Cyber Security');
    setDifficulty('Medium');
    setOptions({ A: '', B: '', C: '', D: '' });
    setCorrectKey('A');
    setGradingInstructions('');
    setModalError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (q: Question) => {
    setEditingQuestion(q);
    setQuestionType(q.question_type || 'MCQ');
    setQuestionText(q.question_text);
    setMarks(q.marks);
    setCategory(q.category || '');
    setDifficulty(q.difficulty || 'Medium');
    setGradingInstructions(q.explanation || '');

    const optsMap: { [key: string]: string } = { A: '', B: '', C: '', D: '' };
    let correct: 'A' | 'B' | 'C' | 'D' = 'A';

    q.options.forEach((opt) => {
      optsMap[opt.option_key] = opt.option_text;
      if (opt.is_correct) {
        correct = opt.option_key;
      }
    });

    setOptions(optsMap);
    setCorrectKey(correct);
    setModalError(null);
    setIsModalOpen(true);
  };

  const handleSaveQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    // Validation
    if (!questionText.trim()) {
      setModalError('Question text cannot be empty.');
      return;
    }

    if (questionType === 'MCQ' && (!options.A.trim() || !options.B.trim() || !options.C.trim() || !options.D.trim())) {
      setModalError('All 4 options (A, B, C, D) must be provided.');
      return;
    }

    const payload = {
      question_type: questionType,
      question_text: questionText.trim(),
      marks: parseInt(marks.toString(), 10) || 1,
      category: category.trim(),
      difficulty,
      explanation: questionType === 'FILE_UPLOAD' ? gradingInstructions.trim() : '',
      is_active: true,
      options: questionType === 'MCQ' ? [
        { option_key: 'A', option_text: options.A.trim(), is_correct: correctKey === 'A' },
        { option_key: 'B', option_text: options.B.trim(), is_correct: correctKey === 'B' },
        { option_key: 'C', option_text: options.C.trim(), is_correct: correctKey === 'C' },
        { option_key: 'D', option_text: options.D.trim(), is_correct: correctKey === 'D' },
      ] : [],
    };

    try {
      if (editingQuestion) {
        await api.updateQuestion(editingQuestion.id, payload);
      } else {
        await api.createQuestion(payload);
      }
      setIsModalOpen(false);
      fetchQuestions();
    } catch (err: any) {
      setModalError(err.message || 'Failed to save question.');
    }
  };

  const filteredQuestions = typeFilter
    ? questions.filter((q) => (q.question_type || 'MCQ') === typeFilter)
    : questions;

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this question?')) return;
    try {
      await api.deleteQuestion(id);
      fetchQuestions();
    } catch (err: any) {
      alert(err.message || 'Failed to delete question');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-8 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 flex items-center">
              <HelpCircle className="h-6 w-6 mr-2 text-indigo-700" /> Question Bank
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              Curate and manage MCQ items for university assessments ({questions.length} total questions)
            </p>
          </div>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center px-4 py-2 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white font-semibold text-sm shadow-sm transition self-start sm:self-auto"
          >
            <Plus className="h-4 w-4 mr-1.5" /> Add New Question
          </button>
        </div>

        {/* Filter bar */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 mb-6 flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="w-full md:w-96 relative">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search question text..."
              className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600 font-medium"
            />
            <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-3" />
          </div>

          <div className="flex items-center space-x-3 w-full md:w-auto justify-end">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as '' | ExamType)}
              className="py-2 px-3 border border-slate-300 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-600"
            >
              <option value="">All Types</option>
              <option value="MCQ">MCQ</option>
              <option value="FILE_UPLOAD">File Upload</option>
            </select>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="py-2 px-3 border border-slate-300 rounded-lg text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-600"
            >
              <option value="">All Categories</option>
              <option value="Cyber Security">Cyber Security</option>
              <option value="IoT">IoT</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200 flex items-start space-x-3 text-red-700">
            <AlertCircle className="h-5 w-5 mt-0.5 flex-shrink-0 text-red-500" />
            <div className="text-sm font-medium">{error}</div>
          </div>
        )}

        {/* Questions List */}
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center space-y-3">
            <div className="w-10 h-10 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
            <p className="text-sm font-medium text-slate-500">Loading questions...</p>
          </div>
        ) : filteredQuestions.length === 0 ? (
          <div className="bg-white rounded-xl border border-dashed border-slate-300 p-12 text-center text-slate-500 text-sm">
            No questions found. Click "Add New Question" to create one.
          </div>
        ) : (
          <div className="space-y-4">
            {filteredQuestions.map((q, idx) => (
              <div
                key={q.id}
                className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition"
              >
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div className="flex items-center space-x-2">
                    <span className="font-bold text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md">
                      #{idx + 1}
                    </span>
                    {(q.question_type || 'MCQ') === 'FILE_UPLOAD' ? (
                      <span className="inline-flex items-center text-xs font-semibold bg-purple-50 text-purple-700 px-2.5 py-1 rounded-md border border-purple-100">
                        <UploadCloud className="h-3 w-3 mr-1" /> File Upload
                      </span>
                    ) : (
                      <span className="text-xs font-semibold bg-sky-50 text-sky-700 px-2.5 py-1 rounded-md border border-sky-100">
                        MCQ
                      </span>
                    )}
                    {q.category && (
                      <span className="text-xs font-semibold bg-indigo-50 text-indigo-700 px-2.5 py-1 rounded-md border border-indigo-100">
                        {q.category}
                      </span>
                    )}
                    <span className="text-xs font-semibold text-slate-500">
                      Marks: <strong className="text-slate-800">{q.marks}</strong>
                    </span>
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => openEditModal(q)}
                      className="p-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 transition"
                      title="Edit Question"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(q.id)}
                      className="p-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 transition"
                      title="Delete Question"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <h3 className="text-base font-medium text-slate-900 mb-4">{q.question_text}</h3>

                {(q.question_type || 'MCQ') === 'FILE_UPLOAD' ? (
                  q.explanation ? (
                    <div className="text-sm p-3 rounded-lg bg-purple-50 border border-purple-100 text-purple-900">
                      <span className="font-semibold">Grading instructions: </span>
                      {q.explanation}
                    </div>
                  ) : (
                    <div className="text-sm text-slate-400 italic">No grading instructions provided.</div>
                  )
                ) : (
                /* Options Grid (Admin views correct answer) */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                  {q.options.map((opt) => (
                    <div
                      key={opt.id || opt.option_key}
                      className={`p-3 rounded-lg border flex items-center justify-between ${
                        opt.is_correct
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-900 font-semibold'
                          : 'bg-slate-50 border-slate-200 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <span
                          className={`h-5 w-5 rounded-full flex items-center justify-center text-xs font-bold ${
                            opt.is_correct
                              ? 'bg-emerald-600 text-white'
                              : 'bg-slate-200 text-slate-700'
                          }`}
                        >
                          {opt.option_key}
                        </span>
                        <span>{opt.option_text}</span>
                      </div>
                      {opt.is_correct && (
                        <span className="flex items-center text-xs font-bold text-emerald-700">
                          <CheckCircle2 className="h-4 w-4 mr-1 text-emerald-600" /> Correct Key
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Create / Edit Question Modal */}
        {isModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 overflow-y-auto">
            <div className="bg-white max-w-2xl w-full rounded-2xl p-6 shadow-2xl border border-slate-200 my-8">
              <div className="flex items-center justify-between pb-4 border-b border-slate-200 mb-6">
                <h3 className="text-lg font-bold text-slate-900">
                  {editingQuestion
                    ? questionType === 'FILE_UPLOAD' ? 'Edit File Upload Task' : 'Edit MCQ Question'
                    : questionType === 'FILE_UPLOAD' ? 'Create New File Upload Task' : 'Create New MCQ Question'}
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

              <form onSubmit={handleSaveQuestion} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 mb-2">
                    Question Type
                  </label>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setQuestionType('MCQ')}
                      disabled={!!editingQuestion}
                      className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold border transition disabled:opacity-50 disabled:cursor-not-allowed ${
                        questionType === 'MCQ'
                          ? 'bg-sky-600 text-white border-sky-600'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      Multiple Choice
                    </button>
                    <button
                      type="button"
                      onClick={() => setQuestionType('FILE_UPLOAD')}
                      disabled={!!editingQuestion}
                      className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold border transition disabled:opacity-50 disabled:cursor-not-allowed ${
                        questionType === 'FILE_UPLOAD'
                          ? 'bg-purple-600 text-white border-purple-600'
                          : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      File Upload Task
                    </button>
                  </div>
                  {editingQuestion && (
                    <p className="text-xs text-slate-400 mt-1">Question type cannot be changed after creation.</p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                    {questionType === 'FILE_UPLOAD' ? 'Task / Problem Statement' : 'Question Text'}
                  </label>
                  <textarea
                    required
                    rows={3}
                    value={questionText}
                    onChange={(e) => setQuestionText(e.target.value)}
                    placeholder={questionType === 'FILE_UPLOAD'
                      ? 'e.g. Write a program that reverses a linked list and upload your source file.'
                      : 'Enter the question text here...'}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                      Marks
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="10"
                      required
                      value={marks}
                      onChange={(e) => setMarks(parseInt(e.target.value, 10))}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                      Category
                    </label>
                    <input
                      type="text"
                      required
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      placeholder="e.g. Cyber Security"
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                      Difficulty
                    </label>
                    <select
                      value={difficulty}
                      onChange={(e) => setDifficulty(e.target.value)}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                    >
                      <option value="Easy">Easy</option>
                      <option value="Medium">Medium</option>
                      <option value="Hard">Hard</option>
                    </select>
                  </div>
                </div>

                {questionType === 'MCQ' ? (
                  /* Options A, B, C, D */
                  <div className="pt-2">
                    <label className="block text-xs font-bold uppercase text-slate-700 mb-2">
                      Options & Correct Answer Selection (Exactly one must be correct)
                    </label>
                    <div className="space-y-3">
                      {(['A', 'B', 'C', 'D'] as const).map((key) => (
                        <div key={key} className="flex items-center space-x-3">
                          <input
                            type="radio"
                            name="correct_option"
                            checked={correctKey === key}
                            onChange={() => setCorrectKey(key)}
                            id={`radio_${key}`}
                            className="h-4 w-4 text-emerald-600 focus:ring-emerald-500 border-slate-300"
                          />
                          <label
                            htmlFor={`radio_${key}`}
                            className="w-8 font-bold text-sm text-slate-700 cursor-pointer"
                          >
                            {key}:
                          </label>
                          <input
                            type="text"
                            required
                            value={options[key]}
                            onChange={(e) =>
                              setOptions((prev) => ({ ...prev, [key]: e.target.value }))
                            }
                            placeholder={`Option ${key} text...`}
                            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="pt-2">
                    <label className="block text-xs font-bold uppercase text-slate-700 mb-1">
                      Grading Instructions (shown only to the admin reviewer, not students)
                    </label>
                    <textarea
                      rows={3}
                      value={gradingInstructions}
                      onChange={(e) => setGradingInstructions(e.target.value)}
                      placeholder="e.g. Award full marks for correct logic; deduct 2 marks for missing edge-case handling."
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                    <p className="text-xs text-slate-400 mt-1">
                      Students upload a file (or multiple files) as their answer. There is no auto-grading -
                      an admin manually reviews the upload and assigns a score up to the marks above.
                    </p>
                  </div>
                )}

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
                    className="px-5 py-2 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white font-semibold text-sm shadow-sm transition"
                  >
                    {editingQuestion ? 'Update Question' : 'Save Question'}
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
