import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { useEffect, useRef, useState } from 'react';
import { ClassesView } from './components/ClassesView';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ExamsView } from './components/ExamsView';
import { HomeworkCheckView } from './components/HomeworkCheckView';
import { LandingView } from './components/LandingView';
import { OralCheckAiView } from './components/OralCheckAiView';
import { OverviewView } from './components/OverviewView';
import { ParentMessagesView } from './components/ParentMessagesView';
import { ReferenceBankView } from './components/ReferenceBankView';
import { Sidebar } from './components/Sidebar';
import { StudentExamView } from './components/StudentExamView';
import { SubmissionDetailView } from './components/SubmissionDetailView';
import { auth, buildGoogleProvider, testConnection } from './firebase';
import {
  ensureStudentProfile,
  ensureTeacherProfileAndSeed,
  getUserProfile,
  subscribeTeacherWorkspace,
} from './services/firestoreService';
import { subscribeTeacherReferenceMaterials } from './services/referenceBankService';
import type {
  Classroom,
  Exam,
  ParentMessage,
  ReferenceMaterial,
  Submission,
  TeacherNavTab,
} from './types';

type AppRoute = 'landing' | 'teacher' | 'student';
type PortalRole = 'teacher' | 'student';

const ROLE_STORAGE_KEY = 'diem10_session_role';

function readStoredRole(): PortalRole | null {
  try {
    const val = localStorage.getItem(ROLE_STORAGE_KEY);
    return val === 'teacher' || val === 'student' ? val : null;
  } catch {
    return null;
  }
}

function writeStoredRole(role: PortalRole | null): void {
  try {
    if (role) {
      localStorage.setItem(ROLE_STORAGE_KEY, role);
    } else {
      localStorage.removeItem(ROLE_STORAGE_KEY);
    }
  } catch {
    // Ignore storage access issues in restricted contexts
  }
}

function readInitialUrlHints(): {
  examCode?: string;
  studentCode?: string;
  classCode?: string;
  hasStudentEntryParams: boolean;
} {
  try {
    const params = new URLSearchParams(window.location.search);
    const examCode = params.get('exam') || params.get('examCode') || undefined;
    const studentCode = params.get('studentCode') || undefined;
    const classCode = params.get('classCode') || params.get('class') || undefined;
    return {
      examCode: examCode?.trim() || undefined,
      studentCode: studentCode?.trim() || undefined,
      classCode: classCode?.trim() || undefined,
      hasStudentEntryParams: Boolean(classCode?.trim() || examCode?.trim() || studentCode?.trim()),
    };
  } catch {
    return { hasStudentEntryParams: false };
  }
}

function AppShell() {
  const [initialHints] = useState(() => readInitialUrlHints());
  const [user, setUser] = useState<User | null>(null);
  const [sessionRole, setSessionRole] = useState<PortalRole | null>(() => readStoredRole());
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [route, setRoute] = useState<AppRoute>(() =>
    initialHints.hasStudentEntryParams ? 'student' : 'landing'
  );
  const [studentExamCode, setStudentExamCode] = useState<string | undefined>(
    initialHints.examCode
  );
  const [studentCodeHint, setStudentCodeHint] = useState<string | undefined>(
    initialHints.studentCode
  );
  const [studentClassCodeHint, setStudentClassCodeHint] = useState<string | undefined>(
    initialHints.classCode
  );
  const [activeTab, setActiveTab] = useState<TeacherNavTab>('overview');
  const [selectedExamId, setSelectedExamId] = useState<string | null>(null);
  const [selectedSubmissionId, setSelectedSubmissionId] = useState<string | null>(null);

  // Quick-action signals
  const [openClassModalSignal, setOpenClassModalSignal] = useState(0);
  const [openExamModalSignal, setOpenExamModalSignal] = useState(0);

  // Live Firestore collections for Teacher Workspace
  const [classes, setClasses] = useState<Classroom[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [parentMessages, setParentMessages] = useState<ParentMessage[]>([]);
  const [referenceMaterials, setReferenceMaterials] = useState<ReferenceMaterial[]>([]);
  const [workspaceLoading, setWorkspaceLoading] = useState(false);

  const pendingRoleRef = useRef<PortalRole | null>(null);
  const routeRef = useRef<AppRoute>(route);
  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  useEffect(() => {
    testConnection();
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        setUser(null);
        setSessionRole(null);
        setAuthReady(true);
        if (routeRef.current === 'teacher') {
          setRoute('landing');
        }
        return;
      }

      setUser(currentUser);
      let resolvedRole = pendingRoleRef.current || readStoredRole();
      pendingRoleRef.current = null;

      if (!resolvedRole) {
        try {
          const profile = await getUserProfile(currentUser.uid);
          resolvedRole = profile?.role || 'teacher';
        } catch {
          resolvedRole = 'teacher';
        }
      }

      writeStoredRole(resolvedRole);
      setSessionRole(resolvedRole);
      setAuthReady(true);

      if (routeRef.current === 'landing') {
        setRoute(resolvedRole === 'student' ? 'student' : 'teacher');
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !user || sessionRole !== 'teacher') {
      setClasses([]);
      setExams([]);
      setSubmissions([]);
      setParentMessages([]);
      setReferenceMaterials([]);
      return;
    }

    let active = true;
    let unsubWorkspace: (() => void) | null = null;
    let unsubReferences: (() => void) | null = null;

    async function initTeacherData() {
      if (!user) return;
      setWorkspaceLoading(true);
      try {
        try {
          await ensureTeacherProfileAndSeed(user);
        } catch (seedErr) {
          console.warn('Teacher seed/profile initialization warning:', seedErr);
        }
        if (!active) return;
        unsubWorkspace = subscribeTeacherWorkspace(
          user.uid,
          setClasses,
          setExams,
          setSubmissions,
          setParentMessages
        );
        unsubReferences = subscribeTeacherReferenceMaterials(
          user.uid,
          setReferenceMaterials
        );
      } finally {
        if (active) setWorkspaceLoading(false);
      }
    }

    initTeacherData();

    return () => {
      active = false;
      if (unsubWorkspace) unsubWorkspace();
      if (unsubReferences) unsubReferences();
    };
  }, [authReady, user, sessionRole]);

  const handleTeacherSignIn = async (emailHint?: string) => {
    setAuthLoading(true);
    setAuthError(null);
    pendingRoleRef.current = 'teacher';
    writeStoredRole('teacher');
    try {
      const cred = await signInWithPopup(auth, buildGoogleProvider(emailHint));
      await ensureTeacherProfileAndSeed(cred.user);
      setSessionRole('teacher');
      setRoute('teacher');
    } catch (err) {
      pendingRoleRef.current = null;
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('popup-closed-by-user')) {
        setAuthError('Không thể đăng nhập tài khoản Giáo viên bằng Google. Vui lòng thử lại.');
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleStudentSignIn = async (examCode?: string) => {
    setAuthLoading(true);
    setAuthError(null);
    pendingRoleRef.current = 'student';
    writeStoredRole('student');
    try {
      const cred = await signInWithPopup(auth, buildGoogleProvider());
      await ensureStudentProfile(cred.user);
      setSessionRole('student');
      if (examCode) {
        setStudentExamCode(examCode);
      }
      setRoute('student');
    } catch (err) {
      pendingRoleRef.current = null;
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('popup-closed-by-user')) {
        setAuthError('Không thể đăng nhập tài khoản Học sinh bằng Google. Vui lòng thử lại.');
      }
    } finally {
      setAuthLoading(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
    writeStoredRole(null);
    setSessionRole(null);
    setSelectedExamId(null);
    setSelectedSubmissionId(null);
    setActiveTab('overview');
    setRoute('landing');
  };

  const handleOpenSubmission = (submissionId: string) => {
    const found = submissions.find((s) => s.id === submissionId);
    if (found) {
      setSelectedExamId(found.examId);
    }
    setSelectedSubmissionId(submissionId);
    setActiveTab('exams');
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F6F8F7] flex flex-col items-center justify-center gap-3">
        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-[#E5C665] via-[#C89B2B] to-[#9E7514] text-[#093027] font-serif font-bold text-base flex items-center justify-center shadow-sm">
          10
        </div>
        <div className="text-sm font-medium text-[#4A615A]">Đang khởi tạo Điểm 10...</div>
      </div>
    );
  }

  if (route === 'student') {
    const isTeacherPreview = Boolean(user && sessionRole === 'teacher');
    return (
      <StudentExamView
        user={user}
        initialExamCode={studentExamCode}
        initialStudentCode={studentCodeHint}
        initialClassCode={studentClassCodeHint}
        teacherExams={isTeacherPreview ? exams : []}
        teacherClasses={isTeacherPreview ? classes : []}
        teacherReferenceMaterials={isTeacherPreview ? referenceMaterials : undefined}
        isTeacherPreview={isTeacherPreview}
        onExit={() => setRoute(isTeacherPreview ? 'teacher' : 'landing')}
        onSignInRequest={() => handleStudentSignIn(studentExamCode)}
      />
    );
  }

  if (route === 'landing' || !user || sessionRole !== 'teacher') {
    return (
      <LandingView
        user={user}
        userRole={sessionRole}
        authLoading={authLoading}
        onTeacherSignIn={handleTeacherSignIn}
        onStudentSignIn={handleStudentSignIn}
        onEnterTeacherDashboard={() => {
          setSessionRole('teacher');
          writeStoredRole('teacher');
          setRoute('teacher');
        }}
        onEnterStudentMode={(code, stuCode, clsCode) => {
          setStudentExamCode(code);
          setStudentCodeHint(stuCode);
          setStudentClassCodeHint(clsCode);
          setRoute('student');
        }}
        onSignOut={handleSignOut}
        authError={authError}
      />
    );
  }

  const activeSubmission = selectedSubmissionId
    ? submissions.find((s) => s.id === selectedSubmissionId) || null
    : null;
  const activeSubmissionExam = activeSubmission
    ? exams.find((e) => e.id === activeSubmission.examId)
    : undefined;

  return (
    <div className="min-h-screen bg-[#F6F8F7] text-[#0D221D] flex flex-col lg:flex-row">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={(tab) => {
          setActiveTab(tab);
          setSelectedSubmissionId(null);
          if (tab !== 'exams') {
            setSelectedExamId(null);
          }
        }}
        userEmail={user.email || user.displayName || 'Giáo viên'}
        onBackHome={() => setRoute('landing')}
        onSignOut={handleSignOut}
      />

      <main className="flex-1 min-w-0 px-5 sm:px-8 lg:px-10 py-8">
        <div className="max-w-6xl mx-auto">
          {workspaceLoading && classes.length === 0 && exams.length === 0 ? (
            <div className="space-y-4">
              <div className="h-8 w-48 bg-[#E4ECE8] rounded-lg animate-pulse" />
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-28 bg-white border border-[#DAE5E0] rounded-2xl animate-pulse"
                  />
                ))}
              </div>
            </div>
          ) : activeTab === 'overview' ? (
            <OverviewView
              teacherId={user.uid}
              classes={classes}
              exams={exams}
              submissions={submissions}
              onOpenExam={(examId) => {
                setSelectedExamId(examId);
                setSelectedSubmissionId(null);
                setActiveTab('exams');
              }}
              onOpenSubmission={handleOpenSubmission}
              onQuickCreateClass={() => {
                setActiveTab('classes');
                setOpenClassModalSignal((n) => n + 1);
              }}
              onQuickCreateExam={() => {
                setActiveTab('exams');
                setSelectedExamId(null);
                setSelectedSubmissionId(null);
                setOpenExamModalSignal((n) => n + 1);
              }}
              onOpenStudentMode={() => {
                setStudentExamCode(exams[0]?.examCode);
                setRoute('student');
              }}
            />
          ) : activeTab === 'classes' ? (
            <ClassesView
              teacherId={user.uid}
              classes={classes}
              submissions={submissions}
              exams={exams}
              onOpenSubmission={handleOpenSubmission}
              openCreateModalSignal={openClassModalSignal}
              onConsumeCreateSignal={() => setOpenClassModalSignal(0)}
            />
          ) : activeTab === 'homework_check' ? (
            <HomeworkCheckView
              teacherId={user.uid}
              classes={classes}
              parentMessages={parentMessages}
              onOpenParentMessagesTab={() => setActiveTab('messages')}
              onQuickCreateClass={() => {
                setActiveTab('classes');
                setOpenClassModalSignal((n) => n + 1);
              }}
            />
          ) : activeTab === 'oral_ai_check' ? (
            <OralCheckAiView
              teacherId={user.uid}
              classes={classes}
              exams={exams}
              parentMessages={parentMessages}
              onOpenParentMessagesTab={() => setActiveTab('messages')}
            />
          ) : activeTab === 'exams' ? (
            activeSubmission ? (
              <SubmissionDetailView
                teacherId={user.uid}
                submission={activeSubmission}
                exam={activeSubmissionExam}
                allExamSubmissions={submissions.filter(
                  (s) => s.examId === activeSubmission.examId
                )}
                onBack={() => setSelectedSubmissionId(null)}
              />
            ) : (
              <ExamsView
                teacherId={user.uid}
                classes={classes}
                exams={exams}
                submissions={submissions}
                parentMessages={parentMessages}
                referenceMaterials={referenceMaterials}
                selectedExamId={selectedExamId}
                onSelectExam={(id) => {
                  setSelectedExamId(id);
                  setSelectedSubmissionId(null);
                }}
                onSelectSubmission={handleOpenSubmission}
                openCreateModalSignal={openExamModalSignal}
              />
            )
          ) : activeTab === 'reference_bank' ? (
            <ReferenceBankView
              teacherId={user.uid}
              materials={referenceMaterials}
              exams={exams}
            />
          ) : (
            <ParentMessagesView
              teacherId={user.uid}
              messages={parentMessages}
              submissions={submissions}
              exams={exams}
            />
          )}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppShell />
    </ErrorBoundary>
  );
}
