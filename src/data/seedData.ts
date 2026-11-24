import type { ExamQuestion, StudentAnswer } from '../types';

export const PHYSICS_12_QUESTIONS: ExamQuestion[] = [
  {
    id: 'q1',
    index: 1,
    type: 'mcq',
    prompt:
      'Trong ngành bảo quản và chế biến thực phẩm, dược liệu và các sản phẩm sinh học, công nghệ sấy đông khô đã định hình lại tiêu chuẩn nhờ khả năng bảo tồn hương vị, màu sắc và dưỡng chất. Quy trình gồm hai bước: (1) làm đông sản phẩm ở nhiệt độ rất thấp; (2) giảm áp suất để nước trong sản phẩm chuyển trực tiếp từ thể rắn sang thể hơi rồi được hút ra khỏi buồng sấy. Quá trình chuyển thể chủ yếu diễn ra ở bước (2) là',
    maxScore: 0.25,
    options: ['ngưng tụ.', 'ngưng kết.', 'đông đặc.', 'thăng hoa.'],
    correctOption: 3,
    explanation:
      'Ở bước (2) nước chuyển trực tiếp từ thể rắn sang thể hơi mà không qua thể lỏng — đó là sự thăng hoa.',
  },
  {
    id: 'q2',
    index: 2,
    type: 'mcq',
    prompt:
      'Theo mô hình động học phân tử về cấu tạo chất, các phân tử chất khí có đặc điểm chuyển động như thế nào?',
    maxScore: 0.25,
    options: [
      'Dao động quanh vị trí cân bằng cố định.',
      'Chuyển động hỗn loạn không ngừng về mọi phía.',
      'Đứng yên khi nhiệt độ phòng ổn định.',
      'Chỉ chuyển động theo phương thẳng đứng do trọng lực.',
    ],
    correctOption: 1,
    explanation:
      'Các phân tử chất khí ở cách xa nhau, lực tương tác rất yếu nên chuyển động hỗn loạn không ngừng.',
  },
  {
    id: 'q3',
    index: 3,
    type: 'mcq',
    prompt:
      'Trên thang nhiệt độ Kelvin, nhiệt độ của nước đá đang tan ở áp suất tiêu chuẩn 1 atm là bao nhiêu?',
    maxScore: 0.25,
    options: ['0 K.', '100 K.', '273,15 K.', '373,15 K.'],
    correctOption: 2,
    explanation:
      'Liên hệ thang Celsius và Kelvin: T(K) = t(°C) + 273,15. Ở 0 °C thì T = 273,15 K.',
  },
  {
    id: 'q4',
    index: 4,
    type: 'mcq',
    prompt:
      'Trong quá trình truyền nhiệt lượng Q cho một khối khí đựng trong xi-lanh có pit-tông di động, nếu khối khí thực hiện công A lên pit-tông thì độ biến thiên nội năng ΔU của khối khí là',
    maxScore: 0.25,
    options: ['ΔU = Q + A.', 'ΔU = Q − A.', 'ΔU = A − Q.', 'ΔU = −Q − A.'],
    correctOption: 1,
    explanation:
      'Theo định luật I nhiệt động lực học: ΔU = Q + A\' với A\' = −A (khí sinh công), do đó ΔU = Q − A.',
  },
  {
    id: 'q5',
    index: 5,
    type: 'mcq',
    prompt:
      'Nhiệt dung riêng của một chất là nhiệt lượng cần thiết để làm cho 1 kg chất đó tăng thêm',
    maxScore: 0.25,
    options: ['1 °C (hoặc 1 K).', '10 °C.', '100 °C.', '273 K.'],
    correctOption: 0,
    explanation:
      'Theo định nghĩa, nhiệt dung riêng c là nhiệt lượng cần cung cấp cho 1 kg chất tăng thêm 1 K (tương đương 1 °C).',
  },
  {
    id: 'q6',
    index: 6,
    type: 'mcq',
    prompt:
      'Một lượng khí lí tưởng xác định thực hiện quá trình đẳng nhiệt. Khi thể tích giảm đi một nửa thì áp suất của khối khí sẽ',
    maxScore: 0.25,
    options: ['giảm đi một nửa.', 'tăng lên gấp đôi.', 'không thay đổi.', 'tăng lên gấp bốn lần.'],
    correctOption: 1,
    explanation:
      'Theo định luật Boyle (pV = hằng số), khi V giảm 2 lần thì áp suất p tăng gấp 2 lần.',
  },
  {
    id: 'q7',
    index: 7,
    type: 'mcq',
    prompt:
      'Hệ thức nào sau đây biểu diễn đúng định luật Charles cho một lượng khí lí tưởng trong quá trình đẳng áp?',
    maxScore: 0.25,
    options: ['p·V = hằng số.', 'V / T = hằng số.', 'p / T = hằng số.', 'V·T = hằng số.'],
    correctOption: 1,
    explanation:
      'Trong quá trình đẳng áp, thể tích của một lượng khí xác định tỉ lệ thuận với nhiệt độ tuyệt đối: V/T = const.',
  },
  {
    id: 'q8',
    index: 8,
    type: 'mcq',
    prompt:
      'Động năng tịnh tiến trung bình của phân tử khí lí tưởng phụ thuộc trực tiếp vào đại lượng nào?',
    maxScore: 0.25,
    options: ['Khối lượng riêng của khí.', 'Thể tích bình chứa.', 'Nhiệt độ tuyệt đối T.', 'Hình dạng bình chứa.'],
    correctOption: 2,
    explanation:
      'Động năng trung bình E_đ = (3/2)kT chỉ phụ thuộc vào nhiệt độ tuyệt đối T của khối khí.',
  },
  {
    id: 'q9',
    index: 9,
    type: 'mcq',
    prompt:
      'Đường sức từ do dòng điện thẳng dài vô hạn gây ra trong không khí có dạng là',
    maxScore: 0.25,
    options: [
      'các đường thẳng song song với dây dẫn.',
      'các đường tròn đồng tâm nằm trong mặt phẳng vuông góc với dây dẫn.',
      'các đường xoắn ốc quanh dây dẫn.',
      'các đường parabol đối xứng.',
    ],
    correctOption: 1,
    explanation:
      'Đường sức từ của dòng điện thẳng dài là các đường tròn đồng tâm có tâm nằm trên dây dẫn và mặt phẳng vuông góc với dây.',
  },
  {
    id: 'q10',
    index: 10,
    type: 'mcq',
    prompt:
      'Đơn vị đo cảm ứng từ B trong hệ SI là',
    maxScore: 0.25,
    options: ['Weber (Wb).', 'Tesla (T).', 'Henry (H).', 'Volt (V).'],
    correctOption: 1,
    explanation: 'Trong hệ đo lường quốc tế SI, cảm ứng từ B có đơn vị là Tesla (T).',
  },
  {
    id: 'q11',
    index: 11,
    type: 'mcq',
    prompt:
      'Suất điện động cảm ứng xuất hiện trong một mạch kín tỉ lệ thuận với',
    maxScore: 0.25,
    options: [
      'độ lớn từ thông qua mạch.',
      'tốc độ biến thiên của từ thông qua mạch.',
      'điện trở toàn phần của mạch.',
      'diện tích khung dây.',
    ],
    correctOption: 1,
    explanation:
      'Theo định luật Faraday: e_c = −ΔΦ/Δt, độ lớn suất điện động cảm ứng tỉ lệ thuận với tốc độ biến thiên từ thông.',
  },
  {
    id: 'q12',
    index: 12,
    type: 'mcq',
    prompt:
      'Trong máy biến áp lí tưởng, nếu số vòng dây cuộn thứ cấp lớn hơn số vòng dây cuộn sơ cấp thì máy đó là',
    maxScore: 0.25,
    options: ['máy hạ áp.', 'máy tăng áp.', 'máy chỉnh lưu.', 'máy ổn áp một chiều.'],
    correctOption: 1,
    explanation:
      'Vì U₂/U₁ = N₂/N₁ nên khi N₂ > N₁ thì U₂ > U₁ — đây là máy tăng áp.',
  },
  {
    id: 'q13',
    index: 13,
    type: 'true_false',
    prompt:
      'Một học sinh thực hiện thí nghiệm đun nóng 0,5 kg nước từ 20 °C lên 80 °C bằng ấm điện có công suất tỏa nhiệt cho nước là 1000 W. Biết nhiệt dung riêng của nước là c = 4200 J/(kg·K). Xét tính đúng/sai của các phát biểu sau:',
    maxScore: 1.0,
    statements: [
      { text: 'Độ tăng nhiệt độ của nước là 60 K.', isTrue: true },
      { text: 'Nhiệt lượng nước thu vào để tăng từ 20 °C lên 80 °C là 126 kJ.', isTrue: true },
      { text: 'Thời gian đun nóng nước là 126 giây.', isTrue: true },
      { text: 'Nếu tăng khối lượng nước lên gấp đôi thì nhiệt dung riêng của nước tăng gấp đôi.', isTrue: false },
    ],
    explanation:
      'ΔT = 60 K; Q = m·c·ΔT = 0,5·4200·60 = 126 000 J = 126 kJ; t = Q/P = 126 s. Nhiệt dung riêng là hằng số đặc trưng của chất, không phụ thuộc khối lượng.',
  },
  {
    id: 'q14',
    index: 14,
    type: 'true_false',
    prompt:
      'Một xi-lanh kín chứa 2 mol khí lí tưởng ở trạng thái ban đầu có áp suất p₁ = 10⁵ Pa, thể tích V₁ = 49,86 lít và nhiệt độ T₁ = 300 K (lấy R = 8,31 J/(mol·K)). Xét các nhận định sau:',
    maxScore: 1.0,
    statements: [
      { text: 'Nếu nén đẳng nhiệt xuống thể tích V₂ = 24,93 lít thì áp suất mới là 2·10⁵ Pa.', isTrue: true },
      { text: 'Nếu đun nóng đẳng tích lên nhiệt độ 600 K thì áp suất tăng gấp đôi.', isTrue: true },
      { text: 'Nội năng của khí lí tưởng chỉ phụ thuộc vào thể tích bình chứa.', isTrue: false },
      { text: 'Ở nhiệt độ 300 K, động năng trung bình của mỗi phân tử nhỏ hơn khi ở 600 K.', isTrue: true },
    ],
    explanation:
      'Đẳng nhiệt p₁V₁ = p₂V₂ suy ra p₂ = 2·10⁵ Pa; đẳng tích p/T = const nên T tăng 2 lần thì p tăng 2 lần; nội năng khí lí tưởng chỉ phụ thuộc vào nhiệt độ.',
  },
  {
    id: 'q15',
    index: 15,
    type: 'true_false',
    prompt:
      'Một khung dây dẫn phẳng gồm 100 vòng, diện tích mỗi vòng S = 200 cm², đặt trong từ trường đều có cảm ứng từ B = 0,4 T sao cho mặt phẳng khung dây vuông góc với đường sức từ. Xét các phát biểu:',
    maxScore: 1.0,
    statements: [
      { text: 'Góc hợp bởi vectơ pháp tuyến của khung và vectơ cảm ứng từ là 0°.', isTrue: true },
      { text: 'Từ thông ban đầu qua khung dây bằng 0,8 Wb.', isTrue: true },
      { text: 'Nếu quay khung 90° sao cho mặt phẳng khung song song với B thì từ thông qua khung bằng 0.', isTrue: true },
      { text: 'Trong quá trình quay khung đều trong từ trường, suất điện động cảm ứng luôn bằng không.', isTrue: false },
    ],
    explanation:
      'Φ = N·B·S·cos(0°) = 100 · 0,4 · 0,02 · 1 = 0,8 Wb. Khi quay khung, từ thông biến thiên nên xuất hiện suất điện động cảm ứng.',
  },
  {
    id: 'q16',
    index: 16,
    type: 'true_false',
    prompt:
      'Một dây dẫn thẳng dài 0,5 m mang dòng điện cường độ I = 4 A đặt trong từ trường đều có cảm ứng từ B = 0,2 T. Xét các nhận định về lực từ tác dụng lên đoạn dây:',
    maxScore: 1.0,
    statements: [
      { text: 'Khi dây đặt vuông góc với đường sức từ, độ lớn lực từ đạt giá trị cực đại bằng 0,4 N.', isTrue: true },
      { text: 'Khi dây đặt song song với đường sức từ, lực từ tác dụng lên dây bằng 0 N.', isTrue: true },
      { text: 'Chiều của lực từ được xác định bằng quy tắc bàn tay trái.', isTrue: true },
      { text: 'Nếu đảo chiều dòng điện và giữ nguyên chiều B thì chiều lực từ không đổi.', isTrue: false },
    ],
    explanation:
      'F = B·I·l·sinα; với α = 90° thì F_max = 0,2·4·0,5 = 0,4 N. Đổi chiều dòng điện sẽ làm đảo chiều lực từ.',
  },
  {
    id: 'q17',
    index: 17,
    type: 'short_answer',
    prompt:
      'Cần bao nhiêu kilôjun (kJ) nhiệt lượng để làm nóng chảy hoàn toàn 2 kg nước đá ở 0 °C? Biết nhiệt nóng chảy riêng của nước đá là λ = 3,34·10⁵ J/kg. (Chỉ ghi giá trị số)',
    maxScore: 0.75,
    correctAnswer: '668',
    explanation: 'Q = λ·m = 3,34·10⁵ · 2 = 668 000 J = 668 kJ.',
  },
  {
    id: 'q18',
    index: 18,
    type: 'short_answer',
    prompt:
      'Một lượng khí ở nhiệt độ 27 °C có thể tích 6 lít. Đun nóng đẳng áp lượng khí đó đến nhiệt độ 127 °C thì thể tích mới bằng bao nhiêu lít?',
    maxScore: 0.75,
    correctAnswer: '8',
    explanation: 'T₁ = 300 K, T₂ = 400 K. Áp dụng V₂ = V₁·(T₂/T₁) = 6 · (400/300) = 8 lít.',
  },
  {
    id: 'q19',
    index: 19,
    type: 'short_answer',
    prompt:
      'Từ thông qua một mạch kín giảm đều từ 0,6 Wb xuống 0,1 Wb trong thời gian 0,2 s. Tính độ lớn suất điện động cảm ứng xuất hiện trong mạch (đơn vị V).',
    maxScore: 0.75,
    correctAnswer: '2.5',
    explanation: '|e_c| = |ΔΦ / Δt| = |0,1 − 0,6| / 0,2 = 0,5 / 0,2 = 2,5 V.',
  },
  {
    id: 'q20',
    index: 20,
    type: 'essay',
    prompt:
      'Giải thích ngắn gọn vì sao trong bình giữ nhiệt người ta thường hút chân không ở khoảng giữa hai lớp thành bình và tráng bạc mặt trong?',
    maxScore: 0.75,
    correctAnswer:
      'Hút chân không để ngăn sự dẫn nhiệt và đối lưu qua lớp khí; tráng bạc mặt trong để phản xạ bức xạ nhiệt, giảm tối đa sự thất thoát nhiệt.',
    explanation:
      'Có 3 hình thức truyền nhiệt: dẫn nhiệt, đối lưu (ngăn bởi lớp chân không) và bức xạ nhiệt (giảm nhờ lớp tráng bạc phản xạ).',
  },
];

function buildAnswersFromTarget(
  targetMcqCorrect: number,
  targetTfScores: number[],
  targetShortScores: number[],
  fastGuessIndices: number[] = [],
  shortTextOverrides: Record<string, string> = {}
): StudentAnswer[] {
  return PHYSICS_12_QUESTIONS.map((q, idx) => {
    const isFast = fastGuessIndices.includes(idx);
    const timeSpentSeconds = isFast ? (idx === 1 ? 3 : 4) : 18 + ((idx * 7) % 35);

    if (q.type === 'mcq') {
      const isRight = idx < targetMcqCorrect;
      const selectedOption = isRight ? q.correctOption! : (q.correctOption! + 1) % 4;
      return {
        questionId: q.id,
        type: 'mcq',
        selectedOption,
        timeSpentSeconds,
        score: isRight ? q.maxScore : 0,
        maxScore: q.maxScore,
        isCorrect: isRight,
      };
    }

    if (q.type === 'true_false') {
      const tfIdx = idx - 12;
      const sc = targetTfScores[tfIdx] ?? 0.5;
      const correctCount = sc === 1 ? 4 : sc === 0.5 ? 3 : sc === 0.25 ? 2 : 1;
      const statementAnswers = (q.statements || []).map((st, sIdx) =>
        sIdx < correctCount ? st.isTrue : !st.isTrue
      );
      return {
        questionId: q.id,
        type: 'true_false',
        statementAnswers,
        timeSpentSeconds: 42 + tfIdx * 9,
        score: sc,
        maxScore: q.maxScore,
        isCorrect: sc === q.maxScore,
      };
    }

    const saIdx = idx - 16;
    const sc = targetShortScores[saIdx] ?? 0;
    const defaultText =
      sc > 0
        ? q.id === 'q20'
          ? 'Lớp chân không ngăn dẫn nhiệt và đối lưu, lớp bạc phản xạ bức xạ nhiệt nên giữ ấm lâu.'
          : q.correctAnswer || ''
        : q.id === 'q20'
          ? 'Do thành bình dày nên giữ nhiệt được lâu.'
          : '0';
    return {
      questionId: q.id,
      type: q.type === 'essay' ? 'essay' : 'short_answer',
      textAnswer: shortTextOverrides[q.id] ?? defaultText,
      timeSpentSeconds: 38 + saIdx * 12,
      score: sc,
      maxScore: q.maxScore,
      isCorrect: sc === q.maxScore,
    };
  });
}

export interface SeedSubmissionTemplate {
  idSuffix: string;
  studentName: string;
  className: string;
  durationSeconds: number;
  violationCount: number;
  parentPhone: string;
  teacherComment: string;
  answers: StudentAnswer[];
}

export const SEED_SUBMISSIONS: SeedSubmissionTemplate[] = [
  {
    idSuffix: 'sub_tho',
    studentName: 'Bùi Công Đức Thọ',
    className: '12A1',
    durationSeconds: 24 * 60 + 57,
    violationCount: 0,
    parentPhone: '',
    teacherComment: '',
    // 10 MCQ right (2.5) + TF [1, 0.5, 0.5, 0.25] (2.25) + Short [0.75, 0.75, 0.5, 0] (2.0) = 6.75
    answers: buildAnswersFromTarget(10, [1, 0.5, 0.5, 0.25], [0.75, 0.75, 0.5, 0], [1, 7], {
      q19: '2,5 V',
      q20: 'Chân không giúp cách nhiệt và lớp bạc làm bình sáng hơn.',
    }),
  },
  {
    idSuffix: 'sub_thu',
    studentName: 'Ngô Thị Minh Thư',
    className: '12A1',
    durationSeconds: 23 * 60 + 35,
    violationCount: 0,
    parentPhone: '0908123456',
    teacherComment: 'Nắm chắc phần nhiệt học, cần chú ý đổi đơn vị phần từ trường.',
    // 11 MCQ right (2.75) + TF [1, 0.5, 0.5, 0.25] (2.25) + Short [0.75, 0.75, 0, 0.5] (2.0) = 7.0
    answers: buildAnswersFromTarget(11, [1, 0.5, 0.5, 0.25], [0.75, 0.75, 0, 0.5], []),
  },
  {
    idSuffix: 'sub_khoi',
    studentName: 'Phạm Nguyễn Bảo Khôi',
    className: '12A2',
    durationSeconds: 53 * 60 + 33,
    violationCount: 1,
    parentPhone: '0912345678',
    teacherComment: 'Cần ôn lại các quá trình đẳng áp và cách tính suất điện động cảm ứng.',
    // 8 MCQ right (2.0) + TF [0.5, 0.5, 0.5, 0.25] (1.75) + Short [0.75, 0, 0.75, 0] (1.5) = 5.25
    answers: buildAnswersFromTarget(8, [0.5, 0.5, 0.5, 0.25], [0.75, 0, 0.75, 0], [4]),
  },
  {
    idSuffix: 'sub_nam',
    studentName: 'Hoàng Bảo Nam',
    className: '12A2',
    durationSeconds: 27 * 60 + 44,
    violationCount: 0,
    parentPhone: '0987654321',
    teacherComment: '',
    // 9 MCQ right (2.25) + TF [1, 0.5, 0.25, 0.25] (2.0) + Short [0.75, 0.75, 0, 0.5] (2.0) = 6.25
    answers: buildAnswersFromTarget(9, [1, 0.5, 0.25, 0.25], [0.75, 0.75, 0, 0.5], []),
  },
  {
    idSuffix: 'sub_hung',
    studentName: 'Trần Tuấn Hùng',
    className: '12A5',
    durationSeconds: 32 * 60 + 21,
    violationCount: 0,
    parentPhone: '0933445566',
    teacherComment: 'Cần làm thêm bài tập tự luận phần nhiệt nóng chảy.',
    // 8 MCQ (2.0) + TF [0.5, 0.5, 0.25, 0.25] (1.5) + Short [0, 0.75, 0.75, 0] (1.5) = 5.0
    answers: buildAnswersFromTarget(8, [0.5, 0.5, 0.25, 0.25], [0, 0.75, 0.75, 0], [3, 6, 9]),
  },
  {
    idSuffix: 'sub_vy',
    studentName: 'Ửng Tuyết Vy',
    className: '12A1',
    durationSeconds: 36 * 60 + 26,
    violationCount: 0,
    parentPhone: '0977889900',
    teacherComment: 'Bài làm cẩn thận, trình bày ý tự luận rõ ràng.',
    // 10 MCQ (2.5) + TF [1, 0.5, 0.5, 0.5] (2.5) + Short [0.75, 0.75, 0, 0.5] (2.0) = 7.0
    answers: buildAnswersFromTarget(10, [1, 0.5, 0.5, 0.5], [0.75, 0.75, 0, 0.5], []),
  },
  {
    idSuffix: 'sub_phat',
    studentName: 'Chống Nhật Phát',
    className: '12A2',
    durationSeconds: 34 * 60 + 12,
    violationCount: 0,
    parentPhone: '0966554433',
    teacherComment: '',
    // 11 MCQ (2.75) + TF [0.5, 1, 0.5, 0.25] (2.25) + Short [0.75, 0, 0.75, 0.5] (2.0) = 7.0
    answers: buildAnswersFromTarget(11, [0.5, 1, 0.5, 0.25], [0.75, 0, 0.75, 0.5], []),
  },
  {
    idSuffix: 'sub_anh',
    studentName: 'Lê Minh Anh',
    className: '12A1',
    durationSeconds: 41 * 60 + 18,
    violationCount: 0,
    parentPhone: '0918223344',
    teacherComment: 'Rất tốt! Hiểu sâu bản chất vật lí các câu Đúng/Sai.',
    // 12 MCQ (3.0) + TF [1, 1, 0.5, 0.5] (3.0) + Short [0.75, 0.75, 0.5, 0.5] (2.5) = 8.5
    answers: buildAnswersFromTarget(12, [1, 1, 0.5, 0.5], [0.75, 0.75, 0.5, 0.5], []),
  },
];

export const SEED_CLASSES = [
  {
    idSuffix: 'cls_12a1',
    name: '12A1',
    subject: 'Vật lí 12',
    grade: 'Khối 12',
    academicYear: '2025–2026',
    joinCode: 'LY12A1',
    students: [
      { fullName: 'Bùi Công Đức Thọ', studentCode: 'HS1201', parentPhone: '', parentName: 'Phụ huynh em Thọ' },
      { fullName: 'Ngô Thị Minh Thư', studentCode: 'HS1202', parentPhone: '0908123456', parentName: 'Chị Hương' },
      { fullName: 'Ửng Tuyết Vy', studentCode: 'HS1203', parentPhone: '0977889900', parentName: 'Anh Minh' },
      { fullName: 'Lê Minh Anh', studentCode: 'HS1204', parentPhone: '0918223344', parentName: 'Chị Lan' },
    ],
  },
  {
    idSuffix: 'cls_12a2',
    name: '12A2',
    subject: 'Vật lí 12',
    grade: 'Khối 12',
    academicYear: '2025–2026',
    joinCode: 'LY12A2',
    students: [
      { fullName: 'Phạm Nguyễn Bảo Khôi', studentCode: 'HS1205', parentPhone: '0912345678', parentName: 'Anh Tuấn' },
      { fullName: 'Hoàng Bảo Nam', studentCode: 'HS1206', parentPhone: '0987654321', parentName: 'Chị Hà' },
      { fullName: 'Chống Nhật Phát', studentCode: 'HS1207', parentPhone: '0966554433', parentName: 'Anh Hải' },
    ],
  },
  {
    idSuffix: 'cls_12a5',
    name: '12A5',
    subject: 'Vật lí 12',
    grade: 'Khối 12',
    academicYear: '2025–2026',
    joinCode: 'LY12A5',
    students: [
      { fullName: 'Trần Tuấn Hùng', studentCode: 'HS1208', parentPhone: '0933445566', parentName: 'Anh Dũng' },
      { fullName: 'Nguyễn Thảo Vy', studentCode: 'HS1209', parentPhone: '0909887766', parentName: 'Chị Mai' },
    ],
  },
];
