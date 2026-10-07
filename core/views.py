import csv
import os
import random
from datetime import timedelta
from django.contrib.auth import authenticate, login as django_login, logout as django_logout
from django.contrib.auth.models import User
from django.db import transaction, models, IntegrityError
from django.db.models import Q
from django.http import HttpResponse, FileResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import (
    Department,
    Exam,
    ExamAttempt,
    ExamDepartment,
    ExamQuestion,
    Option,
    Question,
    Student,
    StudentAnswer,
    AttemptQuestion,
    SubmissionFile,
)
from .permissions import IsAdminUser, IsStudentUser
from .serializers import (
    AdminExamSerializer,
    AdminQuestionSerializer,
    DepartmentSerializer,
    ExamAttemptDetailSerializer,
    ResultSerializer,
    StudentExamCardSerializer,
    StudentSerializer,
)

# File-upload submission limits. Uploaded files are never executed
# server-side - they are only stored for an admin to manually download,
# preview (text/code types) and grade.
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
ALLOWED_UPLOAD_EXTENSIONS = {
    '.c', '.h', '.cpp', '.hpp', '.cc', '.py', '.java', '.js', '.jsx', '.ts', '.tsx',
    '.go', '.rs', '.rb', '.php', '.cs', '.kt', '.swift', '.sql', '.sh', '.ipynb',
    '.html', '.css', '.json', '.xml', '.yaml', '.yml', '.md', '.txt',
    '.pdf', '.doc', '.docx', '.zip', '.tar', '.gz', '.rar',
}
TEXT_PREVIEW_EXTENSIONS = {
    '.c', '.h', '.cpp', '.hpp', '.cc', '.py', '.java', '.js', '.jsx', '.ts', '.tsx',
    '.go', '.rs', '.rb', '.php', '.cs', '.kt', '.swift', '.sql', '.sh', '.ipynb',
    '.html', '.css', '.json', '.xml', '.yaml', '.yml', '.md', '.txt',
}
MAX_PREVIEW_BYTES = 200 * 1024


def calculate_attempt_score(attempt):
    """
    Authoritative server-side score calculation.
    Maximum marks calculated using ONLY the questions assigned to this attempt.

    MCQ: Correct = question.marks, Incorrect/Unanswered = 0.
    FILE_UPLOAD: score is the sum of each task's admin-assigned manual_score
    (0 for tasks not yet graded), since code submissions can't be auto-scored.
    """
    attempt_qs = attempt.attempt_questions.select_related('question').all()
    if attempt_qs.exists():
        questions = [aq.question for aq in attempt_qs]
    else:
        # Fallback for legacy attempts
        questions = [eq.question for eq in attempt.exam.exam_questions.select_related('question').all()]

    max_score = sum(q.marks for q in questions)

    if attempt.exam.exam_type == 'FILE_UPLOAD':
        manual_scores = {aq.question_id: aq.manual_score for aq in attempt_qs}
        score = sum(manual_scores.get(q.id) or 0.0 for q in questions)
        percentage = round((score / max_score * 100), 2) if max_score > 0 else 0.0
        return float(score), float(max_score), percentage

    answers = {
        ans.question_id: ans.selected_option
        for ans in attempt.answers.select_related('selected_option').all()
    }

    score = 0.0
    for q in questions:
        selected_opt = answers.get(q.id)
        if selected_opt and selected_opt.is_correct:
            score += q.marks

    percentage = round((score / max_score * 100), 2) if max_score > 0 else 0.0
    return float(score), float(max_score), percentage


def auto_submit_attempt(attempt, reason='TIME_EXPIRED'):
    """
    Atomically auto-submits an in-progress exam attempt.
    """
    with transaction.atomic():
        locked_attempt = ExamAttempt.objects.select_for_update().get(id=attempt.id)
        if locked_attempt.status == 'IN_PROGRESS':
            score, max_score, percentage = calculate_attempt_score(locked_attempt)
            locked_attempt.score = score
            locked_attempt.max_score = max_score
            locked_attempt.percentage = percentage
            locked_attempt.status = 'AUTO_SUBMITTED'
            locked_attempt.submitted_at = timezone.now()
            locked_attempt.submission_reason = reason
            if locked_attempt.exam.exam_type == 'FILE_UPLOAD':
                locked_attempt.is_graded = False
            locked_attempt.save()
            return locked_attempt
    return locked_attempt


# ========================================================
# AUTHENTICATION VIEWS
# ========================================================

@api_view(['POST'])
@permission_classes([AllowAny])
def login_view(request):
    """
    Handles both Student and Admin login.
    Students use roll_number (or username) and password.
    Admins use username and password.
    """
    username = request.data.get('roll_number') or request.data.get('username')
    password = request.data.get('password')

    if not username or not password:
        return Response(
            {"error": "Please provide both username/roll number and password."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    # Standard Django authentication
    user = authenticate(request, username=username, password=password)
    if not user:
        return Response(
            {"error": "Invalid credentials."},
            status=status.HTTP_401_UNAUTHORIZED,
        )

    if not user.is_active:
        return Response(
            {"error": "Account is inactive."},
            status=status.HTTP_403_FORBIDDEN,
        )

    # Django session login
    django_login(request, user)

    # Token for REST API usage
    token, _ = Token.objects.get_or_create(user=user)

    if user.is_staff or user.is_superuser:
        user_data = {
            'id': user.id,
            'username': user.username,
            'full_name': user.get_full_name() or user.username,
            'role': 'ADMIN',
        }
        return Response({
            'token': token.key,
            'role': 'ADMIN',
            'user': user_data,
        })
    else:
        # Must have active student profile
        try:
            student = user.student_profile
        except Student.DoesNotExist:
            return Response(
                {"error": "No student profile associated with this account."},
                status=status.HTTP_403_FORBIDDEN,
            )

        if not student.active:
            return Response(
                {"error": "Student account has been deactivated."},
                status=status.HTTP_403_FORBIDDEN,
            )

        user_data = {
            'id': student.id,
            'roll_number': student.roll_number,
            'full_name': student.full_name,
            'role': 'STUDENT',
            'department': {
                'id': student.department.id,
                'name': student.department.name,
                'code': student.department.code,
            },
        }
        return Response({
            'token': token.key,
            'role': 'STUDENT',
            'user': user_data,
        })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def logout_view(request):
    """
    Logs out the user and clears tokens/sessions.
    """
    try:
        request.user.auth_token.delete()
    except Exception:
        pass
    django_logout(request)
    return Response({"message": "Successfully logged out."})


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def me_view(request):
    """
    Returns current authenticated user details and role.
    """
    user = request.user
    if user.is_staff or user.is_superuser:
        return Response({
            'id': user.id,
            'username': user.username,
            'full_name': user.get_full_name() or user.username,
            'role': 'ADMIN',
        })
    try:
        student = user.student_profile
        return Response({
            'id': student.id,
            'roll_number': student.roll_number,
            'full_name': student.full_name,
            'role': 'STUDENT',
            'department': {
                'id': student.department.id,
                'name': student.department.name,
                'code': student.department.code,
            },
        })
    except Student.DoesNotExist:
        return Response({"error": "Student profile not found."}, status=status.HTTP_404_NOT_FOUND)


# ========================================================
# STUDENT EXAM VIEWS
# ========================================================

@api_view(['GET'])
@permission_classes([IsStudentUser])
def student_exam_list(request):
    """
    List exams assigned to the student's department.
    """
    student = request.user.student_profile
    exams = Exam.objects.filter(
        exam_departments__department=student.department,
        is_active=True
    ).distinct().order_by('start_datetime')

    serializer = StudentExamCardSerializer(exams, many=True, context={'student': student})
    return Response({
        'server_time': timezone.now(),
        'exams': serializer.data,
    })


@api_view(['GET'])
@permission_classes([IsStudentUser])
def student_exam_detail(request, exam_id):
    """
    Get exam summary for the student.
    """
    student = request.user.student_profile
    try:
        exam = Exam.objects.get(id=exam_id, is_active=True)
    except Exam.DoesNotExist:
        return Response({"error": "Exam not found or inactive."}, status=status.HTTP_404_NOT_FOUND)

    # Check department eligibility
    if not exam.exam_departments.filter(department=student.department).exists():
        return Response({"error": "You are not eligible for this exam."}, status=status.HTTP_403_FORBIDDEN)

    serializer = StudentExamCardSerializer(exam, context={'student': student})
    return Response({
        'server_time': timezone.now(),
        'exam': serializer.data,
    })


@api_view(['POST'])
@permission_classes([IsStudentUser])
def student_start_exam(request, exam_id):
    """
    Starts an exam for the student.
    Server time is strictly authoritative.
    Enforces one attempt per student.
    """
    student = request.user.student_profile
    try:
        exam = Exam.objects.get(id=exam_id, is_active=True)
    except Exam.DoesNotExist:
        return Response({"error": "Exam not found or inactive."}, status=status.HTTP_404_NOT_FOUND)

    # 1. Department eligibility
    if not exam.exam_departments.filter(department=student.department).exists():
        return Response({"error": "You are not eligible for this exam."}, status=status.HTTP_403_FORBIDDEN)

    now = timezone.now()

    # 2. Server-side timing check
    if now < exam.start_datetime:
        return Response({"error": "Exam has not started."}, status=status.HTTP_400_BAD_REQUEST)

    if now > exam.end_datetime:
        return Response({"error": "Exam has ended."}, status=status.HTTP_400_BAD_REQUEST)

    # 3. Check existing attempt
    attempt = ExamAttempt.objects.filter(student=student, exam=exam).first()
    if attempt:
        if attempt.status in ['SUBMITTED', 'AUTO_SUBMITTED']:
            return Response({"error": "Your attempt has already been submitted."}, status=status.HTTP_400_BAD_REQUEST)

        # Attempt in progress: check if time has expired
        allowed_end = min(attempt.started_at + timedelta(minutes=exam.duration_minutes), exam.end_datetime)
        if now > allowed_end:
            auto_submit_attempt(attempt, reason='TIME_EXPIRED')
            return Response(
                {"error": "Your exam was automatically submitted because the exam time expired."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = ExamAttemptDetailSerializer(attempt)
        return Response(serializer.data)

    # 4. Create new attempt with randomized questions
    req_count = exam.questions_per_attempt or 30
    available_question_ids = list(
        ExamQuestion.objects.filter(exam=exam, question__is_active=True)
        .order_by('id')
        .values_list('question_id', flat=True)
    )

    if len(available_question_ids) < req_count:
        return Response(
            {"error": f"This exam does not have enough questions. At least {req_count} questions are required."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if len(available_question_ids) == req_count:
        selected_question_ids = available_question_ids
    else:
        selected_question_ids = random.sample(available_question_ids, req_count)

    try:
        with transaction.atomic():
            attempt = ExamAttempt.objects.create(
                student=student,
                exam=exam,
                status='IN_PROGRESS',
                started_at=now,
            )
            attempt_questions = [
                AttemptQuestion(
                    attempt=attempt,
                    question_id=qid,
                    question_order=idx
                )
                for idx, qid in enumerate(selected_question_ids, start=1)
            ]
            AttemptQuestion.objects.bulk_create(attempt_questions)
    except IntegrityError:
        # A concurrent request (e.g. a duplicate double-submit from the
        # client) already created the attempt for this student/exam pair.
        # Treat this the same as the "resume existing attempt" path above
        # instead of surfacing a 500 to a request that is, from the
        # student's perspective, not actually an error.
        attempt = ExamAttempt.objects.filter(student=student, exam=exam).first()
        if not attempt:
            raise
        serializer = ExamAttemptDetailSerializer(attempt)
        return Response(serializer.data)

    serializer = ExamAttemptDetailSerializer(attempt)
    return Response(serializer.data, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsStudentUser])
def student_attempt_detail(request, attempt_id):
    """
    Retrieves in-progress or completed attempt details.
    Prevents IDOR: only student owner can access.
    Automatically checks and enforces time limits.
    """
    student = request.user.student_profile
    try:
        attempt = ExamAttempt.objects.select_related('exam').get(id=attempt_id, student=student)
    except ExamAttempt.DoesNotExist:
        return Response({"error": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)

    # Check time limit if in progress
    if attempt.status == 'IN_PROGRESS':
        now = timezone.now()
        allowed_end = min(
            attempt.started_at + timedelta(minutes=attempt.exam.duration_minutes),
            attempt.exam.end_datetime
        )
        if now > allowed_end:
            attempt = auto_submit_attempt(attempt, reason='TIME_EXPIRED')

    serializer = ExamAttemptDetailSerializer(attempt)
    return Response(serializer.data)


@api_view(['POST', 'PUT', 'PATCH'])
@permission_classes([IsStudentUser])
def student_save_answer(request, attempt_id):
    """
    Autosaves an answer.
    Prevents modifications if attempt is submitted or time expired.
    Validates question belongs to this student's attempt.
    """
    student = request.user.student_profile
    try:
        attempt = ExamAttempt.objects.select_related('exam').get(id=attempt_id, student=student)
    except ExamAttempt.DoesNotExist:
        return Response({"error": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)

    if attempt.exam.exam_type != 'MCQ':
        return Response(
            {"error": "This exam uses file uploads. Use the file upload endpoint instead."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if attempt.status != 'IN_PROGRESS':
        return Response({"error": "Your attempt has already been submitted."}, status=status.HTTP_400_BAD_REQUEST)

    # Server time limit check
    now = timezone.now()
    allowed_end = min(
        attempt.started_at + timedelta(minutes=attempt.exam.duration_minutes),
        attempt.exam.end_datetime
    )
    if now > allowed_end:
        auto_submit_attempt(attempt, reason='TIME_EXPIRED')
        return Response(
            {"error": "Your exam was automatically submitted because the exam time expired."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    question_id = request.data.get('question_id')
    option_id = request.data.get('option_id')

    if not question_id:
        return Response({"error": "question_id is required."}, status=status.HTTP_400_BAD_REQUEST)

    # Verify question is assigned to this attempt
    if attempt.attempt_questions.exists():
        if not attempt.attempt_questions.filter(question_id=question_id).exists():
            return Response(
                {"error": "This question was not assigned to your exam attempt."},
                status=status.HTTP_400_BAD_REQUEST,
            )
    else:
        if not ExamQuestion.objects.filter(exam=attempt.exam, question_id=question_id).exists():
            return Response(
                {"error": "Question is not part of this exam."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    selected_option = None
    if option_id:
        try:
            selected_option = Option.objects.get(id=option_id, question_id=question_id)
        except Option.DoesNotExist:
            return Response({"error": "Invalid option selected."}, status=status.HTTP_400_BAD_REQUEST)

    answer, _ = StudentAnswer.objects.update_or_create(
        attempt=attempt,
        question_id=question_id,
        defaults={'selected_option': selected_option}
    )

    return Response({
        'success': True,
        'question_id': question_id,
        'selected_option_id': selected_option.id if selected_option else None,
        'selected_option_key': selected_option.option_key if selected_option else None,
        'answered_at': answer.answered_at,
    })


@api_view(['POST'])
@permission_classes([IsStudentUser])
def student_upload_submission_file(request, attempt_id):
    """
    Uploads (and replaces) the file(s) a student submits for one FILE_UPLOAD
    task. Re-uploading for the same task clears the previous files for it -
    each call represents the student's current full submission for that task.
    Files are stored as-is and never executed.
    """
    student = request.user.student_profile
    try:
        attempt = ExamAttempt.objects.select_related('exam').get(id=attempt_id, student=student)
    except ExamAttempt.DoesNotExist:
        return Response({"error": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)

    if attempt.exam.exam_type != 'FILE_UPLOAD':
        return Response({"error": "This exam does not accept file uploads."}, status=status.HTTP_400_BAD_REQUEST)

    if attempt.status != 'IN_PROGRESS':
        return Response({"error": "Your attempt has already been submitted."}, status=status.HTTP_400_BAD_REQUEST)

    now = timezone.now()
    allowed_end = min(
        attempt.started_at + timedelta(minutes=attempt.exam.duration_minutes),
        attempt.exam.end_datetime
    )
    if now > allowed_end:
        auto_submit_attempt(attempt, reason='TIME_EXPIRED')
        return Response(
            {"error": "Your exam was automatically submitted because the exam time expired."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    question_id = request.data.get('question_id')
    if not question_id:
        return Response({"error": "question_id is required."}, status=status.HTTP_400_BAD_REQUEST)

    if not attempt.attempt_questions.filter(question_id=question_id).exists():
        return Response(
            {"error": "This task was not assigned to your exam attempt."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    files = request.FILES.getlist('files')
    if not files:
        return Response({"error": "No files were provided."}, status=status.HTTP_400_BAD_REQUEST)

    total_size = sum(f.size for f in files)
    if total_size > MAX_UPLOAD_BYTES:
        return Response(
            {"error": "Total upload size exceeds the 50MB limit for this task."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    for f in files:
        ext = os.path.splitext(f.name)[1].lower()
        if ext not in ALLOWED_UPLOAD_EXTENSIONS:
            return Response(
                {"error": f"File type '{ext or 'unknown'}' is not allowed."},
                status=status.HTTP_400_BAD_REQUEST,
            )

    with transaction.atomic():
        old_files = list(SubmissionFile.objects.filter(attempt=attempt, question_id=question_id))
        for old in old_files:
            old.file.delete(save=False)
        SubmissionFile.objects.filter(attempt=attempt, question_id=question_id).delete()

        created = []
        for f in files:
            sf = SubmissionFile.objects.create(
                attempt=attempt,
                question_id=question_id,
                file=f,
                original_filename=f.name,
                file_size=f.size,
            )
            created.append(sf)

    return Response({
        'question_id': int(question_id),
        'files': [
            {'id': sf.id, 'filename': sf.original_filename, 'size': sf.file_size, 'uploaded_at': sf.uploaded_at}
            for sf in created
        ],
    }, status=status.HTTP_201_CREATED)


@api_view(['DELETE'])
@permission_classes([IsStudentUser])
def student_delete_submission_file(request, attempt_id, file_id):
    """
    Lets a student remove a single wrongly-uploaded file before submitting.
    """
    student = request.user.student_profile
    try:
        attempt = ExamAttempt.objects.get(id=attempt_id, student=student)
    except ExamAttempt.DoesNotExist:
        return Response({"error": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)

    if attempt.status != 'IN_PROGRESS':
        return Response({"error": "Your attempt has already been submitted."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        sf = SubmissionFile.objects.get(id=file_id, attempt=attempt)
    except SubmissionFile.DoesNotExist:
        return Response({"error": "File not found."}, status=status.HTTP_404_NOT_FOUND)

    sf.file.delete(save=False)
    sf.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


@api_view(['GET'])
@permission_classes([IsStudentUser])
def student_download_submission_file(request, attempt_id, file_id):
    """
    Lets a student re-download a file they previously uploaded, to confirm
    the right version was submitted.
    """
    student = request.user.student_profile
    try:
        attempt = ExamAttempt.objects.get(id=attempt_id, student=student)
    except ExamAttempt.DoesNotExist:
        return Response({"error": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)

    try:
        sf = SubmissionFile.objects.get(id=file_id, attempt=attempt)
    except SubmissionFile.DoesNotExist:
        return Response({"error": "File not found."}, status=status.HTTP_404_NOT_FOUND)

    return FileResponse(sf.file.open('rb'), as_attachment=True, filename=sf.original_filename)


@api_view(['POST'])
@permission_classes([IsStudentUser])
def student_submit_exam(request, attempt_id):
    """
    Submits the exam and computes score atomically.
    Once submitted, answers cannot be modified.
    """
    student = request.user.student_profile
    try:
        attempt = ExamAttempt.objects.select_related('exam').get(id=attempt_id, student=student)
    except ExamAttempt.DoesNotExist:
        return Response({"error": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)

    if attempt.status != 'IN_PROGRESS':
        return Response({"error": "Your attempt has already been submitted."}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        locked_attempt = ExamAttempt.objects.select_for_update().get(id=attempt.id)
        if locked_attempt.status != 'IN_PROGRESS':
            return Response({"error": "Your attempt has already been submitted."}, status=status.HTTP_400_BAD_REQUEST)

        score, max_score, percentage = calculate_attempt_score(locked_attempt)
        locked_attempt.score = score
        locked_attempt.max_score = max_score
        locked_attempt.percentage = percentage
        locked_attempt.status = 'SUBMITTED'
        locked_attempt.submitted_at = timezone.now()
        locked_attempt.submission_reason = 'NORMAL'
        if locked_attempt.exam.exam_type == 'FILE_UPLOAD':
            locked_attempt.is_graded = False
        locked_attempt.save()

    return Response({
        'success': True,
        'status': locked_attempt.status,
        'score': locked_attempt.score,
        'max_score': locked_attempt.max_score,
        'percentage': locked_attempt.percentage,
        'is_graded': locked_attempt.is_graded,
        'submitted_at': locked_attempt.submitted_at,
    })


@api_view(['POST'])
@permission_classes([IsStudentUser])
def student_record_violation(request, attempt_id):
    """
    Records an integrity violation (window blur, tab switch, or fullscreen exit).
    Backend increments authoritative violation_count.
    After 5 violations, the exam is automatically submitted.
    """
    student = request.user.student_profile
    try:
        attempt = ExamAttempt.objects.select_related('exam').get(id=attempt_id, student=student)
    except ExamAttempt.DoesNotExist:
        return Response({"error": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)

    if attempt.exam.exam_type != 'MCQ':
        return Response(
            {"error": "This exam does not track integrity violations."},
            status=status.HTTP_400_BAD_REQUEST,
        )

    if attempt.status != 'IN_PROGRESS':
        return Response({"error": "Exam is not in progress."}, status=status.HTTP_400_BAD_REQUEST)

    with transaction.atomic():
        locked_attempt = ExamAttempt.objects.select_for_update().get(id=attempt.id)
        if locked_attempt.status != 'IN_PROGRESS':
            return Response({"error": "Exam is not in progress."}, status=status.HTTP_400_BAD_REQUEST)

        locked_attempt.violation_count += 1

        if locked_attempt.violation_count >= 5:
            score, max_score, percentage = calculate_attempt_score(locked_attempt)
            locked_attempt.score = score
            locked_attempt.max_score = max_score
            locked_attempt.percentage = percentage
            locked_attempt.status = 'AUTO_SUBMITTED'
            locked_attempt.submitted_at = timezone.now()
            locked_attempt.submission_reason = 'EXAM_INTEGRITY_VIOLATION'
            if locked_attempt.exam.exam_type == 'FILE_UPLOAD':
                locked_attempt.is_graded = False
            locked_attempt.save()

            return Response({
                'violation_count': locked_attempt.violation_count,
                'auto_submitted': True,
                'status': 'AUTO_SUBMITTED',
                'message': 'Your exam was automatically submitted because the maximum number of integrity violations was reached.',
            })
        else:
            locked_attempt.save(update_fields=['violation_count'])
            return Response({
                'violation_count': locked_attempt.violation_count,
                'auto_submitted': False,
                'message': 'Warning: Leaving the exam window has been detected. This activity is recorded.',
            })


@api_view(['GET'])
@permission_classes([IsStudentUser])
def student_results(request):
    """
    Returns only the authenticated student's results.
    Strictly isolated - IDOR protected.
    """
    student = request.user.student_profile
    attempts = ExamAttempt.objects.filter(
        student=student,
        status__in=['SUBMITTED', 'AUTO_SUBMITTED']
    ).select_related('exam').order_by('-submitted_at')

    serializer = ResultSerializer(attempts, many=True)
    return Response(serializer.data)


# ========================================================
# ADMIN VIEWS
# ========================================================

@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_dashboard_stats(request):
    """
    Provides real stats from the SQLite database.
    """
    total_students = Student.objects.count()
    cs_students = Student.objects.filter(department__code='CS').count()
    iot_students = Student.objects.filter(department__code='IOT').count()
    total_exams = Exam.objects.count()
    active_exams = Exam.objects.filter(is_active=True).count()
    total_attempts = ExamAttempt.objects.count()
    submitted_attempts = ExamAttempt.objects.filter(status__in=['SUBMITTED', 'AUTO_SUBMITTED']).count()

    return Response({
        'total_students': total_students,
        'cs_students': cs_students,
        'iot_students': iot_students,
        'total_exams': total_exams,
        'active_exams': active_exams,
        'total_attempts': total_attempts,
        'submitted_attempts': submitted_attempts,
    })


@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_departments_list(request):
    """
    List all departments for dropdowns.
    """
    departments = Department.objects.all().order_by('code')
    serializer = DepartmentSerializer(departments, many=True)
    return Response(serializer.data)


class StandardResultsSetPagination(PageNumberPagination):
    page_size = 25
    page_size_query_param = 'page_size'
    max_page_size = 100


@api_view(['GET', 'PATCH'])
@permission_classes([IsAdminUser])
def admin_students_view(request, student_id=None):
    """
    List students with search and department filtering, or toggle active status.
    """
    if request.method == 'PATCH' and student_id:
        try:
            student = Student.objects.get(id=student_id)
        except Student.DoesNotExist:
            return Response({"error": "Student not found."}, status=status.HTTP_404_NOT_FOUND)

        if 'active' in request.data:
            student.active = bool(request.data['active'])
            student.save()
            # Also toggle the user account active
            student.user.is_active = student.active
            student.user.save()

        serializer = StudentSerializer(student)
        return Response(serializer.data)

    # GET listing
    queryset = Student.objects.select_related('department').order_by('roll_number')

    dept = request.query_params.get('department')
    if dept:
        if dept.isdigit():
            queryset = queryset.filter(department_id=dept)
        else:
            queryset = queryset.filter(department__code__iexact=dept)

    search = request.query_params.get('search')
    if search:
        queryset = queryset.filter(
            models.Q(roll_number__icontains=search) | models.Q(full_name__icontains=search)
        )

    paginator = StandardResultsSetPagination()
    page = paginator.paginate_queryset(queryset, request)
    if page is not None:
        serializer = StudentSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)

    serializer = StudentSerializer(queryset, many=True)
    return Response(serializer.data)


class AdminQuestionViewSet(viewsets.ModelViewSet):
    queryset = Question.objects.all().prefetch_related('options').order_by('-id')
    serializer_class = AdminQuestionSerializer
    permission_classes = [IsAdminUser]

    def get_queryset(self):
        qs = super().get_queryset()
        category = self.request.query_params.get('category')
        if category:
            qs = qs.filter(category__iexact=category)
        difficulty = self.request.query_params.get('difficulty')
        if difficulty:
            qs = qs.filter(difficulty__iexact=difficulty)
        search = self.request.query_params.get('search')
        if search:
            qs = qs.filter(question_text__icontains=search)
        return qs


class AdminExamViewSet(viewsets.ModelViewSet):
    queryset = Exam.objects.all().prefetch_related(
        'exam_departments__department',
        'exam_questions__question__options'
    ).order_by('-start_datetime')
    serializer_class = AdminExamSerializer
    permission_classes = [IsAdminUser]


@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_results_view(request):
    """
    List results with filters, and optional CSV export.
    """
    queryset = ExamAttempt.objects.filter(
        status__in=['SUBMITTED', 'AUTO_SUBMITTED']
    ).select_related('student', 'student__department', 'exam').order_by('-submitted_at')

    exam_id = request.query_params.get('exam_id')
    if exam_id:
        queryset = queryset.filter(exam_id=exam_id)

    dept_id = request.query_params.get('department_id')
    if dept_id:
        queryset = queryset.filter(student__department_id=dept_id)

    search = request.query_params.get('search')
    if search:
        queryset = queryset.filter(
            models.Q(student__roll_number__icontains=search) |
            models.Q(student__full_name__icontains=search)
        )

    if request.query_params.get('pending_review') == 'true':
        queryset = queryset.filter(exam__exam_type='FILE_UPLOAD', is_graded=False)

    # Check for CSV export request
    if request.query_params.get('export') == 'csv' or request.query_params.get('format') == 'csv':
        response = HttpResponse(content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="exam_results.csv"'
        writer = csv.writer(response)
        writer.writerow([
            'Roll Number',
            'Student Name',
            'Department',
            'Exam Title',
            'Score',
            'Max Marks',
            'Percentage (%)',
            'Status',
            'Violations',
            'Reason',
            'Started At',
            'Submitted At',
        ])
        for att in queryset:
            writer.writerow([
                att.student.roll_number,
                att.student.full_name,
                att.student.department.name,
                att.exam.title,
                att.score,
                att.max_score,
                f"{att.percentage}%",
                att.status,
                att.violation_count,
                att.submission_reason,
                att.started_at.strftime("%Y-%m-%d %H:%M:%S") if att.started_at else '',
                att.submitted_at.strftime("%Y-%m-%d %H:%M:%S") if att.submitted_at else '',
            ])
        return response

    paginator = StandardResultsSetPagination()
    page = paginator.paginate_queryset(queryset, request)
    if page is not None:
        serializer = ResultSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)

    serializer = ResultSerializer(queryset, many=True)
    return Response(serializer.data)


@api_view(['GET', 'POST'])
@permission_classes([IsAdminUser])
def admin_grading_view(request, attempt_id):
    """
    GET: returns a submitted FILE_UPLOAD attempt's tasks, each with its
    uploaded files and current grading state, for the admin review screen.
    POST: saves per-task scores/feedback (body: {"grades": [{"question_id",
    "score", "feedback"}, ...]}), recomputes the attempt's total score, and
    marks the attempt fully graded once every task has been scored.
    """
    try:
        attempt = ExamAttempt.objects.select_related(
            'exam', 'student', 'student__department'
        ).get(id=attempt_id)
    except ExamAttempt.DoesNotExist:
        return Response({"error": "Attempt not found."}, status=status.HTTP_404_NOT_FOUND)

    if attempt.exam.exam_type != 'FILE_UPLOAD':
        return Response({"error": "This exam does not use manual grading."}, status=status.HTTP_400_BAD_REQUEST)

    if attempt.status not in ['SUBMITTED', 'AUTO_SUBMITTED']:
        return Response({"error": "This attempt has not been submitted yet."}, status=status.HTTP_400_BAD_REQUEST)

    if request.method == 'POST':
        grades = request.data.get('grades', [])
        aq_by_qid = {aq.question_id: aq for aq in attempt.attempt_questions.select_related('question').all()}

        for g in grades:
            qid = g.get('question_id')
            aq = aq_by_qid.get(qid)
            if not aq:
                continue
            score_val = g.get('score')
            if score_val is None or score_val == '':
                continue
            try:
                score_val = float(score_val)
            except (TypeError, ValueError):
                return Response({"error": f"Invalid score for question {qid}."}, status=status.HTTP_400_BAD_REQUEST)
            if score_val < 0 or score_val > aq.question.marks:
                return Response(
                    {"error": f"Score for question {qid} must be between 0 and {aq.question.marks}."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            aq.manual_score = score_val
            aq.feedback = g.get('feedback', aq.feedback) or ''
            aq.graded_at = timezone.now()
            aq.graded_by = request.user
            aq.save()

        score, max_score, percentage = calculate_attempt_score(attempt)
        attempt.score = score
        attempt.max_score = max_score
        attempt.percentage = percentage
        attempt.is_graded = all(
            aq.graded_at is not None for aq in attempt.attempt_questions.all()
        )
        attempt.save()

    attempt_questions = attempt.attempt_questions.select_related('question').order_by('question_order')
    files_by_qid = {}
    for f in attempt.submission_files.select_related('question').order_by('uploaded_at'):
        files_by_qid.setdefault(f.question_id, []).append(f)

    tasks = []
    for aq in attempt_questions:
        q = aq.question
        tasks.append({
            'question_id': q.id,
            'question_text': q.question_text,
            'marks': q.marks,
            'instructions': q.explanation,
            'files': [
                {'id': f.id, 'filename': f.original_filename, 'size': f.file_size, 'uploaded_at': f.uploaded_at}
                for f in files_by_qid.get(q.id, [])
            ],
            'manual_score': aq.manual_score,
            'feedback': aq.feedback,
            'graded': aq.graded_at is not None,
        })

    return Response({
        'attempt_id': attempt.id,
        'exam_title': attempt.exam.title,
        'roll_number': attempt.student.roll_number,
        'student_name': attempt.student.full_name,
        'department_name': attempt.student.department.name,
        'status': attempt.status,
        'is_graded': attempt.is_graded,
        'score': attempt.score,
        'max_score': attempt.max_score,
        'percentage': attempt.percentage,
        'submitted_at': attempt.submitted_at,
        'tasks': tasks,
    })


@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_file_preview(request, file_id):
    """
    Returns inline text content for code/text submission files so the
    grading UI can render them without a download. Non-text files report
    previewable=False so the UI falls back to a download link.
    """
    try:
        sf = SubmissionFile.objects.get(id=file_id)
    except SubmissionFile.DoesNotExist:
        return Response({"error": "File not found."}, status=status.HTTP_404_NOT_FOUND)

    ext = os.path.splitext(sf.original_filename)[1].lower()
    if ext not in TEXT_PREVIEW_EXTENSIONS:
        return Response({'previewable': False, 'filename': sf.original_filename})

    try:
        with sf.file.open('rb') as fh:
            raw = fh.read(MAX_PREVIEW_BYTES + 1)
        truncated = len(raw) > MAX_PREVIEW_BYTES
        text = raw[:MAX_PREVIEW_BYTES].decode('utf-8', errors='replace')
        return Response({
            'previewable': True,
            'filename': sf.original_filename,
            'content': text,
            'truncated': truncated,
        })
    except OSError:
        return Response({'previewable': False, 'filename': sf.original_filename})


@api_view(['GET'])
@permission_classes([IsAdminUser])
def admin_file_download(request, file_id):
    """
    Downloads a student's submission file for admin review.
    """
    try:
        sf = SubmissionFile.objects.get(id=file_id)
    except SubmissionFile.DoesNotExist:
        return Response({"error": "File not found."}, status=status.HTTP_404_NOT_FOUND)

    return FileResponse(sf.file.open('rb'), as_attachment=True, filename=sf.original_filename)
