"""
Placement Portal Application (Flask)

Structure guide:
1. App/DB/Login setup
2. Shared helpers (validation, formatting, targeting, filters)
3. Notification composition helpers
4. Auth + dashboards (student, company, admin)
5. Reporting/export routes
6. JSON APIs (admin-managed resources + dashboard data)
7. DB bootstrap/migration helper + app run

Note:
- This file is intentionally monolithic for course submission simplicity.
- Section banners are kept explicit so viva navigation is easy.
"""

import os
import json
import re
import csv
import io
from datetime import datetime, timezone, timedelta, date, time
import secrets
from flask import jsonify
from werkzeug.utils import secure_filename
from flask import (
    Flask, render_template, redirect,
    url_for, request, flash, send_from_directory, make_response
)
from flask_login import (
    LoginManager, login_user,
    login_required, logout_user, current_user
)
from werkzeug.security import generate_password_hash, check_password_hash
from sqlalchemy.exc import SQLAlchemyError
from models import (db, Admin, Student, Company, PlacementDrive,
                    Application, SupportTicket, BroadcastMessage, CompanyBroadcast,
                    InterviewSchedule, CompanyNotification, StudentNotification, DriveActivityLog,
                    StudentDriveView, DeletedStudentLog, DeletedCompanyLog)

# ==========================
# APP CONFIG
# ==========================
app = Flask(__name__)
app.config["SECRET_KEY"] = "plaxeron_secret_key"
BASE_DIR = os.path.abspath(os.path.dirname(__file__))
UPLOAD_FOLDER = os.path.join(BASE_DIR, "static/uploads/resumes")
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///" + os.path.join(
    BASE_DIR, "placement_portal.db"
)
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["UPLOAD_FOLDER"] = UPLOAD_FOLDER
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024 * 1024  # 2MB
ALLOWED_EXTENSIONS = {"pdf"}
DEGREE_OPTIONS = [
    "B.Tech",
    "B.E.",
    "M.Tech",
    "BCA",
    "MCA",
    "B.Sc",
    "M.Sc",
    "BBA",
    "MBA",
    "B.Com",
    "M.Com",
    "BA",
    "MA",
    "B.Pharm",
    "M.Pharm",
    "Other",
]

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
db.init_app(app)


@app.context_processor
def inject_global_form_options():
    return {
        "degree_options": DEGREE_OPTIONS
    }

# ==========================
# LOGIN MANAGER
# ==========================
login_manager = LoginManager()
login_manager.init_app(app)
login_manager.login_view = "student_login"

@login_manager.user_loader
def load_user(user_id):
    if ":" not in user_id:
        return None
    role, real_id = user_id.split(":")
    real_id = int(real_id)
    if role == "student":
        return Student.query.get(real_id)
    if role == "company":
        return Company.query.get(real_id)
    if role == "admin":
        return Admin.query.get(real_id)
    return None

# ==========================
# HELPERS
# ==========================
def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def parse_cgpa_input(raw_value):
    """Accept CGPA/percentage input formats like '8.5', '85', or '85%'."""
    raw = (raw_value or "").strip()
    if not raw:
        return None
    compact = raw.replace(" ", "")
    if compact.endswith("%"):
        compact = compact[:-1]
    try:
        value = float(compact)
    except ValueError:
        return None
    return value if value >= 0 else None


def get_time_ago(dt):
    """Convert datetime to human-readable 'time ago'"""
    if not dt:
        return "Unknown"
    now = datetime.utcnow()
    diff = now - dt
    seconds = diff.total_seconds()
    if seconds < 60:
        return "Just now"
    elif seconds < 3600:
        minutes = int(seconds / 60)
        return f"{minutes} minute{'s' if minutes != 1 else ''} ago"
    elif seconds < 86400:
        hours = int(seconds / 3600)
        return f"{hours} hour{'s' if hours != 1 else ''} ago"
    elif seconds < 604800:
        days = int(seconds / 86400)
        return f"{days} day{'s' if days != 1 else ''} ago"
    else:
        return dt.strftime("%d %b %Y")


def parse_drive_deadline_datetime(drive):
    """Return a datetime used for ordering drive deadlines."""
    if not drive or not drive.application_deadline:
        return None
    deadline_time = drive.application_deadline_time or time.max
    return datetime.combine(drive.application_deadline, deadline_time)

def parse_drive_publish_datetime_ist(drive):
    """Return drive publish datetime in IST, or None when unscheduled."""
    if not drive or not getattr(drive, "publish_date", None):
        return None
    publish_time = getattr(drive, "publish_time", None) or time.min
    dt = datetime.combine(drive.publish_date, publish_time)
    return dt.replace(tzinfo=IST)


def is_drive_published_to_students(drive, now_ist=None):
    """Drive is student-visible only when Approved and publish schedule has started."""
    if not drive or (drive.status or "").strip() != "Approved":
        return False
    publish_dt = parse_drive_publish_datetime_ist(drive)
    if not publish_dt:
        return True
    current_ist = now_ist or datetime.now(IST)
    if current_ist.tzinfo is None:
        current_ist = current_ist.replace(tzinfo=IST)
    return current_ist >= publish_dt


def _norm_text(value):
    """Normalize free-text for case-insensitive, whitespace-tolerant matching."""
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _csv_set(value):
    """Convert comma-separated DB text into normalized token set."""
    if not value:
        return set()
    return {_norm_text(part) for part in str(value).split(",") if _norm_text(part)}


def student_matches_drive_target(student, drive):
    """Check if a student falls inside drive target degree/year filters."""
    if not student or not drive:
        return False
    target_degrees = _csv_set(getattr(drive, "target_degrees", None))
    target_years = _csv_set(getattr(drive, "target_years", None))

    student_degree = _norm_text(getattr(student, "degree", None))
    student_year = _norm_text(getattr(student, "year_of_study", None))

    if target_degrees and (not student_degree or student_degree not in target_degrees):
        return False
    if target_years and (not student_year or student_year not in target_years):
        return False
    return True


IST = timezone(timedelta(hours=5, minutes=30))


def to_ist(dt):
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST)


def format_ist_datetime(dt):
    dt_ist = to_ist(dt)
    if not dt_ist:
        return "Unknown"
    return dt_ist.strftime("%d %b %Y, %I:%M %p IST")


def _get_str_arg(name):
    return (request.args.get(name) or "").strip()


def _get_int_arg(name):
    raw = _get_str_arg(name)
    if not raw:
        return None
    try:
        return int(raw)
    except ValueError:
        return None


def _get_float_arg(name):
    raw = _get_str_arg(name)
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _get_date_arg(name):
    raw = _get_str_arg(name)
    if not raw:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return None


def _in_date_range(dt_value, d_from=None, d_to=None):
    if not dt_value:
        return False
    value_date = dt_value.date() if isinstance(dt_value, datetime) else dt_value
    if d_from and value_date < d_from:
        return False
    if d_to and value_date > d_to:
        return False
    return True


def build_student_notification_stream(student):
    """
    Build the full student notification payload consumed by dashboard UI/API.

    Includes:
    - persisted status notifications
    - live/fallback status items
    - scheduled interview reminders
    - admin broadcasts
    """
    def persist_student_notification(notif_type, icon, text, notif_key, created_at):
        legacy_key = None
        prefix = f"student_{student.id}_"
        if notif_key.startswith(prefix):
            legacy_key = notif_key[len(prefix):]
        key_candidates = [notif_key] + ([legacy_key] if legacy_key else [])
        existing = StudentNotification.query.filter(
            StudentNotification.student_id == student.id,
            StudentNotification.notif_key.in_(key_candidates)
        ).first()
        if existing:
            return
        db.session.add(StudentNotification(
            student_id=student.id,
            notif_type=notif_type,
            icon=icon,
            text=text,
            notif_key=notif_key,
            created_at=created_at or datetime.utcnow()
        ))

    # 1) Application status update notifications
    live_status_items = []
    tracked_apps = Application.query.filter(
        Application.student_id == student.id,
        Application.status.in_(["Shortlisted", "Placed", "Rejected"])
    ).order_by(Application.status_updated_at.desc()).limit(80).all()

    for app in tracked_apps:
        status = (app.status or "").strip()
        if not status:
            continue
        drive_title = "Drive"
        company_name = "Company"
        drive_obj = getattr(app, "drive", None)
        if drive_obj:
            drive_title = (drive_obj.job_title or "Drive").strip() or "Drive"
            company_obj = getattr(drive_obj, "company", None)
            if company_obj:
                company_name = (company_obj.company_name or "Company").strip() or "Company"
        ts = app.status_updated_at or app.application_date or datetime.utcnow()
        ts_key = int(ts.timestamp() * 1000000)
        key = f"student_{student.id}_app_status_{app.id}_{status.lower()}_{ts_key}"
        status_type = "info"
        status_icon = "bi-info-circle-fill"
        status_text = (
            f"Application update: <strong>{drive_title}</strong> at {company_name}"
        )
        if status == "Placed":
            status_type = "success"
            status_icon = "bi-trophy-fill"
            status_text = f"Accepted (Placed): <strong>{drive_title}</strong> at {company_name}"
            persist_student_notification(
                "success", "bi-trophy-fill",
                f"Accepted (Placed): <strong>{drive_title}</strong> at {company_name}",
                key, ts
            )
        elif status == "Shortlisted":
            status_type = "warning"
            status_icon = "bi-star-fill"
            status_text = f"Shortlisted for <strong>{drive_title}</strong> at {company_name}"
            persist_student_notification(
                "warning", "bi-star-fill",
                f"Shortlisted for <strong>{drive_title}</strong> at {company_name}",
                key, ts
            )
        elif status == "Rejected":
            status_type = "info"
            status_icon = "bi-info-circle-fill"
            status_text = (
                f"Application update: Not moved forward for <strong>{drive_title}</strong> at {company_name}"
            )
            persist_student_notification(
                "info", "bi-info-circle-fill",
                f"Application update: Not moved forward for <strong>{drive_title}</strong> at {company_name}",
                key, ts
            )
        live_status_items.append({
            "kind": "notification",
            "type": status_type,
            "icon": status_icon,
            "text": status_text,
            "time": format_ist_datetime(ts),
            "key": key,
            "read": False,
            "sort_ts": ts.timestamp() if ts else 0,
            "section": "applications",
            "open_app": app.id,
            "open_drive": app.drive_id
        })

    # 2) New drive alerts for approved and student-eligible drives
    live_drive_items = []
    approved_drives = PlacementDrive.query.filter(
        PlacementDrive.status == "Approved"
    ).order_by(PlacementDrive.updated_at.desc(), PlacementDrive.id.desc()).limit(300).all()
    applied_drive_ids = {
        a.drive_id for a in Application.query.with_entities(Application.drive_id).filter_by(student_id=student.id).all()
    }

    for drive in approved_drives:
        if not drive.updated_at:
            continue
        if not is_drive_published_to_students(drive):
            continue
        if not student_matches_drive_target(student, drive):
            continue
        if drive.id in applied_drive_ids:
            continue
        key = f"student_{student.id}_drive_approved_{drive.id}"
        drive_title = (drive.job_title or "Drive").strip() or "Drive"
        company_name = "Company"
        if getattr(drive, "company", None):
            company_name = (drive.company.company_name or "Company").strip() or "Company"
        salary_text = f" · ₹{drive.salary:,} LPA" if drive.salary else ""
        notif_created_at = drive.updated_at or datetime.utcnow()
        publish_dt_ist = parse_drive_publish_datetime_ist(drive)
        if publish_dt_ist:
            notif_created_at = publish_dt_ist.astimezone(timezone.utc).replace(tzinfo=None)
        persist_student_notification(
            "drive",
            "bi-briefcase-fill",
            f"New approved drive: <strong>{drive_title}</strong> at {company_name}{salary_text}",
            key,
            notif_created_at
        )
        live_drive_items.append({
            "kind": "notification",
            "type": "drive",
            "icon": "bi-briefcase-fill",
            "text": f"New approved drive: <strong>{drive_title}</strong> at {company_name}{salary_text}",
            "time": format_ist_datetime(notif_created_at),
            "key": key,
            "read": False,
            "sort_ts": notif_created_at.timestamp() if notif_created_at else 0,
            "section": "drives",
            "open_app": None,
            "open_drive": drive.id
        })
    try:
        db.session.commit()
    except SQLAlchemyError:
        # Handle rare race conditions on unique notif_key inserts gracefully.
        db.session.rollback()

    # 3) Load persisted notifications and broadcasts
    notifications = StudentNotification.query.filter(
        StudentNotification.student_id == student.id
    ).order_by(StudentNotification.created_at.desc()).all()

    broadcasts = BroadcastMessage.query.filter(
        BroadcastMessage.target.in_(["student", "all"])
    ).order_by(BroadcastMessage.sent_at.desc()).all()

    interview_events = InterviewSchedule.query.join(
        Application, InterviewSchedule.application_id == Application.id
    ).filter(
        Application.student_id == student.id
    ).order_by(
        InterviewSchedule.created_at.desc()
    ).all()

    # 4) Resolve deep-links (notification -> application/drive)
    app_ids = []
    drive_ids = []
    for n in notifications:
        key = n.notif_key or ""
        app_match = re.search(r"app_status_(\d+)_", key)
        drive_match = re.search(r"drive_approved_(\d+)$", key)
        if app_match:
            app_ids.append(int(app_match.group(1)))
        elif drive_match:
            drive_ids.append(int(drive_match.group(1)))

    app_lookup = {
        a.id: a for a in Application.query.filter(
            Application.student_id == student.id,
            Application.id.in_(app_ids) if app_ids else False
        ).all()
    } if app_ids else {}
    drive_lookup = {
        d.id: d for d in PlacementDrive.query.filter(
            PlacementDrive.id.in_(drive_ids) if drive_ids else False
        ).all()
    } if drive_ids else {}

    notif_items = []
    for n in notifications:
        key = n.notif_key or ""
        app_status_match = re.search(r"app_status_(\d+)_([a-z]+)_", key)
        if app_status_match:
            notif_status = (app_status_match.group(2) or "").lower()
            if notif_status == "interview":
                # Interview reminders are provided only via interview_items cards.
                continue
        item = {
            "kind": "notification",
            "type": n.notif_type,
            "icon": n.icon,
            "text": n.text,
            "time": format_ist_datetime(n.created_at),
            "key": n.notif_key,
            "read": bool(n.is_read),
            "sort_ts": n.created_at.timestamp() if n.created_at else 0,
            "section": None,
            "open_app": None,
            "open_drive": None
        }
        app_match = re.search(r"app_status_(\d+)_", key)
        drive_match = re.search(r"drive_approved_(\d+)$", key)
        if app_match:
            app_id = int(app_match.group(1))
            if app_id in app_lookup:
                item["section"] = "applications"
                item["open_app"] = app_id
        elif drive_match:
            drive_id = int(drive_match.group(1))
            if drive_id in drive_lookup:
                item["section"] = "drives"
                item["open_drive"] = drive_id
        notif_items.append(item)

    # 5) Fallback guarantee: include live items if persistence missed any key.
    existing_keys = {n.get("key") for n in notif_items}
    for live_item in (live_status_items + live_drive_items):
        if live_item["key"] not in existing_keys:
            notif_items.append(live_item)
    # 6) Interview reminder cards (date/time/mode) for scheduled interviews.
    interview_items = []
    today_local = datetime.now().date()
    for sched in interview_events:
        job_title = sched.drive.job_title if sched.drive else "Interview"
        company_name = sched.drive.company.company_name if sched.drive and sched.drive.company else "Company"
        mode_label = (sched.mode or "Online").strip() or "Online"
        day_diff = (sched.interview_date - today_local).days if sched.interview_date else None
        if day_diff is None:
            relative_time = "Upcoming interview"
        elif day_diff < 0:
            relative_time = f"{abs(day_diff)} day{'s' if abs(day_diff) != 1 else ''} ago"
        elif day_diff == 0:
            relative_time = "Today"
        elif day_diff == 1:
            relative_time = "1 day from now"
        else:
            relative_time = f"{day_diff} days from now"
        interview_items.append({
            "kind": "interview",
            "type": "interview",
            "icon": "bi-camera-video-fill",
            "subject": f"Interview Scheduled — {job_title} at {company_name}",
            "text": (
                f"Date: {sched.interview_date.strftime('%d %b %Y') if sched.interview_date else 'TBD'}"
                f" | Time: {sched.interview_time.strftime('%I:%M %p') if sched.interview_time else 'TBD'}"
                f" | Mode: {mode_label}"
            ),
            "time": relative_time,
            "key": f"interview_schedule_{sched.id}",
            "interview_schedule_id": sched.id,
            "sort_ts": sched.created_at.timestamp() if sched.created_at else 0,
            "section": "applications",
            "open_app": sched.application_id,
            "open_drive": sched.drive_id
        })

    # 7) Broadcast cards from admin.
    broadcast_items = [
        {
            "kind": "broadcast",
            "type": "broadcast",
            "icon": "bi-megaphone-fill",
            "subject": b.subject or "Admin Broadcast",
            "text": b.message or "",
            "target": (b.target or "all").capitalize(),
            "time": format_ist_datetime(b.sent_at),
            "key": f"broadcast_admin_{b.id}",
            "broadcast_id": b.id,
            "sort_ts": b.sent_at.timestamp() if b.sent_at else 0
        }
        for b in broadcasts
    ]
    stream_items = sorted(
        notif_items + interview_items + broadcast_items,
        key=lambda x: x.get("sort_ts", 0),
        reverse=True
    )

    # 8) Merge and return final stream sorted by latest timestamp.
    latest_broadcast_item = None
    if broadcasts:
        latest = broadcasts[0]
        latest_broadcast_item = {
            "id": latest.id,
            "subject": latest.subject or "Admin Broadcast",
            "message": latest.message or "",
            "target": (latest.target or "all"),
            "sent_at": latest.sent_at.isoformat() if latest.sent_at else None
        }

    return {
        "notifications": sorted(
            notif_items + interview_items,
            key=lambda x: x.get("sort_ts", 0),
            reverse=True
        ),
        "unread_count": len([n for n in notif_items if not n.get("read")]),
        "interviews": interview_items,
        "broadcasts": broadcast_items,
        "items": stream_items,
        "latest_broadcast": latest_broadcast_item
    }


def next_section_url(default="overview"):
    """Preserve current company dashboard context across POST/redirect flows."""
    section = request.form.get("return_section") or request.args.get("section") or default
    open_drive = request.form.get("return_drive_id") or request.args.get("open_drive")
    open_app = request.form.get("open_app_id") or request.args.get("open_app")
    params = {"section": section}
    if open_drive:
        params["open_drive"] = open_drive
    if open_app:
        params["open_app"] = open_app
    return url_for("company_dashboard", **params)


def admin_next_section_url(default="overview"):
    """Preserve current admin dashboard tab after state-changing actions."""
    section = request.form.get("return_section") or request.args.get("section") or default
    return url_for("admin_dashboard", section=section)


def generate_drive_id(company):
    """Generate sequential drive ID scoped to one company (e.g., C001D1)."""
    if not company:
        return None
    company_code = (company.company_id or "").upper()
    suffix = "000"
    if "C" in company_code:
        suffix = company_code.split("C")[-1][-3:].zfill(3)
    prefix = f"C{suffix}D"
    existing = PlacementDrive.query.filter(
        PlacementDrive.company_id == company.id,
        PlacementDrive.drive_id.like(f"{prefix}%")
    ).all()
    max_num = 0
    for drive in existing:
        try:
            num = int((drive.drive_id or "").replace(prefix, ""))
            max_num = max(max_num, num)
        except ValueError:
            continue
    return f"{prefix}{max_num + 1}"


# ==========================
# BASIC ROUTES
# ==========================
@app.route("/")
def home():
    active_drives = [
        d for d in PlacementDrive.query.filter_by(status="Approved").all()
        if is_drive_published_to_students(d)
    ]
    return render_template("index.html", active_drives=active_drives, now=datetime.utcnow())

@app.route("/logout")
@login_required
def logout():
    logout_user()
    flash("Logged out successfully.", "info")
    return redirect(url_for("home"))

@app.errorhandler(404)
def not_found(e):
    return render_template("errors/404.html"), 404

@app.errorhandler(500)
def server_error(e):
    return render_template("errors/500.html"), 500


# =====================================================
# STUDENT REGISTRATION
# =====================================================
@app.route("/register/student", methods=["GET", "POST"])
def student_register():
    if request.method == "POST":
        email = (request.form.get("email") or "").strip()
        contact = re.sub(r"\D", "", request.form.get("contact") or "")
        if Student.query.filter_by(email=email).first():
            flash("Email already registered", "danger")
            return redirect(url_for("student_register"))
        if not re.fullmatch(r"[6-9]\d{9}", contact):
            flash("Enter a valid 10-digit mobile number", "danger")
            return redirect(url_for("student_register"))
        if Student.query.filter_by(contact=contact).first():
            flash("Mobile number already registered", "danger")
            return redirect(url_for("student_register"))

        resume_file = request.files.get("resume")
        resume_path = None
        if resume_file and allowed_file(resume_file.filename):
            filename = secure_filename(
                f"{email}_{datetime.now(timezone.utc).timestamp()}.pdf"
            )
            resume_file.save(os.path.join(app.config["UPLOAD_FOLDER"], filename))
            resume_path = f"uploads/resumes/{filename}"
        else:
            flash("Valid resume (PDF) is required", "danger")
            return redirect(url_for("student_register"))

        cgpa_raw = request.form.get("cgpa")
        cgpa = parse_cgpa_input(cgpa_raw)
        if cgpa is None and (cgpa_raw or "").strip():
            flash("Enter CGPA/Percentage in valid format (e.g., 8.5 or 85%).", "danger")
            return redirect(url_for("student_register"))
        tenth = request.form.get("tenth_percent")
        twelfth = request.form.get("twelfth_percent")
        student_id = generate_student_id()

        student = Student(
            student_id=student_id,
            name=request.form.get("name"),
            email=email,
            password=generate_password_hash(request.form.get("password")),
            dob=request.form.get("dob"),
            contact=contact,
            college=request.form.get("college"),
            degree=request.form.get("degree"),
            branch=request.form.get("branch"),
            year_of_study=request.form.get("year_of_study"),
            cgpa=cgpa,
            graduation_year=request.form.get("graduation_year"),
            tenth_percent=float(tenth) if tenth else None,
            twelfth_percent=float(twelfth) if twelfth else None,
            skills=request.form.get("skills"),
            linkedin=request.form.get("linkedin"),
            github=request.form.get("github"),
            bio=request.form.get("bio"),
            resume_url=resume_path,
            is_active=True
        )
        db.session.add(student)
        db.session.commit()
        flash(
            f'Registration successful! Your Student ID is <strong>{student_id}</strong>. '
            f'Please save it — you can use it to login.',
            'success'
        )
        return redirect(url_for("student_login"))
    return render_template("auth/student_register.html")


@app.route("/api/student/contact-exists", methods=["GET"])
def student_contact_exists():
    contact = re.sub(r"\D", "", (request.args.get("contact") or ""))
    if not re.fullmatch(r"[6-9]\d{9}", contact):
        return jsonify({"exists": False, "valid": False})
    exists = Student.query.filter_by(contact=contact).first() is not None
    return jsonify({"exists": exists, "valid": True})


@app.route("/api/student/email-exists", methods=["GET"])
def student_email_exists():
    email = (request.args.get("email") or "").strip().lower()
    if not re.fullmatch(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$", email):
        return jsonify({"exists": False, "valid": False})
    exists = Student.query.filter(db.func.lower(Student.email) == email).first() is not None
    return jsonify({"exists": exists, "valid": True})


def generate_student_id():
    """Generate student login ID format: PLAX<yy>S<4-digit-seq>."""
    year = datetime.utcnow().strftime("%y")
    last_student = Student.query.order_by(Student.id.desc()).first()
    if last_student and last_student.student_id:
        try:
            last_number = int(last_student.student_id[-4:])
        except (ValueError, IndexError):
            last_number = 0
        new_number = last_number + 1
    else:
        new_number = 1
    return f"PLAX{year}S{new_number:04d}"


def generate_application_code(application_dt=None):
    """Generate application code format: PLAX<yy>A<4-digit-seq>."""
    dt = application_dt or datetime.utcnow()
    year_suffix = dt.strftime("%y")
    prefix = f"PLAX{year_suffix}A"

    existing_codes = db.session.query(Application.application_code).filter(
        Application.application_code.isnot(None),
        Application.application_code.like(f"{prefix}%")
    ).all()

    max_seq = 0
    for row in existing_codes:
        code = (row[0] or "").strip().upper()
        m = re.match(rf"^{prefix}(\d+)$", code)
        if m:
            max_seq = max(max_seq, int(m.group(1)))

    return f"{prefix}{(max_seq + 1):04d}"


@app.route("/generate-student-id", methods=["GET"])
def preview_student_id():
    student_id = generate_student_id()
    return jsonify({"student_id": student_id})


# =====================================================
# STUDENT LOGIN
# =====================================================
@app.route("/login/student", methods=["GET", "POST"])
def student_login():
    if request.method == "POST":
        identifier = request.form.get("email")
        student = Student.query.filter_by(email=identifier).first()
        if not student:
            student = Student.query.filter_by(student_id=identifier.upper()).first()
        if student and check_password_hash(student.password, request.form.get("password")):
            if not student.is_active:
                flash("Your account has been blacklisted.", "danger")
                return redirect(url_for("student_login"))
            login_user(student)
            return redirect(url_for("student_dashboard"))
        flash("Invalid credentials", "danger")
    return render_template("auth/student_login.html")


# =====================================================
# STUDENT DASHBOARD
# =====================================================
@app.route("/student/dashboard")
@login_required
def student_dashboard():
    if not isinstance(current_user, Student):
        return redirect(url_for("home"))
    approved_drives = [
        d for d in PlacementDrive.query.filter_by(status="Approved").all()
        if student_matches_drive_target(current_user, d) and is_drive_published_to_students(d)
    ]
    scheduled_target_drives = []
    for d in PlacementDrive.query.filter_by(status="Approved").all():
        if not student_matches_drive_target(current_user, d):
            continue
        publish_at_ist = parse_drive_publish_datetime_ist(d)
        if not publish_at_ist:
            continue
        if is_drive_published_to_students(d):
            continue
        d.publish_at_ist = publish_at_ist
        scheduled_target_drives.append(d)
    scheduled_target_drives.sort(
        key=lambda d: d.publish_at_ist or datetime.max.replace(tzinfo=IST)
    )
    applications = Application.query.filter_by(student_id=current_user.id).all()
    student_tickets = SupportTicket.query.filter_by(
        student_id=current_user.id,
        submitter_type="student"
    ).order_by(SupportTicket.created_at.desc()).limit(30).all()
    scheduled_interviews = InterviewSchedule.query.join(
        Application, InterviewSchedule.application_id == Application.id
    ).filter(
        Application.student_id == current_user.id,
        db.or_(
            InterviewSchedule.schedule_status.is_(None),
            db.func.trim(InterviewSchedule.schedule_status) == "",
            db.func.lower(db.func.trim(InterviewSchedule.schedule_status)) == "scheduled",
        )
    ).order_by(
        InterviewSchedule.interview_date.asc(),
        InterviewSchedule.interview_time.asc()
    ).all()
    viewed_drive_ids = {
        v.drive_id for v in StudentDriveView.query.filter_by(student_id=current_user.id).all()
    }
    notif_payload = build_student_notification_stream(current_user)
    selected_apps = sorted(
        [a for a in applications if (a.status or "").strip() == "Placed"],
        key=lambda a: a.status_updated_at or a.application_date or datetime.min,
        reverse=True
    )
    selected_celebration_app = selected_apps[0] if selected_apps else None

    return render_template(
        "dashboards/student_dashboard.html",
        student=current_user,
        drives=approved_drives,
        viewed_drive_ids=viewed_drive_ids,
        applications=applications,
        selected_celebration_app=selected_celebration_app,
        student_tickets=student_tickets,
        scheduled_interviews=scheduled_interviews,
        scheduled_target_drives=scheduled_target_drives,
        today=datetime.now(IST),
        broadcast=notif_payload.get("latest_broadcast"),
        notifications_seed=notif_payload.get("items", []),
        initial_section=request.args.get("section")
    )


# =====================================================
# STUDENT PROFILE EDIT
# =====================================================
@app.route("/student/profile/edit", methods=["GET", "POST"])
@login_required
def edit_student_profile():
    if not isinstance(current_user, Student):
        return redirect(url_for("home"))
    if request.method == "POST":
        current_user.name = request.form.get("name")
        current_user.dob = request.form.get("dob")
        current_user.contact = request.form.get("contact")
        current_user.college = request.form.get("college")
        current_user.degree = request.form.get("degree")
        current_user.branch = request.form.get("branch")
        cgpa_raw = request.form.get("cgpa")
        current_user.cgpa = parse_cgpa_input(cgpa_raw)
        tenth_raw = request.form.get("tenth_percent")
        try:
            current_user.tenth_percent = float(tenth_raw) if tenth_raw else None
        except ValueError:
            current_user.tenth_percent = None
        twelfth_raw = request.form.get("twelfth_percent")
        try:
            current_user.twelfth_percent = float(twelfth_raw) if twelfth_raw else None
        except ValueError:
            current_user.twelfth_percent = None
        current_user.skills = request.form.get("skills")
        current_user.linkedin = request.form.get("linkedin")
        current_user.github = request.form.get("github")
        current_user.bio = request.form.get("bio")
        resume_file = request.files.get("resume")
        if resume_file and allowed_file(resume_file.filename):
            filename = secure_filename(
                f"{current_user.email}_{datetime.utcnow().timestamp()}.pdf"
            )
            resume_file.save(os.path.join(app.config["UPLOAD_FOLDER"], filename))
            current_user.resume_url = f"uploads/resumes/{filename}"
        db.session.commit()
        flash("Profile updated successfully", "success")
        return redirect(url_for("student_dashboard"))
    return render_template("dashboards/edit_student_profile.html", student=current_user)


# =====================================================
# STUDENT APPLY DRIVE
# =====================================================
@app.route("/student/apply/<int:drive_id>")
@login_required
def apply_to_drive(drive_id):
    if not isinstance(current_user, Student):
        return redirect(url_for("home"))
    return_section = (request.args.get("section") or "drives").strip() or "drives"
    drive = PlacementDrive.query.get_or_404(drive_id)
    if not is_drive_published_to_students(drive):
        flash("Drive not open", "warning")
        return redirect(url_for("student_dashboard", section=return_section))
    if not student_matches_drive_target(current_user, drive):
        flash("You are not eligible for this drive target group.", "warning")
        return redirect(url_for("student_dashboard", section=return_section))
    if Application.query.filter_by(student_id=current_user.id, drive_id=drive_id).first():
        flash("Already applied", "warning")
        return redirect(url_for("student_dashboard", section=return_section))
    application_ts = datetime.utcnow()
    application = Application(
        student_id=current_user.id,
        drive_id=drive_id,
        application_code=generate_application_code(application_ts),
        application_date=application_ts,
        status_updated_at=application_ts
    )
    db.session.add(application)
    db.session.commit()
    flash("Application submitted", "success")
    return redirect(url_for("student_dashboard", section=return_section))


# =====================================================
# STUDENT SUPPORT TICKET
# =====================================================
@app.route("/student/support", methods=["POST"])
@login_required
def submit_support_ticket():
    if not isinstance(current_user, Student):
        return redirect(url_for("home"))

    subject = request.form.get("subject", "").strip()
    message = request.form.get("message", "").strip()
    category = request.form.get("category", "General")

    if not subject or not message:
        flash("Subject and message are required.", "danger")
        return redirect(url_for("student_dashboard", section="support"))

    ticket = SupportTicket(
        student_id=current_user.id,
        subject=subject,
        message=message,
        category=category,
        submitter_type="student",
        status="Open"
    )
    db.session.add(ticket)
    db.session.commit()
    flash("Support request submitted successfully! We'll get back to you soon.", "success")
    return redirect(url_for("student_dashboard", section="support"))


# =====================================================
# STUDENT NOTIFICATIONS API
# =====================================================
@app.route("/api/student/notifications")
@login_required
def get_student_notifications():
    if not isinstance(current_user, Student):
        return jsonify({"error": "Unauthorized"}), 403

    try:
        payload = build_student_notification_stream(current_user)
        resp = jsonify(payload)
        resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        resp.headers["Pragma"] = "no-cache"
        return resp
    except Exception as e:
        print("Student notification error:", e)
        return jsonify({"notifications": [], "broadcasts": [], "items": []})


@app.route("/api/student/notifications/mark-all-read", methods=["POST"])
@login_required
def mark_student_notifications_read():
    if not isinstance(current_user, Student):
        return jsonify({"error": "Unauthorized"}), 403

    StudentNotification.query.filter(
        StudentNotification.student_id == current_user.id,
        StudentNotification.is_read.is_(False)
    ).update({StudentNotification.is_read: True}, synchronize_session=False)
    db.session.commit()
    return jsonify({"success": True})


@app.route("/api/student/drive/<int:drive_id>/mark-viewed", methods=["POST"])
@login_required
def mark_drive_viewed(drive_id):
    if not isinstance(current_user, Student):
        return jsonify({"error": "Unauthorized"}), 403

    drive = PlacementDrive.query.get_or_404(drive_id)
    existing = StudentDriveView.query.filter_by(
        student_id=current_user.id,
        drive_id=drive.id
    ).first()
    if not existing:
        db.session.add(StudentDriveView(
            student_id=current_user.id,
            drive_id=drive.id,
            viewed_at=datetime.utcnow()
        ))
    else:
        existing.viewed_at = datetime.utcnow()
    db.session.commit()
    return jsonify({"success": True})


# =====================================================
# STUDENT FORGOT / RESET PASSWORD
# =====================================================
@app.route("/forgot-password/student", methods=["GET", "POST"])
def student_forgot_password():
    if request.method == "POST":
        identifier  = request.form.get("email", "").strip()
        lookup_type = request.form.get("lookup_type", "email").strip()
        dob         = request.form.get("dob", "").strip()
        mobile4     = request.form.get("mobile4", "").strip()
        new_pass    = request.form.get("password", "").strip()

        if not all([identifier, dob, mobile4, new_pass]):
            return render_template("auth/student_forgot_password.html")

        if lookup_type == "id":
            student = Student.query.filter_by(student_id=identifier.upper()).first()
        else:
            student = Student.query.filter_by(email=identifier).first()

        if not student:
            flash("No account found with that identifier.", "error")
            return render_template("auth/student_forgot_password.html")
        if str(student.dob) != dob:
            flash("Date of birth does not match our records.", "error")
            return render_template("auth/student_forgot_password.html")
        if not student.contact or str(student.contact)[-4:] != mobile4:
            flash("Last 4 digits of mobile do not match our records.", "error")
            return render_template("auth/student_forgot_password.html")
        if len(new_pass) < 8:
            flash("Password must be at least 8 characters.", "error")
            return render_template("auth/student_forgot_password.html")

        student.password = generate_password_hash(new_pass)
        db.session.commit()
        flash("Password reset successful! Please login with your new password.", "success")
        return redirect(url_for("student_login"))

    return render_template("auth/student_forgot_password.html")


@app.route("/reset-password/student/<token>", methods=["GET", "POST"])
def student_reset_password(token):
    student = Student.query.filter_by(reset_token=token).first()
    if not student or not student.reset_token_expiry:
        flash("Invalid or expired reset link.", "danger")
        return redirect(url_for("student_login"))
    if datetime.utcnow() > student.reset_token_expiry:
        flash("Reset link has expired. Please request a new one.", "danger")
        return redirect(url_for("student_forgot_password"))
    if request.method == "POST":
        new_password = request.form.get("password")
        confirm_password = request.form.get("confirm_password")
        if new_password != confirm_password:
            flash("Passwords do not match.", "danger")
            return redirect(url_for("student_reset_password", token=token))
        if len(new_password) < 6:
            flash("Password must be at least 6 characters.", "danger")
            return redirect(url_for("student_reset_password", token=token))
        student.password = generate_password_hash(new_password)
        student.reset_token = None
        student.reset_token_expiry = None
        db.session.commit()
        flash("Password reset successful! Please login.", "success")
        return redirect(url_for("student_login"))
    return render_template("auth/student_reset_password.html", token=token)


# =====================================================
# COMPANY REGISTRATION
# =====================================================
@app.route('/register/company', methods=['GET', 'POST'])
def company_register():
    if request.method == 'POST':
        email = (request.form.get('email') or '').strip().lower()
        mobile = re.sub(r"\D", "", request.form.get('mobile') or "")
        industry = request.form.get('industry')
        if industry == 'Other':
            industry = request.form.get('industry_other', 'Other')
        if Company.query.filter(db.func.lower(Company.email) == email).first():
            flash("Email already registered", "error")
            return redirect(url_for('company_register'))
        if not re.fullmatch(r"[6-9]\d{9}", mobile):
            flash("Enter a valid 10-digit mobile number", "error")
            return redirect(url_for('company_register'))
        if Company.query.filter_by(mobile=mobile).first():
            flash("Mobile number already registered", "error")
            return redirect(url_for('company_register'))

        company_id = generate_company_id()

        try:
            company = Company(
                company_id=company_id,
                company_name=request.form.get('company_name'),
                industry=industry,
                company_size=request.form.get('company_size'),
                location=request.form.get('location'),
                website=request.form.get('website'),
                description=request.form.get('company_profile'),
                hr_contact=request.form.get('hr_contact'),
                hr_designation=request.form.get('hr_designation'),
                email=email,
                alt_email=request.form.get('alt_email'),
                mobile=mobile,
                office_number=request.form.get('office_number'),
                password=generate_password_hash(request.form.get('password')),
                approval_status='Pending',
                is_approved=False
            )
            db.session.add(company)
            db.session.commit()
        except Exception:
            db.session.rollback()
            flash("Something went wrong. Please try again.", "error")
            return redirect(url_for('company_register'))

        flash(
            f'Registration submitted! Your Company ID is {company_id}. '
            f'Account will be activated after admin approval.',
            'success'
        )
        return redirect(url_for('company_login'))

    return render_template('auth/company_register.html')


@app.route("/api/company/email-exists", methods=["GET"])
def company_email_exists():
    email = (request.args.get("email") or "").strip().lower()
    if not re.fullmatch(r"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$", email):
        return jsonify({"exists": False, "valid": False})
    exists = Company.query.filter(db.func.lower(Company.email) == email).first() is not None
    return jsonify({"exists": exists, "valid": True})


@app.route("/api/company/mobile-exists", methods=["GET"])
def company_mobile_exists():
    mobile = re.sub(r"\D", "", (request.args.get("mobile") or ""))
    if not re.fullmatch(r"[6-9]\d{9}", mobile):
        return jsonify({"exists": False, "valid": False})
    exists = Company.query.filter_by(mobile=mobile).first() is not None
    return jsonify({"exists": exists, "valid": True})


def generate_company_id():
    """Generate company login ID format: PLAX<yy>C<3-digit-seq>."""
    year = datetime.utcnow().strftime("%y")
    last_company = Company.query.order_by(Company.id.desc()).first()
    if last_company and last_company.company_id:
        try:
            last_number = int(last_company.company_id[-3:])
        except (ValueError, IndexError):
            last_number = 0
        new_number = last_number + 1
    else:
        new_number = 1
    return f"PLAX{year}C{new_number:03d}"


@app.route("/generate-company-id", methods=["GET"])
def preview_company_id():
    company_id = generate_company_id()
    return jsonify({"company_id": company_id})


# =====================================================
# COMPANY LOGIN
# =====================================================
@app.route("/login/company", methods=["GET", "POST"])
def company_login():
    if request.method == "POST":
        identifier = request.form.get("email")
        company = Company.query.filter_by(email=identifier).first()
        if not company:
            company = Company.query.filter_by(company_id=identifier).first()
        if company and check_password_hash(company.password, request.form.get("password")):
            if not company.is_active:
                flash("Your account is blacklisted.", "danger")
                return redirect(url_for("company_login"))
            if not company.is_approved:
                if (company.approval_status or "").strip().lower() == "rejected":
                    flash("Your registration was rejected by admin. Please contact admin or register again with updated details.", "danger")
                else:
                    flash("Admin approval pending.", "warning")
                return redirect(url_for("company_login"))
            login_user(company)
            return redirect(url_for("company_dashboard"))
        flash("Invalid credentials", "danger")
    return render_template("auth/company_login.html")


# =====================================================
# COMPANY FORGOT PASSWORD
# =====================================================
@app.route("/forgot-password/company", methods=["GET", "POST"])
def company_forgot_password():
    if request.method == "POST":
        identifier   = request.form.get("email", "").strip()
        lookup_type  = request.form.get("lookup_type", "email").strip()
        company_name = request.form.get("company_name", "").strip()
        mobile4      = request.form.get("mobile4", "").strip()
        new_pass     = request.form.get("password", "").strip()

        if not all([identifier, company_name, mobile4, new_pass]):
            return render_template("auth/company_forgot_password.html")

        if lookup_type == "id":
            company = Company.query.filter_by(company_id=identifier.upper()).first()
        else:
            company = Company.query.filter_by(email=identifier).first()

        if not company:
            flash("No account found with that identifier.", "error")
            return render_template("auth/company_forgot_password.html")
        if company.company_name.strip().lower() != company_name.lower():
            flash("Company name does not match our records.", "error")
            return render_template("auth/company_forgot_password.html")
        if not company.mobile or str(company.mobile)[-4:] != mobile4:
            flash("Mobile number digits do not match our records.", "error")
            return render_template("auth/company_forgot_password.html")
        if len(new_pass) < 8:
            flash("Password must be at least 8 characters.", "error")
            return render_template("auth/company_forgot_password.html")

        company.password = generate_password_hash(new_pass)
        db.session.commit()
        flash("Password reset successful! Please login with your new password.", "success")
        return redirect(url_for("company_login"))

    return render_template("auth/company_forgot_password.html")


# =====================================================
# COMPANY DASHBOARD
# =====================================================
@app.route("/company/dashboard")
@login_required
def company_dashboard():
    if not isinstance(current_user, Company):
        return redirect(url_for("home"))

    all_drives = PlacementDrive.query.filter_by(company_id=current_user.id).all()
    for d in all_drives:
        d.publish_at_ist = parse_drive_publish_datetime_ist(d)
        d.is_published_for_students = is_drive_published_to_students(d)
    upcoming_drives = [d for d in all_drives if d.status in ["Pending", "Approved"]]
    closed_drives   = [d for d in all_drives if d.status == "Closed"]
    approved_drives = len([d for d in all_drives if d.status == "Approved"])
    pending_drives  = len([d for d in all_drives if d.status == "Pending"])
    active_drives   = len([d for d in upcoming_drives if d.status == "Approved"])

    total_apps = db.session.query(db.func.count(Application.id))\
        .join(PlacementDrive)\
        .filter(PlacementDrive.company_id == current_user.id)\
        .scalar() or 0

    upcoming_drives = sorted(
        upcoming_drives,
        key=lambda d: parse_drive_deadline_datetime(d) or datetime.max
    )

    # Support tickets for this company
    company_tickets = SupportTicket.query.filter_by(
        company_id=current_user.id, submitter_type='company'
    ).order_by(SupportTicket.created_at.desc()).limit(20).all()

    # Broadcasts received from admin (target = 'company' or 'all')
    received_broadcasts = BroadcastMessage.query.filter(
        BroadcastMessage.target.in_(['company', 'all'])
    ).order_by(BroadcastMessage.sent_at.desc()).limit(30).all()

    # Broadcasts sent by this company
    sent_broadcasts = CompanyBroadcast.query.filter_by(
        company_id=current_user.id
    ).order_by(CompanyBroadcast.sent_at.desc()).limit(20).all()

    # Interview schedules
    interview_schedules = InterviewSchedule.query.filter_by(
        company_id=current_user.id
    ).order_by(InterviewSchedule.interview_date.asc(), InterviewSchedule.interview_time.asc()).all()

    # Recent activity (last 20): application status changes + explicit drive lifecycle logs
    # Include all company drives (not only approved) so pending/rejected/closed activity is visible.
    activity_items = []
    for drive in all_drives:
        for app_item in drive.applications:
            ts = app_item.status_updated_at or app_item.application_date
            ts_ist = to_ist(ts)
            app_status = (app_item.status or "Applied").strip() or "Applied"
            activity_items.append({
                "kind": "application-status",
                "created_at": ts,
                "status": app_status,
                "drive_id": drive.id,
                "application_id": app_item.id,
                "student_name": app_item.student.name if app_item.student else "Student",
                "drive_title": drive.job_title,
                "display_date": ts_ist.strftime("%d %b %Y") if ts_ist else "",
                "display_time": ts_ist.strftime("%I:%M %p") if ts_ist else "",
                "color_key": app_status.lower()
            })

    drive_logs = DriveActivityLog.query.filter_by(
        company_id=current_user.id
    ).order_by(DriveActivityLog.created_at.desc()).limit(80).all()
    for log in drive_logs:
        ts_ist = to_ist(log.created_at)
        drive_title = (
            log.drive.job_title
            if log.drive and log.drive.job_title
            else (log.summary or "Drive")
        )
        activity_items.append({
            "kind": f"drive-{log.action}",
            "created_at": log.created_at,
            "drive_id": log.drive_id,
            "drive_title": drive_title,
            "summary": log.summary or "",
            "display_date": ts_ist.strftime("%d %b %Y") if ts_ist else "",
            "display_time": ts_ist.strftime("%I:%M %p") if ts_ist else ""
        })

    activity_items = [a for a in activity_items if a.get("created_at")]
    activity_items.sort(key=lambda x: x["created_at"], reverse=True)
    recent_activities = activity_items[:20]

    # Notification seed for UI from persistent table (automatic notifications only)
    seed_notifications = CompanyNotification.query.filter(
        CompanyNotification.company_id == current_user.id,
        db.or_(
            CompanyNotification.notif_key.like("drive_auto_%"),
            CompanyNotification.notif_key.like("drive_approved_%")
        )
    ).order_by(CompanyNotification.created_at.desc()).limit(30).all()
    notification_stream_seed = []
    for n in seed_notifications:
        created_ts = n.created_at.timestamp() if n.created_at else 0
        notification_stream_seed.append({
            "kind": "notification",
            "type": n.notif_type,
            "icon": n.icon,
            "text": n.text,
            "time": format_ist_datetime(n.created_at),
            "key": n.notif_key,
            "created_at": n.created_at.strftime("%d %b %Y, %I:%M %p") if n.created_at else "",
            "sort_ts": created_ts
        })

    for bc in received_broadcasts:
        sent_at = bc.sent_at
        created_ts = sent_at.timestamp() if sent_at else 0
        notification_stream_seed.append({
            "kind": "broadcast",
            "type": "broadcast",
            "icon": "bi-megaphone-fill",
            "text": bc.message or "",
            "subject": bc.subject or "Admin Broadcast",
            "target": (bc.target or "all").capitalize(),
            "time": format_ist_datetime(sent_at),
            "key": f"broadcast_admin_{bc.id}",
            "broadcast_id": bc.id,
            "created_at": sent_at.strftime("%d %b %Y, %I:%M %p") if sent_at else "",
            "sort_ts": created_ts
        })

    notification_stream_seed.sort(key=lambda x: x.get("sort_ts", 0), reverse=True)
    notification_stream_seed = notification_stream_seed[:60]

    return render_template(
        "dashboards/company_dashboard.html",
        company=current_user,
        upcoming_drives=upcoming_drives,
        closed_drives=closed_drives,
        all_drives=all_drives,
        total_drives=len(all_drives),
        total_applications=total_apps,
        pending_drives=pending_drives,
        active_drives=active_drives,
        approved_drives=approved_drives,
        company_tickets=company_tickets,
        received_broadcasts=received_broadcasts,
        sent_broadcasts=sent_broadcasts,
        interview_schedules=interview_schedules,
        recent_activities=recent_activities,
        notifications_seed=notification_stream_seed,
        initial_section=request.args.get("section", "overview"),
        open_drive_id=request.args.get("open_drive"),
        open_app_id=request.args.get("open_app"),
        today=datetime.now(IST),
    )


# =====================================================
# COMPANY PROFILE
# =====================================================
@app.route("/company/profile")
@login_required
def company_profile():
    if not isinstance(current_user, Company):
        return redirect(url_for("home"))
    return render_template("dashboards/company_profile.html", company=current_user)


@app.route("/company/profile/edit", methods=["GET", "POST"])
@login_required
def edit_company_profile():
    if not isinstance(current_user, Company):
        return redirect(url_for("home"))
    if request.method == "POST":
        current_user.hr_contact     = request.form.get("hr_contact")
        current_user.hr_designation = request.form.get("hr_designation")
        current_user.website        = request.form.get("website")
        current_user.industry       = request.form.get("industry")
        current_user.description    = request.form.get("description")
        current_user.mobile         = request.form.get("mobile")
        current_user.company_size   = request.form.get("company_size")
        current_user.location       = request.form.get("location")
        current_user.alt_email      = request.form.get("alt_email")
        current_user.office_number  = request.form.get("office_number")
        db.session.commit()
        flash("Profile updated successfully!", "success")
        return redirect(next_section_url(default="profile"))
    return render_template("dashboards/edit_company_profile.html", company=current_user)


# =====================================================
# COMPANY SUPPORT TICKET
# =====================================================
@app.route("/company/support", methods=["POST"])
@login_required
def submit_company_support_ticket():
    if not isinstance(current_user, Company):
        return redirect(url_for("home"))

    subject  = request.form.get("subject", "").strip()
    message  = request.form.get("message", "").strip()
    category = request.form.get("category", "General")

    if not subject or not message:
        flash("Subject and message are required.", "danger")
        return redirect(url_for("company_dashboard", section="support"))

    ticket = SupportTicket(
        company_id=current_user.id,
        subject=subject,
        message=message,
        category=category,
        submitter_type="company",
        status="Open"
    )
    db.session.add(ticket)
    db.session.commit()
    flash("Support request submitted successfully!", "success")
    return redirect(url_for("company_dashboard", section="support"))


# =====================================================
# COMPANY NOTIFICATIONS API
# =====================================================
@app.route("/api/company/notifications")
@login_required
def get_company_notifications():
    if not isinstance(current_user, Company):
        return jsonify({"error": "Unauthorized"}), 403

    def persist_notification(notif_type, icon, text, notif_key, created_at):
        existing = CompanyNotification.query.filter_by(notif_key=notif_key).first()
        if existing:
            return
        db.session.add(CompanyNotification(
            company_id=current_user.id,
            notif_type=notif_type,
            icon=icon,
            text=text,
            notif_key=notif_key,
            created_at=created_at
        ))

    # Automatic drive status notifications (no broadcast here)
    auto_drives = PlacementDrive.query.filter(
        PlacementDrive.company_id == current_user.id,
        PlacementDrive.status.in_(["Approved", "Rejected", "Closed"])
    ).order_by(PlacementDrive.updated_at.desc()).limit(20).all()

    for drive in auto_drives:
        if not drive.updated_at:
            continue
        status_type = "success" if drive.status == "Approved" else "warning" if drive.status == "Closed" else "danger"
        status_icon = "bi-check-circle-fill" if drive.status == "Approved" else "bi-archive-fill" if drive.status == "Closed" else "bi-x-circle-fill"
        key = f"drive_auto_{drive.id}_{drive.status}_{int(drive.updated_at.timestamp())}"
        persist_notification(
            status_type,
            status_icon,
            f"Drive {drive.status.lower()}: <strong>{drive.job_title}</strong> ({drive.drive_id or ''})",
            key,
            drive.updated_at
        )

    db.session.commit()

    notifications = CompanyNotification.query.filter(
        CompanyNotification.company_id == current_user.id,
        db.or_(
            CompanyNotification.notif_key.like("drive_auto_%"),
            CompanyNotification.notif_key.like("drive_approved_%")
        )
    ).order_by(CompanyNotification.created_at.desc()).limit(50).all()

    broadcasts = BroadcastMessage.query.filter(
        BroadcastMessage.target.in_(["company", "all"])
    ).order_by(BroadcastMessage.sent_at.desc()).limit(50).all()

    notif_items = [
        {
            "kind": "notification",
            "type": n.notif_type,
            "icon": n.icon,
            "text": n.text,
            "time": format_ist_datetime(n.created_at),
            "key": n.notif_key,
            "sort_ts": n.created_at.timestamp() if n.created_at else 0
        }
        for n in notifications
    ]

    broadcast_items = [
        {
            "kind": "broadcast",
            "type": "broadcast",
            "icon": "bi-megaphone-fill",
            "subject": b.subject or "Admin Broadcast",
            "text": b.message or "",
            "target": (b.target or "all").capitalize(),
            "time": format_ist_datetime(b.sent_at),
            "key": f"broadcast_admin_{b.id}",
            "broadcast_id": b.id,
            "sort_ts": b.sent_at.timestamp() if b.sent_at else 0
        }
        for b in broadcasts
    ]

    stream_items = sorted(
        notif_items + broadcast_items,
        key=lambda x: x.get("sort_ts", 0),
        reverse=True
    )[:80]

    return jsonify({
        "notifications": [
            {
                "kind": "notification",
                "type": n.notif_type,
                "icon": n.icon,
                "text": n.text,
                "time": format_ist_datetime(n.created_at),
                "key": n.notif_key,
                "sort_ts": n.created_at.timestamp() if n.created_at else 0
            }
            for n in notifications
        ],
        "broadcasts": [
            {
                "kind": "broadcast",
                "type": "broadcast",
                "icon": "bi-megaphone-fill",
                "subject": b.subject or "Admin Broadcast",
                "text": b.message or "",
                "target": (b.target or "all").capitalize(),
                "time": format_ist_datetime(b.sent_at),
                "key": f"broadcast_admin_{b.id}",
                "broadcast_id": b.id,
                "sort_ts": b.sent_at.timestamp() if b.sent_at else 0
            }
            for b in broadcasts
        ],
        "items": stream_items
    })


# =====================================================
# PLACEMENT DRIVE - COMPANY
# =====================================================
@app.route("/company/drive/create", methods=["GET", "POST"])
@login_required
def create_drive():
    if not isinstance(current_user, Company):
        flash("Unauthorized access.", "danger")
        return redirect(url_for("home"))
    if not current_user.is_approved:
        flash("Admin approval required to create drives.", "warning")
        return redirect(url_for("company_dashboard"))
        
    if request.method == "POST":
        try:
            job_title = request.form.get("job_title")
            job_description = request.form.get("job_description")
            salary = request.form.get("salary")
            deadline = request.form.get("deadline")
            deadline_time_raw = request.form.get("deadline_time", "").strip()
            publish_date_raw = request.form.get("publish_date", "").strip()
            publish_time_raw = request.form.get("publish_time", "").strip()
            publish_immediately = request.form.get("publish_immediately") == "1"

            if not job_title or not job_description:
                flash("Job title and description are required.", "danger")
                return redirect(url_for("create_drive"))

            application_deadline = None
            application_deadline_time = None
            if deadline:
                try:
                    application_deadline = datetime.strptime(deadline, "%Y-%m-%d").date()
                except ValueError:
                    flash("Invalid date format.", "danger")
                    return redirect(url_for("company_dashboard"))
            if deadline_time_raw:
                try:
                    application_deadline_time = datetime.strptime(deadline_time_raw, "%H:%M").time()
                except ValueError:
                    flash("Invalid deadline time format.", "danger")
                    return redirect(url_for("company_dashboard"))

            publish_date = None
            publish_time = None
            if not publish_immediately:
                if not publish_date_raw or not publish_time_raw:
                    flash("Publish date and publish time are required, or choose immediate publish.", "danger")
                    return redirect(url_for("company_dashboard"))
                try:
                    publish_date = datetime.strptime(publish_date_raw, "%Y-%m-%d").date()
                    publish_time = datetime.strptime(publish_time_raw, "%H:%M").time()
                except ValueError:
                    flash("Invalid publish date/time format.", "danger")
                    return redirect(url_for("company_dashboard"))

            drive = PlacementDrive(
                company_id=current_user.id,
                drive_id=generate_drive_id(current_user),
                job_title=job_title,
                job_description=job_description,
                eligibility_criteria=request.form.get("eligibility"),
                required_skills=request.form.get("required_skills"),
                salary=int(salary) if salary else None,
                location=request.form.get("location"),
                application_deadline=application_deadline,
                application_deadline_time=application_deadline_time,
                publish_date=publish_date,
                publish_time=publish_time,
                job_type=request.form.get("job_type"),
                work_mode=request.form.get("work_mode"),
                experience_level=request.form.get("experience_level"),
                vacancies=int(request.form.get("vacancies")) if request.form.get("vacancies") else None,
                selection_process=request.form.get("selection_process"),
                additional_notes=request.form.get("additional_notes"),
                status="Pending"
            )
            db.session.add(drive)
            db.session.flush() # flush to get drive.id if needed, though title is fine here
            db.session.add(DriveActivityLog(
                company_id=current_user.id,
                drive_id=drive.id,
                action="created",
                summary=f"{drive.job_title} ({drive.drive_id})"
            ))

    
            db.session.commit()
            flash("Drive created successfully! Awaiting admin approval.", "success")
            return redirect(url_for("company_dashboard", section="active-drives", active_view="pending_rejected"))
            
        except Exception as e:
            db.session.rollback()
            flash(f"An error occurred: {str(e)}", "danger")
            return redirect(url_for("create_drive"))
            
    return render_template("company/create_drive.html", company=current_user)


@app.route("/company/drive/edit/<int:drive_id>", methods=["GET", "POST"])
@login_required
def edit_drive(drive_id):
    drive = PlacementDrive.query.get_or_404(drive_id)

    # Allow both the owning company AND admin to edit a drive
    is_admin = isinstance(current_user, Admin)
    is_owner = isinstance(current_user, Company) and drive.company_id == current_user.id

    if not is_admin and not is_owner:
        flash("Unauthorized access", "danger")
        return redirect(url_for("company_dashboard"))

    if request.method == "POST":
        def _clean(v):
            if v is None:
                return None
            v = v.strip()
            return v or None

        changed = []
        def track(label, old, new):
            if (old or "") != (new or ""):
                changed.append(label)

        old_title = drive.job_title
        old_desc = drive.job_description
        old_elig = drive.eligibility_criteria
        old_req = drive.required_skills
        old_job_type = drive.job_type
        old_work_mode = drive.work_mode
        old_exp = drive.experience_level
        old_loc = drive.location
        old_selection_process = drive.selection_process
        old_notes = drive.additional_notes
        old_salary = drive.salary
        old_vac = drive.vacancies
        old_deadline = drive.application_deadline
        old_deadline_time = drive.application_deadline_time
        old_publish_date = drive.publish_date
        old_publish_time = drive.publish_time
        old_target_degrees = drive.target_degrees
        old_target_years = drive.target_years
        old_status = drive.status

        drive.job_title = _clean(request.form.get("job_title"))
        drive.job_description = _clean(request.form.get("job_description"))
        drive.eligibility_criteria = _clean(request.form.get("eligibility"))
        drive.required_skills = _clean(request.form.get("required_skills"))

        job_type = _clean(request.form.get("job_type"))
        allowed_job_types = {"Full-time", "Internship", "Contract", "Part-time"}
        if not job_type or job_type not in allowed_job_types:
            flash("Please select a valid job type.", "warning")
            return redirect(url_for("admin_dashboard") if is_admin else url_for("company_dashboard"))
        drive.job_type = job_type

        work_mode = _clean(request.form.get("work_mode"))
        allowed_work_modes = {"On-site", "Remote", "Hybrid"}
        if work_mode and work_mode not in allowed_work_modes:
            flash("Please select a valid work mode.", "warning")
            return redirect(url_for("admin_dashboard") if is_admin else url_for("company_dashboard"))
        drive.work_mode = work_mode

        experience_level = _clean(request.form.get("experience_level"))
        allowed_experience = {
            "Fresher (0 years)",
            "Junior (0–2 years)",
            "Mid (2–5 years)",
            "Senior (5+ years)"
        }
        if experience_level and experience_level not in allowed_experience:
            flash("Please select a valid experience level.", "warning")
            return redirect(url_for("admin_dashboard") if is_admin else url_for("company_dashboard"))
        drive.experience_level = experience_level

        drive.location = _clean(request.form.get("location"))
        drive.selection_process = _clean(request.form.get("selection_process"))
        drive.additional_notes = _clean(request.form.get("additional_notes"))

        if not drive.job_title or len(drive.job_title) < 3:
            flash("Job title must be at least 3 characters.", "warning")
            return redirect(url_for("admin_dashboard") if is_admin else url_for("company_dashboard"))
        if not drive.job_description or len(drive.job_description) < 20:
            flash("Job description must be at least 20 characters.", "warning")
            return redirect(url_for("admin_dashboard") if is_admin else url_for("company_dashboard"))

        salary = request.form.get("salary")
        drive.salary = int(salary) if salary else None
        if drive.salary is not None and drive.salary < 0:
            flash("Salary cannot be negative.", "warning")
            return redirect(url_for("admin_dashboard") if is_admin else url_for("company_dashboard"))
        vacancies = request.form.get("vacancies")
        drive.vacancies = int(vacancies) if vacancies else None
        if drive.vacancies is not None and drive.vacancies < 1:
            flash("Vacancies must be at least 1.", "warning")
            return redirect(url_for("admin_dashboard") if is_admin else url_for("company_dashboard"))
        deadline = request.form.get("deadline")
        deadline_time_raw = request.form.get("deadline_time", "").strip()
        publish_date_raw = request.form.get("publish_date", "").strip()
        publish_time_raw = request.form.get("publish_time", "").strip()
        if deadline:
            try:
                drive.application_deadline = datetime.strptime(deadline, "%Y-%m-%d").date()
            except ValueError:
                flash("Invalid date format.", "danger")
                return redirect(url_for("admin_dashboard") if is_admin else url_for("company_dashboard"))
        else:
            drive.application_deadline = None
        if deadline_time_raw:
            try:
                drive.application_deadline_time = datetime.strptime(deadline_time_raw, "%H:%M").time()
            except ValueError:
                flash("Invalid deadline time format.", "danger")
                return redirect(url_for("admin_dashboard") if is_admin else url_for("company_dashboard"))
        else:
            drive.application_deadline_time = None

        if publish_date_raw and publish_time_raw:
            try:
                drive.publish_date = datetime.strptime(publish_date_raw, "%Y-%m-%d").date()
                drive.publish_time = datetime.strptime(publish_time_raw, "%H:%M").time()
            except ValueError:
                flash("Invalid publish date/time format.", "danger")
                return redirect(url_for("admin_dashboard") if is_admin else url_for("company_dashboard"))
        elif publish_date_raw or publish_time_raw:
            flash("Both publish date and publish time are required.", "warning")
            return redirect(url_for("admin_dashboard") if is_admin else url_for("company_dashboard"))
        else:
            drive.publish_date = None
            drive.publish_time = None

        if is_admin:
            allow_all_audience = (request.form.get("allow_all_audience") or "").strip().lower() in {"1", "true", "on", "yes"}
            if allow_all_audience:
                drive.target_degrees = None
                drive.target_years = None
            else:
                target_degrees = []
                for d in (request.form.getlist("target_degrees") + request.form.getlist("target_degrees[]")):
                    n = _norm_text(d)
                    if n and n not in [_norm_text(x) for x in target_degrees]:
                        target_degrees.append(d.strip())

                target_years = []
                for y in (request.form.getlist("target_years") + request.form.getlist("target_years[]")):
                    n = _norm_text(y)
                    if n and n not in [_norm_text(x) for x in target_years]:
                        target_years.append(y.strip())

                if not target_degrees or not target_years:
                    flash("Select target degrees and years, or enable 'Allow all students'.", "warning")
                    return redirect(url_for("admin_dashboard"))

                drive.target_degrees = ", ".join(target_degrees)
                drive.target_years = ", ".join(target_years)

        track("job title", old_title, drive.job_title)
        track("job description", old_desc, drive.job_description)
        track("eligibility", old_elig, drive.eligibility_criteria)
        track("required skills", old_req, drive.required_skills)
        track("job type", old_job_type, drive.job_type)
        track("work mode", old_work_mode, drive.work_mode)
        track("experience level", old_exp, drive.experience_level)
        track("location", old_loc, drive.location)
        track("selection process", old_selection_process, drive.selection_process)
        track("additional notes", old_notes, drive.additional_notes)
        if old_salary != drive.salary:
            changed.append("salary")
        if old_vac != drive.vacancies:
            changed.append("vacancies")
        if old_deadline != drive.application_deadline:
            changed.append("deadline date")
        if old_deadline_time != drive.application_deadline_time:
            changed.append("deadline time")
        if old_publish_date != drive.publish_date:
            changed.append("publish date")
        if old_publish_time != drive.publish_time:
            changed.append("publish time")
        if old_target_degrees != drive.target_degrees:
            changed.append("target degrees")
        if old_target_years != drive.target_years:
            changed.append("target years")

        # Company re-submission flow: editing a rejected drive sends it back for admin review.
        if is_owner and old_status == "Rejected":
            drive.status = "Pending"
            changed.append("resubmitted for approval")

        if changed and is_owner:
            db.session.add(DriveActivityLog(
                company_id=current_user.id,
                drive_id=drive.id,
                action="edited",
                summary=f"{drive.job_title}: " + ", ".join(changed[:6]) + ("..." if len(changed) > 6 else "")
            ))

        drive.updated_at = datetime.utcnow()
        db.session.commit()
        if is_owner and old_status == "Rejected":
            flash("Drive updated and re-submitted for admin approval.", "success")
        else:
            flash("Drive updated successfully", "success")
        if is_admin:
            return redirect(url_for("admin_dashboard"))
        return redirect(next_section_url(default="active-drives"))

    # GET — render edit form (reuse company template or admin can use modal)
    return render_template("company/create_drive.html", company=current_user if is_owner else drive.company, drive=drive, edit_mode=True)


@app.route("/company/drive/close/<int:drive_id>")
@login_required
def close_drive(drive_id):
    drive = PlacementDrive.query.get_or_404(drive_id)
    if isinstance(current_user, Company) and drive.company_id == current_user.id:
        drive.status = "Closed"
        drive.closed_at = datetime.utcnow()
        drive.updated_at = datetime.utcnow()
        db.session.add(DriveActivityLog(
            company_id=current_user.id,
            drive_id=drive.id,
            action="closed",
            summary=f"{drive.job_title}"
        ))
        db.session.commit()
        flash("Drive has been closed to new applications.", "warning")
    return redirect(next_section_url(default="active-drives"))


@app.route("/company/drive/reopen/<int:drive_id>")
@login_required
def reopen_drive(drive_id):
    drive = PlacementDrive.query.get_or_404(drive_id)
    if isinstance(current_user, Company) and drive.company_id == current_user.id:
        if drive.status != "Closed":
            flash("Only closed drives can be reopened.", "warning")
            return redirect(next_section_url(default="closed-drives"))
        drive.status = "Approved"
        drive.closed_at = None
        drive.updated_at = datetime.utcnow()
        db.session.add(DriveActivityLog(
            company_id=current_user.id,
            drive_id=drive.id,
            action="reopened",
            summary=f"{drive.job_title}"
        ))
        db.session.commit()
        flash("Drive reopened successfully.", "success")
    return redirect(next_section_url(default="active-drives"))


@app.route("/company/drive/delete/<int:drive_id>")
@login_required
def delete_drive(drive_id):
    drive = PlacementDrive.query.get_or_404(drive_id)
    if isinstance(current_user, Company) and drive.company_id == current_user.id:
        db.session.delete(drive)
        db.session.commit()
        flash("Drive deleted successfully.", "info")
    return redirect(next_section_url(default="active-drives"))


@app.route("/company/drive/<int:drive_id>/details")
@login_required
def view_drive_details(drive_id):
    drive = PlacementDrive.query.get_or_404(drive_id)
    if not isinstance(current_user, Company) or drive.company_id != current_user.id:
        flash("Unauthorized access", "danger")
        return redirect(url_for("company_dashboard"))
    return render_template("company/drive_details.html", drive=drive)


# =====================================================
# VIEW DRIVE APPLICATIONS (COMPANY)
# =====================================================
@app.route("/company/drive/<int:drive_id>/applications")
@login_required
def view_drive_applications(drive_id):
    if not isinstance(current_user, Company):
        return redirect(url_for("home"))
    drive = PlacementDrive.query.get_or_404(drive_id)
    if drive.company_id != current_user.id:
        return redirect(url_for("company_dashboard"))
    applications = Application.query.filter_by(drive_id=drive_id).all()
    return render_template(
        "company/drive_applications.html",
        drive=drive,
        applications=applications
    )


# =====================================================
# REVIEW APPLICATION (COMPANY)
# =====================================================
@app.route("/company/application/review/<int:app_id>", methods=["GET", "POST"])
@login_required
def review_application(app_id):
    if not isinstance(current_user, Company):
        return redirect(url_for("home"))
    application = Application.query.get_or_404(app_id)
    if application.drive.company_id != current_user.id:
        return redirect(url_for("company_dashboard"))
    if request.method == "POST":
        # Supports both full-page form posts and AJAX status updates from modal views.
        is_ajax = request.headers.get("X-Requested-With") == "XMLHttpRequest"
        new_status = request.form.get("status")
        allowed = ["Shortlisted", "Interview", "Placed", "Rejected"]
        if new_status not in allowed:
            if is_ajax:
                return jsonify({"success": False, "error": "Invalid status."}), 400
            flash("Invalid status.", "danger")
            return redirect(next_section_url(default="pipeline"))
        prev_status = (application.status or "").strip()
        status_changed = prev_status != new_status

        application.status        = new_status
        application.remark        = request.form.get("remark")
        application.internal_note = request.form.get("internal_note")
        if status_changed:
            application.status_updated_at = datetime.utcnow()
        elif not application.status_updated_at:
            application.status_updated_at = datetime.utcnow()

        if new_status == "Interview":
            # Interview status requires schedule metadata (date/time/mode).
            interview_date_raw = (request.form.get("interview_date") or "").strip()
            interview_time_raw = (request.form.get("interview_time") or "").strip()
            interview_mode = (request.form.get("interview_mode") or "Online").strip()
            interview_notes = (request.form.get("interview_notes") or "").strip()
            if not interview_date_raw or not interview_time_raw:
                if is_ajax:
                    return jsonify({"success": False, "error": "Interview date and time are required for Interview status."}), 400
                flash("Interview date and time are required for Interview status.", "danger")
                return redirect(next_section_url(default="pipeline"))
            try:
                interview_date = datetime.strptime(interview_date_raw, "%Y-%m-%d").date()
                interview_time = datetime.strptime(interview_time_raw, "%H:%M").time()
            except ValueError:
                if is_ajax:
                    return jsonify({"success": False, "error": "Invalid interview date/time."}), 400
                flash("Invalid interview date/time.", "danger")
                return redirect(next_section_url(default="pipeline"))

            # Upsert interview schedule so re-scheduling updates same row.
            schedule = InterviewSchedule.query.filter_by(application_id=application.id).first()
            if not schedule:
                schedule = InterviewSchedule(
                    company_id=current_user.id,
                    drive_id=application.drive_id,
                    application_id=application.id
                )
                db.session.add(schedule)
            schedule.interview_date = interview_date
            schedule.interview_time = interview_time
            schedule.mode = interview_mode or "Online"
            schedule.notes = interview_notes
            schedule.schedule_status = "Scheduled"
            schedule.status_updated_at = datetime.utcnow()

        # Persist student status notification immediately at status-change time
        # so student dashboard reflects update on next refresh/poll.
        if status_changed:
            notif_ts = application.status_updated_at or datetime.utcnow()
            notif_key = (
                f"student_{application.student_id}_app_status_{application.id}_"
                f"{new_status.lower()}_{int(notif_ts.timestamp() * 1000000)}"
            )
            interview_suffix = ""
            if new_status == "Interview":
                sched_now = InterviewSchedule.query.filter_by(application_id=application.id).first()
                if sched_now and sched_now.interview_date and sched_now.interview_time:
                    interview_suffix = (
                        f" · Date: {sched_now.interview_date.strftime('%d %b %Y')}"
                        f" · Time: {sched_now.interview_time.strftime('%I:%M %p')}"
                    )
            status_meta = {
                "Placed": ("success", "bi-trophy-fill",
                            f"Accepted (Placed): <strong>{application.drive.job_title}</strong> at {application.drive.company.company_name}"),
                "Shortlisted": ("warning", "bi-star-fill",
                                f"Shortlisted for <strong>{application.drive.job_title}</strong> at {application.drive.company.company_name}"),
                "Rejected": ("info", "bi-info-circle-fill",
                            f"Application update: Not moved forward for <strong>{application.drive.job_title}</strong> at {application.drive.company.company_name}")
            }
            n_type, n_icon, n_text = status_meta.get(new_status, ("info", "bi-info-circle-fill", "Application status updated."))
            if new_status != "Interview" and not StudentNotification.query.filter_by(notif_key=notif_key).first():
                db.session.add(StudentNotification(
                    student_id=application.student_id,
                    notif_type=n_type,
                    icon=n_icon,
                    text=n_text,
                    notif_key=notif_key,
                    created_at=notif_ts,
                    is_read=False
                ))

        db.session.commit()
        if is_ajax:
            return jsonify({
                "success": True,
                "application_id": application.id,
                "status": application.status,
                "remark": application.remark or "",
                "internal_note": application.internal_note or ""
            })
        flash("Application status updated.", "success")
        return redirect(next_section_url(default="pipeline"))
    return render_template("company/review_application.html", application=application)


@app.route("/company/interview/<int:schedule_id>/status", methods=["POST"])
@login_required
def update_interview_status(schedule_id):
    if not isinstance(current_user, Company):
        return jsonify({"error": "Unauthorized"}), 403

    schedule = InterviewSchedule.query.get_or_404(schedule_id)
    if schedule.company_id != current_user.id:
        return jsonify({"error": "Unauthorized"}), 403

    new_status = (request.form.get("status") or "").strip().capitalize()
    allowed = {"Scheduled", "Cancelled", "Completed"}
    if new_status not in allowed:
        return jsonify({"error": "Invalid interview status"}), 400

    schedule.schedule_status = new_status
    schedule.status_updated_at = datetime.utcnow()

    if new_status == "Cancelled" and schedule.application and schedule.application.status == "Interview":
        schedule.application.status = "Shortlisted"
        schedule.application.status_updated_at = datetime.utcnow()

    db.session.commit()

    return jsonify({
        "success": True,
        "schedule_id": schedule.id,
        "status": schedule.schedule_status
    })


@app.route("/student/interview/<int:schedule_id>/status", methods=["POST"])
@login_required
def student_update_interview_status(schedule_id):
    if not isinstance(current_user, Student):
        return redirect(url_for("home"))

    schedule = InterviewSchedule.query.get_or_404(schedule_id)
    if not schedule.application or schedule.application.student_id != current_user.id:
        flash("Unauthorized interview action.", "danger")
        return redirect(url_for("student_dashboard", section="applications"))

    new_status = (request.form.get("status") or "").strip().capitalize()
    if new_status not in {"Completed", "Cancelled"}:
        flash("Invalid interview status.", "danger")
        return redirect(url_for("student_dashboard", section="applications"))

    if (schedule.schedule_status or "").strip().capitalize() != "Scheduled":
        flash("Only scheduled interviews can be updated.", "warning")
        return redirect(url_for("student_dashboard", section="applications"))

    schedule.schedule_status = new_status
    schedule.status_updated_at = datetime.utcnow()

    if new_status == "Cancelled" and schedule.application.status == "Interview":
        schedule.application.status = "Shortlisted"
        schedule.application.status_updated_at = datetime.utcnow()

    db.session.commit()
    flash(
        "Interview marked as completed." if new_status == "Completed" else "Interview cancelled.",
        "success" if new_status == "Completed" else "warning"
    )
    return redirect(url_for("student_dashboard", section="applications"))


# =====================================================
# ADMIN LOGIN
# =====================================================
@app.route("/login/admin", methods=["GET", "POST"])
def admin_login():
    if request.method == "POST":
        admin = Admin.query.filter_by(email=request.form.get("email")).first()
        if admin and check_password_hash(admin.password, request.form.get("password")):
            login_user(admin)
            return redirect(url_for("admin_dashboard"))
        flash("Invalid admin credentials", "danger")
    return render_template("auth/admin_login.html")


# =====================================================
# ADMIN DASHBOARD
# =====================================================
@app.route("/admin/dashboard")
@login_required
def admin_dashboard():
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))

    search_query = request.args.get("search", "").strip()
    search_type  = request.args.get("search_type", "all").strip()

    # Base queries
    students_query  = Student.query
    companies_query = Company.query.filter_by(is_approved=True)

    if search_query:
        if search_type in ["student", "all"]:
            students_query = students_query.filter(
                (Student.name.ilike(f"%{search_query}%")) |
                (Student.email.ilike(f"%{search_query}%")) |
                (Student.contact.ilike(f"%{search_query}%")) |
                (Student.student_id.ilike(f"%{search_query}%")) |
                (Student.college.ilike(f"%{search_query}%")) |
                (Student.degree.ilike(f"%{search_query}%"))
            )
        else:
            students_query = students_query.filter(False)

        if search_type in ["company", "all"]:
            companies_query = companies_query.filter(
                (Company.company_name.ilike(f"%{search_query}%")) |
                (Company.email.ilike(f"%{search_query}%")) |
                (Company.company_id.ilike(f"%{search_query}%")) |
                (Company.industry.ilike(f"%{search_query}%"))
            )
        else:
            companies_query = companies_query.filter(False)

    students  = students_query.all()
    companies = companies_query.all()

    ongoing_drives = sorted(
        PlacementDrive.query.all(),
        key=lambda d: len(d.applications),
        reverse=True
    )
    for d in ongoing_drives:
        d.publish_at_ist = parse_drive_publish_datetime_ist(d)
        d.is_published_for_students = is_drive_published_to_students(d)

    # Placement rate
    students_count = Student.query.count()
    placed_count   = Application.query.filter_by(status="Placed").count()
    placement_rate = round((placed_count / students_count) * 100, 1) if students_count > 0 else 0

    # Support tickets stats for sidebar badge
    open_tickets_count = SupportTicket.query.filter_by(status="Open").count()

    # JSON for global search (enriched with all searchable fields)
    students_json = [
        {
            "id":         s.id,
            "name":       s.name,
            "email":      s.email,
            "student_id": s.student_id or "",
            "college":    s.college or "",
            "degree":     s.degree or "",
            "contact":    s.contact or ""
        }
        for s in students
    ]

    companies_json = [
        {
            "id":              c.id,
            "company_name":    c.company_name,
            "company_id":      c.company_id or "",
            "email":           c.email,
            "industry":        c.industry or "",
            "approval_status": c.approval_status
        }
        for c in companies
    ]

    # Broadcast history (last 20)
    broadcast_history = BroadcastMessage.query.order_by(
        BroadcastMessage.sent_at.desc()
    ).limit(20).all()

    # Support tickets
    support_tickets = SupportTicket.query.order_by(
        SupportTicket.created_at.desc()
    ).limit(50).all()

    return render_template(
        "dashboards/admin_dashboard.html",

        # Stats
        students_count=students_count,
        companies_count=Company.query.count(),
        drives_count=PlacementDrive.query.count(),
        apps_count=Application.query.count(),
        placed_students_count=placed_count,
        placement_rate=placement_rate,
        open_tickets_count=open_tickets_count,
        deleted_students_count=DeletedStudentLog.query.count(),
        deleted_companies_count=DeletedCompanyLog.query.count(),

        # Dashboard data
        pending_companies=Company.query.filter_by(is_approved=False, approval_status="Pending").all(),
        registered_students=students,
        registered_companies=companies,
        history_students=Student.query.order_by(Student.created_at.desc()).all(),
        deleted_students_history=DeletedStudentLog.query.order_by(DeletedStudentLog.deleted_at.desc()).all(),
        history_companies=Company.query.order_by(Company.created_at.desc()).all(),
        deleted_companies_history=DeletedCompanyLog.query.order_by(DeletedCompanyLog.deleted_at.desc()).all(),
        ongoing_drives=ongoing_drives,
        student_applications=Application.query.all(),

        # Search
        search_query=search_query,
        search_type=search_type,

        # JSON for JS
        students_json=students_json,
        companies_json=companies_json,

        # Broadcast & support
        broadcast_history=broadcast_history,
        support_tickets=support_tickets,
    )


# =====================================================
# ADMIN — APPROVE / REJECT COMPANY
# =====================================================
@app.route("/admin/company/approve/<int:company_id>")
@login_required
def approve_company(company_id):
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    company = Company.query.get_or_404(company_id)
    company.is_approved     = True
    company.approval_status = "Approved"
    db.session.commit()
    flash(f"Company '{company.company_name}' approved successfully.", "success")
    return redirect(admin_next_section_url(default="pending"))


@app.route("/admin/company/reject/<int:company_id>", methods=["POST"])
@login_required
def reject_company(company_id):
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    company = Company.query.get_or_404(company_id)
    # Soft-reject: keep record, mark as Rejected (don't delete)
    company.is_approved     = False
    company.approval_status = "Rejected"
    db.session.commit()
    flash(f"Company '{company.company_name}' registration rejected.", "warning")
    return redirect(admin_next_section_url(default="pending"))


# =====================================================
# ADMIN — APPROVE / REJECT DRIVE
# =====================================================
@app.route("/admin/drive/approve/<int:drive_id>", methods=["POST"])
@login_required
def approve_drive(drive_id):
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    drive = PlacementDrive.query.get_or_404(drive_id)

    allow_all_audience = (request.form.get("allow_all_audience") or "").strip().lower() in {"1", "true", "on", "yes"}

    target_degrees = []
    for d in (request.form.getlist("target_degrees") + request.form.getlist("target_degrees[]")):
        n = _norm_text(d)
        if n and n not in [_norm_text(x) for x in target_degrees]:
            target_degrees.append(d.strip())

    target_years = []
    for y in (request.form.getlist("target_years") + request.form.getlist("target_years[]")):
        n = _norm_text(y)
        if n and n not in [_norm_text(x) for x in target_years]:
            target_years.append(y.strip())

    if allow_all_audience:
        drive.target_degrees = None
        drive.target_years = None
    else:
        if not target_degrees or not target_years:
            flash("Please select target degrees and target years, or choose Send to all students.", "warning")
            return redirect(admin_next_section_url(default="pending"))
        drive.target_degrees = ", ".join(target_degrees)
        drive.target_years = ", ".join(target_years)
    drive.status = "Approved"
    drive.updated_at = datetime.utcnow()
    db.session.commit()
    flash(f"Drive '{drive.job_title}' approved with targeting rules.", "success")
    return redirect(admin_next_section_url(default="pending"))


@app.route("/admin/drive/reject/<int:drive_id>", methods=["POST"])
@login_required
def reject_drive(drive_id):
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    drive = PlacementDrive.query.get_or_404(drive_id)
    drive.status = "Rejected"
    drive.updated_at = datetime.utcnow()
    db.session.commit()
    flash("Placement drive rejected.", "warning")
    return redirect(admin_next_section_url(default="pending"))


@app.route("/admin/drive/close/<int:drive_id>")
@login_required
def admin_close_drive(drive_id):
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    drive = PlacementDrive.query.get_or_404(drive_id)
    try:
        drive.status    = "Closed"
        drive.closed_at = datetime.utcnow()
        drive.updated_at = datetime.utcnow()
        db.session.commit()
        flash(f"Drive '{drive.job_title}' has been closed.", "warning")
    except Exception as e:
        db.session.rollback()
        flash("An error occurred while closing the drive.", "danger")
    return redirect(admin_next_section_url(default="drives"))


@app.route("/admin/drive/reopen/<int:drive_id>")
@login_required
def admin_reopen_drive(drive_id):
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    drive = PlacementDrive.query.get_or_404(drive_id)
    try:
        drive.status = "Approved"
        drive.updated_at = datetime.utcnow()
        drive.closed_at = None
        db.session.commit()
        flash(f"Drive '{drive.job_title}' has been reopened.", "success")
    except Exception:
        db.session.rollback()
        flash("An error occurred while reopening the drive.", "danger")
    return redirect(admin_next_section_url(default="drives"))


# =====================================================
# ADMIN — BLACKLIST / ACTIVATE USERS
# =====================================================
@app.route("/admin/blacklist/<string:user_type>/<int:user_id>", methods=["GET", "POST"])
@login_required
def blacklist_user(user_type, user_id):
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    if user_type == "student":
        user = Student.query.get_or_404(user_id)
        user.is_active = False
    elif user_type == "company":
        user = Company.query.get_or_404(user_id)
        user.is_active = False
        PlacementDrive.query.filter_by(company_id=user_id).update({"status": "Closed"})
    db.session.commit()
    flash(f"{user_type.capitalize()} blacklisted.", "danger")
    fallback = "students" if user_type == "student" else "companies"
    return redirect(admin_next_section_url(default=fallback))


@app.route("/admin/activate/<string:user_type>/<int:user_id>", methods=["GET", "POST"])
@login_required
def activate_user(user_type, user_id):
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    if user_type == "student":
        user = Student.query.get_or_404(user_id)
        user.is_active = True
        flash("Student account activated successfully.", "success")
    elif user_type == "company":
        user = Company.query.get_or_404(user_id)
        user.is_active = True
        flash("Company account activated successfully.", "success")
    db.session.commit()
    fallback = "students" if user_type == "student" else "companies"
    return redirect(admin_next_section_url(default=fallback))


# =====================================================
# ADMIN — EDIT STUDENT
# =====================================================
@app.route("/admin/student/edit/<int:student_id>", methods=["POST"])
@login_required
def admin_edit_student(student_id):
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    student = Student.query.get_or_404(student_id)

    student.name    = request.form.get("name")
    student.email   = request.form.get("email")
    student.contact = request.form.get("contact")
    student.dob     = request.form.get("dob")
    student.college = request.form.get("college")
    student.degree  = request.form.get("degree")
    student.branch  = request.form.get("branch")
    student.year_of_study = request.form.get("year_of_study")
    student.graduation_year = request.form.get("graduation_year")
    student.skills  = request.form.get("skills")
    student.linkedin = request.form.get("linkedin")
    student.github   = request.form.get("github")

    cgpa_raw = request.form.get("cgpa")
    student.cgpa = parse_cgpa_input(cgpa_raw)

    tenth = request.form.get("tenth_percent")
    student.tenth_percent = float(tenth) if tenth else None

    twelfth = request.form.get("twelfth_percent")
    student.twelfth_percent = float(twelfth) if twelfth else None

    db.session.commit()
    flash("Student profile updated successfully.", "success")
    return redirect(admin_next_section_url(default="students"))


# =====================================================
# ADMIN — EDIT COMPANY
# =====================================================
@app.route("/admin/company/edit/<int:company_id>", methods=["POST"])
@login_required
def admin_edit_company(company_id):
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    company = Company.query.get_or_404(company_id)

    company.company_name   = request.form.get("company_name")
    company.email          = request.form.get("email")
    company.industry       = request.form.get("industry")
    company.website        = request.form.get("website")
    company.hr_contact     = request.form.get("hr_contact")
    company.hr_designation = request.form.get("hr_designation")
    company.mobile         = request.form.get("mobile")
    company.location       = request.form.get("location")
    company.company_size   = request.form.get("company_size")
    company.alt_email      = request.form.get("alt_email")
    company.description    = request.form.get("description")

    db.session.commit()
    flash("Company profile updated successfully.", "success")
    return redirect(admin_next_section_url(default="companies"))


# =====================================================
# ADMIN — DELETE STUDENT / COMPANY  (GET routes for <a> tag links)
# =====================================================
@app.route("/admin/delete-student/<int:student_id>", methods=["POST"])
@login_required
def admin_delete_student(student_id):
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    student = Student.query.get_or_404(student_id)

    # Preserve student snapshot before delete for optional audit log.
    student_snapshot = {
        "original_student_pk": student.id,
        "student_id": student.student_id,
        "name": student.name,
        "email": student.email,
        "college": student.college,
        "degree": student.degree,
    }

    try:
        # Explicit cleanup for dependent rows to avoid FK/ORM delete-order issues.
        application_ids = [a.id for a in Application.query.with_entities(Application.id).filter_by(student_id=student.id).all()]
        if application_ids:
            InterviewSchedule.query.filter(InterviewSchedule.application_id.in_(application_ids)).delete(synchronize_session=False)
        StudentNotification.query.filter_by(student_id=student.id).delete(synchronize_session=False)
        StudentDriveView.query.filter_by(student_id=student.id).delete(synchronize_session=False)
        Application.query.filter_by(student_id=student.id).delete(synchronize_session=False)
        SupportTicket.query.filter_by(student_id=student.id).delete(synchronize_session=False)

        db.session.delete(student)
        db.session.commit()
    except SQLAlchemyError as e:
        db.session.rollback()
        app.logger.exception("admin_delete_student failed for student_id=%s", student.id)
        flash("Unable to delete student due to related records. Please try again.", "danger")
        return redirect(admin_next_section_url(default="students"))

    # Best-effort audit logging; should never block deletion success.
    try:
        deleted_log = DeletedStudentLog(
            deleted_by_admin_id=current_user.id,
            **student_snapshot
        )
        db.session.add(deleted_log)
        db.session.commit()
        flash("Student deleted successfully.", "success")
    except SQLAlchemyError:
        db.session.rollback()
        flash("Student deleted successfully (history log could not be saved).", "warning")

    return redirect(admin_next_section_url(default="students"))


@app.route("/admin/delete-company/<int:company_id>", methods=["POST"])
@login_required
def admin_delete_company(company_id):
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    company = Company.query.get_or_404(company_id)
    company_snapshot = {
        "original_company_pk": company.id,
        "company_id": company.company_id,
        "company_name": company.company_name,
        "email": company.email,
        "industry": company.industry,
        "approval_status": company.approval_status,
    }
    try:
        # Explicitly clear relations that are not configured with delete-orphan on ORM side.
        CompanyBroadcast.query.filter_by(company_id=company.id).delete(synchronize_session=False)
        InterviewSchedule.query.filter_by(company_id=company.id).delete(synchronize_session=False)

        db.session.delete(company)
        db.session.commit()
    except SQLAlchemyError as e:
        db.session.rollback()
        flash("Unable to delete company due to related records. Please try again.", "danger")
        return redirect(admin_next_section_url(default="companies"))

    # Best-effort audit logging; should never block deletion success.
    try:
        deleted_log = DeletedCompanyLog(
            deleted_by_admin_id=current_user.id,
            **company_snapshot
        )
        db.session.add(deleted_log)
        db.session.commit()
        flash("Company and all associated data deleted successfully.", "success")
    except SQLAlchemyError:
        db.session.rollback()
        flash("Company deleted successfully (history log could not be saved).", "warning")
    return redirect(admin_next_section_url(default="companies"))


# =====================================================
# ADMIN — VIEW STUDENT / COMPANY DETAIL PAGES
# =====================================================
@app.route("/admin/student/<int:student_id>")
@login_required
def admin_view_student(student_id):
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    student = Student.query.get_or_404(student_id)
    applications = Application.query.filter_by(student_id=student.id).all()
    return render_template("admin/view_student.html", student=student, applications=applications)


@app.route("/admin/company/<int:company_id>")
@login_required
def admin_view_company(company_id):
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    company = Company.query.get_or_404(company_id)
    drives  = PlacementDrive.query.filter_by(company_id=company.id).all()
    return render_template("admin/view_company.html", company=company, drives=drives)


@app.route("/admin/students/report")
@login_required
def admin_students_report():
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    # Download reports feature disabled
    return ("Download reports are currently disabled.", 410)

    report_mode = (_get_str_arg("report_mode") or "detailed").lower()
    search = _get_str_arg("search").lower()
    status = _get_str_arg("status").lower()
    degree = _get_str_arg("degree").lower()
    college = _get_str_arg("college").lower()
    year_of_study = _get_str_arg("year_of_study").lower()
    graduation_year = _get_str_arg("graduation_year").lower()
    app_status = _get_str_arg("app_status").lower()
    registered_year = _get_int_arg("registered_year")
    registered_month = _get_int_arg("registered_month")
    reg_from = _get_date_arg("registered_from")
    reg_to = _get_date_arg("registered_to")
    cgpa_min = _get_float_arg("cgpa_min")
    cgpa_max = _get_float_arg("cgpa_max")

    students = Student.query.order_by(Student.created_at.desc(), Student.id.desc()).all()
    if status in ("active", "blacklisted"):
        should_be_active = status == "active"
        students = [s for s in students if bool(s.is_active) == should_be_active]
    if search:
        students = [
            s for s in students
            if search in " ".join([
                s.student_id or "",
                s.name or "",
                s.email or "",
                s.contact or "",
                s.college or "",
                s.degree or "",
                s.branch or ""
            ]).lower()
        ]
    if degree:
        students = [s for s in students if degree in (s.degree or "").lower()]
    if college:
        students = [s for s in students if college in (s.college or "").lower()]
    if year_of_study:
        students = [s for s in students if year_of_study == (s.year_of_study or "").strip().lower()]
    if graduation_year:
        students = [s for s in students if graduation_year in str(s.graduation_year or "").lower()]
    if app_status:
        students = [
            s for s in students
            if any((a.status or "").strip().lower() == app_status for a in (s.applications or []))
        ]
    if reg_from or reg_to:
        students = [s for s in students if _in_date_range(s.created_at, reg_from, reg_to)]
    if registered_year is not None:
        students = [s for s in students if s.created_at and s.created_at.year == registered_year]
    if registered_month is not None:
        students = [s for s in students if s.created_at and s.created_at.month == registered_month]
    if cgpa_min is not None:
        students = [s for s in students if (s.cgpa is not None and s.cgpa >= cgpa_min)]
    if cgpa_max is not None:
        students = [s for s in students if (s.cgpa is not None and s.cgpa <= cgpa_max)]

    out = io.StringIO()
    writer = csv.writer(out)

    writer.writerow(["All Students Report"])
    writer.writerow(["Generated At (IST)", format_ist_datetime(datetime.utcnow())])
    writer.writerow(["Total Students (Filtered)", len(students)])
    writer.writerow(["Report Type", "Detailed" if report_mode == "detailed" else "Summary"])
    writer.writerow(["Applied Filter: Search", search or "None"])
    writer.writerow(["Applied Filter: Status", status or "All"])
    writer.writerow(["Applied Filter: Degree", degree or "All"])
    writer.writerow(["Applied Filter: College", college or "All"])
    writer.writerow(["Applied Filter: Year Of Study", year_of_study or "All"])
    writer.writerow(["Applied Filter: Graduation Year", graduation_year or "All"])
    writer.writerow(["Applied Filter: App Status", app_status or "All"])
    writer.writerow(["Applied Filter: Registered Year", registered_year if registered_year is not None else "All"])
    writer.writerow(["Applied Filter: Registered Month", registered_month if registered_month is not None else "All"])
    writer.writerow(["Applied Filter: Registered Date", f"{reg_from or 'Any'} to {reg_to or 'Any'}"])
    writer.writerow(["Applied Filter: CGPA", f"{cgpa_min if cgpa_min is not None else 'Any'} to {cgpa_max if cgpa_max is not None else 'Any'}"])
    writer.writerow([])

    writer.writerow([
        "Student ID",
        "Student DB ID",
        "Name",
        "Email",
        "Contact",
        "College",
        "Degree",
        "Branch",
        "Year Of Study",
        "CGPA",
        "Graduation Year",
        "Status",
        "Applications",
        "Applied",
        "Shortlisted",
        "Interview",
        "Placed",
        "Rejected",
        "Registered On (IST)"
    ])

    for s in students:
        apps = s.applications or []
        applied_cnt = len([a for a in apps if (a.status or "").strip() == "Applied"])
        shortlisted_cnt = len([a for a in apps if (a.status or "").strip() == "Shortlisted"])
        interview_cnt = len([a for a in apps if (a.status or "").strip() == "Interview"])
        selected_cnt = len([a for a in apps if (a.status or "").strip() == "Placed"])
        rejected_cnt = len([a for a in apps if (a.status or "").strip() == "Rejected"])
        writer.writerow([
            s.student_id or f"#{s.id}",
            s.id,
            s.name or "",
            s.email or "",
            s.contact or "",
            s.college or "",
            s.degree or "",
            s.branch or "",
            s.year_of_study or "",
            (f"{s.cgpa:.2f}" if s.cgpa is not None else ""),
            s.graduation_year or "",
            "Active" if s.is_active else "Blacklisted",
            len(apps),
            applied_cnt,
            shortlisted_cnt,
            interview_cnt,
            selected_cnt,
            rejected_cnt,
            format_ist_datetime(s.created_at) if s.created_at else ""
        ])

    if report_mode == "detailed":
        writer.writerow([])
        writer.writerow(["Applications by Student"])
        writer.writerow([
            "Student ID",
            "Student Name",
            "Application ID",
            "Drive ID",
            "Drive Title",
            "Company",
            "Status",
            "Applied On (IST)",
            "Remark"
        ])
        for s in students:
            for a in sorted(s.applications or [], key=lambda x: x.application_date or datetime.min, reverse=True):
                d = a.drive
                c = d.company if d else None
                writer.writerow([
                    s.student_id or f"#{s.id}",
                    s.name or "",
                    a.application_code or f"#{a.id}",
                    (d.drive_id if d else "") or "",
                    (d.job_title if d else "") or "",
                    (c.company_name if c else "") or "",
                    a.status or "",
                    format_ist_datetime(a.application_date) if a.application_date else "",
                    a.remark or ""
                ])

    suffix = "detailed" if report_mode == "detailed" else "summary"
    filename = f"all_students_{suffix}_report_{datetime.utcnow().strftime('%Y%m%d')}.csv"
    response = make_response(out.getvalue())
    response.headers["Content-Type"] = "text/csv; charset=utf-8"
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@app.route("/admin/company/report/<int:company_id>")
@login_required
def admin_company_report(company_id):
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    # Download reports feature disabled
    return ("Download reports are currently disabled.", 410)

    company = Company.query.get_or_404(company_id)
    drives = PlacementDrive.query.filter_by(company_id=company.id).order_by(
        PlacementDrive.created_at.desc()
    ).all()

    out = io.StringIO()
    writer = csv.writer(out)

    writer.writerow(["Company Detailed Report"])
    writer.writerow(["Generated At (IST)", format_ist_datetime(datetime.utcnow())])
    writer.writerow([])

    writer.writerow(["Company Profile"])
    writer.writerow(["Company Name", company.company_name or ""])
    writer.writerow(["Company ID", company.company_id or f"#{company.id}"])
    writer.writerow(["Email", company.email or ""])
    writer.writerow(["Industry", company.industry or ""])
    writer.writerow(["Company Size", company.company_size or ""])
    writer.writerow(["Location", company.location or ""])
    writer.writerow(["Website", company.website or ""])
    writer.writerow(["HR Contact", company.hr_contact or ""])
    writer.writerow(["HR Designation", company.hr_designation or ""])
    writer.writerow(["Mobile", company.mobile or ""])
    writer.writerow(["Approval Status", company.approval_status or ""])
    writer.writerow(["Account Status", "Active" if company.is_active else "Blacklisted"])
    writer.writerow(["Registered On", format_ist_datetime(company.created_at) if company.created_at else ""])
    writer.writerow([])

    writer.writerow(["Drive Summary"])
    writer.writerow(["Drive ID", "Job Title", "Status", "Applications", "Placed", "Created On", "Deadline"])
    for d in drives:
        apps = d.applications or []
        selected_cnt = len([a for a in apps if (a.status or "").strip() == "Placed"])
        writer.writerow([
            d.drive_id or f"#{d.id}",
            d.job_title or "",
            d.status or "",
            len(apps),
            selected_cnt,
            format_ist_datetime(d.created_at) if d.created_at else "",
            d.application_deadline.strftime("%d %b %Y") if d.application_deadline else ""
        ])
    writer.writerow([])

    writer.writerow(["Applications"])
    writer.writerow(["Application ID", "Drive ID", "Drive Title", "Student ID", "Student Name", "Student Email", "Status", "Applied On", "Remark"])
    for d in drives:
        for a in sorted(d.applications or [], key=lambda x: x.application_date or datetime.min, reverse=True):
            st = a.student
            writer.writerow([
                a.application_code or f"#{a.id}",
                d.drive_id or f"#{d.id}",
                d.job_title or "",
                (st.student_id if st else "") or "",
                (st.name if st else "") or "",
                (st.email if st else "") or "",
                a.status or "",
                format_ist_datetime(a.application_date) if a.application_date else "",
                a.remark or ""
            ])
    writer.writerow([])

    writer.writerow(["Placed Students"])
    writer.writerow(["Application ID", "Student ID", "Student Name", "Email", "Drive ID", "Drive Title", "Placed On"])
    for d in drives:
        for a in d.applications or []:
            if (a.status or "").strip() != "Placed":
                continue
            st = a.student
            writer.writerow([
                a.application_code or f"#{a.id}",
                (st.student_id if st else "") or "",
                (st.name if st else "") or "",
                (st.email if st else "") or "",
                d.drive_id or f"#{d.id}",
                d.job_title or "",
                format_ist_datetime(a.status_updated_at or a.application_date) if (a.status_updated_at or a.application_date) else ""
            ])

    filename_base = re.sub(r"[^A-Za-z0-9_-]+", "_", (company.company_name or "company").strip())
    filename = f"{filename_base}_detailed_report_{datetime.utcnow().strftime('%Y%m%d')}.csv"
    response = make_response(out.getvalue())
    response.headers["Content-Type"] = "text/csv; charset=utf-8"
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@app.route("/admin/companies/report")
@login_required
def admin_companies_report():
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    # Download reports feature disabled
    return ("Download reports are currently disabled.", 410)

    report_mode = (_get_str_arg("report_mode") or "detailed").lower()
    search = _get_str_arg("search").lower()
    status = _get_str_arg("status").lower()
    industry = _get_str_arg("industry").lower()
    location = _get_str_arg("location").lower()
    company_size = _get_str_arg("company_size").lower()
    registered_year = _get_int_arg("registered_year")
    registered_month = _get_int_arg("registered_month")
    reg_from = _get_date_arg("registered_from")
    reg_to = _get_date_arg("registered_to")
    min_drives = _get_int_arg("min_drives")
    max_drives = _get_int_arg("max_drives")
    min_placed = _get_int_arg("min_placed")
    max_placed = _get_int_arg("max_placed")

    companies = Company.query.filter_by(is_approved=True).order_by(Company.company_name.asc()).all()
    if status in ("active", "blacklisted"):
        should_be_active = status == "active"
        companies = [c for c in companies if bool(c.is_active) == should_be_active]
    if search:
        companies = [
            c for c in companies
            if search in " ".join([
                (c.company_id or ""),
                (c.company_name or ""),
                (c.email or ""),
                (c.industry or ""),
                (c.hr_contact or "")
            ]).lower()
        ]
    if industry:
        companies = [c for c in companies if industry in (c.industry or "").lower()]
    if location:
        companies = [c for c in companies if location in (c.location or "").lower()]
    if company_size:
        companies = [c for c in companies if company_size in str(c.company_size or "").lower()]
    if reg_from or reg_to:
        companies = [c for c in companies if _in_date_range(c.created_at, reg_from, reg_to)]
    if registered_year is not None:
        companies = [c for c in companies if c.created_at and c.created_at.year == registered_year]
    if registered_month is not None:
        companies = [c for c in companies if c.created_at and c.created_at.month == registered_month]
    if min_drives is not None:
        companies = [c for c in companies if len(c.drives or []) >= min_drives]
    if max_drives is not None:
        companies = [c for c in companies if len(c.drives or []) <= max_drives]
    if min_placed is not None:
        companies = [
            c for c in companies
            if sum(len([a for a in (d.applications or []) if (a.status or "").strip() == "Placed"]) for d in (c.drives or [])) >= min_placed
        ]
    if max_placed is not None:
        companies = [
            c for c in companies
            if sum(len([a for a in (d.applications or []) if (a.status or "").strip() == "Placed"]) for d in (c.drives or [])) <= max_placed
        ]

    out = io.StringIO()
    writer = csv.writer(out)

    writer.writerow(["All Companies Report"])
    writer.writerow(["Generated At (IST)", format_ist_datetime(datetime.utcnow())])
    writer.writerow(["Total Companies (Filtered)", len(companies)])
    writer.writerow(["Report Type", "Detailed" if report_mode == "detailed" else "Summary"])
    writer.writerow(["Applied Filter: Search", search or "None"])
    writer.writerow(["Applied Filter: Status", status or "All"])
    writer.writerow(["Applied Filter: Industry", industry or "All"])
    writer.writerow(["Applied Filter: Location", location or "All"])
    writer.writerow(["Applied Filter: Company Size", company_size or "All"])
    writer.writerow(["Applied Filter: Registered Year", registered_year if registered_year is not None else "All"])
    writer.writerow(["Applied Filter: Registered Month", registered_month if registered_month is not None else "All"])
    writer.writerow(["Applied Filter: Registered Date", f"{reg_from or 'Any'} to {reg_to or 'Any'}"])
    writer.writerow(["Applied Filter: Drives", f"{min_drives if min_drives is not None else 'Any'} to {max_drives if max_drives is not None else 'Any'}"])
    writer.writerow(["Applied Filter: Placed", f"{min_placed if min_placed is not None else 'Any'} to {max_placed if max_placed is not None else 'Any'}"])
    writer.writerow([])

    writer.writerow(["Company Summary"])
    writer.writerow(["Company ID", "Company Name", "Email", "Industry", "Status", "Drives", "Placed", "Registered On"])
    for c in companies:
        drives = c.drives or []
        placed = 0
        for d in drives:
            placed += len([a for a in (d.applications or []) if (a.status or "").strip() == "Placed"])
        writer.writerow([
            c.company_id or f"#{c.id}",
            c.company_name or "",
            c.email or "",
            c.industry or "",
            "Active" if c.is_active else "Blacklisted",
            len(drives),
            placed,
            format_ist_datetime(c.created_at) if c.created_at else ""
        ])
    if report_mode == "detailed":
        writer.writerow([])
        writer.writerow(["Drive and Application Detail"])
        writer.writerow(["Company ID", "Company Name", "Drive ID", "Drive Title", "Drive Status", "Applications", "Placed", "Drive Created"])
        for c in companies:
            for d in sorted(c.drives or [], key=lambda x: x.created_at or datetime.min, reverse=True):
                apps = d.applications or []
                selected_cnt = len([a for a in apps if (a.status or "").strip() == "Placed"])
                writer.writerow([
                    c.company_id or f"#{c.id}",
                    c.company_name or "",
                    d.drive_id or f"#{d.id}",
                    d.job_title or "",
                    d.status or "",
                    len(apps),
                    selected_cnt,
                    format_ist_datetime(d.created_at) if d.created_at else ""
                ])
        writer.writerow([])

        writer.writerow(["Placed Students Across Companies"])
        writer.writerow(["Company ID", "Company Name", "Student ID", "Student Name", "Student Email", "Application ID", "Drive ID", "Drive Title", "Placed On"])
        for c in companies:
            for d in c.drives or []:
                for a in d.applications or []:
                    if (a.status or "").strip() != "Placed":
                        continue
                    st = a.student
                    writer.writerow([
                        c.company_id or f"#{c.id}",
                        c.company_name or "",
                        (st.student_id if st else "") or "",
                        (st.name if st else "") or "",
                        (st.email if st else "") or "",
                        a.application_code or f"#{a.id}",
                        d.drive_id or f"#{d.id}",
                        d.job_title or "",
                        format_ist_datetime(a.status_updated_at or a.application_date) if (a.status_updated_at or a.application_date) else ""
                    ])

    suffix = "detailed" if report_mode == "detailed" else "summary"
    filename = f"all_companies_{suffix}_report_{datetime.utcnow().strftime('%Y%m%d')}.csv"
    response = make_response(out.getvalue())
    response.headers["Content-Type"] = "text/csv; charset=utf-8"
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@app.route("/admin/applications/report")
@login_required
def admin_applications_report():
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    # Download reports feature disabled
    return ("Download reports are currently disabled.", 410)

    report_mode = (_get_str_arg("report_mode") or "detailed").lower()
    search = _get_str_arg("search").lower()
    status = _get_str_arg("status").lower()
    student_degree = _get_str_arg("student_degree").lower()
    student_college = _get_str_arg("student_college").lower()
    student_year = _get_str_arg("student_year").lower()
    drive_status = _get_str_arg("drive_status").lower()
    company = _get_str_arg("company").lower()
    applied_year = _get_int_arg("applied_year")
    applied_month = _get_int_arg("applied_month")
    updated_year = _get_int_arg("updated_year")
    updated_month = _get_int_arg("updated_month")
    applied_from = _get_date_arg("applied_from")
    applied_to = _get_date_arg("applied_to")
    updated_from = _get_date_arg("updated_from")
    updated_to = _get_date_arg("updated_to")

    applications = Application.query.order_by(
        Application.application_date.desc(),
        Application.id.desc()
    ).all()
    if status:
        applications = [a for a in applications if (a.status or "").strip().lower() == status]
    if search:
        filtered = []
        for a in applications:
            s = a.student
            d = a.drive
            c = d.company if d else None
            haystack = " ".join([
                a.application_code or "",
                (s.student_id if s else "") or "",
                (s.name if s else "") or "",
                (s.email if s else "") or "",
                (d.drive_id if d else "") or "",
                (d.job_title if d else "") or "",
                (c.company_id if c else "") or "",
                (c.company_name if c else "") or ""
            ]).lower()
            if search in haystack:
                filtered.append(a)
        applications = filtered
    if student_degree:
        applications = [a for a in applications if student_degree in ((a.student.degree if a.student else "") or "").lower()]
    if student_college:
        applications = [a for a in applications if student_college in ((a.student.college if a.student else "") or "").lower()]
    if student_year:
        applications = [a for a in applications if student_year == (((a.student.year_of_study if a.student else "") or "").strip().lower())]
    if drive_status:
        applications = [a for a in applications if drive_status == (((a.drive.status if a.drive else "") or "").strip().lower())]
    if company:
        applications = [a for a in applications if company in (((a.drive.company.company_name if a.drive and a.drive.company else "") or "").lower())]
    if applied_from or applied_to:
        applications = [a for a in applications if _in_date_range(a.application_date, applied_from, applied_to)]
    if applied_year is not None:
        applications = [a for a in applications if a.application_date and a.application_date.year == applied_year]
    if applied_month is not None:
        applications = [a for a in applications if a.application_date and a.application_date.month == applied_month]
    if updated_from or updated_to:
        applications = [a for a in applications if _in_date_range(a.status_updated_at, updated_from, updated_to)]
    if updated_year is not None:
        applications = [a for a in applications if a.status_updated_at and a.status_updated_at.year == updated_year]
    if updated_month is not None:
        applications = [a for a in applications if a.status_updated_at and a.status_updated_at.month == updated_month]

    out = io.StringIO()
    writer = csv.writer(out)

    writer.writerow(["All Applications Report"])
    writer.writerow(["Generated At (IST)", format_ist_datetime(datetime.utcnow())])
    writer.writerow(["Total Applications (Filtered)", len(applications)])
    writer.writerow(["Report Type", "Detailed" if report_mode == "detailed" else "Summary"])
    writer.writerow(["Applied Filter: Search", search or "None"])
    writer.writerow(["Applied Filter: Status", status or "All"])
    writer.writerow(["Applied Filter: Student Degree", student_degree or "All"])
    writer.writerow(["Applied Filter: Student College", student_college or "All"])
    writer.writerow(["Applied Filter: Student Year", student_year or "All"])
    writer.writerow(["Applied Filter: Drive Status", drive_status or "All"])
    writer.writerow(["Applied Filter: Company", company or "All"])
    writer.writerow(["Applied Filter: Applied Year", applied_year if applied_year is not None else "All"])
    writer.writerow(["Applied Filter: Applied Month", applied_month if applied_month is not None else "All"])
    writer.writerow(["Applied Filter: Updated Year", updated_year if updated_year is not None else "All"])
    writer.writerow(["Applied Filter: Updated Month", updated_month if updated_month is not None else "All"])
    writer.writerow(["Applied Filter: Applied Date", f"{applied_from or 'Any'} to {applied_to or 'Any'}"])
    writer.writerow(["Applied Filter: Updated Date", f"{updated_from or 'Any'} to {updated_to or 'Any'}"])
    writer.writerow([])

    if report_mode == "summary":
        writer.writerow([
            "Application ID",
            "Applied On (IST)",
            "Current Status",
            "Student ID",
            "Student Name",
            "Drive ID",
            "Drive Title",
            "Company Name"
        ])
        for a in applications:
            s = a.student
            d = a.drive
            c = d.company if d else None
            writer.writerow([
                a.application_code or f"#{a.id}",
                format_ist_datetime(a.application_date) if a.application_date else "",
                a.status or "",
                (s.student_id if s else "") or "",
                (s.name if s else "") or "",
                (d.drive_id if d else "") or "",
                (d.job_title if d else "") or "",
                (c.company_name if c else "") or ""
            ])
    else:
        writer.writerow([
            "Application ID",
            "Applied On (IST)",
            "Current Status",
            "Status Updated On (IST)",
            "Company Remark",
            "Internal Note",
            "Student DB ID",
            "Student ID",
            "Student Name",
            "Student Email",
            "Student Contact",
            "College",
            "Degree",
            "Branch",
            "Year Of Study",
            "CGPA",
            "Graduation Year",
            "Drive DB ID",
            "Drive ID",
            "Drive Title",
            "Drive Status",
            "Drive Location",
            "Job Type",
            "Work Mode",
            "Salary (LPA)",
            "Drive Deadline",
            "Company DB ID",
            "Company ID",
            "Company Name",
            "Company Email",
            "Industry"
        ])

        for a in applications:
            s = a.student
            d = a.drive
            c = d.company if d else None
            writer.writerow([
                a.application_code or f"#{a.id}",
                format_ist_datetime(a.application_date) if a.application_date else "",
                a.status or "",
                format_ist_datetime(a.status_updated_at) if a.status_updated_at else "",
                a.remark or "",
                a.internal_note or "",
                (s.id if s else "") or "",
                (s.student_id if s else "") or "",
                (s.name if s else "") or "",
                (s.email if s else "") or "",
                (s.contact if s else "") or "",
                (s.college if s else "") or "",
                (s.degree if s else "") or "",
                (s.branch if s else "") or "",
                (s.year_of_study if s else "") or "",
                (f"{s.cgpa:.2f}" if (s and s.cgpa is not None) else ""),
                (s.graduation_year if s else "") or "",
                (d.id if d else "") or "",
                (d.drive_id if d else "") or "",
                (d.job_title if d else "") or "",
                (d.status if d else "") or "",
                (d.location if d else "") or "",
                (d.job_type if d else "") or "",
                (d.work_mode if d else "") or "",
                (d.salary if (d and d.salary is not None) else ""),
                (d.application_deadline.strftime("%d %b %Y") if (d and d.application_deadline) else ""),
                (c.id if c else "") or "",
                (c.company_id if c else "") or "",
                (c.company_name if c else "") or "",
                (c.email if c else "") or "",
                (c.industry if c else "") or ""
            ])

    suffix = "detailed" if report_mode == "detailed" else "summary"
    filename = f"all_applications_{suffix}_report_{datetime.utcnow().strftime('%Y%m%d')}.csv"
    response = make_response(out.getvalue())
    response.headers["Content-Type"] = "text/csv; charset=utf-8"
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


@app.route("/admin/drives/report")
@login_required
def admin_drives_report():
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    # Download reports feature disabled
    return ("Download reports are currently disabled.", 410)

    report_mode = (_get_str_arg("report_mode") or "detailed").lower()
    search = _get_str_arg("search").lower()
    status = _get_str_arg("status").lower()
    company = _get_str_arg("company").lower()
    location = _get_str_arg("location").lower()
    job_type = _get_str_arg("job_type").lower()
    work_mode = _get_str_arg("work_mode").lower()
    experience = _get_str_arg("experience").lower()
    target_degree = _get_str_arg("target_degree").lower()
    target_year = _get_str_arg("target_year").lower()
    created_year = _get_int_arg("created_year")
    created_month = _get_int_arg("created_month")
    deadline_year = _get_int_arg("deadline_year")
    deadline_month = _get_int_arg("deadline_month")
    created_from = _get_date_arg("created_from")
    created_to = _get_date_arg("created_to")
    deadline_from = _get_date_arg("deadline_from")
    deadline_to = _get_date_arg("deadline_to")
    min_apps = _get_int_arg("min_apps")
    max_apps = _get_int_arg("max_apps")
    salary_min = _get_int_arg("salary_min")
    salary_max = _get_int_arg("salary_max")

    drives = PlacementDrive.query.order_by(
        PlacementDrive.created_at.desc(),
        PlacementDrive.id.desc()
    ).all()
    if status:
        drives = [d for d in drives if (d.status or "").strip().lower() == status]
    if search:
        drives = [
            d for d in drives
            if search in " ".join([
                d.drive_id or "",
                d.job_title or "",
                d.location or "",
                (d.status or ""),
                (d.company.company_id if d.company else "") or "",
                (d.company.company_name if d.company else "") or ""
            ]).lower()
        ]
    if company:
        drives = [d for d in drives if company in (((d.company.company_name if d.company else "") or "").lower())]
    if location:
        drives = [d for d in drives if location in (d.location or "").lower()]
    if job_type:
        drives = [d for d in drives if job_type in (d.job_type or "").lower()]
    if work_mode:
        drives = [d for d in drives if work_mode in (d.work_mode or "").lower()]
    if experience:
        drives = [d for d in drives if experience in (d.experience_level or "").lower()]
    if target_degree:
        drives = [d for d in drives if target_degree in (d.target_degrees or "").lower()]
    if target_year:
        drives = [d for d in drives if target_year in (d.target_years or "").lower()]
    if created_from or created_to:
        drives = [d for d in drives if _in_date_range(d.created_at, created_from, created_to)]
    if created_year is not None:
        drives = [d for d in drives if d.created_at and d.created_at.year == created_year]
    if created_month is not None:
        drives = [d for d in drives if d.created_at and d.created_at.month == created_month]
    if deadline_from or deadline_to:
        drives = [d for d in drives if _in_date_range(d.application_deadline, deadline_from, deadline_to)]
    if deadline_year is not None:
        drives = [d for d in drives if d.application_deadline and d.application_deadline.year == deadline_year]
    if deadline_month is not None:
        drives = [d for d in drives if d.application_deadline and d.application_deadline.month == deadline_month]
    if min_apps is not None:
        drives = [d for d in drives if len(d.applications or []) >= min_apps]
    if max_apps is not None:
        drives = [d for d in drives if len(d.applications or []) <= max_apps]
    if salary_min is not None:
        drives = [d for d in drives if d.salary is not None and d.salary >= salary_min]
    if salary_max is not None:
        drives = [d for d in drives if d.salary is not None and d.salary <= salary_max]

    out = io.StringIO()
    writer = csv.writer(out)

    writer.writerow(["All Placement Drives Report"])
    writer.writerow(["Generated At (IST)", format_ist_datetime(datetime.utcnow())])
    writer.writerow(["Total Drives (Filtered)", len(drives)])
    writer.writerow(["Report Type", "Detailed" if report_mode == "detailed" else "Summary"])
    writer.writerow(["Applied Filter: Search", search or "None"])
    writer.writerow(["Applied Filter: Status", status or "All"])
    writer.writerow(["Applied Filter: Company", company or "All"])
    writer.writerow(["Applied Filter: Location", location or "All"])
    writer.writerow(["Applied Filter: Job Type", job_type or "All"])
    writer.writerow(["Applied Filter: Work Mode", work_mode or "All"])
    writer.writerow(["Applied Filter: Experience", experience or "All"])
    writer.writerow(["Applied Filter: Target Degree", target_degree or "All"])
    writer.writerow(["Applied Filter: Target Year", target_year or "All"])
    writer.writerow(["Applied Filter: Created Year", created_year if created_year is not None else "All"])
    writer.writerow(["Applied Filter: Created Month", created_month if created_month is not None else "All"])
    writer.writerow(["Applied Filter: Deadline Year", deadline_year if deadline_year is not None else "All"])
    writer.writerow(["Applied Filter: Deadline Month", deadline_month if deadline_month is not None else "All"])
    writer.writerow(["Applied Filter: Created Date", f"{created_from or 'Any'} to {created_to or 'Any'}"])
    writer.writerow(["Applied Filter: Deadline Date", f"{deadline_from or 'Any'} to {deadline_to or 'Any'}"])
    writer.writerow(["Applied Filter: Applications", f"{min_apps if min_apps is not None else 'Any'} to {max_apps if max_apps is not None else 'Any'}"])
    writer.writerow(["Applied Filter: Salary", f"{salary_min if salary_min is not None else 'Any'} to {salary_max if salary_max is not None else 'Any'}"])
    writer.writerow([])

    if report_mode == "summary":
        writer.writerow([
            "Drive ID",
            "Job Title",
            "Company Name",
            "Status",
            "Applications",
            "Placed",
            "Rejected",
            "Deadline"
        ])
        for d in drives:
            apps = d.applications or []
            selected_cnt = len([a for a in apps if (a.status or "").strip() == "Placed"])
            rejected_cnt = len([a for a in apps if (a.status or "").strip() == "Rejected"])
            writer.writerow([
                d.drive_id or f"#{d.id}",
                d.job_title or "",
                (d.company.company_name if d.company else "") or "",
                d.status or "",
                len(apps),
                selected_cnt,
                rejected_cnt,
                d.application_deadline.strftime("%d %b %Y") if d.application_deadline else ""
            ])
    else:
        writer.writerow([
            "Drive ID",
            "Drive DB ID",
            "Job Title",
            "Status",
            "Company ID",
            "Company Name",
            "Location",
            "Job Type",
            "Work Mode",
            "Experience Level",
            "Vacancies",
            "Salary (LPA)",
            "Required Skills",
            "Eligibility",
            "Target Degrees",
            "Target Years",
            "Created On (IST)",
            "Deadline",
            "Applications",
            "Applied",
            "Shortlisted",
            "Interview",
            "Placed",
            "Rejected"
        ])

        for d in drives:
            apps = d.applications or []
            applied_cnt = len([a for a in apps if (a.status or "").strip() == "Applied"])
            shortlisted_cnt = len([a for a in apps if (a.status or "").strip() == "Shortlisted"])
            interview_cnt = len([a for a in apps if (a.status or "").strip() == "Interview"])
            selected_cnt = len([a for a in apps if (a.status or "").strip() == "Placed"])
            rejected_cnt = len([a for a in apps if (a.status or "").strip() == "Rejected"])

            writer.writerow([
                d.drive_id or f"#{d.id}",
                d.id,
                d.job_title or "",
                d.status or "",
                (d.company.company_id if d.company else "") or "",
                (d.company.company_name if d.company else "") or "",
                d.location or "",
                d.job_type or "",
                d.work_mode or "",
                d.experience_level or "",
                d.vacancies if d.vacancies is not None else "",
                d.salary if d.salary is not None else "",
                d.required_skills or "",
                d.eligibility_criteria or getattr(d, "eligibility", "") or "",
                d.target_degrees or "",
                d.target_years or "",
                format_ist_datetime(d.created_at) if d.created_at else "",
                d.application_deadline.strftime("%d %b %Y") if d.application_deadline else "",
                len(apps),
                applied_cnt,
                shortlisted_cnt,
                interview_cnt,
                selected_cnt,
                rejected_cnt
            ])

        writer.writerow([])
        writer.writerow(["Applications by Drive"])
        writer.writerow([
            "Drive ID",
            "Job Title",
            "Company Name",
            "Application ID",
            "Student ID",
            "Student Name",
            "Student Email",
            "Status",
            "Applied On (IST)",
            "Remark"
        ])
        for d in drives:
            for a in sorted(d.applications or [], key=lambda x: x.application_date or datetime.min, reverse=True):
                s = a.student
                writer.writerow([
                    d.drive_id or f"#{d.id}",
                    d.job_title or "",
                    (d.company.company_name if d.company else "") or "",
                    a.application_code or f"#{a.id}",
                    (s.student_id if s else "") or "",
                    (s.name if s else "") or "",
                    (s.email if s else "") or "",
                    a.status or "",
                    format_ist_datetime(a.application_date) if a.application_date else "",
                    a.remark or ""
                ])

    suffix = "detailed" if report_mode == "detailed" else "summary"
    filename = f"all_placement_drives_{suffix}_report_{datetime.utcnow().strftime('%Y%m%d')}.csv"
    response = make_response(out.getvalue())
    response.headers["Content-Type"] = "text/csv; charset=utf-8"
    response.headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response


# =====================================================
# API V1 — CRUD (OPTIONAL MILESTONE COVERAGE)
# =====================================================
def _is_admin_api_request():
    return isinstance(current_user, Admin)


def _student_payload(s: Student):
    return {
        "id": s.id,
        "student_id": s.student_id,
        "name": s.name,
        "email": s.email,
        "contact": s.contact,
        "college": s.college,
        "degree": s.degree,
        "branch": s.branch,
        "year_of_study": s.year_of_study,
        "graduation_year": s.graduation_year,
        "skills": s.skills,
        "is_active": bool(s.is_active),
        "created_at": s.created_at.isoformat() if s.created_at else None
    }


def _company_payload(c: Company):
    return {
        "id": c.id,
        "company_id": c.company_id,
        "company_name": c.company_name,
        "email": c.email,
        "industry": c.industry,
        "location": c.location,
        "website": c.website,
        "approval_status": c.approval_status,
        "is_approved": bool(c.is_approved),
        "is_active": bool(c.is_active),
        "created_at": c.created_at.isoformat() if c.created_at else None
    }


def _application_payload(a: Application):
    return {
        "id": a.id,
        "application_code": a.application_code,
        "student_id": a.student_id,
        "drive_id": a.drive_id,
        "status": a.status,
        "remark": a.remark,
        "internal_note": a.internal_note,
        "application_date": a.application_date.isoformat() if a.application_date else None,
        "status_updated_at": a.status_updated_at.isoformat() if a.status_updated_at else None
    }


@app.route("/api/v1/students", methods=["GET", "POST"])
@login_required
def api_v1_students():
    if not _is_admin_api_request():
        return jsonify({"error": "Unauthorized"}), 403

    if request.method == "GET":
        rows = Student.query.order_by(Student.created_at.desc()).all()
        return jsonify([_student_payload(s) for s in rows])

    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = (data.get("password") or "").strip()
    if not name or not email or not password:
        return jsonify({"error": "name, email, and password are required"}), 400
    if Student.query.filter_by(email=email).first():
        return jsonify({"error": "Email already exists"}), 409

    s = Student(
        student_id=generate_student_id(),
        name=name,
        email=email,
        password=generate_password_hash(password),
        contact=(data.get("contact") or "").strip() or None,
        college=(data.get("college") or "").strip() or None,
        degree=(data.get("degree") or "").strip() or None,
        branch=(data.get("branch") or "").strip() or None,
        year_of_study=(data.get("year_of_study") or "").strip() or None,
        graduation_year=(data.get("graduation_year") or "").strip() or None,
        skills=(data.get("skills") or "").strip() or None,
        is_active=bool(data.get("is_active", True))
    )
    db.session.add(s)
    db.session.commit()
    return jsonify(_student_payload(s)), 201


@app.route("/api/v1/students/<int:student_id>", methods=["GET", "PUT", "PATCH", "DELETE"])
@login_required
def api_v1_student_detail(student_id):
    if not _is_admin_api_request():
        return jsonify({"error": "Unauthorized"}), 403
    s = Student.query.get_or_404(student_id)

    if request.method == "GET":
        return jsonify(_student_payload(s))

    if request.method == "DELETE":
        db.session.delete(s)
        db.session.commit()
        return jsonify({"success": True, "deleted_id": student_id})

    data = request.get_json(silent=True) or {}
    if "name" in data:
        s.name = (data.get("name") or "").strip()
    if "email" in data:
        new_email = (data.get("email") or "").strip().lower()
        if new_email and new_email != s.email and Student.query.filter_by(email=new_email).first():
            return jsonify({"error": "Email already exists"}), 409
        s.email = new_email or s.email
    if "password" in data and (data.get("password") or "").strip():
        s.password = generate_password_hash((data.get("password") or "").strip())
    if "contact" in data:
        s.contact = (data.get("contact") or "").strip() or None
    if "college" in data:
        s.college = (data.get("college") or "").strip() or None
    if "degree" in data:
        s.degree = (data.get("degree") or "").strip() or None
    if "skills" in data:
        s.skills = (data.get("skills") or "").strip() or None
    if "is_active" in data:
        s.is_active = bool(data.get("is_active"))

    db.session.commit()
    return jsonify(_student_payload(s))


@app.route("/api/v1/companies", methods=["GET", "POST"])
@login_required
def api_v1_companies():
    if not _is_admin_api_request():
        return jsonify({"error": "Unauthorized"}), 403

    if request.method == "GET":
        rows = Company.query.order_by(Company.created_at.desc()).all()
        return jsonify([_company_payload(c) for c in rows])

    data = request.get_json(silent=True) or {}
    company_name = (data.get("company_name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = (data.get("password") or "").strip()
    if not company_name or not email or not password:
        return jsonify({"error": "company_name, email, and password are required"}), 400
    if Company.query.filter_by(email=email).first():
        return jsonify({"error": "Email already exists"}), 409

    c = Company(
        company_id=generate_company_id(),
        company_name=company_name,
        email=email,
        password=generate_password_hash(password),
        industry=(data.get("industry") or "").strip() or None,
        location=(data.get("location") or "").strip() or None,
        website=(data.get("website") or "").strip() or None,
        approval_status=(data.get("approval_status") or "Pending").strip() or "Pending",
        is_approved=bool(data.get("is_approved", False)),
        is_active=bool(data.get("is_active", True))
    )
    db.session.add(c)
    db.session.commit()
    return jsonify(_company_payload(c)), 201


@app.route("/api/v1/companies/<int:company_id>", methods=["GET", "PUT", "PATCH", "DELETE"])
@login_required
def api_v1_company_detail(company_id):
    if not _is_admin_api_request():
        return jsonify({"error": "Unauthorized"}), 403
    c = Company.query.get_or_404(company_id)

    if request.method == "GET":
        return jsonify(_company_payload(c))

    if request.method == "DELETE":
        db.session.delete(c)
        db.session.commit()
        return jsonify({"success": True, "deleted_id": company_id})

    data = request.get_json(silent=True) or {}
    if "company_name" in data:
        c.company_name = (data.get("company_name") or "").strip()
    if "email" in data:
        new_email = (data.get("email") or "").strip().lower()
        if new_email and new_email != c.email and Company.query.filter_by(email=new_email).first():
            return jsonify({"error": "Email already exists"}), 409
        c.email = new_email or c.email
    if "password" in data and (data.get("password") or "").strip():
        c.password = generate_password_hash((data.get("password") or "").strip())
    if "industry" in data:
        c.industry = (data.get("industry") or "").strip() or None
    if "location" in data:
        c.location = (data.get("location") or "").strip() or None
    if "website" in data:
        c.website = (data.get("website") or "").strip() or None
    if "approval_status" in data:
        c.approval_status = (data.get("approval_status") or c.approval_status).strip()
    if "is_approved" in data:
        c.is_approved = bool(data.get("is_approved"))
    if "is_active" in data:
        c.is_active = bool(data.get("is_active"))

    db.session.commit()
    return jsonify(_company_payload(c))


@app.route("/api/v1/applications", methods=["GET", "POST"])
@login_required
def api_v1_applications():
    if not _is_admin_api_request():
        return jsonify({"error": "Unauthorized"}), 403

    if request.method == "GET":
        rows = Application.query.order_by(Application.application_date.desc()).all()
        return jsonify([_application_payload(a) for a in rows])

    data = request.get_json(silent=True) or {}
    student_id = data.get("student_id")
    drive_id = data.get("drive_id")
    status = (data.get("status") or "Applied").strip()
    valid_status = {"Applied", "Shortlisted", "Interview", "Placed", "Rejected"}
    if not student_id or not drive_id:
        return jsonify({"error": "student_id and drive_id are required"}), 400
    if status not in valid_status:
        return jsonify({"error": f"Invalid status. Allowed: {sorted(valid_status)}"}), 400
    if Application.query.filter_by(student_id=student_id, drive_id=drive_id).first():
        return jsonify({"error": "Duplicate application for student and drive"}), 409

    ts = datetime.utcnow()
    a = Application(
        student_id=student_id,
        drive_id=drive_id,
        application_code=generate_application_code(ts),
        status=status,
        remark=(data.get("remark") or "").strip() or None,
        internal_note=(data.get("internal_note") or "").strip() or None,
        application_date=ts,
        status_updated_at=ts
    )
    db.session.add(a)
    db.session.commit()
    return jsonify(_application_payload(a)), 201


@app.route("/api/v1/applications/<int:app_id>", methods=["GET", "PUT", "PATCH", "DELETE"])
@login_required
def api_v1_application_detail(app_id):
    if not _is_admin_api_request():
        return jsonify({"error": "Unauthorized"}), 403
    a = Application.query.get_or_404(app_id)

    if request.method == "GET":
        return jsonify(_application_payload(a))

    if request.method == "DELETE":
        db.session.delete(a)
        db.session.commit()
        return jsonify({"success": True, "deleted_id": app_id})

    data = request.get_json(silent=True) or {}
    valid_status = {"Applied", "Shortlisted", "Interview", "Placed", "Rejected"}
    if "status" in data:
        new_status = (data.get("status") or "").strip()
        if new_status not in valid_status:
            return jsonify({"error": f"Invalid status. Allowed: {sorted(valid_status)}"}), 400
        a.status = new_status
        a.status_updated_at = datetime.utcnow()
    if "remark" in data:
        a.remark = (data.get("remark") or "").strip() or None
    if "internal_note" in data:
        a.internal_note = (data.get("internal_note") or "").strip() or None

    db.session.commit()
    return jsonify(_application_payload(a))


# =====================================================
# ADMIN — BROADCAST MESSAGE
# =====================================================
@app.route("/admin/broadcast", methods=["POST"])
@login_required
def admin_broadcast():
    if not isinstance(current_user, Admin):
        return jsonify({"error": "Unauthorized"}), 403

    data    = request.get_json(silent=True) or request.form
    target  = data.get("target", "student")
    subject = (data.get("subject") or "").strip()
    message = (data.get("message") or "").strip()

    if not subject or not message:
        return jsonify({"error": "Subject and message are required."}), 400
    if target not in ("student", "company", "all"):
        return jsonify({"error": "Invalid target."}), 400

    # Recipient count
    if target == "student":
        count = Student.query.filter_by(is_active=True).count()
    elif target == "company":
        count = Company.query.filter_by(is_active=True, is_approved=True).count()
    else:
        count = (Student.query.filter_by(is_active=True).count() +
                 Company.query.filter_by(is_active=True, is_approved=True).count())

    broadcast = BroadcastMessage(
        target=target,
        subject=subject,
        message=message,
        sent_by=current_user.id,
        recipient_count=count
    )
    db.session.add(broadcast)
    db.session.commit()

    return jsonify({
        "success": True,
        "id":      broadcast.id,
        "target":  target,
        "subject": subject,
        "sent_at": broadcast.sent_at.strftime("%d %b %Y, %I:%M %p"),
        "recipient_count": count
    })


@app.route("/api/admin/broadcast/history")
@login_required
def admin_broadcast_history():
    if not isinstance(current_user, Admin):
        return jsonify({"error": "Unauthorized"}), 403
    history = BroadcastMessage.query.order_by(
        BroadcastMessage.sent_at.desc()
    ).limit(30).all()
    return jsonify([
        {
            "id":              b.id,
            "target":          b.target,
            "subject":         b.subject,
            "message":         b.message,
            "sent_at":         b.sent_at.strftime("%d %b %Y, %I:%M %p"),
            "recipient_count": b.recipient_count
        }
        for b in history
    ])


# =====================================================
# ADMIN — SUPPORT TICKETS
# =====================================================
@app.route("/api/admin/support/tickets")
@login_required
def admin_get_tickets():
    if not isinstance(current_user, Admin):
        return jsonify({"error": "Unauthorized"}), 403

    ticket_type   = request.args.get("type", "")     # 'student' | 'company' | ''
    ticket_status = request.args.get("status", "")   # 'open' | 'resolved' | ''

    query = SupportTicket.query
    if ticket_type == "student":
        query = query.filter(SupportTicket.submitter_type == "student")
    elif ticket_type == "company":
        query = query.filter(SupportTicket.submitter_type == "company")

    if ticket_status == "open":
        query = query.filter(SupportTicket.status == "Open")
    elif ticket_status == "resolved":
        query = query.filter(SupportTicket.status.in_(["Resolved", "Closed"]))

    tickets = query.order_by(SupportTicket.created_at.desc()).limit(100).all()

    result = []
    for t in tickets:
        submitter_name = "Unknown"
        submitter_id = None
        submitter_code = ""
        submitter_email = ""
        if t.submitter_type == "student" and t.student:
            submitter_name = t.student.name
            submitter_id = t.student.id
            submitter_code = t.student.student_id or ""
            submitter_email = t.student.email or ""
        elif t.submitter_type == "company" and t.company:
            submitter_name = t.company.company_name
            submitter_id = t.company.id
            submitter_code = t.company.company_id or ""
            submitter_email = t.company.email or ""

        result.append({
            "id":             t.id,
            "subject":        t.subject,
            "message":        t.message,
            "category":       t.category,
            "status":         t.status,
            "submitter_type": t.submitter_type,
            "submitter_name": submitter_name,
            "submitter_id":   submitter_id,
            "submitter_code": submitter_code,
            "submitter_email": submitter_email,
            "admin_reply":    t.admin_reply,
            "created_at":     get_time_ago(t.created_at),
            "created_at_full": format_ist_datetime(t.created_at) if t.created_at else ""
        })

    return jsonify(result)


@app.route("/api/admin/support/submitter-details")
@login_required
def admin_get_ticket_submitter_details():
    if not isinstance(current_user, Admin):
        return jsonify({"error": "Unauthorized"}), 403

    submitter_type = (request.args.get("type") or "").strip().lower()
    submitter_id_raw = request.args.get("id")
    try:
        submitter_id = int(submitter_id_raw)
    except (TypeError, ValueError):
        return jsonify({"error": "Invalid submitter id"}), 400

    if submitter_type == "student":
        student = Student.query.get_or_404(submitter_id)
        apps = Application.query.filter_by(student_id=student.id).order_by(
            Application.application_date.desc()
        ).limit(30).all()
        activities = []
        for a in Application.query.filter_by(student_id=student.id).order_by(
            Application.status_updated_at.desc(),
            Application.application_date.desc()
        ).limit(5).all():
            ts = a.status_updated_at or a.application_date
            activities.append({
                "type": "application",
                "title": f"Application {a.status or 'Updated'}",
                "detail": f"{(a.drive.job_title if a.drive else 'Drive')} · {(a.drive.company.company_name if a.drive and a.drive.company else 'Company')}",
                "time": format_ist_datetime(ts) if ts else "",
                "sort_ts": ts.timestamp() if ts else 0
            })
        for t in SupportTicket.query.filter_by(
            student_id=student.id,
            submitter_type="student"
        ).order_by(SupportTicket.created_at.desc()).limit(5).all():
            ts = t.created_at
            activities.append({
                "type": "ticket",
                "title": f"Support Ticket #{t.id}",
                "detail": f"{t.subject or 'No subject'} · {t.status or 'Open'}",
                "time": format_ist_datetime(ts) if ts else "",
                "sort_ts": ts.timestamp() if ts else 0
            })
        for n in StudentNotification.query.filter_by(student_id=student.id).order_by(
            StudentNotification.created_at.desc()
        ).limit(5).all():
            ts = n.created_at
            activities.append({
                "type": "notification",
                "title": "Notification",
                "detail": n.text or "",
                "time": format_ist_datetime(ts) if ts else "",
                "sort_ts": ts.timestamp() if ts else 0
            })
        activities = sorted(activities, key=lambda x: x.get("sort_ts", 0), reverse=True)[:5]
        for a in activities:
            a.pop("sort_ts", None)
        return jsonify({
            "type": "student",
            "profile": {
                "id": student.id,
                "name": student.name,
                "student_id": student.student_id or "",
                "email": student.email or "",
                "contact": student.contact or "",
                "college": student.college or "",
                "degree": student.degree or "",
                "branch": student.branch or "",
                "graduation_year": student.graduation_year or "",
                "cgpa": student.cgpa,
                "skills": student.skills or "",
                "linkedin": student.linkedin or "",
                "github": student.github or "",
                "is_active": bool(student.is_active),
                "resume_url": student.resume_url or ""
            },
            "applications": [
                {
                    "id": a.id,
                    "application_code": a.application_code or "",
                    "drive_title": a.drive.job_title if a.drive else "",
                    "company_name": a.drive.company.company_name if a.drive and a.drive.company else "",
                    "status": a.status or "",
                    "applied_on": format_ist_datetime(a.application_date) if a.application_date else ""
                }
                for a in apps
            ],
            "activities": activities
        })

    if submitter_type == "company":
        company = Company.query.get_or_404(submitter_id)
        drives = PlacementDrive.query.filter_by(company_id=company.id).order_by(
            PlacementDrive.created_at.desc()
        ).limit(30).all()
        drive_rows = []
        for d in drives:
            selected_cnt = len([a for a in d.applications if a.status == "Placed"])
            drive_rows.append({
                "id": d.id,
                "drive_id": d.drive_id or "",
                "job_title": d.job_title or "",
                "status": d.status or "",
                "applications": len(d.applications),
                "selected": selected_cnt
            })
        activities = []
        for log in DriveActivityLog.query.filter_by(company_id=company.id).order_by(
            DriveActivityLog.created_at.desc()
        ).limit(5).all():
            ts = log.created_at
            activities.append({
                "type": "drive",
                "title": f"Drive {log.action.title()}",
                "detail": log.summary or (log.drive.job_title if log.drive else ""),
                "time": format_ist_datetime(ts) if ts else "",
                "sort_ts": ts.timestamp() if ts else 0
            })
        for d in PlacementDrive.query.filter_by(company_id=company.id).order_by(
            PlacementDrive.updated_at.desc()
        ).limit(5).all():
            ts = d.updated_at or d.created_at
            activities.append({
                "type": "drive",
                "title": f"{d.job_title or 'Drive'} · {d.status or 'Updated'}",
                "detail": f"Applications: {len(d.applications)}",
                "time": format_ist_datetime(ts) if ts else "",
                "sort_ts": ts.timestamp() if ts else 0
            })
        for t in SupportTicket.query.filter_by(
            company_id=company.id,
            submitter_type="company"
        ).order_by(SupportTicket.created_at.desc()).limit(5).all():
            ts = t.created_at
            activities.append({
                "type": "ticket",
                "title": f"Support Ticket #{t.id}",
                "detail": f"{t.subject or 'No subject'} · {t.status or 'Open'}",
                "time": format_ist_datetime(ts) if ts else "",
                "sort_ts": ts.timestamp() if ts else 0
            })
        activities = sorted(activities, key=lambda x: x.get("sort_ts", 0), reverse=True)[:5]
        for a in activities:
            a.pop("sort_ts", None)

        return jsonify({
            "type": "company",
            "profile": {
                "id": company.id,
                "company_name": company.company_name,
                "company_id": company.company_id or "",
                "email": company.email or "",
                "industry": company.industry or "",
                "hr_contact": company.hr_contact or "",
                "mobile": company.mobile or "",
                "location": company.location or "",
                "company_size": company.company_size or "",
                "website": company.website or "",
                "approval_status": company.approval_status or "",
                "is_active": bool(company.is_active),
                "description": company.description or ""
            },
            "drives": drive_rows,
            "activities": activities
        })

    return jsonify({"error": "Invalid submitter type"}), 400


@app.route("/admin/support/reply/<int:ticket_id>", methods=["POST"])
@login_required
def admin_reply_ticket(ticket_id):
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    ticket = SupportTicket.query.get_or_404(ticket_id)
    reply  = request.form.get("reply", "").strip()

    if reply:
        ticket.admin_reply      = reply
        ticket.replied_at       = datetime.utcnow()
        ticket.replied_by_admin = current_user.id
        ticket.status           = "Resolved"
        ticket.resolved_at      = datetime.utcnow()
        db.session.commit()
        flash("Reply sent and ticket marked as resolved.", "success")
    else:
        flash("Reply cannot be empty.", "danger")

    return redirect(admin_next_section_url(default="support"))


@app.route("/api/admin/support/reply/<int:ticket_id>", methods=["POST"])
@login_required
def admin_reply_ticket_api(ticket_id):
    if not isinstance(current_user, Admin):
        return jsonify({"error": "Unauthorized"}), 403
    ticket = SupportTicket.query.get_or_404(ticket_id)
    data = request.get_json(silent=True) or request.form
    reply = (data.get("reply") or "").strip()
    if not reply:
        return jsonify({"error": "Reply cannot be empty."}), 400

    ticket.admin_reply = reply
    ticket.replied_at = datetime.utcnow()
    ticket.replied_by_admin = current_user.id
    ticket.status = "Resolved"
    ticket.resolved_at = datetime.utcnow()
    db.session.commit()
    return jsonify({"success": True, "ticket_id": ticket.id, "status": ticket.status})


@app.route("/admin/support/close/<int:ticket_id>")
@login_required
def admin_close_ticket(ticket_id):
    if not isinstance(current_user, Admin):
        return redirect(url_for("home"))
    ticket = SupportTicket.query.get_or_404(ticket_id)
    ticket.status      = "Closed"
    ticket.resolved_at = datetime.utcnow()
    db.session.commit()
    flash("Ticket closed.", "info")
    return redirect(admin_next_section_url(default="support"))


@app.route("/api/admin/support/close/<int:ticket_id>", methods=["POST"])
@login_required
def admin_close_ticket_api(ticket_id):
    if not isinstance(current_user, Admin):
        return jsonify({"error": "Unauthorized"}), 403
    ticket = SupportTicket.query.get_or_404(ticket_id)
    ticket.status = "Closed"
    ticket.resolved_at = datetime.utcnow()
    db.session.commit()
    return jsonify({"success": True, "ticket_id": ticket.id, "status": ticket.status})


# =====================================================
# ADMIN — NOTIFICATIONS API
# =====================================================
@app.route("/api/admin/notifications")
@login_required
def get_admin_notifications():
    if not isinstance(current_user, Admin):
        return jsonify({"error": "Unauthorized"}), 403

    notifications = []
    try:
        pending_companies = Company.query.filter_by(
            is_approved=False, approval_status="Pending"
        ).order_by(Company.created_at.desc()).limit(5).all()

        for company in pending_companies:
            notifications.append({
                "type":      "company",
                "icon":      "bi-building",
                "title":     "New Company Registration",
                "message":   f"{company.company_name} registered",
                "time":      get_time_ago(company.created_at),
                "isNew":     True,
                "timestamp": company.created_at.isoformat() if company.created_at else None
            })

        pending_drives = PlacementDrive.query.filter_by(
            status="Pending"
        ).order_by(PlacementDrive.created_at.desc()).limit(5).all()

        for drive in pending_drives:
            notifications.append({
                "type":      "drive",
                "icon":      "bi-calendar-event",
                "title":     "New Placement Drive",
                "message":   f"{drive.company.company_name} created '{drive.job_title}'",
                "time":      get_time_ago(drive.created_at),
                "isNew":     True,
                "timestamp": drive.created_at.isoformat() if drive.created_at else None
            })

        seven_days_ago = datetime.utcnow() - timedelta(days=7)
        recent_placements = Application.query.filter(
            Application.status == "Placed",
            Application.application_date >= seven_days_ago
        ).order_by(Application.application_date.desc()).limit(5).all()

        for app in recent_placements:
            notifications.append({
                "type":      "student",
                "icon":      "bi-trophy",
                "title":     "Student Placed 🎉",
                "message":   f"{app.student.name} placed at {app.drive.company.company_name}",
                "time":      get_time_ago(app.application_date),
                "isNew":     False,
                "timestamp": app.application_date.isoformat()
            })

        # Open support tickets alert
        open_tickets = SupportTicket.query.filter_by(status="Open").count()
        if open_tickets > 0:
            notifications.append({
                "type":      "warning",
                "icon":      "bi-ticket-perforated",
                "title":     "Open Support Tickets",
                "message":   f"{open_tickets} ticket{'s' if open_tickets != 1 else ''} awaiting response",
                "time":      "Now",
                "isNew":     True,
                "timestamp": datetime.utcnow().isoformat()
            })

        notifications.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
        return jsonify(notifications[:20])

    except Exception as e:
        print("Notification Error:", e)
        return jsonify([])


@app.route("/company/broadcast", methods=["POST"])
@login_required
def company_broadcast():
    if not isinstance(current_user, Company):
        return redirect(url_for("home"))
    if not current_user.is_approved:
        flash("Account must be approved to send broadcasts.", "warning")
        return redirect(url_for("company_dashboard"))

    subject  = request.form.get("subject", "").strip()
    message  = request.form.get("message", "").strip()
    drive_id = request.form.get("drive_id") or None

    if not subject or not message:
        flash("Subject and message are required.", "danger")
        return redirect(url_for("company_dashboard"))

    bc = CompanyBroadcast(
        company_id=current_user.id,
        drive_id=int(drive_id) if drive_id else None,
        subject=subject,
        message=message,
    )
    db.session.add(bc)
    db.session.commit()
    flash("Broadcast sent to students successfully!", "success")
    return redirect(url_for("company_dashboard"))
# =====================================================
# DB INIT + AUTO MIGRATION
# =====================================================
def create_tables_and_admin():
    """Create tables, run safe additive migrations, and ensure default admin exists."""
    with app.app_context():
        db.create_all()

        from sqlalchemy import text
        with db.engine.connect() as conn:
            # ------ students ------
            result = conn.execute(text("PRAGMA table_info(students)"))
            student_cols = [row[1] for row in result.fetchall()]

            migrations = [
                ("student_id",      "ALTER TABLE students ADD COLUMN student_id VARCHAR(20)"),
                ("tenth_percent",   "ALTER TABLE students ADD COLUMN tenth_percent FLOAT"),
                ("twelfth_percent", "ALTER TABLE students ADD COLUMN twelfth_percent FLOAT"),
                ("graduation_year", "ALTER TABLE students ADD COLUMN graduation_year VARCHAR(20)"),
                ("branch",          "ALTER TABLE students ADD COLUMN branch VARCHAR(100)"),
                ("year_of_study",   "ALTER TABLE students ADD COLUMN year_of_study VARCHAR(20)"),
                ("bio",             "ALTER TABLE students ADD COLUMN bio TEXT"),
            ]
            for col, sql in migrations:
                if col not in student_cols:
                    conn.execute(text(sql))
                    conn.commit()
                    print(f"✓ Migrated: added {col} to students")

            # ------ companies ------
            result = conn.execute(text("PRAGMA table_info(companies)"))
            company_cols = [row[1] for row in result.fetchall()]

            company_migrations = [
                ("company_id",      "ALTER TABLE companies ADD COLUMN company_id VARCHAR(20)"),
                ("hr_designation",  "ALTER TABLE companies ADD COLUMN hr_designation VARCHAR(100)"),
                ("alt_email",       "ALTER TABLE companies ADD COLUMN alt_email VARCHAR(120)"),
                ("office_number",   "ALTER TABLE companies ADD COLUMN office_number VARCHAR(20)"),
                ("company_size",    "ALTER TABLE companies ADD COLUMN company_size VARCHAR(50)"),
                ("location",        "ALTER TABLE companies ADD COLUMN location VARCHAR(150)"),
            ]
            for col, sql in company_migrations:
                if col not in company_cols:
                    conn.execute(text(sql))
                    conn.commit()
                    print(f"✓ Migrated: added {col} to companies")

            # ------ placement_drives ------
            result = conn.execute(text("PRAGMA table_info(placement_drives)"))
            drive_cols = [row[1] for row in result.fetchall()]

            drive_migrations = [
                ("drive_id",        "ALTER TABLE placement_drives ADD COLUMN drive_id VARCHAR(30)"),
                ("job_type",        "ALTER TABLE placement_drives ADD COLUMN job_type VARCHAR(50)"),
                ("work_mode",       "ALTER TABLE placement_drives ADD COLUMN work_mode VARCHAR(50)"),
                ("experience_level","ALTER TABLE placement_drives ADD COLUMN experience_level VARCHAR(50)"),
                ("vacancies",       "ALTER TABLE placement_drives ADD COLUMN vacancies INTEGER"),
                ("selection_process", "ALTER TABLE placement_drives ADD COLUMN selection_process VARCHAR(200)"),
                ("additional_notes","ALTER TABLE placement_drives ADD COLUMN additional_notes TEXT"),
                ("target_degrees",  "ALTER TABLE placement_drives ADD COLUMN target_degrees VARCHAR(300)"),
                ("target_years",    "ALTER TABLE placement_drives ADD COLUMN target_years VARCHAR(200)"),
                ("application_deadline_time", "ALTER TABLE placement_drives ADD COLUMN application_deadline_time TIME"),
                ("publish_date",    "ALTER TABLE placement_drives ADD COLUMN publish_date DATE"),
                ("publish_time",    "ALTER TABLE placement_drives ADD COLUMN publish_time TIME"),
                ("updated_at",      "ALTER TABLE placement_drives ADD COLUMN updated_at DATETIME"),
                ("closed_at",       "ALTER TABLE placement_drives ADD COLUMN closed_at DATETIME"),
            ]
            for col, sql in drive_migrations:
                if col not in drive_cols:
                    conn.execute(text(sql))
                    conn.commit()
                    print(f"✓ Migrated: added {col} to placement_drives")

            # Backward compatibility: migrate old interview_rounds data to selection_process.
            if "selection_process" in drive_cols or any(col == "selection_process" for col, _ in drive_migrations):
                legacy_cols = [row[1] for row in conn.execute(text("PRAGMA table_info(placement_drives)")).fetchall()]
                if "interview_rounds" in legacy_cols:
                    conn.execute(text(
                        "UPDATE placement_drives "
                        "SET selection_process = interview_rounds "
                        "WHERE (selection_process IS NULL OR TRIM(selection_process)='') "
                        "AND interview_rounds IS NOT NULL AND TRIM(interview_rounds)!=''"
                    ))
                    conn.commit()

            # ---- applications ----
            result = conn.execute(text("PRAGMA table_info(applications)"))
            app_cols = [row[1] for row in result.fetchall()]
            app_migrations = [
                ("remark",        "ALTER TABLE applications ADD COLUMN remark VARCHAR(200)"),
                ("internal_note", "ALTER TABLE applications ADD COLUMN internal_note TEXT"),
                ("status_updated_at", "ALTER TABLE applications ADD COLUMN status_updated_at DATETIME"),
                ("application_code", "ALTER TABLE applications ADD COLUMN application_code VARCHAR(20)"),
            ]
            for col, sql in app_migrations:
                if col not in app_cols:
                    conn.execute(text(sql))
                    conn.commit()
                    print(f"✓ Migrated: added {col} to applications")
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_applications_application_code "
                "ON applications(application_code)"
            ))
            conn.commit()

            # ---- support_tickets ----
            result = conn.execute(text("PRAGMA table_info(support_tickets)"))
            ticket_cols = [row[1] for row in result.fetchall()]
            if "updated_at" not in ticket_cols:
                conn.execute(text("ALTER TABLE support_tickets ADD COLUMN updated_at DATETIME"))
                conn.commit()
                print("✓ Migrated: added updated_at to support_tickets")

            # ---- interview_schedules ----
            result = conn.execute(text("PRAGMA table_info(interview_schedules)"))
            interview_cols = [row[1] for row in result.fetchall()]
            interview_migrations = [
                ("schedule_status", "ALTER TABLE interview_schedules ADD COLUMN schedule_status VARCHAR(20) DEFAULT 'Scheduled'"),
                ("status_updated_at", "ALTER TABLE interview_schedules ADD COLUMN status_updated_at DATETIME"),
            ]
            for col, sql in interview_migrations:
                if col not in interview_cols:
                    conn.execute(text(sql))
                    conn.commit()
                    print(f"✓ Migrated: added {col} to interview_schedules")

            conn.execute(text(
                "UPDATE interview_schedules "
                "SET schedule_status='Scheduled' "
                "WHERE schedule_status IS NULL OR TRIM(schedule_status)=''"
            ))
            conn.commit()

            # ---- new tables ----
            # Running create_all again is idempotent and creates newly added models.
            db.create_all()

        # Backfill drive IDs and timestamps for old records
        # to keep legacy DBs compatible with current UI expectations.
        companies = Company.query.all()
        for company in companies:
            company_drives = PlacementDrive.query.filter_by(company_id=company.id).order_by(PlacementDrive.id.asc()).all()
            seq = 1
            suffix = "000"
            if company.company_id and "C" in company.company_id:
                suffix = company.company_id.split("C")[-1][-3:].zfill(3)
            for drive in company_drives:
                if not drive.drive_id:
                    drive.drive_id = f"C{suffix}D{seq}"
                    seq += 1
                if not drive.updated_at:
                    drive.updated_at = drive.created_at or datetime.utcnow()
                created_exists = DriveActivityLog.query.filter_by(
                    company_id=company.id,
                    drive_id=drive.id,
                    action="created"
                ).first()
                if not created_exists:
                    db.session.add(DriveActivityLog(
                        company_id=company.id,
                        drive_id=drive.id,
                        action="created",
                        summary=f"{drive.job_title} ({drive.drive_id})",
                        created_at=drive.created_at or datetime.utcnow()
                    ))
        Application.query.filter(Application.status_updated_at.is_(None)).update(
            {Application.status_updated_at: Application.application_date},
            synchronize_session=False
        )
        Application.query.filter(Application.status == "Selected").update(
            {Application.status: "Placed"},
            synchronize_session=False
        )

        # Backfill/normalize application codes to PLAXYYAXXXX
        apps_all = Application.query.order_by(
            Application.application_date.asc(),
            Application.id.asc()
        ).all()
        seq_by_year = {}
        for app_item in apps_all:
            code = (app_item.application_code or "").strip().upper()
            if not code:
                continue
            m = re.match(r"^PLAX(\d{2})A(\d+)$", code)
            if m:
                yy = m.group(1)
                seq_by_year[yy] = max(seq_by_year.get(yy, 0), int(m.group(2)))

        for app_item in apps_all:
            app_dt = app_item.application_date or datetime.utcnow()
            yy = app_dt.strftime("%y")
            prefix = f"PLAX{yy}A"
            code = (app_item.application_code or "").strip().upper()
            if re.match(rf"^{prefix}\d+$", code):
                continue
            seq_by_year[yy] = seq_by_year.get(yy, 0) + 1
            app_item.application_code = f"{prefix}{seq_by_year[yy]:04d}"

        db.session.commit()

        # Create default admin
        if not Admin.query.filter_by(email="admin@plaxeron.com").first():
            admin = Admin(
                email="admin@plaxeron.com",
                password=generate_password_hash("admin123")
            )
            db.session.add(admin)
            db.session.commit()
            print("✓ Admin account created: admin@plaxeron.com / admin123")


# ==========================
# RUN APP
# ==========================
if __name__ == "__main__":
    create_tables_and_admin()
    app.run(debug=True)
