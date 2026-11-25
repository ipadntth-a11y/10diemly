import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type {
  ExamQuestion,
  QuestionType,
  ReferenceDifficulty,
  ReferenceMaterial,
  ReferenceQuestionItem,
  TrueFalseStatement,
} from '../types';

const MAX_ITEMS_PER_DOC = 50; // Safely below Firestore rule cap of 80 & 1MB budget

function makeMaterialId(): string {
  const rand = Math.random().toString(36).slice(2, 9);
  const ts = Date.now().toString(36);
  return `ref_${ts}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function clampStr(val: string | undefined | null, max: number): string {
  return (val ?? '').trim().slice(0, max);
}

function normalizeVietnameseText(val: string): string {
  return (val || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim();
}

function tokenizeVietnamese(val: string): string[] {
  const norm = normalizeVietnameseText(val);
  const rawTokens = norm.split(/[^a-z0-9]+/g).filter((t) => t.length >= 2);
  const stopWords = new Set([
    'cau',
    'bai',
    'cho',
    'mot',
    'nhung',
    'cac',
    'cua',
    'la',
    'va',
    'trong',
    'theo',
    'sau',
    'day',
    'nao',
    'dung',
    'sai',
    'bang',
    'tinh',
    'gia',
    'tri',
    'khi',
    'voi',
    'tu',
    'hay',
    'chon',
    'dap',
    'an',
    'hoi',
    'nhieu',
    'nhat',
  ]);
  return Array.from(new Set(rawTokens.filter((t) => !stopWords.has(t))));
}

function sanitizeDifficulty(raw: unknown): ReferenceDifficulty {
  if (raw === 'nhan_biet' || raw === 'thong_hieu' || raw === 'van_dung') {
    return raw;
  }
  return 'thong_hieu';
}

function sanitizeType(raw: unknown): QuestionType {
  if (raw === 'mcq' || raw === 'true_false' || raw === 'short_answer' || raw === 'essay') {
    return raw;
  }
  return 'mcq';
}

export function sanitizeReferenceItem(
  raw: Partial<ReferenceQuestionItem>,
  idx: number
): ReferenceQuestionItem {
  const type = sanitizeType(raw.type);
  const base: ReferenceQuestionItem = {
    id: clampStr(raw.id, 60) || `ref_q_${idx + 1}`,
    type,
    topicTag: clampStr(raw.topicTag, 120) || 'Kiến thức trọng tâm',
    difficulty: sanitizeDifficulty(raw.difficulty),
    prompt: clampStr(raw.prompt, 2500) || `Câu mẫu ${idx + 1}`,
    explanation: clampStr(raw.explanation, 2500),
  };

  if (type === 'mcq') {
    const opts = Array.isArray(raw.options)
      ? raw.options.slice(0, 4).map((o) => clampStr(String(o || ''), 600))
      : [];
    while (opts.length < 4) {
      opts.push(`Phương án ${'ABCD'[opts.length]}`);
    }
    base.options = opts;
    base.correctOption =
      typeof raw.correctOption === 'number'
        ? Math.min(Math.max(Math.round(raw.correctOption), 0), 3)
        : 0;
  } else if (type === 'true_false') {
    const sts: TrueFalseStatement[] = Array.isArray(raw.statements)
      ? raw.statements.slice(0, 4).map((st, sIdx) => ({
          text: clampStr(st?.text, 600) || `Mệnh đề ${'abcd'[sIdx]}`,
          isTrue: Boolean(st?.isTrue),
        }))
      : [];
    while (sts.length < 4) {
      sts.push({ text: `Mệnh đề ${'abcd'[sts.length]}`, isTrue: false });
    }
    base.statements = sts;
  } else if (type === 'short_answer') {
    base.correctAnswer = clampStr(raw.correctAnswer, 40);
  } else {
    if (raw.correctAnswer && clampStr(raw.correctAnswer, 1200)) {
      base.correctAnswer = clampStr(raw.correctAnswer, 1200);
    }
  }

  return base;
}

export function examQuestionToReferenceItem(
  q: ExamQuestion,
  idx: number,
  defaultTopicTag: string
): ReferenceQuestionItem {
  return sanitizeReferenceItem(
    {
      id: q.id || `ref_q_${idx + 1}`,
      type: q.type,
      topicTag: defaultTopicTag || 'Câu mẫu chuẩn',
      difficulty: q.type === 'essay' ? 'van_dung' : 'thong_hieu',
      prompt: q.prompt,
      options: q.options,
      correctOption: q.correctOption,
      statements: q.statements,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
    },
    idx
  );
}

export function formatReferenceItemAnswerSummary(item: ReferenceQuestionItem): string {
  if (item.type === 'mcq') {
    const letter = ['A', 'B', 'C', 'D'][item.correctOption ?? 0] || 'A';
    const text = item.options?.[item.correctOption ?? 0] || '';
    return `Đáp án đúng: ${letter}. ${text}`;
  }
  if (item.type === 'true_false') {
    return (item.statements || [])
      .map((st, idx) => `${'abcd'[idx]}) ${st.isTrue ? 'Đúng' : 'Sai'} — ${st.text}`)
      .join(' | ');
  }
  if (item.type === 'short_answer') {
    return `Đáp số: ${item.correctAnswer || '(chưa có)'}`;
  }
  return item.correctAnswer || item.explanation || '(Tự luận chuẩn)';
}

export function subscribeTeacherReferenceMaterials(
  teacherId: string,
  onItems: (items: ReferenceMaterial[]) => void
): () => void {
  if (!teacherId) {
    onItems([]);
    return () => {};
  }

  return onSnapshot(
    query(collection(db, 'referenceMaterials'), where('teacherId', '==', teacherId)),
    (snap) => {
      const rows = snap.docs.map((d) => d.data() as ReferenceMaterial);
      rows.sort((a, b) => a.title.localeCompare(b.title, 'vi'));
      onItems(rows);
    },
    (err) => handleFirestoreError(err, OperationType.LIST, 'referenceMaterials')
  );
}

export async function fetchActiveReferenceMaterialsForTeacher(
  teacherId: string
): Promise<ReferenceMaterial[]> {
  if (!teacherId || teacherId === 'sample_teacher') return [];
  try {
    const snap = await getDocs(
      query(
        collection(db, 'referenceMaterials'),
        where('teacherId', '==', teacherId),
        where('isActiveForAi', '==', true)
      )
    );
    return snap.docs.map((d) => d.data() as ReferenceMaterial);
  } catch (err) {
    console.warn('Could not load active reference materials for AI:', err);
    return [];
  }
}

export interface CreateReferenceMaterialInput {
  teacherId: string;
  title: string;
  subject: string;
  topic?: string;
  grade?: string;
  sourceFileName?: string;
  knowledgeSummary?: string;
  items: Partial<ReferenceQuestionItem>[];
  isActiveForAi?: boolean;
}

export async function createReferenceMaterialsChunked(
  input: CreateReferenceMaterialInput
): Promise<ReferenceMaterial[]> {
  const sanitizedAll = (input.items || [])
    .filter((it) => Boolean(clampStr(it.prompt, 2500)))
    .map((it, idx) => sanitizeReferenceItem(it, idx));

  const chunks: ReferenceQuestionItem[][] = [];
  if (sanitizedAll.length === 0) {
    chunks.push([]);
  } else {
    for (let i = 0; i < sanitizedAll.length; i += MAX_ITEMS_PER_DOC) {
      chunks.push(sanitizedAll.slice(i, i + MAX_ITEMS_PER_DOC));
    }
  }

  const baseTitle = clampStr(input.title, 180) || 'Tài liệu chuẩn AI';
  const subject = clampStr(input.subject, 80) || 'Vật lí';
  const topic = clampStr(input.topic, 160);
  const grade = clampStr(input.grade, 40) || 'THPT';
  const sourceFileName = clampStr(input.sourceFileName, 200);
  const knowledgeSummary = clampStr(input.knowledgeSummary, 8000);
  const isActiveForAi = input.isActiveForAi ?? true;

  const created: ReferenceMaterial[] = [];

  for (let cIdx = 0; cIdx < chunks.length; cIdx++) {
    const id = makeMaterialId();
    const partTitle =
      chunks.length > 1 ? clampStr(`${baseTitle} (Phần ${cIdx + 1})`, 200) : baseTitle;
    const partItems = chunks[cIdx];
    const payload: ReferenceMaterial = {
      id,
      teacherId: input.teacherId,
      title: partTitle,
      subject,
      topic,
      grade,
      sourceFileName,
      knowledgeSummary: cIdx === 0 ? knowledgeSummary : '',
      items: partItems,
      itemCount: partItems.length,
      isActiveForAi,
    };

    try {
      await setDoc(doc(db, 'referenceMaterials', id), {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      created.push(payload);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `referenceMaterials/${id}`);
    }
  }

  return created;
}

export async function updateReferenceMaterial(
  materialId: string,
  updates: Partial<{
    title: string;
    subject: string;
    topic: string;
    grade: string;
    sourceFileName: string;
    knowledgeSummary: string;
    items: ReferenceQuestionItem[];
    isActiveForAi: boolean;
  }>
): Promise<void> {
  const cleanUpdates: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (updates.title !== undefined) {
    cleanUpdates.title = clampStr(updates.title, 200) || 'Tài liệu chuẩn AI';
  }
  if (updates.subject !== undefined) {
    cleanUpdates.subject = clampStr(updates.subject, 80) || 'Vật lí';
  }
  if (updates.topic !== undefined) {
    cleanUpdates.topic = clampStr(updates.topic, 160);
  }
  if (updates.grade !== undefined) {
    cleanUpdates.grade = clampStr(updates.grade, 40);
  }
  if (updates.sourceFileName !== undefined) {
    cleanUpdates.sourceFileName = clampStr(updates.sourceFileName, 200);
  }
  if (updates.knowledgeSummary !== undefined) {
    cleanUpdates.knowledgeSummary = clampStr(updates.knowledgeSummary, 8000);
  }
  if (updates.items !== undefined) {
    const cleanItems = updates.items
      .slice(0, 80)
      .map((it, idx) => sanitizeReferenceItem(it, idx));
    cleanUpdates.items = cleanItems;
    cleanUpdates.itemCount = cleanItems.length;
  }
  if (updates.isActiveForAi !== undefined) {
    cleanUpdates.isActiveForAi = Boolean(updates.isActiveForAi);
  }

  try {
    await updateDoc(doc(db, 'referenceMaterials', materialId), cleanUpdates);
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.UPDATE,
      `referenceMaterials/${materialId}`
    );
  }
}

export async function deleteReferenceMaterial(materialId: string): Promise<void> {
  try {
    await deleteDoc(doc(db, 'referenceMaterials', materialId));
  } catch (err) {
    handleFirestoreError(
      err,
      OperationType.DELETE,
      `referenceMaterials/${materialId}`
    );
  }
}

// ---------------- Retrieval for AI Grounding ----------------

export interface ReferenceContextPayload {
  matchedTitles: string[];
  knowledgeSnippets: string[];
  referenceItems: Array<{
    materialTitle: string;
    type: string;
    topicTag: string;
    difficulty: string;
    prompt: string;
    options?: string[];
    answerSummary: string;
    explanation: string;
  }>;
  totalActiveMaterials: number;
}

export function selectRelevantReferenceContext(params: {
  materials: ReferenceMaterial[];
  subject?: string;
  examTitle?: string;
  queryTexts: string[];
  maxItems?: number;
  maxKnowledgeChars?: number;
}): ReferenceContextPayload {
  const activeMaterials = params.materials.filter((m) => m.isActiveForAi);
  if (activeMaterials.length === 0) {
    return {
      matchedTitles: [],
      knowledgeSnippets: [],
      referenceItems: [],
      totalActiveMaterials: 0,
    };
  }

  const maxItems = params.maxItems ?? 8;
  const maxKnowledgeChars = params.maxKnowledgeChars ?? 3000;
  const normSubject = normalizeVietnameseText(params.subject || '');
  const queryTokens = tokenizeVietnamese(
    [params.examTitle || '', ...params.queryTexts].join(' ')
  );
  const queryTokenSet = new Set(queryTokens);

  const scoredMaterials = activeMaterials
    .map((mat) => {
      let score = 0;
      const matSub = normalizeVietnameseText(mat.subject);
      if (normSubject && matSub) {
        if (matSub === normSubject || matSub.includes(normSubject) || normSubject.includes(matSub)) {
          score += 20;
        }
      }
      const matHeaderTokens = tokenizeVietnamese(
        `${mat.title} ${mat.topic} ${mat.knowledgeSummary.slice(0, 600)}`
      );
      matHeaderTokens.forEach((tok) => {
        if (queryTokenSet.has(tok)) score += 3;
      });
      return { mat, score };
    })
    .sort((a, b) => b.score - a.score);

  // If subject exists and some materials match subject strongly, prefer those
  const subjectMatched = scoredMaterials.filter((s) => s.score >= 20);
  const candidateMaterials =
    subjectMatched.length > 0 ? subjectMatched : scoredMaterials;

  // Collect knowledge snippets from top matching materials
  const knowledgeSnippets: string[] = [];
  const matchedTitleSet = new Set<string>();
  let usedChars = 0;

  for (const { mat } of candidateMaterials.slice(0, 4)) {
    const ks = (mat.knowledgeSummary || '').trim();
    if (!ks) continue;
    if (usedChars + ks.length > maxKnowledgeChars && knowledgeSnippets.length > 0) {
      continue;
    }
    const snippet = ks.slice(0, Math.max(400, maxKnowledgeChars - usedChars));
    knowledgeSnippets.push(`[${mat.title} - ${mat.topic || mat.subject}]\n${snippet}`);
    matchedTitleSet.add(mat.title);
    usedChars += snippet.length;
  }

  // Score individual reference items across candidate materials
  const scoredItems: Array<{
    materialTitle: string;
    item: ReferenceQuestionItem;
    score: number;
    idx: number;
  }> = [];

  candidateMaterials.forEach(({ mat, score: matScore }) => {
    (mat.items || []).forEach((item, idx) => {
      let itemScore = matScore;
      const itemTokens = tokenizeVietnamese(
        `${item.topicTag} ${item.prompt} ${item.explanation}`
      );
      let overlap = 0;
      itemTokens.forEach((tok) => {
        if (queryTokenSet.has(tok)) overlap++;
      });
      itemScore += overlap * 5;
      if (item.explanation && item.explanation.trim().length >= 15) {
        itemScore += 2;
      }
      scoredItems.push({
        materialTitle: mat.title,
        item,
        score: itemScore,
        idx,
      });
    });
  });

  scoredItems.sort((a, b) => b.score - a.score || a.idx - b.idx);

  const selectedRaw = scoredItems.slice(0, maxItems);
  selectedRaw.forEach((s) => matchedTitleSet.add(s.materialTitle));

  return {
    matchedTitles: Array.from(matchedTitleSet),
    knowledgeSnippets,
    referenceItems: selectedRaw.map(({ materialTitle, item }) => ({
      materialTitle,
      type: item.type,
      topicTag: item.topicTag,
      difficulty: item.difficulty,
      prompt: item.prompt.slice(0, 700),
      ...(item.options ? { options: item.options } : {}),
      answerSummary: formatReferenceItemAnswerSummary(item).slice(0, 500),
      explanation: item.explanation.slice(0, 700),
    })),
    totalActiveMaterials: activeMaterials.length,
  };
}
