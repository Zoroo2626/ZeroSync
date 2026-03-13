// main.js - ZeroSync browser client
// each tab = one federated learning client
// connects via websocket, trains locally, sends updates to peers via webrtc
// now with differential privacy noise injection

/* global tf, seedrandom, ZeroSyncModel, ZeroSyncRecorder, ZeroSyncWebRTC, ZeroSyncConfig, ZeroSyncPrivacy */

(function () {
    'use strict';

    const cfg = (typeof ZeroSyncConfig !== 'undefined') ? ZeroSyncConfig : {
        fl: { baseSeed: 12345, scale: 1000 },
        server: { signalingUrl: 'ws://127.0.0.1:4200' },
        privacy: { epsilon: 0 },
        dataset: 'synthetic'
    };

    const BASE_SEED = cfg.fl.baseSeed;
    const SIGNALING_URL = cfg.server.signalingUrl;
    const SCALE = cfg.fl.scale;

    // -- state --
    let clientId = 'client_' + Date.now() + '_' + Math.floor(Math.random() * 1000);
    let clientSeed = BASE_SEED + parseInt(clientId.replace(/\D/g, '').slice(-4), 10);
    let rng = null;
    let model = null;
    let ws = null;
    let rtcManager = null;
    let recorder = null;
    let trainStepCount = 0;
    let isConnected = false;
    let privacyBudget = null;

    // -- dom --
    const logEl = document.getElementById('log');
    const statusEl = document.getElementById('status');
    const clientIdEl = document.getElementById('clientId');
    const seedEl = document.getElementById('seedDisplay');
    const datasetEl = document.getElementById('datasetSelect');
    const epsilonSlider = document.getElementById('epsilonSlider');
    const epsilonDisplay = document.getElementById('epsilonDisplay');
    const dpStatusEl = document.getElementById('dpStatus');
    const btnTrain = document.getElementById('btnTrain');
    const btnSend = document.getElementById('btnSend');
    const btnRecord = document.getElementById('btnRecord');
    const btnConnect = document.getElementById('btnConnect');

    function log(msg, type) {
        const line = document.createElement('div');
        line.className = 'log-line ' + (type || 'info');
        const time = new Date().toLocaleTimeString();
        line.textContent = `[${time}] ${msg}`;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
        console.log(`[ZeroSync] ${msg}`);
    }

    function updateStatus(text) {
        statusEl.textContent = text;
        const dot = document.getElementById('statusDot');
        if (dot) dot.className = 'status-dot' + (isConnected ? ' connected' : '');
    }

    // -- epsilon slider handler --
    function onEpsilonChange() {
        if (!epsilonSlider) return;
        const val = parseFloat(epsilonSlider.value);
        if (epsilonDisplay) {
            if (val === 0) {
                epsilonDisplay.textContent = 'OFF';
                if (dpStatusEl) dpStatusEl.textContent = 'Disabled';
            } else {
                epsilonDisplay.textContent = val.toFixed(1);
                if (val <= 0.5) {
                    if (dpStatusEl) dpStatusEl.textContent = 'Strong privacy (noisy)';
                } else if (val <= 2) {
                    if (dpStatusEl) dpStatusEl.textContent = 'Moderate privacy';
                } else {
                    if (dpStatusEl) dpStatusEl.textContent = 'Weak privacy (accurate)';
                }
            }
        }
        // update config live
        cfg.privacy.epsilon = val;
    }

    // -- init --
    async function init() {
        clientIdEl.textContent = clientId;
        seedEl.textContent = clientSeed;
        rng = seedrandom(clientSeed);
        recorder = ZeroSyncRecorder.create(clientId, clientSeed);

        // setup epsilon slider
        if (epsilonSlider) {
            epsilonSlider.addEventListener('input', onEpsilonChange);
            epsilonSlider.addEventListener('change', onEpsilonChange);
            onEpsilonChange(); // set initial display
        }

        // privacy budget (total epsilon = 10 by default)
        if (typeof ZeroSyncPrivacy !== 'undefined') {
            privacyBudget = ZeroSyncPrivacy.createBudgetTracker(10);
        }

        log(`client ready: ${clientId} (seed: ${clientSeed})`);
        updateStatus('Model loading...');

        try {
            model = ZeroSyncModel.createModel();
            log('model built: input(4) → dense(8, relu) → dense(2, softmax)', 'success');
            updateStatus('Ready – connect to server');
        } catch (err) {
            log('model creation failed: ' + err.message, 'error');
            updateStatus('Error');
        }
    }

    // -- websocket --
    function connect() {
        if (ws && ws.readyState === WebSocket.OPEN) {
            log('already connected');
            return;
        }

        updateStatus('Connecting...');
        log(`connecting to ${SIGNALING_URL}...`);

        try { ws = new WebSocket(SIGNALING_URL); }
        catch (err) {
            log('ws creation failed: ' + err.message, 'error');
            updateStatus('Connection failed');
            return;
        }

        ws.onopen = function () {
            isConnected = true;
            updateStatus('Connected');
            log('connected to signaling server ✓', 'success');
            ws.send(JSON.stringify({ type: 'register', clientId: clientId }));

            rtcManager = ZeroSyncWebRTC.create(clientId, ws, function (peerId, data) {
                if (data.type === 'model_update' && data.clientId !== clientId) {
                    log(`[P2P] got update from ${data.clientId}`, 'peer');
                    ZeroSyncRecorder.recordEvent(recorder, 'receive_update', {
                        fromClient: data.clientId,
                        summaryVector: data.summaryVector,
                        viaP2P: true
                    });
                }
            }, log);
            log('[WebRTC] p2p manager ready');
        };

        ws.onmessage = function (event) {
            try {
                const msg = JSON.parse(event.data);

                if (msg.type === 'webrtc_offer' || msg.type === 'webrtc_answer' ||
                    msg.type === 'webrtc_ice' || msg.type === 'peer_list') {
                    if (rtcManager) rtcManager.handleSignalingMessage(msg);
                    return;
                }

                if (msg.type === 'model_update' && msg.clientId !== clientId) {
                    log(`got update from ${msg.clientId} (${msg.summaryVector.length} vals)`, 'peer');
                    ZeroSyncRecorder.recordEvent(recorder, 'receive_update', {
                        fromClient: msg.clientId,
                        summaryVector: msg.summaryVector,
                        viaP2P: false
                    });
                } else if (msg.type === 'peer_count') {
                    log(`peers online: ${msg.count}`);
                    const p2pEl = document.getElementById('p2pStatus');
                    if (p2pEl) p2pEl.textContent = `${msg.count - 1} (WebRTC)`;
                }
            } catch (err) {
                log('bad message: ' + err.message, 'error');
            }
        };

        ws.onerror = function () {
            log('ws error – is the server running?', 'error');
            updateStatus('Connection error');
        };

        ws.onclose = function () {
            isConnected = false;
            updateStatus('Disconnected');
            log('disconnected from server');
        };
    }

    // -- training --
    async function doTrainStep() {
        if (!model) { log('model not ready', 'error'); return; }

        btnTrain.disabled = true;
        updateStatus('Training...');
        trainStepCount++;
        log(`train step #${trainStepCount}...`);

        try {
            const ds = datasetEl ? datasetEl.value : cfg.dataset;
            const result = await ZeroSyncModel.trainStep(model, rng, ds);
            log(`step #${trainStepCount} done – loss: ${result.loss.toFixed(4)}, acc: ${(result.accuracy * 100).toFixed(1)}%`, 'success');

            ZeroSyncRecorder.recordEvent(recorder, 'train_step', {
                step: trainStepCount,
                loss: result.loss,
                accuracy: result.accuracy,
                dataset: ds
            });

            const weights = ZeroSyncModel.getWeights(model);
            ZeroSyncRecorder.saveCheckpoint(recorder, `after_train_${trainStepCount}`, weights);
            updateStatus('Ready');
        } catch (err) {
            log('training failed: ' + err.message, 'error');
            updateStatus('Training error');
        }
        btnTrain.disabled = false;
    }

    // -- send update --
    function doSendUpdate() {
        if (!model) { log('model not ready', 'error'); return; }
        if (!isConnected) { log('not connected', 'error'); return; }

        let summaryVector = ZeroSyncModel.getSummaryVector(model);
        let dpMeta = { dpEnabled: false };

        // apply differential privacy noise if enabled
        // read slider directly in case the input event didn't sync properly
        const eps = epsilonSlider ? parseFloat(epsilonSlider.value) : cfg.privacy.epsilon;
        if (eps > 0 && typeof ZeroSyncPrivacy !== 'undefined') {
            // check budget
            if (privacyBudget && privacyBudget.exhausted()) {
                log('⚠️ privacy budget exhausted! sending without noise', 'error');
            } else {
                const result = ZeroSyncPrivacy.addNoise(summaryVector, {
                    epsilon: eps,
                    delta: cfg.privacy.delta,
                    clipNorm: cfg.privacy.clipNorm,
                    mechanism: cfg.privacy.mechanism
                });
                summaryVector = result.noisyVector;
                dpMeta = result.metadata;

                if (privacyBudget) {
                    const ok = privacyBudget.spend(eps);
                    log(`🔒 DP applied (ε=${eps}, ${cfg.privacy.mechanism}) – budget: ${privacyBudget.remaining().toFixed(1)} remaining`, 'success');
                    if (!ok) log('⚠️ privacy budget will be exhausted soon', 'error');
                } else {
                    log(`🔒 DP noise added (ε=${eps}, σ=${dpMeta.noiseScale.toFixed(4)})`, 'success');
                }
            }
        }

        const intVector = summaryVector.map(v => Math.round(v * SCALE));

        const msg = {
            type: 'model_update',
            clientId: clientId,
            seed: clientSeed,
            trainSteps: trainStepCount,
            summaryVector: intVector,
            dpEnabled: dpMeta.dpEnabled,
            epsilon: dpMeta.dpEnabled ? dpMeta.epsilon : 0,
            timestamp: Date.now()
        };

        try {
            let p2pSent = 0;
            if (rtcManager) p2pSent = rtcManager.broadcast(msg);

            if (p2pSent > 0) {
                log(`sent via P2P to ${p2pSent} peer(s): [${intVector.join(', ')}]`, 'success');
            }

            ws.send(JSON.stringify(msg));
            if (p2pSent === 0) {
                log(`sent via WS: [${intVector.join(', ')}] (scale=${SCALE})`, 'success');
            }

            ZeroSyncRecorder.recordEvent(recorder, 'send_update', {
                intVector, p2pPeers: p2pSent, dp: dpMeta
            });
        } catch (err) {
            log('send failed: ' + err.message, 'error');
        }
    }

    // -- replay --
    function doRecordReplay() {
        if (!recorder) { log('recorder not ready', 'error'); return; }
        try {
            ZeroSyncRecorder.downloadReplay(recorder);
            log('replay downloaded ✓', 'success');
        } catch (err) {
            log('replay save failed: ' + err.message, 'error');
        }
    }

    // -- wire buttons --
    btnTrain.addEventListener('click', doTrainStep);
    btnSend.addEventListener('click', doSendUpdate);
    btnRecord.addEventListener('click', doRecordReplay);
    btnConnect.addEventListener('click', connect);

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
