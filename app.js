// Gemini 문제 해결사 애플리케이션 로직

// 전역 상태
let currentStream = null;
let currentFacingMode = 'environment'; // 기본: 후면 카메라
let isProcessing = false;

// DOM 요소 참조
const cameraVideo = document.getElementById('cameraVideo');
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
const modelSelect = document.getElementById('modelSelect');
const toastEl = document.getElementById('toast');

// 로컬스토리지 키 이름
const STORAGE_API_KEY = 'gemini_problem_solver_api_key';
const STORAGE_MODEL = 'gemini_problem_solver_model';

// ==========================================
// 1. 초기화 및 이벤트 리스너 등록
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // 저장된 설정 불러오기
  const savedApiKey = localStorage.getItem(STORAGE_API_KEY) || '';
  const savedModel = localStorage.getItem(STORAGE_MODEL) || 'gemini-2.5-flash';

  apiKeyInput.value = savedApiKey;
  modelSelect.value = savedModel;

  // 카메라 시작
  startCamera(currentFacingMode);

  // API 키가 없으면 설정 모달 표시
  if (!savedApiKey) {
    showSettingsModal();
    showToast('Gemini API 키를 먼저 등록해주세요.');
  }

  // 이벤트 바인딩
  captureBtn.addEventListener('click', onCaptureAndSolve);
  nextProblemBtn.addEventListener('click', onNextProblem);
  switchCameraBtn.addEventListener('click', toggleCamera);
  
  openSettingsBtn.addEventListener('click', showSettingsModal);
  closeSettingsBtn.addEventListener('click', hideSettingsModal);
  saveSettingsBtn.addEventListener('click', saveSettings);

  // 모달 바깥 배경 클릭 시 닫기
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) hideSettingsModal();
  });
});

// ==========================================
// 2. 카메라 제어 (실시간 동영상 프리뷰)
// ==========================================
async function startCamera(facingMode = 'environment') {
  // 이전 스트림 중지
  if (currentStream) {
    currentStream.getTracks().forEach(track => track.stop());
  }

  const constraints = {
    audio: false,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    }
  };

  try {
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    cameraVideo.srcObject = currentStream;
    await cameraVideo.play();
  } catch (err) {
    console.warn('이상적 해상도 실패, 기본 카메라로 재시도:', err);
    try {
      currentStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: facingMode }
      });
      cameraVideo.srcObject = currentStream;
      await cameraVideo.play();
    } catch (fallbackErr) {
      console.error('카메라 시작 실패:', fallbackErr);
      showToast('카메라 접근 권한을 허용해주세요.');
    }
  }
}

async function toggleCamera() {
  currentFacingMode = (currentFacingMode === 'environment') ? 'user' : 'environment';
  await startCamera(currentFacingMode);
  showToast(currentFacingMode === 'environment' ? '후면 카메라로 전환' : '전면 카메라로 전환');
}

// ==========================================
// 3. 캡처 & Gemini 전송
// ==========================================
async function onCaptureAndSolve() {
  if (isProcessing) return;

  const apiKey = localStorage.getItem(STORAGE_API_KEY);
  if (!apiKey) {
    showSettingsModal();
    showToast('Gemini API 키를 입력해주세요.');
    return;
  }

  if (!cameraVideo.videoWidth || !cameraVideo.videoHeight) {
    showToast('카메라가 아직 준비되지 않았습니다.');
    return;
  }

  isProcessing = true;

  // 1. 비디오 프레임을 캔버스에 캡처
  captureCanvas.width = cameraVideo.videoWidth;
  captureCanvas.height = cameraVideo.videoHeight;
  const ctx = captureCanvas.getContext('2d');
  ctx.drawImage(cameraVideo, 0, 0, captureCanvas.width, captureCanvas.height);

  // 2. 이미지 DataURL (JPEG) 생성
  const imageDataUrl = captureCanvas.toDataURL('image/jpeg', 0.85);
  const base64Data = imageDataUrl.replace(/^data:image\/jpeg;base64,/, '');

  // 3. 화면을 풀이 결과 뷰로 전환
  capturedImagePreview.src = imageDataUrl;
  cameraSection.classList.remove('active');
  resultSection.classList.add('active');

  // 로딩 인디케이터 표시
  loadingIndicator.classList.remove('hidden');
  solutionBox.classList.add('hidden');
  solutionBody.innerHTML = '';

  try {
    // 4. Gemini API 호출
    const model = localStorage.getItem(STORAGE_MODEL) || 'gemini-2.5-flash';
    const answerText = await requestGeminiSolve(apiKey, model, base64Data);

    // 5. 마크다운 풀이 결과 렌더링
    solutionBody.innerHTML = marked.parse(answerText);
    loadingIndicator.classList.add('hidden');
    solutionBox.classList.remove('hidden');
  } catch (error) {
    console.error('문제 풀이 에러:', error);
    loadingIndicator.classList.add('hidden');
    solutionBox.classList.remove('hidden');
    solutionBody.innerHTML = `
      <div style="color: #ef4444; padding: 12px; background: rgba(239, 68, 68, 0.1); border-radius: 8px;">
        <strong>⚠️ 문제 풀이 중 오류가 발생했습니다.</strong><br>
        <span style="font-size: 0.9em;">${escapeHtml(error.message || 'API 호출에 실패했습니다. API 키와 네트워크를 확인해주세요.')}</span>
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
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const promptText = `
당신은 시험문제 풀이 최고 전문가이자 친절한 과외 선생님입니다.
첨부된 사진 속 시험문제를 주의 깊게 분석하고 정답과 해설을 제공해주세요.

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

    // 만약 모델을 찾을 수 없는 경우(404 등), gemini-1.5-flash로 자동 재시도
    if (response.status === 404 && model !== 'gemini-1.5-flash') {
      console.log(`${model} 모델 실패, gemini-1.5-flash로 재시도합니다...`);
      return await requestGeminiSolve(apiKey, 'gemini-1.5-flash', base64Image);
    }

    throw new Error(message);
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

  // 화면 스크롤 상단으로 초기화
  resultSection.scrollTop = 0;

  // 비디오 재생 확인
  if (cameraVideo.paused) {
    cameraVideo.play().catch(e => console.warn(e));
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
  const model = modelSelect.value;

  if (!key) {
    showToast('API 키를 입력해주세요.');
    return;
  }

  localStorage.setItem(STORAGE_API_KEY, key);
  localStorage.setItem(STORAGE_MODEL, model);

  hideSettingsModal();
  showToast('설정이 저장되었습니다!');
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
