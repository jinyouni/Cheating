// Gemini 문제 해결사 애플리케이션 로직

// 전역 상태
let currentStream = null;
let currentFacingMode = 'environment'; // 기본: 후면 카메라
let isProcessing = false;

// DOM 요소 참조
const cameraVideo = document.getElementById('cameraVideo');
const videoWrapper = document.getElementById('videoWrapper');
const cameraResumeOverlay = document.getElementById('cameraResumeOverlay');
const captureCanvas = document.getElementById('captureCanvas');
const captureBtn = document.getElementById('captureBtn');
const switchCameraBtn = document.getElementById('switchCameraBtn');
const openSettingsBtn = document.getElementById('openSettingsBtn');
const closeSettingsBtn = document.getElementById('closeSettingsBtn');
const saveSettingsBtn = document.getElementById('saveSettingsBtn');
const nextProblemBtn = document.getElementById('nextProblemBtn');

const cameraSection = document.getElementById('cameraSection');
const resultSection = document.getElementById('resultSection');
const capturedImagePreview = document.getElementById('capturedImagePreview');
const loadingIndicator = document.getElementById('loadingIndicator');
const solutionBox = document.getElementById('solutionBox');
const solutionBody = document.getElementById('solutionBody');

const settingsModal = document.getElementById('settingsModal');
const apiKeyInput = document.getElementById('apiKeyInput');
const modelInput = document.getElementById('modelInput');
const toastEl = document.getElementById('toast');

// 로컬스토리지 키 이름
const STORAGE_API_KEY = 'gemini_problem_solver_api_key';
const STORAGE_MODEL = 'gemini_problem_solver_model';

// 기본 모델: 사용자가 덜 몰려 안정적이고 빠른 2.5-flash
const DEFAULT_MODEL = 'gemini-2.5-flash';

// ==========================================
// 1. 초기화 및 이벤트 리스너 등록
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // 저장된 설정 불러오기
  const savedApiKey = localStorage.getItem(STORAGE_API_KEY) || '';
  const savedModel = localStorage.getItem(STORAGE_MODEL) || DEFAULT_MODEL;

  apiKeyInput.value = savedApiKey;
  modelInput.value = savedModel;

  // 비디오 속성 사전 설정 (모바일 인라인 자동재생 필수 조건)
  cameraVideo.muted = true;
  cameraVideo.playsInline = true;
  cameraVideo.setAttribute('playsinline', '');
  cameraVideo.setAttribute('webkit-playsinline', '');
  cameraVideo.setAttribute('muted', '');

  // 카메라 시작
  startCamera(currentFacingMode);

  // 이벤트 바인딩
  captureBtn.addEventListener('click', onCaptureAndSolve);
  nextProblemBtn.addEventListener('click', onNextProblem);
  switchCameraBtn.addEventListener('click', toggleCamera);
  
  openSettingsBtn.addEventListener('click', showSettingsModal);
  closeSettingsBtn.addEventListener('click', hideSettingsModal);
  saveSettingsBtn.addEventListener('click', saveSettings);

  // 모바일 화면 터치 시 비디오 멈춤 해제
  videoWrapper.addEventListener('click', () => {
    if (cameraVideo.paused) {
      cameraVideo.play().then(() => {
        cameraResumeOverlay.classList.add('hidden');
      }).catch(err => console.warn('터치 재생 실패:', err));
    }
  });

  cameraResumeOverlay.addEventListener('click', () => {
    cameraVideo.play().then(() => {
      cameraResumeOverlay.classList.add('hidden');
    }).catch(err => console.warn('오버레이 터치 재생 실패:', err));
  });

  // 모바일 앱 전환/화면 복귀 시 비디오 자동 재개
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && cameraSection.classList.contains('active')) {
      if (cameraVideo.paused) {
        cameraVideo.play().catch(e => console.warn('복귀 후 자동 재생 차단:', e));
      }
    }
  });

  // 모달 바깥 배경 클릭 시 닫기
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) hideSettingsModal();
  });
});

// ==========================================
// 2. 카메라 제어 (실시간 동영상 프리뷰 최적화)
// ==========================================
async function startCamera(facingMode = 'environment') {
  // 이전 스트림 안전하게 종료
  if (currentStream) {
    currentStream.getTracks().forEach(track => {
      try { track.stop(); } catch(e) {}
    });
    currentStream = null;
  }

  // 모바일 프리징(멈춤)을 방지하기 위해 과도한 해상도 제한 없이 브라우저 표준 constraints 적용
  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: facingMode }
    }
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    currentStream = stream;
    cameraVideo.srcObject = stream;

    // 메타데이터 로드 완료 후 재생 시작 (모바일 브라우저 멈춤 방지 핵심)
    cameraVideo.onloadedmetadata = () => {
      cameraVideo.play().then(() => {
        cameraResumeOverlay.classList.add('hidden');
      }).catch(err => {
        console.warn('자동 재생 정책으로 일시정지됨. 터치 유도 표시:', err);
        cameraResumeOverlay.classList.remove('hidden');
      });
    };

    // 혹시 onloadedmetadata가 지연될 경우 대비 fallback
    setTimeout(() => {
      if (cameraVideo.paused) {
        cameraVideo.play().catch(() => {
          cameraResumeOverlay.classList.remove('hidden');
        });
      }
    }, 500);

  } catch (err) {
    console.error('카메라 시작 오류:', err);
    // 모바일 기본 카메라로 fallback 시도
    try {
      const basicStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      currentStream = basicStream;
      cameraVideo.srcObject = basicStream;
      cameraVideo.play().catch(() => {
        cameraResumeOverlay.classList.remove('hidden');
      });
    } catch (fallbackErr) {
      console.error('기본 카메라 접근도 실패:', fallbackErr);
      showToast('카메라 권한을 허용하고 브라우저를 새로고침해주세요.');
    }
  }
}

async function toggleCamera() {
  currentFacingMode = (currentFacingMode === 'environment') ? 'user' : 'environment';
  await startCamera(currentFacingMode);
  showToast(currentFacingMode === 'environment' ? '후면 카메라로 전환되었습니다.' : '전면 카메라로 전환되었습니다.');
}

// ==========================================
// 3. 캡처 & Gemini 전송
// ==========================================
async function onCaptureAndSolve() {
  if (isProcessing) return;

  const apiKey = localStorage.getItem(STORAGE_API_KEY);
  if (!apiKey) {
    showSettingsModal();
    showToast('Gemini API 키를 먼저 입력해주세요.');
    return;
  }

  const vWidth = cameraVideo.videoWidth;
  const vHeight = cameraVideo.videoHeight;

  if (!vWidth || !vHeight) {
    showToast('카메라가 아직 준비되지 않았습니다. 잠시 후 다시 눌러주세요.');
    if (cameraVideo.paused) cameraVideo.play().catch(e => console.warn(e));
    return;
  }

  isProcessing = true;

  // 1. 비디오의 현재 프레임을 캔버스에 캡처
  captureCanvas.width = vWidth;
  captureCanvas.height = vHeight;
  const ctx = captureCanvas.getContext('2d');
  ctx.drawImage(cameraVideo, 0, 0, vWidth, vHeight);

  // 2. 고화질 JPEG 이미지 DataURL 생성
  const imageDataUrl = captureCanvas.toDataURL('image/jpeg', 0.9);
  const base64Data = imageDataUrl.replace(/^data:image\/jpeg;base64,/, '');

  // 3. 화면을 풀이 결과 뷰로 전환
  capturedImagePreview.src = imageDataUrl;
  cameraSection.classList.remove('active');
  resultSection.classList.add('active');

  // 로딩 상태 표시
  loadingIndicator.classList.remove('hidden');
  solutionBox.classList.add('hidden');
  solutionBody.innerHTML = '';

  try {
    // 4. Gemini API 호출
    const selectedModel = (localStorage.getItem(STORAGE_MODEL) || DEFAULT_MODEL).trim();
    const answerText = await requestGeminiSolve(apiKey, selectedModel, base64Data);

    // 5. 마크다운 풀이 결과 렌더링
    solutionBody.innerHTML = marked.parse(answerText);
    loadingIndicator.classList.add('hidden');
    solutionBox.classList.remove('hidden');
  } catch (error) {
    console.error('문제 풀이 에러:', error);
    loadingIndicator.classList.add('hidden');
    solutionBox.classList.remove('hidden');
    solutionBody.innerHTML = `
      <div style="color: #f87171; padding: 14px; background: rgba(239, 68, 68, 0.12); border: 1px solid rgba(239, 68, 68, 0.3); border-radius: 10px;">
        <h4 style="margin-bottom: 6px; font-size: 1rem;">⚠️ 풀이 요청 중 오류가 발생했습니다</h4>
        <p style="font-size: 0.88rem; line-height: 1.5; color: #cbd5e1;">${escapeHtml(error.message || 'API 키 또는 네트워크 상태를 확인해주세요.')}</p>
        <p style="font-size: 0.82rem; margin-top: 8px; color: #94a3b8;">
          💡 <strong>Tip</strong>: 상단 ⚙️ 설정에서 모델을 <code>gemini-2.5-flash</code>로 변경하거나 API 키가 올바른지 확인해보세요.
        </p>
      </div>
    `;
  } finally {
    isProcessing = false;
  }
}

// ==========================================
// 4. Gemini API REST 호출
// ==========================================
async function requestGeminiSolve(apiKey, model, base64Image) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

  const promptText = `
당신은 시험문제 풀이 최고 전문가이자 친절한 과외 선생님입니다.
첨부된 사진 속 시험문제를 주의 깊게 분석하고 명확한 정답과 해설을 제공해주세요.

반드시 다음 형식으로 정리해주세요:
### 1. 문제 내용
(인식한 문제 문항과 보기 번호들을 누락 없이 보기 쉽게 정리)

### 2. 정답
(최종 정답을 명확하게 굵은 글씨로 단번에 식별 가능하도록 표기, 예: **정답: 3번 (12)**)

### 3. 단계별 풀이 해설
- **핵심 개념/공식**: 풀이에 필요한 핵심 원리
- **단계별 풀이 과정**: 누구나 이해하기 쉽게 차근차근 전개
- **오답 피하기 (필요시)**: 헷갈리기 쉬운 함정 분석
`;

  const requestBody = {
    contents: [
      {
        parts: [
          { text: promptText },
          {
            inline_data: {
              mime_type: "image/jpeg",
              data: base64Image
            }
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.2, // 정답 정확도를 높이기 위해 낮은 온도로 설정
      maxOutputTokens: 2048
    }
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    const message = errorData.error?.message || `HTTP 오류 ${response.status}: ${response.statusText}`;

    // 만약 사용자가 입력한 모델이 없거나 지원되지 않는 모델(404)일 경우, 2.5-flash 또는 1.5-flash로 자동 복구 시도
    if (response.status === 404 && model !== DEFAULT_MODEL) {
      console.warn(`[${model}] 모델이 유효하지 않아 기본 모델(${DEFAULT_MODEL})로 자동 재시도합니다...`);
      return await requestGeminiSolve(apiKey, DEFAULT_MODEL, base64Image);
    }

    throw new Error(`[${model}] 호출 실패: ${message}`);
  }

  const result = await response.json();
  const candidate = result.candidates?.[0];

  if (!candidate || !candidate.content?.parts?.[0]?.text) {
    throw new Error('Gemini로부터 답변을 받지 못했습니다. 사진이 흐리거나 인식이 어려울 수 있습니다.');
  }

  return candidate.content.parts[0].text;
}

// ==========================================
// 5. 다음 문제 풀기 (다시 카메라 모드로 복귀)
// ==========================================
function onNextProblem() {
  // 결과 화면 숨기고 카메라 화면 활성화
  resultSection.classList.remove('active');
  cameraSection.classList.add('active');

  // 화면 스크롤 초기화
  resultSection.scrollTop = 0;

  // 비디오가 멈춰있다면 바로 재생
  if (cameraVideo.paused) {
    cameraVideo.play().catch(e => {
      console.warn('복귀 시 재생 실패:', e);
      cameraResumeOverlay.classList.remove('hidden');
    });
  }

  showToast('카메라 준비 완료! 다음 문제를 비춰주세요.');
}

// ==========================================
// 6. 설정 모달 및 유틸리티
// ==========================================
function showSettingsModal() {
  settingsModal.classList.remove('hidden');
}

function hideSettingsModal() {
  settingsModal.classList.add('hidden');
}

function saveSettings() {
  const key = apiKeyInput.value.trim();
  const model = modelInput.value.trim() || DEFAULT_MODEL;

  if (!key) {
    showToast('API 키를 입력해주세요.');
    return;
  }

  localStorage.setItem(STORAGE_API_KEY, key);
  localStorage.setItem(STORAGE_MODEL, model);

  hideSettingsModal();
  showToast(`설정 완료! 모델: ${model}`);
}

let toastTimeout = null;
function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.remove('hidden');

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 2500);
}

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
}
