export type QuestionType = 'mcq' | 'true_false' | 'short_answer' | 'essay';

export interface TrueFalseStatement {
  text: string;
  isTrue: boolean;
}

export interface ExamQuestion {
  id: string;
  index: number;
  type: QuestionType;
  prompt: string;
  maxScore: number;
  imageUrls?: string[];
  options?: string[];
  correctOption?: number;
  statements?: TrueFalseStatement[];
  correctAnswer?: string;
  explanation: string;
  explanationImageUrls?: string[];
}

export interface Classroom {
  id: string;
  teacherId: string;
  name: string;
  subject: string;
  grade: string;
  academicYear: string;
  joinCode: string;
  studentCount: number;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StudentRecord {
  id: string;
  classId: string;
  teacherId: string;
  fullName: string;
  studentCode: string;
  parentPhone: string;
  parentName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface Exam {
  id: string;
  teacherId: string;
  title: string;
  subject: string;
  examCode: string;
  durationMinutes: number;
  isPublished: boolean;
  questionCount: number;
  questions: ExamQuestion[];
  assignedClassIds?: string[];
  assignedClassNames?: string[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface EssayCriterionResult {
  criterion: string;
  score: number;
  maxScore: number;
  met: boolean;
}

export interface StudentAnswer {
  questionId: string;
  type: QuestionType;
  selectedOption?: number | null;
  statementAnswers?: (boolean | null)[];
  textAnswer?: string;
  imageDataUrl?: string;
  recognizedText?: string;
  timeSpentSeconds: number;
  score: number;
  maxScore: number;
  isCorrect: boolean;
  aiFeedback?: string;
  aiBreakdown?: EssayCriterionResult[];
}

export interface Submission {
  id: string;
  examId: string;
  examTitle: string;
  teacherId: string;
  studentUid: string;
  studentCode?: string;
  classJoinCode?: string;
  studentName: string;
  className: string;
  durationSeconds: number;
  violationCount: number;
  status: 'graded' | 'pending_essay';
  totalScore: number;
  maxScore: number;
  teacherComment: string;
  aiAnalysis: string;
  parentPhone: string;
  answers: StudentAnswer[];
  submittedAt?: unknown;
  updatedAt?: unknown;
}

export interface ParentMessage {
  id: string;
  teacherId: string;
  submissionId: string;
  studentName: string;
  className: string;
  examTitle: string;
  parentPhone: string;
  content: string;
  status: 'draft' | 'sent';
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: 'teacher' | 'student';
  seeded: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StudentCodeIndex {
  id: string;
  teacherId: string;
  classId: string;
  className: string;
  studentCode: string;
  studentName: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ClassRosterEntry {
  id: string;
  fullName: string;
  studentCode: string;
}

export interface ClassRoster {
  id: string;
  teacherId: string;
  classId: string;
  className: string;
  subject: string;
  joinCode: string;
  studentEntries: ClassRosterEntry[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type TeacherNavTab =
  | 'overview'
  | 'classes'
  | 'homework_check'
  | 'oral_ai_check'
  | 'exams'
  | 'reference_bank'
  | 'messages';

export type ReferenceDifficulty = 'nhan_biet' | 'thong_hieu' | 'van_dung';

export interface ReferenceQuestionItem {
  id: string;
  type: QuestionType;
  topicTag: string;
  difficulty: ReferenceDifficulty;
  prompt: string;
  options?: string[];
  correctOption?: number;
  statements?: TrueFalseStatement[];
  correctAnswer?: string;
  explanation: string;
}

export interface ReferenceMaterial {
  id: string;
  teacherId: string;
  title: string;
  subject: string;
  topic: string;
  grade: string;
  sourceFileName: string;
  knowledgeSummary: string;
  items: ReferenceQuestionItem[];
  itemCount: number;
  isActiveForAi: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type EffortLevel = 'serious' | 'watch' | 'perfunctory';

export interface StudentReviewSummary {
  overallComment: string;
  strengths: string;
  weaknesses: string;
  pacingNote: string;
  studyPlan: string;
}

export interface StudentAttemptTypeStat {
  type: QuestionType;
  label: string;
  count: number;
  earned: number;
  max: number;
}

export interface StudentJournalEntry {
  submissionId: string;
  examId: string;
  examCode: string;
  examTitle: string;
  subject: string;
  teacherId: string;
  studentUid: string;
  studentName: string;
  className: string;
  studentCode?: string;
  totalScore: number;
  maxScore: number;
  score10: number;
  durationSeconds: number;
  violationCount: number;
  status: 'graded' | 'pending_essay';
  teacherComment: string;
  effortLevel: EffortLevel;
  effortRiskScore: number;
  effortReasons: string[];
  typeStats: StudentAttemptTypeStat[];
  aiReview?: StudentReviewSummary;
  submittedAtIso: string;
}

export interface StudentJournal {
  id: string;
  teacherId: string;
  studentKey: string;
  studentName: string;
  className: string;
  studentCode?: string;
  entries: StudentJournalEntry[];
  createdAt?: unknown;
  updatedAt?: unknown;
}

export type HomeworkStatus = 'submitted' | 'missing' | 'incomplete';

export interface HomeworkSession {
  id: string;
  teacherId: string;
  classId: string;
  className: string;
  title: string;
  dateLabel: string;
  statuses: Record<string, HomeworkStatus>;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface HandwrittenCheck {
  id: string;
  teacherId: string;
  classId?: string;
  className?: string;
  studentId?: string;
  studentName: string;
  studentCode?: string;
  promptText?: string;
  score: number;
  maxScore: number;
  recognizedText: string;
  strengths?: string;
  mistakes?: string;
  teacherComment: string;
  breakdown: EssayCriterionResult[];
  createdAt?: unknown;
  updatedAt?: unknown;
}
