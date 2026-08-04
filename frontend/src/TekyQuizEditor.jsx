import React, { useState } from 'react';
import { HiOutlineArrowUpTray, HiOutlineTrash, HiOutlineArrowDownTray } from 'react-icons/hi2';
import './TekyQuizEditor.css';
import { API, assetUrl, exportProject, uploadNewImage } from './api';
import {
  NEW_BLANK_TOKEN,
  blankMarkerRegex,
  blankPromptKey,
  countBlankMarkers,
  ensureBlankMarkers,
  normalizeBlankPrompt,
  normalizeBlankAnswers,
  splitBlankPrompt,
} from './fillBlankUtils';

function escapeEditorHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

function blankEditorHtml(value) {
  const parts = splitBlankPrompt(value);
  return parts.map((part, index) => {
    const holder = index < parts.length - 1
      ? `<span class="teky-inline-blank-chip" contenteditable="false" data-blank-marker="true">Ô trống ${index + 1}</span>`
      : '';
    return `${escapeEditorHtml(part)}${holder}`;
  }).join('');
}

function createBlankChip(index = 0) {
  const chip = document.createElement('span');
  chip.className = 'teky-inline-blank-chip';
  chip.contentEditable = 'false';
  chip.dataset.blankMarker = 'true';
  chip.textContent = `Ô trống ${index + 1}`;
  return chip;
}

function renumberBlankChips(root) {
  const chips = Array.from(root.querySelectorAll('[data-blank-marker="true"]'));
  chips.forEach((chip, index) => { chip.textContent = `Ô trống ${index + 1}`; });
  return chips;
}

function promoteTypedBlankMarkers(root) {
  const textNodes = [];
  const visit = (node) => {
    Array.from(node.childNodes).forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) textNodes.push(child);
      else if (child.nodeType === Node.ELEMENT_NODE && child.dataset?.blankMarker !== 'true') visit(child);
    });
  };
  visit(root);

  const inserted = [];
  textNodes.forEach(textNode => {
    const source = textNode.nodeValue || '';
    const matches = [...source.matchAll(blankMarkerRegex())];
    if (!matches.length) return;
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    matches.forEach(match => {
      fragment.append(document.createTextNode(source.slice(cursor, match.index)));
      const chip = createBlankChip();
      inserted.push(chip);
      fragment.append(chip);
      cursor = match.index + match[0].length;
    });
    fragment.append(document.createTextNode(source.slice(cursor)));
    textNode.replaceWith(fragment);
  });

  const chips = renumberBlankChips(root);
  return inserted.map(chip => chips.indexOf(chip)).filter(index => index >= 0);
}

function serializeBlankEditor(node) {
  const read = (current) => {
    if (current.nodeType === Node.TEXT_NODE) return current.nodeValue || '';
    if (current.nodeType !== Node.ELEMENT_NODE) return '';
    if (current.dataset?.blankMarker === 'true') return NEW_BLANK_TOKEN;
    if (current.tagName === 'BR') return '\n';
    const value = Array.from(current.childNodes).map(read).join('');
    return ['DIV', 'P'].includes(current.tagName) ? `${value}\n` : value;
  };
  return Array.from(node.childNodes).map(read).join('').replace(/\u00a0/g, ' ');
}

const BlankPromptEditor = React.forwardRef(function BlankPromptEditor(
  { value, onChange, onInsertBlanks },
  ref,
) {
  const editorRef = React.useRef(null);
  const valueAtFocus = React.useRef(value);
  const [editing, setEditing] = React.useState(false);
  const displayValue = editing ? valueAtFocus.current : normalizeBlankPrompt(value);

  React.useImperativeHandle(ref, () => ({
    insertBlankAtCaret() {
      const root = editorRef.current;
      if (!root) return;
      root.focus();
      const selection = window.getSelection();
      let range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      if (!range || !root.contains(range.commonAncestorContainer)) {
        range = document.createRange();
        range.selectNodeContents(root);
        range.collapse(false);
      }
      range.deleteContents();
      const chip = createBlankChip();
      const trailingSpace = document.createTextNode(' ');
      range.insertNode(trailingSpace);
      range.insertNode(chip);
      const chips = renumberBlankChips(root);
      const blankIndex = chips.indexOf(chip);
      range.setStartAfter(trailingSpace);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      onInsertBlanks(serializeBlankEditor(root), [blankIndex]);
    },
  }), [onInsertBlanks]);

  return (
    <div
      ref={editorRef}
      className="teky-blank-prompt-input"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-label="Nội dung câu hỏi điền vào chỗ trống"
      aria-multiline="true"
      data-placeholder={`Ví dụ: ${NEW_BLANK_TOKEN} + ${NEW_BLANK_TOKEN} = 12`}
      dangerouslySetInnerHTML={{ __html: blankEditorHtml(displayValue) }}
      onFocus={() => {
        valueAtFocus.current = value;
        setEditing(true);
      }}
      onInput={(event) => {
        const insertedIndexes = promoteTypedBlankMarkers(event.currentTarget);
        const questionText = serializeBlankEditor(event.currentTarget);
        if (insertedIndexes.length) {
          const chips = event.currentTarget.querySelectorAll('[data-blank-marker="true"]');
          const lastInserted = chips[insertedIndexes[insertedIndexes.length - 1]];
          if (lastInserted) {
            const range = document.createRange();
            const selection = window.getSelection();
            range.setStartAfter(lastInserted);
            range.collapse(true);
            selection?.removeAllRanges();
            selection?.addRange(range);
          }
          onInsertBlanks(questionText, insertedIndexes);
        } else {
          onChange(questionText);
        }
      }}
      onBlur={(event) => {
        const normalized = normalizeBlankPrompt(serializeBlankEditor(event.currentTarget));
        if (normalized !== normalizeBlankPrompt(value)) onChange(normalized);
        setEditing(false);
      }}
    />
  );
});

function UploadButton({ sessionId, onUploadComplete, label = '' }) {
  const [uploading, setUploading] = useState(false);
  return (
    <div className="teky-upload-control">
      <button
        type="button"
        className={label ? 'teky-upload-label-btn' : 'teky-upload-icon-btn'}
        disabled={uploading}
        aria-label={label || 'Tải tệp lên'}
        onClick={(e) => e.currentTarget.nextElementSibling.click()}
      >
        {uploading ? <span className="teky-upload-progress">...</span> : (label || <HiOutlineArrowUpTray />)}
      </button>
      <input
        type="file"
        style={{ display: 'none' }}
        accept="image/*"
        onChange={async (e) => {
          const file = e.target.files[0];
          if (!file) return;
          setUploading(true);
          try {
            const res = await uploadNewImage(sessionId, file);
            if (res && res.filename) onUploadComplete(res.filename);
          } catch (err) {
            alert("Upload failed: " + err.message);
          } finally {
            setUploading(false);
          }
        }}
      />
    </div>
  );
}

function DownloadButton({ sessionId, filename, quizTitle, questionIndex, exportSuffix, mediaCode = 'IMG' }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!filename) return;
    setDownloading(true);
    try {
      let downloadName = filename.split('/').pop() || 'download.jpg';
      
      if (quizTitle != null && questionIndex != null && exportSuffix) {
        const safeTitle = String(quizTitle).trim().replace(/[^a-zA-Z0-9 _-]/g, '_').substring(0, 50);
        const stt = questionIndex;
        const targetName = `${safeTitle}_${stt}_${mediaCode}-${exportSuffix}`;
        let ext = filename.split('.').pop() || 'jpg';
        if (ext.length > 5 || ext.includes('/')) ext = 'jpg';
        downloadName = `${targetName}.${ext}`;
      }

      const url = assetUrl(sessionId, filename);
      const res = await fetch(url);
      const blob = await res.blob();
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = downloadName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(objectUrl);
      document.body.removeChild(a);
    } catch (err) {
      alert("Download failed: " + err.message);
    } finally {
      setDownloading(false);
    }
  };

  if (!filename) return null;

  return (
    <div className="teky-upload-control">
      <button
        type="button"
        className="teky-upload-icon-btn"
        disabled={downloading}
        aria-label="Tải xuống"
        title="Tải ảnh về máy"
        onClick={handleDownload}
      >
        {downloading ? <span className="teky-upload-progress">...</span> : <HiOutlineArrowDownTray />}
      </button>
    </div>
  );
}

export default function TekyQuizEditor({
  quiz,
  activeSlide,
  onQuizChange,
  onSlideChange,
  onSelectSlide,
  sessionId,
  onSave,
  saving = false,
}) {
  const [activeTab, setActiveTab] = useState('details'); // 'details', 'questions', 'settings'

  const questions = quiz?.questions || [];
  const activeQIndex = questions.findIndex(q => q.id === activeSlide?.id);
  const visibleQuestions = questions.filter(q => !q.deleted);
  const targetLesson =
    quiz?.tekyQuiz?.targetLesson
    || quiz?.groups?.[0]?.title
    || quiz?.tekyQuiz?.subject
    || 'Bài học'

  return (
    <div className="teky-editor-container">
      {/* HEADER TABS */}
      <div className="teky-editor-header">
        <div className="teky-editor-title">
          <button className="teky-back-btn" onClick={() => window.location.reload()} title="Về trang chủ">←</button>
          <div className="teky-title-info">
            <h2>Create Lesson Quiz</h2>
            <span>▱ {targetLesson.toUpperCase()} · {visibleQuestions.length} questions · {visibleQuestions.reduce((sum, q) => sum + Number(q.points || 0), 0)} pts</span>
          </div>
        </div>
        <div className="teky-editor-actions">
          <button
            type="button"
            className="teky-btn-secondary"
            onClick={async () => {
              try {
                const { blob, filename } = await exportProject(sessionId);
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
                window.URL.revokeObjectURL(url);
              } catch (err) {
                alert(err.message);
              }
            }}
            title="Tải về file Excel cấu hình và thư mục Media (cập nhật mới nhất)"
            style={{ marginRight: '8px' }}
          >
            📦 Tải Source Project
          </button>
          <button
            type="button"
            className="teky-btn-primary"
            onClick={onSave}
            disabled={saving}
            title="Lưu toàn bộ nội dung, cấu hình, câu hỏi và media đã chỉnh sửa"
          >
            {saving ? 'Đang lưu...' : 'Save Quiz'}
          </button>
        </div>
      </div>

      <div className="teky-editor-tabs">
        <button
          className={activeTab === 'details' ? 'active' : ''}
          onClick={() => setActiveTab('details')}
        >
          Quiz Details
        </button>
        <button
          className={activeTab === 'questions' ? 'active' : ''}
          onClick={() => setActiveTab('questions')}
        >
          Questions ({visibleQuestions.length})
        </button>
        <button
          className={activeTab === 'settings' ? 'active' : ''}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
      </div>

      {/* CONTENT AREA */}
      <div className="teky-editor-body">
        {activeTab === 'details' && (
          <TekyQuizDetails quiz={quiz} onChange={onQuizChange} sessionId={sessionId} />
        )}

        {activeTab === 'settings' && (
          <TekyQuizSettings quiz={quiz} onChange={onQuizChange} />
        )}

        {activeTab === 'questions' && (
          <div className="teky-questions-layout">


            <div className="teky-questions-main">
              <div className="teky-questions-list-scroll">
                {visibleQuestions.map((q, idx) => (
                  <TekyQuestionForm
                    key={q.id}
                    question={q}
                    onChange={(updates) => {
                      const newQ = { ...q, ...updates };
                      onSlideChange(newQ);
                    }}
                    onDelete={() => {
                      if (!window.confirm("Bạn có chắc muốn xoá câu hỏi này?")) return;
                      onQuizChange((prev) => {
                        const nextQuestions = (prev.questions || []).map(
                          x => x.id === q.id ? { ...x, deleted: true } : x,
                        );
                        return {
                          ...prev,
                          questions: nextQuestions,
                          questionCount: nextQuestions.filter(x => !x.deleted).length,
                        };
                      });
                    }}
                    index={idx + 1}
                    sessionId={quiz.sessionId}
                    quizTitle={quiz.title}
                  />
                ))}
              </div>

              <button
                className="teky-add-question-btn"
                onClick={() => {
                  onQuizChange((prev) => {
                    const newQuestions = [...(prev.questions || []), {
                      id: `new_${crypto.randomUUID()}`,
                      type: 'MultipleChoice',
                      questionText: 'Câu hỏi mới',
                      isNew: true,
                      slideRole: 'question',
                      points: 1,
                      slideImages: [],
                      video: '',
                      audio: '',
                      explanation: '',
                      choices: [
                        { id: `choice_${crypto.randomUUID()}`, text: 'Đáp án 1', isCorrect: true },
                        { id: `choice_${crypto.randomUUID()}`, text: 'Đáp án 2', isCorrect: false }
                      ]
                    }];
                    return {
                      ...prev,
                      questions: newQuestions,
                      questionCount: newQuestions.filter(q => !q.deleted).length,
                    };
                  });
                }}
              >
                + Add New Question
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TekyQuizDetails({ quiz, onChange, sessionId }) {
  const meta = quiz?.tekyQuiz || {};
  const [coverLoadFailed, setCoverLoadFailed] = useState(false);
  const updateMeta = (patch) => onChange((prev) => {
    const tekyQuiz = { ...(prev.tekyQuiz || {}), ...patch };
    return {
      ...prev,
      title: patch.title !== undefined ? patch.title : prev.title,
      tekyQuiz,
      _dirtyMeta: true,
    };
  }, { burst: true });

  return (
    <div className="teky-details-stack">
      <section className="teky-details-card teky-details-primary">
        <div className="teky-field-group">
          <label>QUIZ TITLE</label>
          <input
            type="text"
            value={meta.title || quiz?.title || ''}
            onChange={e => updateMeta({ title: e.target.value })}
            placeholder="Tên bài kiểm tra"
          />
        </div>
        <div className="teky-field-group">
          <label>DESCRIPTION</label>
          <textarea
            rows={3}
            value={meta.description || ''}
            onChange={e => updateMeta({ description: e.target.value })}
            placeholder="Mô tả bài thi..."
          />
        </div>
        <div className="teky-field-group teky-cover-field">
          <label>COVER IMAGE</label>
          <div className="teky-cover-editor">
            <div className="teky-cover-preview">
              {meta.coverImage && !coverLoadFailed ? (
                <img
                  src={assetUrl(sessionId, meta.coverImage)}
                  alt="Quiz cover"
                  onError={() => setCoverLoadFailed(true)}
                  onLoad={() => setCoverLoadFailed(false)}
                />
              ) : (
                <span className="teky-cover-placeholder">Ảnh bìa</span>
              )}
            </div>
            <div>
              <p>Recommended size: 800×800px.</p>
              <UploadButton
                label="↥  Change Image"
                sessionId={sessionId}
                onUploadComplete={(filename) => {
                  setCoverLoadFailed(false);
                  updateMeta({ coverImage: filename });
                }}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="teky-details-card teky-context-card">
        <label className="teky-card-kicker">CONTEXT INFORMATION</label>
        <div className="teky-context-grid">
          <div className="teky-context-tile">
            <span className="teky-context-icon">◇</span>
            <div>
              <small>RELATED SUBJECT</small>
              <strong>{meta.subject || 'Chưa thiết lập học phần'}</strong>
            </div>
          </div>
          <div className="teky-context-tile">
            <span className="teky-context-icon orange">▱</span>
            <div>
              <small>TARGET LESSON</small>
              <strong>
                {meta.targetLesson || quiz?.groups?.[0]?.title || meta.title || 'Chưa thiết lập bài học'}
              </strong>
            </div>
          </div>
        </div>
        <div className="teky-flex-row teky-context-controls">
          <div className="teky-field-group flex-1">
            <label>TÊN HỌC PHẦN (Related Subject)</label>
            <input
              type="text"
              value={meta.subject || ''}
              placeholder="Tên học phần"
              onChange={e => updateMeta({ subject: e.target.value })}
            />
          </div>
          <div className="teky-field-group flex-1">
            <label>TÊN BÀI HỌC (Target Lesson)</label>
            <input
              type="text"
              value={meta.targetLesson || ''}
              placeholder="Tên bài học"
              onChange={e => updateMeta({ targetLesson: e.target.value })}
            />
          </div>
        </div>
        <div className="teky-flex-row teky-context-controls">
          <div className="teky-field-group flex-1">
            <label>DIFFICULTY</label>
            <select value={meta.difficultyLevel || 'medium'} onChange={e => updateMeta({ difficultyLevel: e.target.value })}>
              <option value="easy">🟢 Easy</option>
              <option value="medium">🟡 Medium</option>
              <option value="hard">🔴 Hard</option>
            </select>
          </div>
          <div className="teky-field-group flex-1">
            <label>DURATION (MIN)</label>
            <input type="number" min="0" value={Math.round(Number(meta.duration ?? 1800) / 60)} onChange={e => updateMeta({ duration: Number(e.target.value) * 60 })} />
          </div>
        </div>
        <details className="teky-advanced-meta">
          <summary>Thông tin nâng cao</summary>
          <div className="teky-field-group">
            <label>TAGS</label>
            <input type="text" value={Array.isArray(meta.tags) ? meta.tags.join(', ') : (meta.tags || '')} onChange={e => updateMeta({ tags: e.target.value.split(',').map(v => v.trim()).filter(Boolean) })} />
          </div>
        </details>
      </section>
    </div>
  );
}

function TekyQuizSettings({ quiz, onChange }) {
  const settings = quiz?.tekyQuiz?.settings || {};
  const updateSettings = (patch) => onChange((prev) => ({
    ...prev,
    tekyQuiz: {
      ...(prev.tekyQuiz || {}),
      settings: { ...(prev.tekyQuiz?.settings || {}), ...patch },
    },
    _dirtyMeta: true,
  }), { burst: true });

  return (
    <div className="teky-settings-card">
      <h3><span className="teky-settings-icon">◇</span> Cấu hình bài tập</h3>
      <div className="teky-setting-row">
        <div>
          <h4>Số lần làm bài tối đa</h4>
          <p>Giới hạn số lần học sinh được làm bài tập này (0 = Không giới hạn).</p>
        </div>
        <input type="number" min="0" value={settings.attemptLimit ?? 1} onChange={e => updateSettings({ attemptLimit: Number(e.target.value) })} />
      </div>
      <div className="teky-setting-row">
        <div>
          <h4>Trộn thứ tự câu hỏi</h4>
          <p>Câu hỏi sẽ hiển thị ngẫu nhiên đối với mỗi lượt làm bài.</p>
        </div>
        <input type="checkbox" checked={!!settings.shuffleQuestions} onChange={e => updateSettings({ shuffleQuestions: e.target.checked })} />
      </div>
      <div className="teky-setting-row">
        <div>
          <h4>Trộn thứ tự đáp án</h4>
          <p>Các phương án trắc nghiệm sẽ đảo thứ tự ngẫu nhiên.</p>
        </div>
        <input type="checkbox" checked={!!settings.shuffleAnswers} onChange={e => updateSettings({ shuffleAnswers: e.target.checked })} />
      </div>
      <div className="teky-setting-row">
        <div>
          <h4>Cho phép xem lại bài làm</h4>
          <p>Học sinh được xem lại câu trả lời và điểm số sau khi nộp bài.</p>
        </div>
        <input type="checkbox" checked={settings.allowReview ?? true} onChange={e => updateSettings({ allowReview: e.target.checked })} />
      </div>
      <div className="teky-setting-row">
        <div>
          <h4>Hiển thị kết quả</h4>
          <p>Quyết định khi nào học sinh được nhìn thấy đáp án đúng.</p>
        </div>
        <select value={settings.showResults || 'after_submit'} onChange={e => updateSettings({ showResults: e.target.value })}>
          <option value="after_submit">Ngay sau khi nộp</option>
          <option value="immediately">Ngay lập tức</option>
          <option value="never">Không hiển thị</option>
        </select>
      </div>
    </div>
  );
}

function TekyQuestionForm({ question, onChange, onDelete, index, sessionId, quizTitle }) {
  const [sidebarExpanded, setSidebarExpanded] = React.useState(false);
  const blankPromptEditorRef = React.useRef(null);

  React.useEffect(() => {
    if (['WordBank', 'FillInTheBlank'].includes(question.type)) {
      const primary = String(question.questionText || '').replace(/\s+/g, ' ').trim();
      const secondary = String(question.subtitleText || '').replace(/\s+/g, ' ').trim();
      let questionText = primary;
      if (!primary) {
        questionText = secondary;
      } else if (secondary && blankPromptKey(primary) !== blankPromptKey(secondary)) {
        questionText = `${primary}\n\n${secondary}`;
      }
      questionText = normalizeBlankPrompt(questionText);
      const blankAnswers = normalizeBlankAnswers({ ...question, questionText });
      const updates = {};
      if (questionText !== question.questionText) updates.questionText = questionText;
      if (question.subtitleText) updates.subtitleText = '';
      if (JSON.stringify(blankAnswers) !== JSON.stringify(question.blankAnswers || [])) {
        updates.blankAnswers = blankAnswers;
      }
      if (Object.keys(updates).length) onChange(updates);
    }
  }, [question.type, question.subtitleText, question.questionText, question.blankAnswers]);

  const typeOptions = [
    { value: 'MultipleChoice', label: 'Trắc nghiệm (Chọn 1)', icon: '◉' },
    { value: 'MultipleResponse', label: 'Trắc nghiệm (Chọn nhiều)', icon: '☑' },
    { value: 'TrueFalse', label: 'Đúng / Sai', icon: '✓' },
    { value: 'TypeIn', label: 'Trả lời ngắn', icon: '✎' },
    { value: 'Essay', label: 'Tự luận', icon: '📝', disabled: true },
    { value: 'FillInTheBlank', label: 'Điền vào chỗ trống', icon: '___' },
    { value: 'Hotspot', label: 'Hotspot', icon: '🎯' },
    { value: 'Numeric', label: 'Đáp án số', icon: '12' },
    { value: 'MultipleNumeric', label: 'Nhiều đáp án số', icon: '🔢' },
    { value: 'Matching', label: 'Ghép cặp', icon: '🔗' },
    { value: 'Sequence', label: 'question_type_ordering', icon: '↕' },
  ];

  const visualQuestionType = question.type === 'WordBank' ? 'FillInTheBlank' : question.type;
  const currentTypeOption = typeOptions.find(t => t.value === visualQuestionType);
  const currentTypeLabel = currentTypeOption?.label || question.type;
  const isDragBlank = ['FillInTheBlank', 'WordBank'].includes(question.type);
  const isSingleTextAnswer = question.type === 'TypeIn';
  const acceptedAnswers = question.typeInAnswers?.length ? question.typeInAnswers : [''];
  const blankAnswers = normalizeBlankAnswers(question);
  const distractors = question.blankDistractors || question.wordBankWords || [];
  const answerSectionLabel = {
    MultipleChoice: 'DANH SÁCH LỰA CHỌN (CHỌN 1 ĐÁP ÁN ĐÚNG)',
    MultipleResponse: 'DANH SÁCH LỰA CHỌN (CHỌN NHIỀU ĐÁP ÁN ĐÚNG)',
    TrueFalse: 'ĐÁP ÁN ĐÚNG (CHỌN ĐÚNG HOẶC SAI)',
    TypeIn: 'ĐÁP ÁN ĐÚNG CHẤP NHẬN',
    FillInTheBlank: 'THIẾT LẬP ĐÁP ÁN ĐÚNG CHO CÁC Ô TRỐNG',
    WordBank: 'THIẾT LẬP ĐÁP ÁN ĐÚNG CHO CÁC Ô TRỐNG',
    Numeric: 'ĐÁP ÁN SỐ ĐÚNG',
    MultipleNumeric: 'DANH SÁCH ĐÁP ÁN SỐ ĐÚNG',
    Matching: 'DANH SÁCH CÁC CẶP ĐÁP ÁN',
    Sequence: 'THỨ TỰ ĐÁP ÁN ĐÚNG',
    Hotspot: 'DANH SÁCH LỰA CHỌN (TỪ KHU VỰC HOTSPOT)',
  }[question.type] || 'DANH SÁCH ĐÁP ÁN';
  const addButtonLabel = {
    Matching: '+ THÊM CẶP MỚI',
    Sequence: '+ THÊM MỤC MỚI',
    MultipleNumeric: '+ THÊM Ô NHẬP MỚI',
    TypeIn: '+ THÊM TỪ ĐỒNG NGHĨA',
  }[question.type] || '+ THÊM LỰA CHỌN';

  const updateAcceptedAnswers = (answers) => {
    const nextAnswers = answers.length ? answers : [''];
    onChange({ typeInAnswers: nextAnswers });
  };

  const updateBlankAnswers = (nextBlanks) => {
    const normalized = nextBlanks.length ? nextBlanks : [{ id: 'qmFillInTheBlank0', values: [''] }];
    onChange({
      blankAnswers: normalized,
      questionText: ensureBlankMarkers(question.questionText, normalized.length),
    });
  };

  const updateDistractors = (nextDistractors) => onChange({
    wordBankWords: nextDistractors,
    blankDistractors: nextDistractors,
  });

  const insertBlankMappings = (questionText, insertedIndexes) => {
    const nextBlanks = blankAnswers.map(blank => ({ ...blank, values: [...(blank.values || [])] }));
    const existingIds = new Set(nextBlanks.map(blank => blank.id));
    let idSequence = nextBlanks.length;
    insertedIndexes.slice().sort((a, b) => a - b).forEach(blankIndex => {
      let blankId = `qmFillInTheBlank${idSequence}`;
      while (existingIds.has(blankId)) {
        idSequence += 1;
        blankId = `qmFillInTheBlank${idSequence}`;
      }
      existingIds.add(blankId);
      idSequence += 1;
      nextBlanks.splice(blankIndex, 0, {
        id: blankId,
        values: [''],
      });
    });
    onChange({ questionText, blankAnswers: nextBlanks });
  };

  const changeQuestionType = (nextType) => {
    const updates = { type: nextType };
    if (nextType === 'TypeIn') {
      const currentAnswer = question.typeInAnswers?.[0]
        || question.blankAnswers?.[0]?.values?.[0]
        || '';
      updates.typeInAnswers = [currentAnswer];
    } else if (nextType === 'FillInTheBlank') {
      const currentAnswer = question.blankAnswers?.[0]?.values?.[0]
        || question.typeInAnswers?.[0]
        || '';
      updates.blankAnswers = [{
        id: question.blankAnswers?.[0]?.id || 'qmFillInTheBlank0',
        values: [currentAnswer],
      }];
      updates.questionText = ensureBlankMarkers(question.questionText, 1);
      updates.wordBankWords = question.wordBankWords || [];
    }
    onChange(updates);
  };

  return (
    <div className="teky-question-card active">
      <div className="teky-q-header">
        <div className="teky-q-number">{index}</div>
        <div className="teky-q-title-preview">
          {index}. {currentTypeLabel}:{' '}
          {isDragBlank
            ? splitBlankPrompt(question.questionText).map((part, partIndex, parts) => (
              <React.Fragment key={partIndex}>
                {part}
                {partIndex < parts.length - 1 && (
                  <span className="teky-inline-blank-chip teky-inline-blank-chip-compact">
                    Ô trống {partIndex + 1}
                  </span>
                )}
              </React.Fragment>
            ))
            : (question.questionText || 'Câu hỏi mới...')}
        </div>
        <div className="teky-q-type-badge"><span className="icon">{currentTypeOption?.icon}</span> {currentTypeLabel}</div>
        <button className="teky-icon-btn" onClick={onDelete}>🗑</button>
        <button className="teky-icon-btn" style={{ color: '#ccc' }}>▲</button>
      </div>

      <div className="teky-q-body-flex">
        <div className={`teky-q-sidebar ${sidebarExpanded ? 'expanded' : 'collapsed'}`}>
          <div className="teky-sidebar-toggle-container">
            <button
              className="teky-sidebar-toggle-btn"
              onClick={() => setSidebarExpanded(!sidebarExpanded)}
              title={sidebarExpanded ? 'Thu gọn' : 'Mở rộng'}
            >
              {sidebarExpanded ? '◀' : '▶'}
            </button>
          </div>
          <div className="teky-sidebar-section">
            <span className="teky-sidebar-label">ĐỀ MỤC CHÍNH</span>
            <button className="teky-type-btn"><span className="icon">📂</span> <span className="teky-type-label">Đề mục / Phân đoạn</span></button>
          </div>
          <div className="teky-sidebar-section" style={{ marginTop: '24px' }}>
            <span className="teky-sidebar-label">LOẠI CÂU HỎI</span>
            {typeOptions.map(t => (
              <button
                key={t.value}
                className={`teky-type-btn ${visualQuestionType === t.value ? 'active' : ''} ${t.disabled ? 'disabled' : ''}`}
                disabled={t.disabled}
                title={t.disabled ? 'Dạng tự luận chưa có trong JSON Teky LMS chuẩn hiện tại' : ''}
                onClick={() => !t.disabled && changeQuestionType(t.value)}
              >
                <span className="icon">{t.icon}</span> <span className="teky-type-label">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="teky-q-content flex-1">
          <div className="teky-field-group">
            <div className="teky-field-label-row">
              <label>CÂU HỎI</label>
              {isDragBlank && (
                <button
                  type="button"
                  className="teky-insert-blank-btn"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => blankPromptEditorRef.current?.insertBlankAtCaret()}
                >
                  ● + Chèn ô trống
                </button>
              )}
            </div>
          {isDragBlank ? (
            <BlankPromptEditor
              ref={blankPromptEditorRef}
              value={question.questionText || ''}
              onInsertBlanks={insertBlankMappings}
              onChange={(questionText) => {
              const detected = countBlankMarkers(questionText);
              if (!detected) {
                onChange({ questionText });
                return;
              }
              const nextBlanks = blankAnswers.slice(0, detected);
              while (nextBlanks.length < detected) {
                nextBlanks.push({ id: `qmFillInTheBlank${nextBlanks.length}`, values: [''] });
              }
              onChange({ questionText, blankAnswers: nextBlanks });
              }}
            />
          ) : (
            <textarea
              rows={3}
              value={question.questionText || ''}
              onChange={e => onChange({ questionText: e.target.value })}
              placeholder="Nhập nội dung câu hỏi..."
            />
          )}
        </div>

        <div className="teky-flex-row">
          <div className="teky-field-group flex-1">
            <label>HÌNH ẢNH CÂU HỎI</label>
            <div className="teky-input-with-btn">
              <input
                type="text"
                placeholder="Dán URL hoặc tải ảnh..."
                value={question.slideImages?.[0] || ''}
                onChange={e => {
                  const newImages = question.slideImages ? [...question.slideImages] : [];
                  newImages[0] = e.target.value;
                  onChange({ slideImages: newImages });
                }}
              />
              <UploadButton
                sessionId={sessionId}
                onUploadComplete={(filename) => {
                  const newImages = question.slideImages ? [...question.slideImages] : [];
                  newImages[0] = filename;
                  onChange({ slideImages: newImages });
                }}
              />
              <DownloadButton sessionId={sessionId} filename={question.slideImages?.[0]} quizTitle={quizTitle} questionIndex={index} exportSuffix="ND" />
            </div>
            {question.slideImages?.[0] && (
              <div className="teky-choice-img-preview" style={{ marginTop: '12px' }}>
                <img src={assetUrl(sessionId, question.slideImages[0])} alt="" style={{ height: '120px' }} />
                <button
                  className="teky-img-del"
                  onClick={() => {
                    const newImages = [...question.slideImages];
                    newImages[0] = '';
                    onChange({ slideImages: newImages });
                  }}
                >✕</button>
              </div>
            )}
          </div>
          <div className="teky-field-group flex-1">
            <label>VIDEO CÂU HỎI</label>
            <input
              type="url"
              placeholder="URL YouTube / Vimeo..."
              value={question.video || ''}
              onChange={e => onChange({ video: e.target.value })}
            />
            <label style={{ marginTop: '14px' }}>AUDIO CÂU HỎI</label>
            <input
              type="url"
              placeholder="URL audio HTTPS..."
              value={question.audio || ''}
              onChange={e => onChange({ audio: e.target.value })}
            />
          </div>

        </div>

        <div className="teky-flex-row teky-metadata-row">
          <div className="teky-field-group">
            <label>ĐIỂM SỐ</label>
            <input type="number" value={question.points || 1} onChange={e => onChange({ points: e.target.value })} />
          </div>
          <div className="teky-field-group">
            <label>TRỪ ĐIỂM (SAI)</label>
            <input type="number" defaultValue="0" />
          </div>
          <div className="teky-field-group">
            <label>ĐỘ KHÓ</label>
            <select value={question.difficulty || 'medium'} onChange={e => onChange({ difficulty: e.target.value })}>
              <option value="easy">🟢 Dễ</option>
              <option value="medium">🟡 Trung bình</option>
              <option value="hard">🔴 Khó</option>
            </select>
          </div>
          <div className="teky-field-group">
            <label>CHỦ ĐỀ</label>
            <input type="text" value={question.topic || ''} onChange={e => onChange({ topic: e.target.value })} />
          </div>
          <div className="teky-field-group">
            <label>BẮT BUỘC</label>
            <button
              type="button"
              className={`teky-toggle ${question.required ? 'is-on' : ''}`}
              aria-label="Bắt buộc trả lời"
              aria-pressed={Boolean(question.required)}
              onClick={() => onChange({ required: !question.required })}
            >
              <span />
            </button>
          </div>
        </div>

        <div className="teky-answers-section">
          <div className="teky-answers-header">
            <label>{answerSectionLabel}</label>
            {(['MultipleChoice', 'MultipleResponse', 'Matching', 'Sequence', 'MultipleNumeric'].includes(question.type) || isSingleTextAnswer) && (
              <button
                className="teky-btn-add-answer"
                onClick={() => {
                  if (question.type === 'Matching') {
                    const newPairs = [...(question.matchingPairs || []), { leftText: '', rightText: '' }];
                    onChange({ matchingPairs: newPairs });
                  } else if (question.type === 'MultipleNumeric') {
                    onChange({ typeInAnswers: [...(question.typeInAnswers || []), ''] });
                  } else if (isSingleTextAnswer) {
                    updateAcceptedAnswers([...acceptedAnswers, '']);
                  } else {
                    const newChoices = [...(question.choices || []), { id: `c_${Date.now()}`, text: '', isCorrect: false }];
                    onChange({ choices: newChoices });
                  }
                }}
              >
                {addButtonLabel}
              </button>
            )}
          </div>

          <div className="teky-answers-grid">
            {question.type === 'Matching' && (
              <div className="teky-matching-editor">
                {question.matchingPairs?.map((c, i) => (
                  <div key={i} className="teky-matching-row">
                    <div className="teky-match-col">
                      <div className="teky-match-input-wrap">
                        <input type="text" value={c.leftText || c.text || ''} onChange={(e) => {
                          const newPairs = [...(question.matchingPairs || [])];
                          newPairs[i] = { ...newPairs[i], leftText: e.target.value };
                          onChange({ matchingPairs: newPairs });
                        }} placeholder="Vế trái..." />
                      </div>
                      <div className="teky-match-media-input">
                        <input type="text" placeholder="https://..." value={c.leftImage || c.image || ''} onChange={(e) => {
                          const newPairs = [...(question.matchingPairs || [])];
                          newPairs[i] = { ...newPairs[i], leftImage: e.target.value };
                          onChange({ matchingPairs: newPairs });
                        }} />
                        <UploadButton
                          sessionId={sessionId}
                          onUploadComplete={(filename) => {
                            const newPairs = [...(question.matchingPairs || [])];
                            newPairs[i] = { ...newPairs[i], leftImage: filename };
                            onChange({ matchingPairs: newPairs });
                          }}
                        />
                        <DownloadButton sessionId={sessionId} filename={c.leftImage || c.image} quizTitle={quizTitle} questionIndex={index} exportSuffix={`VT${i + 1}`} />
                      </div>
                      {(c.leftImage || c.image) && (
                        <div className="teky-match-img-preview">
                          <img src={assetUrl(sessionId, c.leftImage || c.image)} alt="" />
                          <button className="teky-img-del" onClick={() => {
                            const newPairs = [...question.matchingPairs];
                            newPairs[i] = { ...newPairs[i], leftImage: '' };
                            onChange({ matchingPairs: newPairs });
                          }}>✕</button>
                        </div>
                      )}
                    </div>
                    <span className="teky-match-arrow">→</span>
                    <div className="teky-match-col">
                      <div className="teky-match-input-wrap">
                        <input type="text" value={c.rightText || c.matchText || ''} onChange={(e) => {
                          const newPairs = [...(question.matchingPairs || [])];
                          newPairs[i] = { ...newPairs[i], rightText: e.target.value };
                          onChange({ matchingPairs: newPairs });
                        }} placeholder="Vế phải..." />
                      </div>
                      <div className="teky-match-media-input">
                        <input type="text" placeholder="https://..." value={c.rightImage || ''} onChange={(e) => {
                          const newPairs = [...(question.matchingPairs || [])];
                          newPairs[i] = { ...newPairs[i], rightImage: e.target.value };
                          onChange({ matchingPairs: newPairs });
                        }} />
                        <UploadButton
                          sessionId={sessionId}
                          onUploadComplete={(filename) => {
                            const newPairs = [...(question.matchingPairs || [])];
                            newPairs[i] = { ...newPairs[i], rightImage: filename };
                            onChange({ matchingPairs: newPairs });
                          }}
                        />
                        <DownloadButton sessionId={sessionId} filename={c.rightImage} quizTitle={quizTitle} questionIndex={index} exportSuffix={`VP${i + 1}`} />
                      </div>
                      {c.rightImage && (
                        <div className="teky-match-img-preview">
                          <img src={assetUrl(sessionId, c.rightImage)} alt="" />
                          <button className="teky-img-del" onClick={() => {
                            const newPairs = [...question.matchingPairs];
                            newPairs[i] = { ...newPairs[i], rightImage: '' };
                            onChange({ matchingPairs: newPairs });
                          }}>✕</button>
                        </div>
                      )}
                    </div>
                    <button
                      className="teky-icon-btn-small"
                      style={{ fontSize: '18px', color: '#ccc' }}
                      onClick={() => {
                        const newPairs = [...question.matchingPairs];
                        newPairs.splice(i, 1);
                        onChange({ matchingPairs: newPairs });
                      }}
                    >
                      🗑
                    </button>
                  </div>
                ))}
              </div>
            )}

            {(question.type === 'MultipleChoice' || question.type === 'MultipleResponse' || question.type === 'Hotspot') && (
               <div className="teky-choices-grid">
                 {question.choices?.map((c, i) => (
                  <div key={i} className={`teky-answer-card ${c.isCorrect ? 'correct' : ''}`}>
                    <div className="teky-choice-header">
                      <div className="teky-choice-toggle-wrap">
                        <input
                          type={question.type === 'MultipleChoice' ? 'radio' : 'checkbox'}
                          checked={c.isCorrect}
                          onChange={(e) => {
                            const newChoices = question.choices.map((choice, choiceIndex) => ({
                              ...choice,
                              isCorrect: question.type === 'MultipleChoice'
                                ? choiceIndex === i && e.target.checked
                                : (choiceIndex === i ? e.target.checked : choice.isCorrect),
                            }));
                            onChange({ choices: newChoices });
                          }}
                        />
                        <span className="teky-choice-letter">{String.fromCharCode(65 + i)}.</span>
                        <input className="teky-choice-text-input" type="text" value={c.text || ''} onChange={(e) => {
                          const newChoices = [...question.choices];
                          newChoices[i] = { ...newChoices[i], text: e.target.value };
                          onChange({ choices: newChoices });
                        }} placeholder="Nhập nội dung..." />
                      </div>
                      <button
                        className="teky-icon-btn-small"
                        onClick={() => {
                          const newChoices = [...question.choices];
                          newChoices.splice(i, 1);
                          onChange({ choices: newChoices });
                        }}
                      >
                        🗑
                      </button>
                    </div>

                    <div className="teky-choice-media-inputs">
                      <div className="teky-input-with-btn">
                        <input type="text" placeholder="URL ảnh..." value={c.image || ''} onChange={(e) => {
                          const newChoices = [...question.choices];
                          newChoices[i] = { ...newChoices[i], image: e.target.value };
                          onChange({ choices: newChoices });
                        }} />
                        <UploadButton sessionId={sessionId} onUploadComplete={(filename) => {
                          const newChoices = [...question.choices];
                          newChoices[i] = { ...newChoices[i], image: filename };
                          onChange({ choices: newChoices });
                        }} />
                        <DownloadButton sessionId={sessionId} filename={c.image} />
                      </div>
                      {c.image && (
                        <div className="teky-choice-img-preview">
                          <img src={assetUrl(sessionId, c.image)} alt="" />
                          <button className="teky-img-del" onClick={() => {
                            const newChoices = [...question.choices];
                            newChoices[i] = { ...newChoices[i], image: '' };
                            onChange({ choices: newChoices });
                          }}>✕</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
               </div>
            )}

            {question.type === 'TrueFalse' && (
              <div className="teky-tf-editor">
                 <div className={`teky-answer-item ${question.choices?.[0]?.isCorrect ? 'correct' : ''}`}>
                   <input type="radio" checked={question.choices?.[0]?.isCorrect} onChange={() => {
                     const newChoices = question.choices.map((choice, choiceIndex) => ({
                       ...choice,
                       isCorrect: choiceIndex === 0,
                     }));
                     onChange({ choices: newChoices });
                   }} />
                   <span className="tf-label">✅ Đúng (True)</span>
                 </div>
                 <div className={`teky-answer-item ${question.choices?.[1]?.isCorrect ? 'correct' : ''}`}>
                   <input type="radio" checked={question.choices?.[1]?.isCorrect} onChange={() => {
                     const newChoices = question.choices.map((choice, choiceIndex) => ({
                       ...choice,
                       isCorrect: choiceIndex === 1,
                     }));
                     onChange({ choices: newChoices });
                   }} />
                   <span className="tf-label">❌ Sai (False)</span>
                 </div>
              </div>
            )}

            {isDragBlank && (
              <div className="teky-drag-blank-editor">
                <p className="teky-single-text-hint">
                  Chèn từ khóa <strong>{NEW_BLANK_TOKEN}</strong> vào nội dung. Mỗi ô trống tương ứng với một nhóm đáp án đúng bên dưới.
                  <span className="teky-blank-detected-badge">Phát hiện {blankAnswers.length} ô trống</span>
                </p>
                <div className="teky-blank-answer-list">
                  {blankAnswers.map((blank, blankIndex) => (
                    <div className="teky-blank-answer-card" key={blank.id || blankIndex}>
                      <div className="teky-blank-card-title">
                        <span>{blankIndex + 1}</span>
                        Đáp án đúng cho ô trống thứ {blankIndex + 1}
                      </div>
                      {(blank.values?.length ? blank.values : ['']).map((value, valueIndex) => (
                        <div className="teky-accepted-answer-row" key={valueIndex}>
                          <input
                            type="text"
                            value={value}
                            placeholder={valueIndex === 0 ? 'Nhập thẻ đáp án đúng...' : 'Đáp án đúng thay thế...'}
                            onChange={(event) => {
                              const nextBlanks = blankAnswers.map(item => ({ ...item, values: [...(item.values || [])] }));
                              nextBlanks[blankIndex].values[valueIndex] = event.target.value;
                              updateBlankAnswers(nextBlanks);
                            }}
                          />
                          <button
                            type="button"
                            className="teky-remove-accepted-answer"
                            disabled={(blank.values?.length || 1) === 1}
                            onClick={() => {
                              const nextBlanks = blankAnswers.map(item => ({ ...item, values: [...(item.values || [])] }));
                              nextBlanks[blankIndex].values.splice(valueIndex, 1);
                              updateBlankAnswers(nextBlanks);
                            }}
                          >
                            <HiOutlineTrash />
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="teky-add-synonym-btn"
                        onClick={() => {
                          const nextBlanks = blankAnswers.map(item => ({ ...item, values: [...(item.values || [])] }));
                          nextBlanks[blankIndex].values.push('');
                          updateBlankAnswers(nextBlanks);
                        }}
                      >
                        + Thêm đáp án đúng thay thế
                      </button>
                    </div>
                  ))}
                </div>

                <div className="teky-distractor-section">
                  <div className="teky-distractor-header">
                    <div>
                      <strong>THẺ TỪ NHIỄU BỔ SUNG</strong>
                      <p>Đáp án sai hiển thị cùng các thẻ đúng để học sinh kéo thả.</p>
                    </div>
                    <button
                      type="button"
                      className="teky-btn-add-answer"
                      onClick={() => updateDistractors([...distractors, ''])}
                    >
                      + Thêm thẻ nhiễu
                    </button>
                  </div>
                  {distractors.map((value, distractorIndex) => (
                    <div className="teky-accepted-answer-row teky-distractor-row" key={distractorIndex}>
                      <span className="teky-distractor-index">{distractorIndex + 1}.</span>
                      <input
                        type="text"
                        value={value}
                        placeholder="Nhập thẻ đáp án sai..."
                        onChange={(event) => {
                          const next = [...distractors];
                          next[distractorIndex] = event.target.value;
                          updateDistractors(next);
                        }}
                      />
                      <button
                        type="button"
                        className="teky-remove-accepted-answer"
                        onClick={() => updateDistractors(distractors.filter((_, i) => i !== distractorIndex))}
                      >
                        <HiOutlineTrash />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {isSingleTextAnswer && (
              <div className="teky-single-text-editor">
                {question.type !== 'TypeIn' && (
                  <p className="teky-single-text-hint">
                    Dùng ký tự <strong>___</strong> trong nội dung câu hỏi để đánh dấu chỗ trống.
                  </p>
                )}
                <div className="teky-accepted-answer-list">
                  {acceptedAnswers.map((answer, answerIndex) => (
                    <div className="teky-accepted-answer-row" key={answerIndex}>
                      <input
                        type="text"
                        value={answer}
                        onChange={(e) => {
                          const nextAnswers = [...acceptedAnswers];
                          nextAnswers[answerIndex] = e.target.value;
                          updateAcceptedAnswers(nextAnswers);
                        }}
                        placeholder={answerIndex === 0 ? 'Nhập đáp án đúng...' : 'Nhập từ đồng nghĩa...'}
                      />
                      <button
                        type="button"
                        className="teky-remove-accepted-answer"
                        aria-label={`Xóa đáp án tương đồng ${answerIndex + 1}`}
                        disabled={acceptedAnswers.length === 1}
                        onClick={() => {
                          const nextAnswers = acceptedAnswers.filter((_, index) => index !== answerIndex);
                          updateAcceptedAnswers(nextAnswers);
                        }}
                      >
                        <HiOutlineTrash />
                      </button>
                    </div>
                  ))}
                </div>
                <label className="teky-regex-option">
                  <input
                    type="checkbox"
                    checked={Boolean(question.useRegex)}
                    onChange={(e) => onChange({ useRegex: e.target.checked })}
                  />
                  <span>Sử dụng RegEx để so khớp</span>
                </label>
              </div>
            )}

            {question.type === 'Numeric' && (
              <div className="teky-numeric-editor">
                <input type="number" value={question.typeInAnswers?.[0] || ''} onChange={(e) => {
                  const newAnswers = question.typeInAnswers?.length > 0 ? [...question.typeInAnswers] : [''];
                  newAnswers[0] = e.target.value;
                  onChange({ typeInAnswers: newAnswers });
                }} placeholder="Nhập kết quả số..." />
              </div>
            )}

            {question.type === 'MultipleNumeric' && (
              <div className="teky-multiple-numeric-editor">
                {(question.typeInAnswers?.length ? question.typeInAnswers : ['']).map((answer, i) => (
                  <div className="teky-multiple-numeric-item" key={i}>
                    <span>{i + 1}</span>
                    <input
                      type="number"
                      value={answer}
                      onChange={(e) => {
                        const newAnswers = question.typeInAnswers?.length ? [...question.typeInAnswers] : [''];
                        newAnswers[i] = e.target.value;
                        onChange({ typeInAnswers: newAnswers });
                      }}
                      placeholder={`Đáp án số ${i + 1}`}
                    />
                    <button
                      className="teky-icon-btn-small"
                      onClick={() => {
                        const newAnswers = [...(question.typeInAnswers || [])];
                        newAnswers.splice(i, 1);
                        onChange({ typeInAnswers: newAnswers.length ? newAnswers : [''] });
                      }}
                    >
                      🗑
                    </button>
                  </div>
                ))}
              </div>
            )}

            {question.type === 'Sequence' && (
              <div className="teky-sequence-editor">
                {question.choices?.map((c, i) => (
                  <div key={i} className="teky-answer-card sequence-card">
                    <div className="teky-choice-header">
                      <div className="teky-choice-toggle-wrap">
                        <span className="teky-seq-num">{i + 1}</span>
                        <input className="teky-choice-text-input" type="text" value={c.text || ''} onChange={(e) => {
                          const newChoices = [...question.choices];
                          newChoices[i] = { ...newChoices[i], text: e.target.value };
                          onChange({ choices: newChoices });
                        }} placeholder="Nội dung bước..." />
                      </div>
                      <button
                        className="teky-icon-btn-small"
                        onClick={() => {
                          const newChoices = [...question.choices];
                          newChoices.splice(i, 1);
                          onChange({ choices: newChoices });
                        }}
                      >
                        🗑
                      </button>
                    </div>

                    <div className="teky-choice-media-inputs">
                      <div className="teky-input-with-btn">
                        <input type="text" placeholder="URL ảnh..." value={c.image || ''} onChange={(e) => {
                          const newChoices = [...question.choices];
                          newChoices[i] = { ...newChoices[i], image: e.target.value };
                          onChange({ choices: newChoices });
                        }} />
                        <UploadButton sessionId={sessionId} onUploadComplete={(filename) => {
                          const newChoices = [...question.choices];
                          newChoices[i] = { ...newChoices[i], image: filename };
                          onChange({ choices: newChoices });
                        }} />
                        <DownloadButton sessionId={sessionId} filename={c.image} />
                      </div>
                      {c.image && (
                        <div className="teky-choice-img-preview">
                          <img src={assetUrl(sessionId, c.image)} alt="" />
                          <button className="teky-img-del" onClick={() => {
                            const newChoices = [...question.choices];
                            newChoices[i] = { ...newChoices[i], image: '' };
                            onChange({ choices: newChoices });
                          }}>✕</button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {(!['Matching', 'MultipleChoice', 'MultipleResponse', 'TrueFalse', 'TypeIn', 'Numeric', 'MultipleNumeric', 'Sequence', 'FillInTheBlank', 'WordBank', 'Hotspot'].includes(question.type)) && (
               <div className="teky-empty-answers">Chưa hỗ trợ hiển thị đáp án cho dạng này trong preview</div>
            )}
          </div>
        </div>

        <div className="teky-field-group mt-4">
          <label>GIẢI THÍCH ĐÁP ÁN (HIỂN THỊ SAU KHI NỘP BÀI)</label>
          <textarea
            rows={3}
            value={question.explanation || ''}
            onChange={e => onChange({ explanation: e.target.value })}
            placeholder="Giải thích lý do chọn đáp án này..."
          />
        </div>
        </div>
      </div>
    </div>
  );
}
