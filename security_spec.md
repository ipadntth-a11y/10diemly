# Security Specification — Điểm 10

## 1. Data Invariants
1. A `UserProfile` at `/users/{userId}` can only be read, created, or updated by `request.auth.uid == userId` with a verified email, and cannot self-escalate privileges.
2. A `Classroom` at `/classes/{classId}` belongs strictly to `teacherId == request.auth.uid`. Non-owners cannot read, list, create, update, or delete another teacher's class.
3. A `StudentRecord` at `/classes/{classId}/students/{studentId}` contains PII (`parentPhone`, `parentName`) and can only exist under an existing parent `Classroom` owned by `request.auth.uid` (verified via `get()` on create/update/delete and `resource.data.teacherId == request.auth.uid` on list).
4. An `Exam` at `/exams/{examId}` can only be created, updated, or deleted by its `teacherId == request.auth.uid`. Verified signed-in users may read/list an exam only if `resource.data.teacherId == request.auth.uid || resource.data.isPublished == true`.
5. A `Submission` at `/submissions/{submissionId}` must reference an existing `Exam` (`exists(/databases/.../exams/$(incoming().examId))`). Only the submitting student (`studentUid == request.auth.uid`) or the exam's teacher (`teacherId == request.auth.uid`) can read it. On `create`, `studentUid` must equal `request.auth.uid`, and `teacherId` must match the referenced exam's `teacherId`. Only the owning `teacherId` can update `totalScore`, `teacherComment`, `aiAnalysis`, `status`, or `answers` scores.
6. A `ParentMessage` at `/parentMessages/{messageId}` contains PII (`parentPhone`) and is strictly readable and writable only by its owning `teacherId == request.auth.uid`.
7. All document IDs match `^[a-zA-Z0-9_\-]+$` (<= 128 chars), all strings enforce explicit `.size()` bounds, all arrays enforce `.size() <= MAX`, and all `createdAt`/`updatedAt`/`submittedAt` timestamps equal `request.time` on creation/update.

## 2. The "Dirty Dozen" Payloads (All Must Return PERMISSION_DENIED)
1. **Unauthenticated read/write**: Unauthenticated client requests `get /classes/cls_1` or `create /exams/ex_1`.
2. **Unverified email write**: Signed-in user with `email_verified: false` tries to create `/classes/cls_1`.
3. **Teacher ID spoofing on class create**: User `uid_A` creates `/classes/cls_1` with `teacherId: "uid_B"`.
4. **Shadow/Ghost field injection on create**: User `uid_A` creates `/users/uid_A` with extra field `isAdmin: true`.
5. **Orphan student record**: User `uid_A` creates `/classes/nonexistent/students/stu_1` without an existing parent class owned by `uid_A`.
6. **Cross-teacher PII read on student roster**: User `uid_B` tries to `get` or `list` `/classes/cls_A/students`.
7. **Unpublished exam scraping**: User `uid_B` tries to `get` or `list` `/exams` where `isPublished == false` and `teacherId == "uid_A"`.
8. **Student self-grading attack**: Student `uid_B` updates `/submissions/sub_1` to change `totalScore: 10` or `status: "graded"` when `teacherId == "uid_A"`.
9. **Submission teacherId spoofing**: Student `uid_B` creates `/submissions/sub_1` with `examId: "ex_A"` (owned by `uid_A`) while setting `teacherId: "uid_B"` to gain teacher update rights.
10. **ID poisoning**: User `uid_A` attempts to create `/classes/invalid id with spaces and $$$` or a >128 char ID.
11. **Timestamp backdating**: User `uid_A` creates `/classes/cls_1` with a client-supplied past timestamp instead of `request.time`.
12. **Blanket list query scraping**: User `uid_B` runs an unfiltered `list` on `/submissions` or `/parentMessages` expecting client-side filtering.
