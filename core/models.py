from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone


class Department(models.Model):
    name = models.CharField(max_length=100)
    code = models.CharField(max_length=20, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.code})"


class Student(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='student_profile')
    roll_number = models.CharField(max_length=50, unique=True, db_index=True)
    full_name = models.CharField(max_length=150)
    department = models.ForeignKey(Department, on_delete=models.CASCADE, related_name='students')
    email = models.EmailField(blank=True, default='')
    active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.roll_number} - {self.full_name}"


class Exam(models.Model):
    EXAM_TYPE_CHOICES = (
        ('MCQ', 'Multiple Choice'),
        ('FILE_UPLOAD', 'File Upload'),
    )
    title = models.CharField(max_length=255)
    description = models.TextField(blank=True, default='')
    exam_type = models.CharField(max_length=20, choices=EXAM_TYPE_CHOICES, default='MCQ')
    duration_minutes = models.PositiveIntegerField(help_text="Duration in minutes")
    questions_per_attempt = models.PositiveIntegerField(default=30, help_text="Number of questions randomly selected per attempt")
    start_datetime = models.DateTimeField()
    end_datetime = models.DateTimeField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return self.title


class ExamDepartment(models.Model):
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name='exam_departments')
    department = models.ForeignKey(Department, on_delete=models.CASCADE, related_name='department_exams')

    class Meta:
        unique_together = ('exam', 'department')

    def __str__(self):
        return f"{self.exam.title} - {self.department.code}"


class Question(models.Model):
    QUESTION_TYPE_CHOICES = (
        ('MCQ', 'Multiple Choice'),
        ('FILE_UPLOAD', 'File Upload'),
    )
    source_id = models.CharField(max_length=50, blank=True, default='', db_index=True)
    question_type = models.CharField(max_length=20, choices=QUESTION_TYPE_CHOICES, default='MCQ')
    question_text = models.TextField()
    marks = models.PositiveIntegerField(default=1)
    category = models.CharField(max_length=100, blank=True, default='')
    difficulty = models.CharField(max_length=50, blank=True, default='Medium')
    explanation = models.TextField(blank=True, default='', help_text="For MCQ: answer explanation. For File Upload: grading instructions shown to the admin reviewer.")
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        prefix = f"[{self.source_id}] " if self.source_id else ""
        return f"{prefix}{self.question_text[:50]}"


class Option(models.Model):
    OPTION_KEYS = (
        ('A', 'A'),
        ('B', 'B'),
        ('C', 'C'),
        ('D', 'D'),
    )
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name='options')
    option_key = models.CharField(max_length=1, choices=OPTION_KEYS)
    option_text = models.TextField()
    is_correct = models.BooleanField(default=False)

    class Meta:
        unique_together = ('question', 'option_key')
        ordering = ['option_key']

    def __str__(self):
        return f"{self.question_id} - {self.option_key}: {self.option_text[:30]}"


class ExamQuestion(models.Model):
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name='exam_questions')
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name='exam_questions')
    order = models.PositiveIntegerField(default=1)

    class Meta:
        unique_together = ('exam', 'question')
        ordering = ['order', 'id']

    def __str__(self):
        return f"{self.exam.title} - Q{self.order}: {self.question_id}"


class ExamAttempt(models.Model):
    STATUS_CHOICES = (
        ('NOT_STARTED', 'Not Started'),
        ('IN_PROGRESS', 'In Progress'),
        ('SUBMITTED', 'Submitted'),
        ('AUTO_SUBMITTED', 'Auto Submitted'),
    )
    REASON_CHOICES = (
        ('NORMAL', 'Normal Submission'),
        ('TIME_EXPIRED', 'Time Expired'),
        ('EXAM_INTEGRITY_VIOLATION', 'Exam Integrity Violation'),
    )
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='attempts')
    exam = models.ForeignKey(Exam, on_delete=models.CASCADE, related_name='attempts')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='NOT_STARTED')
    started_at = models.DateTimeField()
    submitted_at = models.DateTimeField(null=True, blank=True)
    score = models.FloatField(default=0.0)
    max_score = models.FloatField(default=0.0)
    percentage = models.FloatField(default=0.0)
    violation_count = models.PositiveIntegerField(default=0)
    submission_reason = models.CharField(max_length=50, choices=REASON_CHOICES, default='NORMAL')
    # True for MCQ attempts (auto-scored) and for FILE_UPLOAD attempts once an
    # admin has manually graded every task. False while a file-upload
    # submission is awaiting review.
    is_graded = models.BooleanField(default=True)

    class Meta:
        unique_together = ('student', 'exam')

    def __str__(self):
        return f"{self.student.roll_number} - {self.exam.title} ({self.status})"


class StudentAnswer(models.Model):
    attempt = models.ForeignKey(ExamAttempt, on_delete=models.CASCADE, related_name='answers')
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name='student_answers')
    selected_option = models.ForeignKey(Option, on_delete=models.SET_NULL, null=True, blank=True)
    answered_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('attempt', 'question')

    def __str__(self):
        return f"Attempt {self.attempt_id} - Q{self.question_id}: {self.selected_option_id}"


class AttemptQuestion(models.Model):
    attempt = models.ForeignKey(ExamAttempt, on_delete=models.CASCADE, related_name='attempt_questions')
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name='attempt_questions')
    question_order = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    # Manual grading fields - only used for FILE_UPLOAD exam tasks.
    manual_score = models.FloatField(null=True, blank=True)
    feedback = models.TextField(blank=True, default='')
    graded_at = models.DateTimeField(null=True, blank=True)
    graded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='graded_tasks')

    class Meta:
        unique_together = (('attempt', 'question'), ('attempt', 'question_order'))
        ordering = ['question_order', 'id']

    def __str__(self):
        return f"Attempt {self.attempt_id} - Q{self.question_order}: {self.question_id}"


def submission_file_path(instance, filename):
    return f"submissions/exam_{instance.attempt.exam_id}/attempt_{instance.attempt_id}/question_{instance.question_id}/{filename}"


class SubmissionFile(models.Model):
    """
    A file a student uploaded as their answer to a FILE_UPLOAD task. Never
    executed server-side - admins review/download these manually.
    """
    attempt = models.ForeignKey(ExamAttempt, on_delete=models.CASCADE, related_name='submission_files')
    question = models.ForeignKey(Question, on_delete=models.CASCADE, related_name='submission_files')
    file = models.FileField(upload_to=submission_file_path, max_length=500)
    original_filename = models.CharField(max_length=255)
    file_size = models.PositiveIntegerField(default=0)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['uploaded_at']

    def __str__(self):
        return f"Attempt {self.attempt_id} - Q{self.question_id}: {self.original_filename}"
