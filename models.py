"""Models package - All database models consolidated into a single file.

This file contains all SQLAlchemy models for the Placement Portal application.
"""

from datetime import datetime

from flask_sqlalchemy import SQLAlchemy

# Single SQLAlchemy registry used across the app.
db = SQLAlchemy()


# ==========================
# ACTOR MODELS (Admin, Student, Company)
# ==========================

class Admin(db.Model):
    """Predefined superuser account for institute/admin operations."""

    __tablename__ = "admins"

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(200), nullable=False)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    

    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False

    def get_id(self):
        # Namespaced ID keeps Flask-Login role loading explicit.
        return f"admin:{self.id}"

    def __repr__(self):
        return f"<Admin {self.email}>"


class Student(db.Model):
    """Student / Job seeker profile and account."""

    __tablename__ = "students"

    id = db.Column(db.Integer, primary_key=True)

    # Account
    name = db.Column(db.String(100), nullable=False)
    student_id = db.Column(db.String(20), unique=True, nullable=True, index=True)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password = db.Column(db.String(200), nullable=False)
    dob = db.Column(db.String(20))

    # Password reset
    reset_token = db.Column(db.String(100), unique=True)
    reset_token_expiry = db.Column(db.DateTime)

    # Academic
    college = db.Column(db.String(150))
    degree = db.Column(db.String(50))
    branch = db.Column(db.String(100))
    year_of_study = db.Column(db.String(20))
    cgpa = db.Column(db.Float)
    tenth_percent = db.Column(db.Float)
    twelfth_percent = db.Column(db.Float)
    graduation_year = db.Column(db.String(20))

    # Profile
    skills = db.Column(db.String(500))
    linkedin = db.Column(db.String(255))
    github = db.Column(db.String(255))
    bio = db.Column(db.Text)
    resume_url = db.Column(db.String(255))

    # System flags
    contact = db.Column(db.String(15))
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    applications = db.relationship(
        "Application",
        backref="student",
        lazy=True,
        cascade="all, delete-orphan",
    )
    support_tickets = db.relationship(
        "SupportTicket",
        backref="student",
        lazy=True,
        cascade="all, delete-orphan",
        foreign_keys="SupportTicket.student_id",
    )

    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False

    def get_id(self):
        return f"student:{self.id}"

    def __repr__(self):
        return f"<Student {self.email}>"


class Company(db.Model):
    """Company account + company profile + approval status."""

    __tablename__ = "companies"

    id = db.Column(db.Integer, primary_key=True)

    # Company profile
    company_name = db.Column(db.String(150), nullable=False)
    company_id = db.Column(db.String(20), unique=True, nullable=True, index=True)
    industry = db.Column(db.String(100))
    company_size = db.Column(db.String(50))
    location = db.Column(db.String(150))
    website = db.Column(db.String(200))
    description = db.Column(db.Text)

    # HR / POC
    hr_contact = db.Column(db.String(100))
    hr_designation = db.Column(db.String(100))
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    alt_email = db.Column(db.String(120))
    mobile = db.Column(db.String(20))
    office_number = db.Column(db.String(20))

    # Credentials
    password = db.Column(db.String(200), nullable=False)

    # Approval & activity state
    approval_status = db.Column(db.String(20), default="Pending")
    is_approved = db.Column(db.Boolean, default=False)
    is_active = db.Column(db.Boolean, default=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    drives = db.relationship(
        "PlacementDrive",
        backref="company",
        lazy=True,
        cascade="all, delete-orphan",
    )
    support_tickets = db.relationship(
        "SupportTicket",
        backref="company",
        lazy=True,
        cascade="all, delete-orphan",
        foreign_keys="SupportTicket.company_id",
    )

    @property
    def is_authenticated(self):
        return True

    @property
    def is_anonymous(self):
        return False

    def to_dict(self):
        return {
            "id": self.id,
            "company_name": self.company_name,
            "location": self.location,
            "industry": self.industry,
            "website": self.website,
        }

    def get_id(self):
        return f"company:{self.id}"

    def __repr__(self):
        return f"<Company {self.company_name}>"


# ==========================
# RECRUITMENT MODELS
# ==========================

class PlacementDrive(db.Model):
    """Company-created placement drive / job position."""

    __tablename__ = "placement_drives"

    id = db.Column(db.Integer, primary_key=True)

    company_id = db.Column(
        db.Integer,
        db.ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # Drive details
    drive_id = db.Column(db.String(30), unique=True, index=True)
    job_title = db.Column(db.String(150), nullable=False)
    job_description = db.Column(db.Text, nullable=False)
    eligibility_criteria = db.Column(db.String(500))
    required_skills = db.Column(db.String(300))
    salary = db.Column(db.Integer)
    location = db.Column(db.String(100))
    job_type = db.Column(db.String(50))
    work_mode = db.Column(db.String(50))
    experience_level = db.Column(db.String(50))
    vacancies = db.Column(db.Integer)
    selection_process = db.Column(db.String(200))
    additional_notes = db.Column(db.Text)

    # Audience targeting (CSV values)
    target_degrees = db.Column(db.String(300))
    target_years = db.Column(db.String(200))

    # Timeline
    application_deadline = db.Column(db.Date)
    application_deadline_time = db.Column(db.Time)
    publish_date = db.Column(db.Date)
    publish_time = db.Column(db.Time)

    # Status values used in app: Pending / Approved / Closed / Rejected
    status = db.Column(db.String(20), default="Pending", index=True)

    # Audit timestamps
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    closed_at = db.Column(db.DateTime)

    applications = db.relationship(
        "Application",
        backref="drive",
        lazy=True,
        cascade="all, delete-orphan",
    )

    def to_dict(self):
        return {
            "id": self.id,
            "drive_id": self.drive_id,
            "job_title": self.job_title,
            "job_description": self.job_description,
            "salary": self.salary,
            "location": self.location,
            "status": self.status,
            "vacancies": self.vacancies,
            "application_deadline": (
                self.application_deadline.isoformat() if self.application_deadline else None
            ),
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self):
        return f"<PlacementDrive {self.job_title} ({self.status})>"


class Application(db.Model):
    """Student application against a placement drive."""

    __tablename__ = "applications"

    id = db.Column(db.Integer, primary_key=True)
    application_code = db.Column(db.String(20), unique=True, index=True)

    student_id = db.Column(
        db.Integer,
        db.ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    drive_id = db.Column(
        db.Integer,
        db.ForeignKey("placement_drives.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    application_date = db.Column(db.DateTime, default=datetime.utcnow)
    status_updated_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Workflow values: Applied / Shortlisted / Interview / Placed / Rejected
    status = db.Column(db.String(20), default="Applied", index=True)
    remark = db.Column(db.String(200))
    internal_note = db.Column(db.Text)

    # Prevent duplicate applications by same student to same drive.
    __table_args__ = (
        db.UniqueConstraint("student_id", "drive_id", name="unique_student_drive_application"),
    )

    def __repr__(self):
        return f"<Application Student:{self.student_id} Drive:{self.drive_id} Status:{self.status}>"


class InterviewSchedule(db.Model):
    """Interview scheduling metadata for applications moved to interview stage."""

    __tablename__ = "interview_schedules"

    id = db.Column(db.Integer, primary_key=True)

    company_id = db.Column(
        db.Integer,
        db.ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    drive_id = db.Column(
        db.Integer,
        db.ForeignKey("placement_drives.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    application_id = db.Column(
        db.Integer,
        db.ForeignKey("applications.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    interview_date = db.Column(db.Date, nullable=False)
    interview_time = db.Column(db.Time, nullable=False)
    mode = db.Column(db.String(30), default="Online")
    notes = db.Column(db.Text)

    schedule_status = db.Column(db.String(20), nullable=False, default="Scheduled", index=True)
    status_updated_at = db.Column(db.DateTime, default=datetime.utcnow)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    company = db.relationship("Company", backref=db.backref("interview_schedules", lazy=True))
    drive = db.relationship("PlacementDrive", backref=db.backref("interview_schedules", lazy=True))
    application = db.relationship(
        "Application", backref=db.backref("interview_schedule", uselist=False)
    )

    def __repr__(self):
        return f"<InterviewSchedule App:{self.application_id} {self.interview_date} {self.interview_time}>"


# ==========================
# NOTIFICATION MODELS
# ==========================

class CompanyNotification(db.Model):
    __tablename__ = "company_notifications"

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(
        db.Integer,
        db.ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    notif_type = db.Column(db.String(30), nullable=False, default="info")
    icon = db.Column(db.String(50), nullable=False, default="bi-info-circle")
    text = db.Column(db.String(500), nullable=False)
    notif_key = db.Column(db.String(120), unique=True, nullable=False, index=True)
    is_read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    company = db.relationship(
        "Company", backref=db.backref("notifications", lazy=True, cascade="all, delete-orphan")
    )

    def __repr__(self):
        return f"<CompanyNotification Company:{self.company_id} key:{self.notif_key}>"


class StudentNotification(db.Model):
    __tablename__ = "student_notifications"

    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(
        db.Integer,
        db.ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    notif_type = db.Column(db.String(30), nullable=False, default="info")
    icon = db.Column(db.String(50), nullable=False, default="bi-info-circle")
    text = db.Column(db.String(500), nullable=False)
    notif_key = db.Column(db.String(120), unique=True, nullable=False, index=True)
    is_read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    student = db.relationship(
        "Student", backref=db.backref("notifications", lazy=True, cascade="all, delete-orphan")
    )

    def __repr__(self):
        return f"<StudentNotification Student:{self.student_id} key:{self.notif_key}>"


class StudentDriveView(db.Model):
    __tablename__ = "student_drive_views"

    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(
        db.Integer,
        db.ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    drive_id = db.Column(
        db.Integer,
        db.ForeignKey("placement_drives.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    viewed_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)

    __table_args__ = (
        db.UniqueConstraint("student_id", "drive_id", name="uq_student_drive_view"),
    )

    student = db.relationship(
        "Student", backref=db.backref("viewed_drives", lazy=True, cascade="all, delete-orphan")
    )
    drive = db.relationship(
        "PlacementDrive",
        backref=db.backref("student_views", lazy=True, cascade="all, delete-orphan"),
    )

    def __repr__(self):
        return f"<StudentDriveView Student:{self.student_id} Drive:{self.drive_id}>"


class DriveActivityLog(db.Model):
    __tablename__ = "drive_activity_logs"

    id = db.Column(db.Integer, primary_key=True)
    company_id = db.Column(
        db.Integer,
        db.ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    drive_id = db.Column(
        db.Integer,
        db.ForeignKey("placement_drives.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    action = db.Column(db.String(20), nullable=False)  # created / edited / closed
    summary = db.Column(db.String(500))
    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    company = db.relationship(
        "Company",
        backref=db.backref("drive_activity_logs", lazy=True, cascade="all, delete-orphan"),
    )
    drive = db.relationship(
        "PlacementDrive",
        backref=db.backref("activity_logs", lazy=True, cascade="all, delete-orphan"),
    )

    def __repr__(self):
        return f"<DriveActivityLog Drive:{self.drive_id} action:{self.action}>"


# ==========================
# SUPPORT MODELS
# ==========================

class SupportTicket(db.Model):
    __tablename__ = "support_tickets"

    id = db.Column(db.Integer, primary_key=True)

    # Either student_id OR company_id is set based on submitter_type.
    student_id = db.Column(
        db.Integer,
        db.ForeignKey("students.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )
    company_id = db.Column(
        db.Integer,
        db.ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=True,
        index=True,
    )

    subject = db.Column(db.String(200), nullable=False)
    message = db.Column(db.Text, nullable=False)
    category = db.Column(db.String(50), default="General")

    # Open / In Progress / Resolved / Closed
    status = db.Column(db.String(20), default="Open", index=True)

    # Admin response
    admin_reply = db.Column(db.Text)
    replied_at = db.Column(db.DateTime)
    replied_by_admin = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)

    submitter_type = db.Column(db.String(20), nullable=False, default="student")

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    resolved_at = db.Column(db.DateTime)

    def __repr__(self):
        return f"<SupportTicket #{self.id} [{self.status}] {self.subject[:40]}>"


class BroadcastMessage(db.Model):
    """Admin broadcast to students / companies / all."""

    __tablename__ = "broadcast_messages"

    id = db.Column(db.Integer, primary_key=True)
    target = db.Column(db.String(20), nullable=False)  # student / company / all

    subject = db.Column(db.String(255), nullable=False)
    message = db.Column(db.Text, nullable=False)

    sent_by = db.Column(db.Integer, db.ForeignKey("admins.id"), nullable=True)
    sent_at = db.Column(db.DateTime, default=datetime.utcnow)
    recipient_count = db.Column(db.Integer, default=0)

    def __repr__(self):
        return f"<BroadcastMessage to={self.target} subject={self.subject[:30]}>"


class CompanyBroadcast(db.Model):
    """Company-origin broadcast (optionally linked to a drive)."""

    __tablename__ = "company_broadcasts"

    id = db.Column(db.Integer, primary_key=True)

    company_id = db.Column(
        db.Integer,
        db.ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    drive_id = db.Column(
        db.Integer,
        db.ForeignKey("placement_drives.id", ondelete="SET NULL"),
        nullable=True,
    )

    subject = db.Column(db.String(255), nullable=False)
    message = db.Column(db.Text, nullable=False)
    sent_at = db.Column(db.DateTime, default=datetime.utcnow)

    company = db.relationship("Company", backref=db.backref("broadcasts_sent", lazy=True))
    drive = db.relationship("PlacementDrive", backref=db.backref("broadcasts", lazy=True))

    def __repr__(self):
        return f"<CompanyBroadcast {self.subject[:30]}>"


# ==========================
# AUDIT MODELS
# ==========================

class DeletedStudentLog(db.Model):
    __tablename__ = "deleted_student_logs"

    id = db.Column(db.Integer, primary_key=True)
    original_student_pk = db.Column(db.Integer, index=True)
    student_id = db.Column(db.String(20), index=True)
    name = db.Column(db.String(100))
    email = db.Column(db.String(120), index=True)
    college = db.Column(db.String(150))
    degree = db.Column(db.String(50))

    deleted_by_admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="SET NULL"),
        nullable=True,
    )
    deleted_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    deleted_by_admin = db.relationship("Admin", backref=db.backref("deleted_student_logs", lazy=True))

    def __repr__(self):
        return f"<DeletedStudentLog student_id={self.student_id or self.original_student_pk}>"


class DeletedCompanyLog(db.Model):
    __tablename__ = "deleted_company_logs"

    id = db.Column(db.Integer, primary_key=True)
    original_company_pk = db.Column(db.Integer, index=True)
    company_id = db.Column(db.String(20), index=True)
    company_name = db.Column(db.String(150))
    email = db.Column(db.String(120), index=True)
    industry = db.Column(db.String(100))
    approval_status = db.Column(db.String(20))

    deleted_by_admin_id = db.Column(
        db.Integer,
        db.ForeignKey("admins.id", ondelete="SET NULL"),
        nullable=True,
    )
    deleted_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    deleted_by_admin = db.relationship("Admin", backref=db.backref("deleted_company_logs", lazy=True))

    def __repr__(self):
        return f"<DeletedCompanyLog company_id={self.company_id or self.original_company_pk}>"


# Export all models for easy importing
__all__ = [
    "db",
    "Admin",
    "Student",
    "Company",
    "PlacementDrive",
    "Application",
    "InterviewSchedule",
    "CompanyNotification",
    "StudentNotification",
    "StudentDriveView",
    "DriveActivityLog",
    "SupportTicket",
    "BroadcastMessage",
    "CompanyBroadcast",
    "DeletedStudentLog",
    "DeletedCompanyLog",
]

