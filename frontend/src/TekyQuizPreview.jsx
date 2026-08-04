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
import { buildDragCards, normalizeBlankAnswers, splitBlankPrompt } from './fillBlankUtils';
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
  if (['FillInTheBlank', 'WordBank'].includes(question.type)) {
    const count = normalizeBlankAnswers(question).length;
    return count > 0 && Object.values(answer || {}).filter(value => isFilled(value?.text || value)).length === count;
  }
  return isFilled(answer);
}

function FillBlankPrompt({ question, answer, onAnswer, dragged, setDragged }) {
  const blanks = normalizeBlankAnswers(question);
  const parts = splitBlankPrompt(question.questionText);
  const cards = buildDragCards(question);
  const assignments = answer || {};
  const usedCardIds = new Set(Object.values(assignments).map(value => value?.cardId).filter(Boolean));

  const placeCard = (blankIndex, card, fromBlankIndex = null) => {
    if (!card || (usedCardIds.has(card.id) && fromBlankIndex === null)) return;
    const next = { ...assignments };
    const displaced = next[blankIndex];
    if (fromBlankIndex !== null) delete next[fromBlankIndex];
    next[blankIndex] = { cardId: card.id, text: card.text };
    if (displaced && fromBlankIndex !== null && fromBlankIndex !== blankIndex) {
      next[fromBlankIndex] = displaced;
    }
    onAnswer(next);
    setDragged(null);
  };

  const placeFirstAvailable = (card) => {
    const blankIndex = blanks.findIndex((_, index) => !assignments[index]);
    if (blankIndex >= 0) placeCard(blankIndex, card);
  };

  return (
    <>
      <h3 className="teky-q-text teky-fill-blank-prompt">
        {parts.map((part, partIndex) => (
          <React.Fragment key={partIndex}>
            <span>{part}</span>
            {partIndex < blanks.length && (
              <button
                type="button"
                draggable={Boolean(assignments[partIndex])}
                className={`teky-blank-holder ${assignments[partIndex] ? 'filled' : ''}`}
                onDragStart={() => {
                  const assigned = assignments[partIndex];
                  if (assigned) {
                    setDragged({
                      kind: 'fill-blank',
                      questionId: question.id,
                      fromBlankIndex: partIndex,
                      card: { id: assigned.cardId, text: assigned.text },
                    });
                  }
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragged?.kind === 'fill-blank' && dragged.questionId === question.id) {
                    placeCard(partIndex, dragged.card, dragged.fromBlankIndex ?? null);
                  }
                }}
                onClick={() => {
                  if (!assignments[partIndex]) return;
                  const next = { ...assignments };
                  delete next[partIndex];
                  onAnswer(next);
                }}
                aria-label={assignments[partIndex]
                  ? `Ô trống ${partIndex + 1}: ${assignments[partIndex].text}. Bấm để trả thẻ.`
                  : `Ô trống ${partIndex + 1}`}
              >
                {assignments[partIndex]?.text || `Ô trống ${partIndex + 1}`}
              </button>
            )}
          </React.Fragment>
        ))}
      </h3>
      <p className="teky-drag-blank-hint">Kéo thẻ đáp án vào đúng ô trống hoặc bấm vào thẻ để điền lần lượt.</p>
      <div className="teky-drag-card-pool">
        {cards.map(card => {
          const used = usedCardIds.has(card.id);
          return (
            <button
              type="button"
              key={card.id}
              draggable={!used}
              disabled={used}
              className={`teky-drag-answer-card ${used ? 'used' : ''}`}
              onDragStart={() => setDragged({ kind: 'fill-blank', questionId: question.id, card })}
              onDragEnd={() => setDragged(null)}
              onClick={() => placeFirstAvailable(card)}
            >
              <FaGripLines aria-hidden /> {card.text}
            </button>
          );
        })}
      </div>
    </>
  );
}

function MatchSelect({ value, options, onChange, sessionId, ariaLabel }) {
  const [isOpen, setIsOpen] = useState(false);
  
  const selectedOption = options.find(o => (o.rightText || o.matchText || '') === value);
  const displayLabel = selectedOption ? (selectedOption.rightText || selectedOption.matchText) : 'Chọn đáp án ghép nối...';
  
  return (
    <div className="teky-match-custom-select" style={{ position: 'relative', flex: 1 }}>
      <button 
        type="button" 
        className="teky-match-select-btn" 
        onClick={() => setIsOpen(!isOpen)}
        aria-label={ariaLabel}
        style={{ 
          width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between', 
          alignItems: 'center', padding: '10px 16px', background: '#fff', border: '1px solid #d9d9d9', 
          borderRadius: '24px', fontSize: '14px', color: selectedOption ? '#333' : '#999',
          minHeight: '44px'
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
          {selectedOption?.rightImage && <img src={assetUrl(sessionId, selectedOption.rightImage)} alt="" style={{ height: '24px', borderRadius: '4px', objectFit: 'contain' }} />}
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{displayLabel}</span>
        </span>
        <span className="arrow" style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', fontSize: '12px' }}>▼</span>
      </button>

      {isOpen && (
        <div 
          className="teky-match-dropdown-menu" 
          style={{ 
            position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, zIndex: 100, 
            background: '#fff', border: '1px solid #eee', borderRadius: '12px', 
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)', maxHeight: '400px', overflowY: 'auto',
            padding: '8px'
          }}
        >
          <div 
            className="teky-match-option" 
            onClick={() => { onChange(''); setIsOpen(false); }} 
            style={{ padding: '8px 12px', cursor: 'pointer', color: '#666', fontSize: '13px', borderBottom: '1px dashed #eee', marginBottom: '8px' }}
          >
            -- Bỏ chọn --
          </div>
          {options.map((option, idx) => {
            const optVal = option.rightText || option.matchText || '';
            const isSelected = optVal === value;
            return (
              <div 
                key={idx} 
                className={`teky-match-option ${isSelected ? 'selected' : ''}`}
                onClick={() => { onChange(optVal); setIsOpen(false); }}
                style={{ 
                  padding: '12px', cursor: 'pointer', borderRadius: '8px',
                  backgroundColor: isSelected ? '#fff0e6' : '#fff',
                  border: isSelected ? '1px solid #ff7b00' : '1px solid #eee',
                  marginBottom: '8px', transition: 'all 0.2s'
                }}
              >
                <div style={{ fontSize: '11px', color: '#999', marginBottom: '8px', fontWeight: 'bold' }}>ĐÁP ÁN {idx + 1}</div>
                {option.rightImage && (
                  <div style={{ marginBottom: '8px', textAlign: 'center', background: '#f5f5f5', borderRadius: '6px', padding: '8px' }}>
                    <img src={assetUrl(sessionId, option.rightImage)} alt="" style={{ maxWidth: '100%', maxHeight: '140px', objectFit: 'contain' }} />
                  </div>
                )}
                <div style={{ fontSize: '14px', color: '#333', fontWeight: isSelected ? 'bold' : 'normal' }}>{optVal}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
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
      {question.audio && (
        <div className="teky-q-media teky-q-audio">
          <audio controls preload="metadata" src={question.audio}>
            Trình duyệt không hỗ trợ audio.
          </audio>
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

      {['FillInTheBlank', 'WordBank'].includes(question.type) ? (
        <FillBlankPrompt
          question={question}
          answer={answer}
          onAnswer={onAnswer}
          dragged={dragged}
          setDragged={setDragged}
        />
      ) : (
        <h3 className="teky-q-text">{question.questionText}</h3>
      )}
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
                <MatchSelect
                  ariaLabel={`Ghép cặp ${pairIndex + 1}`}
                  value={answer?.[pairIndex] || ''}
                  onChange={(val) => updateObjectAnswer(pairIndex, val)}
                  options={question.matchingPairs || []}
                  sessionId={sessionId}
                />
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

        {question.type === 'TypeIn' && (
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
