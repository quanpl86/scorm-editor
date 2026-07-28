import React, { useEffect, useMemo, useState } from 'react';
import {
  FaArrowLeft,
  FaCheck,
  FaEye,
  FaExclamationTriangle,
  FaGripLines,
  FaRegClock,
  FaTimes,
} from 'react-icons/fa';
import { assetUrl } from './api';
import './TekyQuizPreview.css';

function getEmbedUrl(url) {
  if (!url) return '';
  const ytMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})/);
  if (ytMatch?.[1]) return `https://www.youtube.com/embed/${ytMatch[1]}`;
  const vimeoMatch = url.match(/(?:vimeo\.com\/)(?:channels\/(?:\w+\/)?|groups\/(?:[^/]*)\/videos\/|album\/(?:\d+)\/video\/|)(\d+)(?:$|\/|\?)/);
  if (vimeoMatch?.[1]) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  return url;
}

function isFilled(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function isAnswered(question, answer) {
  if (question.type === 'MultipleResponse') return Array.isArray(answer) && answer.length > 0;
  if (question.type === 'Matching') {
    const count = question.matchingPairs?.length || 0;
    return count > 0 && Object.values(answer || {}).filter(isFilled).length === count;
  }
  if (question.type === 'MultipleNumeric') {
    const count = Math.max(question.typeInAnswers?.length || 0, 2);
    return Object.values(answer || {}).filter(isFilled).length === count;
  }
  if (question.type === 'Sequence') return Array.isArray(answer) && answer.length > 0;
  return isFilled(answer);
}

function QuestionMedia({ question, sessionId }) {
  return (
    <>
      {question.slideImages?.[0] && (
        <div className="teky-q-media">
          <img src={assetUrl(sessionId, question.slideImages[0])} alt="" />
        </div>
      )}
      {question.video && (
        <div className="teky-q-media teky-q-video">
          {/^https?:\/\//i.test(question.video) ? (
            <iframe
              src={getEmbedUrl(question.video)}
              title={`Video câu hỏi ${question.id}`}
              frameBorder="0"
              allowFullScreen
            />
          ) : (
            <video controls preload="metadata" src={assetUrl(sessionId, question.video)}>
              Trình duyệt không hỗ trợ video.
            </video>
          )}
        </div>
      )}
    </>
  );
}

function QuestionCard({
  question,
  index,
  answer,
  sessionId,
  onAnswer,
  dragged,
  setDragged,
}) {
  const updateObjectAnswer = (key, value) => {
    onAnswer({ ...(answer || {}), [key]: value });
  };

  const sequenceItems = Array.isArray(answer) && answer.length
    ? answer
    : (question.choices || []);

  const moveSequence = (sourceIndex, targetIndex) => {
    if (sourceIndex === targetIndex || targetIndex < 0 || targetIndex >= sequenceItems.length) return;
    const next = [...sequenceItems];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    onAnswer(next);
    setDragged(null);
  };

  const reorderSequence = (targetIndex) => {
    if (!dragged || dragged.questionId !== question.id) return;
    moveSequence(dragged.index, targetIndex);
  };

  return (
    <article className="teky-preview-card" id={`teky-question-${index + 1}`}>
      <div className="teky-q-meta">
        <span className="teky-badge-q">CÂU HỎI {index + 1}</span>
        <span className="teky-badge-pts">{question.points || 1} ĐIỂM</span>
      </div>

      <h3 className="teky-q-text">{question.questionText}</h3>
      <div className="teky-q-group">{(question.topic || question.groupTitle || 'QUIZ').toUpperCase()}</div>

      <QuestionMedia question={question} sessionId={sessionId} />

      <div className="teky-preview-answers">
        {['MultipleChoice', 'MultipleResponse'].includes(question.type) && (
          <div className="teky-choice-grid">
            {(question.choices || []).map((choice, choiceIndex) => {
              const selected = question.type === 'MultipleChoice'
                ? answer === choice.id
                : (answer || []).includes(choice.id);
              return (
                <button
                  type="button"
                  key={choice.id || choiceIndex}
                  className={`teky-choice-btn ${choice.image ? 'has-image' : ''} ${selected ? 'selected' : ''}`}
                  onClick={() => {
                    if (question.type === 'MultipleChoice') {
                      onAnswer(choice.id);
                      return;
                    }
                    const current = answer || [];
                    onAnswer(current.includes(choice.id)
                      ? current.filter((id) => id !== choice.id)
                      : [...current, choice.id]);
                  }}
                >
                  {choice.image && (
                    <span className="teky-choice-image">
                      <img src={assetUrl(sessionId, choice.image)} alt="" />
                    </span>
                  )}
                  <span className="teky-choice-line">
                    <span className={`teky-${question.type === 'MultipleResponse' ? 'checkbox' : 'radio'}-indicator ${selected ? 'active' : ''}`}>
                      {selected && question.type === 'MultipleResponse' && <FaCheck aria-hidden />}
                      {selected && question.type === 'MultipleChoice' && <span className="inner-dot" />}
                    </span>
                    <span className="teky-choice-label">{String.fromCharCode(65 + choiceIndex)}.</span>
                    <span className="teky-choice-text">{choice.text}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {question.type === 'Matching' && (
          <div className="teky-matching-view">
            <p className="teky-answer-hint">Match each item on the left with its pair on the right</p>
            {(question.matchingPairs || []).map((pair, pairIndex) => (
              <div key={`${question.id}-${pairIndex}`} className="teky-matching-row-view">
                <div className="teky-match-box">
                  {(pair.leftImage || pair.image) && (
                    <img
                      src={assetUrl(sessionId, pair.leftImage || pair.image)}
                      alt=""
                      className="teky-match-box-img"
                    />
                  )}
                  <span>{pair.leftText || pair.text}</span>
                </div>
                <span className="teky-match-arrow" aria-hidden>→</span>
                <select
                  className="teky-match-select"
                  aria-label={`Ghép cặp ${pairIndex + 1}`}
                  value={answer?.[pairIndex] || ''}
                  onChange={(event) => updateObjectAnswer(pairIndex, event.target.value)}
                >
                  <option value="">Select match...</option>
                  {(question.matchingPairs || []).map((option, optionIndex) => (
                    <option key={optionIndex} value={option.rightText || option.matchText || ''}>
                      {option.rightText || option.matchText}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}

        {question.type === 'Sequence' && (
          <div className="teky-sequence-view">
            <p className="teky-answer-hint">Kéo thả để sắp xếp theo thứ tự đúng.</p>
            <div className="teky-sequence-list">
              {sequenceItems.map((item, itemIndex) => (
                <div
                  key={item.id || itemIndex}
                  className="teky-sequence-item"
                  draggable
                  tabIndex={0}
                  aria-label={`Mục sắp xếp ${itemIndex + 1}: ${item.text}`}
                  onDragStart={() => setDragged({ questionId: question.id, index: itemIndex })}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => reorderSequence(itemIndex)}
                  onKeyDown={(event) => {
                    if (event.key === 'ArrowUp') {
                      event.preventDefault();
                      moveSequence(itemIndex, itemIndex - 1);
                    }
                    if (event.key === 'ArrowDown') {
                      event.preventDefault();
                      moveSequence(itemIndex, itemIndex + 1);
                    }
                  }}
                >
                  <FaGripLines className="teky-drag-handle" aria-hidden />
                  <span className="teky-seq-num">{itemIndex + 1}</span>
                  {item.image && <img src={assetUrl(sessionId, item.image)} alt="" className="teky-seq-img" />}
                  <span className="teky-seq-text">{item.text}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {question.type === 'TrueFalse' && (
          <div className="teky-choice-grid teky-true-false-grid">
            <button
              type="button"
              className={`teky-tf-btn ${answer === 'True' ? 'selected true' : ''}`}
              onClick={() => onAnswer('True')}
            >
              <FaCheck className="tf-icon green" aria-hidden /> Đúng
            </button>
            <button
              type="button"
              className={`teky-tf-btn ${answer === 'False' ? 'selected false' : ''}`}
              onClick={() => onAnswer('False')}
            >
              <FaTimes className="tf-icon red" aria-hidden /> Sai
            </button>
          </div>
        )}

        {['TypeIn', 'FillInTheBlank', 'WordBank'].includes(question.type) && (
          <div className="teky-input-view">
            <input
              type="text"
              aria-label={`Câu trả lời ${index + 1}`}
              placeholder="Type your answer here..."
              value={answer || ''}
              onChange={(event) => onAnswer(event.target.value)}
            />
          </div>
        )}

        {question.type === 'Numeric' && (
          <div className="teky-input-view teky-number-view">
            <input
              type="number"
              aria-label={`Đáp án số ${index + 1}`}
              placeholder="Enter number..."
              value={answer || ''}
              onChange={(event) => onAnswer(event.target.value)}
            />
          </div>
        )}

        {question.type === 'MultipleNumeric' && (
          <div className="teky-multiple-number-view">
            {Array.from({ length: Math.max(question.typeInAnswers?.length || 0, 2) }).map((_, fieldIndex) => (
              <label key={fieldIndex}>
                <span>Ô {fieldIndex + 1}</span>
                <input
                  type="number"
                  placeholder="..."
                  value={answer?.[fieldIndex] || ''}
                  onChange={(event) => updateObjectAnswer(fieldIndex, event.target.value)}
                />
              </label>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

export default function TekyQuizPreview({ quiz, onBack }) {
  const questions = useMemo(
    () => (quiz?.questions || []).filter((question) => !question.deleted),
    [quiz?.questions],
  );
  const [answers, setAnswers] = useState({});
  const [dragged, setDragged] = useState(null);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [timeLeft, setTimeLeft] = useState(() => Number(quiz?.tekyQuiz?.duration || 30 * 60));

  useEffect(() => {
    const timer = setInterval(() => setTimeLeft((previous) => Math.max(0, previous - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  const answeredIndices = questions
    .map((question, index) => (isAnswered(question, answers[question.id]) ? index : -1))
    .filter((index) => index >= 0);
  const answeredCount = answeredIndices.length;
  const missingIndices = questions
    .map((question, index) => (!isAnswered(question, answers[question.id]) ? index : -1))
    .filter((index) => index >= 0);
  const missingCount = missingIndices.length;
  const total = questions.length;
  const progress = Math.round((answeredCount / (total || 1)) * 100);
  const quizMeta = quiz?.tekyQuiz || {};
  const description = quizMeta.description || '';

  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  };

  if (!questions.length) {
    return <div className="teky-preview-empty">Không có câu hỏi nào để hiển thị.</div>;
  }

  return (
    <div className="teky-preview-container">
      <div className="teky-preview-banner">
        <FaEye aria-hidden />
        <span>CHẾ ĐỘ XEM TRƯỚC — KẾT QUẢ LÀM BÀI SẼ KHÔNG ĐƯỢC LƯU</span>
      </div>

      <header className="teky-preview-header">
        <div className="teky-preview-header-inner">
          <button type="button" className="teky-preview-back" onClick={onBack} aria-label="Quay lại editor">
            <FaArrowLeft aria-hidden />
          </button>
          <div className="teky-preview-title">
            <h2>{quizMeta.title || quiz?.title || 'BÀI KIỂM TRA MẪU'}</h2>
            <span>{total} CÂU HỎI · {answeredCount}/{total} ĐÃ TRẢ LỜI</span>
            {description && <p>{description}</p>}
          </div>
          <div className="teky-preview-timer">
            <FaRegClock aria-hidden />
            <strong>{formatTime(timeLeft)}</strong>
            <span className="timer-bar"><span className="timer-fill" style={{ width: `${Math.max(8, (timeLeft / Math.max(Number(quizMeta.duration || 1800), 1)) * 100)}%` }} /></span>
          </div>
        </div>
      </header>

      <main className="teky-preview-main">
        {description && (
          <section className="teky-intro-card">
            <h3><span aria-hidden />GIỚI THIỆU THỬ THÁCH</h3>
            <p>{description}</p>
          </section>
        )}

        {questions.map((question, index) => (
          <QuestionCard
            key={question.id}
            question={question}
            index={index}
            answer={answers[question.id]}
            sessionId={quiz.sessionId}
            onAnswer={(value) => setAnswers((previous) => ({ ...previous, [question.id]: value }))}
            dragged={dragged}
            setDragged={setDragged}
          />
        ))}

        <footer className="teky-preview-footer">
          <button type="button" className="teky-footer-btn outline" disabled>
            <FaArrowLeft aria-hidden /> Quay lại
          </button>
          <span className="teky-page-dot">1</span>
          <button type="button" className="teky-footer-btn primary" onClick={() => setShowSubmitModal(true)}>
            <FaCheck aria-hidden /> Nộp bài
          </button>
        </footer>

        {missingCount > 0 && (
          <div className="teky-warning-bar">
            <FaExclamationTriangle aria-hidden /> Còn {missingCount} câu hỏi chưa trả lời
          </div>
        )}
      </main>

      {showSubmitModal && (
        <div className="teky-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="teky-submit-title">
          <div className="teky-modal-box">
            <button type="button" className="teky-modal-close" onClick={() => setShowSubmitModal(false)} aria-label="Đóng">
              <FaTimes aria-hidden />
            </button>
            <div className="teky-modal-icon"><FaCheck aria-hidden /></div>
            <h3 id="teky-submit-title">Xác nhận nộp bài</h3>
            <p>Bạn đã sẵn sàng nộp bài. Hành động này không thể hoàn tác.</p>

            <div className="teky-modal-stats">
              <div className="stat-box"><strong>{total}</strong><span>TỔNG CÂU</span></div>
              <div className="stat-box success"><strong>{answeredCount}</strong><span>ĐÃ TRẢ LỜI</span></div>
              <div className="stat-box warning"><strong>{missingCount}</strong><span>BỎ TRỐNG</span></div>
            </div>

            <div className="teky-modal-progress">
              <div className="progress-labels"><span>Tiến độ hoàn thành</span><span>{progress}%</span></div>
              <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
            </div>

            {missingCount > 0 && (
              <div className="teky-modal-missing">
                <h4><FaExclamationTriangle aria-hidden /> CÂU HỎI CHƯA CÓ ĐÁP ÁN</h4>
                <div className="missing-list">
                  {missingIndices.map((questionIndex) => (
                    <a
                      key={questions[questionIndex].id}
                      href={`#teky-question-${questionIndex + 1}`}
                      className="missing-tag"
                      onClick={() => setShowSubmitModal(false)}
                    >
                      Câu {questionIndex + 1}
                    </a>
                  ))}
                </div>
              </div>
            )}

            <div className="teky-modal-actions">
              <button type="button" className="teky-btn-outline" onClick={() => setShowSubmitModal(false)}>Tiếp tục làm bài</button>
              <button type="button" className="teky-btn-primary" onClick={onBack}><FaCheck aria-hidden /> Nộp bài</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
