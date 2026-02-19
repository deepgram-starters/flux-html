/**
 * Flux Transcription Frontend
 * Connects to backend WebSocket proxy for Deepgram Flux (v2 Listen)
 * Uses microphone for audio input with turn-based transcript display
 */

import { setLight, setDark, setSystem, getTheme, onThemeChange } from './node_modules/@deepgram/styles/dist/utils.js';

// ============================================================================
// THEME SWITCHING
// ============================================================================

function initThemeToggle() {
  const buttons = {
    light: document.getElementById('theme-light'),
    dark: document.getElementById('theme-dark'),
    system: document.getElementById('theme-system'),
  };

  function updateActiveButton(theme) {
    Object.entries(buttons).forEach(([key, btn]) => {
      btn.className = key === theme
        ? 'dg-btn dg-btn--secondary dg-btn--sm'
        : 'dg-btn dg-btn--ghost dg-btn--sm';
    });
  }

  buttons.light.addEventListener('click', setLight);
  buttons.dark.addEventListener('click', setDark);
  buttons.system.addEventListener('click', setSystem);

  onThemeChange(updateActiveButton);
  updateActiveButton(getTheme());
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

const SESSION_ENDPOINT = 'api/session';
let sessionToken = null;

async function getSessionToken() {
  if (sessionToken) return sessionToken;
  const response = await fetch(SESSION_ENDPOINT);
  if (!response.ok) throw new Error(`Session failed: ${response.status}`);
  const data = await response.json();
  sessionToken = data.token;
  return sessionToken;
}

// ============================================================================
// STATE MANAGEMENT
// ============================================================================

const state = {
  ws: null,
  isConnected: false,
  audioContext: null,
  mediaStream: null,
  audioProcessor: null,
  stats: {
    messages: 0,
    turns: 0
  },
  config: {
    eotThreshold: 0.7,
    eagerEotThreshold: null,
    eotTimeoutMs: 5000,
    keyterms: []
  },
  currentTurn: {
    index: -1,
    event: null,
    transcript: ''
  },
  requestId: null
};

// ============================================================================
// DOM ELEMENTS
// ============================================================================

const elements = {
  // Metadata
  pageTitle: document.getElementById('pageTitle'),
  pageDescription: document.getElementById('pageDescription'),
  headerTitle: document.getElementById('headerTitle'),
  repoLink: document.getElementById('repoLink'),

  // Config
  eotThreshold: document.getElementById('eot-threshold'),
  eotThresholdValue: document.getElementById('eot-threshold-value'),
  eagerEotEnabled: document.getElementById('eager-eot-enabled'),
  eagerEotSection: document.getElementById('eager-eot-section'),
  eagerEotThreshold: document.getElementById('eager-eot-threshold'),
  eagerEotThresholdValue: document.getElementById('eager-eot-threshold-value'),
  eotTimeout: document.getElementById('eot-timeout'),
  keytermInput: document.getElementById('keyterm-input'),

  // UI controls
  connectOverlay: document.getElementById('connect-overlay'),
  connectBtn: document.getElementById('connect-btn'),
  disconnectContainer: document.getElementById('disconnect-container'),
  disconnectBtn: document.getElementById('disconnect-btn'),

  // Transcript
  transcriptContainer: document.getElementById('transcript-container'),
  emptyState: document.getElementById('empty-state'),

  // Status
  connectionStatus: document.getElementById('connection-status'),
  micStatus: document.getElementById('mic-status'),
  requestId: document.getElementById('request-id'),
  messageCount: document.getElementById('message-count'),
  turnCount: document.getElementById('turn-count'),
  currentTurnEvent: document.getElementById('current-turn-event'),

  // Error alert
  errorAlert: document.getElementById('error-alert')
};

// ============================================================================
// INITIALIZATION
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initializeEventListeners();
  loadMetadata();
});

function initializeEventListeners() {
  elements.connectBtn.addEventListener('click', connect);
  elements.disconnectBtn.addEventListener('click', disconnect);

  // Range slider live updates
  elements.eotThreshold.addEventListener('input', () => {
    elements.eotThresholdValue.textContent = parseFloat(elements.eotThreshold.value).toFixed(2);
  });
  elements.eagerEotThreshold.addEventListener('input', () => {
    elements.eagerEotThresholdValue.textContent = parseFloat(elements.eagerEotThreshold.value).toFixed(2);
  });

  // Eager EOT checkbox toggles slider
  elements.eagerEotEnabled.addEventListener('change', () => {
    const enabled = elements.eagerEotEnabled.checked;
    elements.eagerEotSection.classList.toggle('config-section--disabled', !enabled);
    elements.eagerEotThreshold.disabled = !enabled;
  });

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    disconnect();
  });
}

// ============================================================================
// METADATA LOADING
// ============================================================================

async function loadMetadata() {
  try {
    const response = await fetch('api/metadata');
    if (!response.ok) {
      console.warn('Failed to load metadata, using defaults');
      return;
    }

    const metadata = await response.json();

    if (metadata.title && elements.pageTitle) {
      elements.pageTitle.textContent = metadata.title;
    }

    if (metadata.description && elements.pageDescription) {
      elements.pageDescription.setAttribute('content', metadata.description);
    }

    if (metadata.title && elements.headerTitle) {
      elements.headerTitle.textContent = metadata.title;
    }

    if (metadata.repository && elements.repoLink) {
      elements.repoLink.href = metadata.repository;
    }

    console.log('Metadata loaded:', metadata);
  } catch (error) {
    console.warn('Error loading metadata, using defaults:', error);
  }
}

// ============================================================================
// WEBSOCKET CONNECTION
// ============================================================================

async function connect() {
  if (state.isConnected) return;

  // Read configuration from UI
  state.config.eotThreshold = parseFloat(elements.eotThreshold.value);
  state.config.eagerEotThreshold = elements.eagerEotEnabled.checked
    ? parseFloat(elements.eagerEotThreshold.value)
    : null;
  state.config.eotTimeoutMs = parseInt(elements.eotTimeout.value, 10);
  state.config.keyterms = elements.keytermInput.value
    .split(',')
    .map(t => t.trim())
    .filter(Boolean);

  // Update UI
  elements.connectBtn.disabled = true;
  while (elements.connectBtn.firstChild) {
    elements.connectBtn.removeChild(elements.connectBtn.firstChild);
  }
  const spinner = document.createElement('i');
  spinner.className = 'fa-solid fa-spinner fa-spin';
  elements.connectBtn.appendChild(spinner);
  elements.connectBtn.appendChild(document.createTextNode(' Connecting...'));

  try {
    const token = await getSessionToken();

    // Build WebSocket URL with Flux parameters
    const params = new URLSearchParams({
      model: 'flux-general-en',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
      eot_threshold: state.config.eotThreshold.toString(),
      eot_timeout_ms: state.config.eotTimeoutMs.toString()
    });

    // Conditionally add eager EOT threshold
    if (state.config.eagerEotThreshold !== null) {
      params.set('eager_eot_threshold', state.config.eagerEotThreshold.toString());
    }

    // Add key terms (one param per term)
    for (const term of state.config.keyterms) {
      params.append('keyterm', term);
    }

    const wsUrl = new URL(`api/flux?${params}`, document.baseURI);
    wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';

    console.log('Connecting with params:', {
      model: 'flux-general-en',
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
      eot_threshold: state.config.eotThreshold,
      eager_eot_threshold: state.config.eagerEotThreshold,
      eot_timeout_ms: state.config.eotTimeoutMs,
      keyterms: state.config.keyterms
    });

    // Create WebSocket with JWT auth via subprotocol
    state.ws = new WebSocket(wsUrl.href, [`access_token.${token}`]);
    state.ws.binaryType = 'arraybuffer';

    state.ws.onopen = handleWebSocketOpen;
    state.ws.onmessage = handleWebSocketMessage;
    state.ws.onclose = handleWebSocketClose;
    state.ws.onerror = handleWebSocketError;

  } catch (error) {
    console.error('Connection error:', error);
    showError('Failed to connect to server');
    resetConnectButton();
  }
}

function handleWebSocketOpen() {
  console.log('WebSocket connected');
  onConnected();
}

function handleWebSocketMessage(event) {
  try {
    const data = JSON.parse(event.data);

    // Update message count
    state.stats.messages++;
    elements.messageCount.textContent = state.stats.messages;

    if (data.type === 'Connected') {
      // Store request ID from the connection acknowledgment
      state.requestId = data.request_id || null;
      if (state.requestId) {
        elements.requestId.textContent = state.requestId;
      }
      console.log('Flux connected, request_id:', state.requestId);

    } else if (data.type === 'TurnInfo') {
      handleTurnInfo(data);

    } else if (data.type === 'Error') {
      console.error('Flux error:', data);
      showError(data.message || 'Deepgram returned an error');

    } else {
      console.log('Unknown message type:', data.type, data);
    }
  } catch (error) {
    console.error('Error parsing message:', error);
  }
}

/**
 * Handle TurnInfo events from the Flux API.
 * Events: StartOfTurn, Update, EagerEndOfTurn, TurnResumed, EndOfTurn
 */
function handleTurnInfo(data) {
  const { event, turn_index, transcript, words, end_of_turn_confidence } = data;

  console.log(`TurnInfo: ${event} (turn ${turn_index})`, {
    transcript: transcript?.substring(0, 50),
    confidence: end_of_turn_confidence
  });

  switch (event) {
    case 'StartOfTurn':
      // New turn — create a fresh container
      state.currentTurn = {
        index: turn_index,
        event: 'StartOfTurn',
        transcript: transcript || ''
      };
      createTurnContainer(turn_index);
      updateTurnTranscript(turn_index, state.currentTurn.transcript, 'start-of-turn');
      updateTurnEventBadge('StartOfTurn');
      break;

    case 'Update':
      // Replace transcript text within the current turn
      state.currentTurn.event = 'Update';
      state.currentTurn.transcript = transcript || '';
      updateTurnTranscript(turn_index, state.currentTurn.transcript, 'update');
      updateTurnEventBadge('Update');
      break;

    case 'EagerEndOfTurn':
      // Tentative end — mark with amber styling
      state.currentTurn.event = 'EagerEndOfTurn';
      state.currentTurn.transcript = transcript || state.currentTurn.transcript;
      updateTurnTranscript(turn_index, state.currentTurn.transcript, 'eager-eot');
      updateTurnEventBadge('EagerEndOfTurn');
      break;

    case 'TurnResumed':
      // Revert from eager-eot back to active
      state.currentTurn.event = 'TurnResumed';
      state.currentTurn.transcript = transcript || state.currentTurn.transcript;
      updateTurnTranscript(turn_index, state.currentTurn.transcript, 'update');
      updateTurnEventBadge('TurnResumed');
      break;

    case 'EndOfTurn':
      // Finalize turn
      state.currentTurn.event = 'EndOfTurn';
      state.currentTurn.transcript = transcript || state.currentTurn.transcript;
      updateTurnTranscript(turn_index, state.currentTurn.transcript, 'end-of-turn');
      updateTurnEventBadge('EndOfTurn');

      // Increment completed turns
      state.stats.turns++;
      elements.turnCount.textContent = state.stats.turns;

      // Add turn marker after completed turn
      addTurnMarker(turn_index);

      // Reset current turn state
      state.currentTurn = { index: -1, event: null, transcript: '' };
      break;

    default:
      console.warn('Unknown TurnInfo event:', event);
  }
}

function handleWebSocketError(error) {
  console.error('WebSocket error:', error);
  updateConnectionStatus(false, 'Error');
}

function handleWebSocketClose(event) {
  console.log('WebSocket closed:', event.code, event.reason);
  state.isConnected = false;

  // Handle session expiry
  if (event.code === 4401) {
    sessionToken = null;
    showError('Session expired, please refresh the page.');
    updateConnectionStatus(false, 'Session Expired');
    updateMicrophoneStatus(false);
    return;
  }

  updateConnectionStatus(false, 'Disconnected');
  updateMicrophoneStatus(false);

  // Show reconnect UI after delay
  setTimeout(() => {
    if (!state.isConnected) {
      elements.transcriptContainer.classList.add('hidden');
      elements.disconnectContainer.classList.add('hidden');
      elements.connectOverlay.classList.remove('hidden');
      resetConnectButton();
    }
  }, 2000);
}

// ============================================================================
// CONNECTION LIFECYCLE
// ============================================================================

async function onConnected() {
  console.log('WebSocket connected, requesting microphone...');

  state.isConnected = true;
  updateConnectionStatus(false, 'Requesting microphone...');

  // Disable config while connected
  elements.eotThreshold.disabled = true;
  elements.eagerEotEnabled.disabled = true;
  elements.eagerEotThreshold.disabled = true;
  elements.eotTimeout.disabled = true;
  elements.keytermInput.disabled = true;

  try {
    await initializeAudioContext();
    await startMicrophone();

    // Update UI
    elements.connectOverlay.classList.add('hidden');
    elements.disconnectContainer.classList.remove('hidden');
    elements.transcriptContainer.classList.remove('hidden');

    updateConnectionStatus(true, 'Connected');
    console.log('Fully connected - microphone active, ready to transcribe');

  } catch (error) {
    console.error('Failed to initialize audio:', error);
    state.isConnected = false;
    showError('Failed to access microphone. Please allow microphone access and try again.');
    disconnect();
  }
}

function disconnect() {
  // Send CloseStream before closing WebSocket (Flux graceful shutdown)
  if (state.ws && state.ws.readyState === WebSocket.OPEN) {
    try {
      state.ws.send(JSON.stringify({ type: 'CloseStream' }));
    } catch (error) {
      console.warn('Failed to send CloseStream:', error);
    }
  }

  // Close WebSocket
  if (state.ws) {
    state.ws.close(1000, 'User disconnected');
    state.ws = null;
  }

  // Stop microphone and audio processor
  if (state.audioProcessor) {
    state.audioProcessor.disconnect();
    state.audioProcessor = null;
  }

  if (state.mediaStream) {
    state.mediaStream.getTracks().forEach(track => track.stop());
    state.mediaStream = null;
  }

  state.isConnected = false;

  // Update UI
  updateConnectionStatus(false, 'Disconnected');
  updateMicrophoneStatus(false);
  elements.requestId.textContent = '-';

  // Re-enable config
  elements.eotThreshold.disabled = false;
  elements.eagerEotEnabled.disabled = false;
  elements.eagerEotThreshold.disabled = !elements.eagerEotEnabled.checked;
  elements.eotTimeout.disabled = false;
  elements.keytermInput.disabled = false;

  // Reset turn event badge
  updateTurnEventBadge(null);

  // Show connect overlay
  elements.transcriptContainer.classList.add('hidden');
  elements.disconnectContainer.classList.add('hidden');
  elements.connectOverlay.classList.remove('hidden');
  resetConnectButton();
}

function resetConnectButton() {
  elements.connectBtn.disabled = false;
  while (elements.connectBtn.firstChild) {
    elements.connectBtn.removeChild(elements.connectBtn.firstChild);
  }
  const icon = document.createElement('i');
  icon.className = 'fa-solid fa-plug';
  elements.connectBtn.appendChild(icon);
  elements.connectBtn.appendChild(document.createTextNode(' Connect'));
}

// ============================================================================
// AUDIO CONTEXT
// ============================================================================

async function initializeAudioContext() {
  if (state.audioContext) return;

  try {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 16000,
    });

    if (state.audioContext.state === 'suspended') {
      await state.audioContext.resume();
    }

    console.log(`Audio context initialized: ${state.audioContext.sampleRate}Hz, ${state.audioContext.state}`);
  } catch (error) {
    console.error('Failed to initialize audio context:', error);
    showError('Failed to initialize audio system');
  }
}

// ============================================================================
// MICROPHONE CAPTURE
// ============================================================================

async function startMicrophone() {
  if (state.mediaStream) {
    console.log('Microphone already active');
    return;
  }

  updateMicrophoneStatus('Requesting...');
  console.log('Requesting microphone access...');

  state.mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      sampleRate: 16000,
      echoCancellation: true,
      noiseSuppression: true,
    },
  });

  console.log('Microphone access granted');

  if (!state.audioContext) {
    await initializeAudioContext();
  }

  const source = state.audioContext.createMediaStreamSource(state.mediaStream);
  state.audioProcessor = state.audioContext.createScriptProcessor(4096, 1, 1);

  let audioChunkCount = 0;
  state.audioProcessor.onaudioprocess = (e) => {
    if (!state.isConnected) return;

    const inputData = e.inputBuffer.getChannelData(0);

    // Convert float32 to int16
    const pcm16 = new Int16Array(inputData.length);
    for (let i = 0; i < inputData.length; i++) {
      const s = Math.max(-1, Math.min(1, inputData[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }

    // Send binary audio to WebSocket
    if (state.ws && state.ws.readyState === WebSocket.OPEN) {
      try {
        state.ws.send(pcm16.buffer);
        audioChunkCount++;
        if (audioChunkCount === 1) {
          console.log(`First audio chunk sent (${pcm16.buffer.byteLength} bytes)`);
        } else if (audioChunkCount % 50 === 0) {
          console.log(`Sent ${audioChunkCount} audio chunks to server`);
        }
      } catch (error) {
        console.error('Error sending audio chunk:', error);
      }
    }
  };

  source.connect(state.audioProcessor);
  state.audioProcessor.connect(state.audioContext.destination);

  console.log('Audio processing pipeline connected');
  updateMicrophoneStatus(true);
  console.log('Microphone active - ready to transcribe');
}

// ============================================================================
// TURN DISPLAY MANAGEMENT
// ============================================================================

/**
 * Create a container div for a new turn. Each turn gets its own container
 * so that Updates replace text in-place rather than appending new items.
 */
function createTurnContainer(turnIndex) {
  // Remove empty state if present
  if (elements.emptyState && !elements.emptyState.classList.contains('hidden')) {
    elements.emptyState.classList.add('hidden');
  }

  const container = document.createElement('div');
  container.className = 'transcript-turn';
  container.id = `turn-${turnIndex}`;

  // Create the transcript item inside the turn container
  const item = document.createElement('div');
  item.className = 'transcript-item transcript-item--start-of-turn';
  item.id = `turn-item-${turnIndex}`;

  // Header with timestamp and event badge
  const header = document.createElement('div');
  header.className = 'transcript-item__header';

  const timestamp = document.createElement('div');
  timestamp.className = 'dg-prose dg-prose--small dg-text-muted';
  timestamp.textContent = new Date().toLocaleTimeString();

  const badge = document.createElement('span');
  badge.className = 'turn-event-badge turn-event-badge--start-of-turn';
  badge.id = `turn-badge-${turnIndex}`;
  badge.textContent = 'Start';

  header.appendChild(timestamp);
  header.appendChild(badge);
  item.appendChild(header);

  // Transcript text
  const textDiv = document.createElement('div');
  textDiv.className = 'dg-prose';
  textDiv.id = `turn-text-${turnIndex}`;
  item.appendChild(textDiv);

  container.appendChild(item);
  elements.transcriptContainer.appendChild(container);

  // Auto-scroll
  elements.transcriptContainer.scrollTop = elements.transcriptContainer.scrollHeight;
}

/**
 * Update the transcript text and styling for a turn.
 * This replaces text in-place within the turn's container.
 */
function updateTurnTranscript(turnIndex, transcript, eventClass) {
  const textEl = document.getElementById(`turn-text-${turnIndex}`);
  const itemEl = document.getElementById(`turn-item-${turnIndex}`);
  const badgeEl = document.getElementById(`turn-badge-${turnIndex}`);

  if (!textEl || !itemEl) return;

  // Update transcript text
  textEl.textContent = transcript;

  // Update item styling based on event
  itemEl.className = `transcript-item transcript-item--${eventClass}`;

  // Update inline badge
  if (badgeEl) {
    const badgeLabels = {
      'start-of-turn': 'Start',
      'update': 'Update',
      'eager-eot': 'Eager EOT',
      'end-of-turn': 'Final'
    };
    // TurnResumed uses 'update' eventClass
    badgeEl.textContent = badgeLabels[eventClass] || eventClass;
    badgeEl.className = `turn-event-badge turn-event-badge--${eventClass}`;
  }

  // Auto-scroll
  elements.transcriptContainer.scrollTop = elements.transcriptContainer.scrollHeight;
}

/**
 * Add a visual separator between completed turns.
 */
function addTurnMarker(turnIndex) {
  const marker = document.createElement('div');
  marker.className = 'transcript-turn-marker dg-prose dg-prose--small dg-text-muted';
  marker.textContent = `Turn ${turnIndex + 1} complete`;
  elements.transcriptContainer.appendChild(marker);
}

// ============================================================================
// UI UPDATES
// ============================================================================

function updateConnectionStatus(connected, text) {
  elements.connectionStatus.className = connected
    ? 'status-badge dg-text-primary'
    : 'status-badge dg-text-muted';

  while (elements.connectionStatus.firstChild) {
    elements.connectionStatus.removeChild(elements.connectionStatus.firstChild);
  }

  const indicator = document.createElement('span');
  indicator.className = connected
    ? 'status-indicator status-indicator--connected'
    : 'status-indicator status-indicator--disconnected';
  elements.connectionStatus.appendChild(indicator);
  elements.connectionStatus.appendChild(document.createTextNode(text));
}

function updateMicrophoneStatus(active) {
  if (active === true) {
    elements.micStatus.textContent = 'Active';
    elements.micStatus.style.color = 'var(--color-dg-primary, #13ef95)';
  } else if (active === false) {
    elements.micStatus.textContent = 'Inactive';
    elements.micStatus.style.color = '';
  } else {
    elements.micStatus.textContent = active;
    elements.micStatus.style.color = '';
  }
}

/**
 * Update the turn event badge in the status sidebar.
 * Shows the current turn lifecycle event with color coding.
 */
function updateTurnEventBadge(event) {
  const container = elements.currentTurnEvent;
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }

  if (!event) {
    const badge = document.createElement('span');
    badge.className = 'turn-event-badge';
    badge.style.visibility = 'hidden';
    badge.textContent = '-';
    container.appendChild(badge);
    return;
  }

  const classMap = {
    'StartOfTurn': 'start-of-turn',
    'Update': 'update',
    'EagerEndOfTurn': 'eager-eot',
    'TurnResumed': 'turn-resumed',
    'EndOfTurn': 'end-of-turn'
  };

  const badge = document.createElement('span');
  badge.className = `turn-event-badge turn-event-badge--${classMap[event] || 'update'}`;
  badge.textContent = event;
  container.appendChild(badge);
}

function showError(message) {
  const container = elements.errorAlert;
  container.querySelector('.dg-alert__description p').textContent = message;
  container.classList.remove('hidden');
  setTimeout(() => container.classList.add('hidden'), 10000);
}

// ============================================================================
// INITIALIZATION
// ============================================================================

console.log('Flux Transcription frontend initialized');
