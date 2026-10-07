# CAS — University Online MCQ Examination Platform

A simple, robust, secure, and production-ready University Online MCQ Examination Platform built with **Django**, **Django REST Framework (DRF)**, **SQLite**, and **React + TypeScript + Vite + Tailwind CSS**.

Designed strictly for lightweight, reliable university examination administration without unnecessary infrastructure overhead (no Redis, no Celery, no Mongo/Postgres/MySQL, no WebSockets).

---

## 🏛️ Architecture & System Design

```
+-------------------------------------------------------------+
|               Nginx Reverse Proxy (Port 80)                 |
|  - Serves compiled React SPA assets directly (caching/gzip) |
|  - SPA fallback route (try_files $uri $uri/ /index.html)    |
|  - Reverse-proxies /api/ and /django-admin/ to Gunicorn     |
|  - Serves staticfiles (Django admin assets)                 |
+-------------------------------------------------------------+
                               |
                               | HTTP (port 8000)
                               v
+-------------------------------------------------------------+
|             Gunicorn + Django 5.x / 6.x + DRF               |
|  - Server-side question randomization (60 pool -> 30 active)|
|  - Fixed AttemptQuestion persistence per student attempt    |
|  - Server-side timing & department eligibility control      |
|  - Integrity violation tracking (Visibility / Focus / Full) |
|  - Server-side atomic scoring (Answers never sent to UI)    |
|  - Role-based authorization (Student vs Admin)              |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|              Persistent SQLite Database                     |
|           (/app/data/db.sqlite3 via Named Volume)           |
+-------------------------------------------------------------+
```

---

## 🎲 Question Bank Randomization (60-Question Pool → 30 Selected)

- **Authoritative Question Pool**: The assessment pool contains exactly 60 comprehensive technical MCQs (covering Java, Python, Data Structures & Algorithms, OOP & Inheritance, Agentic AI, Operating Systems, DBMS, Computer Networks, and System Design & Software Engineering) loaded from `core/data/mcq_pool.json`.
- **Configurable Pool & Attempt Size**: Exams support configurable `questions_per_attempt` (default: 30) selected from the assigned pool.
- **Server-Side Randomization**: Questions are randomly selected exclusively on the server (`random.sample`) when a student starts an exam attempt. No full question pools or answer keys are ever leaked to the client.
- **Fixed Attempt Persistence (`AttemptQuestion`)**: Once chosen, the selected 30 questions and their sequential display order (`1` to `30`) are persisted into `AttemptQuestion` database records. Refreshing, reconnecting, navigating, or autosaving preserves the exact same questions and order for that attempt.
- **Unassigned Question Protection**: Any attempt to submit an answer for a question not assigned to the student's attempt is strictly rejected with a `400 Bad Request`.
- **Validation**: If an exam's question pool has fewer questions than `questions_per_attempt`, the server prevents starting and returns an error: *"This exam does not have enough questions. At least 30 questions are required."*
- **Strict Scoring**: The total marks, max score, and student score are calculated strictly from the assigned subset of questions.

---

## 👥 Student Cohorts (301 Students Total)

The university database is pre-configured with exactly 301 students across two departments:

1. **Department 1: Cyber Security (`CS`)** — **181 Students**
   - Roll numbers: `2311CS040001` through `2311CS040180` (180 students)
   - Plus exception student: `2211CS040008` (1 student)
2. **Department 2: Internet of Things (`IOT`)** — **120 Students**
   - Roll numbers: `2311CS050001` through `2311CS050120` (120 students)

---

## 🔒 Authentication & Account Management

### Student Authentication
- **Route**: `/login` (Student-only portal)
- Students authenticate using their University Roll Number and password.
- The student portal contains no links, credentials, or shortcuts to the faculty administration console.

### Administrator Management
- **Route**: Dedicated admin portal at `/admin/login` and `/django-admin/`.
- Administrators can be created via standard Django commands:
  ```bash
  python manage.py createsuperuser
  ```
  or by setting environment variables (`ADMIN_USERNAME` and `ADMIN_PASSWORD`) before executing `seed_data`.
- Admin endpoints are protected server-side; student accounts attempting to access admin APIs receive `403 Forbidden`.

---

## 🚀 Quickstart & Local Development

### Prerequisites
- Python 3.10+
- Node.js 18+ and npm

### 1. Backend Setup

```bash
# Install Python dependencies
pip install -r requirements.txt

# Run database migrations (creates SQLite db.sqlite3)
python manage.py migrate

# Seed student cohorts (301 students)
# Set STUDENT_DEFAULT_PASSWORD env var if you wish to configure a specific initial password
python manage.py seed_data

# Create an administrator
python manage.py createsuperuser

# Import the authoritative 60-question pool and configure the assessment exam
python manage.py import_question_pool

# Start Django development server
python manage.py runserver
```

The backend starts at `http://127.0.0.1:8000/`.

### 2. Frontend Setup

In a new terminal window:

```bash
cd frontend
npm install
npm run dev
```

The frontend runs at `http://localhost:5173/` and proxies `/api` calls directly to Django at `http://127.0.0.1:8000/`.

---

## 🐳 Production Docker Deployment (Nginx + Gunicorn + Persistent SQLite)

The application is deployed with production-grade separation of concerns:
- **`cas_nginx`**: Nginx reverse proxy listening on port `80`, serving compiled React SPA static assets directly with gzip compression and caching, handling SPA routing fallbacks, and forwarding `/api/` and `/django-admin/` to Gunicorn.
- **`cas_backend`**: Django REST Framework powered by Gunicorn WSGI on port `8000`. Runs migrations, seeds cohorts, imports question pool, and collects admin staticfiles on startup.
- **`sqlite_data`**: Named Docker volume mounted at `/app/data/`, persisting SQLite database `db.sqlite3` across container restarts and rebuilds.

```bash
docker compose up --build
```

Access the platform directly at `http://localhost/` (Port 80).

---

## 🧪 Running the Test Suite

A comprehensive test suite with **60 tests** verifies authentication, access control, server-side timing, question safety, 60-question pool loading, question bank randomization, answer validation, autosaving, scoring, and integrity auto-submission:

```bash
python manage.py test core.test_platform
```

Output:
```text
Ran 60 tests in ~8s
OK
```

---

## 🛡️ Security & Examination Integrity

### 1. Zero Answer Leakage
- Option serializers for students **NEVER** expose `is_correct`, answer keys, or solutions.
- Grading occurs exclusively server-side upon atomic submission.

### 2. Department-Scoped Access
- A Cyber Security student is strictly forbidden from viewing or attempting IoT-only exams, and vice-versa.
- Department membership is enforced in the database and validated on every API call.

### 3. Server-Authoritative Timer
- Start and end windows are governed exclusively by server datetime (`timezone.now()`).
- Attempt duration is calculated by `min(started_at + duration_minutes, exam.end_datetime)`.
- Client clock manipulation, browser refreshes, or state tampering cannot extend the exam duration.

### 4. Integrity Violation Tracking (Deterrence)
- **Visibility Detection**: `document.visibilityState` detects tab switching or window minimization.
- **Window Blur Detection**: `window.onblur` detects loss of browser window focus.
- **Fullscreen Mode**: Exam requires fullscreen; exiting fullscreen records an integrity violation.
- **Debounced Backend Increments**: Server increments `violation_count` atomically (with a client debounce to avoid false multi-counts).
- **Auto-Submission**: Upon reaching **5 violations**, the server automatically submits the attempt with status `AUTO_SUBMITTED` and reason `EXAM_INTEGRITY_VIOLATION`. The attempt is permanently locked and cannot be reopened.
- **Interaction Protection**: Right-click, text selection, and copy shortcuts are disabled inside the exam room without interfering with option selection, scrolling, or navigation.

---

## 📊 Workflows

### Student Workflow
1. Log in at `/login` using roll number and password.
2. Dashboard displays available, upcoming, and completed exams for the student's department.
3. Click **Start Examination** &rarr; Review instructions and click **Enter Fullscreen & Begin Exam**.
4. Answer MCQ questions:
   - Palette tracks *Answered* (green) and *Pending* questions.
   - Answers autosave instantly to SQLite on every click.
   - Refreshing or reconnecting preserves all previously saved answers.
5. Click **Submit Exam** & confirm &rarr; Real-time score, marks, and percentage displayed.
6. Visit `/results` anytime to view completed exam history (strictly scoped to authenticated student).

### Admin Workflow
1. Log in at `/admin/login` using administrator credentials.
2. **Dashboard**: View real-time database counts (181 CS, 120 IoT, 301 Total, Exams, Attempts).
3. **Student Directory**: Search roll numbers, filter by department, toggle active/inactive account status.
4. **Question Bank**: View/edit the 60 authoritative MCQs, categories, and options.
5. **Exams**: Manage exams, schedule duration and date ranges, configure question pool and `questions_per_attempt` (30).
6. **Results**: Filter submissions by Exam/Department/Student, and click **Export Results to CSV** to download `exam_results.csv`.
