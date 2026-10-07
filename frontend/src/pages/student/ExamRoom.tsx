import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { api, type ExamAttemptDetail, type Question } from '../../api/client';
import {
  Clock,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Send,
  Maximize,
  Minimize,
  ShieldAlert,
  ArrowLeft,
  Info
} from 'lucide-react';

export const ExamRoom: React.FC = () => {
  const { examId } = useParams<{ examId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  // State
  const [attempt, setAttempt] = useState<ExamAttemptDetail | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fullscreen gate and state. If the Dashboard already put us into
  // fullscreen before navigating here, honor that immediately so the exam
  // starts without a second confirmation click.
  const [hasEnteredFullscreen, setHasEnteredFullscreen] = useState<boolean>(() => Boolean(document.fullscreenElement));
  const [isFullscreen, setIsFullscreen] = useState<boolean>(() => Boolean(document.fullscreenElement));
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);

  // Timer
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);

  // Local answers cache: { [questionId]: selectedOptionId }
  const [answers, setAnswers] = useState<Record<number, number | null>>({});
  const [savingAnswer, setSavingAnswer] = useState(false);

  // Integrity violation tracking
  const [violationCount, setViolationCount] = useState(0);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [autoSubmitted, setAutoSubmitted] = useState(false);
  const [autoSubmitReason, setAutoSubmitReason] = useState<string | null>(null);

  // Modals
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Cooldown ref for debouncing violations
  const lastViolationTimeRef = useRef<number>(0);
  const isTerminatedRef = useRef<boolean>(false);

  // Tracks which examId initExam has already fired a start/resume request
  // for. React 18 StrictMode double-invokes effects in development, which
  // without this guard sends two concurrent POST /start/ requests - the
  // second collides with the one-attempt-per-student DB constraint and
  // surfaces a spurious "Access Denied" error even though the first request
  // succeeded.
  const initializedExamIdRef = useRef<string | null>(null);

  // 1. Initialize or resume exam attempt
  const initExam = useCallback(async () => {
    if (!examId) return;
    setLoading(true);
    setError(null);

    try {
      const data = await api.startExam(parseInt(examId, 10));
      setAttempt(data);
      setRemainingSeconds(data.remaining_seconds);
      setViolationCount(data.violation_count);

      // Restore saved answers
      const restored: Record<number, number | null> = {};
      if (data.answers) {
        Object.entries(data.answers).forEach(([qId, ans]) => {
          restored[parseInt(qId, 10)] = ans.option_id;
        });
      }
      setAnswers(restored);

      // Check if already completed
      if (data.status === 'SUBMITTED' || data.status === 'AUTO_SUBMITTED') {
        isTerminatedRef.current = true;
        setAutoSubmitted(data.status === 'AUTO_SUBMITTED');
        setAutoSubmitReason(data.submission_reason);
      }
    } catch (err: any) {
      const message: string = err.message || 'Failed to start or resume the examination.';

      // The attempt already exists but is finished (submitted earlier, or just
      // expired by the time this request reached the server). That's not an
      // access problem - fetch the real attempt and show the normal "submitted"
      // screen instead of a scary "Access Denied" page.
      const isFinishedAttempt = message.includes('already been submitted') || message.includes('time expired');
      if (isFinishedAttempt) {
        try {
          const examDetail = await api.getStudentExamDetail(parseInt(examId, 10));
          const attemptId = examDetail.exam.attempt_id;
          if (attemptId) {
            const attemptData = await api.getAttemptDetail(attemptId);
            setAttempt(attemptData);
            setRemainingSeconds(attemptData.remaining_seconds);
            setViolationCount(attemptData.violation_count);
            if (attemptData.status === 'SUBMITTED' || attemptData.status === 'AUTO_SUBMITTED') {
              isTerminatedRef.current = true;
              setAutoSubmitted(attemptData.status === 'AUTO_SUBMITTED');
              setAutoSubmitReason(attemptData.submission_reason);
            }
            return;
          }
        } catch {
          // Fall through to the generic error screen below.
        }
      }

      setError(message);
    } finally {
      setLoading(false);
    }
  }, [examId]);

  useEffect(() => {
    if (!examId || initializedExamIdRef.current === examId) return;
    initializedExamIdRef.current = examId;
    initExam();
  }, [examId, initExam]);

  // 2. Countdown Timer
  useEffect(() => {
    if (loading || !attempt || attempt.status !== 'IN_PROGRESS' || isTerminatedRef.current) {
      return;
    }

    const timer = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleTimeExpire();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [loading, attempt]);

  const handleTimeExpire = async () => {
    if (!attempt || isTerminatedRef.current) return;
    isTerminatedRef.current = true;
    try {
      const res = await api.getAttemptDetail(attempt.id);
      setAttempt(res);
      setAutoSubmitted(true);
      setAutoSubmitReason('TIME_EXPIRED');
    } catch (e) {
      setAutoSubmitted(true);
      setAutoSubmitReason('TIME_EXPIRED');
    }
  };

  // 3. Violation handler with 1.5s cooldown
  const triggerViolation = useCallback(
    async (triggerName: string) => {
      if (!attempt || attempt.status !== 'IN_PROGRESS' || isTerminatedRef.current || !hasEnteredFullscreen) {
        return;
      }

      const now = Date.now();
      if (now - lastViolationTimeRef.current < 1500) {
        return; // Debounce rapid consecutive events (e.g. blur + visibilitychange)
      }
      lastViolationTimeRef.current = now;

      try {
        const res = await api.recordViolation(attempt.id);
        setViolationCount(res.violation_count);

        if (res.auto_submitted) {
          isTerminatedRef.current = true;
          setAutoSubmitted(true);
          setAutoSubmitReason('EXAM_INTEGRITY_VIOLATION');
          setWarningMessage(res.message);
        } else {
          setWarningMessage(`Warning: Leaving the exam window has been detected (${triggerName}). This activity is recorded.`);
          setTimeout(() => {
            setWarningMessage(null);
          }, 6000);
        }
      } catch (err: any) {
        console.error('Failed to log violation:', err);
      }
    },
    [attempt, hasEnteredFullscreen]
  );

  // 4. Attach Security Listeners (Visibility, Blur, Fullscreen exit, Right-click prevention)
  useEffect(() => {
    if (!hasEnteredFullscreen || !attempt || attempt.status !== 'IN_PROGRESS' || isTerminatedRef.current) {
      return;
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        triggerViolation('Tab / Window Hidden');
      }
    };

    const handleWindowBlur = () => {
      triggerViolation('Focus Lost');
    };

    const handleFullscreenChange = () => {
      const active = Boolean(document.fullscreenElement);
      setIsFullscreen(active);
      if (!active) {
        triggerViolation('Fullscreen Exited');
      }
    };

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      return false;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Deter Ctrl+C, Ctrl+V, Ctrl+U, F12
      if (
        (e.ctrlKey && (e.key === 'c' || e.key === 'C' || e.key === 'u' || e.key === 'U')) ||
        e.key === 'F12'
      ) {
        e.preventDefault();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [hasEnteredFullscreen, attempt, triggerViolation]);

  // Keep fullscreen state in sync globally
  useEffect(() => {
    const handleSyncFullscreen = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleSyncFullscreen);
    return () => {
      document.removeEventListener('fullscreenchange', handleSyncFullscreen);
    };
  }, []);

  // Request fullscreen and begin exam. Only marks the exam as "entered" when
  // fullscreen actually activates - never proceeds on a denied/failed
  // request, which previously left students stuck in a broken non-fullscreen
  // state with a nagging "Return to Fullscreen" banner.
  const enterExamFullscreen = async () => {
    setFullscreenError(null);
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      } else if ((document.documentElement as any).webkitRequestFullscreen) {
        await (document.documentElement as any).webkitRequestFullscreen();
      } else if ((document.documentElement as any).msRequestFullscreen) {
        await (document.documentElement as any).msRequestFullscreen();
      } else {
        throw new Error('Fullscreen is not supported in this browser.');
      }
      setIsFullscreen(true);
      setHasEnteredFullscreen(true);
    } catch (err) {
      console.warn('Fullscreen request bypassed or denied:', err);
      setFullscreenError(
        'Fullscreen permission is required to continue this exam. Please allow fullscreen access and try again.'
      );
    }
  };

  // Fullscreen button action handler
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen();
        } else if ((document.documentElement as any).webkitRequestFullscreen) {
          await (document.documentElement as any).webkitRequestFullscreen();
        } else if ((document.documentElement as any).msRequestFullscreen) {
          await (document.documentElement as any).msRequestFullscreen();
        }
        setIsFullscreen(true);
      } else {
        const confirmed = window.confirm(
          'Warning: Exiting fullscreen mode will be recorded as an exam integrity violation. Are you sure you want to exit fullscreen?'
        );
        if (confirmed) {
          if (document.exitFullscreen) {
            await document.exitFullscreen();
          } else if ((document as any).webkitExitFullscreen) {
            await (document as any).webkitExitFullscreen();
          } else if ((document as any).msExitFullscreen) {
            await (document as any).msExitFullscreen();
          }
          setIsFullscreen(false);
        }
      }
    } catch (err) {
      console.warn('Fullscreen toggle failed:', err);
    }
  };

  // 5. Select Option & Autosave
  const handleSelectOption = async (questionId: number, optionId: number) => {
    if (!attempt || attempt.status !== 'IN_PROGRESS' || isTerminatedRef.current) return;

    // Optimistically update local state
    setAnswers((prev) => ({
      ...prev,
      [questionId]: optionId,
    }));

    setSavingAnswer(true);
    try {
      await api.saveAnswer(attempt.id, questionId, optionId);
    } catch (err: any) {
      console.error('Error autosaving answer:', err);
      if (err.message.includes('expired') || err.message.includes('submitted')) {
        isTerminatedRef.current = true;
        setAutoSubmitted(true);
      }
    } finally {
      setSavingAnswer(false);
    }
  };

  // 6. Manual Submit
  const handleConfirmSubmit = async () => {
    if (!attempt || isTerminatedRef.current) return;
    setSubmitting(true);
    isTerminatedRef.current = true;

    try {
      const res = await api.submitExam(attempt.id);
      setAttempt((prev) =>
        prev
          ? {
              ...prev,
              status: 'SUBMITTED',
              score: res.score,
              max_score: res.max_score,
              percentage: res.percentage,
              submitted_at: res.submitted_at,
            }
          : null
      );
      setShowSubmitModal(false);
      // Exit fullscreen if active
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    } catch (err: any) {
      alert(err.message || 'Submission error');
    } finally {
      setSubmitting(false);
    }
  };

  const formatTime = (totalSec: number) => {
    const mins = Math.floor(totalSec / 60);
    const secs = totalSec % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 text-white">
        <div className="text-center space-y-3">
          <div className="w-12 h-12 border-4 border-sky-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-slate-300 font-medium text-sm">Preparing secure examination room...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
        <div className="bg-white max-w-md w-full p-8 rounded-xl shadow-lg border border-slate-200 text-center">
          <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Access Denied</h2>
          <p className="text-sm text-slate-600 mb-6">{error}</p>
          <button
            onClick={() => navigate('/dashboard')}
            className="w-full inline-flex justify-center items-center py-2.5 px-4 rounded-lg bg-sky-700 text-white font-medium hover:bg-sky-800 transition"
          >
            <ArrowLeft className="h-4 w-4 mr-2" /> Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // Fullscreen recovery screen. Normally the Dashboard already put us into
  // fullscreen before navigating here, so this won't show. It only appears
  // if fullscreen was lost in a way that needs a fresh user gesture to
  // restore - e.g. a page refresh or a direct URL visit mid-exam.
  if (!hasEnteredFullscreen && attempt?.status === 'IN_PROGRESS' && !isTerminatedRef.current) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white max-w-md w-full rounded-2xl shadow-2xl p-8 border border-slate-200 text-center">
          <Maximize className="h-10 w-10 text-sky-700 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">Fullscreen Required</h2>
          <p className="text-sm text-slate-600 mb-6">
            <strong>{attempt.exam_title}</strong> must run in fullscreen mode. Click below to continue your exam.
          </p>

          {fullscreenError && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 text-left">
              {fullscreenError}
            </div>
          )}

          <button
            onClick={enterExamFullscreen}
            className="w-full flex items-center justify-center py-3.5 px-6 rounded-xl bg-sky-700 hover:bg-sky-800 text-white font-bold text-base shadow-lg transition"
          >
            <Maximize className="h-5 w-5 mr-2" /> Enter Fullscreen & Continue
          </button>
        </div>
      </div>
    );
  }

  // Attempt Terminated / Submitted View
  if (attempt?.status === 'SUBMITTED' || attempt?.status === 'AUTO_SUBMITTED' || autoSubmitted) {
    const isAuto = attempt?.status === 'AUTO_SUBMITTED' || autoSubmitted;
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-4">
        <div className="bg-white max-w-md w-full rounded-2xl shadow-xl p-8 border border-slate-200 text-center">
          {isAuto ? (
            <div className="h-16 w-16 bg-amber-100 text-amber-700 rounded-full flex items-center justify-center mx-auto mb-4">
              <ShieldAlert className="h-10 w-10" />
            </div>
          ) : (
            <div className="h-16 w-16 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="h-10 w-10" />
            </div>
          )}

          <h2 className="text-2xl font-bold text-slate-900 mb-2">
            {isAuto ? 'Exam Automatically Submitted' : 'Exam Successfully Submitted'}
          </h2>

          <p className="text-sm text-slate-600 mb-6">
            {autoSubmitReason === 'EXAM_INTEGRITY_VIOLATION' || attempt?.submission_reason === 'EXAM_INTEGRITY_VIOLATION'
              ? 'Your exam was automatically submitted because the maximum number of integrity violations (5/5) was reached.'
              : autoSubmitReason === 'TIME_EXPIRED' || attempt?.submission_reason === 'TIME_EXPIRED'
              ? 'Your exam was automatically submitted because the exam time expired.'
              : 'Your responses have been recorded on the server.'}
          </p>

          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 mb-6 text-left space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Student Roll Number:</span>
              <span className="font-mono font-bold text-slate-800">{user?.roll_number}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Status:</span>
              <span className="font-bold text-slate-800">{attempt?.status}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Violations Recorded:</span>
              <span className="font-bold text-red-600">{attempt?.violation_count || violationCount} / 5</span>
            </div>
          </div>

          <button
            onClick={() => navigate('/results')}
            className="w-full py-3 px-4 rounded-xl bg-sky-700 hover:bg-sky-800 text-white font-semibold text-sm transition"
          >
            View My Results &rarr;
          </button>
        </div>
      </div>
    );
  }

  const currentQuestion: Question | undefined = attempt?.questions[currentIndex];
  const answeredCount = Object.values(answers).filter((v) => v !== null && v !== undefined).length;
  const totalQuestions = attempt?.questions.length || 0;

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col exam-secure-mode select-none">
      {/* Top Header */}
      <header className="bg-slate-900 text-white border-b border-slate-800 px-6 py-3 flex items-center justify-between shadow-md">
        <div className="flex items-center space-x-4">
          <div className="font-bold text-base tracking-wide text-sky-400">
            {attempt?.exam_title}
          </div>
          <span className="text-slate-600">|</span>
          <div className="text-sm text-slate-300">
            Roll: <span className="font-mono font-semibold text-white">{user?.roll_number}</span>
          </div>
        </div>

        {/* Violations, Fullscreen & Timer */}
        <div className="flex items-center space-x-3 sm:space-x-4">
          {/* Violation Indicator */}
          <div
            className={`flex items-center px-3 py-1 rounded-md text-xs font-semibold ${
              violationCount > 0 ? 'bg-red-950 text-red-300 border border-red-800' : 'bg-slate-800 text-slate-300'
            }`}
          >
            <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />
            Violations: {violationCount} / 5
          </div>

          {/* Fullscreen Button */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs sm:text-sm font-semibold transition border ${
              isFullscreen
                ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                : 'bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold border-amber-400 animate-pulse shadow-sm'
            }`}
            title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
            aria-label="Toggle Fullscreen Mode"
          >
            {isFullscreen ? (
              <>
                <Minimize className="h-4 w-4 mr-1.5 text-sky-400" />
                <span>Fullscreen</span>
              </>
            ) : (
              <>
                <Maximize className="h-4 w-4 mr-1.5" />
                <span>Fullscreen</span>
              </>
            )}
          </button>

          {/* Countdown Clock */}
          <div
            className={`flex items-center px-4 py-1.5 rounded-lg text-sm font-mono font-bold tracking-wider ${
              remainingSeconds < 300
                ? 'bg-red-600 text-white animate-pulse'
                : 'bg-slate-800 text-amber-300 border border-slate-700'
            }`}
          >
            <Clock className="h-4 w-4 mr-2" />
            {formatTime(remainingSeconds)}
          </div>

          <button
            onClick={() => setShowSubmitModal(true)}
            className="inline-flex items-center px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-sm transition"
          >
            <Send className="h-3.5 w-3.5 mr-1.5" /> Submit Exam
          </button>
        </div>
      </header>

      {/* Violation Alert Banner */}
      {warningMessage && (
        <div className="bg-red-600 text-white px-6 py-2 text-sm font-semibold flex items-center justify-center space-x-3 animate-bounce">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          <span>{warningMessage}</span>
          {!isFullscreen && (
            <button
              type="button"
              onClick={toggleFullscreen}
              className="ml-2 px-3 py-1 bg-white text-red-700 font-bold text-xs rounded-md shadow hover:bg-red-50 transition inline-flex items-center"
            >
              <Maximize className="h-3.5 w-3.5 mr-1" /> Re-enter Fullscreen
            </button>
          )}
        </div>
      )}

      {/* Non-Fullscreen Warning Strip */}
      {!isFullscreen && hasEnteredFullscreen && !isTerminatedRef.current && (
        <div className="bg-amber-500 text-slate-950 px-6 py-2 text-xs sm:text-sm font-semibold flex items-center justify-between shadow-sm border-b border-amber-600">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="h-4 w-4 text-slate-950 flex-shrink-0" />
            <span>You are currently not in fullscreen mode. Fullscreen is required for this examination.</span>
          </div>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="px-3 py-1 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-md transition inline-flex items-center shadow"
          >
            <Maximize className="h-3.5 w-3.5 mr-1" /> Return to Fullscreen
          </button>
        </div>
      )}

      {/* Main Workspace */}
      <div className="flex-1 max-w-7xl w-full mx-auto p-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Question Area (3 cols) */}
        <div className="lg:col-span-3 flex flex-col justify-between bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          {currentQuestion ? (
            <div>
              {/* Question Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-sky-700 bg-sky-50 px-2.5 py-1 rounded-md">
                    Question {currentIndex + 1} of {totalQuestions}
                  </span>
                  <span className="ml-3 text-xs text-slate-500 font-medium">
                    Marks: <strong className="text-slate-800">{currentQuestion.marks}</strong>
                  </span>
                </div>
                {savingAnswer && (
                  <span className="text-xs text-slate-400 italic">Autosaving answer...</span>
                )}
              </div>

              {/* Question Text */}
              <div className="text-lg font-medium text-slate-900 mb-8 leading-relaxed">
                {currentQuestion.question_text}
              </div>

              {/* Options List */}
              <div className="space-y-3.5">
                {currentQuestion.options.map((opt) => {
                  const isSelected = answers[currentQuestion.id] === opt.id;
                  return (
                    <div
                      key={opt.id}
                      onClick={() => opt.id && handleSelectOption(currentQuestion.id, opt.id)}
                      className={`flex items-center p-4 rounded-xl border-2 cursor-pointer transition ${
                        isSelected
                          ? 'border-sky-600 bg-sky-50/50 shadow-sm'
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                      }`}
                    >
                      <div
                        className={`h-7 w-7 rounded-full flex items-center justify-center font-bold text-sm mr-4 transition ${
                          isSelected
                            ? 'bg-sky-700 text-white'
                            : 'bg-slate-100 text-slate-600 border border-slate-300'
                        }`}
                      >
                        {opt.option_key}
                      </div>
                      <div className="text-sm font-medium text-slate-800 flex-1">
                        {opt.option_text}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="text-center py-20 text-slate-500">No questions found.</div>
          )}

          {/* Bottom Navigation Buttons */}
          <div className="flex items-center justify-between border-t border-slate-100 pt-6 mt-8">
            <button
              onClick={() => setCurrentIndex((prev) => Math.max(0, prev - 1))}
              disabled={currentIndex === 0}
              className="inline-flex items-center px-4 py-2 rounded-lg border border-slate-300 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              <ChevronLeft className="h-4 w-4 mr-1" /> Previous
            </button>

            <div className="flex items-center space-x-3">
              <button
                type="button"
                onClick={toggleFullscreen}
                className="hidden sm:inline-flex items-center px-3.5 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 transition"
                title={isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}
              >
                {isFullscreen ? (
                  <>
                    <Minimize className="h-4 w-4 mr-1.5 text-slate-500" /> Fullscreen
                  </>
                ) : (
                  <>
                    <Maximize className="h-4 w-4 mr-1.5 text-amber-600" /> Fullscreen
                  </>
                )}
              </button>

              <button
                onClick={() => {
                  if (currentIndex < totalQuestions - 1) {
                    setCurrentIndex((prev) => prev + 1);
                  }
                }}
                disabled={currentIndex === totalQuestions - 1}
                className="inline-flex items-center px-5 py-2 rounded-lg bg-sky-700 hover:bg-sky-800 text-white text-sm font-semibold shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                Save & Next <ChevronRight className="h-4 w-4 ml-1" />
              </button>
            </div>
          </div>
        </div>

        {/* Right Sidebar: Question Palette (1 col) */}
        <div className="lg:col-span-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col justify-between">
          <div>
            <h4 className="text-sm font-bold text-slate-900 tracking-wide uppercase mb-4">
              Question Palette
            </h4>

            {/* Status Legend */}
            <div className="grid grid-cols-2 gap-2 text-xs mb-6 p-3 bg-slate-50 rounded-xl border border-slate-100">
              <div className="flex items-center space-x-2">
                <span className="w-3.5 h-3.5 rounded bg-emerald-500 block"></span>
                <span className="text-slate-600">Answered ({answeredCount})</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="w-3.5 h-3.5 rounded bg-slate-200 border border-slate-300 block"></span>
                <span className="text-slate-600">Pending ({totalQuestions - answeredCount})</span>
              </div>
            </div>

            {/* Questions Grid */}
            <div className="grid grid-cols-5 gap-2.5">
              {attempt?.questions.map((q, idx) => {
                const isCurrent = idx === currentIndex;
                const isAnswered = answers[q.id] !== null && answers[q.id] !== undefined;

                return (
                  <button
                    key={q.id}
                    onClick={() => setCurrentIndex(idx)}
                    className={`h-10 rounded-lg text-xs font-bold transition flex items-center justify-center relative ${
                      isCurrent
                        ? 'ring-2 ring-sky-600 ring-offset-2'
                        : ''
                    } ${
                      isAnswered
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200'
                    }`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-8 pt-4 border-t border-slate-100">
            <button
              onClick={() => setShowSubmitModal(true)}
              className="w-full py-3 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm shadow-md transition flex items-center justify-center"
            >
              <Send className="h-4 w-4 mr-2" /> Submit Final Answers
            </button>
          </div>
        </div>
      </div>

      {/* Confirmation Modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full rounded-2xl p-6 shadow-2xl border border-slate-200">
            <h3 className="text-lg font-bold text-slate-900 mb-2">Submit Examination?</h3>
            <p className="text-sm text-slate-600 mb-4">
              You have answered <strong>{answeredCount}</strong> out of <strong>{totalQuestions}</strong> questions.
            </p>
            <p className="text-xs text-amber-800 bg-amber-50 p-3 rounded-lg border border-amber-200 mb-6 flex items-start">
              <Info className="h-4 w-4 mr-2 flex-shrink-0 mt-0.5" />
              Once submitted, your answers will be locked and cannot be modified.
            </p>

            <div className="flex space-x-3">
              <button
                onClick={() => setShowSubmitModal(false)}
                disabled={submitting}
                className="flex-1 py-2.5 border border-slate-300 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmSubmit}
                disabled={submitting}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold shadow-sm transition flex items-center justify-center"
              >
                {submitting ? 'Submitting...' : 'Yes, Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
