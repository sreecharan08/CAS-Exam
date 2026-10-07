from rest_framework import serializers
from django.contrib.auth.models import User
from django.utils import timezone
from datetime import timedelta
from .models import (
    Department,
    Student,
    Exam,
    ExamDepartment,
    Question,
    Option,
    ExamQuestion,
    ExamAttempt,
    StudentAnswer,
)


class DepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ['id', 'name', 'code', 'created_at']


class StudentSerializer(serializers.ModelSerializer):
    department_name = serializers.CharField(source='department.name', read_only=True)
    department_code = serializers.CharField(source='department.code', read_only=True)

    class Meta:
        model = Student
        fields = [
            'id',
            'roll_number',
            'full_name',
            'department',
            'department_name',
            'department_code',
            'email',
            'active',
            'created_at',
            'updated_at',
        ]


# ========================================================
# QUESTION & OPTION SERIALIZERS
# ========================================================

class StudentOptionSerializer(serializers.ModelSerializer):
    """
    NEVER contains is_correct or any indicator of the correct answer!
    """
    class Meta:
        model = Option
        fields = ['id', 'option_key', 'option_text']


class StudentQuestionSerializer(serializers.ModelSerializer):
    """
    Used for students taking an exam. Never includes correct answers.
    """
    options = serializers.SerializerMethodField()
    order = serializers.IntegerField(default=1, read_only=True)

    class Meta:
        model = Question
        fields = ['id', 'question_text', 'marks', 'category', 'difficulty', 'options', 'order']

    def get_options(self, obj):
        options = obj.options.all().order_by('option_key')
        return StudentOptionSerializer(options, many=True).data


class AdminOptionSerializer(serializers.ModelSerializer):
    id = serializers.IntegerField(required=False)

    class Meta:
        model = Option
        fields = ['id', 'option_key', 'option_text', 'is_correct']


class AdminQuestionSerializer(serializers.ModelSerializer):
    options = AdminOptionSerializer(many=True)

    class Meta:
        model = Question
        fields = [
            'id',
            'source_id',
            'question_text',
            'marks',
            'category',
            'difficulty',
            'explanation',
            'is_active',
            'options',
            'created_at',
            'updated_at',
        ]

    def validate_options(self, options_data):
        if len(options_data) != 4:
            raise serializers.ValidationError("Each question must have exactly 4 options (A, B, C, D).")
        keys = set(opt.get('option_key', '').upper() for opt in options_data)
        if keys != {'A', 'B', 'C', 'D'}:
            raise serializers.ValidationError("Options must correspond to keys A, B, C, and D.")
        correct_count = sum(1 for opt in options_data if opt.get('is_correct', False))
        if correct_count != 1:
            raise serializers.ValidationError("Exactly one option must be marked as correct.")
        return options_data

    def create(self, validated_data):
        options_data = validated_data.pop('options')
        question = Question.objects.create(**validated_data)
        for opt_data in options_data:
            opt_data.pop('id', None)
            Option.objects.create(question=question, **opt_data)
        return question

    def update(self, instance, validated_data):
        options_data = validated_data.pop('options', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if options_data is not None:
            # Update or create options
            existing_options = {opt.option_key: opt for opt in instance.options.all()}
            for opt_data in options_data:
                key = opt_data.get('option_key')
                if key in existing_options:
                    opt = existing_options[key]
                    opt.option_text = opt_data.get('option_text', opt.option_text)
                    opt.is_correct = opt_data.get('is_correct', opt.is_correct)
                    opt.save()
                else:
                    opt_data.pop('id', None)
                    Option.objects.create(question=instance, **opt_data)
        return instance


# ========================================================
# EXAM SERIALIZERS
# ========================================================

class AdminExamSerializer(serializers.ModelSerializer):
    departments = serializers.PrimaryKeyRelatedField(
        many=True, queryset=Department.objects.all(), write_only=True
    )
    department_details = DepartmentSerializer(source='exam_departments.department', many=True, read_only=True)
    department_ids = serializers.SerializerMethodField()
    questions = serializers.ListField(
        child=serializers.DictField(), write_only=True, required=False
    )
    question_count = serializers.SerializerMethodField()
    question_pool_size = serializers.SerializerMethodField()
    total_marks = serializers.SerializerMethodField()
    exam_questions = serializers.SerializerMethodField()

    class Meta:
        model = Exam
        fields = [
            'id',
            'title',
            'description',
            'duration_minutes',
            'questions_per_attempt',
            'start_datetime',
            'end_datetime',
            'is_active',
            'departments',
            'department_details',
            'department_ids',
            'questions',
            'question_count',
            'question_pool_size',
            'total_marks',
            'exam_questions',
            'created_at',
            'updated_at',
        ]

    def get_department_ids(self, obj):
        return list(obj.exam_departments.values_list('department_id', flat=True))

    def get_question_count(self, obj):
        return obj.exam_questions.count()

    def get_question_pool_size(self, obj):
        return obj.exam_questions.count()

    def get_total_marks(self, obj):
        return sum(eq.question.marks for eq in obj.exam_questions.select_related('question').all())

    def get_exam_questions(self, obj):
        eqs = obj.exam_questions.select_related('question').prefetch_related('question__options').order_by('order', 'id')
        result = []
        for eq in eqs:
            q_data = AdminQuestionSerializer(eq.question).data
            q_data['order'] = eq.order
            q_data['exam_question_id'] = eq.id
            result.append(q_data)
        return result

    def validate(self, data):
        start = data.get('start_datetime', self.instance.start_datetime if self.instance else None)
        end = data.get('end_datetime', self.instance.end_datetime if self.instance else None)
        if start and end and start >= end:
            raise serializers.ValidationError({"end_datetime": "End datetime must be after start datetime."})

        questions_per_attempt = data.get(
            'questions_per_attempt',
            self.instance.questions_per_attempt if self.instance else None
        )
        if 'questions' in data:
            pool_size = len(data['questions'])
        elif self.instance:
            pool_size = self.instance.exam_questions.count()
        else:
            pool_size = 0

        if questions_per_attempt and pool_size < questions_per_attempt:
            raise serializers.ValidationError({
                "questions": f"Assigned question pool size ({pool_size}) must be at least the questions per attempt ({questions_per_attempt})."
            })

        return data

    def create(self, validated_data):
        departments = validated_data.pop('departments', [])
        questions_data = validated_data.pop('questions', [])
        exam = Exam.objects.create(**validated_data)
        for dept in departments:
            ExamDepartment.objects.create(exam=exam, department=dept)
        for idx, q_info in enumerate(questions_data, start=1):
            q_id = q_info if isinstance(q_info, int) else q_info.get('id')
            order = q_info.get('order', idx) if isinstance(q_info, dict) else idx
            try:
                question = Question.objects.get(id=q_id)
                ExamQuestion.objects.create(exam=exam, question=question, order=order)
            except Question.DoesNotExist:
                continue
        return exam

    def update(self, instance, validated_data):
        departments = validated_data.pop('departments', None)
        questions_data = validated_data.pop('questions', None)
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()

        if departments is not None:
            instance.exam_departments.all().delete()
            for dept in departments:
                ExamDepartment.objects.create(exam=instance, department=dept)

        if questions_data is not None:
            instance.exam_questions.all().delete()
            for idx, q_info in enumerate(questions_data, start=1):
                q_id = q_info if isinstance(q_info, int) else q_info.get('id')
                order = q_info.get('order', idx) if isinstance(q_info, dict) else idx
                try:
                    question = Question.objects.get(id=q_id)
                    ExamQuestion.objects.create(exam=instance, question=question, order=order)
                except Question.DoesNotExist:
                    continue
        return instance


# ========================================================
# STUDENT EXAM & ATTEMPT SERIALIZERS
# ========================================================

class StudentExamCardSerializer(serializers.ModelSerializer):
    status = serializers.SerializerMethodField()
    has_attempted = serializers.SerializerMethodField()
    attempt_id = serializers.SerializerMethodField()
    attempt_status = serializers.SerializerMethodField()
    score = serializers.SerializerMethodField()
    max_score = serializers.SerializerMethodField()
    percentage = serializers.SerializerMethodField()
    question_count = serializers.SerializerMethodField()
    total_marks = serializers.SerializerMethodField()

    class Meta:
        model = Exam
        fields = [
            'id',
            'title',
            'description',
            'duration_minutes',
            'start_datetime',
            'end_datetime',
            'status',
            'has_attempted',
            'attempt_id',
            'attempt_status',
            'score',
            'max_score',
            'percentage',
            'question_count',
            'total_marks',
        ]

    def _get_attempt(self, obj):
        student = self.context.get('student')
        if not student:
            return None
        if not hasattr(obj, '_cached_attempt'):
            obj._cached_attempt = obj.attempts.filter(student=student).first()
        return obj._cached_attempt

    def get_attempt_id(self, obj):
        att = self._get_attempt(obj)
        return att.id if att else None

    def get_attempt_status(self, obj):
        att = self._get_attempt(obj)
        return att.status if att else None

    def get_has_attempted(self, obj):
        att = self._get_attempt(obj)
        return att is not None and att.status in ['SUBMITTED', 'AUTO_SUBMITTED']

    def get_score(self, obj):
        att = self._get_attempt(obj)
        return att.score if att and att.status in ['SUBMITTED', 'AUTO_SUBMITTED'] else None

    def get_max_score(self, obj):
        att = self._get_attempt(obj)
        return att.max_score if att and att.status in ['SUBMITTED', 'AUTO_SUBMITTED'] else None

    def get_percentage(self, obj):
        att = self._get_attempt(obj)
        return att.percentage if att and att.status in ['SUBMITTED', 'AUTO_SUBMITTED'] else None

    def get_question_count(self, obj):
        att = self._get_attempt(obj)
        if att and att.attempt_questions.exists():
            return att.attempt_questions.count()
        pool_count = obj.exam_questions.count()
        return min(obj.questions_per_attempt, pool_count) if obj.questions_per_attempt else pool_count

    def get_total_marks(self, obj):
        att = self._get_attempt(obj)
        if att and att.attempt_questions.exists():
            return sum(aq.question.marks for aq in att.attempt_questions.select_related('question').all())
        pool_qs = obj.exam_questions.select_related('question').all()
        target = min(obj.questions_per_attempt, pool_qs.count()) if obj.questions_per_attempt else pool_qs.count()
        return sum(eq.question.marks for eq in pool_qs[:target])

    def get_status(self, obj):
        student = self.context.get('student')
        att = self._get_attempt(obj)
        if att:
            if att.status in ['SUBMITTED', 'AUTO_SUBMITTED']:
                return 'COMPLETED'
            if att.status == 'IN_PROGRESS':
                # Check if time expired
                now = timezone.now()
                allowed_end = min(att.started_at + timedelta(minutes=obj.duration_minutes), obj.end_datetime)
                if now > allowed_end:
                    return 'COMPLETED'
                return 'IN_PROGRESS'

        # No attempt yet
        now = timezone.now()
        # Department check
        if student and not obj.exam_departments.filter(department=student.department).exists():
            return 'NOT_ELIGIBLE'

        if not obj.is_active:
            return 'NOT_ELIGIBLE'

        if now < obj.start_datetime:
            return 'UPCOMING'
        elif now > obj.end_datetime:
            return 'COMPLETED'
        else:
            return 'AVAILABLE'


class StudentAnswerSerializer(serializers.ModelSerializer):
    selected_option_key = serializers.CharField(source='selected_option.option_key', read_only=True)

    class Meta:
        model = StudentAnswer
        fields = ['question', 'selected_option', 'selected_option_key', 'answered_at']


class ExamAttemptDetailSerializer(serializers.ModelSerializer):
    exam_id = serializers.IntegerField(source='exam.id', read_only=True)
    exam_title = serializers.CharField(source='exam.title', read_only=True)
    exam_description = serializers.CharField(source='exam.description', read_only=True)
    duration_minutes = serializers.IntegerField(source='exam.duration_minutes', read_only=True)
    end_datetime = serializers.DateTimeField(source='exam.end_datetime', read_only=True)
    remaining_seconds = serializers.SerializerMethodField()
    questions = serializers.SerializerMethodField()
    answers = serializers.SerializerMethodField()
    server_time = serializers.SerializerMethodField()
    question_count = serializers.SerializerMethodField()
    max_score = serializers.SerializerMethodField()
    total_marks = serializers.SerializerMethodField()

    class Meta:
        model = ExamAttempt
        fields = [
            'id',
            'exam_id',
            'exam_title',
            'exam_description',
            'duration_minutes',
            'end_datetime',
            'status',
            'started_at',
            'submitted_at',
            'score',
            'max_score',
            'total_marks',
            'percentage',
            'violation_count',
            'submission_reason',
            'remaining_seconds',
            'question_count',
            'questions',
            'answers',
            'server_time',
        ]

    def get_server_time(self, obj):
        return timezone.now()

    def get_remaining_seconds(self, obj):
        if obj.status in ['SUBMITTED', 'AUTO_SUBMITTED']:
            return 0
        now = timezone.now()
        allowed_end = min(
            obj.started_at + timedelta(minutes=obj.exam.duration_minutes),
            obj.exam.end_datetime
        )
        remaining = int((allowed_end - now).total_seconds())
        return max(0, remaining)

    def get_question_count(self, obj):
        if obj.attempt_questions.exists():
            return obj.attempt_questions.count()
        return obj.exam.exam_questions.count()

    def get_max_score(self, obj):
        if obj.max_score > 0:
            return obj.max_score
        if obj.attempt_questions.exists():
            return float(sum(aq.question.marks for aq in obj.attempt_questions.select_related('question').all()))
        return float(sum(eq.question.marks for eq in obj.exam.exam_questions.select_related('question').all()))

    def get_total_marks(self, obj):
        return self.get_max_score(obj)

    def get_questions(self, obj):
        # Return student-safe questions (NO is_correct)
        # Use attempt_questions if populated (randomized & persisted for this attempt)
        attempt_qs = obj.attempt_questions.select_related('question').prefetch_related('question__options').order_by('question_order', 'id')
        if attempt_qs.exists():
            questions = []
            for aq in attempt_qs:
                q_data = StudentQuestionSerializer(aq.question).data
                q_data['order'] = aq.question_order
                q_data['question_order'] = aq.question_order
                questions.append(q_data)
            return questions

        # Fallback for legacy attempts without AttemptQuestion records
        eqs = obj.exam.exam_questions.select_related('question').prefetch_related('question__options').order_by('order', 'id')
        questions = []
        for eq in eqs:
            q_data = StudentQuestionSerializer(eq.question).data
            q_data['order'] = eq.order
            questions.append(q_data)
        return questions

    def get_answers(self, obj):
        answers = obj.answers.select_related('selected_option').all()
        return {
            ans.question_id: {
                'option_id': ans.selected_option_id,
                'option_key': ans.selected_option.option_key if ans.selected_option else None,
            }
            for ans in answers
        }


# ========================================================
# RESULT SERIALIZERS
# ========================================================

class ResultSerializer(serializers.ModelSerializer):
    roll_number = serializers.CharField(source='student.roll_number', read_only=True)
    student_name = serializers.CharField(source='student.full_name', read_only=True)
    department_name = serializers.CharField(source='student.department.name', read_only=True)
    department_code = serializers.CharField(source='student.department.code', read_only=True)
    exam_id = serializers.IntegerField(source='exam.id', read_only=True)
    exam_title = serializers.CharField(source='exam.title', read_only=True)

    class Meta:
        model = ExamAttempt
        fields = [
            'id',
            'roll_number',
            'student_name',
            'department_name',
            'department_code',
            'exam_id',
            'exam_title',
            'score',
            'max_score',
            'percentage',
            'status',
            'violation_count',
            'submission_reason',
            'started_at',
            'submitted_at',
        ]
