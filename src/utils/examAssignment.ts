import type { Classroom, Exam } from '../types';

function normalizeClassLabel(val: string | undefined | null): string {
  return (val ?? '')
    .trim()
    .toLowerCase()
    .replace(/^lớp\s+/i, '')
    .replace(/\s+/g, ' ');
}

export function isExamRestrictedToClasses(exam: Pick<Exam, 'assignedClassIds' | 'assignedClassNames'>): boolean {
  return (
    (Array.isArray(exam.assignedClassIds) && exam.assignedClassIds.length > 0) ||
    (Array.isArray(exam.assignedClassNames) && exam.assignedClassNames.length > 0)
  );
}

export function resolveAssignedClassLabels(
  exam: Pick<Exam, 'assignedClassIds' | 'assignedClassNames'>,
  classes: Classroom[] = []
): string[] {
  const ids = Array.isArray(exam.assignedClassIds) ? exam.assignedClassIds : [];
  const names = Array.isArray(exam.assignedClassNames) ? exam.assignedClassNames : [];
  if (ids.length === 0 && names.length === 0) return [];

  const classMap = new Map(classes.map((c) => [c.id, c.name]));
  const resolved = ids.map((id, idx) => classMap.get(id) || names[idx] || id).filter(Boolean);
  if (resolved.length > 0) {
    return Array.from(new Set(resolved));
  }
  return Array.from(new Set(names.filter(Boolean)));
}

export function isExamAssignedToClass(
  exam: Pick<Exam, 'assignedClassIds' | 'assignedClassNames'>,
  target: { classId?: string; className?: string }
): boolean {
  if (!isExamRestrictedToClasses(exam)) {
    return true;
  }

  const ids = Array.isArray(exam.assignedClassIds) ? exam.assignedClassIds : [];
  const names = Array.isArray(exam.assignedClassNames) ? exam.assignedClassNames : [];

  if (target.classId && ids.includes(target.classId)) {
    return true;
  }

  const targetKey = normalizeClassLabel(target.className);
  if (targetKey && names.some((n) => normalizeClassLabel(n) === targetKey)) {
    return true;
  }

  return false;
}
