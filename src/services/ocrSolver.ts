import { createWorker, Worker } from 'tesseract.js';
import { PNG } from 'pngjs';
import { cleanQuestionText, calculateTextSimilarity, cleanOptionText, normalizeText, AnswerItem } from './examSolver.js';

export interface OcrMatchResult {
  questionMatched: string;
  detectedQuestionText: string;
  targetAnswer: string;
  matchedOptionIndex: number; // 0 for A, 1 for B, 2 for C, 3 for D
  matchedOptionText: string;
  targetCoord: { x: number; y: number };
  confidence: number;
}

export class OcrSolver {
  private worker: Worker | null = null;
  private isInitializing: boolean = false;

  public async getWorker(): Promise<Worker> {
    if (this.worker) return this.worker;
    if (!this.isInitializing) {
      this.isInitializing = true;
      this.worker = await createWorker('vie');
      this.isInitializing = false;
    } else {
      while (this.isInitializing) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    return this.worker!;
  }

  /**
   * Cắt một vùng ảnh từ PNG buffer và tăng độ tương phản để OCR đọc chính xác nhất
   */
  public cropPng(
    png: PNG,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    binarize: boolean = true
  ): Buffer {
    const x1 = Math.max(0, Math.min(png.width - 1, startX));
    const y1 = Math.max(0, Math.min(png.height - 1, startY));
    const x2 = Math.max(x1 + 1, Math.min(png.width, endX));
    const y2 = Math.max(y1 + 1, Math.min(png.height, endY));

    const w = x2 - x1;
    const h = y2 - y1;
    const cropped = new PNG({ width: w, height: h });

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const srcIdx = (png.width * (y1 + y) + (x1 + x)) << 2;
        const dstIdx = (w * y + x) << 2;

        const r = png.data[srcIdx];
        const g = png.data[srcIdx + 1];
        const b = png.data[srcIdx + 2];

        if (binarize) {
          // Binarization: Chữ tối màu thành đen (0), nền thành trắng (255)
          const isDark = r < 160 && g < 160 && b < 160;
          const val = isDark ? 0 : 255;
          cropped.data[dstIdx] = val;
          cropped.data[dstIdx + 1] = val;
          cropped.data[dstIdx + 2] = val;
          cropped.data[dstIdx + 3] = 255;
        } else {
          cropped.data[dstIdx] = r;
          cropped.data[dstIdx + 1] = g;
          cropped.data[dstIdx + 2] = b;
          cropped.data[dstIdx + 3] = 255;
        }
      }
    }

    return PNG.sync.write(cropped);
  }

  /**
   * Tự động nhận diện câu hỏi và 4 đáp án trên ảnh chụp màn hình bài thi
   */
  public async solveFromPng(
    png: PNG,
    circles: number[],
    answersBank: AnswerItem[]
  ): Promise<OcrMatchResult | null> {
    if (circles.length !== 4 || answersBank.length === 0) return null;

    const worker = await this.getWorker();

    // 1. Nhận diện nội dung câu hỏi (mở rộng từ y=160 để không bị mất dòng đầu)
    const questionTop = 160;
    const questionBottom = Math.max(questionTop + 60, circles[0] - 10);
    const questionBuffer = this.cropPng(png, 20, questionTop, 700, questionBottom, false);

    const qResult = await worker.recognize(questionBuffer);
    const rawQuestionText = (qResult.data.text || '').trim();
    const cleanScreenQuestion = cleanQuestionText(rawQuestionText);

    if (cleanScreenQuestion.length < 4) return null;

    // 2. So khớp với ngân hàng câu hỏi
    let bestQuestionScore = 0;
    let matchedBankItem: AnswerItem | null = null;

    for (const item of answersBank) {
      const cleanBank = cleanQuestionText(item.question);
      const score = calculateTextSimilarity(cleanScreenQuestion, cleanBank);
      if (score > bestQuestionScore) {
        bestQuestionScore = score;
        matchedBankItem = item;
      }
    }

    if (!matchedBankItem || bestQuestionScore < 0.40) {
      return null;
    }

    const targetAnswer = matchedBankItem.answer;
    const cleanTargetAnswer = normalizeText(targetAnswer);
    const targetNums: string[] = cleanTargetAnswer.match(/\d+/g) || [];

    // Tìm vị trí của đáp án trong danh sách options của answers.json (nếu có)
    let bankOptionIndex = -1;
    if (matchedBankItem.options && Array.isArray(matchedBankItem.options)) {
      bankOptionIndex = matchedBankItem.options.findIndex(
        (opt) => normalizeText(opt) === cleanTargetAnswer || cleanOptionText(opt) === cleanTargetAnswer
      );
    }

    // 3. Nhận diện các dòng phương án theo vị trí 4 nút tròn Y (mở rộng vùng crop)
    // TỐI ƯU SIÊU TỐC: Nếu có bankOptionIndex thì kiểm tra vị trí đó trước. Khi độ khớp >= 0.88 thì dừng ngay!
    const optionTexts: string[] = [];
    let bestOptionScore = -1;
    let bestOptionIndex = bankOptionIndex >= 0 ? bankOptionIndex : 0;

    const indicesToCheck: number[] = [];
    if (bankOptionIndex >= 0 && bankOptionIndex < 4) {
      indicesToCheck.push(bankOptionIndex);
      for (let i = 0; i < 4; i++) {
        if (i !== bankOptionIndex) indicesToCheck.push(i);
      }
    } else {
      indicesToCheck.push(0, 1, 2, 3);
    }

    for (const i of indicesToCheck) {
      const centerY = circles[i];
      const optTop = Math.max(0, centerY - 28);
      // Mở rộng xuống tận nút tiếp theo để lấy trọn vẹn đáp án 2-3 dòng chữ
      const optBottom = i < 3 ? circles[i + 1] - 8 : Math.min(png.height - 110, centerY + 100);
      const optBuffer = this.cropPng(png, 85, optTop, 700, optBottom, false);

      const optResult = await worker.recognize(optBuffer);
      const rawOptText = (optResult.data.text || '').trim();
      optionTexts.push(rawOptText);

      const cleanOpt = cleanOptionText(rawOptText);
      const optNums: string[] = cleanOpt.match(/\d+/g) || [];

      // Kiểm tra tính khớp số nếu đáp án có chứa số (năm, ngày, số lượng...)
      let numbersMatch = true;
      if (targetNums.length > 0) {
        numbersMatch = targetNums.every((n) => optNums.includes(n));
      }

      let score = 0;
      if (numbersMatch) {
        score = calculateTextSimilarity(cleanOpt, cleanTargetAnswer);
        if (cleanOpt === cleanTargetAnswer) {
          score = 1.0;
        } else if (cleanOpt.includes(cleanTargetAnswer) || cleanTargetAnswer.includes(cleanOpt)) {
          score = Math.max(score, 0.95);
        }
      }

      if (score > bestOptionScore) {
        bestOptionScore = score;
        bestOptionIndex = i;
      }

      // Nếu đã khớp rất cao (>= 0.88), dừng ngay để tiết kiệm 75% thời gian OCR!
      if (score >= 0.88) {
        break;
      }
    }

    // Nếu không có option nào qua OCR đạt độ tin cậy cao và có vị trí chuẩn từ answers.json
    if (bestOptionScore < 0.4 && bankOptionIndex >= 0 && bankOptionIndex < 4) {
      bestOptionIndex = bankOptionIndex;
      bestOptionScore = 0.9;
    }

    return {
      questionMatched: matchedBankItem.question,
      detectedQuestionText: rawQuestionText,
      targetAnswer,
      matchedOptionIndex: bestOptionIndex,
      matchedOptionText: optionTexts[bestOptionIndex] || targetAnswer,
      targetCoord: {
        x: 200, // Tọa độ dòng đáp án chuẩn
        y: circles[bestOptionIndex],
      },
      confidence: (bestQuestionScore + (bestOptionScore > 0 ? bestOptionScore : 0.5)) / 2,
    };
  }

  public async terminate() {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}

export const ocrSolver = new OcrSolver();
