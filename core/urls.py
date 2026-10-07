from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register(r'admin/questions', views.AdminQuestionViewSet, basename='admin-questions')
router.register(r'admin/exams', views.AdminExamViewSet, basename='admin-exams')

urlpatterns = [
    # Auth
    path('auth/login/', views.login_view, name='auth-login'),
    path('auth/logout/', views.logout_view, name='auth-logout'),
    path('auth/me/', views.me_view, name='auth-me'),
    path('student/profile/', views.me_view, name='student-profile'),

    # Student exams & attempts
    path('exams/', views.student_exam_list, name='student-exam-list'),
    path('exams/<int:exam_id>/', views.student_exam_detail, name='student-exam-detail'),
    path('exams/<int:exam_id>/start/', views.student_start_exam, name='student-exam-start'),
    path('attempts/<int:attempt_id>/', views.student_attempt_detail, name='student-attempt-detail'),
    path('attempts/<int:attempt_id>/answers/', views.student_save_answer, name='student-save-answer'),
    path('attempts/<int:attempt_id>/upload/', views.student_upload_submission_file, name='student-upload-file'),
    path('attempts/<int:attempt_id>/files/<int:file_id>/', views.student_delete_submission_file, name='student-delete-file'),
    path('attempts/<int:attempt_id>/files/<int:file_id>/download/', views.student_download_submission_file, name='student-download-file'),
    path('attempts/<int:attempt_id>/submit/', views.student_submit_exam, name='student-submit-exam'),
    path('attempts/<int:attempt_id>/violation/', views.student_record_violation, name='student-record-violation'),
    path('results/', views.student_results, name='student-results'),

    # Admin endpoints
    path('admin/dashboard/', views.admin_dashboard_stats, name='admin-dashboard-stats'),
    path('admin/departments/', views.admin_departments_list, name='admin-departments-list'),
    path('admin/students/', views.admin_students_view, name='admin-students-list'),
    path('admin/students/<int:student_id>/', views.admin_students_view, name='admin-student-detail'),
    path('admin/results/', views.admin_results_view, name='admin-results-list'),
    path('admin/attempts/<int:attempt_id>/grading/', views.admin_grading_view, name='admin-grading'),
    path('admin/files/<int:file_id>/preview/', views.admin_file_preview, name='admin-file-preview'),
    path('admin/files/<int:file_id>/download/', views.admin_file_download, name='admin-file-download'),

    # Admin router endpoints (questions, exams)
    path('', include(router.urls)),
]
